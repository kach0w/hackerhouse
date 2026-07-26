/**
 * Run this on YOUR OWN machine to make your room's terminal actually be
 * your own `claude`, on your own laptop, under your own login — instead of
 * the host spawning it for you. Same account, same rate limits as your
 * normal Claude Code usage; nothing about this app's demo shares a Claude
 * account across rooms once you're running your own agent.
 *
 * Usage:
 *   HACKERHOUSE_SERVER_URL=<the host's server URL> \
 *   HACKERHOUSE_USER_ID=<your userId, same one your browser uses>  \
 *   HACKERHOUSE_SESSION_TOKEN=<your session token, logged to the browser
 *     console as "join:ok" right after you load the app>            \
 *   npm run agent --workspace server
 *
 * Start this BEFORE walking into your room in the browser — if the host
 * already spawned a fallback terminal for you first, this agent still takes
 * over for anyone who joins *after* it registers, but whoever's already
 * watching stays on the host's session until they rejoin.
 */
import 'dotenv/config';
import { io, type Socket } from 'socket.io-client';
import type { TerminalClientToServer, TerminalServerToClient } from '@hackerhouse/shared';
import { spawnClaudeOrFallback } from './pty.js';
import type { IPty } from 'node-pty';

const SERVER_URL = process.env.HACKERHOUSE_SERVER_URL;
const ROOM_ID = process.env.HACKERHOUSE_USER_ID;
const TOKEN = process.env.HACKERHOUSE_SESSION_TOKEN;

if (!SERVER_URL || !ROOM_ID || !TOKEN) {
  console.error(
    '[agent] Missing env. Need HACKERHOUSE_SERVER_URL, HACKERHOUSE_USER_ID, and ' +
      'HACKERHOUSE_SESSION_TOKEN (logged to your browser console right after the app loads).',
  );
  process.exit(1);
}

const socket: Socket<TerminalServerToClient, TerminalClientToServer> = io(`${SERVER_URL}/terminal`, {
  transports: ['websocket'],
});

let pty: IPty | null = null;

function startPty() {
  if (pty) return;
  pty = spawnClaudeOrFallback(ROOM_ID!, SERVER_URL);
  pty.onData((data) => {
    socket.emit('localAgent:output', { roomId: ROOM_ID!, data });
  });
  pty.onExit(({ exitCode }) => {
    console.log(`[agent] claude exited (code ${exitCode}) — restart this script to run it again.`);
    process.exit(0);
  });
}

socket.on('connect', () => {
  console.log(`[agent] connected, registering room ${ROOM_ID}...`);
  socket.emit('localAgent:register', { roomId: ROOM_ID!, token: TOKEN! });
});

socket.on('localAgent:registered', () => {
  console.log(`[agent] registered — your room's terminal now runs here, on your own machine.`);
  startPty();
});

socket.on('localAgent:register:denied', ({ reason }) => {
  console.error(`[agent] registration denied: ${reason}`);
  process.exit(1);
});

socket.on('localAgent:input', ({ data }) => {
  pty?.write(data);
});

socket.on('localAgent:resize', ({ cols, rows }) => {
  pty?.resize(cols, rows);
});

socket.on('connect_error', (err) => {
  console.error('[agent] connect_error:', err.message);
});
