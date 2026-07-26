/**
 * Match controller — owns the loop and the host/guest split.
 *
 * The host runs `step()` and broadcasts snapshots. The guest runs no physics at
 * all: it sends its paddle position and renders the last snapshot it received,
 * smoothing between them. Host-authoritative is unfashionable but it cannot
 * desync, and for a lounge minigame that's the right trade.
 *
 * Everything goes over a `Transport`, so the exact same code runs against the
 * local loopback (practice vs a bot) and against the server relay once Builder
 * A lands the `game:signal` envelope.
 */

import type { Transport } from '../transport';
import {
  botAxis,
  createState,
  movePaddle,
  setPaddle,
  step,
  type PongState,
  type Side,
} from './engine';

/** Snapshot rate. Pong state is tiny, so this can be generous. */
const SNAPSHOT_HZ = 20;
const SNAPSHOT_MS = 1000 / SNAPSHOT_HZ;

export type PongMessage =
  | { t: 'state'; s: PongState }
  | { t: 'paddle'; y: number }
  | { t: 'rematch' };

export type Role = 'host' | 'guest';

/**
 * Deterministic host election so both peers agree without a negotiation
 * round-trip: lower userId hosts.
 */
export function roleFor(selfId: string, peerId: string): Role {
  return selfId < peerId ? 'host' : 'guest';
}

export interface MatchOptions {
  role: Role;
  transport: Transport;
  /** Drive the empty seat locally — practice mode. */
  bot?: boolean;
  onState: (state: PongState) => void;
}

export class PongMatch {
  private state = createState();
  private role: Role;
  private transport: Transport;
  private bot: boolean;
  private onState: (s: PongState) => void;

  private unsubscribe: () => void;
  private raf = 0;
  private lastT = 0;
  private sinceSnapshot = 0;
  private rallySeed = 0;

  /** Local paddle intent, -1..1, set by input. */
  private axis = 0;

  constructor(opts: MatchOptions) {
    this.role = opts.role;
    this.transport = opts.transport;
    this.bot = opts.bot ?? false;
    this.onState = opts.onState;

    this.unsubscribe = this.transport.onMessage((raw) => this.receive(raw as PongMessage));
  }

  /** Which paddle the local player controls. */
  get side(): Side {
    return this.role === 'host' ? 'left' : 'right';
  }

  get snapshot(): PongState {
    return this.state;
  }

  setAxis(axis: number) {
    this.axis = Math.max(-1, Math.min(1, axis));
  }

  start() {
    this.lastT = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - this.lastT) / 1000); // clamp tab-switch spikes
      this.lastT = t;
      this.tick(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.unsubscribe();
  }

  rematch() {
    if (this.role !== 'host') {
      this.transport.send({ t: 'rematch' } satisfies PongMessage);
      return;
    }
    this.state = createState();
    this.rallySeed++;
  }

  private tick(dt: number) {
    movePaddle(this.state, this.side, this.axis, dt);

    if (this.role === 'host') {
      if (this.bot) {
        movePaddle(this.state, 'right', botAxis(this.state, 'right'), dt);
      }
      const before = this.state.countdown;
      step(this.state, dt, this.rallySeed);
      if (before > 0 && this.state.countdown === 0) this.rallySeed++;

      this.sinceSnapshot += dt * 1000;
      if (this.sinceSnapshot >= SNAPSHOT_MS) {
        this.sinceSnapshot = 0;
        this.transport.send({ t: 'state', s: this.state } satisfies PongMessage);
      }
    } else {
      // Guest: no physics. Just publish our paddle and render what we're told.
      this.sinceSnapshot += dt * 1000;
      if (this.sinceSnapshot >= SNAPSHOT_MS) {
        this.sinceSnapshot = 0;
        this.transport.send({ t: 'paddle', y: this.state.paddle.right } satisfies PongMessage);
      }
    }

    this.onState(this.state);
  }

  private receive(msg: PongMessage) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'paddle' && this.role === 'host') {
      setPaddle(this.state, 'right', msg.y);
      return;
    }

    if (msg.t === 'state' && this.role === 'guest') {
      // Keep our own paddle — ours is authoritative for input latency reasons,
      // and the host will correct it on the next snapshot anyway.
      const mine = this.state.paddle.right;
      this.state = msg.s;
      this.state.paddle.right = mine;
      return;
    }

    if (msg.t === 'rematch' && this.role === 'host') {
      this.state = createState();
      this.rallySeed++;
    }
  }
}
