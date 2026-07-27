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
export interface VoiceDeps {
  /** From `server/src/state/socket.ts` — proves a claimed identity. */
  verifySession: (token: string) => { userId: string } | null;
  /** From `server/src/state/socket.ts` — used to honour a room's lock. */
  getRoomState: (roomId: string) => { ownerId: string; locked: boolean } | undefined;
}

/**
 * Which voice rooms a given user may join.
 *
 * Without this the endpoint minted a publish-capable token for ANY room name
 * you asked for, so locking your room did nothing to its voice channel —
 * someone refused entry at the door could still sit in the call and talk.
 */
function mayJoin(
  userId: string,
  room: string,
  getRoomState: VoiceDeps['getRoomState'],
): boolean {
  if (room === 'lounge') return true;

  const ownerId = room.startsWith('room-') ? room.slice('room-'.length) : null;
  if (!ownerId) return false; // unknown room shape — deny by default

  if (ownerId === userId) return true; // your own room, locked or not

  const state = getRoomState(ownerId);
  if (!state) return false;
  return !state.locked;
}

export function createVoiceRouter(deps: VoiceDeps): Router {
  const router = Router();

  router.post('/voice/token', async (req: Request, res: Response) => {
    const room = typeof req.body?.room === 'string' ? req.body.room.trim() : '';
    const sessionToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';

    if (!room) {
      res.status(400).json({ error: 'room is required' });
      return;
    }

    // Identity comes from the signed token, never from the request body —
    // otherwise anyone could join voice as anyone else.
    const verified = sessionToken ? deps.verifySession(sessionToken) : null;
    if (!verified) {
      res.status(401).json({ error: 'a valid session token is required' });
      return;
    }
    const identity = verified.userId;

    if (!mayJoin(identity, room, deps.getRoomState)) {
      res.status(403).json({ error: 'not allowed in that voice room' });
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
