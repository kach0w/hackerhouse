/**
 * Pixi renderer for snake. Native pixel resolution, integer-scaled, styled like
 * an arcade CRT so it matches the cabinet you opened it from.
 *
 * The board is redrawn into a single Graphics-free sprite each move rather than
 * keeping a sprite per segment: the snake changes length constantly, and
 * rebuilding one small texture is simpler than pooling dozens of sprites.
 */

import { Application, Container, Sprite, Texture } from 'pixi.js';

import { Px } from '../../art/PixelCanvas';
import { OUTLINE, shade } from '../../art/palette';
import { GRID_H, GRID_W, type SnakeState } from './engine';

/** Native pixels per grid cell. */
export const CELL = 7;
const BOARD_W = GRID_W * CELL;
const BOARD_H = GRID_H * CELL;
/** Bezel around the play area. */
const PAD = 5;

const BG = '#0c1811';
const GRID_LINE = '#12271c';
const SNAKE = '#5fd67a';
const SNAKE_DARK = '#3da257';
const HEAD = '#9df0ae';
const APPLE = '#e8564f';

function backdrop(): Px {
  const p = new Px(BOARD_W + PAD * 2, BOARD_H + PAD * 2);
  p.rect(0, 0, p.w, p.h, '#1b1424');
  p.rect(1, 1, p.w - 2, p.h - 2, shade('#1b1424', 0.18));
  p.rect(PAD - 1, PAD - 1, BOARD_W + 2, BOARD_H + 2, OUTLINE);
  p.rect(PAD, PAD, BOARD_W, BOARD_H, BG);

  // Faint grid so movement reads as stepping between cells.
  for (let x = 1; x < GRID_W; x++) p.vline(PAD + x * CELL, PAD, BOARD_H, GRID_LINE);
  for (let y = 1; y < GRID_H; y++) p.hline(PAD, PAD + y * CELL, BOARD_W, GRID_LINE);
  return p;
}

export class SnakeStage {
  private app = new Application();
  private world = new Container();
  private board!: Sprite;
  private ro: ResizeObserver | null = null;
  private lastTexture: Texture | null = null;

  private host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  async init() {
    await this.app.init({
      background: 0x0a1018,
      antialias: false,
      roundPixels: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      resizeTo: this.host,
    });
    this.host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);

    this.world.addChild(new Sprite(backdrop().toTexture()));
    this.board = new Sprite();
    this.board.position.set(PAD, PAD);
    this.world.addChild(this.board);

    this.layout();
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.host);
  }

  destroy() {
    this.ro?.disconnect();
    this.lastTexture?.destroy(true);
    this.app.destroy(true, { children: true });
  }

  render(state: SnakeState) {
    const p = new Px(BOARD_W, BOARD_H);

    // Apple, drawn as a little round fruit with a stem.
    const ax = state.apple.x * CELL;
    const ay = state.apple.y * CELL;
    p.rect(ax + 1, ay + 2, CELL - 2, CELL - 3, APPLE);
    p.rect(ax + 2, ay + 1, CELL - 4, CELL - 1, APPLE);
    p.set(ax + 2, ay + 2, shade(APPLE, 0.4));
    p.set(ax + 3, ay, '#4a7d3f');

    // Body back-to-front so the head lands on top.
    for (let i = state.snake.length - 1; i >= 0; i--) {
      const c = state.snake[i];
      const x = c.x * CELL;
      const y = c.y * CELL;
      const isHead = i === 0;
      p.rect(x, y, CELL - 1, CELL - 1, isHead ? HEAD : SNAKE);
      p.rect(x, y, CELL - 1, 1, isHead ? '#c9ffd6' : shade(SNAKE, 0.25));
      p.rect(x, y + CELL - 2, CELL - 1, 1, SNAKE_DARK);
      if (isHead) {
        // Eyes, oriented with travel direction.
        const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[state.dir];
        const ex = 2 + v[0];
        const ey = 2 + v[1];
        p.set(x + ex, y + ey, OUTLINE);
        p.set(x + ex + (v[0] === 0 ? 2 : 0), y + ey + (v[1] === 0 ? 2 : 0), OUTLINE);
      }
    }

    const next = p.toTexture();
    this.board.texture = next;
    this.lastTexture?.destroy(true);
    this.lastTexture = next;
  }

  private layout() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    const fullW = BOARD_W + PAD * 2;
    const fullH = BOARD_H + PAD * 2;
    const raw = Math.min(w / fullW, h / fullH);
    const scale = raw >= 1 ? Math.floor(raw) : raw;
    this.world.scale.set(scale);
    this.world.position.set(
      Math.round((w - fullW * scale) / 2),
      Math.round((h - fullH * scale) / 2),
    );
  }
}
