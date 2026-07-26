/**
 * The PixiJS side of the lounge. Kept out of React entirely — React owns
 * presence state and pushes it in via `syncUsers`, and the render loop here
 * never re-renders a component.
 *
 * Everything is built at native pixel resolution and the whole world container
 * is scaled by an integer factor, so the art stays crisp. The camera follows
 * the local player and clamps at the room edges.
 */

import { Application, Container, Sprite, Texture } from 'pixi.js';

import { Px } from '../art/PixelCanvas';
import { METAL, OUTLINE, WALL, WOOD, shade } from '../art/palette';
import { corgiPet, shadowSprite } from '../art/props';
import { FLOOR_VARIANTS, baseboardTile, floorTile, wallTile, wallTopTile } from '../art/tiles';
import type { User } from '@hackerhouse/shared';
import { Avatar, type Facing } from './Avatar';
import { AmbientController } from './ambient';
import {
  ARRIVE_EPS,
  FLOOR_TOP,
  LOUNGE_H,
  LOUNGE_PX_H,
  LOUNGE_PX_W,
  LOUNGE_W,
  SCRIPT_WALK_SPEED,
  STAIRS,
  TILE,
  WALK_SPEED,
  WALL_ROWS,
  WORLD_SCALE,
  clampToFloor,
  facingFromDelta,
} from './layout';
import { DECOR, STATIONS } from './stations';

/** How fast remote avatars catch up to their last broadcast position. */
const PEER_LERP = 12;

/** Camera easing — snappy enough to keep up, soft enough not to jitter. */
const CAM_LERP = 6;

/** A corgi wanders slower and lazier than the ambient human loop. */
const PET_SPEED = WALK_SPEED * 0.55;

interface Pet {
  container: Container;
  sprite: Sprite;
  pos: { x: number; y: number };
  target: { x: number; y: number } | null;
  timer: number;
  facingLeft: boolean;
}

/**
 * Roughly how much of the room we want on screen, in native px. The zoom is
 * derived from this so a laptop and a big monitor frame the lounge the same
 * way, instead of the monitor just showing more empty floor.
 */
const VIEW_TARGET_W = 380;
const VIEW_TARGET_H = 260;
const MIN_SCALE = 2;
const MAX_SCALE = 4;

export interface LoungeCallbacks {
  onSelfMove: (x: number, y: number, facing: Facing) => void;
  /** Clicking a station with a `minigame` opens its game overlay — see Lounge.tsx. */
  onStationClick?: (stationId: string) => void;
}

interface PeerTarget {
  x: number;
  y: number;
  facing: Facing;
  still: number;
}

/** Staircase leading up to the rooms, authored inline since it's one-of-a-kind. */
function stairsSprite(): Px {
  const w = 64;
  const h = 58;
  const p = new Px(w, h);

  // Dark stairwell recess.
  p.rect(0, 0, w, h, shade(WALL.dark, -0.45));

  // Steps, receding upward and getting darker with depth.
  for (let i = 0; i < 6; i++) {
    const y = h - 10 - i * 8;
    const inset = i;
    const tone = shade(WOOD.base, -0.05 - i * 0.06);
    p.rect(2 + inset, y, w - 4 - inset * 2, 6, tone);
    p.hline(2 + inset, y, w - 4 - inset * 2, shade(tone, 0.28));
    p.hline(2 + inset, y + 5, w - 4 - inset * 2, OUTLINE);
  }

  // Banisters.
  p.rect(0, 6, 3, h - 6, METAL.dark);
  p.rect(w - 3, 6, 3, h - 6, METAL.dark);
  p.rect(0, 6, 3, 2, METAL.light);
  p.rect(w - 3, 6, 3, 2, METAL.light);

  p.outline(OUTLINE);
  return p;
}

export class LoungeStage {
  private app = new Application();
  private world = new Container();
  private floorLayer = new Container();
  private sortLayer = new Container();
  private avatars = new Map<string, Avatar>();
  private targets = new Map<string, PeerTarget>();
  private pets: Pet[] = [];

  private selfId = '';
  // Defaults to the stairs, not an arbitrary floor coordinate: that's the
  // door back from a room, and the only spot a freshly-created stage can be
  // sure is correct before `setSelfPosition` has had a chance to run.
  private selfPos = { ...STAIRS };
  private ambient: AmbientController | null = null;
  private ambientPaused = false;
  private script: { x: number; y: number; resolve: () => void } | null = null;
  private users: User[] = [];

  private cam = { x: 240, y: 200 };
  private ro: ResizeObserver | null = null;

  private host: HTMLElement;
  private cb: LoungeCallbacks;

  constructor(host: HTMLElement, cb: LoungeCallbacks) {
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

    this.world.scale.set(WORLD_SCALE);
    this.world.addChild(this.floorLayer);
    this.world.addChild(this.sortLayer);
    this.sortLayer.sortableChildren = true;
    this.app.stage.addChild(this.world);

    this.drawFloorAndWalls();
    this.drawProps();
    this.spawnPets();
    this.centerCamera(true);

    this.ro = new ResizeObserver(() => this.centerCamera(true));
    this.ro.observe(this.host);

    this.app.ticker.add((ticker) => this.tick(ticker.deltaMS / 1000));
  }

  destroy() {
    this.ro?.disconnect();
    this.script?.resolve();
    this.app.destroy(true, { children: true });
  }

  setAmbientPaused(paused: boolean) {
    this.ambientPaused = paused;
    if (paused) this.ambient?.reset();
  }

  /**
   * Take manual control and walk the local avatar to a point, resolving on
   * arrival. Used by the transitions — e.g. walking to the stairs before the
   * fade to black.
   */
  scriptedWalk(x: number, y: number): Promise<void> {
    this.setAmbientPaused(true);
    this.script?.resolve();
    return new Promise<void>((resolve) => {
      this.script = { x, y, resolve };
    });
  }

  cancelScript() {
    this.script?.resolve();
    this.script = null;
  }

  setSelfPosition(x: number, y: number) {
    this.selfPos = { x, y };
    this.centerCamera(true);
  }

  syncUsers(users: User[], selfId: string) {
    this.users = users;
    if (selfId !== this.selfId) {
      this.selfId = selfId;
      this.ambient = new AmbientController(selfId);
    }

    const seen = new Set<string>();
    for (const u of users) {
      if (u.state !== 'lounge') continue;
      seen.add(u.userId);

      let av = this.avatars.get(u.userId);
      if (!av) {
        // Not clickable — visiting a room only happens via the sidebar
        // roster now, so avatars are purely decorative in the lounge scene.
        av = new Avatar(u.userId, u.name);
        this.avatars.set(u.userId, av);
        this.sortLayer.addChild(av);

        if (u.userId === this.selfId) {
          // Spawn at whatever the transition already staged via
          // setSelfPosition (defaults to the stairs) — never the server's
          // possibly-stale `u.x/u.y`, which is only meaningful for peers.
          av.position.set(this.selfPos.x, this.selfPos.y);
        } else {
          av.position.set(u.x, u.y);
          this.targets.set(u.userId, { x: u.x, y: u.y, facing: u.facing, still: 0 });
        }
      }
      av.setName(u.name);

      if (u.userId === this.selfId) continue; // authoritative for ourselves
      const t = this.targets.get(u.userId)!;
      t.x = u.x;
      t.y = u.y;
      t.facing = u.facing;
    }

    for (const [id, av] of this.avatars) {
      if (seen.has(id)) continue;
      av.destroy();
      this.avatars.delete(id);
      this.targets.delete(id);
    }
  }

  // --- Frame -----------------------------------------------------------------

  private tick(dt: number) {
    this.updateSelf(dt);
    this.updatePeers(dt);
    this.updatePets(dt);
    this.updateCamera(dt);

    for (const av of this.avatars.values()) av.zIndex = av.y;
  }

  private updateSelf(dt: number) {
    const av = this.avatars.get(this.selfId);
    if (!av || !this.ambient) return;

    // A scripted walk (transition) outranks the ambient loop.
    if (this.script) {
      const { x, y } = this.script;
      const dx = x - this.selfPos.x;
      const dy = y - this.selfPos.y;
      const d = Math.hypot(dx, dy);

      if (d < Math.max(ARRIVE_EPS, SCRIPT_WALK_SPEED * dt)) {
        this.selfPos = { x, y };
        const done = this.script.resolve;
        this.script = null;
        av.setWalking(false);
        done();
      } else {
        const step = (SCRIPT_WALK_SPEED * dt) / d;
        this.selfPos = { x: this.selfPos.x + dx * step, y: this.selfPos.y + dy * step };
        av.setFacing(facingFromDelta(dx, dy));
        av.setWalking(true);
        this.cb.onSelfMove(this.selfPos.x, this.selfPos.y, facingFromDelta(dx, dy));
      }
      av.position.set(this.selfPos.x, this.selfPos.y);
      av.setActivity(null);
      av.update(dt);
      return;
    }

    if (this.ambientPaused) {
      av.position.set(this.selfPos.x, this.selfPos.y);
      av.update(dt);
      return;
    }

    const peers = this.users.filter((u) => u.state === 'lounge' && u.userId !== this.selfId);
    const before = { ...this.selfPos };
    const out = this.ambient.tick(dt, this.selfPos, peers);
    this.selfPos = { x: out.x, y: out.y };

    const moved = Math.hypot(out.x - before.x, out.y - before.y) > 0.01;
    av.position.set(out.x, out.y);
    av.setFacing(out.facing);
    av.setWalking(moved);
    av.setActivity(out.activity);
    av.update(dt);

    this.cb.onSelfMove(out.x, out.y, out.facing);
  }

  private updatePeers(dt: number) {
    for (const [id, av] of this.avatars) {
      if (id === this.selfId) continue;
      const t = this.targets.get(id);
      if (!t) continue;

      const k = Math.min(1, PEER_LERP * dt);
      const nx = av.x + (t.x - av.x) * k;
      const ny = av.y + (t.y - av.y) * k;
      const step = Math.hypot(nx - av.x, ny - av.y);

      av.position.set(nx, ny);

      // `facing` comes over the wire on presence:update (A threaded it through
      // after spotting the handler was dropping it), so we render the peer's
      // real direction rather than guessing it from interpolated motion.
      av.setFacing(t.facing);

      if (step > 0.06) {
        t.still = 0;
        av.setWalking(true);
      } else {
        t.still += dt;
        if (t.still > 0.15) av.setWalking(false);
      }
      av.update(dt);
    }
  }

  /** Follow the local player, clamped so the camera never leaves the room. */
  private updateCamera(dt: number) {
    const k = Math.min(1, CAM_LERP * dt);
    this.cam.x += (this.selfPos.x - this.cam.x) * k;
    this.cam.y += (this.selfPos.y - this.cam.y) * k;
    this.applyCamera();
  }

  private centerCamera(snap: boolean) {
    if (snap) this.cam = { ...this.selfPos };
    this.applyCamera();
  }

  /**
   * Pick an integer zoom that keeps roughly the same slice of the room visible
   * regardless of window size. Integer-only: a fractional upscale of pixel art
   * makes some pixels 2 screen-px and others 3, which shimmers as you walk.
   */
  private computeScale(vw: number, vh: number): number {
    const framing = Math.floor(Math.min(vw / VIEW_TARGET_W, vh / VIEW_TARGET_H));
    // Also zoom enough to cover the viewport vertically where we can, so a tall
    // window doesn't get thick letterbox bars above and below the room.
    const cover = Math.floor(vh / LOUNGE_PX_H);
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.max(framing, cover)));
  }

  private applyCamera() {
    const vw = this.host.clientWidth || 1;
    const vh = this.host.clientHeight || 1;

    const scale = this.computeScale(vw, vh);
    if (this.world.scale.x !== scale) this.world.scale.set(scale);

    const worldW = LOUNGE_PX_W * scale;
    const worldH = LOUNGE_PX_H * scale;

    let x = vw / 2 - this.cam.x * scale;
    let y = vh / 2 - this.cam.y * scale;

    x = worldW <= vw ? (vw - worldW) / 2 : Math.min(0, Math.max(vw - worldW, x));
    y = worldH <= vh ? (vh - worldH) / 2 : Math.min(0, Math.max(vh - worldH, y));

    // Snap to whole screen pixels — subpixel camera positions make an upscaled
    // pixel grid shimmer as it moves.
    this.world.position.set(Math.round(x), Math.round(y));
  }

  // --- Static scenery --------------------------------------------------------

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

    for (let ty = 0; ty < LOUNGE_H; ty++) {
      for (let tx = 0; tx < LOUNGE_W; tx++) {
        if (ty === 0) place(topTex, tx, ty);
        else if (ty < WALL_ROWS - 1) place(wallTex[(tx + ty) % wallTex.length], tx, ty);
        else if (ty === WALL_ROWS - 1) place(baseTex, tx, ty);
        else place(floorTex[(tx * 3 + ty * 5) % floorTex.length], tx, ty);
      }
    }

    // Stairwell, cut into the back wall.
    const stairs = new Sprite(stairsSprite().toTexture());
    stairs.position.set(STAIRS.x - 32, 0);
    this.floorLayer.addChild(stairs);
  }

  private drawProps() {
    const shadowTex = shadowSprite(40, 12).toTexture();

    const add = (
      px: Px,
      x: number,
      y: number,
      footY: number,
      opts: { flat?: boolean; onTap?: () => void; shadow?: boolean } = {},
    ) => {
      const sprite = new Sprite(px.toTexture());
      sprite.position.set(x, y);

      if (opts.flat) {
        this.floorLayer.addChild(sprite);
        return;
      }

      const node = new Container();
      if (opts.shadow !== false) {
        const sh = new Sprite(shadowTex);
        sh.anchor.set(0.5, 0.5);
        sh.width = Math.max(20, px.w * 0.8);
        sh.height = 8;
        sh.alpha = 0.35;
        sh.position.set(x + px.w / 2, footY - 2);
        node.addChild(sh);
      }
      node.addChild(sprite);
      node.zIndex = footY;

      if (opts.onTap) {
        node.eventMode = 'static';
        node.cursor = 'pointer';
        // `pointertap` requires the same target under the cursor at both
        // pointerdown *and* pointerup — but the camera continuously re-centers
        // on the self avatar's ambient wandering, so on any window where the
        // room doesn't fully fit (most laptops), the world scrolls under a
        // held-down cursor and the station slides out from under it before
        // release. That silently drops the click. Firing on pointerdown
        // sidesteps it entirely: these are static furniture, not draggable,
        // so "press" and "tap" are the same gesture here anyway.
        node.on('pointerdown', (e) => {
          if (e.button === 0) opts.onTap!();
        });
      }
      this.sortLayer.addChild(node);
    };

    for (const d of DECOR) {
      add(d.sprite(), d.x, d.y, d.footY, { flat: d.flat, shadow: !d.flat });
    }

    for (const s of STATIONS) {
      add(s.sprite(), s.x, s.y, s.footY, {
        onTap: this.cb.onStationClick ? () => this.cb.onStationClick?.(s.id) : undefined,
      });
    }
  }

  /** A couple of corgis that wander the floor on their own, same as the ambient humans. */
  private spawnPets() {
    const shadowTex = shadowSprite(20, 8).toTexture();
    const starts = [
      { x: 130, y: 300 },
      { x: 230, y: 296 },
    ];

    for (const pos of starts) {
      const container = new Container();
      const sh = new Sprite(shadowTex);
      sh.anchor.set(0.5, 0.5);
      sh.alpha = 0.3;
      sh.position.set(11, 17);
      container.addChild(sh);

      const sprite = new Sprite(corgiPet(false).toTexture());
      container.addChild(sprite);
      container.position.set(pos.x, pos.y);
      this.sortLayer.addChild(container);

      this.pets.push({
        container,
        sprite,
        pos: { ...pos },
        target: null,
        timer: 500 + Math.random() * 2000,
        facingLeft: false,
      });
    }
  }

  private updatePets(dt: number) {
    for (const pet of this.pets) {
      if (!pet.target) {
        pet.timer -= dt * 1000;
        if (pet.timer <= 0) {
          const p = clampToFloor(
            LOUNGE_PX_W * 0.15 + Math.random() * LOUNGE_PX_W * 0.7,
            FLOOR_TOP + 40 + Math.random() * (LOUNGE_PX_H - FLOOR_TOP - 60),
          );
          pet.target = p;
        }
      } else {
        const dx = pet.target.x - pet.pos.x;
        const dy = pet.target.y - pet.pos.y;
        const d = Math.hypot(dx, dy);

        if (d < PET_SPEED * dt) {
          pet.pos = { ...pet.target };
          pet.target = null;
          pet.timer = 1500 + Math.random() * 3500;
        } else {
          const step = (PET_SPEED * dt) / d;
          pet.pos = { x: pet.pos.x + dx * step, y: pet.pos.y + dy * step };
          if (Math.abs(dx) > 1) {
            const facingLeft = dx < 0;
            if (facingLeft !== pet.facingLeft) {
              pet.facingLeft = facingLeft;
              pet.sprite.texture = corgiPet(facingLeft).toTexture();
            }
          }
        }
      }

      pet.container.position.set(pet.pos.x, pet.pos.y);
      pet.container.zIndex = pet.pos.y;
    }
  }
}
