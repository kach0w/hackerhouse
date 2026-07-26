/**
 * Air hockey overlay. Opens from the air hockey table in the lounge.
 *
 * Controls are ← → only — the mallets are pinned to their own end and slide
 * horizontally, so the game is about reading angles rather than chasing.
 */

import { useEffect, useRef, useState } from 'react';

import { LocalTransport, type Transport } from '../transport';
import { WIN_SCORE, type AirHockeyState, type Side } from './engine';
import { AirHockeyMatch, type Role } from './match';
import { AirHockeyStage } from './AirHockeyStage';

interface Props {
  names: Record<Side, string>;
  role: Role;
  /** Omit to play locally against a bot. */
  transport?: Transport;
  onClose: () => void;
}

export function AirHockey({ names, role, transport, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<AirHockeyStage | null>(null);
  const matchRef = useRef<AirHockeyMatch | null>(null);
  const [state, setState] = useState<AirHockeyState | null>(null);

  const practice = !transport;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const stage = new AirHockeyStage(host);
    const link = transport ?? new LocalTransport();

    const match = new AirHockeyMatch({
      role,
      transport: link,
      bot: practice,
      onState: (s) => {
        stageRef.current?.render(s);
        setState({ ...s, score: { ...s.score }, mallet: { ...s.mallet } });
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
      .catch((err) => console.error('[AirHockey] init failed', err));

    return () => {
      disposed = true;
      match.stop();
      if (!transport) link.close();
      stageRef.current?.destroy();
      stageRef.current = null;
      matchRef.current = null;
    };
  }, [role, transport, practice]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') matchRef.current?.setAxis(-1);
      else if (e.key === 'ArrowRight' || e.key === 'd') matchRef.current?.setAxis(1);
      else if (e.key === 'Escape') onClose();
      else return;
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'a', 'd'].includes(e.key)) matchRef.current?.setAxis(0);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [onClose]);

  const mySide: Side = role === 'host' ? 'bottom' : 'top';
  const winner = state?.winner ?? null;

  return (
    <div className="pong">
      <div className="pong-frame pong-frame--tall">
        <div className="pong-hud">
          <span className={`pong-name${mySide === 'top' ? ' is-me' : ''}`}>{names.top}</span>
          <span className="pong-score">
            {state?.score.top ?? 0} — {state?.score.bottom ?? 0}
          </span>
          <span className={`pong-name${mySide === 'bottom' ? ' is-me' : ''}`}>{names.bottom}</span>
        </div>

        <div className="pong-court pong-court--tall" ref={hostRef} />

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
          <span>first to {WIN_SCORE} · slide with ← → · esc to leave</span>
          {practice && <span className="pong-tag">practice vs bot</span>}
          <button className="btn btn-icon" onClick={onClose} title="Leave">
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
