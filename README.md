# Hacker House

An online hacker house: a social space for people coding with AI agents together.

You code in a **real terminal running Claude Code**, embedded in the app. While
you're waiting on your agent, you drop into a shared 2D pixel lounge and hang
out with everyone else building — and when your agent finishes, an in-world
character walks down the stairs to come get you.

The pitch is *make coding human*: the dead time waiting on an agent becomes
social time instead of alt-tabbing to Twitter.

## What it does

- **The Lounge** — a shared pixel-art common room. Everyone's avatar wanders
  between the pool table, ping pong, work table and couches on an ambient loop.
  There's a shared voice channel and a synced jukebox.
- **Your Room** — a private space, full screen, with a large in-world monitor.
  A real PTY runs behind that monitor's glass; it's a genuine terminal you can
  type into, framed by pixel art.
- **Visiting** — leave your door unlocked and others can walk in and watch your
  Claude Code session live, read-only, with a separate per-room voice channel.
- **Agent-done** — a Claude Code `Stop` hook pings the server, and a little
  character comes to fetch you back from the lounge.
- **Minigames** — click the ping pong table or the arcade cabinet.

## Requirements

- Node 20+
- `claude` on your `PATH` for the real experience (falls back to `$SHELL`)
- A [LiveKit Cloud](https://livekit.io) project for voice (optional)

## Quick start

```bash
git clone https://github.com/kach0w/hackerhouse.git
cd hackerhouse
npm install
```

Create `server/.env` from the example:

```bash
cp server/.env.example server/.env
```

**Set `SESSION_SECRET`.** This is not optional if anyone other than you can
reach the server — see [Security](#security).

```bash
openssl rand -hex 32
```

Then run the server and the client in two terminals:

```bash
npm run dev:server
npm run dev:client
```

Open http://localhost:5173.

### Pointing the client at a different server

The client defaults to `http://localhost:3001`. Override it with
`client/.env.local`:

```
VITE_SERVER_URL=http://localhost:3001
```

Add `?mock=1` to the URL to run the world against an in-browser fake server
with no backend at all — useful for working on the UI.

## Security

**Read this before exposing the server to anything but localhost.**

This app deliberately gives a browser a real shell. That is the product. It
also means the trust model matters more than in a normal web app:

- **Set `SESSION_SECRET` to something random.** Terminal write access, voice
  room access and the agent-done hook all authenticate against HMAC-signed
  session tokens. Without the env var the server falls back to a known default,
  which makes those tokens forgeable — and a forged token is a shell on the
  machine running the server.
- Owner/visitor enforcement is **server-side**. Visitors can watch a terminal
  but the server drops their input regardless of what the client does.
- A locked room refuses both entry and its voice channel.

Run the security regression tests with:

```bash
npm run verify:security --workspace server
```

Known remaining gaps, if you plan to run this for people you don't know:

- There are no user accounts. Identity is a `userId` in `localStorage`, and
  first-come-first-served — anyone can claim an unused one.
- PTYs are never reaped on idle, so an abandoned room keeps a `claude` process
  alive on the host.
- Late-joining visitors get a raw byte replay of the terminal buffer, which can
  render garbled for a full-screen TUI.

## Layout

```
shared/   types + Socket.IO event contract (imported by both sides)
server/   Express + Socket.IO, PTY management, voice tokens, notify hook
client/   React + Vite + PixiJS — the lounge, the room, the minigames
```

Other tests:

```bash
npm run verify --workspace server           # presence / rooms / reconnect
npm run verify:terminal --workspace server  # PTY, owner vs visitor isolation
```

## Troubleshooting

**`posix_spawnp failed` on macOS** — node-pty's prebuilt helper can lose its
executable bit on install:

```bash
chmod +x node_modules/node-pty/prebuilds/*/spawn-helper
```

**Voice says "LiveKit is not configured"** — set `LIVEKIT_URL`,
`LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` in `server/.env`.

## Licence

MIT — see [LICENSE](LICENSE).
