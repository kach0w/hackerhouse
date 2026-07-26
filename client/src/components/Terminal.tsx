/**
 * ⚠️ PLACEHOLDER — Builder C owns this file. Overwrite it wholesale.
 *
 * Builder B depends on NOTHING here except the props signature below, which
 * comes straight from ENGINEERING_PLAN.md §"Builder C" step 3:
 *
 *     <Terminal roomId={string} mode={'owner' | 'visitor'} />
 *
 * Keep that signature and the Room scene keeps working. Everything else —
 * xterm instance, the /terminal namespace connection, resize handling — is
 * yours, and B will never reach into it.
 *
 * This stub just renders a fake terminal so the Room layout, the drop-down
 * animation, and the owner/visitor distinction are all demoable before the
 * real PTY lands.
 */

interface Props {
  roomId: string;
  mode: 'owner' | 'visitor';
}

const FAKE_LINES = [
  '$ claude',
  '',
  '╭─────────────────────────────────────────────╮',
  '│  ✻ Welcome to Claude Code                   │',
  '╰─────────────────────────────────────────────╯',
  '',
  '> refactor the transition state machine',
  '',
  '● Read(src/world/transitions.ts)',
  '  ⎿  Read 84 lines',
  '',
  '● Update(src/world/transitions.ts)',
  '  ⎿  Added 12 lines, removed 5 lines',
  '',
  '  Waiting on the agent…',
];

export function Terminal({ roomId, mode }: Props) {
  return (
    <div className="terminal-stub">
      <div className="terminal-stub-bar">
        <span className="terminal-stub-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="terminal-stub-title">
          {mode === 'visitor' ? `watching ${roomId} — read only` : 'claude code'}
        </span>
      </div>
      <pre className="terminal-stub-body">
        {FAKE_LINES.join('\n')}
        {mode === 'owner' && <span className="terminal-stub-cursor">▊</span>}
      </pre>
      <div className="terminal-stub-note">
        placeholder — Builder C replaces this file with the real xterm.js view
      </div>
    </div>
  );
}
