/**
 * The PixiJS side of a personal room — the bottom quarter of the screen.
 *
 * Much simpler than the lounge: a small fixed scene, no camera and no ambient
 * loop. The owner sits at the desk, visitors park in fixed slots behind them.
 * Native pixel resolution, scaled to fill the pane.
 */

import { Application, Container, Sprite, Texture } from 'pixi.js';

import { Px } from '../art/PixelCanvas';
import { OUTLINE, WOOD, shade } from '../art/palette';
import {
  bed,
  bookshelf,
  deskMonitor,
  deskTable,
  plant,
  rugRound,
  shadowSprite,
} from '../art/props';
import { FLOOR_VARIANTS, baseboardTile, floorTile, wallTile, wallTopTile } from '../art/tiles';
import type { User } from '../contract';
import { Avatar } from './Avatar';
import {
  ARRIVE_EPS,
  DESK,
  ROOM_DOOR,
  ROOM_PX_H,
  ROOM_PX_W,
  ROOM_WALL_ROWS,
  TILE,
  VISITOR_SLOTS,
  SCRIPT_WALK_SPEED,
  facingFromDelta,
} from './layout';

function doorSprite(): Px {
  const p = new Px(26, 40);
  p.rect(0, 0, 26, 40, shade(WOOD.dark, -0.2));
  p.rect(2, 2, 22, 36, WOOD.base);
  p.rect(2, 2, 22, 2, WOOD.light);
  p.rect(5, 6, 7, 12, shade(WOOD.dark, -0.1));
  p.rect(14, 6, 7, 12, shade(WOOD.dark, -0.1));
  p.rect(5, 21, 7, 13, shade(WOOD.dark, -0.1));
  p.rect(14, 21, 7, 13, shade(WOOD.dark, -0.1));
  p.circle(20, 20, 2, '#d8c08a');
  p.outline(OUTLINE);
  return p;
}

export class RoomStage {
  private app = new Application();
  private world = new Container();
  private floorLayer = new Container();
  private sortLayer = new Container();
  private avatars = new Map<string, Avatar>();

  private selfId = '';
  private selfPos = { ...ROOM_DOOR };
  private script: { x: number; y: number; resolve: () => void } | null = null;
  private ro: ResizeObserver | null = null;

  private host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  async init() {
    await this.app.init({
      background: 0x0b0d12,
      antialias: false,
      roundPixels: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      resizeTo: this.host,
    });
    this.host.appendChild(this.app.canvas);

    this.sortLayer.sortableChildren = true;
    this.world.addChild(this.floorLayer);
    this.world.addChild(this.sortLayer);
    this.app.stage.addChild(this.world);

    this.drawScene();
    this.layout();

    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.host);

    this.app.ticker.add((t) => this.tick(t.deltaMS / 1000));
  }

  destroy() {
    this.ro?.disconnect();
    this.script?.resolve();
    this.app.destroy(true, { children: true });
  }

  setSelfPosition(x: number, y: number) {
    this.selfPos = { x, y };
  }

  scriptedWalk(x: number, y: number): Promise<void> {
    this.script?.resolve();
    return new Promise<void>((resolve) => {
      this.script = { x, y, resolve };
    });
  }

  cancelScript() {
    this.script?.resolve();
    this.script = null;
  }

  /** @param occupants everyone whose `roomId` is this room (owner included) */
  syncOccupants(occupants: User[], selfId: string, ownerId: string) {
    this.selfId = selfId;
    const seen = new Set<string>();
    let visitorIdx = 0;

    for (const u of occupants) {
      seen.add(u.userId);
      let av = this.avatars.get(u.userId);
      if (!av) {
        av = new Avatar(u.userId, u.name);
        this.avatars.set(u.userId, av);
        this.sortLayer.addChild(av);
        av.position.set(ROOM_DOOR.x, ROOM_DOOR.y);
      }
      av.setName(u.name);

      if (u.userId === ownerId) {
        av.position.set(DESK.x, DESK.y);
        av.setFacing('up');
        av.setActivity('sit');
      } else if (u.userId !== selfId) {
        const slot = VISITOR_SLOTS[visitorIdx++ % VISITOR_SLOTS.length];
        av.position.set(slot.x, slot.y);
        av.setFacing('left');
        av.setActivity(null);
      } else {
        visitorIdx++;
      }
    }

    for (const [id, av] of this.avatars) {
      if (seen.has(id)) continue;
      av.destroy();
      this.avatars.delete(id);
    }
  }

  private tick(dt: number) {
    const me = this.avatars.get(this.selfId);

    if (me && this.script) {
      const { x, y } = this.script;
      const dx = x - this.selfPos.x;
      const dy = y - this.selfPos.y;
      const d = Math.hypot(dx, dy);

      if (d < Math.max(ARRIVE_EPS, SCRIPT_WALK_SPEED * dt)) {
        this.selfPos = { x, y };
        const done = this.script.resolve;
        this.script = null;
        me.setWalking(false);
        done();
      } else {
        const step = (SCRIPT_WALK_SPEED * dt) / d;
        this.selfPos = { x: this.selfPos.x + dx * step, y: this.selfPos.y + dy * step };
        me.setFacing(facingFromDelta(dx, dy));
        me.setWalking(true);
      }
      me.position.set(this.selfPos.x, this.selfPos.y);
    }

    for (const av of this.avatars.values()) {
      av.zIndex = av.y;
      av.update(dt);
    }
  }

  private layout() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    // Integer scale keeps the pixel grid clean; fall back to fractional only if
    // the pane is shorter than one native height.
    const raw = Math.min(w / ROOM_PX_W, h / ROOM_PX_H);
    const scale = raw >= 1 ? Math.floor(raw) : raw;
    this.world.scale.set(scale);
    this.world.position.set(
      Math.round((w - ROOM_PX_W * scale) / 2),
      Math.round(h - ROOM_PX_H * scale),
    );
  }

  private drawScene() {
    const floorTex = Array.from({ length: FLOOR_VARIANTS }, (_, v) => floorTile(v).toTexture());
    const wallTex = [0, 1, 2].map((v) => wallTile(v).toTexture());
    const topTex = wallTopTile().toTexture();
    const baseTex = baseboardTile().toTexture();

    const place = (tex: Texture, tx: number, ty: number) => {
      const s = new Sprite(tex);
      s.position.set(tx * TILE, ty * TILE);
      this.floorLayer.addChild(s);
    };

    const cols = Math.ceil(ROOM_PX_W / TILE);
    const rows = Math.ceil(ROOM_PX_H / TILE);
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        if (ty === 0) place(topTex, tx, ty);
        else if (ty === ROOM_WALL_ROWS - 1) place(baseTex, tx, ty);
        else if (ty < ROOM_WALL_ROWS) place(wallTex[(tx + ty) % wallTex.length], tx, ty);
        else place(floorTex[(tx * 3 + ty * 5) % floorTex.length], tx, ty);
      }
    }

    const rug = new Sprite(rugRound(72, 40).toTexture());
    rug.position.set(DESK.x - 36, 62);
    this.floorLayer.addChild(rug);

    const shadowTex = shadowSprite(40, 12).toTexture();
    const add = (px: Px, x: number, y: number, footY: number) => {
      const node = new Container();
      const sh = new Sprite(shadowTex);
      sh.anchor.set(0.5, 0.5);
      sh.width = Math.max(18, px.w * 0.8);
      sh.height = 7;
      sh.alpha = 0.35;
      sh.position.set(x + px.w / 2, footY - 2);
      node.addChild(sh);

      const sprite = new Sprite(px.toTexture());
      sprite.position.set(x, y);
      node.addChild(sprite);
      node.zIndex = footY;
      this.sortLayer.addChild(node);
    };

    add(doorSprite(), ROOM_DOOR.x - 13, 8, 48);
    // Monitor sorts behind the seated owner, tabletop sorts in front of them.
    add(deskMonitor(), DESK.x - 20, 26, 34);
    add(deskTable(), DESK.x - 38, 68, 96);
    add(bed(), 262, 24, 84);
    add(bookshelf(), 200, 22, 70);
    add(plant(), 12, 58, 92);
  }
}
