/**
 * Pixi renderer for air hockey. Native pixel resolution, integer-scaled, same
 * as everything else in the world.
 */

import { Application, Container, Sprite } from 'pixi.js';

import { Px } from '../../art/PixelCanvas';
import { METAL, OUTLINE, shade } from '../../art/palette';
import {
  COURT_H,
  COURT_W,
  GOAL_W,
  MALLET_R,
  MALLET_Y,
  PUCK_R,
  type AirHockeyState,
  type Side,
} from './engine';

const ICE = '#dfe9f2';
const ICE_SHADE = '#c9d8e6';
const LINE = '#7fa8c8';

function tableSprite(): Px {
  const p = new Px(COURT_W, COURT_H);

  // Playing surface.
  p.rect(0, 0, COURT_W, COURT_H, ICE);
  p.dither(0, 0, COURT_W, COURT_H, ICE_SHADE, 0);

  // Centre line + face-off circle.
  p.hline(0, COURT_H / 2, COURT_W, LINE);
  for (let a = 0; a < 360; a += 6) {
    const r = 22;
    const x = Math.round(COURT_W / 2 + Math.cos((a * Math.PI) / 180) * r);
    const y = Math.round(COURT_H / 2 + Math.sin((a * Math.PI) / 180) * r);
    p.set(x, y, LINE);
  }
  p.circle(COURT_W / 2, COURT_H / 2, 2, LINE);

  // Goal creases.
  for (const edge of [0, COURT_H - 1]) {
    const gx = (COURT_W - GOAL_W) / 2;
    p.rect(gx, edge === 0 ? 0 : COURT_H - 3, GOAL_W, 3, '#2b3b4d');
  }
  for (const cy of [16, COURT_H - 16]) {
    p.hline((COURT_W - GOAL_W) / 2 - 6, cy, GOAL_W + 12, LINE);
  }

  // Rails — solid except where the goal mouths are.
  const gx0 = (COURT_W - GOAL_W) / 2;
  p.vline(0, 0, COURT_H, METAL.dark);
  p.vline(COURT_W - 1, 0, COURT_H, METAL.dark);
  p.hline(0, 0, gx0, METAL.dark);
  p.hline(gx0 + GOAL_W, 0, gx0, METAL.dark);
  p.hline(0, COURT_H - 1, gx0, METAL.dark);
  p.hline(gx0 + GOAL_W, COURT_H - 1, gx0, METAL.dark);

  return p;
}

function malletSprite(color: string): Px {
  const size = MALLET_R * 2 + 2;
  const p = new Px(size, size);
  p.circle(MALLET_R, MALLET_R, MALLET_R, color);
  p.circle(MALLET_R, MALLET_R, MALLET_R - 3, shade(color, 0.22));
  p.circle(MALLET_R, MALLET_R, MALLET_R - 6, shade(color, -0.18));
  p.outline(OUTLINE);
  return p;
}

function puckSprite(): Px {
  const size = PUCK_R * 2 + 2;
  const p = new Px(size, size);
  p.circle(PUCK_R, PUCK_R, PUCK_R, '#1d2530');
  p.circle(PUCK_R, PUCK_R, PUCK_R - 2, '#2f3d4d');
  p.set(PUCK_R - 2, PUCK_R - 2, '#5d7186');
  return p;
}

export class AirHockeyStage {
  private app = new Application();
  private world = new Container();
  private mallets!: Record<Side, Sprite>;
  private puck!: Sprite;
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

    this.world.addChild(new Sprite(tableSprite().toTexture()));

    this.mallets = {
      bottom: new Sprite(malletSprite('#5fd6cd').toTexture()),
      top: new Sprite(malletSprite('#e8917f').toTexture()),
    };
    for (const side of ['bottom', 'top'] as Side[]) {
      const s = this.mallets[side];
      s.anchor.set(0.5, 0.5);
      s.y = MALLET_Y[side];
      this.world.addChild(s);
    }

    this.puck = new Sprite(puckSprite().toTexture());
    this.puck.anchor.set(0.5, 0.5);
    this.world.addChild(this.puck);

    this.layout();
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.host);
  }

  destroy() {
    this.ro?.disconnect();
    this.app.destroy(true, { children: true });
  }

  render(state: AirHockeyState) {
    this.mallets.bottom.x = state.mallet.bottom;
    this.mallets.top.x = state.mallet.top;
    this.puck.x = state.puck.x;
    this.puck.y = state.puck.y;
    this.puck.visible = state.countdown <= 0 && !state.winner;
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
