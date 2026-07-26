/**
 * The in-world "your agent is done" moment.
 *
 * Instead of a toast or a chime, a character walks down the lounge stairs and
 * tells you directly. Accept runs the Lounge→Room transition immediately;
 * decline dismisses and you head back whenever you feel like it.
 *
 * Rendered as a DOM overlay rather than a Pixi sprite: the stairs sit at the
 * top-centre of the lounge, which is also the top-centre of the canvas at every
 * scale, so a centred overlay lines up with the staircase without needing the
 * world transform. Cheap, and it keeps the sequencing in React where the
 * Accept/Decline buttons already live.
 *
 * The `agent` prop is the seam for per-agent skins — Claude Code vs Codex —
 * which is the only difference between them right now.
 */

import { useEffect, useState } from 'react';

export type AgentKind = 'claude' | 'codex';

const SKIN: Record<AgentKind, { name: string; body: string; accent: string; glyph: string }> = {
  claude: { name: 'Claude', body: '#d97757', accent: '#f2b8a0', glyph: '✻' },
  codex: { name: 'Codex', body: '#4b8f7d', accent: '#8fd2c0', glyph: '◆' },
};

interface Props {
  agent?: AgentKind;
  onAccept: () => void;
  onDecline: () => void;
}

export function AgentDoneCharacter({ agent = 'claude', onAccept, onDecline }: Props) {
  const skin = SKIN[agent];
  // Two beats: walk down the stairs, then speak.
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setArrived(true), 1150);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="messenger">
      <div className={`messenger-char${arrived ? ' is-arrived' : ''}`}>
        <div className="messenger-head" style={{ background: skin.accent }}>
          <span className="messenger-glyph" style={{ color: skin.body }}>
            {skin.glyph}
          </span>
        </div>
        <div className="messenger-body" style={{ background: skin.body }} />
        <div className="messenger-legs">
          <i />
          <i />
        </div>
        <div className="messenger-shadow" />
      </div>

      {arrived && (
        <div className="messenger-bubble">
          <div className="messenger-who">{skin.name}</div>
          <p>your session's done building — time to come back up.</p>
          <div className="messenger-actions">
            <button className="btn btn-primary" onClick={onAccept}>
              Head up
            </button>
            <button className="btn" onClick={onDecline}>
              Not yet
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
