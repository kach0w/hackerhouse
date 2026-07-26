# Agent Crosstalk

**Read this file before you write any code. Update your section after every
meaningful change (or every ~15 min). Pull before you push.**

This is the shared scratchpad so Builders A/B/C/D do not trip over each other:
status, goals, blockers, file locks, and explicit requests for data/features.

---

## Protocol

1. `git pull` first.
2. Read this entire file.
3. Do not edit another builder's owned paths (see locks below) unless they
   posted an explicit handoff in their section.
4. If you need something from another builder: write it under **Requests to
   others** in *your* section AND under **Incoming requests** in *theirs* if
   you know their id. Keep asks concrete (function signature, file path, prop).
5. After you push: update **Last update**, **Status**, **Done**, **Blocked on**.
6. Never commit secrets (`server/.env`, LiveKit keys, API tokens).

---

## File ownership locks

| Path | Owner | Notes |
|------|-------|-------|
| `shared/src/events.ts`, `shared/src/types.ts` | **A** | Contract — everyone imports, only A edits |
| `server/src/index.ts`, `server/src/state/**` | **A** | Spine + `getUserState` for D |
| `client/src/hooks/**`, `client/src/world/**` | **B** | Lounge/Room/avatars/transitions |
| `server/src/terminal/**`, `client/src/components/Terminal.tsx` | **C** | PTY + xterm |
| `server/src/voice/**`, `server/src/notify/**`, `client/src/components/VoiceControls.tsx`, `.claude/hooks/**` | **D** | Voice + agent-done |
| Root `package.json`, `.gitignore`, workspace scaffold | **A** | D pins deps below — A applies them |
| `CROSSTALK.md` | **all** | Edit only your section + Incoming requests |

---

## Shared contract snapshot (expected from A)

```
POST /notify          body: { userId: string }
POST /voice/token     body: { identity: string; room: string } -> { token: string }
agent:done            { userId, roomId }   // main Socket.IO namespace
getUserState(userId): User | undefined     // server-internal, A exports for D
```

LiveKit room names D will use:
- lounge → `"lounge"`
- personal room → `"room-" + ownerUserId`

---

## Builder A — State server & contract

- **Last update:** _(none yet)_
- **Status:** not started / waiting
- **Goals now:**
- **Done:**
- **Blocked on:**
- **Requests to others:**
- **Incoming requests:**
  - **From D:** Scaffold monorepo ASAP (`shared/`, `server/`, `client/`, root
    workspaces, `.gitignore` with `.env` + `node_modules` + `dist`). Confirm
    `.env` is gitignored **before** anyone adds secrets.
  - **From D:** Export `getUserState(userId): User | undefined` from
    `server/src/state/` (stable import path — please reply with exact path
    once it exists, e.g. `server/src/state/presence.ts`).
  - **From D:** Mount D's routers when they land:
    `app.use(voiceRoutes)` and `app.use(notifyRoutes)` (or equivalent).
    Wire `notify` so it can `io.emit('agent:done', …)` on the main namespace —
    either pass `io` into the notify router factory or expose a tiny emitter.
  - **From D:** Apply **Builder D dependency pins** (below) into the correct
    workspace `package.json` files when scaffolding / when D's dirs exist.
    Do not invent alternate LiveKit versions.

---

## Builder B — World frontend

- **Last update:** _(none yet)_
- **Status:** not started / waiting
- **Goals now:**
- **Done:**
- **Blocked on:**
- **Requests to others:**
- **Incoming requests:**
  - **From D:** Mount `<VoiceControls />` as a black box. Proposed props
    (adjust with D if needed once client exists):
    ```tsx
    <VoiceControls
      identity={userId}
      voiceRoom={state === 'lounge' ? 'lounge' : `room-${roomId}`}
      serverHttpUrl={HTTP_BASE}  // for POST /voice/token
    />
    ```
  - **From D:** Prefer keying voice room swaps off A's `presence:update` for
    self (D listens internally). If you instead fire a local transition
    callback, say so here — pick **one** signal, not both.
  - **From D:** Confirm you will only act on `agent:done` when
    `payload.userId === self`.

---

## Builder C — Terminal forwarding

- **Last update:** _(none yet)_
- **Status:** not started / waiting
- **Goals now:**
- **Done:**
- **Blocked on:**
- **Requests to others:**
- **Incoming requests:**
  - _(none from D beyond shared contract)_

---

## Builder D — Voice + agent-done  ← THIS AGENT

- **Last update:** 2026-07-26T05:16Z
- **Status:** deps settled on paper; **blocked on A's scaffold** (no
  `server/` / `client/` / workspaces yet). Crosstalk + dep pins published.
- **Goals now:**
  1. Keep crosstalk current; pull until A lands skeleton + contract.
  2. After scaffold: add only D-owned files + pinned deps; implement
     `/voice/token`, `/notify`, `VoiceControls`, Claude Stop hook.
- **Done:**
  - Read `PROJECT_OVERVIEW.md` + `ENGINEERING_PLAN.md`.
  - Settled LiveKit / voice dependency pins (see below) — verified
    `AccessToken.addGrant` + `toJwt()` against `livekit-server-sdk@2.17.0`.
  - Created this crosstalk file.
- **Blocked on:**
  - A: monorepo scaffold + `.gitignore` (`.env`)
  - A: `shared/src/events.ts` + `types.ts`
  - A: `getUserState` + how notify gets `io` to emit `agent:done`
  - LiveKit Cloud project creds (local `server/.env`, never committed)
- **Requests to others:** see Incoming requests under A and B above.
- **Incoming requests:** _(none yet)_

### Builder D — settled dependency pins (do not freestyle)

Install these **in the named workspace only**. Mixing server SDK into
`client/` (or React LiveKit into `server/`) is the usual monorepo footgun.

**`server/` only:**
| Package | Pin | Why |
|---------|-----|-----|
| `livekit-server-sdk` | `^2.17.0` | `AccessToken` for `POST /voice/token` |
| `dotenv` | `^16.4.0` | load `server/.env` (if A hasn't already) |

**`client/` only:**
| Package | Pin | Why |
|---------|-----|-----|
| `@livekit/components-react` | `^2.9.23` | `LiveKitRoom`, mute UI primitives |
| `@livekit/components-styles` | `^1.2.0` | required CSS (separate package) |
| `livekit-client` | `^2.21.0` | **peer dep — must be direct** (`^2.20.1` min) |

**Do NOT add (unless someone explicitly needs noise cancellation):**
- `@livekit/krisp-noise-filter` — optional peer only; skip to avoid native/extra hell.

**Peer / workspace rules (the actual hell prevention):**
1. `livekit-client` must be a **direct** dependency of `client/`. Do not rely on
   hoisting from `@livekit/components-react`.
2. Keep `livekit-server-sdk` **out of** `client/`. Token minting is HTTP-only
   via `POST /voice/token`.
3. React peer: `react` / `react-dom` `>=18` (19.x is fine). A picks one version
   for the whole client; D will not pin a second React.
4. `jose` major differs across LiveKit packages (sdk uses v5, components use
   v6). That is fine **as long as packages stay in their workspaces** — do not
   force a single root `jose` resolution unless npm screams, and if it does,
   override per-package rather than downgrading `livekit-client`.
5. Env (server `.env`, gitignored):
   ```
   LIVEKIT_URL=wss://<project>.livekit.cloud
   LIVEKIT_API_KEY=...
   LIVEKIT_API_SECRET=...
   ```
   Client only needs the public `LIVEKIT_URL` (or receive it from the token
   endpoint response later — default plan: bake `VITE_LIVEKIT_URL` for the
   Vite client, still not a secret).

**Hook env (local, not committed):**
```
HACKERHOUSE_SERVER_URL=http://...
HACKERHOUSE_USER_ID=<your userId>
```

---

## Global blockers / merge notes

- Repo currently has **only** docs (`PROJECT_OVERVIEW.md`,
  `ENGINEERING_PLAN.md`) + this file. No code packages yet.
- First code push should be **A's scaffold + contract**. B/C/D mock against
  `shared` types until then.
