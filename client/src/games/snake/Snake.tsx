/**
 * Snake overlay. Opens from the arcade cabinet in the lounge.
 *
 * Arrow keys (or WASD) to steer, eat apples, don't hit a wall or yourself.
 * Single player, so there's no transport or match controller here — the whole
 * game is the engine plus a render loop.
 *
 * The loop lives entirely in refs and never triggers a React render; only the
 * HUD (score / best / game over) is mirrored into state, and only when one of
 * those three values actually changes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { createState, step, turn, type Dir, type SnakeState } from './engine';
import { SnakeStage } from './SnakeStage';

const KEY_TO_DIR: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
};

interface Hud {
  score: number;
  best: number;
  over: boolean;
}

interface Props {
  playerName: string;
  onClose: () => void;
}

export function Snake({ playerName, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<SnakeStage | null>(null);
  const stateRef = useRef<SnakeState>(createState(Date.now() >>> 0));
  const rafRef = useRef(0);

  /** The snake only starts moving once you press a direction. */
  const startedRef = useRef(false);
  const hudRef = useRef<Hud>({ score: 0, best: 0, over: false });

  const [hud, setHud] = useState<Hud>(hudRef.current);
  const [started, setStarted] = useState(false);

  const restart = useCallback(() => {
    stateRef.current = createState(Date.now() >>> 0, stateRef.current.best);
    hudRef.current = { score: 0, best: stateRef.current.best, over: false };
    setHud(hudRef.current);
    startedRef.current = true;
    setStarted(true);
  }, []);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const stage = new SnakeStage(host);

    stage
      .init()
      .then(() => {
        if (disposed) {
          stage.destroy();
          return;
        }
        stageRef.current = stage;
        stage.render(stateRef.current);

        let last = performance.now();
        const loop = (t: number) => {
          if (disposed) return;
          const dt = Math.min(0.05, (t - last) / 1000);
          last = t;

          const s = stateRef.current;
          if (startedRef.current && !s.over) step(s, dt);
          stageRef.current?.render(s);

          const prev = hudRef.current;
          if (s.score !== prev.score || s.over !== prev.over || s.best !== prev.best) {
            hudRef.current = { score: s.score, best: s.best, over: s.over };
            setHud(hudRef.current);
          }

          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      })
      .catch((err) => console.error('[Snake] init failed', err));

    return () => {
      disposed = true;
      cancelAnimationFrame(rafRef.current);
      try {
        stageRef.current?.destroy();
      } catch {
        /* ignore */
      }
      if (stageRef.current !== stage) {
        try {
          stage.destroy();
        } catch {
          /* ignore */
        }
      }
      stageRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        if (!startedRef.current || stateRef.current.over) restart();
        e.preventDefault();
        return;
      }

      const dir = KEY_TO_DIR[e.key];
      if (!dir) return;
      e.preventDefault();
      if (stateRef.current.over) return;
      if (!startedRef.current) {
        startedRef.current = true;
        setStarted(true);
      }
      turn(stateRef.current, dir);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, restart]);

  return (
    <div className="pong" ref={rootRef} tabIndex={-1} role="dialog" aria-label="Snake">
      <div className="pong-frame pong-frame--arcade">
        <div className="pong-hud">
          <span className="pong-name is-me">{playerName}</span>
          <span className="pong-score">{hud.score}</span>
          <span className="pong-name">best {hud.best}</span>
        </div>

        <div className="pong-court pong-court--arcade" ref={hostRef} />

        {!started && !hud.over && (
          <div className="pong-overlay pong-overlay--result">
            <div className="pong-result">SNAKE</div>
            <div className="snake-hint">press an arrow key to start</div>
          </div>
        )}

        {hud.over && (
          <div className="pong-overlay pong-overlay--result">
            <div className="pong-result">game over</div>
            <div className="snake-hint">
              {hud.score} apple{hud.score === 1 ? '' : 's'}
              {hud.score > 0 && hud.score >= hud.best ? ' — new best' : ''}
            </div>
            <div className="pong-actions">
              <button className="btn btn-primary" onClick={restart}>
                Play again
              </button>
              <button className="btn" onClick={onClose}>
                Back to the lounge
              </button>
            </div>
          </div>
        )}

        <div className="pong-foot">
          <span>arrow keys to steer · enter to restart · esc to leave</span>
          <button className="btn btn-icon" onClick={onClose} title="Leave">
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
