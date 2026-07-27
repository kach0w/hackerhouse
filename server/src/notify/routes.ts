import { Router, type Request, type Response } from 'express';
import type { User } from '@hackerhouse/shared';

export type GetUserState = (userId: string) => User | undefined;

export type EmitAgentDone = (payload: { userId: string; roomId: string }) => void;

export interface NotifyDeps {
  /** From Builder A — `server/src/state/socket.ts` */
  getUserState: GetUserState;
  /**
   * From Builder A — prefer a thin helper over raw `io` export:
   *   emitAgentDone({ userId, roomId }) => io.emit('agent:done', …)
   * Broadcast is fine; Builder B filters on payload.userId === self.
   */
  emitAgentDone: EmitAgentDone;
  /** From `server/src/state/socket.ts` — authenticates the calling hook. */
  verifySession: (token: string) => { userId: string } | null;
}

/**
 * POST /notify
 * body: { userId: string }
 *
 * Claude Code Stop hook hits this. Only fires agent:done when the user is
 * currently in the lounge (come-back nudge). No-op if they're in a room.
 */
export function createNotifyRouter(deps: NotifyDeps): Router {
  const router = Router();

  router.post('/notify', (req: Request, res: Response) => {
    // Identity comes from the signed token the PTY was spawned with, not from
    // the body — otherwise anyone who can reach the server can forge "user X's
    // agent finished" for any X.
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const verified = token ? deps.verifySession(token) : null;
    if (!verified) {
      res.status(401).json({ error: 'a valid session token is required' });
      return;
    }
    const userId = verified.userId;

    const user = deps.getUserState(userId);
    if (!user) {
      // Unknown / offline — acknowledge so the hook doesn't retry-spam
      res.status(200).json({ ok: true, emitted: false, reason: 'unknown_user' });
      return;
    }

    if (user.state !== 'lounge') {
      res.status(200).json({ ok: true, emitted: false, reason: 'not_in_lounge' });
      return;
    }

    // roomId === ownerId by contract; agent-done targets the user's own room
    const roomId = user.userId;
    deps.emitAgentDone({ userId, roomId });
    res.status(200).json({ ok: true, emitted: true });
  });

  return router;
}
