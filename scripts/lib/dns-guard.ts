/**
 * Decides what a failed DNS lookup of a feed host means, for scripts/collect-all.mts.
 *
 * A laptop that sleeps, a Wi-Fi drop or a flaky local resolver makes lookups of perfectly good tenant hosts fail with
 * ENOTFOUND. That must never be recorded as "the board does not exist" (status `dead`). A host counts as gone only when
 *   - the job system gives every tenant its own hostname (shared API hosts never "do not exist"),
 *   - boards of other systems have been answering a moment ago (the network is working),
 *   - at least two public resolvers, asked directly (not through the OS resolver and its cache), both answer NXDOMAIN for
 *     the tenant host, and both resolve the control hosts right now.
 * Anything else (a public resolver finds the host, cannot be reached, or only one of them says NXDOMAIN) is a network or
 * local resolver problem: the caller pauses and retries, and never changes the board.
 */
import { Resolver } from "node:dns/promises";

/** What a public resolver said about one host: it exists, it does not (NXDOMAIN), or we could not tell. */
export type DnsAnswer = "found" | "nxdomain" | "unknown";
export type PublicResolver = (host: string) => Promise<DnsAnswer>;

/** `dead`: the tenant host really does not exist. `network`: do not trust the failure, pause and retry. */
export type DnsVerdict = "dead" | "network";

export const CONTROL_HOSTS = ["one.one.one.one", "github.com"] as const;
/** A board must have answered (any HTTP answer) this recently for a DNS failure to count as evidence at all. */
export const RECENT_SUCCESS_MS = 30_000;

/** A resolver that sends its own queries to one public DNS server, bypassing the OS resolver cache. */
export function publicResolver(server: string, timeoutMs = 3000): PublicResolver {
  const r = new Resolver({ timeout: timeoutMs, tries: 2 });
  r.setServers([server]);
  return async (host) => {
    try {
      await r.resolve4(host);
      return "found";
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "ENOTFOUND") return "nxdomain";
      if (code === "ENODATA") return "found"; // the name exists, it just has no A record
      return "unknown"; // timeout, refused, SERVFAIL: no evidence
    }
  };
}

export const DEFAULT_RESOLVERS: readonly PublicResolver[] = [publicResolver("1.1.1.1"), publicResolver("8.8.8.8")];

export type DnsFailure = {
  host: string;
  /** True when every tenant of the job system has its own hostname (Workday, Oracle, Recruitee, ...). */
  tenantHostSystem: boolean;
  /** When any board last got an HTTP answer (ms since epoch); 0 when none has. */
  lastSuccessAt: number;
  now?: number;
  resolvers?: readonly PublicResolver[];
  controlHosts?: readonly string[];
};

export async function judgeDnsFailure(f: DnsFailure): Promise<DnsVerdict> {
  const resolvers = f.resolvers ?? DEFAULT_RESOLVERS;
  const controls = f.controlHosts ?? CONTROL_HOSTS;
  if (!f.tenantHostSystem) return "network";
  if ((f.now ?? Date.now()) - f.lastSuccessAt > RECENT_SUCCESS_MS) return "network";
  if (resolvers.length < 2) return "network";
  // Every resolver must work right now (control hosts resolve) ...
  for (const r of resolvers) for (const c of controls) if ((await r(c)) !== "found") return "network";
  // ... and every one of them must say the tenant host does not exist.
  for (const r of resolvers) if ((await r(f.host)) !== "nxdomain") return "network";
  return "dead";
}
