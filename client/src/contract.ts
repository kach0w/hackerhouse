/**
 * ⚠️ TEMPORARY — mirrors `shared/src/types.ts` + `shared/src/events.ts` verbatim
 * from ENGINEERING_PLAN.md §2.
 *
 * Builder A owns the real contract. This file exists only so Builder B can build
 * before A's monorepo skeleton lands. The moment `shared/` is pushed, delete the
 * bodies below and replace this whole file with:
 *
 *     export * from '@hackerhouse/shared/events';
 *     export * from '@hackerhouse/shared/types';
 *
 * Everything in client/ imports from THIS file and nowhere else, so that swap is
 * a one-file change. Do not import contract types directly from anywhere else.
 */

// ---------------------------------------------------------------------------
// types.ts
// ---------------------------------------------------------------------------

export type UserState = 'lounge' | 'room';

export type Facing = 'up' | 'down' | 'left' | 'right';

export interface User {
  userId: string;
  name: string;
  state: UserState;
  x: number;
  y: number;
  roomId: string | null; // set when state === 'room'
}

export interface RoomState {
  roomId: string; // == owner's userId
  ownerId: string;
  locked: boolean;
  occupants: string[]; // userIds currently visiting (excludes owner)
}

// ---------------------------------------------------------------------------
// events.ts
// ---------------------------------------------------------------------------

// ---- Client -> Server (main namespace) ----
export interface ClientToServerEvents {
  join: (payload: { userId: string; name: string }) => void;
  move: (payload: { x: number; y: number; facing: Facing }) => void;
  'room:enter': (payload: { roomId: string }) => void;
  'room:leave': (payload: { roomId: string }) => void;
  'room:lock': (payload: { locked: boolean }) => void; // only affects your own room
}

// ---- Server -> Client (main namespace) ----
export interface ServerToClientEvents {
  'presence:update': (payload: { users: User[] }) => void;
  'room:update': (payload: RoomState) => void;
  'room:enter:denied': (payload: { roomId: string; reason: 'locked' }) => void;
  'agent:done': (payload: { userId: string; roomId: string }) => void;
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
// POST /notify         body: { userId: string }                       — from the Claude Code Stop hook
// POST /voice/token    body: { identity: string; room: string } -> { token: string }
