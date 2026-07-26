import pty, { type IPty } from 'node-pty';

const BUFFER_CAP = 10_000;

interface TerminalSession {
  pty: IPty;
  buffer: string;
}

const sessions = new Map<string, TerminalSession>();

function appendToBuffer(session: TerminalSession, chunk: string) {
  session.buffer = (session.buffer + chunk).slice(-BUFFER_CAP);
}

function spawnClaudeOrFallback(): IPty {
  const opts = {
    name: 'xterm-color',
    cols: 100,
    rows: 30,
    cwd: process.env.HOME,
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

  const term = spawnClaudeOrFallback();
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
