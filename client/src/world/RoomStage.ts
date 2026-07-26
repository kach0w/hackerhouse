/**
 * The PixiJS side of a personal room — a single illustrated background image
 * (walls, desk, monitor, bed, bookshelf, everything) with avatars rendered on
 * top of it, same approach LoungeStage uses for its own backdrop. The real
 * xterm terminal is not drawn here — it's a DOM element that `Room.tsx`
 * positions exactly over the monitor's glass in the artwork, using the rect
 * this stage reports via `onLayout`. That's what makes the agent look like
 * it's running on the machine your character is using.
 *
 * MONITOR_SCREEN in layout.ts is the single source of truth for where that
 * glass sits in the image — keep it in sync if the art file changes.
 */

import { Application, Assets, Container, Graphics, Sprite } from 'pixi.js';

import roomBackgroundUrl from '../assets/room-background.jpeg';
import type { User } from '@hackerhouse/shared';
import { Avatar } from './Avatar';
import {
  ARRIVE_EPS,
  DESK,
  MONITOR_SCREEN,
  ROOM_AVATAR_SCALE,
  ROOM_DOOR,
  ROOM_PX_H,
  ROOM_PX_W,
  SCRIPT_WALK_SPEED,
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

const Z = { occupant: 210 };

/** Don't let a missing avatar deadlock transitions forever. */
const SCRIPT_TIMEOUT_MS = 8000;

export class RoomStage {
  private app = new Application();
  private world = new Container();
  private floorLayer = new Container();
  private sortLayer = new Container();
  private avatars = new Map<string, Avatar>();

  private selfId = '';
  private selfPos = { ...ROOM_DOOR };
  private script: { x: number; y: number; resolve: () => void } | null = null;
  private scriptTimer: ReturnType<typeof setTimeout> | null = null;
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
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      resizeTo: this.host,
    });
    this.host.appendChild(this.app.canvas);

    this.sortLayer.sortableChildren = true;
    this.world.addChild(this.floorLayer);
    this.world.addChild(this.sortLayer);
    this.app.stage.addChild(this.world);

    await this.drawBackdrop();
    this.layout();

    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.host);

    this.app.ticker.add((t) => this.tick(t.deltaMS / 1000));
  }

  destroy() {
    this.ro?.disconnect();
    this.clearScriptTimer();
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
    this.clearScriptTimer();
    const me = this.avatars.get(this.selfId);
    me?.setActivity(null);
    return new Promise<void>((resolve) => {
      this.script = { x, y, resolve };
      this.scriptTimer = setTimeout(() => {
        if (!this.script) return;
        this.selfPos = { x: this.script.x, y: this.script.y };
        const done = this.script.resolve;
        this.script = null;
        this.scriptTimer = null;
        const av = this.avatars.get(this.selfId);
        av?.setWalking(false);
        av?.setActivity(null);
        av?.position.set(this.selfPos.x, this.selfPos.y);
        done();
      }, SCRIPT_TIMEOUT_MS);
    });
  }

  cancelScript() {
    this.clearScriptTimer();
    this.script?.resolve();
    this.script = null;
  }

  private clearScriptTimer() {
    if (this.scriptTimer) {
      clearTimeout(this.scriptTimer);
      this.scriptTimer = null;
    }
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
        av.scale.set(ROOM_AVATAR_SCALE);
        this.avatars.set(u.userId, av);
        this.sortLayer.addChild(av);
        av.position.set(ROOM_DOOR.x, ROOM_DOOR.y);
      }
      av.setName(u.name);
      av.zIndex = Z.occupant;

      // While a scripted walk owns the local avatar, don't snap the owner
      // back into the chair — that fight is what left a stuck sit-frame at
      // the door on the way out.
      const selfScripted = u.userId === selfId && !!this.script;

      if (u.userId === ownerId && !selfScripted) {
        av.position.set(DESK.x, DESK.y);
        av.setFacing('up');
        av.setActivity('sit');
      } else if (u.userId === ownerId && selfScripted) {
        // leave position/activity to tick()
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

      me.setActivity(null);

      if (d < Math.max(ARRIVE_EPS, SCRIPT_WALK_SPEED * dt)) {
        this.selfPos = { x, y };
        const done = this.script.resolve;
        this.script = null;
        this.clearScriptTimer();
        me.setWalking(false);
        me.position.set(this.selfPos.x, this.selfPos.y);
        done();
      } else {
        const step = (SCRIPT_WALK_SPEED * dt) / d;
        this.selfPos = { x: this.selfPos.x + dx * step, y: this.selfPos.y + dy * step };
        me.setFacing(facingFromDelta(dx, dy));
        me.setWalking(true);
        me.position.set(this.selfPos.x, this.selfPos.y);
      }
    }

    for (const av of this.avatars.values()) av.update(dt);
  }

  /** Contain-fit the whole illustrated room within whatever viewport we're given, centered. */
  private layout() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;

    this.scale = Math.min(w / ROOM_PX_W, h / ROOM_PX_H);
    this.offset = {
      x: Math.round((w - ROOM_PX_W * this.scale) / 2),
      y: Math.round((h - ROOM_PX_H * this.scale) / 2),
    };

    this.world.scale.set(this.scale);
    this.world.position.set(this.offset.x, this.offset.y);
    this.cb.onLayout?.(this.screenRect());
  }

  private async drawBackdrop() {
    const tex = await Assets.load(roomBackgroundUrl);
    const sprite = new Sprite(tex);
    sprite.width = ROOM_PX_W;
    sprite.height = ROOM_PX_H;
    this.floorLayer.addChild(sprite);

    // Paint solid black over the glass so a 1px DOM/canvas miss still reads
    // as a powered monitor, not the art's baked-in terminal chrome.
    const blackout = new Graphics();
    blackout.rect(MONITOR_SCREEN.x, MONITOR_SCREEN.y, MONITOR_SCREEN.w, MONITOR_SCREEN.h);
    blackout.fill(0x000000);
    this.floorLayer.addChild(blackout);
  }
}
