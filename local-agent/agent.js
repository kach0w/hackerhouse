// Hacker House local companion — runs on the VISITOR's own machine, never on
// the shared/ngrok server. Holds one real shell pty, authenticated with
// whatever the visitor already has on their own PATH (claude, clod alias,
// open claw, etc.) — this process never touches anyone else's credentials.
//
// Bound to 127.0.0.1 only and gated by a token written to disk at install
// time, so a random website can't attach to your shell just by knowing the
// port. Runs as a persistent background service (see install.sh) so it
// survives closing the browser tab and stays available across restarts.
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WebSocketServer } = require("ws");
const pty = require("node-pty");
const { Terminal } = require("@xterm/headless");
const { SerializeAddon } = require("@xterm/addon-serialize");

const HOME_DIR = path.join(os.homedir(), ".hackerhouse-agent");
const TOKEN_FILE = path.join(HOME_DIR, "token");
const PORT = Number(process.env.HACKERHOUSE_AGENT_PORT) || 47821;
const SCROLLBACK = 1000;
const COLS = 100;
const ROWS = 30;

function readToken() {
  try {
    return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    console.error(`No token found at ${TOKEN_FILE}. Run install.sh first.`);
    process.exit(1);
  }
}

const TOKEN = readToken();

// One persistent pty for the whole machine — this agent is "your terminal",
// singular, not a multi-room server. It's created lazily on first verified
// connection and kept alive across reconnects/browser reloads so scrollback
// and any running foreground process (including Claude Code) survive a
// lounge-and-back trip.
let session = null;

function createSession() {
  const shell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/bash";
  const term = pty.spawn(shell, [], {
    name: "xterm-color",
    cols: COLS,
    rows: ROWS,
    cwd: os.homedir(),
    env: process.env,
  });

  const screen = new Terminal({ cols: COLS, rows: ROWS, scrollback: SCROLLBACK, allowProposedApi: true });
  const serializer = new SerializeAddon();
  screen.loadAddon(serializer);

  const s = { pty: term, screen, serializer, sockets: new Set() };

  term.onData((data) => {
    screen.write(data);
    for (const ws of s.sockets) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "output", data }));
    }
  });

  term.onExit(() => {
    for (const ws of s.sockets) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "exited" }));
    }
    screen.dispose();
    if (session === s) session = null;
  });

  return s;
}

function clamp(value, min, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

const server = http.createServer((req, res) => {
  // Plain health check so the frontend can poll for "is the agent up yet"
  // without opening a WS handshake every time.
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

// Bind explicitly to the loopback interface — never 0.0.0.0 — so this is
// unreachable from anything but the visitor's own machine.
const wss = new WebSocketServer({ server, host: "127.0.0.1" });

wss.on("connection", (ws) => {
  let authed = false;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (!authed) {
      if (msg.type === "hello" && msg.token === TOKEN) {
        authed = true;
        if (!session) session = createSession();
        session.sockets.add(ws);
        ws.send(
          JSON.stringify({
            type: "ready",
            buffer: session.serializer.serialize({ scrollback: SCROLLBACK }),
          })
        );
      } else {
        ws.close();
      }
      return;
    }

    if (msg.type === "input") {
      session.pty.write(msg.data);
      return;
    }

    if (msg.type === "resize") {
      const cols = clamp(msg.cols, 10, 300);
      const rows = clamp(msg.rows, 5, 100);
      session.pty.resize(cols, rows);
      session.screen.resize(cols, rows);
      return;
    }
  });

  ws.on("close", () => {
    if (session) session.sockets.delete(ws);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`hacker house local agent listening on ws://127.0.0.1:${PORT}`);
});
