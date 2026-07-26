// Hacker House local terminal-agent — runs on the VISITOR's own machine,
// never on the shared/ngrok host. Spawns a real `claude` pty authenticated
// with whatever the visitor already has on their own PATH, then registers
// with the host's Socket.IO /terminal namespace exactly like the manual
// `npm run agent --workspace server` script used to — the host still relays
// output to the owner AND any spectators, so nothing about multi-viewer
// spectating changes. The only thing this replaces is the setup: one curl
// command instead of cloning the whole monorepo and hand-copying env vars
// out of the browser console.
//
// Runs as a persistent background service (see install.sh) so it survives
// closing the browser tab and comes back after a reboot.
const fs = require("fs");
const os = require("os");
const path = require("path");
const pty = require("node-pty");
const { io } = require("socket.io-client");

const HOME_DIR = path.join(os.homedir(), ".hackerhouse-agent");
const CONFIG_FILE = path.join(HOME_DIR, "config.json");
const HOOK_FILE = path.join(HOME_DIR, "notify-agent-done.sh");

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    console.error(`No config found at ${CONFIG_FILE}. Run install.sh first.`);
    process.exit(1);
  }
}

const { serverUrl, roomId, token } = readConfig();
if (!serverUrl || !roomId || !token) {
  console.error(`${CONFIG_FILE} is missing serverUrl/roomId/token. Re-run install.sh.`);
  process.exit(1);
}

// Same convention as the host's own resolveCwd (server/src/terminal/pty.ts):
// a room-scoped dir under ~/demo/<roomId> so a project-local Claude Stop
// hook can be installed without touching the visitor's own ~/.claude/.
function resolveCwd() {
  const dir = path.join(os.homedir(), "demo", roomId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Mirrors the host's ensureNotifyHook, using the copy of the hook script
// install.sh fetched from the same server this agent is registering with
// (there's no repo checkout on the visitor's machine to read it from).
function ensureNotifyHook(cwd) {
  if (!fs.existsSync(HOOK_FILE)) {
    console.warn(`[agent] notify hook missing at ${HOOK_FILE} — agent-done will not fire`);
    return;
  }
  try {
    const hooksDir = path.join(cwd, ".claude", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });

    const hookDest = path.join(hooksDir, "notify-agent-done.sh");
    fs.copyFileSync(HOOK_FILE, hookDest);
    fs.chmodSync(hookDest, 0o755);

    const settingsPath = path.join(cwd, ".claude", "settings.json");
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      } catch {
        settings = {};
      }
    }

    const escaped = hookDest.replace(/'/g, `'\\''`);
    const prevHooks = settings.hooks && typeof settings.hooks === "object" ? settings.hooks : {};
    settings.hooks = {
      ...prevHooks,
      Stop: [{ hooks: [{ type: "command", command: `bash '${escaped}'` }] }],
    };

    fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  } catch (err) {
    console.warn("[agent] failed to install notify Stop hook:", err.message);
  }
}

function clamp(value, min, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

let ptyProcess = null;

function startPty() {
  if (ptyProcess) return;
  const cwd = resolveCwd();
  ensureNotifyHook(cwd);

  const opts = {
    name: "xterm-color",
    cols: 100,
    rows: 30,
    cwd,
    env: {
      ...process.env,
      HACKERHOUSE_SERVER_URL: serverUrl,
      HACKERHOUSE_USER_ID: roomId,
    },
  };

  try {
    ptyProcess = pty.spawn("claude", [], opts);
  } catch (err) {
    console.warn(`[agent] "claude" not found on PATH, falling back to $SHELL:`, err.message);
    ptyProcess = pty.spawn(process.env.SHELL || "bash", [], opts);
  }

  ptyProcess.onData((data) => {
    socket.emit("localAgent:output", { roomId, data });
  });
  ptyProcess.onExit(({ exitCode }) => {
    console.log(`[agent] claude exited (code ${exitCode}) — exiting so the service restarts a fresh session.`);
    process.exit(0);
  });
}

const socket = io(`${serverUrl}/terminal`, { transports: ["websocket"] });

socket.on("connect", () => {
  console.log(`[agent] connected, registering room ${roomId}...`);
  socket.emit("localAgent:register", { roomId, token });
});

socket.on("localAgent:registered", () => {
  console.log(`[agent] registered — this room's terminal now runs here, on this machine.`);
  startPty();
});

socket.on("localAgent:register:denied", ({ reason }) => {
  console.error(`[agent] registration denied: ${reason}`);
  process.exit(1);
});

socket.on("localAgent:input", ({ data }) => {
  ptyProcess?.write(data);
});

socket.on("localAgent:resize", ({ cols, rows }) => {
  ptyProcess?.resize(clamp(cols, 10, 300), clamp(rows, 5, 100));
});

socket.on("connect_error", (err) => {
  console.error("[agent] connect_error:", err.message);
});
