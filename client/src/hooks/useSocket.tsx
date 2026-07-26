/**
 * The single point of contact between the world frontend and Builder A's
 * server. Nothing else in client/ calls socket.io directly.
 *
 * Talks to the real server by default. The in-browser MockServer is **opt-in**
 * via `?mock=1` — it used to be the silent fallback whenever `VITE_SERVER_URL`
 * was unset, which meant anyone without a `.env.local` got a convincing fake
 * world and no terminal, with nothing on screen saying why. Defaulting to the
 * real thing and failing loudly is the correct trade for a demo.
 *
 * Both paths satisfy `SocketLike`, so no calling code changes between them.
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

import type { Facing, JukeboxState, RoomState, User } from '@hackerhouse/shared';
import { MockServer, type SocketLike } from '../mock/mockServer';

/** Builder A throttles inbound moves; we throttle outbound to match (~18Hz). */
const MOVE_FLUSH_MS = 55;

/** Where A's server lives unless `VITE_SERVER_URL` overrides it. */
const DEFAULT_SERVER_URL = 'http://localhost:3001';

interface SocketApi {
  connected: boolean;
  /** Non-null when we cannot reach the server — surfaced in the status strip. */
  connectError: string | null;
  usingMock: boolean;
  /**
   * Express base URL, passed to Builder C's <Terminal serverUrl> and Builder
   * D's <VoiceControls serverHttpUrl>. Same origin as the socket connection.
   */
  httpBase: string;
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
  /** Shared lounge jam — null until the server's first jukebox:state arrives. */
  jukebox: JukeboxState | null;
  skipTrack: () => void;
  /** roomIds with a live terminal session (someone's claude/$SHELL pty running right now). */
  activeRooms: Set<string>;
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
  const [connectError, setConnectError] = useState<string | null>(null);
  const [jukebox, setJukebox] = useState<JukeboxState | null>(null);
  const [activeRooms, setActiveRooms] = useState<Set<string>>(new Set());

  // Mock is opt-in, never a silent fallback.
  const usingMock = new URLSearchParams(window.location.search).get('mock') === '1';
  const httpBase = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? DEFAULT_SERVER_URL;

  // Outbound move throttle: buffer the latest position, flush on an interval.
  const pendingMove = useRef<{ x: number; y: number; facing: Facing } | null>(null);
  // Signed session token from join:ok — sent back on reconnect, and needed
  // to launch your own local terminal agent (see server/src/terminal/agent.ts).
  const sessionToken = useRef<string | null>(null);

  useEffect(() => {
    const real = usingMock ? null : io(httpBase, { transports: ['websocket'] });
    const socket: SocketLike = real
      ? (real as unknown as SocketLike)
      : (new MockServer() as SocketLike);
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
    const onJukebox = (p: JukeboxState) => setJukebox(p);
    const onTerminalActive = (p: { roomId: string; active: boolean }) =>
      setActiveRooms((prev) => {
        const next = new Set(prev);
        if (p.active) next.add(p.roomId);
        else next.delete(p.roomId);
        return next;
      });
    const onJoinOk = (p: { userId: string; token: string }) => {
      if (p.userId !== identity.userId) return;
      sessionToken.current = p.token;
      // Only the owner can ever use their own token to run an agent, so
      // logging it is only actionable by the person it belongs to.
      console.log(
        `%c[hackerhouse] to run your own terminal on your own machine:\n\n` +
          `HACKERHOUSE_SERVER_URL=${httpBase} HACKERHOUSE_USER_ID=${identity.userId} ` +
          `HACKERHOUSE_SESSION_TOKEN=${p.token} npm run agent --workspace server\n`,
        'color: #7fe3c0',
      );
    };

    socket.on('presence:update', onPresence);
    socket.on('room:update', onRoom);
    socket.on('room:enter:denied', onDenied);
    socket.on('agent:done', onAgentDone);
    socket.on('jukebox:state', onJukebox);
    socket.on('terminal:active', onTerminalActive);
    socket.on('join:ok', onJoinOk);

    if (real) {
      // Re-`join` on every connect, not once at mount: after a dropped
      // connection socket.io reconnects with a new socket id, and without a
      // fresh join the server has no record of us and we vanish from presence.
      real.on('connect', () => {
        setConnected(true);
        setConnectError(null);
        // Stale entries would otherwise linger from before a reconnect — the
        // server resends a fresh snapshot right after this on its own
        // 'connection' handler, so clearing first is safe, not a flicker.
        setActiveRooms(new Set());
        socket.emit('join', { ...identity, token: sessionToken.current ?? undefined });
      });
      real.on('disconnect', () => setConnected(false));
      real.on('connect_error', (err: Error) => {
        setConnected(false);
        setConnectError(err.message || 'connection failed');
      });
    } else {
      socket.emit('join', identity);
      setConnected(true);
    }

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
      socket.off('jukebox:state', onJukebox);
      socket.off('terminal:active', onTerminalActive);
      socket.off('join:ok', onJoinOk);
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [usingMock, httpBase, identity]);

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

  const skipTrack = useCallback(() => {
    socketRef.current?.emit('jukebox:skip');
  }, []);

  const value = useMemo<SocketApi>(() => {
    const self = users.find((u) => u.userId === identity.userId);
    return {
      connected,
      connectError,
      usingMock,
      httpBase,
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
      jukebox,
      skipTrack,
      activeRooms,
    };
  }, [
    connected,
    connectError,
    usingMock,
    httpBase,
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
    jukebox,
    skipTrack,
    activeRooms,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSocket(): SocketApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSocket must be used inside <SocketProvider>');
  return ctx;
}
