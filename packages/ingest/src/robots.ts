/**
 * robots.txt, as RFC 9309 reads it for our User-Agent: the most specific matching group (else `*`), longest matching
 * rule wins, Allow wins a tie. Every feed request goes through `obeyRobots` in http.ts, which uses this module.
 */

type Rule = { allow: boolean; len: number; re: RegExp };
export type Robots = { rules: Rule[]; delayMs: number };

/** No usable robots.txt (4xx, HTML instead of text): nothing is disallowed (RFC 9309 section 2.3.1.3). */
export const NO_ROBOTS: Robots = { rules: [], delayMs: 0 };

/** A Crawl-delay longer than this is not worth honouring: the feed counts as disallowed. */
export const MAX_CRAWL_DELAY_MS = 60_000;
/** A parsed robots.txt is reused for this long per origin. */
export const ROBOTS_TTL_MS = 6 * 3_600_000;
/** A robots.txt that could not be read (5xx, timeout) is asked again after this long. */
export const ROBOTS_ERROR_TTL_MS = 60_000;

/** robots.txt disallows the request (or asks for a Crawl-delay too long to honour). The board is disabled, not retried. */
export class RobotsDisallowedError extends Error {
  constructor(readonly url: string, readonly reason = "disallowed by robots.txt") {
    super(`${url}: ${reason}`);
    this.name = "RobotsDisallowedError";
  }
}

/** robots.txt could not be read (5xx or timeout): nothing is fetched from that origin until it can (retryable). */
export class RobotsUnavailableError extends Error {
  constructor(readonly origin: string, why: string) {
    super(`robots.txt of ${origin} unavailable: ${why}`);
    this.name = "RobotsUnavailableError";
  }
}

function ruleRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Parse robots.txt for the agent token (the User-Agent's product name, lower case). */
export function parseRobots(text: string, agentToken: string): Robots {
  type Group = { agents: string[]; rules: Rule[]; delay: number | null };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let collecting = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    if (key === "user-agent") {
      if (!cur || !collecting) { cur = { agents: [], rules: [], delay: null }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      collecting = true;
      continue;
    }
    collecting = false;
    if (!cur) continue;
    if (key === "allow" || key === "disallow") {
      if (val === "") continue;
      cur.rules.push({ allow: key === "allow", len: val.length, re: ruleRegex(val) });
    } else if (key === "crawl-delay") {
      const n = Number(val);
      if (Number.isFinite(n) && n > 0) cur.delay = n * 1000;
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && a && agentToken.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  return { rules: chosen.flatMap((g) => g.rules), delayMs: Math.max(0, ...chosen.map((g) => g.delay ?? 0)) };
}

/** Longest matching rule wins; Allow wins a tie; no matching rule means allowed. */
export function robotsAllows(r: Robots, pathAndQuery: string): boolean {
  let best: Rule | null = null;
  for (const rule of r.rules) {
    if (!rule.re.test(pathAndQuery)) continue;
    if (!best || rule.len > best.len || (rule.len === best.len && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}
