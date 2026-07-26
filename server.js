const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const pty = require("node-pty");
const crypto = require("crypto");
const { Terminal } = require("@xterm/headless");
const { SerializeAddon } = require("@xterm/addon-serialize");

const app = express();
app.use(express.static("public"));
// Served so the browser's one-time install command (curl $ORIGIN/agent/install.sh
// | bash -s -- token $ORIGIN) can fetch the local companion — this app never
// runs the companion itself, it only hands visitors the file to run locally.
app.use("/agent", express.static("local-agent"));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const SCROLLBACK = 1000;
const MIN_COLS = 10;
const MAX_COLS = 300;
const MIN_ROWS = 5;
const MAX_ROWS = 100;
const IDLE_REAP_MS = 10 * 60 * 1000; // kill an unwatched pty after 10 idle minutes
const IDLE_SWEEP_INTERVAL_MS = 30 * 1000;

// sessionId -> { pty, ownerToken, locked, screen, serializer, sockets: Map<socketId, ws>, idleSince: number|null }
const sessions = new Map();

function broadcast(session, msg, exceptSocketId) {
  const data = JSON.stringify(msg);
  for (const [id, ws] of session.sockets) {
    if (id === exceptSocketId) continue;
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function clamp(value, min, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function roomList() {
  return [...sessions.entries()].map(([id, s]) => ({
    id,
    locked: s.locked,
    viewers: s.sockets.size,
  }));
}

// Stub for Track A's verifySession(token): { userId } | null. Track A will
// replace this with signed-token verification against server/state.js; for
// now it mirrors the existing ownerToken comparison so the call site below
// doesn't need to change shape once A lands.
function verifySession(token, session) {
  if (token && session && token === session.ownerToken) return { userId: "owner" };
  return null;
}

function markSessionActive(session) {
  session.idleSince = null;
}

function markSessionIdleIfEmpty(session) {
  if (session.sockets.size === 0) session.idleSince = Date.now();
}

function reapIdleSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessions) {
    if (session.idleSince !== null && !session.reaping && now - session.idleSince >= IDLE_REAP_MS) {
      console.log(`[room ${sessionId}] reaping pty after ${IDLE_REAP_MS / 1000}s with no viewers`);
      session.reaping = true;
      // Actual teardown (screen.dispose, sessions.delete) happens in the
      // shared term.onExit handler below, same as "end" and a natural exit.
      session.pty.kill();
    }
  }
}

setInterval(reapIdleSessions, IDLE_SWEEP_INTERVAL_MS).unref();

wss.on("connection", (ws) => {
  const socketId = crypto.randomUUID();
  let session = null;
  let sessionId = null;
  let isOwner = false;

  // A socket only ever watches one room at a time. Call this before joining
  // or creating a new one so a switch doesn't leak the socket into two
  // rooms' broadcast lists at once.
  function leaveCurrentSession() {
    if (!session) return;
    session.sockets.delete(socketId);
    markSessionIdleIfEmpty(session);
    session = null;
    sessionId = null;
    isOwner = false;
  }

  ws.send(JSON.stringify({ type: "rooms", rooms: roomList() }));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "create") {
      leaveCurrentSession();

      const newSessionId = crypto.randomUUID().slice(0, 8);
      const ownerToken = crypto.randomUUID();
      const cols = clamp(100, MIN_COLS, MAX_COLS);
      const rows = clamp(30, MIN_ROWS, MAX_ROWS);

      let term;
      try {
        term = pty.spawn("claude", [], {
          name: "xterm-color",
          cols,
          rows,
          cwd: process.env.HOME,
          env: process.env,
        });
      } catch (err) {
        console.warn(`[room ${newSessionId}] "claude" not found on PATH, falling back to $SHELL:`, err.message);
        term = pty.spawn(process.env.SHELL || "bash", [], {
          name: "xterm-color",
          cols,
          rows,
          cwd: process.env.HOME,
          env: process.env,
        });
      }

      // The headless terminal is the authoritative screen: it parses the
      // pty's byte stream into real terminal state (including alt-screen
      // switches), so a late joiner gets a correctly reconstructed screen
      // instead of a raw byte buffer that can be sliced mid-escape-sequence.
      const screen = new Terminal({ cols, rows, scrollback: SCROLLBACK, allowProposedApi: true });
      const serializer = new SerializeAddon();
      screen.loadAddon(serializer);

      // Bind the pty callbacks to this specific session object/id, not the
      // connection's mutable `session`/`sessionId` — those get reassigned
      // the moment this same socket joins or creates another room, which
      // would otherwise misroute this pty's output after a room switch.
      const newSession = {
        pty: term,
        ownerToken,
        locked: false,
        screen,
        serializer,
        sockets: new Map([[socketId, ws]]),
        idleSince: null,
      };
      sessions.set(newSessionId, newSession);

      session = newSession;
      sessionId = newSessionId;
      isOwner = true;

      term.onData((data) => {
        screen.write(data);
        broadcast(newSession, { type: "output", data });
      });
      term.onExit(() => {
        broadcast(newSession, { type: "exited" });
        screen.dispose();
        sessions.delete(newSessionId);
      });

      ws.send(JSON.stringify({ type: "created", sessionId: newSessionId, ownerToken }));
      return;
    }

    if (msg.type === "join") {
      const s = sessions.get(msg.sessionId);
      if (!s) {
        ws.send(JSON.stringify({ type: "error", message: "room not found" }));
        return;
      }

      const identity = verifySession(msg.token, s);
      const claimsOwner = !!identity;

      if (!claimsOwner && s.locked) {
        ws.send(JSON.stringify({ type: "error", message: "room is locked" }));
        return;
      }

      leaveCurrentSession();

      session = s;
      sessionId = msg.sessionId;
      isOwner = claimsOwner;
      session.sockets.set(socketId, ws);
      markSessionActive(session);

      ws.send(
        JSON.stringify({
          type: "joined",
          sessionId,
          isOwner,
          buffer: session.serializer.serialize({ scrollback: SCROLLBACK }),
        })
      );
      return;
    }

    if (!session) return;

    // Only a verified owner socket ever reaches the pty.
    if (msg.type === "input" && isOwner) {
      session.pty.write(msg.data);
      return;
    }

    if (msg.type === "resize" && isOwner) {
      const cols = clamp(msg.cols, MIN_COLS, MAX_COLS);
      const rows = clamp(msg.rows, MIN_ROWS, MAX_ROWS);
      session.pty.resize(cols, rows);
      session.screen.resize(cols, rows);
      return;
    }

    if (msg.type === "lock" && isOwner) {
      session.locked = !!msg.locked;
      if (session.locked) {
        for (const [id, sock] of session.sockets) {
          if (id !== socketId) {
            sock.send(JSON.stringify({ type: "kicked" }));
            sock.close();
            session.sockets.delete(id);
          }
        }
        markSessionIdleIfEmpty(session);
      }
      return;
    }

    // Explicit end-session action — the only thing that kills the pty.
    // Disconnecting (closing the tab, navigating to the lounge) never does.
    if (msg.type === "end" && isOwner) {
      session.pty.kill();
      return;
    }
  });

  ws.on("close", () => {
    leaveCurrentSession();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`hacker house scaffold on http://localhost:${PORT}`));
