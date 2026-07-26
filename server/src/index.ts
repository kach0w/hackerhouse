import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@hackerhouse/shared';
import { registerPresenceHandlers, getUserState, emitAgentDone } from './state/socket.js';
import { createVoiceRouter } from './voice/routes.js';
import { createNotifyRouter } from './notify/routes.js';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? '*';

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const httpServer = http.createServer(app);

export const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
});

registerPresenceHandlers(io);

app.use(createVoiceRouter());
app.use(createNotifyRouter({ getUserState, emitAgentDone }));

// Builder C mounts the /terminal namespace here once server/src/terminal/socket.ts exists:
//   import { registerTerminalNamespace } from './terminal/socket.js';
//   registerTerminalNamespace(io);

httpServer.listen(PORT, () => {
  console.log(`server listening on :${PORT}`);
});
