import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// server/src/terminal/agent-routes.ts is right next to the three files it serves.
const DIR = path.dirname(fileURLToPath(import.meta.url));
// -> repo root, where .claude/hooks/ lives.
const REPO_ROOT = path.resolve(DIR, '../../..');

/**
 * Serves the standalone local-agent bundle so install.sh can `curl` it down
 * onto someone else's machine without them cloning this repo. Plain static
 * files, not build output — the standalone agent is deliberately
 * dependency-free from the rest of the monorepo (see standalone-agent.cjs).
 */
export function createAgentRouter(): Router {
  const router = Router();

  router.get('/agent/install.sh', (_req, res) => {
    res.type('text/x-shellscript').send(fs.readFileSync(path.join(DIR, 'install.sh'), 'utf8'));
  });

  router.get('/agent/agent.js', (_req, res) => {
    res.type('application/javascript').send(fs.readFileSync(path.join(DIR, 'standalone-agent.cjs'), 'utf8'));
  });

  router.get('/agent/package.json', (_req, res) => {
    res.type('application/json').send(fs.readFileSync(path.join(DIR, 'agent-package.json'), 'utf8'));
  });

  // Same Stop hook a host-spawned pty installs (pty.ts's ensureNotifyHook) —
  // re-served rather than duplicated so there's one source of truth, and so
  // a standalone agent's claude session fires agent:done exactly like a
  // host-spawned one does.
  router.get('/agent/notify-agent-done.sh', (_req, res) => {
    res
      .type('text/x-shellscript')
      .send(fs.readFileSync(path.join(REPO_ROOT, '.claude/hooks/notify-agent-done.sh'), 'utf8'));
  });

  return router;
}
