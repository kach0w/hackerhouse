// Throwaway smoke test for the /terminal namespace. Not part of the app —
// run with `npm run verify:terminal --workspace server`. Boots the real
// server (spawns a real `claude`/$SHELL PTY) and drives an owner + a
// visitor connection through join, input isolation, and buffer replay.
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import '../index.js';
import { mintSessionToken } from '../state/socket.js';

const PORT = process.env.PORT ?? '3998';
const URL = `http://localhost:${PORT}/terminal`;
const ROOM_ID = 'ownerUser';

let failed = false;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failed = true;
  }
}

/**
 * Owner write access is gated on a signed session token, not a claimed
 * userId — pass one to act as the room owner. Visitors need no token; they
 * get the read-only feed either way.
 */
function connect(userId: string, token?: string): ClientSocket {
  return ioClient(URL, { transports: ['websocket'], auth: { userId, token } });
}

function waitFor<T>(
  socket: ClientSocket,
  event: string,
  predicate: (payload: T) => boolean,
  timeoutMs = 10000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, timeoutMs);
    function handler(payload: T) {
      if (predicate(payload)) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(payload);
      }
    }
    socket.on(event, handler);
  });
}

/**
 * Wait until a stream has stopped producing for `quietMs`. A shell emits its
 * prompt in several chunks while it's still sourcing rc files, and input typed
 * during that window gets swallowed — so "first byte arrived" is not the same
 * as "ready for input".
 */
async function waitForQuiet(count: () => number, quietMs = 600, timeoutMs = 10000) {
  const start = Date.now();
  let last = count();
  let lastChange = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 50));
    const now = count();
    if (now !== last) {
      last = now;
      lastChange = Date.now();
    } else if (now > 0 && Date.now() - lastChange >= quietMs) {
      return true;
    }
  }
  return count() > 0;
}

/** Poll until a condition holds, instead of guessing with a fixed sleep. */
async function waitUntil(predicate: () => boolean, timeoutMs = 10000, stepMs = 50) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return predicate();
}

async function main() {
  console.log(`Connecting to ${URL} ...`);
  const owner = connect(ROOM_ID, mintSessionToken(ROOM_ID));
  const visitor = connect('someoneElse');

  // Collect from the moment each socket exists. The server emits the buffer
  // replay in the same tick as terminal:ready, so attaching a listener *after*
  // awaiting ready races with — and usually loses to — the replay itself.
  const outputsSeenByVisitor: string[] = [];
  visitor.on('terminal:output', (p: { data: string }) => outputsSeenByVisitor.push(p.data));
  const outputsSeenByOwner: string[] = [];
  owner.on('terminal:output', (p: { data: string }) => outputsSeenByOwner.push(p.data));

  console.log('Test: owner join -> terminal:ready');
  owner.emit('terminal:join', { roomId: ROOM_ID, role: 'owner' });
  const ownerReady = await waitFor<{ roomId: string }>(owner, 'terminal:ready', (r) => r.roomId === ROOM_ID);
  check('owner got terminal:ready', ownerReady.roomId === ROOM_ID);

  // Wait for the PTY to actually print something (banner/prompt) rather than
  // sleeping a fixed 2s — a plain $SHELL emits far less, and far later, than
  // Claude Code's TUI, which made this race.
  const ptyAlive = await waitUntil(() => outputsSeenByOwner.length > 0);
  check('pty produced output for the owner', ptyAlive);

  console.log('Test: visitor joins after there is already output -> gets buffer replay');
  visitor.emit('terminal:join', { roomId: ROOM_ID, role: 'visitor' });
  await waitFor<{ roomId: string }>(visitor, 'terminal:ready', (r) => r.roomId === ROOM_ID);
  const gotBufferedOutput = await waitUntil(() => outputsSeenByVisitor.length > 0);
  check('visitor received buffered/live output on join', gotBufferedOutput);

  console.log('Test: visitor input never reaches the real pty');
  outputsSeenByVisitor.length = 0;
  visitor.emit('terminal:input', { roomId: ROOM_ID, data: 'VISITOR_MARKER_XYZ\r' });
  await new Promise((r) => setTimeout(r, 1500));
  check(
    'no output anywhere contains the visitor-typed marker',
    !outputsSeenByVisitor.join('').includes('VISITOR_MARKER_XYZ')
  );

  console.log('Test: owner input does reach the real pty (round-trips through output)');
  await waitForQuiet(() => outputsSeenByOwner.length);
  outputsSeenByVisitor.length = 0;
  owner.emit('terminal:input', { roomId: ROOM_ID, data: 'OWNER_MARKER_XYZ' });
  // Join the stream before matching: a PTY echo can be split across chunks
  // ("OWNER_MAR" + "KER_XYZ"), so a per-chunk `includes` misses it at random.
  const ownerMarkerSeen = await waitUntil(() =>
    outputsSeenByVisitor.join('').includes('OWNER_MARKER_XYZ'),
  );
  check('owner-typed marker round-tripped through the pty to visitors', ownerMarkerSeen);

  owner.disconnect();
  visitor.disconnect();

  console.log(failed ? '\nSome checks FAILED.' : '\nAll checks passed.');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
