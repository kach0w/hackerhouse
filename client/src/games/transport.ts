/**
 * Transport abstraction for minigames.
 *
 * A match is two peers exchanging small JSON messages. How those messages
 * travel is deliberately not the game's problem: `LocalTransport` loops them
 * back in-process (so pong is playable solo against a bot right now), and a
 * `SignalTransport` will relay them through the server once Builder A adds the
 * generic `game:signal` envelope to the contract.
 *
 * Keeping this seam means the game logic never changes when the netcode lands —
 * and the next minigame gets the same plumbing for free.
 */

export interface Transport {
  send(msg: unknown): void;
  onMessage(handler: (msg: unknown) => void): () => void;
  close(): void;
}

/**
 * In-process transport. Whatever you send comes back to the handler you supply
 * as `respond` — used to drive a bot opponent without any server involvement.
 */
export class LocalTransport implements Transport {
  private handlers = new Set<(msg: unknown) => void>();
  private respond: ((msg: unknown, reply: (m: unknown) => void) => void) | null;
  private closed = false;

  constructor(respond?: (msg: unknown, reply: (m: unknown) => void) => void) {
    this.respond = respond ?? null;
  }

  send(msg: unknown): void {
    if (this.closed) return;
    this.respond?.(msg, (reply) => {
      if (this.closed) return;
      for (const h of this.handlers) h(reply);
    });
  }

  /** Push a message to the local side without it having been "sent" anywhere. */
  inject(msg: unknown): void {
    if (this.closed) return;
    for (const h of this.handlers) h(msg);
  }

  onMessage(handler: (msg: unknown) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.closed = true;
    this.handlers.clear();
  }
}
