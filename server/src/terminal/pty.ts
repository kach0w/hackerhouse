import fs from 'node:fs';
import path from 'node:path';
import pty, { type IPty } from 'node-pty';

const BUFFER_CAP = 10_000;

// Demo-only "collaborative coding": each room gets its own pre-made clone/
// branch of a real project at ~/demo/<roomId>, so different rooms' real
// Claude Code sessions are genuinely editing different working copies of
// the same repo instead of colliding in one shared directory. Falls back to
// $HOME if that folder hasn't been set up (e.g. in dev, or a room whose
// owner doesn't have a pre-made demo folder).
function resolveCwd(roomId: string): string {
  const demoDir = path.join(process.env.HOME ?? '', 'demo', roomId);
  return fs.existsSync(demoDir) ? demoDir : process.env.HOME ?? process.cwd();
}

interface TerminalSession {
  pty: IPty;
  buffer: string;
}

const sessions = new Map<string, TerminalSession>();

function appendToBuffer(session: TerminalSession, chunk: string) {
  session.buffer = (session.buffer + chunk).slice(-BUFFER_CAP);
}

function spawnClaudeOrFallback(roomId: string): IPty {
  const cwd = resolveCwd(roomId);
  console.log(`[terminal] room ${roomId} -> cwd ${cwd}`);
  const opts = {
    name: 'xterm-color',
    cols: 100,
    rows: 30,
    cwd,
    env: process.env as Record<string, string>,
  };
  try {
    return pty.spawn('claude', [], opts);
  } catch (err) {
    console.warn(
      `[terminal] "claude" not found on PATH, falling back to $SHELL:`,
      (err as Error).message
    );
    return pty.spawn(process.env.SHELL ?? 'bash', [], opts);
  }
}

/** Lazily creates (or returns the existing) PTY for a room, wired to broadcast output. */
export function getOrCreateSession(
  roomId: string,
  onData: (data: string) => void
): TerminalSession {
  const existing = sessions.get(roomId);
  if (existing) return existing;

  const term = spawnClaudeOrFallback(roomId);
  const session: TerminalSession = { pty: term, buffer: '' };
  sessions.set(roomId, session);

  term.onData((data) => {
    appendToBuffer(session, data);
    onData(data);
  });
  term.onExit(() => {
    sessions.delete(roomId);
  });

  return session;
}

export function getSession(roomId: string): TerminalSession | undefined {
  return sessions.get(roomId);
}
