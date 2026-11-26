/**
 * Verification and scoring of discovered boards (`board_candidates`). Each due candidate is read once through its
 * connector, the same public feed read the poller makes (robots.txt and Crawl-delay obeyed in http.ts), one board at a
 * time per feed host with a gap between boards. It is scored on its open US jobs posted in the last 7 days whose title
 * is in a target role family. Boards at or above the bar are promoted into `companies` (`active`, priority
 * `PRIORITY.discovered`, polled at NORI-12's cadence from then on); the rest are marked and looked at again later.
 */
import { isUsPlace, type AtsType } from "@norinote/shared";
import { and, boardCandidates, companies, eq, MAX_JOB_AGE_HOURS, sql, type Db } from "@norinote/db";
import type { BoardCandidateStatus } from "@norinote/db";
import { isBlockedBoard } from "../blocklist.js";
import { getConnector } from "../connectors/index.js";
import { BlockedByHostError } from "../connectors/workday.js";
import { feedHost, RateLimitedError } from "../http.js";
import { hostKey } from "../hosts.js";
import { toListResult } from "../list-result.js";
import { RobotsDisallowedError } from "../robots.js";
import { PRIORITY } from "../schedule.js";
import type { HttpOptions, NormalizedJob } from "../types.js";
import { prettifyToken } from "../util.js";

const DAY = 24 * 3_600_000;

/** A job title's target role family ("ai_ml", "data", "product", ...), or null when it is not one Nori is after. */
export type TargetClassifier = (title: string) => string | null;

/** Fresh US jobs in target role families in the last 7 days that a board needs to be promoted. */
export const PROMOTE_BAR = 2;

/** When each outcome is verified again. A board that keeps failing waits a day between tries until FAILS_TO_PARK. */
export const REVERIFY_MS: Record<Exclude<BoardCandidateStatus, "new">, number> = {
  promoted: 30 * DAY, low_value: 30 * DAY, empty: 30 * DAY, dead: 90 * DAY, disallowed: 30 * DAY, failing: 30 * DAY,
};
export const FAILS_TO_PARK = 3;

export type BoardScore = {
  openJobs: number;
  /** Open US jobs posted in the last 7 days. */
  freshUsJobs: number;
  /** Fresh US jobs per target role family. */
  targetJobs: Record<string, number>;
  /** Sum of targetJobs. */
  score: number;
};

/**
 * Score one read of a board. A job counts as fresh only when the feed dates it within MAX_JOB_AGE_HOURS: an undated
 * job on a first read is of unknown age, so it never counts (the same rule as `isFreshJob`).
 */
export function scoreJobs(jobs: readonly NormalizedJob[], now: Date, classify: TargetClassifier): BoardScore {
  const cutoff = now.getTime() - MAX_JOB_AGE_HOURS * 3_600_000;
  const targetJobs: Record<string, number> = {};
  let freshUsJobs = 0;
  for (const j of jobs) {
    const at = j.postedAt?.getTime();
    if (at === undefined || at < cutoff || at > now.getTime() + DAY) continue;
    if (!isUsPlace(j.location, j.remote)) continue;
    freshUsJobs++;
    const family = classify(j.title);
    if (family) targetJobs[family] = (targetJobs[family] ?? 0) + 1;
  }
  return { openJobs: jobs.length, freshUsJobs, targetJobs, score: Object.values(targetJobs).reduce((a, b) => a + b, 0) };
}

export type VerifyOutcome = BoardCandidateStatus | "rate_limited" | "retry" | "timeout";

/** A board whose feed does not answer within `boardTimeoutMs` is given up on for this run and counted as a failure. */
export const BOARD_TIMEOUT_MS = 120_000;

/** The board's feed took too long: the read is abandoned (its requests still time out on their own). */
export class BoardTimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`no answer from the board's feed in ${Math.round(ms / 1000)} s`);
    this.name = "BoardTimeoutError";
  }
}

/** `p`, or a rejection with `BoardTimeoutError` after `ms`. The timer is cleared either way, so nothing keeps the process alive. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (!(ms > 0)) return p;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BoardTimeoutError(ms)), ms);
    timer.unref?.();
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export type VerifiedBoard = { id: string; atsType: AtsType; token: string; name: string; outcome: VerifyOutcome; score: BoardScore | null; reason: string | null };

export type VerifyOptions = {
  classify: TargetClassifier;
  /** The clock (tests). Default: the current time. */
  now?: () => Date;
  /** Most candidates verified this call. Default 50. */
  limit?: number;
  /** Only these job systems (the engine scope, or a local run). Default all of DISCOVERY_ATS. */
  atsTypes?: readonly AtsType[] | null;
  /** Wait after each board, per feed host. Default 1 s. */
  gapMs?: number;
  /** Promotion bar. Default PROMOTE_BAR. */
  minScore?: number;
  /** Replaces the global fetch (tests). */
  fetch?: typeof fetch;
  /** Other request knobs (tests). */
  http?: Omit<HttpOptions, "fetch">;
  /** Longest one board's read may take before it is abandoned as a failure. Default BOARD_TIMEOUT_MS; 0 = no limit. */
  boardTimeoutMs?: number;
  /** Replaces the gap's sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Called after each board (progress for a long local run). */
  onBoard?: (b: VerifiedBoard) => void;
};

type Row = typeof boardCandidates.$inferSelect;

/** Candidates due now: new ones first, then the longest overdue. */
async function dueCandidates(db: Db, now: Date, limit: number, atsTypes: readonly AtsType[] | null | undefined): Promise<Row[]> {
  const systems = atsTypes?.length ? sql`and ${boardCandidates.atsType} in (${sql.join(atsTypes.map((t) => sql`${t}`), sql`, `)})` : sql``;
  return db.select().from(boardCandidates)
    .where(sql`(${boardCandidates.nextVerifyAt} is null or ${boardCandidates.nextVerifyAt} <= ${now.toISOString()}::timestamptz) ${systems}`)
    .orderBy(sql`${boardCandidates.nextVerifyAt} asc nulls first`, boardCandidates.createdAt, boardCandidates.id)
    .limit(limit);
}

/**
 * Put a verified board into `companies` (or bring back the row that is already there, unless it is blocked) and
 * return its id, or null when the registry has it blocked.
 */
async function promote(db: Db, row: Row, name: string, now: Date): Promise<string | null> {
  await db.insert(companies).values({
    name, atsType: row.atsType, atsToken: row.atsToken, host: hostKey(row.atsType, row.atsToken),
    discoveredVia: row.sources[0] ?? "discovery", status: "active", priority: PRIORITY.discovered,
  }).onConflictDoNothing();
  const [company] = await db.select().from(companies)
    .where(and(eq(companies.atsType, row.atsType), eq(companies.atsToken, row.atsToken))).limit(1);
  if (!company || company.blocked) return null;
  if (company.status !== "active" && company.status !== "probation") {
    await db.update(companies).set({
      status: "active", statusReason: null, errorStreak: 0, nextPollAt: now, priority: Math.max(company.priority, PRIORITY.discovered),
    }).where(eq(companies.id, company.id));
  }
  return company.id;
}

async function verifyOne(db: Db, row: Row, opts: VerifyOptions, minScore: number): Promise<VerifiedBoard> {
  const now = (opts.now ?? (() => new Date()))();
  const later = (ms: number) => new Date(now.getTime() + ms);
  const done = async (status: BoardCandidateStatus, reason: string | null, extra: Partial<Row> = {}): Promise<VerifiedBoard> => {
    await db.update(boardCandidates).set({ status, statusReason: reason, verifiedAt: now, errorStreak: 0, nextVerifyAt: later(REVERIFY_MS[status as Exclude<BoardCandidateStatus, "new">] ?? DAY), ...extra })
      .where(eq(boardCandidates.id, row.id));
    return { id: row.id, atsType: row.atsType, token: row.atsToken, name: extra.name ?? row.name, outcome: status, score: null, reason };
  };

  if (isBlockedBoard(row.atsType, row.atsToken)) return done("disallowed", "blocked source");

  let jobs: NormalizedJob[];
  try {
    const read = toListResult(await withTimeout(
      getConnector(row.atsType).listJobs(row.atsToken, { ...opts.http, fetch: opts.fetch }),
      opts.boardTimeoutMs ?? BOARD_TIMEOUT_MS,
    ));
    if (read.notFound) return done("dead", "board not found");
    jobs = read.jobs;
  } catch (err) {
    if (err instanceof RobotsDisallowedError) return done("disallowed", err.reason);
    if (err instanceof BlockedByHostError) return done("disallowed", `blocked by host (${err.status})`);
    const reason = err instanceof Error ? err.message.slice(0, 200) : String(err);
    if (err instanceof RateLimitedError) {
      await db.update(boardCandidates).set({ nextVerifyAt: later(3_600_000) }).where(eq(boardCandidates.id, row.id));
      return { id: row.id, atsType: row.atsType, token: row.atsToken, name: row.name, outcome: "rate_limited", score: null, reason };
    }
    const timedOut = err instanceof BoardTimeoutError;
    const streak = row.errorStreak + 1;
    const parked = streak >= FAILS_TO_PARK;
    await db.update(boardCandidates).set({
      status: parked ? "failing" : row.status, statusReason: reason, errorStreak: streak, nextVerifyAt: later(parked ? REVERIFY_MS.failing : DAY),
    }).where(eq(boardCandidates.id, row.id));
    return { id: row.id, atsType: row.atsType, token: row.atsToken, name: row.name, outcome: timedOut ? "timeout" : parked ? "failing" : "retry", score: null, reason };
  }

  const score = scoreJobs(jobs, now, opts.classify);
  const feedName = jobs.find((j) => j.companyName && j.companyName !== prettifyToken(row.atsToken))?.companyName;
  const name = row.name === prettifyToken(row.atsToken) && feedName ? feedName : row.name;
  const numbers = { name, openJobs: score.openJobs, freshUsJobs: score.freshUsJobs, targetJobs: score.targetJobs, score: score.score };
  const result = (outcome: BoardCandidateStatus, reason: string | null): VerifiedBoard => ({ id: row.id, atsType: row.atsType, token: row.atsToken, name, outcome, score, reason });

  // A board already in the registry (promoted earlier, or added by a person) only gets fresh numbers: the poller owns it.
  if (row.status === "promoted") { await done("promoted", null, numbers); return result("promoted", null); }
  if (score.score >= minScore) {
    const companyId = await promote(db, row, name, now);
    if (!companyId) { await done("disallowed", "blocked in the registry", numbers); return result("disallowed", "blocked in the registry"); }
    await done("promoted", null, { ...numbers, companyId });
    return result("promoted", null);
  }
  if (score.openJobs === 0) { await done("empty", "no open jobs", numbers); return result("empty", "no open jobs"); }
  const reason = `${score.score} fresh US jobs in target roles in 7 days (bar ${minScore})`;
  await done("low_value", reason, numbers);
  return result("low_value", reason);
}

/**
 * Verify the candidates that are due: up to `limit`, one board at a time per feed host with `gapMs` between them
 * (different hosts run side by side). A host that answers 429/503 through every retry is left alone for the rest of the
 * call. Returns what happened to each board.
 */
export async function verifyCandidates(db: Db, opts: VerifyOptions): Promise<VerifiedBoard[]> {
  const now = (opts.now ?? (() => new Date()))();
  const due = await dueCandidates(db, now, opts.limit ?? 50, opts.atsTypes);
  const byHost = new Map<string, Row[]>();
  for (const row of due) {
    const host = feedHost(row.atsType, row.atsToken);
    byHost.set(host, [...(byHost.get(host) ?? []), row]);
  }
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const minScore = opts.minScore ?? PROMOTE_BAR;
  const results: VerifiedBoard[] = [];
  await Promise.all([...byHost.values()].map(async (rows) => {
    for (const [i, row] of rows.entries()) {
      if (i > 0) await sleep(opts.gapMs ?? 1000);
      const r = await verifyOne(db, row, opts, minScore);
      results.push(r);
      opts.onBoard?.(r);
      if (r.outcome === "rate_limited") break;
    }
  }));
  return results;
}
