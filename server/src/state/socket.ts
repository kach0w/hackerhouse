import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  User,
  RoomState,
} from '@hackerhouse/shared';

interface SocketData {
  userId?: string;
}

type HHServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type HHSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const MOVE_FLUSH_HZ = 20;
const MOVE_FLUSH_INTERVAL_MS = 1000 / MOVE_FLUSH_HZ;

const users = new Map<string, User>();
const rooms = new Map<string, RoomState>();

let presenceDirty = false;
let ioRef: HHServer | undefined;

function ensureRoom(ownerId: string): RoomState {
  let room = rooms.get(ownerId);
  if (!room) {
    room = { roomId: ownerId, ownerId, locked: false, occupants: [] };
    rooms.set(ownerId, room);
  }
  return room;
}

function broadcastPresence(io: HHServer): void {
  io.emit('presence:update', { users: Array.from(users.values()) });
}

function broadcastRoom(io: HHServer, roomId: string): void {
  const room = rooms.get(roomId);
  if (room) io.emit('room:update', room);
}

/** Server-internal accessor for Builder D's /notify handler. */
export function getUserState(userId: string): User | undefined {
  return users.get(userId);
}

/** For Builder D's /notify handler — emits agent:done on the main namespace. */
export function emitAgentDone(payload: { userId: string; roomId: string }): void {
  ioRef?.emit('agent:done', payload);
}

export function registerPresenceHandlers(io: HHServer): void {
  ioRef = io;

  setInterval(() => {
    if (presenceDirty) {
      broadcastPresence(io);
      presenceDirty = false;
    }
  }, MOVE_FLUSH_INTERVAL_MS);

  io.on('connection', (socket: HHSocket) => {
    socket.on('join', ({ userId, name }) => {
      socket.data.userId = userId;

      const existing = users.get(userId);
      users.set(userId, {
        userId,
        name,
        state: existing?.state ?? 'lounge',
        x: existing?.x ?? 0,
        y: existing?.y ?? 0,
        roomId: existing?.roomId ?? null,
      });
      ensureRoom(userId);

      broadcastPresence(io);
      broadcastRoom(io, userId);
    });

    socket.on('move', ({ x, y }) => {
      const userId = socket.data.userId;
      if (!userId) return;
      const user = users.get(userId);
      if (!user) return;
      user.x = x;
      user.y = y;
      presenceDirty = true;
    });

    socket.on('room:enter', ({ roomId }) => {
      const userId = socket.data.userId;
      if (!userId) return;
      const user = users.get(userId);
      const room = rooms.get(roomId);
      if (!user || !room) return;

      if (room.locked && room.ownerId !== userId) {
        socket.emit('room:enter:denied', { roomId, reason: 'locked' });
        return;
      }

      user.state = 'room';
      user.roomId = roomId;
      if (room.ownerId !== userId && !room.occupants.includes(userId)) {
        room.occupants.push(userId);
      }

      broadcastPresence(io);
      broadcastRoom(io, roomId);
    });

    socket.on('room:leave', ({ roomId }) => {
      const userId = socket.data.userId;
      if (!userId) return;
      const user = users.get(userId);
      const room = rooms.get(roomId);
      if (!user) return;

      user.state = 'lounge';
      user.roomId = null;
      if (room) {
        room.occupants = room.occupants.filter((id) => id !== userId);
      }

      broadcastPresence(io);
      if (room) broadcastRoom(io, roomId);
    });

    socket.on('room:lock', ({ locked }) => {
      const userId = socket.data.userId;
      if (!userId) return;
      const room = rooms.get(userId);
      if (!room || room.ownerId !== userId) return;

      room.locked = locked;
      broadcastRoom(io, userId);
    });

    socket.on('disconnect', () => {
      const userId = socket.data.userId;
      if (!userId) return;

      users.delete(userId);
      for (const room of rooms.values()) {
        const before = room.occupants.length;
        room.occupants = room.occupants.filter((id) => id !== userId);
        if (room.occupants.length !== before) {
          broadcastRoom(io, room.roomId);
        }
      }

      broadcastPresence(io);
    });
  });
}
