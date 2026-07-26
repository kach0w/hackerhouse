/**
 * World geometry. Builder B owns this.
 *
 * IMPORTANT: every coordinate in this codebase is in NATIVE PIXELS — the
 * resolution the art is authored at, where a tile is 16px and a character is
 * 16x24. The whole world is then scaled up by an integer factor at render time
 * (see `WORLD_SCALE`). Never mix screen pixels into these numbers; if something
 * looks half-size, it's because a screen-space value leaked in here.
 *
 * The server (Builder A) is authoritative for *who* is where — it stores raw
 * x/y floats and knows nothing about tiles or furniture. All spatial meaning
 * lives here on the client.
 *
 * Nobody drives their avatar directly: movement is either an ambient loop
 * (`ambient.ts`) or a scripted walk during a transition. No keyboard input, and
 * no collision map — because we author every destination, avatars only walk
 * routes we already know are clear.
 */

export const TILE = 16;

/** Integer upscale. 3x turns a 16px tile into a chunky 48px on-screen tile. */
export const WORLD_SCALE = 3;

/** Lounge floor size, in tiles → 480x320 native. */
export const LOUNGE_W = 30;
export const LOUNGE_H = 20;

export const LOUNGE_PX_W = LOUNGE_W * TILE;
export const LOUNGE_PX_H = LOUNGE_H * TILE;

/** Rows 0–2 are the back wall; avatars never walk above this line. */
export const WALL_ROWS = 3;
export const FLOOR_TOP = WALL_ROWS * TILE;

/** The single portal between lounge and rooms. */
export const STAIRS = { x: 240, y: 66 };

/** Ambient walk speed, native px/sec (≈2.3 tiles a second). */
export const WALK_SPEED = 37;

/**
 * Scripted walks during a transition move faster than the ambient stroll.
 * Crossing the lounge at ambient speed takes ~4s, which is dead time the user
 * is just watching — the transition should feel deliberate, not slow.
 */
export const SCRIPT_WALK_SPEED = 95;

/** How close (native px) counts as "arrived" for a scripted walk. */
export const ARRIVE_EPS = 1;

/** Click radius around an avatar, in native px. */
export const AVATAR_HIT_RADIUS = 12;

export function clampToFloor(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(12, Math.min(LOUNGE_PX_W - 12, x)),
    y: Math.max(FLOOR_TOP + 14, Math.min(LOUNGE_PX_H - 8, y)),
  };
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** Facing derived from a movement vector, for picking the walk-cycle row. */
export function facingFromDelta(dx: number, dy: number): 'up' | 'down' | 'left' | 'right' {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

// --- Room scene geometry -----------------------------------------------------

/** The room scene occupies the bottom quarter of the viewport. */
export const ROOM_SPLIT = 0.25;

/** Room interior, native px. Wider than tall — it's a letterboxed strip. */
export const ROOM_PX_W = 320;
export const ROOM_PX_H = 104;

export const ROOM_WALL_ROWS = 2;
export const ROOM_FLOOR_TOP = ROOM_WALL_ROWS * TILE;

/**
 * Where the room owner sits. Deliberately *above* the desk's sort line so the
 * desk renders in front of them — from overhead, someone working sits on the
 * far side of their desk, not on top of it.
 */
export const DESK = { x: 140, y: 76 };
export const ROOM_DOOR = { x: 28, y: 88 };

/** Where visiting avatars stand once they've walked in. */
export const VISITOR_SLOTS = [
  { x: 196, y: 82 },
  { x: 220, y: 94 },
  { x: 244, y: 82 },
  { x: 268, y: 94 },
];
