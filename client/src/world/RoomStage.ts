/**
 * The PixiJS side of a personal room — now the *whole* viewport, not a strip.
 *
 * The room is built around one thing: a large monitor on a desk, with your
 * avatar sitting in front of it. The real xterm terminal is not drawn here —
 * it's a DOM element that `Room.tsx` positions exactly over the monitor's
 * glass, using the rect this stage reports via `onLayout`. That's what makes
 * the agent look like it's running on the machine your character is using.
 *
 * Because the terminal is real DOM sitting on top of the canvas, the bezel
 * sprite deliberately leaves its interior transparent (see `monitorFrame`),
 * and MONITOR_SCREEN in layout.ts is the single source of truth both sides
 * agree on.
 */

import { Application, Container, Sprite, Texture } from 'pixi.js';

import { Px } from '../art/PixelCanvas';
import { OUTLINE, SCREEN, WOOD, shade } from '../art/palette';
import {
  bed,
  bookshelf,
  deskChair,
  deskSlab,
  monitorFrame,
  plant,
  poster,
  rugRound,
  shadowSprite,
  windowPane,
} from '../art/props';
import { FLOOR_VARIANTS, baseboardTile, floorTile, wallTile, wallTopTile } from '../art/tiles';
import type { User } from '@hackerhouse/shared';
import { Avatar } from './Avatar';
import {
  ARRIVE_EPS,
  DESK,
  DESK_TOP,
  MONITOR,
  MONITOR_SCREEN,
  ROOM_CX,
  ROOM_DOOR,
  ROOM_FLOOR_TOP,
  ROOM_FOCUS,
  ROOM_PX_H,
  ROOM_PX_W,
  ROOM_VIEW_H,
  ROOM_VIEW_W,
  ROOM_WALL_ROWS,
  SCRIPT_WALK_SPEED,
  TILE,
  VISITOR_SLOTS,
  facingFromDelta,
} from './layout';

/** Where the terminal should sit, in CSS pixels relative to the host element. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RoomCallbacks {
  /** Fires whenever the monitor's glass moves or resizes. */
  onLayout?: (rect: ScreenRect) => void;
}

/**
 * Explicit depth bands. The room has a fixed composition, so hand-assigned
 * z-order is clearer (and less fragile) than deriving everything from y.
 */
const Z = {
  wallDecor: 10,
  furniture: 100,
  desk: 190,
  monitor: 195,
  chair: 200,
  occupant: 210,
};

function doorSprite(): Px {
  const p = new Px(34, 56);
  p.rect(0, 0, 34, 56, shade(WOOD.dark, -0.25));
  p.rect(3, 3, 28, 50, WOOD.base);
  p.rect(3, 3, 28, 2, WOOD.light);
  p.rect(7, 8, 9, 17, shade(WOOD.dark, -0.12));
  p.rect(19, 8, 9, 17, shade(WOOD.dark, -0.12));
  p.rect(7, 29, 9, 19, shade(WOOD.dark, -0.12));
  p.rect(19, 29, 9, 19, shade(WOOD.dark, -0.12));
  p.circle(26, 29, 2, '#d8c08a');
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

  private scale = 1;
  private offset = { x: 0, y: 0 };

  private host: HTMLElement;
  private cb: RoomCallbacks;

  constructor(host: HTMLElement, cb: RoomCallbacks = {}) {
    this.host = host;
    this.cb = cb;
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

  /** Current position of the monitor glass, in CSS px within the host. */
  screenRect(): ScreenRect {
    return {
      left: this.offset.x + MONITOR_SCREEN.x * this.scale,
      top: this.offset.y + MONITOR_SCREEN.y * this.scale,
      width: MONITOR_SCREEN.w * this.scale,
      height: MONITOR_SCREEN.h * this.scale,
    };
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
      av.zIndex = Z.occupant;

      if (u.userId === ownerId) {
        av.position.set(DESK.x, DESK.y);
        av.setFacing('up'); // back to the viewer, looking at the monitor
        av.setActivity('sit');
      } else if (u.userId !== selfId) {
        const slot = VISITOR_SLOTS[visitorIdx++ % VISITOR_SLOTS.length];
        av.position.set(slot.x, slot.y);
        av.setFacing(slot.x > DESK.x ? 'left' : 'right');
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

    for (const av of this.avatars.values()) av.update(dt);
  }

  /**
   * Zoom to whatever integer scale keeps roughly ROOM_VIEW_* visible, then
   * centre the camera on the desk. The tilemap is bigger than any viewport, so
   * the room bleeds off every edge instead of floating in a black box.
   */
  private layout() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;

    this.scale = Math.max(2, Math.floor(Math.min(w / ROOM_VIEW_W, h / ROOM_VIEW_H)));
    this.offset = {
      x: Math.round(w / 2 - ROOM_FOCUS.x * this.scale),
      y: Math.round(h / 2 - ROOM_FOCUS.y * this.scale),
    };

    this.world.scale.set(this.scale);
    this.world.position.set(this.offset.x, this.offset.y);
    this.cb.onLayout?.(this.screenRect());
  }

  private drawScene() {
    this.drawFloorAndWalls();
    this.drawFurniture();
  }

  private drawFloorAndWalls() {
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

    // Rug under the desk area.
    const rug = new Sprite(rugRound(190, 92).toTexture());
    rug.position.set(DESK.x - 95, 296);
    this.floorLayer.addChild(rug);

    // Warm spill from the monitor onto the desk and floor, sold with dithering
    // rather than a real light — cheap, and it keeps the pixel look.
    const glow = new Px(MONITOR.w + 40, 56);
    for (let y = 0; y < 56; y++) {
      const density = 1 - y / 56;
      for (let x = 0; x < glow.w; x++) {
        const edge = Math.min(x, glow.w - x) / 30;
        if ((x + y) % 2 === 0 && Math.min(edge, 1) * density > 0.35) {
          glow.set(x, y, SCREEN.glow);
        }
      }
    }
    const glowSprite = new Sprite(glow.toTexture());
    glowSprite.position.set(MONITOR.x - 20, MONITOR.y + MONITOR.h - 6);
    glowSprite.alpha = 0.1;
    this.floorLayer.addChild(glowSprite);
  }

  private drawFurniture() {
    const shadowTex = shadowSprite(48, 14).toTexture();

    const add = (
      px: Px,
      x: number,
      y: number,
      zIndex: number,
      opts: { shadowY?: number } = {},
    ) => {
      const node = new Container();
      if (opts.shadowY !== undefined) {
        const sh = new Sprite(shadowTex);
        sh.anchor.set(0.5, 0.5);
        sh.width = Math.max(20, px.w * 0.85);
        sh.height = 9;
        sh.alpha = 0.32;
        sh.position.set(x + px.w / 2, opts.shadowY);
        node.addChild(sh);
      }
      const sprite = new Sprite(px.toTexture());
      sprite.position.set(x, y);
      node.addChild(sprite);
      node.zIndex = zIndex;
      this.sortLayer.addChild(node);
      return node;
    };

    // --- Wall ---------------------------------------------------------------
    add(windowPane(), ROOM_CX - 228, 120, Z.wallDecor);
    add(poster('#c96f52'), ROOM_CX + 168, 118, Z.wallDecor);
    add(poster('#46ad6a'), ROOM_CX + 204, 138, Z.wallDecor);
    add(poster('#3f84d6'), ROOM_CX - 172, 138, Z.wallDecor);
    add(doorSprite(), ROOM_DOOR.x - 17, ROOM_FLOOR_TOP - 56, Z.wallDecor);

    // --- Floor furniture ----------------------------------------------------
    // Kept close to centre: at the zoom the monitor demands, only about ±240
    // native px either side of the desk is on screen at 1440 wide.
    // In the gap between the monitor's right edge and the bookshelf — well
    // clear of the door, which a previous zoom tune accidentally pulled the
    // bed on top of.
    // Far left — to the LEFT of the door itself, framing it, not squeezed
    // into the gap on its right. Resting forward on the open floor at the
    // same depth as the plants, not up against the back wall like the
    // bookshelf.
    add(bed(), ROOM_DOOR.x - 130, 282, Z.furniture + 40, { shadowY: 338 });
    add(bookshelf(), ROOM_CX + 196, 208, Z.furniture, { shadowY: 258 });
    add(plant(), ROOM_CX + 166, 296, Z.furniture + 40, { shadowY: 330 });

    // --- The desk setup -----------------------------------------------------
    add(deskSlab(DESK_TOP.w, DESK_TOP.h), DESK_TOP.x, DESK_TOP.y, Z.desk, { shadowY: 306 });

    // Monitor sits above the desk band so its stand reads as resting on the
    // surface rather than being swallowed by the slab.
    add(monitorFrame(MONITOR.w, MONITOR.h, {
      x: MONITOR_SCREEN.x - MONITOR.x,
      y: MONITOR_SCREEN.y - MONITOR.y,
      w: MONITOR_SCREEN.w,
      h: MONITOR_SCREEN.h,
    }), MONITOR.x, MONITOR.y, Z.monitor);

    add(deskChair(), DESK.x - 20, 306, Z.chair);
  }
}
