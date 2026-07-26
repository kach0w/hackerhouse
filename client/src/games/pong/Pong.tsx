/**
 * Pong overlay — the thing that opens when you click the ping pong table.
 *
 * Input is the one place the "no keyboard control" rule doesn't apply: this is
 * a game, not avatar movement. Mouse/touch drag and arrow keys both work, and
 * the handlers only live while the overlay is open.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { LocalTransport, type Transport } from '../transport';
import { COURT_H, WIN_SCORE, type PongState, type Side } from './engine';
import { PongMatch, type Role } from './match';
import { PongStage } from './PongStage';

interface Props {
  /** Display name for each side. */
  names: Record<Side, string>;
  role: Role;
  /** Omit to play locally against a bot. */
  transport?: Transport;
  onClose: () => void;
}

export function Pong({ names, role, transport, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<PongStage | null>(null);
  const matchRef = useRef<PongMatch | null>(null);
  const [state, setState] = useState<PongState | null>(null);

  const practice = !transport;

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const stage = new PongStage(host);
    const link = transport ?? new LocalTransport();

    const match = new PongMatch({
      role,
      transport: link,
      bot: practice,
      onState: (s) => {
        if (disposed) return;
        stageRef.current?.render(s);
        setState({ ...s, score: { ...s.score }, paddle: { ...s.paddle } });
      },
    });

    stage
      .init()
      .then(() => {
        if (disposed) {
          stage.destroy();
          return;
        }
        stageRef.current = stage;
        matchRef.current = match;
        match.start();
      })
      .catch((err) => console.error('[Pong] init failed', err));

    return () => {
      disposed = true;
      match.stop();
      if (!transport) link.close();
      try {
        stageRef.current?.destroy();
      } catch {
        /* pixi may already be torn down */
      }
      if (stageRef.current !== stage) {
        try {
          stage.destroy();
        } catch {
          /* ignore */
        }
      }
      stageRef.current = null;
      matchRef.current = null;
    };
  }, [role, transport, practice]);

  // --- Input ---------------------------------------------------------------

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'w') matchRef.current?.setAxis(-1);
      else if (e.key === 'ArrowDown' || e.key === 's') matchRef.current?.setAxis(1);
      else if (e.key === 'Escape') onClose();
      else return;
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'w', 's'].includes(e.key)) matchRef.current?.setAxis(0);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [onClose]);

  /** Pointer control: map cursor height within the court to a paddle target. */
  const onPointer = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const match = matchRef.current;
    if (!match) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const wanted = ((e.clientY - rect.top) / rect.height) * COURT_H;
    const current = match.snapshot.paddle[match.side];
    const delta = wanted - current;
    match.setAxis(Math.abs(delta) < 2 ? 0 : Math.sign(delta));
  }, []);

  const mySide: Side = role === 'host' ? 'left' : 'right';
  const winner = state?.winner ?? null;

  return (
    <div className="pong" ref={rootRef} tabIndex={-1} role="dialog" aria-label="Pong">
      <div className="pong-frame">
        <div className="pong-hud">
          <span className={`pong-name${mySide === 'left' ? ' is-me' : ''}`}>{names.left}</span>
          <span className="pong-score">
            {state?.score.left ?? 0} — {state?.score.right ?? 0}
          </span>
          <span className={`pong-name${mySide === 'right' ? ' is-me' : ''}`}>{names.right}</span>
        </div>

        <div className="pong-court" ref={hostRef} onPointerMove={onPointer} />

        {state && state.countdown > 0 && !winner && (
          <div className="pong-overlay">{Math.ceil(state.countdown)}</div>
        )}

        {winner && (
          <div className="pong-overlay pong-overlay--result">
            <div className="pong-result">
              {winner === mySide ? 'you win' : `${names[winner]} wins`}
            </div>
            <div className="pong-actions">
              <button className="btn btn-primary" onClick={() => matchRef.current?.rematch()}>
                Rematch
              </button>
              <button className="btn" onClick={onClose}>
                Back to the lounge
              </button>
            </div>
          </div>
        )}

        <div className="pong-foot">
          <span>first to {WIN_SCORE} · move with the mouse or ↑ ↓ · esc to leave</span>
          {practice && <span className="pong-tag">practice vs bot</span>}
          <button className="btn btn-icon" onClick={onClose} title="Leave">
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
