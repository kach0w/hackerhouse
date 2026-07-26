/**
 * Pixi renderer for pong. Draws at native pixel resolution and integer-scales,
 * same as the rest of the world, so the game looks like it belongs to the
 * lounge rather than like a web widget dropped on top of it.
 */

import { Application, Container, Sprite } from 'pixi.js';

import { Px } from '../../art/PixelCanvas';
import { METAL, OUTLINE, SCREEN, shade } from '../../art/palette';
import {
  BALL_R,
  COURT_H,
  COURT_W,
  PADDLE_H,
  PADDLE_INSET,
  PADDLE_W,
  type PongState,
  type Side,
} from './engine';

function courtSprite(): Px {
  const p = new Px(COURT_W, COURT_H);
  p.rect(0, 0, COURT_W, COURT_H, '#12202b');
  p.dither(0, 0, COURT_W, COURT_H, '#162834', 0);
  return p;
}

function paddleSprite(color: string): Px {
  const p = new Px(PADDLE_W, PADDLE_H);
  p.rect(0, 0, PADDLE_W, PADDLE_H, color);
  p.rect(0, 0, PADDLE_W, 2, shade(color, 0.35));
  p.rect(0, PADDLE_H - 2, PADDLE_W, 2, shade(color, -0.3));
  return p;
}

function ballSprite(): Px {
  const p = new Px(BALL_R * 2 + 2, BALL_R * 2 + 2);
  p.circle(BALL_R, BALL_R, BALL_R, '#f5f0e0');
  p.set(BALL_R - 1, BALL_R - 1, '#ffffff');
  return p;
}

export class PongStage {
  private app = new Application();
  private world = new Container();
  private paddles!: Record<Side, Sprite>;
  private ball!: Sprite;
  private ro: ResizeObserver | null = null;

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

    this.world.addChild(new Sprite(courtSprite().toTexture()));
    this.drawNetAndMarkings();

    this.paddles = {
      left: new Sprite(paddleSprite('#5fd6cd').toTexture()),
      right: new Sprite(paddleSprite('#e8917f').toTexture()),
    };
    for (const side of ['left', 'right'] as Side[]) {
      const s = this.paddles[side];
      s.anchor.set(0.5, 0.5);
      s.x = side === 'left' ? PADDLE_INSET : COURT_W - PADDLE_INSET;
      this.world.addChild(s);
    }

    this.ball = new Sprite(ballSprite().toTexture());
    this.ball.anchor.set(0.5, 0.5);
    this.world.addChild(this.ball);

    this.layout();
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.host);

  }

  destroy() {
    this.ro?.disconnect();
    this.app.destroy(true, { children: true });
  }

  /** Push the latest simulation state into the sprites. */
  render(state: PongState) {
    this.paddles.left.y = state.paddle.left;
    this.paddles.right.y = state.paddle.right;
    this.ball.x = state.ball.x;
    this.ball.y = state.ball.y;
    this.ball.visible = state.countdown <= 0 && !state.winner;
  }

  private drawNetAndMarkings() {
    const p = new Px(COURT_W, COURT_H);
    // Dashed centre net.
    for (let y = 2; y < COURT_H - 2; y += 8) p.rect(COURT_W / 2 - 1, y, 2, 4, '#33566b');
    // Court border.
    p.hline(0, 0, COURT_W, METAL.dark);
    p.hline(0, COURT_H - 1, COURT_W, METAL.dark);
    p.vline(0, 0, COURT_H, shade(OUTLINE, 0.2));
    p.vline(COURT_W - 1, 0, COURT_H, shade(OUTLINE, 0.2));
    // Faint glow bands behind each paddle.
    p.dither(2, 2, 8, COURT_H - 4, SCREEN.base, 0);
    p.dither(COURT_W - 10, 2, 8, COURT_H - 4, SCREEN.base, 1);
    this.world.addChild(new Sprite(p.toTexture()));
  }

  private layout() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    const raw = Math.min(w / COURT_W, h / COURT_H);
    const scale = raw >= 1 ? Math.floor(raw) : raw;
    this.world.scale.set(scale);
    this.world.position.set(
      Math.round((w - COURT_W * scale) / 2),
      Math.round((h - COURT_H * scale) / 2),
    );
  }
}
