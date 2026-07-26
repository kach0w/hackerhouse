// Throwaway smoke test for the /terminal namespace. Not part of the app —
// run with `npm run verify:terminal --workspace server`. Boots the real
// server (spawns a real `claude`/$SHELL PTY) and drives an owner + a
// visitor connection through join, input isolation, and buffer replay.
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import '../index.js';

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

function connect(userId: string): ClientSocket {
  return ioClient(URL, { transports: ['websocket'], auth: { userId } });
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

async function main() {
  console.log(`Connecting to ${URL} ...`);
  const owner = connect(ROOM_ID); // userId === roomId -> owner by convention
  const visitor = connect('someoneElse');

  const outputsSeenByVisitor: string[] = [];
  visitor.on('terminal:output', (p: { data: string }) => outputsSeenByVisitor.push(p.data));

  console.log('Test: owner join -> terminal:ready');
  owner.emit('terminal:join', { roomId: ROOM_ID, role: 'owner' });
  const ownerReady = await waitFor<{ roomId: string }>(owner, 'terminal:ready', (r) => r.roomId === ROOM_ID);
  check('owner got terminal:ready', ownerReady.roomId === ROOM_ID);

  // Give the real PTY a moment to boot and print something (banner/prompt).
  await new Promise((r) => setTimeout(r, 2000));

  console.log('Test: visitor joins after there is already output -> gets buffer replay');
  visitor.emit('terminal:join', { roomId: ROOM_ID, role: 'visitor' });
  await waitFor<{ roomId: string }>(visitor, 'terminal:ready', (r) => r.roomId === ROOM_ID);
  const gotBufferedOutput = await waitFor<{ data: string }>(
    visitor,
    'terminal:output',
    () => true
  ).catch(() => null);
  check('visitor received buffered/live output on join', !!gotBufferedOutput);

  console.log('Test: visitor input never reaches the real pty');
  outputsSeenByVisitor.length = 0;
  visitor.emit('terminal:input', { roomId: ROOM_ID, data: 'VISITOR_MARKER_XYZ\r' });
  await new Promise((r) => setTimeout(r, 1500));
  check(
    'no output anywhere contains the visitor-typed marker',
    !outputsSeenByVisitor.some((chunk) => chunk.includes('VISITOR_MARKER_XYZ'))
  );

  console.log('Test: owner input does reach the real pty (round-trips through output)');
  const ownerMarkerSeen = waitFor<{ data: string }>(
    visitor,
    'terminal:output',
    (p) => p.data.includes('OWNER_MARKER_XYZ')
  ).catch(() => null);
  owner.emit('terminal:input', { roomId: ROOM_ID, data: 'OWNER_MARKER_XYZ' });
  check('owner-typed marker round-tripped through the pty to visitors', !!(await ownerMarkerSeen));

  owner.disconnect();
  visitor.disconnect();

  console.log(failed ? '\nSome checks FAILED.' : '\nAll checks passed.');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
