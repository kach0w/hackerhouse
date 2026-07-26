# Hacker House — Engineering Plan (4 builders)

This is the build spec for `PROJECT_OVERVIEW.md`. It locks the tech stack, the
repo layout, and the exact event contract everyone codes against, so all four
of us can go heads-down in parallel without stepping on each other's files.

Scope = the "In scope" list from `PROJECT_OVERVIEW.md` only. Everything in
"Stretch" or "Deprioritized" there is still out. Build the core loop first:
**Lounge → Room → real terminal running Claude Code → Room → Lounge → agent-done
moment.** Voice is core too, but it's a layer on top — it should be the last
thing you wire in, not the first thing you block on.

---

## 0. Locked decisions (don't relitigate these mid-build)

- **Monorepo, npm workspaces**, 3 packages: `shared/`, `server/`, `client/`.
- **Server**: Node + TypeScript, Express (HTTP) + Socket.IO (realtime).
- **Client**: React + Vite + PixiJS (2D rendering) + `socket.io-client`.
- **Terminal**: `node-pty` on the server, `xterm.js` (`@xterm/xterm` +
  `@xterm/addon-fit`) on the client, streamed over a dedicated Socket.IO
  namespace. Server spawns the real `claude` CLI as a child process — **no
  containers, no sandboxing**. This is fine for a 4-person trusted demo; it
  would NOT be fine as a public product (arbitrary shell exposed over a
  websocket) — do not ship this pattern beyond tonight.
- **Voice**: LiveKit Cloud (free tier) + `livekit-server-sdk` (backend token
  minting) + `@livekit/components-react` (frontend).
- **State**: in-memory on the server. No database. If the server restarts,
  state resets — acceptable for a demo.
- **Deploy**: one person runs the server + exposes it via Cloudflare Tunnel or
  ngrok. Everyone else's client points at that URL. We are NOT running this
  on 4 separate localhosts — you won't see each other.
- **Secrets**: LiveKit key/secret go in `server/.env`, which is gitignored.
  First commit to the repo must add `.gitignore` with `.env` in it.

---

## 1. Repo layout

```
hackerhouse/
├── package.json                  # npm workspaces root
├── .gitignore                    # node_modules, .env, dist
├── PROJECT_OVERVIEW.md
├── ENGINEERING_PLAN.md
├── shared/
│   ├── package.json
│   └── src/
│       ├── events.ts             # ★ Builder A owns — the contract everyone imports
│       └── types.ts              # User, RoomState, Vec2, etc.
├── server/
│   ├── package.json
│   ├── .env                      # gitignored — LiveKit creds
│   └── src/
│       ├── index.ts              # Express + Socket.IO bootstrap  — Builder A
│       ├── state/                # presence, movement, room lock — Builder A
│       │   └── socket.ts
│       ├── terminal/             # node-pty + terminal namespace  — Builder C
│       │   ├── pty.ts
│       │   └── socket.ts
│       ├── voice/                # LiveKit token minting          — Builder D
│       │   └── routes.ts
│       └── notify/                # POST /notify webhook            — Builder D
│           └── routes.ts
└── client/
    ├── package.json
    └── src/
        ├── main.tsx
        ├── hooks/
        │   └── useSocket.ts       # typed socket.io-client wrapper — Builder B
        ├── world/                 # Lounge, Room, avatars, transitions — Builder B
        │   ├── Lounge.tsx
        │   ├── Room.tsx
        │   ├── Avatar.ts
        │   ├── transitions.ts
        │   └── AgentDoneCharacter.tsx
        └── components/
            ├── Terminal.tsx        # xterm.js widget                — Builder C
            └── VoiceControls.tsx    # LiveKit React wrapper           — Builder D
```

**Rule:** you only write inside your own directory, plus you may *import
from* `shared/src/events.ts` — never edit someone else's directory without
pinging them first. This is what keeps 4 people on one repo from colliding.

---

## 2. The shared contract (`shared/src/events.ts`)

Builder A writes this file and pushes it **first, before anything else**.
Everyone else imports types from here and builds against mocked data until
A's server is live. This is the single piece of code all four of you depend
on — treat changing it after the first hour as a breaking change that needs a
heads-up in the group chat.

```typescript
// shared/src/types.ts
export type UserState = 'lounge' | 'room';

export interface User {
  userId: string;
  name: string;
  state: UserState;
  x: number;
  y: number;
  roomId: string | null;   // set when state === 'room'
}

export interface RoomState {
  roomId: string;           // == owner's userId
  ownerId: string;
  locked: boolean;
  occupants: string[];      // userIds currently visiting (excludes owner)
}

// shared/src/events.ts
import { User, RoomState } from './types';

// ---- Client -> Server (main namespace) ----
export interface ClientToServerEvents {
  join: (payload: { userId: string; name: string }) => void;
  move: (payload: { x: number; y: number; facing: 'up' | 'down' | 'left' | 'right' }) => void;
  'room:enter': (payload: { roomId: string }) => void;
  'room:leave': (payload: { roomId: string }) => void;
  'room:lock': (payload: { locked: boolean }) => void; // only affects your own room
}

// ---- Server -> Client (main namespace) ----
export interface ServerToClientEvents {
  'presence:update': (payload: { users: User[] }) => void;
  'room:update': (payload: RoomState) => void;
  'room:enter:denied': (payload: { roomId: string; reason: 'locked' }) => void;
  'agent:done': (payload: { userId: string; roomId: string }) => void;
}

// ---- Terminal namespace ("/terminal") ----
export interface TerminalClientToServer {
  'terminal:join': (payload: { roomId: string; role: 'owner' | 'visitor' }) => void;
  'terminal:input': (payload: { roomId: string; data: string }) => void; // dropped server-side if not owner
  'terminal:resize': (payload: { roomId: string; cols: number; rows: number }) => void;
}
export interface TerminalServerToClient {
  'terminal:output': (payload: { roomId: string; data: string }) => void;
  'terminal:ready': (payload: { roomId: string }) => void;
}

// ---- HTTP ----
// POST /notify        body: { userId: string }              — from the Claude Code Stop hook
// POST /voice/token    body: { identity: string; room: string } -> { token: string }
```

Naming convention: `roomId === ownerId`. There's exactly one room per user,
created lazily the first time they connect. The lounge has no `roomId`.

---

## Builder A — State server & the contract (the spine)

**You are the foundation everyone else builds on top of. Ship the contract
file first, today, in the first 30–45 minutes, before you write any handler
logic. Everything below is Express + Socket.IO — no PixiJS, no terminal, no
voice.**

1. Scaffold the whole monorepo skeleton (root `package.json` with npm
   workspaces, `.gitignore`, empty folders per the layout above) so Builders
   B/C/D have a place to drop their code with zero path conflicts. Push this
   immediately.
2. Write `shared/src/types.ts` and `shared/src/events.ts` exactly as specced
   above (adjust only if you find a real gap — flag any change in the group
   chat). Push.
3. `server/src/index.ts`: Express app + `http.createServer` + `Socket.IO`
   attached to it, CORS open to the client's origin, a `GET /health` route.
4. `server/src/state/socket.ts`: in-memory `Map<userId, User>` and
   `Map<roomId, RoomState>`.
   - `join`: register the user, default `state: 'lounge'`, create their
     `RoomState` (locked: false, occupants: []) if it doesn't exist yet.
   - `move`: update x/y/facing, broadcast `presence:update`. **Throttle to
     ~15–20Hz per socket** (buffer the latest position, flush on an
     interval) — don't broadcast on every raw event or you'll flood the
     lounge with N users.
   - `room:enter`: look up target `RoomState`. If `locked && ownerId !==
     requester`, emit `room:enter:denied`. Otherwise set the user's `state:
     'room'`, `roomId`, add to `occupants` if not the owner, broadcast
     `presence:update` + `room:update`.
   - `room:leave`: inverse of enter — back to lounge, remove from occupants.
   - `room:lock`: only the owner may toggle their own room's lock; broadcast
     `room:update`.
   - On socket disconnect: remove the user from presence and from any room's
     occupants, broadcast the update.
5. Expose a small internal accessor Builder D will need:
   `getUserState(userId): User | undefined` — D's `/notify` handler calls
   this to check if a user is currently in the lounge before firing
   `agent:done`. Keep this function exported and stable; it's your one
   coordination point with D beyond the event contract.
6. **Verify before anyone else needs you**: write a throwaway 10-line Node
   script (or two `socket.io-client` connections in a test file) that joins
   as two fake users, moves them, and confirms both sockets receive
   `presence:update` with both users. Do this before B's UI exists — don't
   wait on B to find out your broadcast logic is broken.

**Done when:** two independent socket connections can join, move, and see
each other's live position; entering a locked room is rejected; entering an
unlocked room updates both sockets' presence with the correct `roomId`.

---

## Builder B — World frontend (Lounge, Room, transitions, avatars)

**You own everything the user sees and controls: the 2D world, movement, and
the four scripted transitions. You consume A's events — don't touch
`server/`. You embed C's terminal component and D's voice component as
black boxes (just wire the props, don't reach into their internals).**

1. Scaffold `client/` with Vite + React + TypeScript. Install `pixi.js`,
   `socket.io-client`, `gsap` (for the fades/tweens — boring, fast, avoids
   hand-rolling animation timing).
2. `client/src/hooks/useSocket.ts`: a typed wrapper around
   `io<ServerToClientEvents, ClientToServerEvents>(...)` importing types from
   `shared/src/events.ts`. Everything else in your code talks to the server
   through this hook, never raw `socket.io-client` calls scattered around.
3. `world/Avatar.ts`: a PixiJS sprite class — position, facing, walk-cycle
   animation, name label. Used by both Lounge and Room.
4. `world/Lounge.tsx`:
   - Renders a fixed pixel-art floor (placeholder art is fine — a colored
     tilemap or even solid rects with a grid is fine for tonight).
   - Renders one `Avatar` per entry in `presence:update` where `state ===
     'lounge'`.
   - WASD/arrow keys move **your own** avatar; emit `move` on change
     (optimistic local update — move immediately client-side, don't wait for
     the server echo; no reconciliation needed for a demo).
   - Walking your avatar onto another player's (unlocked) door tile emits
     `room:enter` for that player's `roomId`.
   - Renders each room's door as locked/unlocked based on `room:update`.
5. `world/Room.tsx`:
   - Bottom 1/4 of viewport: desk scene, your avatar seated (or standing) at
     the desk, plus any visiting avatars from `presence.filter(u => u.roomId
     === thisRoomId)`.
   - Top 3/4: mounts `<Terminal roomId={thisRoomId} mode={isOwner ? 'owner' :
     'visitor'} />` (Builder C's component — just pass props, don't edit
     `Terminal.tsx`).
   - Padlock icon toggle, owner-only, emits `room:lock`.
   - "Head to the lounge" button — emits `room:leave`, triggers the
     Room→Lounge transition.
   - Expand/fullscreen button toggles a CSS class that makes the terminal
     fill the viewport (this can be pure CSS, no new server event needed).
6. `world/transitions.ts` — implement exactly per `PROJECT_OVERVIEW.md`:
   - **Lounge→Room**: avatar walks to the stairs tile (short scripted
     movement, doesn't need to be server-synced) → full-screen div fades to
     black (gsap opacity tween) → swap rendered view to `Room` → fade back in
     → avatar walks from door to desk → once at desk, terminal container
     animates `translateY` from `-100%` to `0` over ~500ms (gsap).
   - **Room→Lounge**: terminal shrinks/translates back up and out → avatar
     stands and walks out → fade to black → swap view to `Lounge` → fade in
     at the stairs tile → avatar walks down into the room.
   - Keep these as pure functions driven by a small state machine
     (`idle | walking-to-stairs | fading-out | fading-in | walking-to-desk`)
     so they're easy to trigger from multiple places (manual button vs.
     accepting the agent-done prompt).
7. `world/AgentDoneCharacter.tsx`: listen for the `agent:done` socket event.
   When it fires for **your own** `userId`, spawn a small character sprite
   that walks down the lounge stairs and shows a speech bubble: "your
   session's done building, time to come back up" with **Accept** /
   **Decline** buttons. Accept → immediately run the Lounge→Room transition
   for your own room. Decline → despawn the character, no further action.
   Placeholder art is fine (a distinct-colored sprite) — differentiate a
   "Claude Code" skin vs. "Codex" skin only if you have time left; a single
   generic skin is fine for tonight.

**Done when:** two browser windows show both avatars moving live in the
lounge; walking into an unlocked room shows both avatars in that room's
view with C's terminal mounted; locked rooms visibly block entry; both
transition animations play correctly in both directions; triggering
`agent:done` (you can fake this with a curl to A's server / D's `/notify`
route once it exists) spawns the character and Accept correctly transitions
you into your room.

---

## Builder C — Terminal forwarding

**You own the real terminal. This is the single highest-risk piece — a
visitor accidentally being able to type into someone else's shell is a real
bug, not a cosmetic one. Enforce read-only server-side, never just in the
UI.**

1. `server/src/terminal/pty.ts`:
   - `spawnTerminal(roomId: string)`: uses `node-pty` to spawn `claude` as
     the shell (`pty.spawn('claude', [], { cwd: process.env.HOME, ... })`).
     If `claude` isn't resolvable on PATH, fall back to `$SHELL` **and log a
     loud warning** — you do not want to discover mid-demo that it silently
     dropped to bash instead of launching the agent.
   - Keep a `Map<roomId, { pty: IPty, outputBuffer: string }>`. Cap the
     buffer (e.g. last 10k characters) — this is what lets a visitor who
     joins mid-session see the current screen instead of a blank terminal.
   - One PTY process per room, created lazily on first `terminal:join` for
     that room, killed when the owner disconnects (don't leak processes).
2. `server/src/terminal/socket.ts` — a dedicated Socket.IO namespace
   (`io.of('/terminal')`):
   - `terminal:join { roomId, role }`: **do not trust the client's `role`
     claim.** Look up the actual owner via Builder A's presence/room state
     (`roomId === ownerId` by convention — cross-check the connecting
     socket's `userId`, obtained the same way A authenticates the main
     namespace, e.g. a shared join handshake or a signed token passed at
     connect time — coordinate the exact mechanism with A, this is your
     other touchpoint besides the event contract). Only mark the socket
     `isOwner = true` server-side if the userId genuinely matches the room's
     owner.
   - On join, immediately emit `terminal:ready` + flush the buffered output
     via `terminal:output` so late joiners see current state.
   - `terminal:input`: only call `pty.write(data)` if `socket.isOwner ===
     true`. If not owner, drop it silently (do not error loudly to the
     client — read-only should just do nothing, not display an error toast
     that leaks information).
   - `terminal:resize`: call `pty.resize(cols, rows)` — owner-only too, no
     reason for a visitor's viewport to resize the real terminal.
   - PTY's `onData` callback broadcasts `terminal:output` to every socket
     joined to that `roomId`'s Socket.IO room (`socket.join(roomId)` on
     `terminal:join`).
3. `client/src/components/Terminal.tsx`:
   - Props: `{ roomId: string; mode: 'owner' | 'visitor' }`.
   - `@xterm/xterm` + `@xterm/addon-fit`, connects to the `/terminal`
     namespace, joins with `{ roomId, role: mode }` (again: server doesn't
     trust this, but send it for logging/UX purposes).
   - `mode === 'owner'`: wire xterm's `onData` to emit `terminal:input`.
   - `mode === 'visitor'`: do not attach an input handler at all — the
     terminal is visually read-only client-side too (belt and suspenders,
     but the server-side enforcement in step 2 is the actual security
     boundary, not this).
   - On `terminal:output`, write the data to the xterm instance. Handle
     resize via the fit addon + emit `terminal:resize` on container resize
     (owner only).
4. Self-test standalone before Builder B's `Room.tsx` exists: build a bare
   HTML/React page that just mounts `<Terminal roomId="test" mode="owner" />`
   directly, confirm you can run real commands and see `claude` launch.

**Done when:** opening your own room actually runs `claude` and you can
interact with it normally; a second browser visiting that (unlocked) room
sees the same output streaming live but typing in their window does
provably nothing to the shared shell; a visitor who joins after the
terminal already has output sees the current screen, not blank.

---

## Builder D — Voice chat + agent-done trigger

**You own LiveKit integration and the bridge between "Claude Code finished a
turn" and the in-world notification Builder B renders. You touch A's server
via the `/notify` route and a read-only accessor into A's presence state —
coordinate that function signature with A directly.**

1. Create a LiveKit Cloud project, get `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
   `LIVEKIT_API_SECRET`. Put them in `server/.env`. **First thing you do:
   confirm `.env` is in `.gitignore`** before you add real secrets to the
   working tree.
2. `server/src/voice/routes.ts`:
   - `POST /voice/token` — body `{ identity: string; room: string }`, uses
     `livekit-server-sdk`'s `AccessToken` to mint a token scoped to that
     room, returns `{ token }`. Room naming: `"lounge"` (fixed, shared) or
     `"room-" + ownerUserId` (dynamic — LiveKit creates rooms on first
     connect, no pre-provisioning needed).
3. `client/src/components/VoiceControls.tsx`:
   - Wraps `@livekit/components-react`'s `LiveKitRoom`. Fetches a token from
     `/voice/token` for whichever room matches the user's current
     `presence.state` (`lounge`, or `room-<currentRoomId>`).
   - Listen for state transitions (either via A's `presence:update` for
     yourself, or by hooking into Builder B's transition triggers directly —
     agree with B on which signal you key off of) and **disconnect from the
     old LiveKit room, connect to the new one** on every Lounge↔Room
     transition. Don't stay connected to two voice rooms at once.
   - Basic mute toggle + connected-peers indicator is enough UI — no need
     for volume sliders or device pickers tonight.
4. `.claude/hooks/notify-agent-done.sh` — a Claude Code `Stop` hook:
   ```bash
   #!/bin/bash
   curl -s -X POST "$HACKERHOUSE_SERVER_URL/notify" \
     -H "Content-Type: application/json" \
     -d "{\"userId\": \"$HACKERHOUSE_USER_ID\"}"
   ```
   Register it in `.claude/settings.json` under the `Stop` hook. Each
   builder sets their own `HACKERHOUSE_USER_ID` and `HACKERHOUSE_SERVER_URL`
   env vars locally (not committed) so the hook fires correctly for whoever
   is running it. Add a Codex-equivalent hook only if time allows — Claude
   Code is the priority since that's what's actually embedded in the Room.
5. `server/src/notify/routes.ts`:
   - `POST /notify` — body `{ userId }`. Calls Builder A's
     `getUserState(userId)`. If the user's `state === 'lounge'`, emit
     `agent:done { userId, roomId: userId }` on the main namespace (targeted
     to that user's socket, or broadcast — Builder B only acts on it if
     `payload.userId === self`, so a broadcast is simplest). If the user is
     currently in their room (not the lounge), do nothing — the notification
     only makes sense as a "come back from the lounge" nudge.

**Done when:** two people can talk in the lounge and it's audibly separate
from a third person's room conversation; walking from lounge into a room
(and back) correctly swaps which voice room you're connected to; running a
real Claude Code session, stepping into the lounge, and letting the agent
finish a turn fires `agent:done` and Builder B's character shows up within a
couple seconds.

---

## Coordination points (the only places two of you touch the same code)

1. **`shared/src/events.ts`** — A owns it, everyone reads it. Push it first.
   Any change after hour 1 gets a heads-up in chat before you push it.
2. **Terminal ↔ World boundary** — C exports `<Terminal roomId mode />` as a
   sealed component; B only ever passes props into it.
3. **A ↔ D** — `getUserState(userId)` accessor. Agree on the exact function
   signature/import path once, early, then don't touch each other's files.
4. **D ↔ B** — the `agent:done` payload shape (already in the contract) and
   which signal VoiceControls uses to detect a Lounge↔Room transition (agree
   verbally: either A's `presence:update` or B's transition state machine
   firing a local callback — pick one, don't build both).

## Git hygiene

- Small commits, pushed often — don't sit on 3 hours of uncommitted work.
- New dependency? Add it and push in its own tiny commit immediately so
  everyone else's `npm install` stays in sync.
- Pull before you start each work session; the only files likely to collide
  are `shared/src/events.ts` and the root `package.json` (workspace/dep
  additions) — everything else is directory-scoped per builder above.
- Never commit `server/.env` or any LiveKit/API secret.
