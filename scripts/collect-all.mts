/**
 * Full job collection: verify every candidate company in the registry against its real public feed and collect its jobs.
 * One board read per company, with the existing connectors and `pollBoard` (upsert, two-complete-reads closing, probation,
 * dead and disabled statuses, ETag), under polite HTTP:
 *
 *   - our User-Agent, per-host-group concurrency from the connectors' capabilities (`maxPollsPerHost`), a global cap;
 *   - robots.txt is read once per origin and obeyed for every request (Disallow rules, Crawl-delay); a board whose feed is
 *     disallowed is disabled with the reason, never fetched; SmartRecruiters is skipped outright;
 *   - 429/503 (RateLimitedError) and a run of refusals (401/403, BlockedByHostError) back the whole host group off with a
 *     growing pause; a group that keeps refusing is left for the next run instead of being hammered;
 *   - a dead network (laptop asleep or offline) pauses everything; DNS "not found" for a tenant's own host marks the board dead.
 *
 * Resumable: progress lives in the database. A board that has been verified is no longer a `candidate`, so a rerun only takes
 * the candidates that are left (including boards whose last attempt failed). Counters and run times are kept in `collect_meta`.
 * No AI calls. Writes only to the PGlite folder given with --db (never DATABASE_URL).
 *
 *   npx tsx scripts/collect-all.mts --db data/collect-full [--only workday,lever] [--concurrency 4] [--limit 500]
 *                                   [--total-cap 64] [--doc docs/collection-full-run.md]
 */
import { promises as dns } from "node:dns";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connect, migrate, eq, sql, queryRows, companies } from "@norinote/db";
import type { Db } from "@norinote/db";
import type { AtsType } from "@norinote/shared";
import { DEFAULT_RESOLVERS, judgeDnsFailure } from "./lib/dns-guard.js";
import {
  BlockedByHostError, HostBackedOffError, HostBackoff, RateLimitedError, SUPPORTED_ATS_TYPES, USER_AGENT, feedHost, isSupportedAts,
  maxPollsPerHost, pollBoard, RECHECK_MS,
} from "@norinote/ingest";

// ---------------------------------------------------------------------------------------------------------------------
// Arguments and safety
// ---------------------------------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const value = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const dbArg = value("db");
if (!dbArg) { console.error("usage: npx tsx scripts/collect-all.mts --db <pglite dir> [--only a,b] [--concurrency n] [--limit n] [--total-cap n] [--doc path]"); process.exit(2); }
const dbDir = path.resolve(dbArg);
if (/norinote-cov|norinote-eval/i.test(dbDir) || dbDir === path.resolve("data/pglite")) {
  console.error(`refusing to write to ${dbDir}: use a dedicated folder (for example data/collect-full)`);
  process.exit(2);
}
const concurrencyFlag = value("concurrency") ? Math.max(1, Number(value("concurrency"))) : Infinity;
const limit = value("limit") ? Math.max(1, Number(value("limit"))) : Infinity;
const totalCap = Math.max(1, Number(value("total-cap") ?? 64));
const docPath = path.resolve(value("doc") ?? "docs/collection-full-run.md");
const only = value("only")?.split(",").map((s) => s.trim()).filter(Boolean);

/** Job systems never polled by this run, with the reason. */
const SKIPPED_SYSTEMS: Partial<Record<AtsType, string>> = { smartrecruiters: "robots.txt disallows every path for our User-Agent" };
/** Systems where every tenant has its own hostname: a DNS "not found" there means the board does not exist. */
const TENANT_HOST_SYSTEMS: ReadonlySet<AtsType> = new Set<AtsType>(["recruitee", "teamtailor", "personio", "bamboohr", "breezy", "pinpoint", "icims", "workday", "oracle"]);

if (only) {
  const bad = only.filter((s) => !isSupportedAts(s) || SKIPPED_SYSTEMS[s as AtsType]);
  if (bad.length) { console.error(`cannot collect: ${bad.join(", ")} (unknown, unsupported or skipped)`); process.exit(2); }
}
const systems = SUPPORTED_ATS_TYPES.filter((s) => !SKIPPED_SYSTEMS[s] && (!only || only.includes(s)));

const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MIN = 60_000;

if (process.env.DATABASE_URL?.trim()) log("DATABASE_URL is set and ignored: this script only writes to the PGlite folder from --db");

process.on("unhandledRejection", (e) => log(`unhandled rejection: ${(e as Error)?.stack ?? e}`));
process.on("uncaughtException", (e) => log(`uncaught exception: ${e.stack ?? e}`));

// ---------------------------------------------------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------------------------------------------------

type Rule = { allow: boolean; len: number; re: RegExp };
type Robots = { rules: Rule[]; delayMs: number };
const NO_ROBOTS: Robots = { rules: [], delayMs: 0 };
const UA_TOKEN = (USER_AGENT.split("/")[0] ?? "NorinoteJobAgent").toLowerCase();

class RobotsDisallowedError extends Error {
  constructor(readonly url: string, why = "disallowed by robots.txt") { super(`${url}: ${why}`); this.name = "RobotsDisallowedError"; }
}
class RobotsUnavailableError extends Error {
  constructor(readonly origin: string, why: string) { super(`robots.txt of ${origin} unavailable: ${why}`); this.name = "RobotsUnavailableError"; }
}

function ruleRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Parse robots.txt for our User-Agent (RFC 9309: the most specific matching group, else `*`). */
export function parseRobots(text: string): Robots {
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
      if (val === "") continue; // an empty Disallow allows everything; an empty Allow changes nothing
      cur.rules.push({ allow: key === "allow", len: val.length, re: ruleRegex(val) });
    } else if (key === "crawl-delay") {
      const n = Number(val);
      if (Number.isFinite(n) && n > 0) cur.delay = n * 1000;
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && a && UA_TOKEN.includes(a)));
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

const MAX_CRAWL_DELAY_MS = 60_000;
const ROBOTS_TTL_MS = 6 * 3_600_000;
const ROBOTS_ERROR_TTL_MS = 60_000;
const robotsCache = new Map<string, { at: number; value?: Robots; error?: Error }>();
const robotsInFlight = new Map<string, Promise<Robots>>();
const nextSlot = new Map<string, number>();

async function loadRobots(origin: string): Promise<Robots> {
  const url = `${origin}/robots.txt`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "text/plain" }, signal: ctrl.signal });
    if (res.status === 429 || res.status === 503) { void res.body?.cancel().catch(() => {}); throw new RateLimitedError(url, res.status, 1); }
    if (res.status >= 500) { void res.body?.cancel().catch(() => {}); throw new RobotsUnavailableError(origin, `HTTP ${res.status}`); }
    // 4xx (not found, unauthorised, ...): no usable robots.txt, so nothing is disallowed (RFC 9309 section 2.3.1.3).
    if (!res.ok) { void res.body?.cancel().catch(() => {}); return NO_ROBOTS; }
    if (/html/i.test(res.headers.get("content-type") ?? "")) { void res.body?.cancel().catch(() => {}); return NO_ROBOTS; }
    return parseRobots((await res.text()).slice(0, 512 * 1024));
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new RobotsUnavailableError(origin, "timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function robotsFor(origin: string): Promise<Robots> {
  const hit = robotsCache.get(origin);
  if (hit && Date.now() - hit.at < (hit.error ? ROBOTS_ERROR_TTL_MS : ROBOTS_TTL_MS)) {
    if (hit.error) throw hit.error;
    return hit.value!;
  }
  let pending = robotsInFlight.get(origin);
  if (!pending) {
    pending = loadRobots(origin).then((value) => {
      robotsCache.set(origin, { at: Date.now(), value });
      if (value.delayMs > 0) nextSlot.set(origin, Date.now() + Math.min(value.delayMs, MAX_CRAWL_DELAY_MS));
      return value;
    }, (error: Error) => {
      robotsCache.set(origin, { at: Date.now(), error });
      throw error;
    }).finally(() => robotsInFlight.delete(origin));
    robotsInFlight.set(origin, pending);
  }
  return pending;
}

/** fetch() that reads and obeys robots.txt (Disallow and Crawl-delay) for every request. Passed to the connectors. */
const politeFetch: typeof fetch = async (input, init) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const u = new URL(href);
  const robots = await robotsFor(u.origin);
  if (!robotsAllows(robots, u.pathname + u.search)) throw new RobotsDisallowedError(href);
  if (robots.delayMs > MAX_CRAWL_DELAY_MS) throw new RobotsDisallowedError(href, `Crawl-delay of ${robots.delayMs / 1000}s is too long to honour`);
  if (robots.delayMs > 0) {
    const now = Date.now();
    const at = Math.max(now, nextSlot.get(u.origin) ?? 0);
    nextSlot.set(u.origin, at + robots.delayMs);
    if (at > now) await sleep(at - now);
  }
  return fetch(input, init);
};

// ---------------------------------------------------------------------------------------------------------------------
// Network health
// ---------------------------------------------------------------------------------------------------------------------

let netChecked = 0;
let netOk = true;
/** Hosts whose lookup failed recently: the network counts as back only when these resolve again through the OS resolver. */
const netProbeHosts: { host: string; tenant: boolean }[] = [];
const noteProbeHost = (host: string, tenant: boolean) => {
  if (!host || netProbeHosts.some((p) => p.host === host)) return;
  netProbeHosts.push({ host, tenant });
  if (netProbeHosts.length > 3) netProbeHosts.shift();
};
const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms).unref())]);
let netProbe: Promise<boolean> | null = null;
let lastNetLog = 0;
/** One health check at a time, cached for 10 s. Up means: the OS resolver answers a control host and every recently failed host. */
function networkUp(): Promise<boolean> {
  if (Date.now() - netChecked < 10_000) return Promise.resolve(netOk);
  netProbe ??= (async () => {
    let why = "";
    try {
      await withTimeout(dns.lookup("one.one.one.one"), 8_000);
      for (const p of [...netProbeHosts]) {
        try { await withTimeout(dns.lookup(p.host), 8_000); } catch (err) {
          // Still unresolvable here: fine only when two public resolvers confirm the host really does not exist.
          if ((await judgeDnsFailure({ host: p.host, tenantHostSystem: p.tenant, lastSuccessAt: Date.now() })) !== "dead") { why = `${p.host}: ${(err as Error).message}`; throw err; }
        }
      }
      netOk = true;
      netProbeHosts.length = 0;
    } catch (err) {
      netOk = false;
      if (Date.now() - lastNetLog > 30_000) { lastNetLog = Date.now(); log(`network check failed: ${why || (err as Error).message}`); }
    }
    netChecked = Date.now();
    return netOk;
  })().finally(() => { netProbe = null; });
  return netProbe;
}
let netDownSince = 0;
/** When any board last got an HTTP answer of any kind: DNS failures only count as evidence while this is fresh. */
let lastOkAt = Date.now();
function pauseForNetwork(why: string): void {
  if (!netDownSince) { netDownSince = Date.now(); log(`NETWORK PROBLEM (${why}): pausing all polling until DNS answers again`); bump("network-pauses"); }
}

// ---------------------------------------------------------------------------------------------------------------------
// Database, meta counters
// ---------------------------------------------------------------------------------------------------------------------

log(`opening ${dbDir}`);
const handle = await connect({ pgliteDir: dbDir });
await migrate(handle);
const db: Db = handle.db;
await db.execute(sql`create table if not exists collect_meta (key text primary key, value double precision not null default 0, text_value text)`);

const pendingMeta = new Map<string, number>();
const bump = (key: string, n = 1) => pendingMeta.set(key, (pendingMeta.get(key) ?? 0) + n);
async function flushMeta(): Promise<void> {
  const entries = [...pendingMeta.entries()];
  pendingMeta.clear();
  for (const [key, n] of entries) {
    await db.execute(sql`insert into collect_meta (key, value) values (${key}, ${n}) on conflict (key) do update set value = collect_meta.value + excluded.value`);
  }
}
async function setText(key: string, text: string, overwrite = true): Promise<void> {
  await db.execute(overwrite
    ? sql`insert into collect_meta (key, value, text_value) values (${key}, 0, ${text}) on conflict (key) do update set text_value = excluded.text_value`
    : sql`insert into collect_meta (key, value, text_value) values (${key}, 0, ${text}) on conflict (key) do nothing`);
}
const getMeta = async (): Promise<Map<string, { value: number; text: string | null }>> => {
  const rows = await queryRows<{ key: string; value: number; text_value: string | null }>(db, sql`select key, value, text_value from collect_meta`);
  return new Map(rows.map((r) => [r.key, { value: Number(r.value), text: r.text_value }]));
};
await setText("started_at", new Date().toISOString(), false);
await setText("last_started_at", new Date().toISOString());

// ---------------------------------------------------------------------------------------------------------------------
// Scheduler: per host group concurrency, cooldowns, retries
// ---------------------------------------------------------------------------------------------------------------------

type Task = { id: string; atsType: AtsType; token: string; name: string; group: string; tries: number; notBefore: number; dnsRetries?: number };
type Group = {
  key: string; atsType: AtsType; limit: number; queue: Task[]; head: number; later: Task[]; inflight: number;
  cooldownUntil: number; level: number; good: number; window: boolean[]; blockedRun: number; abandoned: boolean;
};

const groups = new Map<string, Group>();
const sysStats = new Map<AtsType, { started: number; done: number; live: number; empty: number; dead: number; blocked: number; jobsAdded: number }>();
const errorKinds = new Map<string, number>();
const sysErrorKinds = new Map<AtsType, Map<string, number>>();
let inflightTotal = 0;
let finalized = 0;
let jobsAddedTotal = 0;
let stopping = false;
let lastCompletion = Date.now();

const stat = (s: AtsType) => {
  let v = sysStats.get(s);
  if (!v) { v = { started: 0, done: 0, live: 0, empty: 0, dead: 0, blocked: 0, jobsAdded: 0 }; sysStats.set(s, v); }
  return v;
};
function countError(system: AtsType, kind: string): void {
  errorKinds.set(kind, (errorKinds.get(kind) ?? 0) + 1);
  const m = sysErrorKinds.get(system) ?? new Map<string, number>();
  m.set(kind, (m.get(kind) ?? 0) + 1);
  sysErrorKinds.set(system, m);
  bump(`err:${kind}`);
}

/** Cool the group down (host refusing us); after repeated trips with no recovery it is left alone for this run. */
function trip(g: Group, reason: string): void {
  if (g.abandoned || g.cooldownUntil > Date.now()) return;
  g.level++;
  g.window = [];
  g.blockedRun = 0;
  g.good = 0;
  if (g.level >= 4) {
    g.abandoned = true;
    const left = g.queue.length - g.head + g.later.length;
    log(`BACKOFF ${g.key}: ${reason}; refused ${g.level} times despite pauses, leaving its ${left} remaining boards for the next run`);
    bump(`abandoned:${g.atsType}`, left);
    return;
  }
  const pause = Math.min(30 * MIN, 2 * MIN * 2 ** (g.level - 1));
  g.cooldownUntil = Date.now() + pause;
  log(`BACKOFF ${g.key}: ${reason}; pausing this host group for ${Math.round(pause / MIN)} min (level ${g.level})`);
  bump(`backoffs:${g.atsType}`);
}

/** Host back-off for pollBoard that expires: 2 rate-limited boards in a row trip the group's cooldown. */
class CooldownBackoff extends HostBackoff {
  private strikes = new Map<string, number>();
  constructor() { super(2); }
  override isBackedOff(host: string): boolean { const g = groups.get(host); return !!g && (g.abandoned || g.cooldownUntil > Date.now()); }
  override rateLimited(host: string): boolean {
    const n = (this.strikes.get(host) ?? 0) + 1;
    this.strikes.set(host, n);
    const g = groups.get(host);
    if (n >= 2 && g) { this.strikes.set(host, 0); trip(g, "429/503 on consecutive boards"); return true; }
    return false;
  }
  override ok(host: string): void { this.strikes.set(host, 0); }
}
const backoff = new CooldownBackoff();

function noteOutcome(g: Group, kind: "good" | "refused" | "other"): void {
  g.window.push(kind === "refused");
  if (g.window.length > 20) g.window.shift();
  if (kind === "refused") { g.good = 0; g.blockedRun++; } else { g.blockedRun = 0; if (kind === "good" && ++g.good >= 20) g.level = 0; }
  if (g.window.length >= 20 && g.window.filter(Boolean).length >= 15) trip(g, "15 of the last 20 boards refused (429/401/403)");
  else if (g.blockedRun >= 6 && g.key === feedHost(g.atsType, undefined)) trip(g, "6 refusals in a row from a shared feed host");
}

function errorCode(err: unknown): string | null {
  for (let e = err as { code?: string; cause?: unknown } | undefined, i = 0; e && i < 5; e = e.cause as typeof e, i++) if (typeof e.code === "string") return e.code;
  return null;
}
const NETWORK_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);

function classify(err: unknown): { kind: string; network: boolean } {
  const e = err as Error;
  if (e instanceof RateLimitedError) return { kind: `rate-limited-${e.status}`, network: false };
  if (e instanceof BlockedByHostError) return { kind: `blocked-by-host-${e.status}`, network: false };
  if (e instanceof RobotsDisallowedError) return { kind: "robots-disallowed", network: false };
  if (e instanceof RobotsUnavailableError) return { kind: "robots-unavailable", network: /timed out/.test(e.message) };
  if (e instanceof HostBackedOffError) return { kind: "host-backed-off", network: false };
  const msg = e?.message ?? String(err);
  const code = errorCode(err);
  if (code && NETWORK_CODES.has(code)) return { kind: `network-${code}`, network: true };
  if (/timed out/i.test(msg)) return { kind: "timeout", network: true };
  const http = msg.match(/failed: (\d{3})/);
  if (http) return { kind: `http-${http[1]}`, network: false };
  if (/fetch failed/i.test(msg)) return { kind: `network-${code ?? "fetch-failed"}`, network: true };
  if (/JSON|Unexpected token|Unexpected end|parse/i.test(msg)) return { kind: "bad-response", network: false };
  if (/certificate|SSL|TLS|CERT/i.test(msg) || (code ?? "").startsWith("ERR_TLS") || (code ?? "").includes("CERT")) return { kind: "tls", network: false };
  return { kind: `other:${(e?.name ?? "Error")}`, network: false };
}

async function setReason(id: string, reason: string): Promise<void> {
  await db.update(companies).set({ statusReason: reason.slice(0, 200) }).where(eq(companies.id, id));
}

function requeue(g: Group, t: Task, delayMs: number): void {
  t.notBefore = Date.now() + delayMs;
  g.later.push(t);
}

class StuckError extends Error {
  constructor(token: string) { super(`board ${token} did not finish within ${STUCK_MS / MIN} min`); this.name = "StuckError"; }
}
/** A board read that takes longer than this is abandoned (its slot is freed; the board stays a candidate). */
const STUCK_MS = 15 * MIN;
const running = new Map<string, { t: Task; since: number }>();

async function runTask(g: Group, t: Task): Promise<void> {
  g.inflight++;
  inflightTotal++;
  sysInflight.set(t.atsType, (sysInflight.get(t.atsType) ?? 0) + 1);
  const st = stat(t.atsType);
  st.started++;
  running.set(t.id, { t, since: Date.now() });
  let watchdog: NodeJS.Timeout | undefined;
  try {
    const res = await Promise.race([
      pollBoard(db, { atsType: t.atsType, token: t.token }, { backoff, fetch: politeFetch }),
      new Promise<never>((_, reject) => { watchdog = setTimeout(() => reject(new StuckError(t.token)), STUCK_MS); }),
    ]);
    lastOkAt = Date.now();
    if (res.skipped) { st.done++; finalized++; bump("skipped-blocklist"); return; }
    if (res.notFound) {
      st.dead++; st.done++; finalized++; noteOutcome(g, "good");
      return;
    }
    if (!res.complete && res.total === 0 && res.status === "candidate") {
      // Nothing proven: an incomplete read with no jobs leaves the board a candidate.
      if (t.tries < 1) { t.tries++; requeue(g, t, 30_000); noteOutcome(g, "other"); bump("incomplete-reads"); return; }
      countError(t.atsType, "incomplete-read");
      await setReason(t.id, "error:incomplete-read");
      noteOutcome(g, "other");
      return;
    }
    if (!res.complete) bump("incomplete-reads");
    if (res.status === "disabled") { st.blocked++; } else if (res.total > 0) st.live++; else st.empty++;
    st.done++; finalized++; st.jobsAdded += res.added; jobsAddedTotal += res.added;
    noteOutcome(g, "good");
  } catch (err) {
    await handleError(g, t, err);
  } finally {
    clearTimeout(watchdog);
    running.delete(t.id);
    g.inflight--;
    inflightTotal--;
    sysInflight.set(t.atsType, (sysInflight.get(t.atsType) ?? 1) - 1);
    lastCompletion = Date.now();
    pump();
  }
}

async function handleError(g: Group, t: Task, err: unknown): Promise<void> {
  const st = stat(t.atsType);
  const { kind, network } = classify(err);

  if (err instanceof HostBackedOffError) { requeue(g, t, Math.max(5_000, g.cooldownUntil - Date.now())); bump("deferrals"); return; }

  if (err instanceof StuckError) {
    countError(t.atsType, "stuck");
    await setReason(t.id, `error:stuck: ${err.message}`);
    return;
  }

  // A lookup that fails with ENOTFOUND is never taken at face value (see scripts/lib/dns-guard.ts): only tenant hosts that
  // two public resolvers both call non-existent, while other boards are answering, mean a dead board. Everything else
  // (a shared API host, a host a public resolver can find, no recent answers) is a network problem: pause, retry later.
  if (errorCode(err) === "ENOTFOUND") {
    const host = (err as { cause?: { hostname?: string } }).cause?.hostname ?? (err as { hostname?: string }).hostname ?? "";
    const verdict = host ? await judgeDnsFailure({ host, tenantHostSystem: TENANT_HOST_SYSTEMS.has(t.atsType), lastSuccessAt: lastOkAt }) : "network";
    if (verdict === "dead") {
      countError(t.atsType, "dns-not-found");
      const now = new Date();
      await db.update(companies).set({
        status: "dead", statusReason: "host not found (DNS, confirmed by 1.1.1.1 and 8.8.8.8)", lastPolledAt: now,
        nextPollAt: new Date(now.getTime() + RECHECK_MS), errorStreak: 0,
      }).where(eq(companies.id, t.id));
      st.dead++; st.done++; finalized++; noteOutcome(g, "good");
      return;
    }
    countError(t.atsType, "dns-failure-unconfirmed");
    t.dnsRetries = (t.dnsRetries ?? 0) + 1;
    if (t.dnsRetries > 3) {
      // Not an outage after all (the network was healthy again each time): leave the board a candidate for the next run.
      await setReason(t.id, `error:dns-failure-unconfirmed: ${host}`);
      return;
    }
    noteProbeHost(host, TENANT_HOST_SYSTEMS.has(t.atsType));
    pauseForNetwork(`ENOTFOUND for ${host || t.token} not confirmed by public resolvers`);
    requeue(g, t, 15_000);
    return;
  }

  if (network && !(await networkUp())) {
    pauseForNetwork("control lookup failed");
    requeue(g, t, 15_000);
    return;
  }
  if (!network) lastOkAt = Date.now();

  if (err instanceof BlockedByHostError) {
    countError(t.atsType, kind); st.blocked++; st.done++; finalized++; noteOutcome(g, "refused");
    return;
  }
  if (err instanceof RobotsDisallowedError) {
    countError(t.atsType, kind);
    await db.update(companies).set({
      status: "disabled", statusReason: err.message.includes("Crawl-delay") ? "robots.txt crawl-delay too long" : "disallowed by robots.txt",
      lastPolledAt: new Date(), nextPollAt: new Date(Date.now() + RECHECK_MS), errorStreak: 0,
    }).where(eq(companies.id, t.id));
    st.blocked++; st.done++; finalized++; noteOutcome(g, "other");
    return;
  }
  if (err instanceof RateLimitedError) {
    countError(t.atsType, kind); noteOutcome(g, "refused");
    if (t.tries < 3 && !g.abandoned) { t.tries++; requeue(g, t, Math.max(30_000, g.cooldownUntil - Date.now())); return; }
    await setReason(t.id, `error:${kind}`);
    return;
  }
  countError(t.atsType, kind);
  noteOutcome(g, "other");
  if (t.tries < 1) { t.tries++; requeue(g, t, 20_000); return; }
  await setReason(t.id, `error:${kind}: ${(err as Error)?.message ?? err}`);
}

function take(g: Group, now: number): Task | null {
  if (g.head < g.queue.length) return g.queue[g.head++]!;
  if (g.queue.length) { g.queue = []; g.head = 0; }
  const i = g.later.findIndex((t) => t.notBefore <= now);
  if (i < 0) return null;
  return g.later.splice(i, 1)[0]!;
}

let pumping = false;
let cursor = 0;
const sysInflight = new Map<AtsType, number>();
/** Most boards of one job system in flight at once, whatever its number of host groups (Workday and Oracle have hundreds). */
const SYSTEM_CAP = 16;
function pump(): void {
  if (pumping || stopping) return;
  pumping = true;
  try {
    const now = Date.now();
    if (netDownSince) return;
    let progressed = true;
    while (progressed && inflightTotal < totalCap) {
      progressed = false;
      // Round robin from where the last pass stopped, so no group is starved when the global cap is reached.
      const list = [...groups.values()];
      const n = list.length;
      for (let k = 0; k < n && inflightTotal < totalCap; k++) {
        const g = list[(cursor + k) % n]!;
        if (g.abandoned || g.inflight >= g.limit || g.cooldownUntil > now || (sysInflight.get(g.atsType) ?? 0) >= SYSTEM_CAP) continue;
        const t = take(g, now);
        if (!t) continue;
        progressed = true;
        cursor = (cursor + k + 1) % n;
        void runTask(g, t);
        break;
      }
    }
  } finally {
    pumping = false;
  }
}

const remaining = () => { let n = 0; for (const g of groups.values()) if (!g.abandoned) n += g.queue.length - g.head + g.later.length; return n; };
const activeSystems = () => { const s = new Set<AtsType>(); for (const g of groups.values()) if (g.inflight > 0 || (!g.abandoned && g.queue.length - g.head + g.later.length > 0)) s.add(g.atsType); return s; };

// ---------------------------------------------------------------------------------------------------------------------
// Load work
// ---------------------------------------------------------------------------------------------------------------------

// Boards whose last failure was recorded by an earlier session wait out a back-off of 30 minutes or more; a new session retries them now.
await db.execute(sql`update companies set next_poll_at = null where status = 'candidate' and next_poll_at > now()`);

type Pending = { id: string; ats_type: AtsType; ats_token: string; name: string };
const systemList = sql.join(systems.map((s) => sql`${s}`), sql`, `);
const pending = await queryRows<Pending>(db, sql`
  select id, ats_type, ats_token, name from companies
  where blocked = false and status = 'candidate' and ats_type in (${systemList})
    and (next_poll_at is null or next_poll_at <= now())
  order by ${Number.isFinite(limit) ? sql`random()` : sql`priority desc, created_at, id`}
  ${Number.isFinite(limit) ? sql`limit ${limit}` : sql``}`);
for (const p of pending) {
  const key = feedHost(p.ats_type, p.ats_token);
  let g = groups.get(key);
  if (!g) {
    g = {
      key, atsType: p.ats_type, limit: Math.max(1, Math.min(maxPollsPerHost(p.ats_type), concurrencyFlag)), queue: [], head: 0, later: [],
      inflight: 0, cooldownUntil: 0, level: 0, good: 0, window: [], blockedRun: 0, abandoned: false,
    };
    groups.set(key, g);
  }
  g.queue.push({ id: p.id, atsType: p.ats_type, token: p.ats_token, name: p.name, group: key, tries: 0, notBefore: 0 });
}
const perSystemPending = new Map<AtsType, number>();
for (const p of pending) perSystemPending.set(p.ats_type, (perSystemPending.get(p.ats_type) ?? 0) + 1);
log(`to collect this session: ${pending.length} candidate companies in ${groups.size} host groups; systems: ${systems.join(", ")}`);
log(`per-group concurrency: ${[...new Set(systems)].map((s) => `${s}=${Math.max(1, Math.min(maxPollsPerHost(s), concurrencyFlag))}`).join(" ")}; global cap ${totalCap}`);
log(`pending per system: ${[...perSystemPending].map(([s, n]) => `${s}=${n}`).join(" ")}`);

// ---------------------------------------------------------------------------------------------------------------------
// Progress and summary
// ---------------------------------------------------------------------------------------------------------------------

const SHORT: Record<string, string> = {
  greenhouse: "gh", lever: "lv", ashby: "ab", workday: "wd", oracle: "or", workable: "wk", recruitee: "rc", teamtailor: "tt",
  personio: "pe", bamboohr: "bh", breezy: "bz", rippling: "rp", pinpoint: "pp", icims: "ic", smartrecruiters: "sr",
};

type SysRow = { ats_type: AtsType; total: number; done: number; live: number; empty: number; dead: number; blocked: number; pending: number; median: number | null };
async function systemRows(): Promise<SysRow[]> {
  return queryRows<SysRow>(db, sql`
    select ats_type,
      count(*)::int as total,
      count(*) filter (where status <> 'candidate')::int as done,
      count(*) filter (where status in ('active', 'probation') and last_job_count > 0)::int as live,
      count(*) filter (where status in ('active', 'probation') and last_job_count = 0)::int as empty,
      count(*) filter (where status = 'dead')::int as dead,
      count(*) filter (where status = 'disabled')::int as blocked,
      count(*) filter (where status = 'candidate')::int as pending,
      percentile_cont(0.5) within group (order by last_job_count) filter (where status in ('active', 'probation') and last_job_count > 0) as median
    from companies where blocked = false group by ats_type order by ats_type`);
}

const startedAt = Date.now();
let lastTickFinalized = 0;
let lastTickJobs = 0;
let tickNo = 0;

let lastTickAt = Date.now();
async function tick(): Promise<void> {
  tickNo++;
  const dt = Date.now() - lastTickAt;
  lastTickAt = Date.now();
  for (const s of activeSystems()) bump(`sys_ms:${s}`, dt);
  bump("total_ms", dt);
  await flushMeta();
  const rows = await systemRows();
  const [open] = await queryRows<{ n: number }>(db, sql`select count(*)::int as n from jobs where closed_at is null`);
  const done = rows.reduce((a, r) => a + r.done, 0);
  const total = rows.reduce((a, r) => a + r.total, 0);
  const live = rows.reduce((a, r) => a + r.live, 0);
  const dead = rows.reduce((a, r) => a + r.dead, 0);
  const blocked = rows.reduce((a, r) => a + r.blocked, 0);
  const perMin = finalized - lastTickFinalized;
  const jobsMin = jobsAddedTotal - lastTickJobs;
  lastTickFinalized = finalized;
  lastTickJobs = jobsAddedTotal;
  const errs = [...errorKinds].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k}:${n}`).join(" ") || "none";
  const cooling = [...groups.values()].filter((g) => g.abandoned || g.cooldownUntil > Date.now()).map((g) => `${g.key}${g.abandoned ? "(left)" : ""}`);
  log(`PROGRESS done ${done}/${total} | this session ${finalized} (${perMin}/min) | live ${live} dead ${dead} blocked ${blocked} | open jobs ${open?.n ?? 0} (+${jobsMin}/min) | in flight ${inflightTotal} queued ${remaining()} | errors ${errs}${cooling.length ? ` | cooling ${cooling.join(",")}` : ""}${netDownSince ? " | NETWORK DOWN" : ""}`);
  log(`  per system: ${rows.filter((r) => systems.includes(r.ats_type)).map((r) => `${SHORT[r.ats_type] ?? r.ats_type} ${r.done}/${r.total} L${r.live} D${r.dead} B${r.blocked}`).join(" | ")}`);
  if (tickNo % 5 === 0) { try { await db.execute(sql`checkpoint`); } catch { /* not supported: ignore */ } }
  if (tickNo % 10 === 0) await writeSummary(false);
  for (const { t, since } of running.values()) if (Date.now() - since > 5 * MIN) log(`  slow board: ${t.atsType} ${t.token} running for ${Math.round((Date.now() - since) / MIN)} min`);
  if (Date.now() - lastCompletion > 5 * MIN && inflightTotal > 0) log(`WARNING: no board finished for ${Math.round((Date.now() - lastCompletion) / MIN)} min (${inflightTotal} in flight)`);
}

const fmtDur = (ms: number) => { const m = Math.round(ms / MIN); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
const n0 = (n: number | null | undefined) => (n == null ? "0" : String(Math.round(Number(n))));

async function writeSummary(final: boolean): Promise<void> {
  await flushMeta();
  const meta = await getMeta();
  const rows = await systemRows();
  const jobRows = await queryRows<{ ats_type: AtsType; open: number; recent: number; undated: number; closed: number }>(db, sql`
    select ats_type,
      count(*) filter (where closed_at is null)::int as open,
      count(*) filter (where closed_at is null and posted_at >= now() - interval '60 days')::int as recent,
      count(*) filter (where closed_at is null and posted_at is null)::int as undated,
      count(*) filter (where closed_at is not null)::int as closed
    from jobs group by ats_type`);
  const jobBy = new Map(jobRows.map((r) => [r.ats_type, r]));
  const reasons = await queryRows<{ reason: string; status: string; n: number }>(db, sql`
    select case when status_reason like 'error:%' then 'error:' || split_part(status_reason, ':', 2) else status_reason end as reason, status, count(*)::int as n
    from companies where blocked = false and status in ('candidate', 'disabled', 'dead') and status_reason is not null
    group by 1, 2 order by n desc limit 15`);
  const events = [...meta].filter(([k]) => k.startsWith("err:")).map(([k, v]) => [k.slice(4), v.value] as const).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const pendingTotal = rows.reduce((a, r) => a + r.pending, 0);
  const startedIso = meta.get("started_at")?.text ?? new Date(startedAt).toISOString();
  const totalMs = meta.get("total_ms")?.value ?? 0;
  const sum = (f: (r: SysRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const jsum = (f: (r: { open: number; recent: number; undated: number }) => number) => jobRows.reduce((a, r) => a + f(r), 0);

  const lines: string[] = [];
  lines.push("# Full job collection run", "");
  lines.push(`Status: ${final && pendingTotal === 0 ? "complete" : final ? `finished this session, ${pendingTotal} candidates still pending (rerun to continue)` : "in progress (updated every 10 minutes)"}.`);
  lines.push(`Started ${startedIso}; written ${new Date().toISOString()}; active run time ${fmtDur(totalMs)} (sum over restarts).`, "");
  lines.push("One verification read per candidate company of the registry (imported from the seed lists), with the existing connectors and `pollBoard`: our User-Agent, per-host-group concurrency from the connector capabilities, robots.txt (Disallow and Crawl-delay) obeyed on every request, ETag stored for the next poll, back-off on 429/503 and on runs of 401/403, 3-day probation and dead statuses per `docs/job-collection.md`. A job closes only after two complete reads miss it, so a first read closes nothing. No AI calls. Produced by `scripts/collect-all.mts`.", "");
  lines.push("| System | Candidates | Live | Empty | Dead | Blocked | Pending | Open jobs | Posted last 60 d | Median jobs / live board | Run time |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of rows) {
    const j = jobBy.get(r.ats_type);
    const skipped = SKIPPED_SYSTEMS[r.ats_type];
    lines.push(`| ${r.ats_type}${skipped ? " (skipped)" : ""} | ${r.total} | ${r.live} | ${r.empty} | ${r.dead} | ${r.blocked} | ${r.pending} | ${j?.open ?? 0} | ${j?.recent ?? 0} | ${r.median == null ? "-" : n0(r.median)} | ${fmtDur(meta.get(`sys_ms:${r.ats_type}`)?.value ?? 0)} |`);
  }
  lines.push(`| **Total** | ${sum((r) => r.total)} | ${sum((r) => r.live)} | ${sum((r) => r.empty)} | ${sum((r) => r.dead)} | ${sum((r) => r.blocked)} | ${pendingTotal} | ${jsum((r) => r.open)} | ${jsum((r) => r.recent)} | | ${fmtDur(totalMs)} |`, "");
  lines.push("Columns: **Live** is an active board with at least one open job; **Empty** an active board with none; **Dead** a board that is not found (HTTP 404, or the tenant host does not resolve); **Blocked** a board disabled because its host answered 401/403 or robots.txt disallows the feed; **Pending** a candidate whose reads kept failing (see errors) or that was not reached yet. **Posted last 60 d** counts open jobs whose feed gives a `posted_at` within 60 days; "
    + `${jsum((r) => r.undated)} open jobs have no posting date in their feed. Run time is the time the system still had boards in flight or queued, summed over restarts.`, "");
  const skippedLines = Object.entries(SKIPPED_SYSTEMS).map(([s, why]) => `- ${s}: not polled, ${why}.`);
  if (skippedLines.length) lines.push("Skipped systems:", ...skippedLines, "");
  lines.push("## Top error kinds", "");
  if (events.length) {
    lines.push("Error events during the run (every failed attempt counts, including ones a retry later fixed):", "", "| Kind | Events |", "|---|---:|", ...events.map(([k, n]) => `| ${k} | ${n} |`), "");
  } else lines.push("No errors recorded.", "");
  if (reasons.length) {
    lines.push("Final reasons on boards that are not live (candidate = still pending, disabled, dead):", "", "| Reason | Status | Boards |", "|---|---|---:|", ...reasons.map((r) => `| ${r.reason} | ${r.status} | ${r.n} |`), "");
  }
  const bo = [...meta].filter(([k]) => k.startsWith("backoffs:")).map(([k, v]) => `${k.slice(9)}: ${v.value}`);
  const ab = [...meta].filter(([k]) => k.startsWith("abandoned:") && v0(k)).map(([k, v]) => `${k.slice(10)}: ${v.value} boards left for the next run`);
  function v0(k: string) { return (meta.get(k)?.value ?? 0) > 0; }
  if (bo.length || ab.length) lines.push("Host back-offs (a pause of 2, 4, 8 or 16+ minutes for a host group that refused us):", "", ...bo.map((l) => `- ${l} pause(s)`), ...ab.map((l) => `- ${l}`), "");
  lines.push("## Resume", "", "```", `npx tsx scripts/collect-all.mts --db ${path.relative(process.cwd(), dbDir) || dbDir}`, "```", "",
    "A rerun takes only the boards that are still candidates (never verified, or last attempt failed) and keeps the counters above.", "");
  writeFileSync(docPath, lines.join("\n"));
  log(`summary written to ${path.relative(process.cwd(), docPath)}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------------------------------

const timer = setInterval(() => { void tick().catch((e) => log(`progress error: ${(e as Error).message}`)); }, MIN);
/** Create this file (for example `data/collect-full.stop`) to stop gracefully: in-flight boards finish, then the run exits. */
const stopFile = path.join(path.dirname(dbDir), `${path.basename(dbDir)}.stop`);
try { if (existsSync(stopFile)) unlinkSync(stopFile); } catch { /* ignore */ }
const pumper = setInterval(() => {
  if (!shutdown && existsSync(stopFile)) stop(`stop file ${stopFile}`);
  if (netDownSince) {
    void networkUp().then(async (up) => {
      // The OS resolver can keep failing for a host (negative cache) long after the internet is back. After 3 minutes, resume
      // when a public resolver proves the internet works; each board's own retries are capped, so nothing loops.
      if (!up && Date.now() - netDownSince > 3 * MIN && (await DEFAULT_RESOLVERS[0]!("one.one.one.one")) === "found") {
        log("resuming: public DNS answers but the OS resolver still fails for some hosts; their boards keep a capped number of retries");
        netProbeHosts.length = 0; netOk = true; netChecked = Date.now(); up = true;
      }
      if (up) { log(`network back after ${Math.round((Date.now() - netDownSince) / 1000)} s`); netDownSince = 0; lastOkAt = Date.now(); } });
  }
  pump();
}, 1000);

let shutdown = false;
const stop = (sig: string) => { if (shutdown) return; shutdown = true; stopping = true; log(`${sig}: finishing in-flight boards, then exiting (rerun the same command to resume)`); };
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

pump();
while (!shutdown) {
  const idle = inflightTotal === 0 && (remaining() === 0 || [...groups.values()].every((g) => g.abandoned));
  if (idle) break;
  await sleep(1000);
}
if (shutdown) { const t0 = Date.now(); while (inflightTotal > 0 && Date.now() - t0 < 60_000) await sleep(500); }
clearInterval(timer);
clearInterval(pumper);

const left = remaining();
log(`collection loop ended: ${finalized} boards finalized this session, ${left} left in queue (abandoned groups included in the next run)`);
await tick().catch((e) => log(`final progress error: ${(e as Error).message}`));
await writeSummary(true);
try { await db.execute(sql`checkpoint`); } catch { /* ignore */ }
await handle.close();
log("done");
process.exit(0);
