/**
 * The two scripted transitions from PROJECT_OVERVIEW.md, as an explicit state
 * machine.
 *
 *   Lounge → Room:  walk to stairs → fade out → swap view → fade in →
 *                   walk door→desk → terminal drops down
 *   Room → Lounge:  terminal retracts → walk desk→door → fade out →
 *                   swap view → fade in at the stairs → ambient loop resumes
 *
 * It's a machine rather than a chain of callbacks because two different things
 * trigger the same sequence: the "head up to my room" button, and accepting the
 * agent-done character's prompt. Both call `goToRoom` and get identical staging.
 *
 * This module owns sequencing only. It never touches sockets — App emits
 * room:enter / room:leave at the right beat, because those are contract calls
 * and belong next to the rest of the socket usage.
 */

import { DESK, ROOM_DOOR, STAIRS, VISITOR_SLOTS } from './layout';
import type { LoungeStage } from './LoungeStage';
import type { RoomStage } from './RoomStage';

export type View = 'lounge' | 'room';

export type Phase =
  | 'idle'
  | 'walk-to-stairs'
  | 'fade-out'
  | 'fade-in'
  | 'walk-to-desk'
  | 'terminal-in'
  | 'terminal-out'
  | 'walk-to-door';

export const FADE_MS = 380;
export const TERMINAL_MS = 520;

export interface TransitionDeps {
  getLoungeStage: () => LoungeStage | null;
  getRoomStage: () => RoomStage | null;
  setPhase: (p: Phase) => void;
  setView: (v: View) => void;
  /** Tween the black overlay to `opacity` over `ms`. Resolves when done. */
  fade: (opacity: number, ms: number) => Promise<void>;
  /** Drive the terminal's translateY drop-in / retract. */
  setTerminalVisible: (visible: boolean) => void;
  /** Emitted at the beat where the server should learn about the move. */
  onEnterRoom: (roomId: string) => void;
  onLeaveRoom: (roomId: string) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Stages mount asynchronously (Pixi init is async), so wait for the handoff. */
async function waitForStage<T>(get: () => T | null, timeoutMs = 4000): Promise<T | null> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    const s = get();
    if (s) return s;
    await sleep(30);
  }
  return null;
}

export class TransitionRunner {
  private deps: TransitionDeps;
  private busy = false;

  constructor(deps: TransitionDeps) {
    this.deps = deps;
  }

  get isBusy() {
    return this.busy;
  }

  /**
   * @param roomId  whose room to enter — your own, or someone you're visiting
   * @param isOwner drives whether you end up at the desk or in a visitor slot
   */
  async goToRoom(roomId: string, isOwner: boolean) {
    if (this.busy) return;
    this.busy = true;
    const d = this.deps;

    try {
      // 1. Walk to the stairs, in-world, before anything fades.
      d.setPhase('walk-to-stairs');
      const lounge = d.getLoungeStage();
      if (lounge) await lounge.scriptedWalk(STAIRS.x, STAIRS.y);

      // 2. Fade to black.
      d.setPhase('fade-out');
      await d.fade(1, FADE_MS);

      // 3. Swap views behind the black, and tell the server.
      d.onEnterRoom(roomId);
      d.setView('room');
      const room = await waitForStage(d.getRoomStage);
      room?.setSelfPosition(ROOM_DOOR.x, ROOM_DOOR.y);

      // 4. Fade back in on the room, avatar standing at the door.
      d.setPhase('fade-in');
      await d.fade(0, FADE_MS);

      // 5. Walk to the desk (or to a visitor slot if this isn't your room).
      d.setPhase('walk-to-desk');
      const target = isOwner ? DESK : VISITOR_SLOTS[0];
      if (room) await room.scriptedWalk(target.x, target.y);

      // 6. Only once you've arrived does the terminal drop in.
      d.setPhase('terminal-in');
      d.setTerminalVisible(true);
      await sleep(TERMINAL_MS);

      d.setPhase('idle');
    } finally {
      this.busy = false;
    }
  }

  async goToLounge(roomId: string) {
    if (this.busy) return;
    this.busy = true;
    const d = this.deps;

    try {
      // 1. Terminal retracts upward first — it's the thing you're leaving.
      d.setPhase('terminal-out');
      d.setTerminalVisible(false);
      await sleep(TERMINAL_MS);

      // 2. Stand up and walk out.
      d.setPhase('walk-to-door');
      const room = d.getRoomStage();
      if (room) await room.scriptedWalk(ROOM_DOOR.x, ROOM_DOOR.y);

      // 3. Fade to black.
      d.setPhase('fade-out');
      await d.fade(1, FADE_MS);

      // 4. Swap back to the lounge, arriving at the foot of the stairs.
      d.onLeaveRoom(roomId);
      d.setView('lounge');
      const lounge = await waitForStage(d.getLoungeStage);
      lounge?.setSelfPosition(STAIRS.x, STAIRS.y);
      lounge?.setAmbientPaused(true);

      // 5. Fade in, then hand control back to the ambient loop.
      d.setPhase('fade-in');
      await d.fade(0, FADE_MS);
      lounge?.setAmbientPaused(false);

      d.setPhase('idle');
    } finally {
      this.busy = false;
    }
  }
}
