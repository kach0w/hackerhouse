/**
 * Character sprites — 16x24 native pixels, 4 directions, 3-frame walk cycle.
 *
 * Built the way a sprite sheet would be: `down` and `up` are authored, `side`
 * is authored once and mirrored for left/right (standard practice — it halves
 * the art and nobody notices). Frame 0 is the idle/contact pose, frames 1 and 2
 * are the two stride poses.
 *
 * Colours are parameterised per user, so everyone in the house is visually
 * distinct without drawing a separate sheet for each person.
 */

import type { Texture } from 'pixi.js';

import { Px } from './PixelCanvas';
import { HAIR, OUTLINE, PANTS, SHIRTS, SHOES, SKIN, hashIndex, shade } from './palette';

export type Dir = 'down' | 'up' | 'left' | 'right';

export const CHAR_W = 16;
export const CHAR_H = 24;
/** Distance from the sprite's top to the character's feet — the y-sort anchor. */
export const CHAR_FOOT = 24;

interface Colors {
  shirt: { light: string; base: string; dark: string };
  hair: string;
}

export function colorsFor(userId: string): Colors {
  return {
    shirt: SHIRTS[hashIndex(userId, SHIRTS.length)],
    hair: HAIR[hashIndex(userId + 'h', HAIR.length)],
  };
}

/** Legs + shoes. `lift` shifts each leg for the stride poses. */
function legs(p: Px, liftL: number, liftR: number) {
  // Left leg
  p.rect(5, 19 - liftL, 3, 3 + liftL, PANTS.base);
  p.rect(5, 19 - liftL, 1, 3 + liftL, PANTS.light);
  p.rect(5, 22 - liftL, 3, 2, SHOES.base);
  p.rect(5, 22 - liftL, 3, 1, SHOES.light);

  // Right leg (slightly darker — it's the shadowed side)
  p.rect(8, 19 - liftR, 3, 3 + liftR, PANTS.dark);
  p.rect(8, 22 - liftR, 3, 2, SHOES.base);
  p.rect(8, 22 - liftR, 3, 1, SHOES.light);
}

function torso(p: Px, c: Colors, armSwing: number) {
  // Hoodie body.
  p.rect(4, 11, 8, 8, c.shirt.base);
  p.rect(4, 11, 8, 1, c.shirt.light); // top edge catches the light
  p.rect(4, 11, 1, 8, c.shirt.light);
  p.rect(11, 11, 1, 8, c.shirt.dark); // shadowed side
  p.rect(4, 18, 8, 1, c.shirt.dark);

  // Arms, offset by the stride so the walk reads.
  p.rect(3, 12 + armSwing, 2, 5, c.shirt.base);
  p.rect(3, 12 + armSwing, 1, 5, c.shirt.light);
  p.rect(12, 12 - armSwing, 2, 5, c.shirt.dark);

  // Hands.
  p.rect(3, 17 + armSwing, 2, 2, SKIN.base);
  p.rect(12, 17 - armSwing, 2, 2, SKIN.dark);
}

function headDown(p: Px, c: Colors) {
  // Face.
  p.rect(4, 5, 8, 6, SKIN.base);
  p.rect(4, 5, 8, 1, SKIN.light);
  p.rect(4, 9, 8, 2, SKIN.dark);
  p.rect(4, 5, 1, 6, SKIN.dark);
  p.rect(11, 5, 1, 6, SKIN.dark);

  // Hair — cap over the top, sideburns down the sides.
  p.rect(3, 1, 10, 4, c.hair);
  p.rect(3, 1, 10, 1, OUTLINE);
  p.rect(3, 5, 1, 3, c.hair);
  p.rect(12, 5, 1, 3, c.hair);
  p.rect(4, 4, 8, 1, c.hair);

  // Eyes.
  p.rect(5, 7, 2, 2, OUTLINE);
  p.rect(9, 7, 2, 2, OUTLINE);
  p.set(5, 7, '#ffffff');
  p.set(9, 7, '#ffffff');
}

function headUp(p: Px, c: Colors) {
  // Back of the head — all hair, no features.
  p.rect(3, 1, 10, 9, c.hair);
  p.rect(3, 1, 10, 1, OUTLINE);
  p.rect(3, 2, 10, 1, shade(c.hair, 0.18)); // crown highlight
  p.rect(4, 9, 8, 1, SKIN.dark); // sliver of neck
}

function headSide(p: Px, c: Colors) {
  p.rect(4, 5, 8, 6, SKIN.base);
  p.rect(4, 5, 8, 1, SKIN.light);
  p.rect(4, 9, 8, 2, SKIN.dark);

  // Hair sweeps back from the face.
  p.rect(3, 1, 10, 4, c.hair);
  p.rect(3, 1, 10, 1, OUTLINE);
  p.rect(3, 5, 3, 4, c.hair);
  p.rect(4, 4, 8, 1, c.hair);

  // Single visible eye, facing right (mirrored for left).
  p.rect(9, 7, 2, 2, OUTLINE);
  p.set(9, 7, '#ffffff');
}

const STRIDES: { liftL: number; liftR: number; arm: number; bob: number }[] = [
  { liftL: 0, liftR: 0, arm: 0, bob: 0 },
  { liftL: 1, liftR: 0, arm: 1, bob: -1 },
  { liftL: 0, liftR: 1, arm: -1, bob: -1 },
];

function buildFrame(dir: Exclude<Dir, 'left'>, frame: number, c: Colors): Px {
  const p = new Px(CHAR_W, CHAR_H);
  const s = STRIDES[frame];

  legs(p, s.liftL, s.liftR);

  // The body bobs a pixel mid-stride; drawing it into a sub-sprite and
  // stamping keeps the offset from bleeding into the legs.
  const upper = new Px(CHAR_W, CHAR_H);
  torso(upper, c, s.arm);
  if (dir === 'down') headDown(upper, c);
  else if (dir === 'up') headUp(upper, c);
  else headSide(upper, c);

  p.stamp(upper, 0, s.bob);
  p.outline(OUTLINE);
  return p;
}

export interface CharacterSheet {
  frames: Record<Dir, Texture[]>;
}

const cache = new Map<string, CharacterSheet>();

export function characterSheet(userId: string): CharacterSheet {
  const cached = cache.get(userId);
  if (cached) return cached;

  const c = colorsFor(userId);
  const down = [0, 1, 2].map((f) => buildFrame('down', f, c));
  const up = [0, 1, 2].map((f) => buildFrame('up', f, c));
  const right = [0, 1, 2].map((f) => buildFrame('right', f, c));

  const sheet: CharacterSheet = {
    frames: {
      down: down.map((p) => p.toTexture()),
      up: up.map((p) => p.toTexture()),
      right: right.map((p) => p.toTexture()),
      left: right.map((p) => p.flipX().toTexture()),
    },
  };
  cache.set(userId, sheet);
  return sheet;
}
