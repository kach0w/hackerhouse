/**
 * The world palette.
 *
 * Deliberately small. Pixel art holds together because every object is shaded
 * from the same handful of colours with the same light direction — here, light
 * comes from the TOP-LEFT, so highlights go on top/left edges and shadows on
 * bottom/right. Adding "just one more" colour is how a scene starts looking
 * muddy, so new props should reuse these first.
 */

export const OUTLINE = '#181320';
export const SHADOW = '#241d2e';

/** Floorboards — warm, mid-value so sprites pop against it. */
export const FLOOR = {
  light: '#8a6543',
  base: '#7a583a',
  dark: '#6a4b30',
  seam: '#5b3f28',
};

/** Walls — cool and darker than the floor, so the room reads as enclosed. */
export const WALL = {
  light: '#464f6b',
  base: '#3a4159',
  dark: '#2c3145',
  trim: '#222637',
  baseboard: '#5a4433',
};

export const RUG = {
  base: '#3f4a72',
  light: '#4d5a88',
  dark: '#333c5e',
  accent: '#c96f52',
};

export const WOOD = {
  light: '#a97e52',
  base: '#8a6540',
  dark: '#66492d',
};

export const METAL = {
  light: '#98a2b8',
  base: '#6f7891',
  dark: '#4b5268',
};

export const FELT = {
  light: '#3f8a5c',
  base: '#2f6b46',
  dark: '#245234',
};

export const SCREEN = {
  glow: '#7fe3c0',
  base: '#1d3b39',
  dark: '#12242a',
};

export const SKIN = {
  light: '#f2c9a0',
  base: '#dfae85',
  dark: '#b9835f',
};

export const HAIR = ['#3a2b22', '#5c3a26', '#241a18', '#7a4b2c', '#2b2f3c'];

/** Per-user shirt colours — picked by hashing the userId. */
export const SHIRTS: { light: string; base: string; dark: string }[] = [
  { light: '#f0705f', base: '#d6503f', dark: '#a63a2c' },
  { light: '#5fa8f0', base: '#3f84d6', dark: '#2c5ea6' },
  { light: '#68d18c', base: '#46ad6a', dark: '#31834d' },
  { light: '#f0c05f', base: '#d69c3f', dark: '#a6752c' },
  { light: '#b98cf0', base: '#9566d6', dark: '#6d47a6' },
  { light: '#5fd6cd', base: '#3fb3aa', dark: '#2c8580' },
  { light: '#f08cc0', base: '#d66aa0', dark: '#a64b76' },
];

export const PANTS = { light: '#4a5570', base: '#3a4358', dark: '#2b3243' };
export const SHOES = { base: '#26232e', light: '#3a3644' };

/** Shift a colour toward white/black. Keeps derived shades on-palette. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (ch: number) =>
    Math.max(0, Math.min(255, Math.round(amount >= 0 ? ch + (255 - ch) * amount : ch * (1 + amount))));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function hashIndex(seed: string, len: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % len;
}
