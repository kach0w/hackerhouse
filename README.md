# Hacker House

Working scaffold: real terminal (node-pty + Claude Code) forwarded read-only
to visitors, lock/unlock, and a placeholder Lounge ↔ Room view transition.

## Run it

```
npm install
npm start
```

Opens on `http://localhost:3000`. "create room" spins up a real `claude`
session; the owner link (with `?token=`) lets you reconnect as owner, the
visitor link lets anyone watch read-only.

## Where to add your code (avoid stepping on each other)

- `server.js` — terminal/PTY logic (owner check, lock, buffer for late
  joiners). Ping the group before editing this directly.
- `server/state.js` — presence, lounge, room state. Wire it into
  `server.js` with a `require()` once it's ready.
- `server/voice.js` — LiveKit token minting route.
- `server/notify.js` — agent-done webhook route.
- `public/index.html` — the whole frontend (Lounge view + Room/terminal
  view). It's one file for now; feel free to split it up as it grows, just
  say so in the group chat since everyone's likely to touch it.

## Git workflow

- `git pull` before you start a session, `git push` often — small commits.
- New dependency? Commit `package.json`/`package-lock.json` right away so
  everyone's `npm install` stays in sync.
- Never commit `.env` or any secret — it's gitignored, keep it that way.
