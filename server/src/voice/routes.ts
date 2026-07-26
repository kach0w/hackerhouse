import { Router, type Request, type Response } from 'express';
import { AccessToken } from 'livekit-server-sdk';

/**
 * POST /voice/token
 * body: { identity: string; room: string }
 * -> { token: string; url: string }
 *
 * Room naming (Builder D):
 *   lounge           -> "lounge"
 *   personal room    -> "room-" + ownerUserId
 */
export function createVoiceRouter(): Router {
  const router = Router();

  router.post('/voice/token', async (req: Request, res: Response) => {
    const identity = typeof req.body?.identity === 'string' ? req.body.identity.trim() : '';
    const room = typeof req.body?.room === 'string' ? req.body.room.trim() : '';

    if (!identity || !room) {
      res.status(400).json({ error: 'identity and room are required' });
      return;
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !url) {
      res.status(503).json({
        error: 'LiveKit is not configured (need LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)',
      });
      return;
    }

    try {
      const at = new AccessToken(apiKey, apiSecret, {
        identity,
        // short-lived; reconnect on lounge↔room swap anyway
        ttl: '2h',
      });
      at.addGrant({
        roomJoin: true,
        room,
        canPublish: true,
        canSubscribe: true,
      });

      const token = await at.toJwt();
      res.json({ token, url });
    } catch (err) {
      console.error('[voice] token mint failed', err);
      res.status(500).json({ error: 'failed to mint token' });
    }
  });

  return router;
}
