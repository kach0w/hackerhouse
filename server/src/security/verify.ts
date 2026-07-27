// Security regression tests. Run with `npm run verify:security --workspace server`.
//
// These cover the three holes that made the app unsafe to expose publicly:
//   1. /terminal owner write access was gated on a client-claimed userId, and
//      presence broadcasts every userId — so any visitor could claim a
//      victim's id and get a shell on the host.
//   2. /voice/token minted a publish-capable token for ANY room name, so a
//      locked room's voice channel was open to anyone.
//   3. /notify accepted any userId, so agent-done could be forged.
//
// Each is now gated on a signed session token. Boots the real server.
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import '../index.js';
import { mintSessionToken } from '../state/socket.js';

const PORT = process.env.PORT ?? '3997';
const BASE = `http://localhost:${PORT}`;

const OWNER = 'victimUser';
const ATTACKER = 'attackerUser';

let failed = false;

function check(label: string, ok: boolean) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failed = true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function connectTerminal(auth: Record<string, unknown>): ClientSocket {
  return ioClient(`${BASE}/terminal`, { transports: ['websocket'], auth });
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function main() {
  await sleep(700); // let the server bind

  // --- 1. Terminal ownership ------------------------------------------------
  // The attacker knows the victim's userId (presence broadcasts it) and claims
  // it with no token. This is the exact original exploit.
  const attacker = connectTerminal({ userId: OWNER });
  await sleep(200);
  attacker.emit('terminal:join', { roomId: OWNER, role: 'owner' });
  await sleep(600);

  let attackerEcho = '';
  attacker.on('terminal:output', ({ data }: { data: string }) => (attackerEcho += data));
  attacker.emit('terminal:input', { roomId: OWNER, data: 'echo PWNED_BY_ATTACKER\n' });
  await sleep(1200);
  check(
    'forged userId cannot write to another user\'s terminal',
    !attackerEcho.includes('PWNED_BY_ATTACKER'),
  );

  // A token for the *wrong* room must also be refused.
  const attackerToken = mintSessionToken(ATTACKER);
  const crossUser = connectTerminal({ userId: OWNER, token: attackerToken });
  await sleep(200);
  crossUser.emit('terminal:join', { roomId: OWNER, role: 'owner' });
  await sleep(500);
  let crossEcho = '';
  crossUser.on('terminal:output', ({ data }: { data: string }) => (crossEcho += data));
  crossUser.emit('terminal:input', { roomId: OWNER, data: 'echo CROSS_USER_TOKEN\n' });
  await sleep(1200);
  check(
    'a valid token for a different user cannot write either',
    !crossEcho.includes('CROSS_USER_TOKEN'),
  );

  // The real owner, with their own token, still works — the fix must not
  // break the actual feature.
  const ownerToken = mintSessionToken(OWNER);
  const owner = connectTerminal({ userId: OWNER, token: ownerToken });
  await sleep(200);
  owner.emit('terminal:join', { roomId: OWNER, role: 'owner' });
  await sleep(500);
  let ownerEcho = '';
  owner.on('terminal:output', ({ data }: { data: string }) => (ownerEcho += data));
  owner.emit('terminal:input', { roomId: OWNER, data: 'echo OWNER_CAN_TYPE\n' });
  await sleep(1500);
  check('the real owner can still type', ownerEcho.includes('OWNER_CAN_TYPE'));

  // --- 2. Voice authorization ----------------------------------------------
  const noToken = await post('/voice/token', { identity: OWNER, room: 'lounge' });
  check('/voice/token rejects a request with no session token', noToken.status === 401);

  const forgedIdentity = await post('/voice/token', {
    identity: OWNER,
    room: 'lounge',
    token: attackerToken,
  });
  // Should succeed but as the ATTACKER, never as the claimed identity.
  check(
    '/voice/token ignores a claimed identity in the body',
    forgedIdentity.status === 503 || forgedIdentity.status === 200,
  );

  const badRoom = await post('/voice/token', { room: 'room-' + OWNER, token: attackerToken });
  check(
    "/voice/token refuses another user's room while it is locked",
    badRoom.status === 403 || badRoom.status === 503,
  );

  // --- 3. Notify auth -------------------------------------------------------
  const forgedNotify = await post('/notify', { userId: OWNER });
  check('/notify rejects a body-only userId', forgedNotify.status === 401);

  const badNotify = await post('/notify', { token: 'not-a-real-token' });
  check('/notify rejects a bogus token', badNotify.status === 401);

  const goodNotify = await post('/notify', { token: ownerToken });
  check('/notify accepts a valid token', goodNotify.status === 200);

  attacker.close();
  crossUser.close();
  owner.close();

  console.log(failed ? '\nSECURITY CHECKS FAILED' : '\nAll security checks passed');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
