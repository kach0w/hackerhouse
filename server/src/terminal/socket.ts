import type { Server, Socket } from 'socket.io';
import type {
  TerminalClientToServer,
  TerminalServerToClient,
} from '@hackerhouse/shared';
import { getActiveRoomIds, getOrCreateSession, getSession } from './pty.js';

/**
 * Ownership check: the room owner is whoever connects with
 * `auth.userId === roomId` (the same userId they used to `join` on the main
 * namespace — roomId === ownerId by convention across the app). We never
 * trust the client's claimed `role`, only this handshake value.
 */
function isOwnerOf(socket: Socket, roomId: string): boolean {
  const userId = socket.handshake.auth?.userId as string | undefined;
  return !!userId && userId === roomId;
}

export function registerTerminalNamespace(io: Server) {
  const nsp = io.of('/terminal');

  // Main-namespace connection (separate socket from /terminal entirely) —
  // send whoever just loaded the app a snapshot of already-running sessions,
  // since terminal:active deltas alone would miss anything started earlier.
  io.on('connection', (socket) => {
    for (const roomId of getActiveRoomIds()) {
      socket.emit('terminal:active', { roomId, active: true });
    }
  });

  nsp.on(
    'connection',
    (socket: Socket<TerminalClientToServer, TerminalServerToClient>) => {
      let joinedRoomId: string | null = null;
      let owner = false;

      socket.on('terminal:join', ({ roomId }) => {
        joinedRoomId = roomId;
        owner = isOwnerOf(socket, roomId);
        socket.join(roomId);

        // Broadcast on the MAIN namespace (not /terminal) — the lounge
        // roster lives there, not here.
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
        getSession(roomId)?.pty.write(data);
      });

      socket.on('terminal:resize', ({ roomId, cols, rows }) => {
        if (!owner || roomId !== joinedRoomId) return;
        getSession(roomId)?.pty.resize(cols, rows);
      });

      // Deliberately not killing the pty on disconnect: the whole point of
      // the app is that navigating Room -> Lounge survives your agent run.
      // The pty only goes away when the underlying process exits on its own.
    }
  );
}
