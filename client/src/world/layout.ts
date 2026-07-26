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
 * The room fills the whole viewport: your avatar sits at a desk with a large
 * monitor, and the real terminal is positioned exactly over that monitor's
 * glass — so the agent runs on the machine your character is using, rather
 * than in a panel bolted above the scene.
 *
 * It's a large tilemap the camera sits *inside*, not a fixed picture scaled to
 * fit. Letterboxing a fixed room meant a tall window showed a small rectangle
 * floating in black; this way floor and walls run to every edge at a clean
 * integer zoom.
 */
export const ROOM_PX_W = 1024;
export const ROOM_PX_H = 640;

/** Everything above this line is wall, everything below is floor. */
export const ROOM_FLOOR_TOP = 256;
export const ROOM_WALL_ROWS = ROOM_FLOOR_TOP / TILE;

/** The desk composition is centred on this column. */
export const ROOM_CX = 512;

/**
 * Camera target: the midpoint of the composition (monitor top ~87 down to the
 * chair ~352), so the whole desk setup stays framed rather than clipping the
 * top of the bezel.
 */
export const ROOM_FOCUS = { x: ROOM_CX, y: 220 };

/**
 * The area the camera guarantees is visible — and therefore what sets the zoom.
 *
 * ⚠️ These are load-bearing, not slack. Zoom is `floor(min(w/VIEW_W, h/VIEW_H))`,
 * so nudging either value up can cross an integer threshold and drop the zoom a
 * whole step, which makes everything *smaller* on screen even as it grows in
 * native pixels. That already happened once: VIEW_H 300 → 320 took a 1440x900
 * window from 3x to 2x and shrank the monitor from 564px to 470px of glass.
 *
 * Keep these just above the composition's real extent (≈340 x ≈265) and change
 * them only while watching the resulting glass width.
 */
export const ROOM_VIEW_W = 360;
export const ROOM_VIEW_H = 275;

/** Monitor bezel footprint, native px. */
export const MONITOR = { x: ROOM_CX - 130, y: 87, w: 260, h: 165 };

/**
 * The glass — the terminal is overlaid here in CSS pixels. Keep this in sync
 * with `monitorFrame()` in art/props.ts: the sprite draws the bezel around this
 * rect and leaves the interior empty so the DOM terminal shows through.
 */
export const MONITOR_SCREEN = { x: ROOM_CX - 117, y: 100, w: 235, h: 130 };

/** Desk slab under the monitor. */
export const DESK_TOP = { x: ROOM_CX - 150, y: 252, w: 300, h: 34 };

/** Where the room owner sits — in front of the desk, back to the viewer. */
export const DESK = { x: ROOM_CX, y: 332 };
export const ROOM_DOOR = { x: ROOM_CX - 212, y: 300 };

/** Where visiting avatars stand once they've walked in — off to the side. */
export const VISITOR_SLOTS = [
  { x: ROOM_CX + 132, y: 330 },
  { x: ROOM_CX + 168, y: 350 },
  { x: ROOM_CX - 132, y: 330 },
  { x: ROOM_CX - 168, y: 350 },
];
