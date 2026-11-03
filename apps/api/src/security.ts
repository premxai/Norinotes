import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import type { ApiConfig } from "./config.js";
import { HttpError } from "./http.js";

type Bucket = { count: number; resetAt: number };

/** Fixed-window in-memory counters. One process owns the API, so memory is enough. */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private lastSweep = 0;
  constructor(private readonly now: () => number = Date.now) {}

  /** Counts one hit. Returns 0 when allowed, else the seconds to wait. */
  hit(key: string, max: number, windowMs: number): number {
    const t = this.now();
    if (t - this.lastSweep > 60_000) {
      this.lastSweep = t;
      for (const [k, b] of this.buckets) if (b.resetAt <= t) this.buckets.delete(k);
    }
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= t) { b = { count: 0, resetAt: t + windowMs }; this.buckets.set(key, b); }
    b.count += 1;
    return b.count > max ? Math.max(1, Math.ceil((b.resetAt - t) / 1000)) : 0;
  }

  reset(): void { this.buckets.clear(); }
}

/** Throws 429 (with Retry-After) when `key` has used up `max` hits in the window. */
export function enforce(limiter: RateLimiter, key: string, max: number, windowMs: number, message: string): void {
  const wait = limiter.hit(key, max, windowMs);
  if (wait > 0) throw new HttpError(429, message, undefined, { "Retry-After": String(wait) });
}

/**
 * The client address for rate limiting. Forwarding headers are the client's to write unless a proxy in front overwrites
 * them, so they count only when TRUST_PROXY=true. Otherwise the socket address.
 */
export function clientIp(c: Context, config: Pick<ApiConfig, "trustProxy">): string {
  if (config.trustProxy) {
    const hops = c.req.header("x-forwarded-for")?.split(",").map((h) => h.trim()).filter(Boolean) ?? [];
    const ip = c.req.header("fly-client-ip")?.trim() || hops[hops.length - 1] || c.req.header("x-real-ip")?.trim();
    if (ip) return ip;
  }
  try {
    return getConnInfo(c).remote.address ?? "local";
  } catch {
    return "local";
  }
}

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "SAMEORIGIN");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
};

/**
 * Unsafe requests that carry an Origin must come from the web app (or the API itself). A browser always sends Origin on
 * cross-site POSTs, so this closes the gap SameSite=Lax leaves for sibling sites. Server-to-server callers send none.
 */
export function originGuard(config: Pick<ApiConfig, "webUrl" | "apiUrl">): MiddlewareHandler {
  const allowed = new Set([config.webUrl, config.apiUrl].filter((v): v is string => !!v));
  return async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.method !== "OPTIONS") {
      const origin = c.req.header("origin");
      if (origin && !allowed.has(origin.replace(/\/+$/, "")) && c.req.path !== "/api/inbound/email" && !c.req.path.startsWith("/api/inbox/webhook/")) throw new HttpError(403, "Request origin not allowed");
    }
    await next();
  };
}
