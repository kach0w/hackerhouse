/**
 * Floor and wall tiles — 16x16 native pixels each.
 *
 * Several floor variants exist purely to break up tiling: a single repeated
 * plank tile creates an obvious grid, which instantly reads as cheap. Rotating
 * through variants with offset seams hides the repeat.
 */

import { Px } from './PixelCanvas';
import { FLOOR, OUTLINE, RUG, WALL, shade } from './palette';

export const TILE_PX = 16;

export const FLOOR_VARIANTS = 6;

/**
 * Wood plank flooring. Two 8px board rows per tile.
 *
 * The vertical butt-joints between boards are deliberately RARE — one every
 * few tiles, staggered between rows. Putting a vertical seam on every tile is
 * what makes plank flooring read as brickwork instead of wood.
 */
export function floorTile(variant: number): Px {
  const p = new Px(TILE_PX, TILE_PX);

  for (let row = 0; row < 2; row++) {
    const y = row * 8;
    // Tone alternates by BOARD ROW ONLY — never by variant. If it varied per
    // tile, neighbouring tiles in the same row would differ and the floor would
    // break into 16px blocks, which is exactly what makes it look like brick.
    const tone = row === 0 ? FLOOR.base : shade(FLOOR.base, 0.04);
    p.rect(0, y, 16, 8, tone);

    // Seam between boards, with a lit edge just below it.
    p.hline(0, y, 16, FLOOR.seam);
    p.hline(0, y + 1, 16, shade(tone, 0.08));

    // Grain: subtle, and only on some variants, so it doesn't tile visibly.
    if (variant % 3 !== 0) {
      const gx = (variant * 5 + row * 3) % 9;
      p.hline(2 + gx, y + 4, 3 + (variant % 3), shade(tone, -0.045));
    }
  }

  // Occasional butt-joint, on one row only, so joints stagger across the floor.
  if (variant === 2) p.vline(6, 0, 8, FLOOR.seam);
  if (variant === 5) p.vline(11, 8, 8, FLOOR.seam);

  return p;
}

/** The flat face of the back wall. */
export function wallTile(variant: number): Px {
  const p = new Px(TILE_PX, TILE_PX);
  p.rect(0, 0, 16, 16, WALL.base);
  // Faint vertical panelling.
  p.vline((variant * 7) % 16, 0, 16, WALL.dark);
  p.vline(((variant * 7) % 16) + 1, 0, 16, shade(WALL.base, 0.05));
  return p;
}

/** Top cap of the wall, where it meets the ceiling / screen edge. */
export function wallTopTile(): Px {
  const p = new Px(TILE_PX, TILE_PX);
  p.rect(0, 0, 16, 16, WALL.dark);
  p.hline(0, 14, 16, WALL.light);
  p.hline(0, 15, 16, WALL.trim);
  return p;
}

/** Baseboard strip where the wall meets the floor — sells the wall's height. */
export function baseboardTile(): Px {
  const p = new Px(TILE_PX, TILE_PX);
  p.rect(0, 0, 16, 6, WALL.base);
  p.rect(0, 6, 16, 4, WALL.baseboard);
  p.hline(0, 6, 16, shade(WALL.baseboard, 0.25));
  p.hline(0, 9, 16, OUTLINE);
  p.rect(0, 10, 16, 6, FLOOR.base);
  p.hline(0, 10, 16, FLOOR.dark);
  return p;
}

/**
 * Rug tiles, indexed by edge mask (1=N, 2=E, 4=S, 8=W set means "edge on that
 * side"). Cheap autotiling — enough to give the rug a proper border.
 */
export function rugTile(mask: number): Px {
  const p = new Px(TILE_PX, TILE_PX);
  p.rect(0, 0, 16, 16, RUG.base);

  // Woven pattern.
  p.dither(2, 2, 12, 12, RUG.light, 0);
  p.rect(6, 6, 4, 4, RUG.accent);

  if (mask & 1) p.hline(0, 0, 16, RUG.dark);
  if (mask & 4) p.hline(0, 15, 16, RUG.dark);
  if (mask & 8) p.vline(0, 0, 16, RUG.dark);
  if (mask & 2) p.vline(15, 0, 16, RUG.dark);
  return p;
}
