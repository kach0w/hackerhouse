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
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

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
