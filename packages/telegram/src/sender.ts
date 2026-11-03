import { TelegramApiError } from "./client.js";

export type SendQueueOptions = {
  /** Minimum gap between two messages to one chat. Telegram: about 1 per second per chat. Default 1000. */
  perChatIntervalMs?: number;
  /** Messages per second across all chats. Telegram: about 30. Default 30. */
  globalPerSecond?: number;
  /** Retries after a 429 (each waits Telegram's `retry_after`). Default 3. */
  maxRetries?: number;
  /** A `retry_after` longer than this is not waited for here: the error goes back to the caller. Default 60 s. */
  maxRetryAfterSeconds?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => { const t = setTimeout(resolve, ms); t.unref?.(); });

/**
 * Serialises Bot API calls per chat (one at a time, at least `perChatIntervalMs` apart), keeps the whole process under
 * `globalPerSecond`, and on a 429 waits the `retry_after` Telegram asks for before trying again.
 */
export class SendQueue {
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly lastByChat = new Map<string, number>();
  private readonly recent: number[] = [];
  private readonly o: Required<SendQueueOptions>;

  constructor(opts: SendQueueOptions = {}) {
    this.o = {
      perChatIntervalMs: opts.perChatIntervalMs ?? 1000,
      globalPerSecond: opts.globalPerSecond ?? 30,
      maxRetries: opts.maxRetries ?? 3,
      maxRetryAfterSeconds: opts.maxRetryAfterSeconds ?? 60,
      sleep: opts.sleep ?? realSleep,
      now: opts.now ?? Date.now,
    };
  }

  /** Runs `fn` (one Bot API call for `chatId`) in that chat's turn. Resolves with its result or rejects with its last error. */
  run<T>(chatId: string | number, fn: () => Promise<T>): Promise<T> {
    const key = String(chatId);
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => this.exec(key, fn));
    this.chains.set(key, next);
    void next.catch(() => undefined).finally(() => { if (this.chains.get(key) === next) this.chains.delete(key); });
    return next;
  }

  private async exec<T>(key: string, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const last = this.lastByChat.get(key);
      if (last !== undefined) {
        const wait = last + this.o.perChatIntervalMs - this.o.now();
        if (wait > 0) await this.o.sleep(wait);
      }
      await this.acquireGlobal();
      this.lastByChat.set(key, this.o.now());
      try {
        return await fn();
      } catch (err) {
        if (!(err instanceof TelegramApiError) || err.errorCode !== 429 || attempt >= this.o.maxRetries) throw err;
        const seconds = err.retryAfter ?? 1;
        if (seconds > this.o.maxRetryAfterSeconds) throw err;
        await this.o.sleep(seconds * 1000);
      }
    }
  }

  private async acquireGlobal(): Promise<void> {
    for (;;) {
      const t = this.o.now();
      while (this.recent.length && this.recent[0]! <= t - 1000) this.recent.shift();
      if (this.recent.length < this.o.globalPerSecond) { this.recent.push(t); return; }
      await this.o.sleep(Math.max(1, this.recent[0]! + 1000 - t));
    }
  }
}
