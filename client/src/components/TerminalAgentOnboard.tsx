/**
 * "Run your own terminal" onboarding — replaces the old flow of copying a
 * session token out of the browser console and running
 * `npm run agent --workspace server` from a full clone of this repo.
 *
 * One curl command, generated from values this component already has (no
 * devtools needed): it downloads local-agent/agent.js + install.sh from this
 * same server, installs deps, and registers an autostarting background
 * service that connects out to this server's /terminal namespace exactly
 * like the old manual script did — so the owner's terminal now runs on
 * their own machine, under their own `claude` login, while the host still
 * relays output to the owner and any spectators the same as always.
 *
 * Owner-only; a visitor watching someone else's room has nothing to install.
 */
import { useState } from 'react';

interface Props {
  serverUrl: string;
  roomId: string;
  sessionToken: string | null;
}

export function TerminalAgentOnboard({ serverUrl, roomId, sessionToken }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // join:ok (and the token it carries) hasn't arrived yet right after
  // connecting — nothing to install a terminal against until it does.
  if (!sessionToken) return null;

  const cmd = `curl -fsSL ${serverUrl}/agent/install.sh | bash -s -- ${serverUrl} ${roomId} ${sessionToken}`;

  const copy = () => {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (!open) {
    return (
      <button className="btn btn-icon" title="Run your own terminal on your own machine" onClick={() => setOpen(true)}>
        💻
      </button>
    );
  }

  return (
    <div className="terminal-agent-onboard">
      <p>Run your own terminal, on your own machine — this happens once, ever.</p>
      <code>{cmd}</code>
      <div className="terminal-agent-onboard-actions">
        <button className="btn" onClick={copy}>
          {copied ? 'copied!' : 'copy'}
        </button>
        <button className="btn" onClick={() => setOpen(false)}>
          close
        </button>
      </div>
    </div>
  );
}
