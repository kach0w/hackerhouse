/**
 * ⚠️ TEMPORARY — in-browser stand-in for Builder A's server.
 *
 * Mirrors the handler semantics from ENGINEERING_PLAN.md §"Builder A" (join,
 * move, room:enter with lock check, room:leave, room:lock, presence broadcast)
 * so the world frontend is fully developable before the real server is live.
 *
 * The bots here run the same `AmbientController` the real client runs, so the
 * lounge is populated and the station/slot logic gets exercised in solo dev.
 *
 * Delete this whole directory once A's server is up. Nothing in world/ imports
 * it directly — `useSocket` picks between this and a real socket.io connection.
 */

import type {
  ClientToServerEvents,
  Facing,
  RoomState,
  ServerToClientEvents,
  User,
} from '../contract';
import { AmbientController } from '../world/ambient';
import { LOUNGE_PX_W, clampToFloor } from '../world/layout';

type Handler = (payload: never) => void;

/** The subset of socket.io's Socket surface that client code actually touches. */
export interface SocketLike {
  connected: boolean;
  on<E extends keyof ServerToClientEvents>(ev: E, fn: ServerToClientEvents[E]): void;
  off<E extends keyof ServerToClientEvents>(ev: E, fn: ServerToClientEvents[E]): void;
  emit<E extends keyof ClientToServerEvents>(
    ev: E,
    ...args: Parameters<ClientToServerEvents[E]>
  ): void;
  disconnect(): void;
}

/** Bots so the lounge isn't empty during solo dev. One locks their room, one doesn't. */
const BOTS: { userId: string; name: string; locked: boolean }[] = [
  { userId: 'bot-nova', name: 'nova', locked: false },
  { userId: 'bot-pixel', name: 'pixel', locked: true },
  { userId: 'bot-ash', name: 'ash', locked: false },
];

const TICK_MS = 1000 / 15;

export class MockServer implements SocketLike {
  connected = true;

  private handlers = new Map<string, Set<Handler>>();
  private users = new Map<string, User>();
  private rooms = new Map<string, RoomState>();
  private ambient = new Map<string, AmbientController>();
  private selfId = '';
  private timer: number | null = null;

  constructor() {
    BOTS.forEach((bot, i) => {
      this.users.set(bot.userId, {
        userId: bot.userId,
        name: bot.name,
        state: 'lounge',
        x: 120 + i * 110,
        y: 150 + i * 45,
        roomId: null,
      });
      this.rooms.set(bot.userId, {
        roomId: bot.userId,
        ownerId: bot.userId,
        locked: bot.locked,
        occupants: [],
      });
      this.ambient.set(bot.userId, new AmbientController(bot.userId));
    });

    this.timer = window.setInterval(() => this.tickBots(), TICK_MS);
    this.installDevHelpers();
  }

  // --- SocketLike ------------------------------------------------------------

  on<E extends keyof ServerToClientEvents>(ev: E, fn: ServerToClientEvents[E]): void {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev)!.add(fn as Handler);
  }

  off<E extends keyof ServerToClientEvents>(ev: E, fn: ServerToClientEvents[E]): void {
    this.handlers.get(ev)?.delete(fn as Handler);
  }

  emit<E extends keyof ClientToServerEvents>(
    ev: E,
    ...args: Parameters<ClientToServerEvents[E]>
  ): void {
    const payload = args[0] as never;
    switch (ev) {
      case 'join':
        return this.onJoin(payload as { userId: string; name: string });
      case 'move':
        return this.onMove(payload as { x: number; y: number; facing: Facing });
      case 'room:enter':
        return this.onRoomEnter((payload as { roomId: string }).roomId);
      case 'room:leave':
        return this.onRoomLeave();
      case 'room:lock':
        return this.onRoomLock((payload as { locked: boolean }).locked);
    }
  }

  disconnect(): void {
    this.connected = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.handlers.clear();
  }

  // --- Handlers (mirror Builder A's spec) ------------------------------------

  private onJoin(p: { userId: string; name: string }) {
    this.selfId = p.userId;
    this.users.set(p.userId, {
      userId: p.userId,
      name: p.name,
      state: 'lounge',
      x: LOUNGE_PX_W / 2,
      y: 210,
      roomId: null,
    });
    if (!this.rooms.has(p.userId)) {
      this.rooms.set(p.userId, {
        roomId: p.userId,
        ownerId: p.userId,
        locked: false,
        occupants: [],
      });
    }
    this.broadcastPresence();
    for (const room of this.rooms.values()) this.deliver('room:update', room);
  }

  private onMove(p: { x: number; y: number; facing: Facing }) {
    const me = this.users.get(this.selfId);
    if (!me) return;
    const { x, y } = clampToFloor(p.x, p.y);
    me.x = x;
    me.y = y;
    this.broadcastPresence();
  }

  private onRoomEnter(roomId: string) {
    const room = this.rooms.get(roomId);
    const me = this.users.get(this.selfId);
    if (!room || !me) return;

    if (room.locked && room.ownerId !== this.selfId) {
      this.deliver('room:enter:denied', { roomId, reason: 'locked' });
      return;
    }
    me.state = 'room';
    me.roomId = roomId;
    if (room.ownerId !== this.selfId && !room.occupants.includes(this.selfId)) {
      room.occupants.push(this.selfId);
    }
    this.broadcastPresence();
    this.deliver('room:update', room);
  }

  private onRoomLeave() {
    const me = this.users.get(this.selfId);
    if (!me?.roomId) return;
    const room = this.rooms.get(me.roomId);
    if (room) {
      room.occupants = room.occupants.filter((id) => id !== this.selfId);
      this.deliver('room:update', room);
    }
    me.state = 'lounge';
    me.roomId = null;
    this.broadcastPresence();
  }

  private onRoomLock(locked: boolean) {
    const room = this.rooms.get(this.selfId); // roomId === ownerId
    if (!room) return;
    room.locked = locked;
    this.deliver('room:update', room);
  }

  // --- Bots ------------------------------------------------------------------

  private tickBots() {
    const dt = TICK_MS / 1000;
    const lounge = [...this.users.values()].filter((u) => u.state === 'lounge');
    let moved = false;

    for (const bot of BOTS) {
      const u = this.users.get(bot.userId);
      const ai = this.ambient.get(bot.userId);
      if (!u || !ai || u.state !== 'lounge') continue;

      const peers = lounge.filter((o) => o.userId !== bot.userId);
      const out = ai.tick(dt, { x: u.x, y: u.y }, peers);
      if (out.x !== u.x || out.y !== u.y) moved = true;
      u.x = out.x;
      u.y = out.y;
    }
    if (moved) this.broadcastPresence();
  }

  // --- Plumbing --------------------------------------------------------------

  private broadcastPresence() {
    this.deliver('presence:update', { users: [...this.users.values()].map((u) => ({ ...u })) });
  }

  private deliver<E extends keyof ServerToClientEvents>(
    ev: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ) {
    for (const fn of this.handlers.get(ev) ?? []) (fn as (p: unknown) => void)(payload);
  }

  /**
   * Dev helpers on `window.__hh` — the mock has no `/notify` route, so this is
   * how you exercise the agent-done character before Builder D's hook exists.
   */
  private installDevHelpers() {
    (window as unknown as { __hh: unknown }).__hh = {
      agentDone: () => this.deliver('agent:done', { userId: this.selfId, roomId: this.selfId }),
      lockBot: (id: string, locked: boolean) => {
        const r = this.rooms.get(id);
        if (r) {
          r.locked = locked;
          this.deliver('room:update', r);
        }
      },
      /** Drop a bot into your room so you can see visitor avatars render. */
      visitMe: (id = 'bot-nova') => {
        const bot = this.users.get(id);
        const room = this.rooms.get(this.selfId);
        if (!bot || !room) return;
        bot.state = 'room';
        bot.roomId = this.selfId;
        if (!room.occupants.includes(id)) room.occupants.push(id);
        this.broadcastPresence();
        this.deliver('room:update', room);
      },
    };
  }
}
