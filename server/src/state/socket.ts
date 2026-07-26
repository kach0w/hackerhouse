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

// Tracks which socket.id is currently "live" for a given userId, so a stale
// socket's disconnect (e.g. after a browser refresh reconnects on a new
// socket) can't clobber state that the new socket already re-registered.
const activeSockets = new Map<string, string>();

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

/** Removes a user from whichever room they currently occupy (if any), leaving `users` untouched. */
function leaveCurrentRoom(io: HHServer, userId: string, user: User): void {
  if (!user.roomId) return;
  const previousRoom = rooms.get(user.roomId);
  if (previousRoom) {
    const before = previousRoom.occupants.length;
    previousRoom.occupants = previousRoom.occupants.filter((id) => id !== userId);
    if (previousRoom.occupants.length !== before) {
      broadcastRoom(io, previousRoom.roomId);
    }
  }
  user.roomId = null;
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
      activeSockets.set(userId, socket.id);

      const existing = users.get(userId);
      users.set(userId, {
        userId,
        name,
        state: existing?.state ?? 'lounge',
        x: existing?.x ?? 0,
        y: existing?.y ?? 0,
        facing: existing?.facing ?? 'down',
        roomId: existing?.roomId ?? null,
      });
      ensureRoom(userId);

      broadcastPresence(io);
      broadcastRoom(io, userId);
    });

    socket.on('move', ({ x, y, facing }) => {
      const userId = socket.data.userId;
      if (!userId) return;
      const user = users.get(userId);
      if (!user) return;
      user.x = x;
      user.y = y;
      user.facing = facing;
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

      if (user.roomId && user.roomId !== roomId) {
        leaveCurrentRoom(io, userId, user);
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
      if (!user) return;

      user.state = 'lounge';
      leaveCurrentRoom(io, userId, user);

      broadcastPresence(io);
      broadcastRoom(io, roomId);
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
      // A newer socket already re-registered for this userId (reconnect) —
      // this disconnect is for the stale connection, don't tear down live state.
      if (activeSockets.get(userId) !== socket.id) return;

      activeSockets.delete(userId);
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
