import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Guard for fetching a URL a user typed. The API runs next to databases and cloud metadata endpoints, so a pasted
 * "job link" must never be allowed to reach loopback, private, link-local or otherwise internal addresses, neither
 * directly nor through a redirect. Set ALLOW_PRIVATE_FETCH=1 to turn the guard off (local development only).
 */
export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** Resolves a host to its addresses. Replaceable in tests so no DNS request is made. */
export type HostLookup = (host: string) => Promise<string[]>;

const defaultLookup: HostLookup = async (host) => (await dnsLookup(host, { all: true }).catch(() => [])).map((a) => a.address);

/** True for loopback, private, link-local, carrier-grade NAT, multicast, reserved and unspecified addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(v) === 4) {
    const [a = 0, b = 0] = v.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && v.startsWith("192.0.0.")))) || (a === 198 && (b === 18 || b === 19));
  }
  if (isIP(v) === 6) {
    if (v === "::" || v === "::1") return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    return /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff");
  }
  return false;
}

/** Throws UnsafeUrlError unless the URL is http(s) and every address its host resolves to is public. */
export async function assertPublicUrl(url: string, opts: { lookup?: HostLookup } = {}): Promise<URL> {
  let u: URL;
  try { u = new URL(url); } catch { throw new UnsafeUrlError("That is not a valid link."); }
  if (process.env.ALLOW_PRIVATE_FETCH === "1") return u;
  if (!/^https?:$/.test(u.protocol)) throw new UnsafeUrlError("Only http and https links can be read.");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/.test(host) || (!host.includes(".") && isIP(host) === 0)) {
    throw new UnsafeUrlError("That address is not a public website.");
  }
  const addrs = isIP(host) ? [host] : await (opts.lookup ?? defaultLookup)(host);
  if (addrs.length === 0) throw new UnsafeUrlError(`Could not find ${host}.`);
  if (addrs.some(isPrivateAddress)) throw new UnsafeUrlError("That address is not a public website.");
  return u;
}

/** fetch() that checks the address before every hop and follows at most `maxRedirects` redirects itself. */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  opts: { maxRedirects?: number; lookup?: HostLookup; fetch?: typeof fetch } = {},
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 4;
  const doFetch = opts.fetch ?? fetch;
  let current = url;
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(current, { lookup: opts.lookup });
    const res = await doFetch(current, { ...init, redirect: "manual" });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      if (hop >= maxRedirects) throw new Error("Too many redirects.");
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
}
