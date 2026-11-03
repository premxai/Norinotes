import { and, companies, desc, eq, jobs, lanes, queryRows, shortlist, sql, type Db } from "@norinote/db";
import { PRIORITY } from "@norinote/ingest";
import { inlineLanesFitSql, laneFitsSql, loadTemporaryLane, openAndFreshSql } from "@norinote/match";

/**
 * Poll first the companies a user is waiting on ("never empty", step 3 of docs/job-collection.md): on signup or a lane
 * change, the companies whose open jobs fit the user's lanes get a priority bump and are due right away.
 */

/** Above the registry's own priority (100), so these boards are polled before any other while the boost lasts. */
export const BOOST_PRIORITY = PRIORITY.boost;
/** How long a boost lasts. The scheduler counts a company as boosted only until `companies.boost_until`, so it expires by itself. */
export const BOOST_HOURS = 24;
/** How many companies one signup or lane change boosts. */
export const BOOST_COMPANIES = 50;

/**
 * Up to `limit` companies with open, fresh jobs that fit the user's enabled lanes (a temporary lane from the latest role
 * when there are none), the best-fitting and most recently posted first.
 */
export async function companiesFittingLanes(db: Db, userId: string, now: Date, limit = BOOST_COMPANIES): Promise<string[]> {
  const [hasLane] = await db.select({ id: lanes.id }).from(lanes).where(and(eq(lanes.userId, userId), eq(lanes.enabled, true))).limit(1);
  let fits;
  if (hasLane) {
    fits = sql`EXISTS (SELECT 1 FROM ${lanes} WHERE ${lanes.userId} = ${userId} AND ${lanes.enabled} AND ${laneFitsSql()})`;
  } else {
    const temporary = await loadTemporaryLane(db, userId, now);
    if (!temporary) return [];
    fits = inlineLanesFitSql([temporary]);
  }
  const recency = sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt})`;
  const rows = await db
    .select({ companyId: jobs.companyId })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(shortlist, and(eq(shortlist.jobId, jobs.id), eq(shortlist.userId, userId)))
    .where(and(openAndFreshSql(now), fits))
    .groupBy(jobs.companyId)
    .orderBy(sql`max(${shortlist.fit}) desc nulls last`, desc(sql`max(${recency})`), jobs.companyId)
    .limit(limit);
  return rows.map((r) => r.companyId);
}

/**
 * Boosts these companies for `BOOST_HOURS`: `boost_until` is set (the scheduler polls them at `BOOST_PRIORITY` until then,
 * after which the boost lapses on its own and the stored priority is untouched) and they are made due now. It touches
 * only `boost_until` and `next_poll_at`, and only the ones that exist: before migration 0003 there are no such columns
 * and this does nothing; a failed update never breaks the caller. Returns how many companies were updated.
 */
export async function boostCompanies(db: Db, companyIds: readonly string[], opts: { now?: Date } = {}): Promise<number> {
  if (companyIds.length === 0) return 0;
  try {
    const found = await queryRows<{ column_name: string }>(db, sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'companies' AND column_name IN ('boost_until', 'next_poll_at')`);
    const has = new Set(found.map((r) => r.column_name));
    const at = opts.now ?? new Date();
    const until = new Date(at.getTime() + BOOST_HOURS * 3_600_000).toISOString();
    const sets = [
      has.has("boost_until") ? sql`boost_until = greatest(coalesce(boost_until, ${until}::timestamptz), ${until}::timestamptz)` : null,
      has.has("next_poll_at") ? sql`next_poll_at = ${opts.now ? opts.now.toISOString() : sql`now()`}` : null,
    ].filter((s) => s !== null);
    if (sets.length === 0) return 0;
    const ids = sql.join(companyIds.map((id) => sql`${id}::uuid`), sql`, `);
    const updated = await queryRows<{ id: string }>(db, sql`UPDATE companies SET ${sql.join(sets, sql`, `)} WHERE id IN (${ids}) AND blocked = false RETURNING id`);
    return updated.length;
  } catch {
    return 0;
  }
}

/** The companies that fit this user's lanes, boosted. Never throws: a failure here must not fail the match job. */
export async function boostCompaniesForUser(db: Db, userId: string, now: Date): Promise<number> {
  try {
    return await boostCompanies(db, await companiesFittingLanes(db, userId, now), { now });
  } catch {
    return 0;
  }
}
