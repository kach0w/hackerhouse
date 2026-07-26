// Throwaway smoke test for the presence/room socket logic. Not part of the
// app — run with `npm run verify --workspace server`. Boots its own server
// instance on PORT (set by the npm script) and drives two fake clients
// through join/move/room lock/enter/deny/leave.
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import '../index.js';

const PORT = process.env.PORT ?? '3999';
const URL = `http://localhost:${PORT}`;
const GRACE_MS = Number(process.env.DISCONNECT_GRACE_MS) || 30_000;

let failed = false;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failed = true;
  }
}

function connect(userId: string, name: string): Promise<ClientSocket> {
  const socket = ioClient(URL, { transports: ['websocket'] });
  return new Promise((resolve) => {
    socket.on('connect', () => {
      socket.emit('join', { userId, name });
      resolve(socket);
    });
  });
}

/** Like `connect`, but also captures the session token from `join:ok`. */
function connectAndJoin(
  userId: string,
  name: string,
  token?: string,
): Promise<{ socket: ClientSocket; userId: string; token: string }> {
  const socket = ioClient(URL, { transports: ['websocket'] });
  return new Promise((resolve) => {
    socket.on('join:ok', (payload: { userId: string; token: string }) =>
      resolve({ socket, userId: payload.userId, token: payload.token }),
    );
    socket.on('connect', () => socket.emit('join', { userId, name, token }));
  });
}

function waitFor<T>(
  socket: ClientSocket,
  event: string,
  predicate: (payload: T) => boolean,
  timeoutMs = 2000,
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
  const a = await connect('userA', 'Alice');
  const b = await connect('userB', 'Bob');

  console.log('Test: join -> presence:update with both users');
  // Register both listeners up front (Promise.all) rather than sequential
  // awaits — B's join can complete and broadcast before a listener is ever
  // attached to B's socket if we wait on A first, dropping the event B
  // needed and hanging this test.
  const [presenceA, presenceB] = await Promise.all([
    waitFor<{ users: { userId: string }[] }>(a, 'presence:update', (p) => p.users.length >= 2),
    waitFor<{ users: { userId: string }[] }>(b, 'presence:update', (p) => p.users.length >= 2),
  ]);
  check('A sees both users', presenceA.users.some((u) => u.userId === 'userA') && presenceA.users.some((u) => u.userId === 'userB'));
  check('B sees both users', presenceB.users.some((u) => u.userId === 'userA') && presenceB.users.some((u) => u.userId === 'userB'));

  console.log('Test: move -> broadcast throttled presence update reflects new position');
  a.emit('move', { x: 42, y: 7, facing: 'down' });
  const movedPresence = await waitFor<{ users: { userId: string; x: number; y: number }[] }>(
    b,
    'presence:update',
    (p) => p.users.find((u) => u.userId === 'userA')?.x === 42,
  );
  const movedA = movedPresence.users.find((u) => u.userId === 'userA');
  check('B observes A at x=42,y=7 after throttled flush', movedA?.x === 42 && movedA?.y === 7);

  console.log('Test: locked room rejects a non-owner');
  a.emit('room:lock', { locked: true });
  await waitFor<{ locked: boolean }>(a, 'room:update', (r) => r.locked === true);
  b.emit('room:enter', { roomId: 'userA' });
  const denial = await waitFor<{ roomId: string; reason: string }>(b, 'room:enter:denied', (d) => d.roomId === 'userA');
  check('B denied entry to locked room userA', denial.reason === 'locked');

  console.log('Test: unlocked room accepts a visitor and updates presence + room state');
  a.emit('room:lock', { locked: false });
  await waitFor<{ locked: boolean }>(a, 'room:update', (r) => r.locked === false);
  const roomUpdatePromise = waitFor<{ roomId: string; occupants: string[] }>(
    b,
    'room:update',
    (r) => r.roomId === 'userA' && r.occupants.includes('userB'),
  );
  const enteredPresencePromise = waitFor<{ users: { userId: string; roomId: string | null }[] }>(
    b,
    'presence:update',
    (p) => p.users.find((u) => u.userId === 'userB')?.roomId === 'userA',
  );
  b.emit('room:enter', { roomId: 'userA' });
  const [roomUpdate, enteredPresence] = await Promise.all([roomUpdatePromise, enteredPresencePromise]);
  check('room:update shows B as occupant', roomUpdate.occupants.includes('userB'));
  check('presence:update shows B.roomId === userA', enteredPresence.users.find((u) => u.userId === 'userB')?.roomId === 'userA');

  console.log('Test: room:enter cleans up the occupant\'s previous room (no ghost occupants)');
  const c = await connect('userC', 'Carol');
  await waitFor<{ users: { userId: string }[] }>(c, 'presence:update', (p) => p.users.length >= 3);
  const cEntersA = waitFor<{ roomId: string; occupants: string[] }>(
    c,
    'room:update',
    (r) => r.roomId === 'userA' && r.occupants.includes('userC'),
  );
  c.emit('room:enter', { roomId: 'userA' });
  await cEntersA;
  // C jumps straight into B's room without an intervening room:leave.
  const cEntersB = waitFor<{ roomId: string; occupants: string[] }>(
    c,
    'room:update',
    (r) => r.roomId === 'userB' && r.occupants.includes('userC'),
  );
  c.emit('room:enter', { roomId: 'userB' });
  const roomBAfterC = await cEntersB;
  check('C is now an occupant of room userB', roomBAfterC.occupants.includes('userC'));
  // Force a fresh room:update for A's room (toggling the lock re-broadcasts
  // it) and confirm C was actually removed from it when C moved to userB.
  const roomAFresh = waitFor<{ roomId: string; occupants: string[] }>(a, 'room:update', (r) => r.roomId === 'userA');
  a.emit('room:lock', { locked: false });
  const finalRoomA = await roomAFresh;
  check('C no longer ghosts in room userA after moving to userB', !finalRoomA.occupants.includes('userC'));

  console.log('Test: a stale socket\'s late disconnect does not wipe a reconnected user');
  const d1 = await connect('userD', 'Dana');
  await waitFor<{ users: { userId: string }[] }>(d1, 'presence:update', (p) => p.users.some((u) => u.userId === 'userD'));
  const d2 = await connect('userD', 'Dana'); // simulates a browser refresh: same userId, new socket
  await waitFor<{ users: { userId: string }[] }>(d2, 'presence:update', (p) => p.users.some((u) => u.userId === 'userD'));
  d1.disconnect(); // the stale socket's disconnect should be a no-op now that d2 owns userD
  await new Promise((resolve) => setTimeout(resolve, 300));
  d2.emit('move', { x: 99, y: 99, facing: 'up' });
  const afterStaleDisconnect = await waitFor<{ users: { userId: string; x: number; y: number }[] }>(
    c,
    'presence:update',
    (p) => p.users.find((u) => u.userId === 'userD')?.x === 99,
  );
  check(
    'userD survives the stale socket\'s disconnect and stays live on the new socket',
    afterStaleDisconnect.users.some((u) => u.userId === 'userD' && u.x === 99),
  );
  d2.disconnect();

  console.log('Test: join:ok mints a session token; a valid token on reconnect wins over a mismatched claimed userId');
  const erin1 = await connectAndJoin('userE', 'Erin');
  check(
    'join:ok returns a non-empty token bound to the claimed userId',
    erin1.userId === 'userE' && typeof erin1.token === 'string' && erin1.token.length > 0,
  );
  erin1.socket.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const erin2 = await connectAndJoin('someone-else', 'Erin (reconnect)', erin1.token);
  check("a valid token overrides a mismatched claimed userId on reconnect", erin2.userId === 'userE');
  erin2.socket.disconnect();

  console.log('Test: an invalid token falls back to a fresh identity instead of erroring');
  const frank = await connectAndJoin('userF', 'Frank', 'not-a-real-token');
  check('a garbage token does not block a fresh join', frank.userId === 'userF');
  frank.socket.disconnect();

  console.log('Test: disconnect grace period preserves position, and a token reconnect within it cancels the sweep');
  const owner1 = await connectAndJoin('userOwner', 'Owner');
  owner1.socket.emit('move', { x: 55, y: 66, facing: 'left' });
  await waitFor<{ users: { userId: string; x: number }[] }>(
    c,
    'presence:update',
    (p) => p.users.find((u) => u.userId === 'userOwner')?.x === 55,
  );
  const visitor = await connectAndJoin('userVisitor', 'Visitor');
  const visitorEntered = waitFor<{ roomId: string; occupants: string[] }>(
    visitor.socket,
    'room:update',
    (r) => r.roomId === 'userOwner' && r.occupants.includes('userVisitor'),
  );
  visitor.socket.emit('room:enter', { roomId: 'userOwner' });
  await visitorEntered;

  owner1.socket.disconnect();
  await new Promise((resolve) => setTimeout(resolve, Math.min(GRACE_MS / 2, 200)));
  const owner2 = await connectAndJoin('userOwner', 'Owner', owner1.token);
  const ownerReconnectPresence = await waitFor<{ users: { userId: string; x: number; y: number }[] }>(
    owner2.socket,
    'presence:update',
    (p) => p.users.some((u) => u.userId === 'userOwner'),
  );
  const ownerAfterReconnect = ownerReconnectPresence.users.find((u) => u.userId === 'userOwner');
  check(
    'reconnecting within the grace period restores the exact x/y the owner had before disconnecting',
    ownerAfterReconnect?.x === 55 && ownerAfterReconnect?.y === 66,
  );

  console.log("Test: room GC — an owner swept after the grace period expires has their room torn down, occupants sent to the lounge");
  owner2.socket.disconnect();
  const visitorSentHome = waitFor<{ users: { userId: string; state: string; roomId: string | null }[] }>(
    visitor.socket,
    'presence:update',
    (p) => p.users.find((u) => u.userId === 'userVisitor')?.roomId === null,
    GRACE_MS + 2000,
  );
  await new Promise((resolve) => setTimeout(resolve, GRACE_MS + 300));
  const visitorHome = await visitorSentHome;
  const visitorState = visitorHome.users.find((u) => u.userId === 'userVisitor');
  check(
    "visitor is sent back to the lounge once the swept owner's room is GC'd",
    visitorState?.state === 'lounge' && visitorState?.roomId === null,
  );
  visitor.socket.disconnect();

  a.disconnect();
  b.disconnect();
  c.disconnect();

  console.log(failed ? '\nSome checks FAILED.' : '\nAll checks passed.');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
