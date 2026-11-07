import { sql, type SQL } from "drizzle-orm";
import { companies, jobs } from "./schema.js";

/** The oldest job anyone is shown or matched: posted in the last 72 hours. */
export const MAX_JOB_AGE_HOURS = 72;
const HOUR_MS = 3_600_000;

/**
 * Posted within `hours`. A job whose feed gives no posted date counts only when it appeared on a later read than the
 * board's first (`companies.first_read_at`), within `hours` of now: everything on a first read was already there, of
 * unknown age. Needs `companies` joined. The leading `coalesce(posted, first seen) >= since` follows from the rest (a dated
 * job is judged by its posted date, an undated one by first seen) and lets an open-job query use jobs_open_recency_idx
 * instead of reading every job.
 */
export function freshJobSql(now: Date, hours: number = MAX_JOB_AGE_HOURS): SQL {
  const since = new Date(now.getTime() - Math.min(hours, MAX_JOB_AGE_HOURS) * HOUR_MS).toISOString();
  return sql`(coalesce(${jobs.postedAt}, ${jobs.firstSeenAt}) >= ${since}::timestamptz AND (${jobs.postedAt} >= ${since}::timestamptz OR (${jobs.postedAt} IS NULL AND ${jobs.firstSeenAt} >= ${since}::timestamptz AND ${jobs.firstSeenAt} > ${companies.firstReadAt})))`;
}

/**
 * `freshJobSql` for one job in memory, for code that decides before a row is written (the collector stores jobs that are
 * not fresh without their description). `firstReadAt` null means this read is the board's first.
 */
export function isFreshJob(job: { postedAt: Date | null; firstSeenAt: Date; firstReadAt: Date | null }, now: Date, hours: number = MAX_JOB_AGE_HOURS): boolean {
  const since = now.getTime() - Math.min(hours, MAX_JOB_AGE_HOURS) * HOUR_MS;
  if (job.postedAt) return job.postedAt.getTime() >= since;
  return job.firstSeenAt.getTime() >= since && job.firstReadAt !== null && job.firstSeenAt.getTime() > job.firstReadAt.getTime();
}
