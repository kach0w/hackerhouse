/**
 * Lounge furniture, as first-class interactive objects rather than scenery.
 *
 * A station owns a sprite, a footprint, a set of anchor slots where avatars
 * stand, and the activity performed while parked there. The ambient loop in
 * `ambient.ts` picks stations and claims slots.
 *
 * `minigame` is the seam for the 1v1 games: the ping pong table and arcade
 * cabinet each know their own position and slots, and clicking them opens the
 * matching game overlay — see Lounge.tsx.
 *
 * All coordinates are native pixels (see layout.ts). `footY` is the sprite's
 * bottom edge — it's the depth-sort key, so getting it wrong makes avatars walk
 * through furniture instead of behind it.
 */

import type { Px } from '../art/PixelCanvas';
import {
  arcadeCabinet,
  beanbag,
  bookshelf,
  coffeeBar,
  couch,
  fridge,
  floorLamp,
  pingPongTable,
  pizzaStack,
  plant,
  poolTable,
  poster,
  rugRound,
  whiteboard,
  windowPane,
  workTable,
} from '../art/props';

export type Activity = 'pool' | 'pingpong' | 'sit' | 'stand' | 'coffee' | 'write';

export interface Slot {
  x: number;
  y: number;
  facing: 'up' | 'down' | 'left' | 'right';
}

export interface Station {
  id: string;
  label: string;
  sprite: () => Px;
  /** Top-left of the sprite, native px. */
  x: number;
  y: number;
  /** Bottom edge, for depth sorting. */
  footY: number;
  activity: Activity;
  slots: Slot[];
  /** ms range an avatar lingers here before wandering off. */
  dwell: [number, number];
  /** Which minigame this station opens, if any. */
  minigame?: 'pong' | 'pool' | 'snake';
}

export const STATIONS: Station[] = [
  {
    id: 'worktable',
    label: 'Work table',
    sprite: workTable,
    x: 148,
    y: 186,
    footY: 236,
    activity: 'write',
    slots: [
      { x: 162, y: 246, facing: 'up' },
      { x: 192, y: 246, facing: 'up' },
      { x: 222, y: 246, facing: 'up' },
      { x: 136, y: 214, facing: 'right' },
    ],
    dwell: [9000, 18000],
  },
  {
    id: 'pool',
    label: 'Pool',
    sprite: poolTable,
    x: 34,
    y: 116,
    footY: 166,
    activity: 'pool',
    slots: [
      { x: 24, y: 144, facing: 'right' },
      { x: 126, y: 144, facing: 'left' },
      { x: 74, y: 178, facing: 'up' },
    ],
    dwell: [6000, 12000],
    minigame: 'pool',
  },
  {
    id: 'pingpong',
    label: 'Ping pong',
    sprite: pingPongTable,
    x: 300,
    y: 116,
    footY: 166,
    activity: 'pingpong',
    slots: [
      { x: 290, y: 144, facing: 'right' },
      { x: 392, y: 144, facing: 'left' },
    ],
    dwell: [7000, 14000],
    minigame: 'pong',
  },
  {
    id: 'arcade',
    label: 'Arcade',
    sprite: arcadeCabinet,
    x: 182,
    y: 96,
    footY: 154,
    activity: 'stand',
    slots: [
      { x: 199, y: 164, facing: 'up' },
      { x: 172, y: 158, facing: 'right' },
    ],
    dwell: [6000, 14000],
    minigame: 'snake',
  },
  {
    id: 'couch',
    label: 'Couch',
    sprite: couch,
    x: 22,
    y: 240,
    footY: 276,
    activity: 'sit',
    slots: [
      { x: 40, y: 276, facing: 'up' },
      { x: 60, y: 276, facing: 'up' },
      { x: 78, y: 276, facing: 'up' },
    ],
    dwell: [8000, 16000],
  },
  {
    id: 'coffee',
    label: 'Coffee',
    sprite: coffeeBar,
    x: 322,
    y: 40,
    footY: 84,
    activity: 'coffee',
    slots: [
      { x: 338, y: 96, facing: 'up' },
      { x: 366, y: 96, facing: 'up' },
    ],
    dwell: [3000, 6000],
  },
  {
    id: 'whiteboard',
    label: 'Whiteboard',
    sprite: whiteboard,
    x: 26,
    y: 14,
    footY: 58,
    activity: 'write',
    slots: [
      { x: 42, y: 74, facing: 'up' },
      { x: 70, y: 74, facing: 'up' },
    ],
    dwell: [4000, 9000],
  },
  {
    id: 'beanbags',
    label: 'Beanbags',
    sprite: beanbag,
    x: 322,
    y: 246,
    footY: 274,
    activity: 'sit',
    slots: [
      { x: 338, y: 278, facing: 'up' },
      { x: 392, y: 278, facing: 'up' },
    ],
    dwell: [8000, 15000],
  },
];

/** Non-interactive dressing. Sorted and occluded like stations, but no slots. */
export interface Decor {
  id: string;
  sprite: () => Px;
  x: number;
  y: number;
  footY: number;
  /** Flat items (rugs) draw under everything instead of sorting. */
  flat?: boolean;
}

export const DECOR: Decor[] = [
  // Floor.
  // Sized to frame the work table rather than hide beneath it.
  { id: 'rug', sprite: () => rugRound(124, 80), x: 134, y: 180, footY: 260, flat: true },
  { id: 'shelf', sprite: bookshelf, x: 148, y: 20, footY: 68 },
  { id: 'fridge', sprite: fridge, x: 420, y: 34, footY: 86 },
  { id: 'beanbag-2', sprite: beanbag, x: 376, y: 246, footY: 274 },
  { id: 'lamp-1', sprite: floorLamp, x: 112, y: 236, footY: 280 },
  { id: 'lamp-2', sprite: floorLamp, x: 286, y: 60, footY: 104 },
  { id: 'pizza', sprite: pizzaStack, x: 268, y: 252, footY: 274 },
  { id: 'plant-1', sprite: plant, x: 6, y: 62, footY: 96 },
  { id: 'plant-2', sprite: plant, x: 452, y: 132, footY: 166 },
  { id: 'plant-3', sprite: plant, x: 8, y: 286, footY: 320 },
  { id: 'plant-4', sprite: plant, x: 452, y: 286, footY: 320 },

  // Wall-mounted — footY inside the wall band so avatars always pass in front.
  { id: 'window', sprite: windowPane, x: 104, y: 8, footY: 40 },
  { id: 'poster-1', sprite: () => poster('#3f84d6'), x: 288, y: 10, footY: 40 },
  { id: 'poster-2', sprite: () => poster('#c96f52'), x: 396, y: 10, footY: 40 },
];
