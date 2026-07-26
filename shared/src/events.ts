import { User, RoomState } from './types';

// ---- Client -> Server (main namespace) ----
export interface ClientToServerEvents {
  join: (payload: { userId: string; name: string }) => void;
  move: (payload: { x: number; y: number; facing: 'up' | 'down' | 'left' | 'right' }) => void;
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
// POST /notify        body: { userId: string }              — from the Claude Code Stop hook
// POST /voice/token    body: { identity: string; room: string } -> { token: string }

export { User, RoomState };
