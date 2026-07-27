import type { Server, Socket } from 'socket.io';
import type {
  TerminalClientToServer,
  TerminalServerToClient,
} from '@hackerhouse/shared';
import { getActiveRoomIds, getOrCreateSession, getSession } from './pty.js';
import { verifySession } from '../state/socket.js';

type TSocket = Socket<TerminalClientToServer, TerminalServerToClient>;

const BUFFER_CAP = 10_000;

/**
 * Ownership check. Write access to a room's PTY is a shell on the host, so it
 * is gated on a *signed* session token — never on a claimed userId.
 *
 * This used to compare `handshake.auth.userId` to the roomId. That was
 * trivially forgeable: `presence:update` broadcasts every user's userId to
 * everyone, so any visitor could read a victim's id straight off the wire,
 * reconnect claiming it, and get arbitrary command execution on the machine
 * hosting the server. The token is unforgeable without SESSION_SECRET.
 */
function isOwnerOf(socket: Socket, roomId: string): boolean {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) return false;
  const verified = verifySession(token);
  return !!verified && verified.userId === roomId;
}

export function registerTerminalNamespace(io: Server) {
  const nsp = io.of('/terminal');

  // roomId -> the connected local agent's socket, when that room's owner is
  // running `claude` on their own machine instead of the host spawning it.
  const agents = new Map<string, TSocket>();
  // roomId -> capped buffer of what an agent has streamed, so a late-joining
  // browser sees the current screen. Mirrors pty.ts's own buffer, just fed
  // by the agent instead of a host-local PTY.
  const relayBuffers = new Map<string, string>();

  function appendRelayBuffer(roomId: string, chunk: string) {
    const buf = (relayBuffers.get(roomId) ?? '') + chunk;
    relayBuffers.set(roomId, buf.slice(-BUFFER_CAP));
  }

  // Main-namespace connection (separate socket from /terminal entirely) —
  // send whoever just loaded the app a snapshot of already-running sessions
  // (both host-spawned and agent-relayed), since terminal:active deltas
  // alone would miss anything started before they connected.
  io.on('connection', (socket) => {
    for (const roomId of new Set([...getActiveRoomIds(), ...agents.keys()])) {
      socket.emit('terminal:active', { roomId, active: true });
    }
  });

  nsp.on('connection', (socket: TSocket) => {
    let joinedRoomId: string | null = null;
    let owner = false;
    let agentRoomId: string | null = null;

    socket.on('terminal:join', ({ roomId }) => {
      joinedRoomId = roomId;
      owner = isOwnerOf(socket, roomId);
      socket.join(roomId);

      const agent = agents.get(roomId);
      if (agent) {
        // Relayed mode: the owner's own machine is the real backend — no
        // host-spawned pty for this room at all.
        socket.emit('terminal:ready', { roomId });
        const buf = relayBuffers.get(roomId);
        if (buf) socket.emit('terminal:output', { roomId, data: buf });
        return;
      }

      // Fallback: host spawns/owns the pty itself, same as always. If an
      // agent registers *after* this point for the same room, new joiners
      // switch to relayed mode above but this session keeps running — two
      // backends can only coexist if someone starts the agent after already
      // being in the room. Start the agent before walking in to avoid that.
      //
      // terminal:active broadcasts on the MAIN namespace (not /terminal) —
      // the lounge roster lives there, not here.
      const isNewSession = !getSession(roomId);
      const session = getOrCreateSession(
        roomId,
        (data) => {
          nsp.to(roomId).emit('terminal:output', { roomId, data });
        },
        () => io.emit('terminal:active', { roomId, active: false }),
      );
      if (isNewSession) {
        io.emit('terminal:active', { roomId, active: true });
      }

      socket.emit('terminal:ready', { roomId });
      if (session.buffer) {
        socket.emit('terminal:output', { roomId, data: session.buffer });
      }
    });

    socket.on('terminal:input', ({ roomId, data }) => {
      if (!owner || roomId !== joinedRoomId) return; // silently drop, no error leak
      const agent = agents.get(roomId);
      if (agent) {
        agent.emit('localAgent:input', { roomId, data });
        return;
      }
      getSession(roomId)?.pty.write(data);
    });

    socket.on('terminal:resize', ({ roomId, cols, rows }) => {
      if (!owner || roomId !== joinedRoomId) return;
      const agent = agents.get(roomId);
      if (agent) {
        agent.emit('localAgent:resize', { roomId, cols, rows });
        return;
      }
      getSession(roomId)?.pty.resize(cols, rows);
    });

    // --- Local agent side of the same namespace ---------------------------

    socket.on('localAgent:register', ({ roomId, token }) => {
      const verified = verifySession(token);
      if (!verified || verified.userId !== roomId) {
        socket.emit('localAgent:register:denied', { roomId, reason: 'invalid or mismatched token' });
        return;
      }
      if (agents.has(roomId)) {
        socket.emit('localAgent:register:denied', { roomId, reason: 'an agent is already registered for this room' });
        return;
      }
      agentRoomId = roomId;
      agents.set(roomId, socket);
      relayBuffers.delete(roomId); // fresh session, drop any stale buffer
      socket.emit('localAgent:registered', { roomId });
      io.emit('terminal:active', { roomId, active: true });
    });

    socket.on('localAgent:output', ({ roomId, data }) => {
      if (agentRoomId !== roomId) return;
      appendRelayBuffer(roomId, data);
      nsp.to(roomId).emit('terminal:output', { roomId, data });
    });

    socket.on('disconnect', () => {
      if (agentRoomId && agents.get(agentRoomId) === socket) {
        agents.delete(agentRoomId);
        relayBuffers.delete(agentRoomId);
        io.emit('terminal:active', { roomId: agentRoomId, active: false });
      }
    });

    // Deliberately not killing a host-spawned pty on disconnect: the whole
    // point of the app is that navigating Room -> Lounge survives your agent
    // run. Same principle applies to a local agent — it's a separate
    // process the user controls directly, disconnecting the browser socket
    // has no bearing on it.
  });
}
