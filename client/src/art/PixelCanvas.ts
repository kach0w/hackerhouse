/**
 * A tiny pixel-art authoring surface.
 *
 * Everything visual in the world is drawn here at NATIVE pixel resolution — a
 * character is 16x24 actual pixels, a floor tile is 16x16 — and then blown up
 * with nearest-neighbour filtering at render time. That's the whole trick
 * behind the look: hard-edged pixels, a tight palette, and a consistent light
 * source, rather than smooth shapes drawn large.
 *
 * Drawing directly into an indexed grid (instead of via canvas paths) means
 * every pixel is placed deliberately and nothing gets antialiased.
 */

import { Texture } from 'pixi.js';

export type Hex = string;

export class Px {
  readonly w: number;
  readonly h: number;
  /** Row-major pixel grid; null = transparent. */
  private data: (Hex | null)[];

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Array(w * h).fill(null);
  }

  get(x: number, y: number): Hex | null {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.data[y * this.w + x];
  }

  set(x: number, y: number, c: Hex | null): this {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return this;
    this.data[y * this.w + x] = c;
    return this;
  }

  rect(x: number, y: number, w: number, h: number, c: Hex): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
    return this;
  }

  /** Outlined box: fill plus a 1px border in a second colour. */
  box(x: number, y: number, w: number, h: number, fill: Hex, border: Hex): this {
    this.rect(x, y, w, h, fill);
    this.hline(x, y, w, border);
    this.hline(x, y + h - 1, w, border);
    this.vline(x, y, h, border);
    this.vline(x + w - 1, y, h, border);
    return this;
  }

  hline(x: number, y: number, len: number, c: Hex): this {
    for (let i = 0; i < len; i++) this.set(x + i, y, c);
    return this;
  }

  vline(x: number, y: number, len: number, c: Hex): this {
    for (let j = 0; j < len; j++) this.set(x, y + j, c);
    return this;
  }

  /** Rounded-ish blob — corners knocked off, which reads as curvature at 16px. */
  blob(x: number, y: number, w: number, h: number, c: Hex): this {
    this.rect(x, y, w, h, c);
    this.set(x, y, null).set(x + w - 1, y, null);
    this.set(x, y + h - 1, null).set(x + w - 1, y + h - 1, null);
    return this;
  }

  circle(cx: number, cy: number, r: number, c: Hex): this {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y <= r * r + r * 0.4) this.set(cx + x, cy + y, c);
      }
    }
    return this;
  }

  /** 50% checkerboard fill — the classic way to blend two shades in pixel art. */
  dither(x: number, y: number, w: number, h: number, c: Hex, phase = 0): this {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if ((i + j + phase) % 2 === 0) this.set(x + i, y + j, c);
      }
    }
    return this;
  }

  /**
   * Wrap every filled region in a 1px dark outline. This is the single biggest
   * contributor to the "sprite" look — it's what separates objects from the
   * background in Gen-3-era art.
   */
  outline(c: Hex = '#1a1420'): this {
    const snapshot = [...this.data];
    const filled = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < this.w && y < this.h && snapshot[y * this.w + x] !== null;

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (filled(x, y)) continue;
        if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) {
          this.set(x, y, c);
        }
      }
    }
    return this;
  }

  /** Paste another sprite on top, skipping its transparent pixels. */
  stamp(src: Px, ox: number, oy: number): this {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const c = src.get(x, y);
        if (c) this.set(ox + x, oy + y, c);
      }
    }
    return this;
  }

  /** Horizontal mirror — lets one side-facing sprite serve both left and right. */
  flipX(): Px {
    const out = new Px(this.w, this.h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) out.set(this.w - 1 - x, y, this.get(x, y));
    }
    return out;
  }

  toCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = this.w;
    canvas.height = this.h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(this.w, this.h);

    for (let i = 0; i < this.data.length; i++) {
      const hex = this.data[i];
      if (!hex) continue;
      const n = parseInt(hex.slice(1), 16);
      img.data[i * 4] = (n >> 16) & 255;
      img.data[i * 4 + 1] = (n >> 8) & 255;
      img.data[i * 4 + 2] = n & 255;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  toTexture(): Texture {
    const tex = Texture.from(this.toCanvas());
    // Nearest-neighbour is non-negotiable: without it the upscale blurs and the
    // whole thing stops reading as pixel art.
    tex.source.scaleMode = 'nearest';
    return tex;
  }
}
