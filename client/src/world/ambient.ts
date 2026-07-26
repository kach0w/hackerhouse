/**
 * Ambient avatar behaviour — the "repetitive pattern" every character runs
 * while they're in the lounge. Nobody steers; this is the only thing driving
 * a lounge avatar's position.
 *
 * Each client runs this for its OWN avatar only, and emits the resulting
 * position as `move`. Everyone else's avatars are rendered straight from
 * `presence:update`. That gives exactly one source of truth per character and
 * means two clients can never disagree about where someone is.
 *
 * Slot contention is handled without any server coordination: before claiming
 * a slot, we check whether anyone is already standing on it using the presence
 * positions we already receive. Two avatars can still race for the same slot
 * in the same tick — the cost is a brief overlap, which is cosmetic.
 */

import { WALK_SPEED, clampToFloor, dist, facingFromDelta } from './layout';
import { STATIONS, type Activity, type Slot, type Station } from './stations';

export type Phase = 'walking' | 'performing' | 'pausing';

export interface AmbientOutput {
  x: number;
  y: number;
  facing: 'up' | 'down' | 'left' | 'right';
  /** What to draw the avatar doing. `null` while in transit. */
  activity: Activity | null;
  stationId: string | null;
}

interface Peer {
  x: number;
  y: number;
}

/** A slot is considered taken if someone is standing basically on it. */
const SLOT_CLAIM_RADIUS = 18;

/** Deterministic per-user RNG, so two people don't run identical loops in lockstep. */
function makeRng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

export class AmbientController {
  private rng: () => number;
  private phase: Phase = 'pausing';
  private timer = 0;
  private station: Station | null = null;
  private slot: Slot | null = null;
  private wanderTarget: { x: number; y: number } | null = null;
  private facing: 'up' | 'down' | 'left' | 'right' = 'down';
  private lastStationId: string | null = null;

  constructor(seed: string) {
    this.rng = makeRng(seed);
    this.timer = 400 + this.rng() * 1200;
  }

  /** Drop any claim and stand still — used while a scripted transition owns the avatar. */
  reset() {
    this.phase = 'pausing';
    this.timer = 300;
    this.station = null;
    this.slot = null;
    this.wanderTarget = null;
  }

  /**
   * @param dt   seconds since last tick
   * @param pos  the avatar's current position
   * @param peers other avatars currently in the lounge (for slot contention)
   */
  tick(dt: number, pos: { x: number; y: number }, peers: Peer[]): AmbientOutput {
    this.timer -= dt * 1000;

    switch (this.phase) {
      case 'pausing':
        if (this.timer <= 0) this.pickNextTarget(peers);
        break;

      case 'performing':
        if (this.timer <= 0) {
          this.station = null;
          this.slot = null;
          this.phase = 'pausing';
          this.timer = 300 + this.rng() * 1500;
        }
        break;

      case 'walking': {
        const target = this.slot ?? this.wanderTarget;
        if (!target) {
          this.phase = 'pausing';
          this.timer = 500;
          break;
        }
        const dx = target.x - pos.x;
        const dy = target.y - pos.y;
        const d = Math.hypot(dx, dy);

        if (d < WALK_SPEED * dt) {
          // Arrived.
          pos = { x: target.x, y: target.y };
          if (this.slot && this.station) {
            this.facing = this.slot.facing;
            this.phase = 'performing';
            const [lo, hi] = this.station.dwell;
            this.timer = lo + this.rng() * (hi - lo);
          } else {
            this.phase = 'pausing';
            this.timer = 800 + this.rng() * 2500;
            this.wanderTarget = null;
          }
        } else {
          const step = (WALK_SPEED * dt) / d;
          pos = clampToFloor(pos.x + dx * step, pos.y + dy * step);
          this.facing = facingFromDelta(dx, dy);
        }
        break;
      }
    }

    return {
      x: pos.x,
      y: pos.y,
      facing: this.facing,
      activity: this.phase === 'performing' ? (this.station?.activity ?? null) : null,
      stationId: this.phase === 'performing' ? (this.station?.id ?? null) : null,
    };
  }

  /** Mostly head for a station; sometimes just drift somewhere for variety. */
  private pickNextTarget(peers: Peer[]) {
    if (this.rng() < 0.25) {
      this.wanderTarget = {
        x: 40 + this.rng() * 400,
        y: 90 + this.rng() * 190,
      };
      this.slot = null;
      this.station = null;
      this.phase = 'walking';
      return;
    }

    // Avoid immediately re-picking the station we just left.
    const candidates = STATIONS.filter((s) => s.id !== this.lastStationId);
    const pool = candidates.length ? candidates : STATIONS;

    for (let attempt = 0; attempt < 4; attempt++) {
      const station = pool[Math.floor(this.rng() * pool.length)];
      const free = station.slots.filter((s) => this.slotIsFree(s, peers));
      if (!free.length) continue;

      this.station = station;
      this.slot = free[Math.floor(this.rng() * free.length)];
      this.lastStationId = station.id;
      this.phase = 'walking';
      return;
    }

    // Everything's busy — idle a moment and try again.
    this.phase = 'pausing';
    this.timer = 700 + this.rng() * 1200;
  }

  private slotIsFree(slot: Slot, peers: Peer[]): boolean {
    return !peers.some((p) => dist(p.x, p.y, slot.x, slot.y) < SLOT_CLAIM_RADIUS);
  }
}
