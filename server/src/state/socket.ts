import crypto from 'node:crypto';
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

// Grace period a disconnected user's presence/room state survives for,
// so a page refresh or brief network drop doesn't wipe their position.
// Overridable so verify.ts doesn't have to sleep 30s to exercise the sweep.
const DISCONNECT_GRACE_MS = Number(process.env.DISCONNECT_GRACE_MS) || 30_000;

const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-insecure-session-secret';
if (!process.env.SESSION_SECRET) {
  console.warn(
    '[state] SESSION_SECRET not set — using an insecure default. Fine for a local demo, not for anything exposed.',
  );
}
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const users = new Map<string, User>();
const rooms = new Map<string, RoomState>();

// Tracks which socket.id is currently "live" for a given userId, so a stale
// socket's disconnect (e.g. after a browser refresh reconnects on a new
// socket) can't clobber state that the new socket already re-registered.
const activeSockets = new Map<string, string>();

// userId -> pending sweep timer, set when that user's last socket
// disconnects. Cleared if they reconnect within DISCONNECT_GRACE_MS.
const pendingSweeps = new Map<string, ReturnType<typeof setTimeout>>();

let presenceDirty = false;
let ioRef: HHServer | undefined;

function sign(payload: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
}

/** Mints a signed, expiring session token binding a socket to a userId. */
export function mintSessionToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ userId, expires: Date.now() + SESSION_TTL_MS })).toString(
    'base64url',
  );
  return `${payload}.${sign(payload)}`;
}

/**
 * Verifies a session token minted by `mintSessionToken`. Returns the bound
 * userId if the signature is valid and the token hasn't expired, else null.
 * Exported for other namespaces/routes (terminal handshake, /notify,
 * /voice/token) to authenticate a claimed identity instead of trusting a
 * bare client-supplied userId.
 */
export function verifySession(token: string): { userId: string } | null {
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expectedSignature = sign(payload);

  const signatureBuf = Buffer.from(signature, 'hex');
  const expectedBuf = Buffer.from(expectedSignature, 'hex');
  if (signatureBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(signatureBuf, expectedBuf)) {
    return null;
  }

  let parsed: { userId?: unknown; expires?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed.userId !== 'string' || typeof parsed.expires !== 'number') return null;
  if (Date.now() > parsed.expires) return null;

  return { userId: parsed.userId };
}

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

/**
 * Finalizes a disconnected user once their grace period has elapsed without
 * a reconnect: drops their presence, clears them out of any room they were
 * visiting, and — if they owned a room — tears that room down and sends
 * anyone still inside it back to the lounge.
 */
function sweepUser(io: HHServer, userId: string): void {
  pendingSweeps.delete(userId);
  // A new socket claimed this userId while the timer was pending — not stale.
  if (activeSockets.has(userId)) return;

  users.delete(userId);

  for (const room of rooms.values()) {
    const before = room.occupants.length;
    room.occupants = room.occupants.filter((id) => id !== userId);
    if (room.occupants.length !== before) {
      broadcastRoom(io, room.roomId);
    }
  }

  const ownedRoom = rooms.get(userId);
  if (ownedRoom) {
    rooms.delete(userId);
    for (const occupantId of ownedRoom.occupants) {
      const occupant = users.get(occupantId);
      if (occupant) {
        occupant.state = 'lounge';
        occupant.roomId = null;
      }
    }
  }

  broadcastPresence(io);
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
    socket.on('join', ({ userId: claimedUserId, name, token }) => {
      // A valid token is authoritative — it proves this socket already owns
      // that identity, so the claimed userId in the payload is ignored. No
      // token (or an invalid/expired one) means "first time claiming this
      // userId", which is trusted as-is (no login system, trusted-group demo).
      const verified = token ? verifySession(token) : null;
      const userId = verified?.userId ?? claimedUserId;

      socket.data.userId = userId;
      activeSockets.set(userId, socket.id);

      const pending = pendingSweeps.get(userId);
      if (pending) {
        clearTimeout(pending);
        pendingSweeps.delete(userId);
      }

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

      const sessionToken = verified ? (token as string) : mintSessionToken(userId);
      socket.emit('join:ok', { userId, token: sessionToken });

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

    socket.on('room:leave', () => {
      const userId = socket.data.userId;
      if (!userId) return;
      const user = users.get(userId);
      if (!user) return;

      user.state = 'lounge';
      // Broadcasts the room the user was actually in (leaveCurrentRoom reads
      // user.roomId) rather than whatever roomId the client claims — those
      // can disagree if the client's local state is stale.
      leaveCurrentRoom(io, userId, user);

      broadcastPresence(io);
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

      // Don't wipe state immediately — give them DISCONNECT_GRACE_MS to
      // reconnect (refresh, brief network drop) with x/y/state/roomId intact.
      // `join`'s pending-sweep check cancels this if they come back in time.
      const timer = setTimeout(() => sweepUser(io, userId), DISCONNECT_GRACE_MS);
      pendingSweeps.set(userId, timer);
    });
  });
}
