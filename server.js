const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const pty = require("node-pty");
const crypto = require("crypto");

const app = express();
app.use(express.static("public"));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const BUFFER_LINES = 200;

// sessionId -> { pty, ownerToken, locked, outputLines: string[], sockets: Map<socketId, ws> }
const sessions = new Map();

function broadcast(session, msg, exceptSocketId) {
  const data = JSON.stringify(msg);
  for (const [id, ws] of session.sockets) {
    if (id === exceptSocketId) continue;
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function appendToBuffer(session, chunk) {
  session.outputLines.push(chunk);
  // trim by total length roughly, cheap and good enough for a demo
  while (session.outputLines.length > BUFFER_LINES) session.outputLines.shift();
}

function roomList() {
  return [...sessions.entries()].map(([id, s]) => ({
    id,
    locked: s.locked,
    viewers: s.sockets.size,
  }));
}

wss.on("connection", (ws) => {
  const socketId = crypto.randomUUID();
  let session = null;
  let sessionId = null;
  let isOwner = false;

  ws.send(JSON.stringify({ type: "rooms", rooms: roomList() }));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "create") {
      const newSessionId = crypto.randomUUID().slice(0, 8);
      const ownerToken = crypto.randomUUID();

      let term;
      try {
        term = pty.spawn("claude", [], {
          name: "xterm-color",
          cols: 100,
          rows: 30,
          cwd: process.env.HOME,
          env: process.env,
        });
      } catch (err) {
        console.warn(`[room ${newSessionId}] "claude" not found on PATH, falling back to $SHELL:`, err.message);
        term = pty.spawn(process.env.SHELL || "bash", [], {
          name: "xterm-color",
          cols: 100,
          rows: 30,
          cwd: process.env.HOME,
          env: process.env,
        });
      }

      session = {
        pty: term,
        ownerToken,
        locked: false,
        outputLines: [],
        sockets: new Map([[socketId, ws]]),
      };
      sessionId = newSessionId;
      sessions.set(sessionId, session);
      isOwner = true;

      term.onData((data) => {
        appendToBuffer(session, data);
        broadcast(session, { type: "output", data });
      });
      term.onExit(() => {
        broadcast(session, { type: "exited" });
        sessions.delete(sessionId);
      });

      ws.send(JSON.stringify({ type: "created", sessionId, ownerToken }));
      return;
    }

    if (msg.type === "join") {
      const s = sessions.get(msg.sessionId);
      if (!s) {
        ws.send(JSON.stringify({ type: "error", message: "room not found" }));
        return;
      }

      const claimsOwner = !!msg.token && msg.token === s.ownerToken;

      if (!claimsOwner && s.locked) {
        ws.send(JSON.stringify({ type: "error", message: "room is locked" }));
        return;
      }

      session = s;
      sessionId = msg.sessionId;
      isOwner = claimsOwner;
      session.sockets.set(socketId, ws);

      ws.send(
        JSON.stringify({
          type: "joined",
          sessionId,
          isOwner,
          buffer: session.outputLines.join(""),
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
      session.pty.resize(msg.cols, msg.rows);
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
    if (session) {
      session.sockets.delete(socketId);
      // Owner disconnecting does NOT kill the pty — it keeps running so the
      // agent session survives navigation away to the lounge. Only an
      // explicit "end" message or the process exiting on its own tears it down.
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`hacker house scaffold on http://localhost:${PORT}`));
