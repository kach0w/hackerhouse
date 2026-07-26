/**
 * Air hockey match controller. Same host-authoritative shape as pong: the host
 * simulates and broadcasts snapshots, the guest sends only its mallet position.
 *
 * Kept as a sibling of pong's controller rather than a shared abstraction —
 * two games isn't enough evidence to know what the right abstraction is, and
 * the duplication is about thirty lines.
 */

import type { Transport } from '../transport';
import {
  botAxis,
  createState,
  moveMallet,
  recordMalletPositions,
  setMallet,
  step,
  type AirHockeyState,
  type Side,
} from './engine';

const SNAPSHOT_HZ = 20;
const SNAPSHOT_MS = 1000 / SNAPSHOT_HZ;

export type AirHockeyMessage =
  | { t: 'state'; s: AirHockeyState }
  | { t: 'mallet'; x: number }
  | { t: 'rematch' };

export type Role = 'host' | 'guest';

export interface MatchOptions {
  role: Role;
  transport: Transport;
  bot?: boolean;
  onState: (state: AirHockeyState) => void;
}

export class AirHockeyMatch {
  private state = createState();
  private role: Role;
  private transport: Transport;
  private bot: boolean;
  private onState: (s: AirHockeyState) => void;

  private unsubscribe: () => void;
  private raf = 0;
  private lastT = 0;
  private sinceSnapshot = 0;
  private seed = 0;
  private axis = 0;

  constructor(opts: MatchOptions) {
    this.role = opts.role;
    this.transport = opts.transport;
    this.bot = opts.bot ?? false;
    this.onState = opts.onState;
    this.unsubscribe = this.transport.onMessage((raw) =>
      this.receive(raw as AirHockeyMessage),
    );
  }

  /** The host plays the bottom mallet; the guest plays the top. */
  get side(): Side {
    return this.role === 'host' ? 'bottom' : 'top';
  }

  get snapshot(): AirHockeyState {
    return this.state;
  }

  setAxis(axis: number) {
    this.axis = Math.max(-1, Math.min(1, axis));
  }

  start() {
    this.lastT = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - this.lastT) / 1000);
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
      this.transport.send({ t: 'rematch' } satisfies AirHockeyMessage);
      return;
    }
    this.state = createState();
    this.seed++;
  }

  private tick(dt: number) {
    moveMallet(this.state, this.side, this.axis, dt);

    if (this.role === 'host') {
      if (this.bot) moveMallet(this.state, 'top', botAxis(this.state, 'top'), dt);

      const before = this.state.countdown;
      step(this.state, dt, this.seed);
      recordMalletPositions(this.state);
      if (before > 0 && this.state.countdown === 0) this.seed++;

      this.sinceSnapshot += dt * 1000;
      if (this.sinceSnapshot >= SNAPSHOT_MS) {
        this.sinceSnapshot = 0;
        this.transport.send({ t: 'state', s: this.state } satisfies AirHockeyMessage);
      }
    } else {
      this.sinceSnapshot += dt * 1000;
      if (this.sinceSnapshot >= SNAPSHOT_MS) {
        this.sinceSnapshot = 0;
        this.transport.send({ t: 'mallet', x: this.state.mallet.top } satisfies AirHockeyMessage);
      }
    }

    this.onState(this.state);
  }

  private receive(msg: AirHockeyMessage) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'mallet' && this.role === 'host') {
      setMallet(this.state, 'top', msg.x);
      return;
    }

    if (msg.t === 'state' && this.role === 'guest') {
      // Keep our own mallet so local input stays responsive.
      const mine = this.state.mallet.top;
      this.state = msg.s;
      this.state.mallet.top = mine;
      return;
    }

    if (msg.t === 'rematch' && this.role === 'host') {
      this.state = createState();
      this.seed++;
    }
  }
}
