import type { AtsType } from "@norinote/shared";
import { and, companies, eq, isNull, jobs, sql } from "@norinote/db";
import { notInArray } from "drizzle-orm";
import type { CompanyStatus, Db } from "@norinote/db";
import { isBlockedBoard, isBlockedCompany } from "./blocklist.js";
import { getConnector } from "./connectors/index.js";
import { BlockedByHostError } from "./connectors/workday.js";
import { feedHost, RateLimitedError } from "./http.js";
import type { HostBackoff } from "./http.js";
import { toListResult } from "./list-result.js";
import {
  EMPTY_DISABLE_MS, ERROR_STREAK_LIMIT, errorRetryMs, MISSING_READS_TO_CLOSE, pollIntervalMs, PRIORITY, PROBATION_MS,
  PROBATION_RECHECK_MS, RECHECK_MS,
} from "./schedule.js";
import { ensureCompany, upsertJobs } from "./store.js";
import type { HttpOptions } from "./types.js";
import { prettifyToken } from "./util.js";

/** The host's feed is being rate limited and was backed off for this cycle; the board stays due and is tried next time. */
export class HostBackedOffError extends Error {
  constructor(readonly host: string) {
    super(`${host} is refusing requests; skipping its boards for now`);
    this.name = "HostBackedOffError";
  }
}

export type PollResult = {
  /** Jobs that did not exist before. */
  added: number;
  /** Jobs that already existed and were refreshed (including ones that reopened). */
  updated: number;
  /** Jobs that were open for this board and were closed by this read (missing from two complete reads, or the board stayed gone). */
  closed: number;
  /** Jobs in the feed this time (after dropping blocked sources). */
  total: number;
  /** Ids of the added jobs. The worker enqueues `understand.job` for each; ingest never touches the queue. */
  newJobIds: string[];
  /** Jobs in the feed that are not fresh, so their description was not stored (see `upsertJobs`). */
  trimmed: number;
  /** Set (and nothing else done) when the board belongs to a blocked reposting aggregator. */
  skipped: "blocked" | null;
  /** The feed answered 304: nothing changed, no job was touched. */
  notModified: boolean;
  /** The board does not exist (it is on probation, or its jobs were closed after the probation ended). */
  notFound: boolean;
  /** False when the read may have missed jobs; nothing was closed on it. */
  complete: boolean;
  /** The company's status after this poll (null when skipped). */
  status: CompanyStatus | null;
  /** The company's status before this poll (null when skipped or when the company was created by it). */
  previousStatus: CompanyStatus | null;
  /** When the scheduler should poll this board next (null when skipped). */
  nextPollAt: Date | null;
};

export type PollOptions = {
  /** The time recorded as `first_seen_at`, `last_seen_at`, `closed_at` and `last_polled_at`. Default: the current time. */
  now?: Date;
  /** Replaces the global fetch (tests). */
  fetch?: typeof fetch;
  /** Other request knobs (tests): sleep, random, timeout. */
  http?: Omit<HttpOptions, "fetch">;
  /** Shared per-cycle host back-off. When a host has been refused repeatedly its boards are skipped with HostBackedOffError. */
  backoff?: HostBackoff;
  /** Enabled lanes (of any user) that match this company's recent jobs; shortens the time to its next poll. Default 0. */
  demand?: number;
};

type CompanyRow = typeof companies.$inferSelect;

const emptyResult = (skipped: PollResult["skipped"]): PollResult => ({
  added: 0, updated: 0, closed: 0, total: 0, newJobIds: [], trimmed: 0, skipped,
  notModified: false, notFound: false, complete: true, status: null, previousStatus: null, nextPollAt: null,
});

const FEEDS_WITHOUT_COMPANY_NAME: ReadonlySet<AtsType> = new Set<AtsType>(["workday", "oracle"]);

const after = (now: Date, ms: number) => new Date(now.getTime() + ms);

/**
 * Record a failed poll: the error streak grows (once per backoff window, so the queue's quick retries of one failure
 * count once), the board waits longer each time, and the fifth failure in a row disables it (rechecked weekly).
 */
async function recordFailure(db: Db, row: CompanyRow, now: Date): Promise<void> {
  const insideWindow = row.errorStreak > 0 && row.nextPollAt !== null && row.nextPollAt.getTime() > now.getTime();
  const streak = insideWindow ? row.errorStreak : row.errorStreak + 1;
  const disabled = streak >= ERROR_STREAK_LIMIT;
  await db.update(companies).set({
    errorStreak: streak,
    status: disabled ? "disabled" : row.status,
    ...(disabled ? { statusReason: `${ERROR_STREAK_LIMIT} failed polls in a row` } : {}),
    nextPollAt: insideWindow ? row.nextPollAt : after(now, disabled ? RECHECK_MS : errorRetryMs(streak)),
  }).where(eq(companies.id, row.id));
}

/** The host answers 401/403 to servers: disable the board at once (no retries) and look again in a week. */
async function recordBlockedByHost(db: Db, row: CompanyRow, now: Date, err: BlockedByHostError): Promise<void> {
  await db.update(companies).set({
    status: "disabled", statusReason: `blocked by host (${err.status})`, lastPolledAt: now, nextPollAt: after(now, RECHECK_MS), etag: null,
  }).where(eq(companies.id, row.id));
}

/**
 * Read one board's public feed and bring the `jobs` table and the company's registry row in line with it.
 *
 * - New jobs are inserted (`first_seen_at`), known jobs refreshed (`last_seen_at`, description, `posted_at` kept when
 *   the feed has no date) and reopened if they had closed. Jobs that are not fresh are stored without their description. Postings that name a blocked aggregator are dropped; a
 *   blocked board is skipped without any request.
 * - A job closes only after two complete reads in a row that do not list it (`jobs.missing_reads`). An incomplete read
 *   never closes or counts anything; a job seen again resets its counter.
 * - `notModified` (ETag 304) touches no job, only the poll times. `notFound` puts the board on probation
 *   (`not_found_since`); its jobs close only once it has been gone for 3 days, and the board is then `dead`.
 * - Status: a candidate's first poll validates it (jobs or an empty feed: `active`, empty at low priority; not found:
 *   `dead`). Five failed polls in a row, or 14 days at zero jobs, disable a board; disabled and dead boards are
 *   rechecked weekly and come back as `active` when they answer with jobs.
 * - `next_poll_at = now + clamp(24h / (1 + new_jobs_7d / 7), 1h, 48h)`, shortened by `opts.demand`, never shorter than
 *   the job system allows.
 *
 * Throws on a feed failure (the failure is recorded on the company). Throws `RateLimitedError` when the host refused every
 * retry (not held against the board) and `HostBackedOffError` when `opts.backoff` has already backed the host off.
 */
export async function pollBoard(db: Db, board: { atsType: AtsType; token: string }, opts: PollOptions = {}): Promise<PollResult> {
  const now = opts.now ?? new Date();
  const { atsType, token } = board;

  let [row] = await db.select().from(companies)
    .where(and(eq(companies.atsType, atsType), eq(companies.atsToken, token))).limit(1);
  if (isBlockedBoard(atsType, token) || row?.blocked) return emptyResult("blocked");

  const host = feedHost(atsType, token);
  if (opts.backoff?.isBackedOff(host)) throw new HostBackedOffError(host);

  // A stored validator is only trusted while the board is healthy; a board coming back from a bad spell is read in full.
  const etag = row && (row.status === "active" || row.status === "candidate") ? row.etag : null;
  let listed;
  try {
    listed = toListResult(await getConnector(atsType).listJobs(token, { ...opts.http, fetch: opts.fetch }, { etag }));
  } catch (err) {
    if (err instanceof RateLimitedError) opts.backoff?.rateLimited(host);
    else if (err instanceof BlockedByHostError) {
      if (row) await recordBlockedByHost(db, row, now, err);
      // The host answered (with a refusal): this is the board's problem, not a reason to back the whole host off.
      opts.backoff?.ok(host);
    } else if (row) await recordFailure(db, row, now);
    throw err;
  }
  opts.backoff?.ok(host);

  const feedJobs = listed.jobs.filter((j) => !isBlockedCompany({ name: j.companyName }));
  const name = row?.name ?? feedJobs[0]?.companyName ?? prettifyToken(token);
  // Workday and Oracle feeds do not name the company (the connector only prettifies the tenant), so the registry name wins.
  const kept = row && FEEDS_WITHOUT_COMPANY_NAME.has(atsType) ? feedJobs.map((j) => ({ ...j, companyName: row!.name })) : feedJobs;
  const previousStatus = row?.status ?? null;
  if (!row) {
    const id = await ensureCompany(db, atsType, token, name);
    [row] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
    if (!row) throw new Error(`could not create a company row for ${atsType}:${token}`);
  }
  const company = row;
  const demand = opts.demand ?? 0;

  // 304: nothing changed. Only the poll times move.
  if (listed.notModified) {
    const nextPollAt = after(now, pollIntervalMs({ atsType, newJobs7d: company.newJobs7d, demand }));
    await db.update(companies).set({ lastPolledAt: now, lastSuccessAt: now, firstReadAt: company.firstReadAt ?? now, nextPollAt, errorStreak: 0 }).where(eq(companies.id, company.id));
    return {
      ...emptyResult(null), total: company.lastJobCount, notModified: true, status: company.status, previousStatus: company.status, nextPollAt,
    };
  }

  // The board does not exist.
  if (listed.notFound) {
    return db.transaction(async (tx) => {
      const since = company.notFoundSince ?? now;
      const gone = now.getTime() - since.getTime() >= PROBATION_MS;
      let status: CompanyStatus;
      let nextPollAt: Date;
      let closed = 0;
      if (company.status === "candidate") {
        status = "dead";
        nextPollAt = after(now, RECHECK_MS);
      } else if (gone) {
        const rows = await tx.update(jobs).set({ closedAt: now }).where(and(eq(jobs.companyId, company.id), isNull(jobs.closedAt))).returning({ id: jobs.id });
        closed = rows.length;
        status = "dead";
        nextPollAt = after(now, RECHECK_MS);
      } else {
        status = "probation";
        nextPollAt = after(now, PROBATION_RECHECK_MS);
      }
      await tx.update(companies).set({
        status, nextPollAt, notFoundSince: since, lastPolledAt: now, etag: null, errorStreak: 0,
        statusReason: status === "dead" ? "board not found" : status === "probation" ? "board not found, on probation" : null,
        ...(closed ? { lastJobCount: 0 } : {}),
      }).where(eq(companies.id, company.id));
      return { ...emptyResult(null), closed, notFound: true, status, previousStatus, nextPollAt };
    });
  }

  return db.transaction(async (tx) => {
    const { ids, newIds, updated, trimmed } = await upsertJobs(tx as unknown as Db, company.id, atsType, kept, now);

    // Two complete reads in a row must miss a job before it closes; an incomplete read counts nothing.
    let closed = 0;
    if (listed.complete) {
      const unseen = and(eq(jobs.companyId, company.id), isNull(jobs.closedAt), ids.length ? notInArray(jobs.id, ids) : undefined);
      const rows = await tx.update(jobs).set({
        missingReads: sql`${jobs.missingReads} + 1`,
        closedAt: sql`case when ${jobs.missingReads} + 1 >= ${MISSING_READS_TO_CLOSE} then ${now.toISOString()}::timestamptz else null end`,
      }).where(unseen).returning({ closedAt: jobs.closedAt });
      closed = rows.filter((r) => r.closedAt !== null).length;
    }

    const cutoff = after(now, -7 * 24 * 3_600_000).toISOString();
    const [recent] = await tx.select({ n: sql<number>`count(*)::int` }).from(jobs)
      .where(and(eq(jobs.companyId, company.id), sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt}) >= ${cutoff}::timestamptz`));
    const newJobs7d = Number(recent?.n ?? 0);

    // Status, priority and the time the board has been empty.
    const count = ids.length;
    let status = company.status;
    let priority = company.priority;
    let emptySince = company.emptySince;
    if (count > 0) {
      emptySince = null;
      status = "active";
      if (priority === PRIORITY.empty) priority = PRIORITY.seed;
    } else if (listed.complete) {
      emptySince = company.emptySince ?? now;
      if (priority === PRIORITY.seed) priority = PRIORITY.empty;
      status = now.getTime() - emptySince.getTime() >= EMPTY_DISABLE_MS ? "disabled" : "active";
    }
    // (an incomplete read with no jobs proves nothing: status stays as it was)
    const nextPollAt = after(now, status === "disabled" ? RECHECK_MS : pollIntervalMs({ atsType, newJobs7d, demand }));

    await tx.update(companies).set({
      status, priority, emptySince, nextPollAt, newJobs7d,
      statusReason: status === "disabled" ? "no jobs for 14 days" : null,
      lastPolledAt: now, lastSuccessAt: now, firstReadAt: company.firstReadAt ?? now, errorStreak: 0,
      // An expired boost is dropped on the next successful poll.
      boostUntil: company.boostUntil && company.boostUntil.getTime() > now.getTime() ? company.boostUntil : null,
      notFoundSince: count > 0 || listed.complete ? null : company.notFoundSince,
      lastJobCount: count,
      // A validator from an incomplete read would hide the jobs that were missed.
      etag: listed.complete ? (listed.etag ?? null) : null,
    }).where(eq(companies.id, company.id));

    return {
      added: newIds.length, updated, closed, total: count, newJobIds: newIds, trimmed, skipped: null,
      notModified: false, notFound: false, complete: listed.complete, status, previousStatus, nextPollAt,
    };
  });
}
