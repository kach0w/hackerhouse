#!/usr/bin/env node
/**
 * Standalone, dependency-minimal twin of agent.ts — this is what gets
 * downloaded onto and run on OTHER people's machines via install.sh, so it
 * deliberately does NOT import from @hackerhouse/shared or anywhere else in
 * the monorepo. It only needs `socket.io-client` and `node-pty` installed
 * alongside it (see install.sh), not a full clone of this repo.
 *
 * Registers with the SAME localAgent:register/output protocol as agent.ts —
 * this is not a different architecture, just a version that can be `curl`ed
 * down standalone. Keep the two in sync by hand; there's no shared
 * type-checking between them by design.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { io } = require('socket.io-client');
const pty = require('node-pty');

const AGENT_DIR = path.join(os.homedir(), '.hackerhouse-agent');
const ENV_FILE = path.join(AGENT_DIR, 'env.json');

function loadEnv() {
  // Env vars win if set directly (e.g. running by hand for testing);
  // otherwise fall back to what install.sh wrote to disk, so the persistent
  // background service (launchd/systemd) doesn't need to bake secrets into
  // a plist/unit file.
  let fromDisk = {};
  try {
    fromDisk = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'));
  } catch {
    // No env file yet — fine if all three vars came from the environment.
  }
  return {
    serverUrl: process.env.HACKERHOUSE_SERVER_URL || fromDisk.serverUrl,
    roomId: process.env.HACKERHOUSE_USER_ID || fromDisk.roomId,
    token: process.env.HACKERHOUSE_SESSION_TOKEN || fromDisk.token,
  };
}

const { serverUrl: SERVER_URL, roomId: ROOM_ID, token: TOKEN } = loadEnv();

if (!SERVER_URL || !ROOM_ID || !TOKEN) {
  console.error(
    '[agent] Missing config. Need HACKERHOUSE_SERVER_URL, HACKERHOUSE_USER_ID, and ' +
      `HACKERHOUSE_SESSION_TOKEN — either as env vars or in ${ENV_FILE} (written by install.sh).`,
  );
  process.exit(1);
}

function resolveCwd(roomId) {
  const demoDir = path.join(os.homedir(), 'demo', roomId);
  fs.mkdirSync(demoDir, { recursive: true });
  return demoDir;
}

// If this agent happens to be launched from inside a Claude Code session,
// strip CLAUDE_CODE_* markers so the spawned room session doesn't inherit
// a "child session" warning it doesn't actually apply to.
function cleanEnv(base) {
  const env = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || key.startsWith('CLAUDE_')) continue;
    env[key] = value;
  }
  return env;
}

function spawnClaudeOrFallback(roomId) {
  const cwd = resolveCwd(roomId);
  console.log(`[agent] room ${roomId} -> cwd ${cwd}`);
  const opts = {
    name: 'xterm-color',
    cols: 100,
    rows: 30,
    cwd,
    env: {
      ...cleanEnv(process.env),
      HACKERHOUSE_SERVER_URL: SERVER_URL,
      HACKERHOUSE_USER_ID: roomId,
    },
  };
  try {
    return pty.spawn('claude', [], opts);
  } catch (err) {
    console.warn('[agent] "claude" not found on PATH, falling back to $SHELL:', err.message);
    return pty.spawn(process.env.SHELL || 'bash', [], opts);
  }
}

function connect() {
  const socket = io(`${SERVER_URL}/terminal`, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 2000,
  });

  let term = null;

  function startPty() {
    if (term) return;
    term = spawnClaudeOrFallback(ROOM_ID);
    term.onData((data) => socket.emit('localAgent:output', { roomId: ROOM_ID, data }));
    term.onExit(({ exitCode }) => {
      console.log(`[agent] claude exited (code ${exitCode}) — will restart on next reconnect.`);
      term = null;
    });
  }

  socket.on('connect', () => {
    console.log(`[agent] connected, registering room ${ROOM_ID}...`);
    socket.emit('localAgent:register', { roomId: ROOM_ID, token: TOKEN });
  });

  socket.on('localAgent:registered', () => {
    console.log(`[agent] registered — your room's terminal now runs here, on your own machine.`);
    startPty();
  });

  socket.on('localAgent:register:denied', ({ reason }) => {
    console.error(`[agent] registration denied: ${reason}`);
    // Don't exit — a launchd/systemd-managed process that exits on a denial
    // (e.g. a momentarily-expired token before the server refreshes it)
    // would just get relaunched into the same failure. Log and keep trying.
  });

  socket.on('localAgent:input', ({ data }) => term && term.write(data));
  socket.on('localAgent:resize', ({ cols, rows }) => term && term.resize(cols, rows));
  socket.on('connect_error', (err) => console.error('[agent] connect_error:', err.message));
  socket.on('disconnect', () => console.log('[agent] disconnected, will auto-reconnect...'));
}

connect();
