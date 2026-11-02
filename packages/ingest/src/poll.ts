import type { AtsType } from "@norinote/shared";
import { and, companies, eq, isNull, jobs } from "@norinote/db";
import { notInArray } from "drizzle-orm";
import type { Db } from "@norinote/db";
import { isBlockedBoard, isBlockedCompany } from "./blocklist.js";
import { getConnector } from "./connectors/index.js";
import { feedHost, RateLimitedError } from "./http.js";
import type { HostBackoff } from "./http.js";
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
  /** Jobs that were open for this board and are no longer in its feed. */
  closed: number;
  /** Jobs in the feed this time (after dropping blocked sources). */
  total: number;
  /** Ids of the added jobs. The worker enqueues `understand.job` for each; ingest never touches the queue. */
  newJobIds: string[];
  /** Set (and nothing else done) when the board belongs to a blocked reposting aggregator. */
  skipped: "blocked" | null;
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
};

const emptyResult = (skipped: PollResult["skipped"]): PollResult => ({ added: 0, updated: 0, closed: 0, total: 0, newJobIds: [], skipped });

/**
 * Read one board's public feed and bring the `jobs` table in line with it: new jobs are inserted (`first_seen_at`),
 * known jobs refreshed (`last_seen_at`, description, `posted_at` kept when the feed has no date, reopened if they had
 * closed), jobs of this board that are no longer listed get `closed_at`, and `companies.last_polled_at` is set.
 * Postings that name a blocked aggregator are dropped; a blocked board is skipped without any request.
 *
 * Throws on a feed failure (the board's `last_polled_at` is then left alone so it stays due). Throws
 * `RateLimitedError` when the host refused every retry, and `HostBackedOffError` when `opts.backoff` has already
 * backed the host off. A 404 board is an empty feed: its open jobs close.
 */
export async function pollBoard(db: Db, board: { atsType: AtsType; token: string }, opts: PollOptions = {}): Promise<PollResult> {
  const now = opts.now ?? new Date();
  const { atsType, token } = board;

  const [row] = await db.select({ id: companies.id, blocked: companies.blocked, name: companies.name }).from(companies)
    .where(and(eq(companies.atsType, atsType), eq(companies.atsToken, token))).limit(1);
  if (isBlockedBoard(atsType, token) || row?.blocked) return emptyResult("blocked");

  const host = feedHost(atsType);
  if (opts.backoff?.isBackedOff(host)) throw new HostBackedOffError(host);

  let fetched;
  try {
    fetched = await getConnector(atsType).listJobs(token, { ...opts.http, fetch: opts.fetch });
  } catch (err) {
    if (err instanceof RateLimitedError) opts.backoff?.rateLimited(host);
    throw err;
  }
  opts.backoff?.ok(host);

  const kept = fetched.filter((j) => !isBlockedCompany({ name: j.companyName }));
  const name = row?.name ?? kept[0]?.companyName ?? prettifyToken(token);
  const companyId = row?.id ?? await ensureCompany(db, atsType, token, name);

  return db.transaction(async (tx) => {
    const { ids, newIds, updated } = await upsertJobs(tx as unknown as Db, companyId, atsType, kept, now);

    const stillOpen = and(eq(jobs.companyId, companyId), isNull(jobs.closedAt));
    const gone = ids.length ? and(stillOpen, notInArray(jobs.id, ids)) : stillOpen;
    const closedRows = await tx.update(jobs).set({ closedAt: now }).where(gone).returning({ id: jobs.id });

    await tx.update(companies).set({ lastPolledAt: now }).where(eq(companies.id, companyId));
    return { added: newIds.length, updated, closed: closedRows.length, total: ids.length, newJobIds: newIds, skipped: null };
  });
}
