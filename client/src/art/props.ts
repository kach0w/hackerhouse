/**
 * Furniture sprites, authored at native pixel resolution.
 *
 * Each prop is drawn in an oblique top-down view — you see the top surface AND
 * a sliver of the front face — which is what makes an overhead scene read as
 * having depth. Light is top-left throughout (see palette.ts).
 *
 * Props do not bake their own drop shadows; the stage lays a shared shadow
 * sprite underneath so shadows sit on the floor rather than on the object.
 */

import { Px } from './PixelCanvas';
import { FELT, METAL, OUTLINE, SCREEN, WOOD, shade } from './palette';

export function shadowSprite(w: number, h: number): Px {
  const p = new Px(w, h);
  // Dithered ellipse — a soft shadow without alpha blending.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x - w / 2) / (w / 2);
      const ny = (y - h / 2) / (h / 2);
      const d = nx * nx + ny * ny;
      if (d < 0.55) p.set(x, y, '#1a1522');
      else if (d < 1 && (x + y) % 2 === 0) p.set(x, y, '#1a1522');
    }
  }
  return p;
}

export function poolTable(): Px {
  const p = new Px(80, 52);

  // Legs first so the body overlaps them.
  p.rect(10, 36, 7, 14, shade(WOOD.dark, -0.25));
  p.rect(63, 36, 7, 14, shade(WOOD.dark, -0.25));

  // Cabinet + rails.
  p.rect(0, 26, 80, 14, WOOD.dark);
  p.rect(0, 4, 80, 24, WOOD.base);
  p.rect(0, 4, 80, 2, WOOD.light);
  p.rect(0, 4, 2, 24, WOOD.light);
  p.rect(78, 4, 2, 24, shade(WOOD.dark, -0.1));

  // Felt bed.
  p.rect(6, 9, 68, 24, FELT.base);
  p.rect(6, 9, 68, 1, FELT.dark);
  p.rect(6, 10, 68, 1, FELT.light);
  p.dither(8, 12, 64, 19, shade(FELT.base, 0.04), 1);

  // Pockets.
  for (const [px, py] of [
    [8, 11],
    [39, 10],
    [71, 11],
    [8, 31],
    [39, 32],
    [71, 31],
  ] as const) {
    p.circle(px, py, 3, OUTLINE);
    p.circle(px, py - 1, 2, shade(OUTLINE, 0.18));
  }

  // Balls.
  p.circle(30, 20, 2, '#e8e4dc');
  p.circle(46, 18, 2, '#d64a3f');
  p.circle(52, 24, 2, '#f0c03f');
  p.circle(38, 26, 2, '#3f6fd6');

  p.outline(OUTLINE);
  return p;
}

export function pingPongTable(): Px {
  const p = new Px(80, 52);

  p.rect(12, 34, 6, 16, METAL.dark);
  p.rect(62, 34, 6, 16, METAL.dark);

  // Playing surface.
  p.rect(2, 26, 76, 10, shade('#2f5f9e', -0.35));
  p.rect(2, 4, 76, 22, '#2f5f9e');
  p.rect(2, 4, 76, 1, shade('#2f5f9e', 0.3));

  // Court markings.
  p.hline(5, 7, 70, '#e8eef6');
  p.hline(5, 23, 70, '#e8eef6');
  p.vline(5, 7, 17, '#e8eef6');
  p.vline(74, 7, 17, '#e8eef6');
  p.hline(5, 15, 70, shade('#2f5f9e', 0.22));

  // Net across the short axis, with posts.
  p.rect(39, 2, 2, 26, '#dfe6ef');
  p.dither(39, 2, 2, 26, shade('#dfe6ef', -0.3), 0);
  p.rect(38, 1, 4, 2, METAL.base);
  p.rect(38, 26, 4, 2, METAL.base);

  // Paddle + ball left on the table.
  p.circle(60, 12, 4, '#c0392b');
  p.rect(58, 15, 4, 5, WOOD.base);
  p.circle(24, 20, 2, '#f5f0e0');

  p.outline(OUTLINE);
  return p;
}

export function couch(): Px {
  const p = new Px(64, 38);
  const base = '#7a5a92';

  // Backrest.
  p.rect(2, 0, 60, 16, base);
  p.rect(2, 0, 60, 2, shade(base, 0.22));
  p.rect(2, 14, 60, 2, shade(base, -0.2));
  for (const bx of [14, 32, 50]) p.vline(bx, 2, 12, shade(base, -0.14));

  // Arms.
  p.rect(0, 8, 9, 24, shade(base, 0.08));
  p.rect(0, 8, 9, 2, shade(base, 0.28));
  p.rect(55, 8, 9, 24, shade(base, -0.08));

  // Seat cushions.
  p.rect(9, 16, 46, 13, shade(base, 0.14));
  p.hline(9, 16, 46, shade(base, 0.3));
  p.vline(32, 17, 12, shade(base, -0.16));

  // Skirt + feet.
  p.rect(9, 29, 46, 4, shade(base, -0.3));
  p.rect(6, 32, 4, 5, WOOD.dark);
  p.rect(54, 32, 4, 5, WOOD.dark);

  p.outline(OUTLINE);
  return p;
}

export function beanbag(): Px {
  const p = new Px(34, 28);
  const base = '#c4663f';

  // Slumped ellipse — wider at the bottom, with a dented seat.
  for (let y = 0; y < 28; y++) {
    for (let x = 0; x < 34; x++) {
      const nx = (x - 17) / 16;
      const ny = (y - 17) / 10;
      if (nx * nx + ny * ny > 1) continue;
      p.set(x, y, y < 12 ? shade(base, 0.12) : base);
    }
  }
  // Seat dent.
  for (let x = 9; x < 25; x++) {
    const d = Math.round(2 * Math.sin(((x - 9) / 16) * Math.PI));
    p.rect(x, 9 + d, 1, 4, shade(base, -0.14));
  }
  // Highlight along the top-left, shadow bottom-right.
  p.hline(11, 6, 12, shade(base, 0.26));
  p.dither(6, 20, 22, 6, shade(base, -0.2), 0);
  // Seams.
  p.vline(17, 7, 18, shade(base, -0.12));

  p.outline(OUTLINE);
  return p;
}

export function coffeeBar(): Px {
  const p = new Px(72, 44);

  // Counter body + top.
  p.rect(0, 16, 72, 24, WOOD.dark);
  p.rect(0, 10, 72, 8, WOOD.base);
  p.rect(0, 10, 72, 2, WOOD.light);
  for (let x = 4; x < 70; x += 12) p.vline(x, 18, 20, shade(WOOD.dark, -0.12));

  // Espresso machine.
  p.rect(8, 0, 22, 12, METAL.base);
  p.rect(8, 0, 22, 2, METAL.light);
  p.rect(11, 3, 8, 5, SCREEN.dark);
  p.rect(12, 4, 6, 3, SCREEN.glow);
  p.rect(20, 8, 3, 4, METAL.dark);

  // Mugs.
  p.rect(38, 4, 6, 6, '#e8e4dc');
  p.rect(39, 3, 4, 1, shade('#e8e4dc', 0.2));
  p.rect(44, 6, 2, 2, '#e8e4dc');
  p.rect(50, 5, 6, 5, '#d64a3f');

  p.outline(OUTLINE);
  return p;
}

export function whiteboard(): Px {
  const p = new Px(72, 30);
  p.rect(0, 0, 72, 26, '#eef2f7');
  p.rect(0, 0, 72, 2, '#ffffff');
  p.rect(0, 24, 72, 4, METAL.base);
  p.rect(0, 24, 72, 1, METAL.light);

  // Scribbles.
  p.hline(6, 7, 20, '#3f6fd6');
  p.hline(6, 10, 28, '#3f6fd6');
  p.hline(6, 13, 14, '#d64a3f');
  p.rect(44, 6, 18, 12, '#ffffff');
  p.hline(44, 6, 18, '#7a869c');
  p.hline(44, 17, 18, '#7a869c');
  p.vline(44, 6, 12, '#7a869c');
  p.vline(61, 6, 12, '#7a869c');
  p.hline(47, 11, 12, '#46ad6a');

  p.outline(OUTLINE);
  return p;
}

export function plant(): Px {
  const p = new Px(22, 34);
  // Pot.
  p.rect(5, 24, 12, 9, '#a0522d');
  p.rect(5, 24, 12, 2, shade('#a0522d', 0.25));
  p.rect(4, 22, 14, 3, shade('#a0522d', -0.12));
  // Fronds.
  p.blob(7, 6, 8, 18, '#3f7d4a');
  p.blob(2, 10, 8, 12, '#356b40');
  p.blob(12, 9, 8, 13, '#4a8f57');
  p.vline(11, 8, 16, shade('#3f7d4a', -0.3));
  p.outline(OUTLINE);
  return p;
}

export function bookshelf(): Px {
  const p = new Px(36, 48);
  p.rect(0, 0, 36, 44, WOOD.dark);
  p.rect(1, 0, 34, 2, WOOD.light);

  const bookColors = ['#d64a3f', '#3f84d6', '#46ad6a', '#d69c3f', '#9566d6', '#3fb3aa'];
  for (let shelf = 0; shelf < 3; shelf++) {
    const y = 3 + shelf * 14;
    p.rect(2, y, 32, 11, shade(WOOD.dark, -0.28));
    let x = 3;
    let i = shelf;
    while (x < 32) {
      const w = 2 + (i % 3);
      const h = 8 + (i % 3);
      p.rect(x, y + 11 - h, w, h, bookColors[i % bookColors.length]);
      p.rect(x, y + 11 - h, w, 1, shade(bookColors[i % bookColors.length], 0.3));
      x += w + 1;
      i++;
    }
    p.rect(2, y + 11, 32, 2, WOOD.base);
  }
  p.rect(0, 44, 36, 4, shade(WOOD.dark, -0.35));
  p.outline(OUTLINE);
  return p;
}

/**
 * The desk is split into two sprites so a seated avatar can sit BETWEEN them:
 * the monitor sorts behind the character, the tabletop sorts in front, and the
 * character's head and shoulders show in the gap. Drawing the desk as one
 * sprite would either bury the character or float them on top of the desk.
 */
export function deskMonitor(): Px {
  const p = new Px(40, 26);

  // Screen.
  p.rect(0, 0, 40, 20, METAL.dark);
  p.rect(2, 2, 36, 16, SCREEN.base);
  p.rect(2, 2, 36, 1, SCREEN.dark);
  for (let i = 0; i < 5; i++) {
    p.hline(4, 4 + i * 3, 8 + ((i * 7) % 18), SCREEN.glow);
  }

  // Stand.
  p.rect(16, 20, 8, 4, METAL.dark);
  p.rect(12, 23, 16, 3, METAL.base);
  p.rect(12, 23, 16, 1, METAL.light);

  p.outline(OUTLINE);
  return p;
}

/**
 * The big monitor the room is built around. Draws only the bezel, stand and
 * glow — the interior is left transparent because the real xterm terminal is
 * positioned over it in the DOM. `screen` must match MONITOR_SCREEN in
 * layout.ts, or the bezel and the terminal will disagree.
 */
export function monitorFrame(
  w: number,
  h: number,
  screen: { x: number; y: number; w: number; h: number },
): Px {
  const p = new Px(w, h + 22);

  // Bezel.
  p.rect(0, 0, w, h, METAL.dark);
  p.rect(0, 0, w, 2, METAL.light);
  p.rect(0, 0, 2, h, shade(METAL.dark, 0.12));
  p.rect(w - 2, 0, 2, h, shade(METAL.dark, -0.25));
  p.rect(0, h - 3, w, 3, shade(METAL.dark, -0.3));

  // Inner lip around the glass, then punch the glass out.
  p.rect(screen.x - 2, screen.y - 2, screen.w + 4, screen.h + 4, '#0a0d12');
  for (let y = 0; y < screen.h; y++) {
    for (let x = 0; x < screen.w; x++) p.set(screen.x + x, screen.y + y, null);
  }

  // Power LED + brand nub on the chin.
  p.rect(w / 2 - 8, h - 8, 16, 2, shade(METAL.dark, 0.2));
  p.rect(w - 14, h - 8, 3, 3, '#5fd6a0');

  // Stand.
  p.rect(w / 2 - 10, h, 20, 12, METAL.base);
  p.rect(w / 2 - 10, h, 3, 12, METAL.light);
  p.rect(w / 2 - 30, h + 12, 60, 6, METAL.base);
  p.rect(w / 2 - 30, h + 12, 60, 2, METAL.light);
  p.rect(w / 2 - 30, h + 18, 60, 2, shade(METAL.dark, -0.2));

  p.outline(OUTLINE);
  return p;
}

/** Wide desk slab for the room. */
export function deskSlab(w: number, h: number): Px {
  const p = new Px(w, h + 18);

  // Legs.
  p.rect(6, h - 2, 6, 20, shade(WOOD.dark, -0.35));
  p.rect(w - 12, h - 2, 6, 20, shade(WOOD.dark, -0.35));

  // Top surface + front edge.
  p.rect(0, 0, w, h - 8, WOOD.base);
  p.rect(0, 0, w, 3, WOOD.light);
  p.rect(0, h - 8, w, 8, shade(WOOD.dark, -0.1));
  p.hline(0, h - 8, w, shade(WOOD.dark, -0.3));

  // Grain.
  for (let i = 1; i < 5; i++) p.hline(10, 5 + i * 4, w - 20, shade(WOOD.base, -0.05));

  // Clutter: keyboard, mouse, mug, notebook.
  p.rect(w / 2 - 34, h - 22, 68, 11, shade(METAL.base, -0.15));
  p.rect(w / 2 - 34, h - 22, 68, 2, METAL.light);
  p.dither(w / 2 - 31, h - 19, 62, 6, METAL.light, 0);
  p.rect(w / 2 + 42, h - 20, 9, 7, shade(METAL.base, -0.05));
  p.rect(w / 2 - 60, h - 22, 9, 10, '#d64a3f');
  p.rect(w / 2 - 59, h - 23, 7, 1, shade('#d64a3f', 0.3));
  p.rect(w / 2 + 58, h - 21, 16, 10, '#e8e4dc');
  p.hline(w / 2 + 60, h - 18, 12, '#7a869c');
  p.hline(w / 2 + 60, h - 15, 9, '#7a869c');

  p.outline(OUTLINE);
  return p;
}

/** Desk chair, drawn from behind — the avatar sits in front of it. */
export function deskChair(): Px {
  const p = new Px(40, 46);
  p.rect(6, 0, 28, 26, '#3a4152');
  p.rect(6, 0, 28, 3, '#4c556b');
  p.rect(8, 4, 24, 3, shade('#3a4152', -0.2));
  p.rect(8, 12, 24, 3, shade('#3a4152', -0.2));
  p.rect(16, 26, 8, 8, METAL.dark);
  p.rect(4, 34, 32, 5, METAL.base);
  p.rect(4, 34, 32, 2, METAL.light);
  p.circle(7, 42, 3, METAL.dark);
  p.circle(33, 42, 3, METAL.dark);
  p.outline(OUTLINE);
  return p;
}

export function deskTable(): Px {
  const p = new Px(76, 28);

  // Legs.
  p.rect(6, 10, 5, 17, shade(WOOD.dark, -0.3));
  p.rect(65, 10, 5, 17, shade(WOOD.dark, -0.3));

  // Tabletop.
  p.rect(0, 0, 76, 12, WOOD.base);
  p.rect(0, 0, 76, 2, WOOD.light);
  p.rect(0, 10, 76, 2, shade(WOOD.dark, -0.15));

  // Keyboard + mug sitting on it.
  p.rect(26, 2, 24, 6, shade(METAL.base, -0.1));
  p.dither(27, 3, 22, 4, METAL.light, 0);
  p.rect(56, 1, 6, 6, '#d64a3f');
  p.rect(57, 0, 4, 1, shade('#d64a3f', 0.3));

  p.outline(OUTLINE);
  return p;
}

export function bed(): Px {
  const p = new Px(44, 60);
  p.rect(0, 0, 44, 56, WOOD.dark);
  p.rect(2, 2, 40, 10, '#e8e4dc'); // pillow
  p.rect(2, 2, 40, 2, '#ffffff');
  p.rect(2, 12, 40, 42, '#4a6fa8'); // duvet
  p.rect(2, 12, 40, 2, shade('#4a6fa8', 0.25));
  p.dither(4, 16, 36, 34, shade('#4a6fa8', -0.12), 0);
  p.rect(0, 54, 44, 4, shade(WOOD.dark, -0.3));
  p.outline(OUTLINE);
  return p;
}

/** The big communal work table — the actual point of a hacker house. */
export function workTable(): Px {
  const p = new Px(96, 54);

  // Legs.
  p.rect(8, 34, 5, 16, shade(WOOD.dark, -0.3));
  p.rect(83, 34, 5, 16, shade(WOOD.dark, -0.3));

  // Table top.
  p.rect(0, 26, 96, 10, WOOD.dark);
  p.rect(0, 10, 96, 16, WOOD.base);
  p.rect(0, 10, 96, 2, WOOD.light);
  p.rect(0, 34, 96, 2, shade(WOOD.dark, -0.2));

  // Three open laptops along the far edge.
  for (const lx of [8, 38, 68]) {
    p.rect(lx, 0, 20, 12, METAL.dark);
    p.rect(lx + 2, 2, 16, 8, SCREEN.base);
    for (let i = 0; i < 3; i++) p.hline(lx + 3, 3 + i * 2, 5 + ((lx + i * 5) % 10), SCREEN.glow);
    p.rect(lx - 1, 12, 22, 4, METAL.base);
    p.rect(lx - 1, 12, 22, 1, METAL.light);
  }

  // Mugs, a notebook, cable clutter.
  p.rect(30, 18, 5, 5, '#d64a3f');
  p.rect(31, 17, 3, 1, shade('#d64a3f', 0.3));
  p.rect(60, 19, 5, 4, '#3f84d6');
  p.rect(84, 16, 10, 7, '#e8e4dc');
  p.hline(85, 18, 8, '#7a869c');
  p.hline(85, 20, 6, '#7a869c');
  p.hline(20, 24, 14, shade(OUTLINE, 0.15));
  p.hline(50, 25, 18, shade(OUTLINE, 0.15));

  p.outline(OUTLINE);
  return p;
}

export function fridge(): Px {
  const p = new Px(30, 52);
  p.rect(0, 0, 30, 48, METAL.base);
  p.rect(0, 0, 30, 2, METAL.light);
  p.rect(1, 1, 2, 46, METAL.light);
  p.rect(27, 1, 2, 46, METAL.dark);
  p.hline(0, 18, 30, OUTLINE); // freezer split
  p.rect(23, 8, 3, 7, shade(METAL.dark, -0.2));
  p.rect(23, 24, 3, 9, shade(METAL.dark, -0.2));
  // Magnets + a sticky note.
  p.rect(6, 24, 4, 5, '#f0c03f');
  p.rect(12, 30, 3, 3, '#d64a3f');
  p.rect(6, 36, 3, 3, '#46ad6a');
  p.rect(0, 48, 30, 4, shade(METAL.dark, -0.35));
  p.outline(OUTLINE);
  return p;
}

/** Wall-mounted poster. `tint` picks the artwork colour. */
export function poster(tint: string): Px {
  const p = new Px(24, 30);
  p.rect(0, 0, 24, 28, shade(tint, -0.45));
  p.rect(2, 2, 20, 24, tint);
  p.rect(2, 2, 20, 1, shade(tint, 0.35));
  // Abstract shapes so it reads as artwork, not a flat rectangle.
  p.circle(9, 11, 4, shade(tint, 0.3));
  p.rect(13, 14, 8, 9, shade(tint, -0.25));
  p.hline(4, 23, 16, shade(tint, 0.2));
  p.outline(OUTLINE);
  return p;
}

/** Wall window with a night sky — gives the back wall some depth. */
export function windowPane(): Px {
  const p = new Px(44, 32);
  p.rect(0, 0, 44, 32, shade(WOOD.dark, -0.15));
  p.rect(3, 3, 38, 26, '#141c30');

  // Stars + a city glow along the bottom.
  for (const [sx, sy] of [
    [8, 7],
    [17, 11],
    [26, 6],
    [34, 13],
    [12, 17],
    [30, 20],
  ] as const) {
    p.set(sx, sy, '#e8eef8');
  }
  p.rect(3, 22, 38, 7, '#1d2a44');
  for (let x = 4; x < 40; x += 5) {
    const h = 3 + ((x * 7) % 5);
    p.rect(x, 29 - h, 3, h, '#26354f');
    p.set(x + 1, 30 - h, '#f0c03f');
  }

  // Frame cross-bars.
  p.vline(21, 3, 26, shade(WOOD.dark, -0.05));
  p.hline(3, 15, 38, shade(WOOD.dark, -0.05));
  p.outline(OUTLINE);
  return p;
}

export function floorLamp(): Px {
  const p = new Px(18, 44);
  p.rect(7, 10, 3, 28, METAL.dark);
  p.rect(4, 38, 10, 4, METAL.base);
  p.rect(4, 38, 10, 1, METAL.light);
  // Shade + spill of light.
  p.rect(2, 2, 14, 9, '#e8d9a8');
  p.rect(2, 2, 14, 2, '#f7ecc8');
  p.rect(3, 11, 12, 2, shade('#e8d9a8', -0.25));
  p.outline(OUTLINE);
  return p;
}

export function pizzaStack(): Px {
  const p = new Px(28, 22);
  for (let i = 0; i < 3; i++) {
    const y = 12 - i * 5;
    p.rect(1 + i, y, 26 - i * 2, 6, i % 2 === 0 ? '#c98a4b' : '#b87a3f');
    p.hline(1 + i, y, 26 - i * 2, shade('#c98a4b', 0.25));
  }
  p.rect(8, 3, 10, 3, '#d64a3f');
  p.outline(OUTLINE);
  return p;
}

export function rugRound(w = 60, h = 42): Px {
  const p = new Px(w, h);
  const ring = ['#39426a', '#4a5686', '#3f4a72', '#c96f52', '#46527d'];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x - w / 2) / (w / 2 - 1);
      const ny = (y - h / 2) / (h / 2 - 1);
      const d = Math.sqrt(nx * nx + ny * ny);
      if (d > 1) continue;

      // Concentric bands, plus a woven dither so it isn't a flat disc.
      let c: string;
      if (d > 0.93) c = ring[0];
      else if (d > 0.84) c = ring[1];
      else if (d > 0.52) c = ring[2];
      else if (d > 0.42) c = ring[3];
      else c = ring[4];

      if (d < 0.84 && d > 0.52 && (x + y) % 2 === 0) c = shade(c, 0.07);
      p.set(x, y, c);
    }
  }

  // Fringe along the left and right edges.
  for (let y = Math.round(h * 0.33); y < Math.round(h * 0.67); y += 3) {
    p.hline(0, y, 2, '#2f3757');
    p.hline(w - 2, y, 2, '#2f3757');
  }

  p.outline(OUTLINE);
  return p;
}
