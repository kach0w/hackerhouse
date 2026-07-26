/**
 * Pong simulation. Pure logic — no rendering, no networking, no React.
 *
 * Authority model: one peer is the HOST and owns the entire simulation. The
 * guest only ever sends its paddle position and renders what the host tells it.
 * That's the simplest model that can't desync, which matters more than
 * prediction niceties for a table you walk up to in a lounge.
 *
 * Court coordinates are native pixels, matching the rest of the pixel art.
 */

export const COURT_W = 220;
export const COURT_H = 132;

export const PADDLE_H = 28;
export const PADDLE_W = 4;
export const PADDLE_INSET = 10;
export const PADDLE_SPEED = 108; // native px/sec

export const BALL_R = 2;
const BALL_START_SPEED = 96;
const BALL_SPEEDUP = 1.045; // per paddle hit
const BALL_MAX_SPEED = 260;

export const WIN_SCORE = 5;

export type Side = 'left' | 'right';

export interface PongState {
  ball: { x: number; y: number; vx: number; vy: number };
  paddle: Record<Side, number>; // y of paddle centre
  score: Record<Side, number>;
  /** >0 means we're counting in before a serve; the ball is frozen. */
  countdown: number;
  winner: Side | null;
}

export function createState(): PongState {
  return {
    ball: { x: COURT_W / 2, y: COURT_H / 2, vx: 0, vy: 0 },
    paddle: { left: COURT_H / 2, right: COURT_H / 2 },
    score: { left: 0, right: 0 },
    countdown: 1.4,
    winner: null,
  };
}

function launchBall(state: PongState, toward: Side, seed: number) {
  const angle = ((seed % 5) - 2) * 0.22; // -0.44..0.44 radians
  const dir = toward === 'left' ? -1 : 1;
  state.ball.x = COURT_W / 2;
  state.ball.y = COURT_H / 2;
  state.ball.vx = Math.cos(angle) * BALL_START_SPEED * dir;
  state.ball.vy = Math.sin(angle) * BALL_START_SPEED;
}

function clampPaddle(y: number): number {
  const half = PADDLE_H / 2;
  return Math.max(half, Math.min(COURT_H - half, y));
}

/** Move a paddle by an input axis in [-1, 1]. */
export function movePaddle(state: PongState, side: Side, axis: number, dt: number) {
  state.paddle[side] = clampPaddle(state.paddle[side] + axis * PADDLE_SPEED * dt);
}

export function setPaddle(state: PongState, side: Side, y: number) {
  state.paddle[side] = clampPaddle(y);
}

/**
 * Advance the simulation. Host-only — the guest never calls this.
 * @param rallySeed increments per point, used for a varied but agreed serve.
 */
export function step(state: PongState, dt: number, rallySeed: number): void {
  if (state.winner) return;

  if (state.countdown > 0) {
    state.countdown -= dt;
    if (state.countdown <= 0) {
      state.countdown = 0;
      launchBall(state, state.score.left > state.score.right ? 'right' : 'left', rallySeed);
    }
    return;
  }

  const b = state.ball;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  // Top / bottom walls.
  if (b.y - BALL_R < 0) {
    b.y = BALL_R;
    b.vy = Math.abs(b.vy);
  } else if (b.y + BALL_R > COURT_H) {
    b.y = COURT_H - BALL_R;
    b.vy = -Math.abs(b.vy);
  }

  // Paddles. Deflection angle depends on where the ball hits the paddle, which
  // is the whole reason pong has any depth at all.
  const hit = (side: Side) => {
    const px = side === 'left' ? PADDLE_INSET : COURT_W - PADDLE_INSET;
    const py = state.paddle[side];
    const withinY = Math.abs(b.y - py) <= PADDLE_H / 2 + BALL_R;
    if (!withinY) return false;

    if (side === 'left') {
      if (b.vx >= 0 || b.x - BALL_R > px + PADDLE_W / 2) return false;
      if (b.x + BALL_R < px - PADDLE_W / 2) return false;
      b.x = px + PADDLE_W / 2 + BALL_R;
    } else {
      if (b.vx <= 0 || b.x + BALL_R < px - PADDLE_W / 2) return false;
      if (b.x - BALL_R > px + PADDLE_W / 2) return false;
      b.x = px - PADDLE_W / 2 - BALL_R;
    }

    const offset = (b.y - py) / (PADDLE_H / 2); // -1..1
    const speed = Math.min(Math.hypot(b.vx, b.vy) * BALL_SPEEDUP, BALL_MAX_SPEED);
    const angle = offset * 0.9;
    const dir = side === 'left' ? 1 : -1;
    b.vx = Math.cos(angle) * speed * dir;
    b.vy = Math.sin(angle) * speed;
    return true;
  };

  hit('left');
  hit('right');

  // Scoring.
  if (b.x < -BALL_R * 4) {
    state.score.right += 1;
    concede(state);
  } else if (b.x > COURT_W + BALL_R * 4) {
    state.score.left += 1;
    concede(state);
  }
}

function concede(state: PongState) {
  state.ball.vx = 0;
  state.ball.vy = 0;
  state.ball.x = COURT_W / 2;
  state.ball.y = COURT_H / 2;
  state.countdown = 1.1;
  if (state.score.left >= WIN_SCORE) state.winner = 'left';
  if (state.score.right >= WIN_SCORE) state.winner = 'right';
}

/** Simple tracking bot, used for practice mode and as a stand-in opponent. */
export function botAxis(state: PongState, side: Side, difficulty = 0.72): number {
  const target = state.ball.vx === 0 ? COURT_H / 2 : state.ball.y;
  const delta = target - state.paddle[side];
  const deadzone = PADDLE_H * (1 - difficulty) * 0.5;
  if (Math.abs(delta) < deadzone) return 0;
  return Math.sign(delta) * difficulty;
}
