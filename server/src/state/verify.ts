// Throwaway smoke test for the presence/room socket logic. Not part of the
// app — run with `npm run verify --workspace server`. Boots its own server
// instance on PORT (set by the npm script) and drives two fake clients
// through join/move/room lock/enter/deny/leave.
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import '../index.js';

const PORT = process.env.PORT ?? '3999';
const URL = `http://localhost:${PORT}`;

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
  const presenceA = await waitFor<{ users: { userId: string }[] }>(
    a,
    'presence:update',
    (p) => p.users.length >= 2,
  );
  const presenceB = await waitFor<{ users: { userId: string }[] }>(
    b,
    'presence:update',
    (p) => p.users.length >= 2,
  );
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

  a.disconnect();
  b.disconnect();

  console.log(failed ? '\nSome checks FAILED.' : '\nAll checks passed.');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
