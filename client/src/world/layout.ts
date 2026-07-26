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

/**
 * Rough floor-blocking footprint of the furniture baked into the lounge
 * backdrop image, in native px. Hand-eyeballed against the art (not derived
 * from any layout data — the backdrop is a single flat image, so there's no
 * other source of truth for where things are). Deliberately coarse: one box
 * per cluster, not a per-object hitbox.
 */
export interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const LOUNGE_OBSTACLES: Obstacle[] = [
  { x: 0, y: 55, w: 40, h: 70 }, // arcade cabinet
  { x: 70, y: 80, w: 95, h: 45 }, // ping pong table
  { x: 55, y: 130, w: 85, h: 50 }, // pool table
  { x: 165, y: 60, w: 55, h: 35 }, // bookshelf
  { x: 190, y: 135, w: 115, h: 75 }, // centre co-working table + rug
  { x: 275, y: 55, w: 195, h: 75 }, // kitchen counter + fridge
  { x: 360, y: 115, w: 115, h: 100 }, // fireplace + ottomans
  { x: 50, y: 180, w: 80, h: 40 }, // maker desk — printer/bins
  { x: 0, y: 210, w: 130, h: 100 }, // maker desk — workbench
  { x: 310, y: 205, w: 55, h: 85 }, // armchair
  { x: 355, y: 205, w: 130, h: 100 }, // sectional + side tables
];

/** Roughly an avatar's half-width — keeps feet off the furniture edge, not just its footprint. */
const OBSTACLE_PAD = 6;

/**
 * If (x, y) sits inside a padded obstacle, push it out to the nearest edge.
 * Deliberately simple — first hit wins, no sliding along multiple edges —
 * which is fine since the obstacle boxes above don't overlap.
 */
export function resolveObstacles(
  x: number,
  y: number,
  pad = OBSTACLE_PAD,
): { x: number; y: number; blocked: boolean } {
  for (const o of LOUNGE_OBSTACLES) {
    const left = o.x - pad;
    const right = o.x + o.w + pad;
    const top = o.y - pad;
    const bottom = o.y + o.h + pad;
    if (x <= left || x >= right || y <= top || y >= bottom) continue;

    const distLeft = x - left;
    const distRight = right - x;
    const distTop = y - top;
    const distBottom = bottom - y;
    const min = Math.min(distLeft, distRight, distTop, distBottom);

    if (min === distLeft) x = left;
    else if (min === distRight) x = right;
    else if (min === distTop) y = top;
    else y = bottom;

    return { x, y, blocked: true };
  }
  return { x, y, blocked: false };
}

// --- Room scene geometry -----------------------------------------------------

/**
 * The room is a single illustrated background image now (see
 * RoomStage.drawBackdrop) — walls, desk, monitor, bed, bookshelf, everything
 * lives in the art file. It's stretched to fill this footprint and shown in
 * full (contain-fit, letterboxed if the viewport's aspect ratio doesn't
 * match), not cropped/zoomed the way the old tile-drawn room was — the whole
 * thing is a composed illustration meant to be seen as a whole.
 *
 * Source art is 1280x832; this is scaled down 0.8x to keep native-pixel
 * coordinates in a similar range to the rest of the app.
 */
export const ROOM_PX_W = 1024;
export const ROOM_PX_H = 640;

/**
 * Monitor glass, in the same ROOM_PX_W x ROOM_PX_H space — the terminal is
 * overlaid here in CSS pixels. Measured from the art file (source image
 * region x=420,y=145,w=350,h=205 at 1280x832, scaled by 0.8/0.7692). Re-measure
 * if the art file ever changes.
 */
export const MONITOR_SCREEN = { x: 336, y: 112, w: 280, h: 158 };

/** Where the room owner sits — in the chair, facing the monitor. */
export const DESK = { x: 508, y: 415 };

/** Where an arriving avatar starts, roughly at the door in the art. */
export const ROOM_DOOR = { x: 64, y: 462 };

/** Where visiting avatars stand once they've walked in — open floor either side. */
export const VISITOR_SLOTS = [
  { x: 220, y: 500 },
  { x: 800, y: 500 },
  { x: 260, y: 470 },
  { x: 760, y: 470 },
];
