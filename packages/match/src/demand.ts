import { and, companies, desc, eq, inArray, jobSpecs, jobs, lanes, sql, type Db } from "@norinote/db";
import { laneFitsSql } from "./lanes.js";
import { openAndFreshSql } from "./shortlist.js";
import { SPEC_VERSION } from "./understand.js";

/**
 * Understand on demand. A job is only read by the model when somebody could be shown it: it is open, posted within 60
 * days and fits an enabled lane of a user. These two queries find those jobs; the worker enqueues `understand.job` for
 * them instead of for every job the feeds return.
 */

const ID_CHUNK = 1000;

/**
 * Of `jobIds`, the ones that are open, fresh, from an unblocked company and fit an enabled lane (of any user, or of
 * `userId` when given). Same definition of "fits" as the shortlist filter.
 */
export async function jobsFittingLanes(db: Db, jobIds: readonly string[], opts: { now: Date; userId?: string }): Promise<string[]> {
  const out = new Set<string>();
  for (let i = 0; i < jobIds.length; i += ID_CHUNK) {
    const rows = await db
      .selectDistinct({ id: jobs.id })
      .from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .innerJoin(lanes, eq(lanes.enabled, true))
      .where(and(
        inArray(jobs.id, jobIds.slice(i, i + ID_CHUNK)),
        openAndFreshSql(opts.now),
        laneFitsSql(),
        opts.userId ? eq(lanes.userId, opts.userId) : undefined,
      ));
    for (const r of rows) out.add(r.id);
  }
  return jobIds.filter((id) => out.has(id));
}

/** The most jobs one call returns. The newest come first, so a long backlog is read newest to oldest. */
export const UNSPECCED_BACKLOG_LIMIT = 5000;

/**
 * Open, fresh jobs that fit one of the user's enabled lanes and have no current spec yet (a heuristic spec does not
 * count: it is replaced once the model reads the job), newest first.
 */
export async function unspeccedJobsForUser(db: Db, userId: string, opts: { now: Date; limit?: number }): Promise<string[]> {
  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(
      openAndFreshSql(opts.now),
      sql`EXISTS (SELECT 1 FROM ${lanes} WHERE ${lanes.userId} = ${userId} AND ${lanes.enabled} AND ${laneFitsSql()})`,
      sql`NOT EXISTS (SELECT 1 FROM ${jobSpecs} WHERE ${jobSpecs.jobId} = ${jobs.id} AND ${jobSpecs.version} >= ${SPEC_VERSION})`,
    ))
    .orderBy(desc(sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt})`))
    .limit(opts.limit ?? UNSPECCED_BACKLOG_LIMIT);
  return rows.map((r) => r.id);
}
