import type { User, RoomState, Facing, JukeboxState, JukeboxTrack } from './types';

// ---- Client -> Server (main namespace) ----
export interface ClientToServerEvents {
  // `token` is optional so a first-time visitor can still claim a fresh
  // `userId`; if present and valid it's the authoritative identity (the
  // client-supplied `userId` is ignored in that case). See join:ok below.
  join: (payload: { userId: string; name: string; token?: string }) => void;
  move: (payload: { x: number; y: number; facing: Facing }) => void;
  'room:enter': (payload: { roomId: string }) => void;
  'room:leave': (payload: { roomId: string }) => void;
  'room:lock': (payload: { locked: boolean }) => void; // only affects your own room
  'jukebox:skip': () => void; // shared lounge jam, anyone can skip
}

// ---- Server -> Client (main namespace) ----
export interface ServerToClientEvents {
  'presence:update': (payload: { users: User[] }) => void;
  'room:update': (payload: RoomState) => void;
  'room:enter:denied': (payload: { roomId: string; reason: 'locked' }) => void;
  'agent:done': (payload: { userId: string; roomId: string }) => void;
  'jukebox:state': (payload: JukeboxState) => void;
  // Signed session token minted (or reconfirmed) on join. Persist it
  // client-side (e.g. localStorage) and send it back as `join`'s `token` on
  // reconnect, and on the `/terminal` handshake and `/notify`, instead of a
  // bare claimed userId. See server/src/state/socket.ts `verifySession`.
  'join:ok': (payload: { userId: string; token: string }) => void;
}

// ---- Terminal namespace ("/terminal") ----
export interface TerminalClientToServer {
  'terminal:join': (payload: { roomId: string; role: 'owner' | 'visitor' }) => void;
  'terminal:input': (payload: { roomId: string; data: string }) => void; // dropped server-side if not owner
  'terminal:resize': (payload: { roomId: string; cols: number; rows: number }) => void;
}
export interface TerminalServerToClient {
  'terminal:output': (payload: { roomId: string; data: string }) => void;
  'terminal:ready': (payload: { roomId: string }) => void;
}

// ---- HTTP ----
// POST /notify        body: { userId: string }              — from the Claude Code Stop hook
// POST /voice/token    body: { identity: string; room: string } -> { token: string }

export type { User, RoomState, Facing, JukeboxState, JukeboxTrack };
