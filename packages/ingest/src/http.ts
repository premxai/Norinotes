import type { AtsType } from "@norinote/shared";
import { hostKey } from "./hosts.js";
import type { HttpOptions } from "./types.js";

/** Per-attempt timeout for one request. */
export const FETCH_TIMEOUT_MS = 15_000;

/** Sent with every feed request, so the boards can see who is reading them and how to reach us. */
export const USER_AGENT = "NorinoteJobAgent/1.0 (+https://norinote.xyz)";

/** Total tries for one request (the first plus retries) when a board answers 429 or 503. */
export const MAX_ATTEMPTS = 3;
/** A server's Retry-After is honoured up to this long; a longer wait is not worth stalling a poll for. */
export const MAX_RETRY_AFTER_MS = 60_000;
const BACKOFF_BASE_MS = 1000;

/** A board kept answering 429/503 through every retry. The poller backs the whole host off when it sees several. */
export class RateLimitedError extends Error {
  constructor(readonly url: string, readonly status: number, readonly attempts: number) {
    super(`GET ${url} was refused with ${status} ${status === 429 ? "Too Many Requests" : "Service Unavailable"} on all ${attempts} attempts; giving up for now`);
    this.name = "RateLimitedError";
  }
  get host(): string { return new URL(this.url).hostname; }
}

/**
 * Parse a Retry-After header (delta-seconds or an HTTP date) into milliseconds, capped at MAX_RETRY_AFTER_MS.
 * Returns null when it is absent or unreadable, so the caller falls back to exponential backoff.
 */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  const v = value?.trim();
  if (!v) return null;
  let ms: number;
  if (/^\d+(\.\d+)?$/.test(v)) ms = Number(v) * 1000;
  else {
    const at = Date.parse(v);
    if (Number.isNaN(at)) return null;
    ms = at - now;
  }
  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);
}

/** Exponential backoff with jitter: about 1 s after the first refusal, 2 s after the second, 4 s after the third. */
export function backoffMs(failedAttempts: number, random: () => number = Math.random): number {
  return Math.round(BACKOFF_BASE_MS * 2 ** (failedAttempts - 1) * (1 + 0.25 * random()));
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * fetch() with our User-Agent, a per-attempt timeout, and polite retries: a 429 or 503 is retried (honouring
 * Retry-After, else backing off 1 s, 2 s, 4 s with jitter) up to MAX_ATTEMPTS tries in all, then RateLimitedError.
 * Any other status, including every other 4xx, goes to `handle` at once. `handle` runs while the timeout is still
 * armed, so a body that stalls is cut off too.
 */
async function requestWithRetry<T>(url: string, init: RequestInit, opts: HttpOptions, handle: (res: Response) => Promise<T>): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const doFetch = opts.fetch ?? fetch;
  for (let attempt = 1; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let refused: { status: number; retryAfter: number | null };
    try {
      const res = await doFetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: { accept: "application/json", "user-agent": USER_AGENT, ...(init.headers ?? {}) },
      });
      if (res.status !== 429 && res.status !== 503) return await handle(res);
      refused = { status: res.status, retryAfter: parseRetryAfter(res.headers.get("retry-after"), opts.now?.()) };
      void res.body?.cancel().catch(() => {});
    } catch (err) {
      if ((err as Error).name === "AbortError") throw new Error(`GET ${url} timed out after ${timeoutMs}ms`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt >= MAX_ATTEMPTS) throw new RateLimitedError(url, refused.status, attempt);
    await sleep(refused.retryAfter ?? backoffMs(attempt, opts.random));
  }
}

/** fetch() with our User-Agent, a timeout and polite retries on 429/503 (see requestWithRetry). */
export function fetchWithRetry(url: string, init: RequestInit = {}, opts: HttpOptions = {}): Promise<Response> {
  return requestWithRetry(url, init, opts, async (res) => res);
}

/** GET JSON with a 15 s timeout and polite retries. Returns null on 404, throws on any other non-2xx. */
export function getJson<T>(url: string, opts: HttpOptions = {}): Promise<T | null> {
  return requestWithRetry<T | null>(url, {}, opts, async (res) => {
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  });
}

/** What a conditional GET answered. `etag` is the validator to send next time (the ETag header). */
export type ConditionalJson<T> =
  | { status: "ok"; data: T; etag: string | null }
  | { status: "notModified"; etag: string | null }
  | { status: "notFound" };

/**
 * GET JSON with If-None-Match when a validator from the previous read is known: 304 is `notModified`, 404 is
 * `notFound`, any other non-2xx throws. Same retries and timeout as getJson.
 */
export function getJsonConditional<T>(url: string, opts: HttpOptions = {}, etag?: string | null): Promise<ConditionalJson<T>> {
  const headers: Record<string, string> = etag ? { "if-none-match": etag } : {};
  return requestWithRetry<ConditionalJson<T>>(url, { headers }, opts, async (res) => {
    const next = res.headers.get("etag");
    if (res.status === 304) { void res.body?.cancel().catch(() => {}); return { status: "notModified", etag: next ?? etag ?? null }; }
    if (res.status === 404) return { status: "notFound" };
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
    return { status: "ok", data: (await res.json()) as T, etag: next };
  });
}

/** The politeness host of a board (see hostKey); the system name for those without a known host. */
export const feedHost = (atsType: AtsType, token?: string | null): string => hostKey(atsType, token);

/**
 * Per-host memory of which feed hosts are refusing us. A board whose retries all ended in 429/503 counts as a strike
 * against its host; after `limit` strikes in a row the host is backed off (the caller skips its remaining boards,
 * which stay due and are tried again next time). A board that answers resets that host's streak. Create one per
 * poll cycle and pass it to `pollBoard`.
 */
export class HostBackoff {
  private streak = new Map<string, number>();
  private off = new Set<string>();

  constructor(private readonly limit = 2) {}

  /** True once the host has been backed off. */
  isBackedOff(host: string): boolean { return this.off.has(host); }

  /** Record a rate-limited board. Returns true when this strike backs the host off. */
  rateLimited(host: string): boolean {
    const n = (this.streak.get(host) ?? 0) + 1;
    this.streak.set(host, n);
    if (n >= this.limit && !this.off.has(host)) { this.off.add(host); return true; }
    return false;
  }

  /** Record a board that answered (any result other than rate limiting). */
  ok(host: string): void { this.streak.set(host, 0); }

  get backedOffHosts(): string[] { return [...this.off]; }
}
