/**
 * A character in the world. Used by both the Lounge and the Room.
 *
 * Renders from the generated sprite sheet in `art/character.ts` — 4 directions,
 * 3 frames. The container's origin is at the character's FEET, which is what
 * y-sorting keys off so avatars pass correctly in front of and behind furniture.
 *
 * The name label is drawn at screen resolution and scaled back down, so it
 * stays legible instead of turning into a blurry 3x-upscaled smear.
 */

import { Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';

import { CHAR_H, CHAR_W, characterSheet, type Dir } from '../art/character';
import { shadowSprite } from '../art/props';
import { WORLD_SCALE } from './layout';
import type { Activity } from './stations';

/** Walk cycle: contact → pass → contact → pass. Reads better than 1,2,1,2. */
const CYCLE = [1, 0, 2, 0];
const FRAME_MS = 150;

let shadowTexture: ReturnType<typeof shadowSprite> | null = null;

export class Avatar extends Container {
  readonly userId: string;

  private body = new Sprite();
  private shadow: Sprite;
  private nameLabel: Text;
  private sitMask: Graphics | null = null;

  private sheet = characterSheet('');
  private facing: Dir = 'down';
  private walking = false;
  private activity: Activity | null = null;

  private clock = 0;
  private cycleIdx = 0;

  constructor(userId: string, name: string, opts: { showLabel?: boolean } = {}) {
    super();
    this.userId = userId;
    this.sheet = characterSheet(userId);

    if (!shadowTexture) shadowTexture = shadowSprite(14, 6);
    this.shadow = new Sprite(shadowTexture.toTexture());
    this.shadow.anchor.set(0.5, 0.5);
    this.shadow.position.set(0, -1);
    this.shadow.alpha = 0.42;
    this.addChild(this.shadow);

    this.body.anchor.set(0.5, 1); // feet at the container origin
    this.addChild(this.body);

    this.nameLabel = new Text({
      text: name,
      style: new TextStyle({
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 11,
        fill: 0xffffff,
        stroke: { color: 0x101018, width: 4 },
      }),
    });
    this.nameLabel.anchor.set(0.5, 1);
    this.nameLabel.scale.set(1 / WORLD_SCALE);
    this.nameLabel.position.set(0, -CHAR_H - 2);
    this.nameLabel.resolution = Math.max(2, window.devicePixelRatio || 1);
    this.nameLabel.visible = opts.showLabel !== false;
    this.addChild(this.nameLabel);

    this.applyFrame();
  }

  setFacing(f: Dir) {
    if (this.facing === f) return;
    this.facing = f;
    this.applyFrame();
  }

  setWalking(w: boolean) {
    if (this.walking === w) return;
    this.walking = w;
    if (!w) {
      this.cycleIdx = 0;
      this.clock = 0;
      this.applyFrame();
    }
  }

  /** What the character is doing while parked at a station. */
  setActivity(a: Activity | null) {
    if (this.activity === a) return;
    this.activity = a;
    // Sitting drops the sprite a few pixels so it reads as being on the couch.
    this.body.y = a === 'sit' ? 4 : 0;
    this.shadow.visible = a !== 'sit';

    if (a === 'sit') {
      // Avatars always render on top of the flat backdrop image, so a chair
      // back can never actually occlude the lower body the way it would in
      // a real depth-sorted scene. Masking off everything below roughly
      // head-and-shoulders height fakes that occlusion — without it, a
      // seated character looks like it's floating in front of the chair
      // rather than sitting in it.
      if (!this.sitMask) {
        this.sitMask = new Graphics();
        this.addChild(this.sitMask);
      }
      const top = this.body.y - CHAR_H;
      const visibleH = CHAR_H * 0.55;
      this.sitMask.clear();
      this.sitMask.rect(-CHAR_W, top, CHAR_W * 2, visibleH);
      this.sitMask.fill(0xffffff);
      this.body.mask = this.sitMask;
    } else {
      this.body.mask = null;
    }
  }

  setName(name: string) {
    if (this.nameLabel.text !== name) this.nameLabel.text = name;
  }

  /** @param dt seconds */
  update(dt: number) {
    if (!this.walking) return;
    this.clock += dt * 1000;
    if (this.clock < FRAME_MS) return;
    this.clock -= FRAME_MS;
    this.cycleIdx = (this.cycleIdx + 1) % CYCLE.length;
    this.applyFrame();
  }

  private applyFrame() {
    const frame = this.walking ? CYCLE[this.cycleIdx] : 0;
    this.body.texture = this.sheet.frames[this.facing][frame];
    this.body.width = CHAR_W;
    this.body.height = CHAR_H;
  }
}

export type { Dir as Facing };
