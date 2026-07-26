# Hacker House

An online Hacker House: a social space for people coding together. You code in a real terminal running Claude Code, and whenever you're waiting on your agent, you drop into a lounge to hang out with everyone else building tonight. The pitch is "make coding human" — the dead time waiting on an agent becomes social time instead of alt-tabbing to Twitter.
Coding with an AI agent isn't social and isn't human. You send a prompt, then you wait — and the only thing to do in that dead time is scroll Instagram Reels. Discord doesn't fix this: you can be in a voice channel while Claude works, but nothing about the experience is tied to the actual rhythm of the coding session. There's no reason the wait has to be empty, and there's no reason "the agent is working" and "I'm hanging out with my friends" have to be two unrelated activities happening to overlap.

## The two states

The app is always in exactly one of two states, never both at once:

1. **The Lounge** — a shared social space.
2. **The Room** — your personal coding space.

You move back and forth between them over the course of a session.

## The Lounge

A shared space where every online user's pixel avatar walks around and talks. Everyone in the lounge is on one shared voice channel — you can talk to whoever's around, like a real hacker house common area.

This is where you go the moment you kick off a prompt in your agent and don't want to just stare at a spinner. Instead of babysitting the terminal, you hang out, see who else is building, talk to people — and get pulled back when your agent finishes.

## The Room

Your personal space. Layout:

- **Bottom 1/4 of the screen**: your room, rendered like a normal room, with your pixel avatar sitting at a desk.
- **Top 3/4 of the screen**: a real terminal, embedded directly in the app. Not a simulation or a modified/sandboxed shell — an actual terminal, as-is. It defaults to opening Claude Code on entry, so you land in your room and your agent is already sitting there ready to go. There's an expand button to make the terminal full-screen.

You use this terminal exactly like you'd use your own terminal today — same Claude Code, same workflow — except it's forwarded into the web app so it's visible to others under the permission rules below.

### Room locking & visiting

- **Locked room**: nobody can enter or see your terminal. You're heads-down, private.
- **Unlocked room**: you can open your door. Other users can walk their avatar in — their avatar appears next to yours in the bottom 1/4 of the screen, and they can watch your terminal live: see Claude Code running, see the chain of actions/tool calls happen in real time. Read-only — visitors can look but never type or interact with your terminal.
- **Room voice channel**: separate from the lounge voice channel. Anyone who walks into your room can talk to you (and you to them) while you work, whether they're just watching or keeping you company.

## Transitions

**Lounge → Room**: your avatar walks to the stairs, the screen fades to black, fades back in on your room with your avatar walking to the desk. Once your avatar reaches the desk, the terminal animates in — dropping down smoothly from the top of the screen until it fills the top 3/4.

**Room → Lounge**: you hit a button (exact copy TBD, something like "Head to the lounge") when you're ready to step away — e.g. after kicking off one or more agent runs. The terminal shrinks away, your avatar gets up and walks out of the room, the screen fades to black, fades back in on the lounge at the stairs and then your avatar starts walkign down in the lounge and interacting with other people's avatars. 

## Agent-done notification

When you're in the lounge and your agent finishes running, we don't just fire a toast or a chime. Instead, an in-world character comes down the stairs into the lounge and tells you directly — something like "your session's done building, time to come back up." We could make this a funny thing like an avatar of your coding agent that comes down and tells you to get back to work, we should create a case for claude code and codex. You can:

- **Accept** → triggers the Lounge → Room transition immediately.
- **Decline/ignore** → stay in the lounge as long as you want, and head back to your room on your own schedule later.

## Scope for tonight

**In scope:**
- Lounge with avatars, movement, shared voice channel
- Room with avatar, embedded real terminal defaulting to Claude Code
- Lounge ↔ Room transition animations (stairs, fade to black, terminal drop-down/shrink)
- Room locking/unlocking
- Visiting an unlocked room (avatar joins, read-only terminal view, room voice channel)
- Voice chat — both lounge-wide and per-room
- Agent-done notification via the in-world "your session is done" character/moment

**Stretch / if time allows:**
- Character customization
- adding mini-games and stuff to do in the lounge
- (perhaps add music, use merge to connect to the lounge member's spotifies, find what music they have in common, and play specific songs in the lounge, it should be synced for all members)

**Explicitly deprioritized for tonight:**
- Public servers (multiple hacker houses/instances)

**Optional integration:**
- Merge (the "connect any data to any LLM" tool) can be used if it plugs into something real — e.g. wiring up Discord or the voice chat/voice channel feature — not bolted on just to reference it in the pitch.

## Open questions (to resolve while building)
- Exact copy/placement of the "go to lounge" button
- Exact identity/design of the in-world "agent is done" character and how it's triggered
- Tech stack for the embedded terminal forwarding (what serves the terminal session to visiting avatars)
- Voice chat provider/implementation for lounge-wide vs. per-room channels
