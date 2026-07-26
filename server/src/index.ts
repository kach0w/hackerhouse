import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import http from 'http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@hackerhouse/shared';
import { registerPresenceHandlers, getUserState, emitAgentDone } from './state/socket.js';
import { createVoiceRouter } from './voice/routes.js';
import { createNotifyRouter } from './notify/routes.js';
import { registerTerminalNamespace } from './terminal/socket.js';
import { registerJukebox } from './jukebox/state.js';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? '*';

// server/src/index.ts -> repo root (where local-agent/ and .claude/ live).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Served so the one-time install command (curl $ORIGIN/agent/install.sh |
// bash -s -- $ORIGIN $ROOM_ID $TOKEN) can fetch the local terminal-agent
// companion — this app never runs the companion itself, it only hands
// visitors the files to run on their own machine. /agent/hooks re-serves
// the same Stop hook the host-spawned pty installs (terminal/pty.ts), so
// there's one source of truth for the hook script's contents.
app.use('/agent', express.static(path.join(REPO_ROOT, 'local-agent')));
app.use('/agent/hooks', express.static(path.join(REPO_ROOT, '.claude/hooks')));

const httpServer = http.createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
});

registerPresenceHandlers(io);

app.use(createVoiceRouter());
app.use(createNotifyRouter({ getUserState, emitAgentDone }));

registerTerminalNamespace(io);
registerJukebox(io);

httpServer.listen(PORT, () => {
  console.log(`server listening on :${PORT}`);
});
