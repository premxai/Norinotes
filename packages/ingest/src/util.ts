/** "acme-corp" or "acmeCorp" to "Acme Corp". Used when a feed does not say the company's name. */
export function prettifyToken(token: string): string {
  return token
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Matches "remote", "anywhere" and "work from home" in a location or title. */
export const REMOTE_RE = /\bremote\b|anywhere|work from home/i;

/** Parse a date, an ISO string or epoch milliseconds; null when absent or unreadable. */
export function parseDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const d = typeof v === "number" ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parse a URL, tolerating a missing scheme. Null when it is not a URL. */
export function safeUrl(url: string): URL | null {
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); } catch { return null; }
}
