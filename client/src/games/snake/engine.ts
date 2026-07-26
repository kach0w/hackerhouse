/**
 * Snake simulation. Pure logic — no rendering, no input handling, no React.
 *
 * Classic rules: the snake moves on a grid at a fixed tick, eating apples makes
 * it longer and slightly faster, and running into a wall or into yourself ends
 * the run. Single player, so unlike pong there's no host/guest split.
 */

export const GRID_W = 21;
export const GRID_H = 21;

/** Milliseconds between moves at the start, and the floor it speeds up to. */
const START_TICK_MS = 165;
const MIN_TICK_MS = 70;
/** How much each apple shortens the tick. */
const SPEEDUP_MS = 4.5;

export const START_LENGTH = 3;

export interface Cell {
  x: number;
  y: number;
}

export type Dir = 'up' | 'down' | 'left' | 'right';

const VECTORS: Record<Dir, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export interface SnakeState {
  /** Head first. */
  snake: Cell[];
  dir: Dir;
  /**
   * Direction requested since the last move. Applied at move time, not
   * immediately — otherwise two fast key presses in one tick (right, then up
   * while already moving right… then down) could double back into your own
   * neck, which reads as an unfair instant death.
   */
  queued: Dir | null;
  apple: Cell;
  score: number;
  best: number;
  over: boolean;
  /** ms accumulated toward the next move. */
  acc: number;
  rng: number;
}

/** Small deterministic PRNG so apple placement is reproducible in tests. */
function nextRandom(state: SnakeState): number {
  state.rng = (state.rng * 1664525 + 1013904223) >>> 0;
  return state.rng / 0x100000000;
}

function tickMs(state: SnakeState): number {
  return Math.max(MIN_TICK_MS, START_TICK_MS - state.score * SPEEDUP_MS);
}

export function createState(seed = 1, best = 0): SnakeState {
  const midY = Math.floor(GRID_H / 2);
  const midX = Math.floor(GRID_W / 2);
  const state: SnakeState = {
    snake: Array.from({ length: START_LENGTH }, (_, i) => ({ x: midX - i, y: midY })),
    dir: 'right',
    queued: null,
    apple: { x: 0, y: 0 },
    score: 0,
    best,
    over: false,
    acc: 0,
    rng: seed >>> 0,
  };
  placeApple(state);
  return state;
}

function occupied(state: SnakeState, x: number, y: number): boolean {
  return state.snake.some((c) => c.x === x && c.y === y);
}

/**
 * Put an apple on a random free cell. Picks from the list of free cells rather
 * than rejection-sampling, so a nearly-full board can't spin.
 */
export function placeApple(state: SnakeState) {
  const free: Cell[] = [];
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (!occupied(state, x, y)) free.push({ x, y });
    }
  }
  if (free.length === 0) return; // board full — a perfect game
  state.apple = free[Math.floor(nextRandom(state) * free.length)];
}

/** Queue a direction change. Reversing straight back is ignored. */
export function turn(state: SnakeState, dir: Dir) {
  const current = state.queued ?? state.dir;
  if (VECTORS[dir].x === -VECTORS[current].x && VECTORS[dir].y === -VECTORS[current].y) return;
  state.queued = dir;
}

/** @param dt seconds */
export function step(state: SnakeState, dt: number): void {
  if (state.over) return;

  state.acc += dt * 1000;
  while (state.acc >= tickMs(state) && !state.over) {
    state.acc -= tickMs(state);
    move(state);
  }
}

function move(state: SnakeState) {
  if (state.queued) {
    state.dir = state.queued;
    state.queued = null;
  }

  const v = VECTORS[state.dir];
  const head = state.snake[0];
  const next: Cell = { x: head.x + v.x, y: head.y + v.y };

  // Walls.
  if (next.x < 0 || next.y < 0 || next.x >= GRID_W || next.y >= GRID_H) {
    return end(state);
  }

  // Self. The tail cell is about to vacate, so it isn't a collision — this is
  // what lets you follow directly behind your own tail without dying.
  const eating = next.x === state.apple.x && next.y === state.apple.y;
  const body = eating ? state.snake : state.snake.slice(0, -1);
  if (body.some((c) => c.x === next.x && c.y === next.y)) {
    return end(state);
  }

  state.snake.unshift(next);
  if (eating) {
    state.score += 1;
    placeApple(state);
  } else {
    state.snake.pop();
  }
}

function end(state: SnakeState) {
  state.over = true;
  state.best = Math.max(state.best, state.score);
}
