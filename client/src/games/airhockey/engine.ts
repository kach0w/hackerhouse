/**
 * Air hockey simulation. Pure logic — no rendering, no networking, no React.
 *
 * Portrait table: goals top and bottom, mallets slide left/right only. That
 * 1D constraint is deliberate — it keeps the controls to two arrow keys and
 * makes the game about anticipating angles rather than chasing the puck.
 *
 * Same host-authoritative model as pong (see games/pong/match.ts).
 * Coordinates are native pixels.
 */

export const COURT_W = 132;
export const COURT_H = 196;

export const PUCK_R = 6;
export const MALLET_R = 11;

/** Centred gap in the top and bottom walls. */
export const GOAL_W = 54;

/** Mallets are pinned to these rows and only move horizontally. */
export const MALLET_Y = { bottom: COURT_H - 24, top: 24 };

export const MALLET_SPEED = 132; // native px/sec

const PUCK_MAX_SPEED = 210;
const PUCK_MIN_SPEED = 6;
/** Fraction of speed retained per second — air hockey is low friction. */
const FRICTION_PER_SEC = 0.62;
const WALL_RESTITUTION = 0.94;
/** How much of the mallet's own motion transfers into the puck. */
const MALLET_TRANSFER = 0.55;

export const WIN_SCORE = 5;

export type Side = 'bottom' | 'top';

export interface AirHockeyState {
  puck: { x: number; y: number; vx: number; vy: number };
  mallet: Record<Side, number>; // x only
  /** Mallet positions from the previous tick, so collisions can read velocity. */
  lastMallet: Record<Side, number>;
  score: Record<Side, number>;
  /** >0 freezes play before a face-off. */
  countdown: number;
  /** Seconds the puck has been motionless — drives the stall guard. */
  stalled: number;
  winner: Side | null;
}

export function createState(): AirHockeyState {
  return {
    puck: { x: COURT_W / 2, y: COURT_H / 2, vx: 0, vy: 0 },
    mallet: { bottom: COURT_W / 2, top: COURT_W / 2 },
    lastMallet: { bottom: COURT_W / 2, top: COURT_W / 2 },
    score: { bottom: 0, top: 0 },
    countdown: 1.4,
    stalled: 0,
    winner: null,
  };
}

function clampMallet(x: number): number {
  return Math.max(MALLET_R + 1, Math.min(COURT_W - MALLET_R - 1, x));
}

export function moveMallet(state: AirHockeyState, side: Side, axis: number, dt: number) {
  state.mallet[side] = clampMallet(state.mallet[side] + axis * MALLET_SPEED * dt);
}

export function setMallet(state: AirHockeyState, side: Side, x: number) {
  state.mallet[side] = clampMallet(x);
}

function faceOff(state: AirHockeyState, toward: Side, seed: number) {
  const spread = ((seed % 5) - 2) * 0.3; // small sideways variation
  const dir = toward === 'top' ? -1 : 1;
  state.puck.x = COURT_W / 2;
  state.puck.y = COURT_H / 2;
  state.puck.vx = spread * 40;
  state.puck.vy = dir * 74;
}

function inGoalMouth(x: number): boolean {
  return Math.abs(x - COURT_W / 2) < GOAL_W / 2;
}

/** Advance the simulation. Host-only. */
export function step(state: AirHockeyState, dt: number, seed: number): void {
  if (state.winner) return;

  if (state.countdown > 0) {
    state.countdown -= dt;
    if (state.countdown <= 0) {
      state.countdown = 0;
      faceOff(state, state.score.bottom > state.score.top ? 'bottom' : 'top', seed);
    }
    return;
  }

  const p = state.puck;

  // Friction, then integrate.
  const decay = Math.pow(FRICTION_PER_SEC, dt);
  p.vx *= decay;
  p.vy *= decay;
  if (Math.hypot(p.vx, p.vy) < PUCK_MIN_SPEED) {
    p.vx = 0;
    p.vy = 0;
  }

  p.x += p.vx * dt;
  p.y += p.vy * dt;

  // Side walls.
  if (p.x - PUCK_R < 0) {
    p.x = PUCK_R;
    p.vx = Math.abs(p.vx) * WALL_RESTITUTION;
  } else if (p.x + PUCK_R > COURT_W) {
    p.x = COURT_W - PUCK_R;
    p.vx = -Math.abs(p.vx) * WALL_RESTITUTION;
  }

  // End walls — bounce unless the puck is inside the goal mouth.
  //
  // A goal counts the moment the puck's CENTRE crosses the line, not when it
  // fully clears it. Requiring a full exit deadlocks the match: a puck that
  // runs out of speed inside the mouth can't bounce (it's in the mouth) and
  // can't finish crossing, so it parks there and play stops forever.
  if (p.y - PUCK_R < 0) {
    if (inGoalMouth(p.x)) {
      if (p.y <= 0) return concede(state, 'bottom');
    } else {
      p.y = PUCK_R;
      p.vy = Math.abs(p.vy) * WALL_RESTITUTION;
    }
  } else if (p.y + PUCK_R > COURT_H) {
    if (inGoalMouth(p.x)) {
      if (p.y >= COURT_H) return concede(state, 'top');
    } else {
      p.y = COURT_H - PUCK_R;
      p.vy = -Math.abs(p.vy) * WALL_RESTITUTION;
    }
  }

  collideMallet(state, 'bottom', dt);
  collideMallet(state, 'top', dt);

  // Stall guard: a dead puck neither side can reach would hang the match, so
  // re-face-off after a few seconds of nothing happening.
  if (p.vx === 0 && p.vy === 0) {
    state.stalled += dt;
    if (state.stalled > 3) {
      state.stalled = 0;
      faceOff(state, seed % 2 === 0 ? 'top' : 'bottom', seed);
    }
  } else {
    state.stalled = 0;
  }
}

/**
 * Circle-circle collision against a mallet. The mallet is infinitely heavy —
 * the puck reflects along the contact normal and picks up some of the mallet's
 * horizontal motion, which is what lets you actually aim a shot.
 */
function collideMallet(state: AirHockeyState, side: Side, dt: number) {
  const p = state.puck;
  const mx = state.mallet[side];
  const my = MALLET_Y[side];

  const dx = p.x - mx;
  const dy = p.y - my;
  const dist = Math.hypot(dx, dy);
  const minDist = PUCK_R + MALLET_R;
  if (dist >= minDist || dist === 0) return;

  const nx = dx / dist;
  const ny = dy / dist;

  // Push the puck out of the mallet so they can't overlap and stick.
  p.x = mx + nx * minDist;
  p.y = my + ny * minDist;

  // Reflect only if moving into the mallet.
  const along = p.vx * nx + p.vy * ny;
  if (along < 0) {
    p.vx -= 2 * along * nx;
    p.vy -= 2 * along * ny;
  }

  // Impart the mallet's own motion — this is what lets you aim a shot rather
  // than just blocking.
  const malletVx = (mx - state.lastMallet[side]) / Math.max(dt, 1e-4);
  p.vx += malletVx * MALLET_TRANSFER;

  // Always give the puck a nudge away from the mallet so it can't dribble.
  const speed = Math.hypot(p.vx, p.vy);
  if (speed < 60) {
    p.vx += nx * 40;
    p.vy += ny * 40;
  }

  clampPuckSpeed(p);
}

function clampPuckSpeed(p: AirHockeyState['puck']) {
  const speed = Math.hypot(p.vx, p.vy);
  if (speed > PUCK_MAX_SPEED) {
    p.vx = (p.vx / speed) * PUCK_MAX_SPEED;
    p.vy = (p.vy / speed) * PUCK_MAX_SPEED;
  }
}

/** Call once per tick, after `step`, to snapshot mallet positions for velocity. */
export function recordMalletPositions(state: AirHockeyState) {
  state.lastMallet.bottom = state.mallet.bottom;
  state.lastMallet.top = state.mallet.top;
}

function concede(state: AirHockeyState, scorer: Side) {
  state.score[scorer] += 1;
  state.puck.x = COURT_W / 2;
  state.puck.y = COURT_H / 2;
  state.puck.vx = 0;
  state.puck.vy = 0;
  state.countdown = 1.2;
  if (state.score[scorer] >= WIN_SCORE) state.winner = scorer;
}

/**
 * Bot mallet. Tracks the puck when it's coming, drifts back to centre when it
 * isn't — a bot that mirrors the puck perfectly is unbeatable and no fun.
 */
export function botAxis(state: AirHockeyState, side: Side, difficulty = 0.58): number {
  const p = state.puck;
  const approaching = side === 'top' ? p.vy < 0 : p.vy > 0;
  const target = approaching ? p.x : COURT_W / 2;
  const delta = target - state.mallet[side];
  const deadzone = MALLET_R * (1 - difficulty) + 1.5;
  if (Math.abs(delta) < deadzone) return 0;
  return Math.sign(delta) * difficulty;
}
