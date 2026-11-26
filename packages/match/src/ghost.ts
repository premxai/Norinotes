/**
 * Ghost jobs: a posting the company keeps taking down and putting back up under a new id, often a pipeline ad rather
 * than an opening. Computed from stored jobs, with no request and no model call: other postings on the same company board
 * with the same normalised title (lower case, punctuation and spacing folded), a different external id, first seen in the
 * 60 days before this one, and closed since. Three or more such reposts flag the job.
 *
 * Why three: one repost is routine (a posting edited by closing and re-creating it, or a second hiring round) and two
 * still fit a search that fell through; a third within two months is the pattern of an evergreen or pipeline posting.
 */
import { queryRows, sql, type Db } from "@norinote/db";

/** Reposts within `GHOST_WINDOW_DAYS` that flag a job as a ghost. */
export const GHOST_REPOSTS = 3;
export const GHOST_WINDOW_DAYS = 60;
/** What a ghost flag takes off a shortlist row's fit: enough to drop below a peer, not enough to hide it. */
export const GHOST_FIT_PENALTY = 0.03;

const GHOST_REASON_RE = /^Reposted \d+ times in \d+ days$/;

export const ghostReason = (reposts: number): string => `Reposted ${reposts} times in ${GHOST_WINDOW_DAYS} days`;
export const isGhost = (reposts: number): boolean => reposts >= GHOST_REPOSTS;

/** The fit a ghost flag took off a shortlist row (0 when none), so the raw fit can be recovered. */
export function ghostPenaltyOf(reasons: readonly string[] | null | undefined): number {
  return (reasons ?? []).some((r) => GHOST_REASON_RE.test(r)) ? GHOST_FIT_PENALTY : 0;
}

/** Earlier closed postings of each job (see the file comment). Jobs with none are left out of the map. */
export async function ghostRepostCounts(db: Db, jobIds: readonly string[]): Promise<Map<string, number>> {
  if (jobIds.length === 0) return new Map();
  const norm = (col: string) => sql.raw(`trim(regexp_replace(lower(${col}), '[^a-z0-9]+', ' ', 'g'))`);
  const rows = await queryRows<{ job_id: string; reposts: number }>(db, sql`
    SELECT j.id AS job_id, count(o.id)::int AS reposts
    FROM jobs j
    JOIN jobs o ON o.company_id = j.company_id
      AND o.external_id <> j.external_id
      AND ${norm("o.title")} = ${norm("j.title")}
      AND o.closed_at IS NOT NULL
      AND o.first_seen_at < j.first_seen_at
      AND o.first_seen_at >= j.first_seen_at - make_interval(days => ${GHOST_WINDOW_DAYS})
    WHERE j.id IN (${sql.join(jobIds.map((id) => sql`${id}::uuid`), sql`, `)})
    GROUP BY j.id`);
  return new Map(rows.map((r) => [r.job_id, Number(r.reposts)]));
}

/** How many times this job was reposted in the 60 days before it appeared; a ghost at `GHOST_REPOSTS` or more. */
export async function ghostRepostsOf(db: Db, jobId: string): Promise<number> {
  return (await ghostRepostCounts(db, [jobId])).get(jobId) ?? 0;
}

type Penalisable = { jobId: string; fit: number; reasons: string[]; confidence?: number; rankScore?: number };

/**
 * Shortlist rows of ghost jobs lose `GHOST_FIT_PENALTY` of fit and rank, with the reason second (after a model's
 * explanation line, before the list is cut to three).
 */
export async function applyGhostPenalty(db: Db, items: Penalisable[]): Promise<void> {
  const counts = await ghostRepostCounts(db, items.map((i) => i.jobId));
  for (const item of items) {
    const reposts = counts.get(item.jobId) ?? 0;
    if (!isGhost(reposts)) continue;
    item.fit = Math.max(0, Math.round((item.fit - GHOST_FIT_PENALTY) * 1000) / 1000);
    if (item.rankScore != null) item.rankScore = Math.round((item.rankScore - GHOST_FIT_PENALTY * (item.confidence ?? 1)) * 10000) / 10000;
    item.reasons.splice(Math.min(1, item.reasons.length), 0, ghostReason(reposts));
  }
}
