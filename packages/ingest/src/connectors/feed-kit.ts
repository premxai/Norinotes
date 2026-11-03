import { fetchWithRetry } from "../http.js";
import type { HttpOptions } from "../types.js";

/**
 * Small helpers shared by the HTML / XML / JSON feed connectors (workable ... icims): a hostname-label check for
 * tokens that become part of a hostname, a bounded-concurrency map, and a GET that keeps the status, ETag and
 * Location so a connector can tell "board gone" from "board empty". Written for this repo; not from ats-scrapers.
 */

/** True for a single DNS label (letters, digits, hyphens), which is what a tenant slug must be to go into a hostname. */
export const isHostLabel = (s: string): boolean => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(s);

/** Run `fn` over `items` with at most `limit` in flight; results keep the input order. `fn` must not throw. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i] as T, i);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

export type FeedResponse = {
  status: number;
  /** Response text; empty for a 304. */
  body: string;
  etag: string | null;
  /** Location header of a redirect (only seen with `manualRedirect`). */
  location: string | null;
};

export type FeedOptions = {
  accept?: string;
  /** Sent as If-None-Match. */
  etag?: string | null;
  /** Do not follow redirects, so a 3xx can be read as "tenant does not exist". */
  manualRedirect?: boolean;
  headers?: Record<string, string>;
};

/** GET with our User-Agent, timeout and polite 429/503 retries (http.ts). Never throws on a status; the caller decides. */
export async function getFeed(url: string, http: HttpOptions | undefined, opts: FeedOptions = {}): Promise<FeedResponse> {
  const headers: Record<string, string> = { accept: opts.accept ?? "application/json", ...(opts.headers ?? {}) };
  if (opts.etag) headers["if-none-match"] = opts.etag;
  const res = await fetchWithRetry(url, { headers, redirect: opts.manualRedirect ? "manual" : "follow" }, http);
  const etag = res.headers.get("etag");
  const location = res.headers.get("location");
  if (res.status === 304 || (res.status >= 300 && res.status < 400)) {
    void res.body?.cancel().catch(() => {});
    return { status: res.status, body: "", etag, location };
  }
  return { status: res.status, body: await res.text(), etag, location };
}

export const isRedirect = (status: number): boolean => status >= 300 && status < 400 && status !== 304;

/** The error for any status that is neither success, 304, nor "board gone". Message shape matches getJson. */
export const feedError = (url: string, status: number): Error => new Error(`GET ${url} failed: ${status}`);

/** Parse JSON, throwing a message that names the URL (an HTML error page served with 200 is not "no jobs"). */
export function parseJsonBody<T>(url: string, body: string): T {
  try { return JSON.parse(body) as T; } catch { throw new Error(`GET ${url} returned something that is not JSON`); }
}

/** Join non-empty parts, trimming each. */
export const joinParts = (parts: Array<string | null | undefined>, sep = ", "): string => parts.map((p) => (p ?? "").trim()).filter(Boolean).join(sep);

/** Unique, non-empty strings in order. */
export const uniq = (xs: Array<string | null | undefined>): string[] => [...new Set(xs.map((x) => (x ?? "").trim()).filter(Boolean))];

/** String value of a field, or null. */
export const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
