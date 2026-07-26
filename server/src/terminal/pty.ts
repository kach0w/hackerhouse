import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pty, { type IPty } from 'node-pty';

const BUFFER_CAP = 10_000;

// server/src/terminal/pty.ts → repo root (where .claude/ lives)
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const HOOK_SRC = path.join(REPO_ROOT, '.claude/hooks/notify-agent-done.sh');

/**
 * Always give each room its own working dir under ~/demo/<roomId>.
 * Creating it (instead of falling back to $HOME) means we can install a
 * project-local Claude Stop hook without touching the user's home
 * ~/.claude/settings.json.
 */
function resolveCwd(roomId: string): string {
  const demoDir = path.join(process.env.HOME ?? '', 'demo', roomId);
  fs.mkdirSync(demoDir, { recursive: true });
  return demoDir;
}

/**
 * Claude Code only loads project Stop hooks from the cwd's .claude/.
 * Host-spawned and local-agent Claudes both use ~/demo/<roomId>, which is
 * outside this repo — so copy the notify hook in and point settings at it
 * with an absolute path. Idempotent; refreshes the script from the repo
 * copy on every spawn so hook fixes propagate.
 */
function ensureNotifyHook(cwd: string): void {
  if (!fs.existsSync(HOOK_SRC)) {
    console.warn(`[terminal] notify hook missing at ${HOOK_SRC} — agent-done will not fire`);
    return;
  }

  try {
    const hooksDir = path.join(cwd, '.claude', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });

    const hookDest = path.join(hooksDir, 'notify-agent-done.sh');
    fs.copyFileSync(HOOK_SRC, hookDest);
    fs.chmodSync(hookDest, 0o755);

    const settingsPath = path.join(cwd, '.claude', 'settings.json');
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
      } catch {
        settings = {};
      }
    }

    // Absolute path so this works even if Claude's project root != cwd.
    const escaped = hookDest.replace(/'/g, `'\\''`);
    const prevHooks =
      settings.hooks && typeof settings.hooks === 'object'
        ? (settings.hooks as Record<string, unknown>)
        : {};

    settings.hooks = {
      ...prevHooks,
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: `bash '${escaped}'`,
            },
          ],
        },
      ],
    };

    fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  } catch (err) {
    console.warn('[terminal] failed to install notify Stop hook:', (err as Error).message);
  }
}

/**
 * If this server itself was launched from inside a Claude Code session
 * (e.g. by an agent driving the terminal via a shell tool), CLAUDE_CODE_*
 * markers sit in our own process.env — and every room's spawned `claude`
 * would inherit them, triggering its "transcript saving is off, inherited
 * child-session marker" warning even though each room is a genuinely
 * independent session, not actually nested inside anything.
 */
function cleanEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || key.startsWith('CLAUDE_')) continue;
    env[key] = value;
  }
  return env;
}

interface TerminalSession {
  pty: IPty;
  buffer: string;
}

const sessions = new Map<string, TerminalSession>();

function appendToBuffer(session: TerminalSession, chunk: string) {
  session.buffer = (session.buffer + chunk).slice(-BUFFER_CAP);
}

/**
 * `serverUrl` defaults to the host's own localhost — right for a PTY the
 * host spawns for itself. The local agent (running on someone else's
 * machine entirely) passes its own reachable server URL instead, so that
 * machine's Stop hook posts /notify to the right place.
 *
 * Used by both:
 *   - host-spawned terminals (`getOrCreateSession`)
 *   - `npm run agent` on an owner's machine (`agent.ts`)
 */
export function spawnClaudeOrFallback(roomId: string, serverUrl?: string): IPty {
  const cwd = resolveCwd(roomId);
  ensureNotifyHook(cwd);
  console.log(`[terminal] room ${roomId} -> cwd ${cwd}`);
  const opts = {
    name: 'xterm-color',
    cols: 100,
    rows: 30,
    cwd,
    env: {
      ...cleanEnv(process.env),
      HACKERHOUSE_SERVER_URL: serverUrl ?? `http://localhost:${process.env.PORT ?? '3001'}`,
      HACKERHOUSE_USER_ID: roomId,
    },
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
  onData: (data: string) => void,
  onExit?: () => void
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
    onExit?.();
  });

  return session;
}

export function getSession(roomId: string): TerminalSession | undefined {
  return sessions.get(roomId);
}

/** Snapshot for newly-connecting clients — deltas alone miss sessions already running. */
export function getActiveRoomIds(): string[] {
  return [...sessions.keys()];
}
