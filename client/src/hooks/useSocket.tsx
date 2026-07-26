/**
 * The single point of contact between the world frontend and Builder A's
 * server. Nothing else in client/ calls socket.io directly.
 *
 * If `VITE_SERVER_URL` is set we open a real socket.io connection; otherwise we
 * fall back to the in-browser MockServer so the world is developable before A's
 * server exists. Both satisfy `SocketLike`, so no calling code changes when we
 * cut over — you just set the env var.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { io } from 'socket.io-client';

import type { Facing, RoomState, User } from '../contract';
import { MockServer, type SocketLike } from '../mock/mockServer';

/** Builder A throttles inbound moves; we throttle outbound to match (~18Hz). */
const MOVE_FLUSH_MS = 55;

interface SocketApi {
  connected: boolean;
  usingMock: boolean;
  selfId: string;
  self: User | undefined;
  users: User[];
  loungeUsers: User[];
  rooms: Map<string, RoomState>;
  /** Incremented each time our own room:enter is refused for being locked. */
  deniedRoomId: string | null;
  /** Set when an agent:done arrives for us; cleared by the character UI. */
  agentDone: { userId: string; roomId: string } | null;
  clearAgentDone: () => void;
  sendMove: (x: number, y: number, facing: Facing) => void;
  enterRoom: (roomId: string) => void;
  leaveRoom: (roomId: string) => void;
  setLocked: (locked: boolean) => void;
}

const Ctx = createContext<SocketApi | null>(null);

/** Stable per-browser identity so a refresh doesn't spawn a new person. */
function resolveIdentity(): { userId: string; name: string } {
  const params = new URLSearchParams(window.location.search);
  const nameParam = params.get('name');

  let userId = localStorage.getItem('hh.userId');
  if (!userId) {
    userId = `u-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem('hh.userId', userId);
  }

  const name = nameParam ?? localStorage.getItem('hh.name') ?? `builder-${userId.slice(2, 5)}`;
  localStorage.setItem('hh.name', name);
  return { userId, name };
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const identity = useMemo(resolveIdentity, []);
  const socketRef = useRef<SocketLike | null>(null);

  const [connected, setConnected] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [rooms, setRooms] = useState<Map<string, RoomState>>(new Map());
  const [deniedRoomId, setDeniedRoomId] = useState<string | null>(null);
  const [agentDone, setAgentDone] = useState<{ userId: string; roomId: string } | null>(null);

  const serverUrl = import.meta.env.VITE_SERVER_URL as string | undefined;
  const usingMock = !serverUrl;

  // Outbound move throttle: buffer the latest position, flush on an interval.
  const pendingMove = useRef<{ x: number; y: number; facing: Facing } | null>(null);

  useEffect(() => {
    const socket: SocketLike = serverUrl
      ? (io(serverUrl, { transports: ['websocket'] }) as unknown as SocketLike)
      : new MockServer();
    socketRef.current = socket;

    const onPresence = (p: { users: User[] }) => setUsers(p.users);
    const onRoom = (r: RoomState) =>
      setRooms((prev) => {
        const next = new Map(prev);
        next.set(r.roomId, r);
        return next;
      });
    const onDenied = (p: { roomId: string }) => setDeniedRoomId(p.roomId);
    const onAgentDone = (p: { userId: string; roomId: string }) => {
      if (p.userId === identity.userId) setAgentDone(p);
    };

    socket.on('presence:update', onPresence);
    socket.on('room:update', onRoom);
    socket.on('room:enter:denied', onDenied);
    socket.on('agent:done', onAgentDone);

    socket.emit('join', identity);
    setConnected(true);

    const flush = window.setInterval(() => {
      const m = pendingMove.current;
      if (!m) return;
      pendingMove.current = null;
      socket.emit('move', m);
    }, MOVE_FLUSH_MS);

    return () => {
      window.clearInterval(flush);
      socket.off('presence:update', onPresence);
      socket.off('room:update', onRoom);
      socket.off('room:enter:denied', onDenied);
      socket.off('agent:done', onAgentDone);
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [serverUrl, identity]);

  const sendMove = useCallback((x: number, y: number, facing: Facing) => {
    pendingMove.current = { x, y, facing };
  }, []);

  const enterRoom = useCallback((roomId: string) => {
    setDeniedRoomId(null);
    socketRef.current?.emit('room:enter', { roomId });
  }, []);

  const leaveRoom = useCallback((roomId: string) => {
    socketRef.current?.emit('room:leave', { roomId });
  }, []);

  const setLocked = useCallback((locked: boolean) => {
    socketRef.current?.emit('room:lock', { locked });
  }, []);

  const clearAgentDone = useCallback(() => setAgentDone(null), []);

  const value = useMemo<SocketApi>(() => {
    const self = users.find((u) => u.userId === identity.userId);
    return {
      connected,
      usingMock,
      selfId: identity.userId,
      self,
      users,
      loungeUsers: users.filter((u) => u.state === 'lounge'),
      rooms,
      deniedRoomId,
      agentDone,
      clearAgentDone,
      sendMove,
      enterRoom,
      leaveRoom,
      setLocked,
    };
  }, [
    connected,
    usingMock,
    identity.userId,
    users,
    rooms,
    deniedRoomId,
    agentDone,
    clearAgentDone,
    sendMove,
    enterRoom,
    leaveRoom,
    setLocked,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSocket(): SocketApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSocket must be used inside <SocketProvider>');
  return ctx;
}
