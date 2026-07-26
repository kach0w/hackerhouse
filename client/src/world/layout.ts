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
 * overlaid here in CSS pixels. Measured from the art: dark terminal area plus
 * the blue profile-icon panel, versus warm wood/bezel around them. Source
 * edges ≈ x=399–880, y=124–393 (of 1280x832), scaled by 0.8 / 0.7692. The
 * right edge was nudged out so the DOM frame sits flush with the TV glass
 * instead of leaving a sliver of illustrated screen beside it.
 */
export const MONITOR_SCREEN = { x: 319, y: 95, w: 386, h: 207 };

/** Where the room owner sits — in the chair, facing the monitor. */
export const DESK = { x: 508, y: 445 };

/** Where an arriving avatar starts, roughly at the door in the art. */
export const ROOM_DOOR = { x: 64, y: 462 };

/**
 * Where visiting avatars stand — well clear to the left of the owner's
 * chair, not crowding the desk.
 */
export const VISITOR_SLOTS = [
  { x: 130, y: 505 },
  { x: 850, y: 505 },
  { x: 170, y: 475 },
  { x: 810, y: 475 },
];

/**
 * The character sprite's native 20x30 size was tuned for the old tile-drawn
 * room. Against this illustration's larger furniture, scale avatars up in the
 * Room only so a seated character looks proportionate to the chair.
 */
export const ROOM_AVATAR_SCALE = 4;
