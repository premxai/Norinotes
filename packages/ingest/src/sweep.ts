import {
  and, applications, companies, eq, freshJobSql, inArray, jobEmbeddings, jobSpecs, jobs, notInArray, savedJobs, shortlist, sql,
} from "@norinote/db";
import type { Db } from "@norinote/db";
import type { SQL } from "drizzle-orm";

/** Jobs handled per batch (one short transaction each). */
export const SWEEP_BATCH_SIZE = 500;
/** Batches per run at most, so one run never holds the database for long; the next run carries on. */
export const SWEEP_MAX_BATCHES = 200;
/** A job is swept only once it has been out of the 72-hour window this long, so a page a user just opened still reads. */
export const SWEEP_GRACE_HOURS = 6;

const HOUR_MS = 3_600_000;

export type SweepOptions = {
  now?: Date;
  batchSize?: number;
  maxBatches?: number;
  graceHours?: number;
  /** Stops the run between batches (worker shutdown). */
  signal?: AbortSignal;
};

export type SweepResult = {
  /** Jobs trimmed in this run. */
  jobs: number;
  /** Of those, descriptions blanked. */
  descriptions: number;
  /** `job_specs` rows deleted. */
  specs: number;
  /** `job_embeddings` rows deleted. */
  embeddings: number;
  batches: number;
  /** True when the run stopped at `maxBatches` with work left. */
  more: boolean;
};

/**
 * Not referenced by any user: not saved from a link (`saved_jobs`), not applied to (`applications`; resumes, answers,
 * run events and outcomes hang off the application) and on nobody's shortlist (`shortlist`, any status; the Telegram
 * digest and the jobs list are built from it).
 */
function unreferencedSql(): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM ${savedJobs} WHERE ${savedJobs.jobId} = ${jobs.id})
    AND NOT EXISTS (SELECT 1 FROM ${applications} WHERE ${applications.jobId} = ${jobs.id})
    AND NOT EXISTS (SELECT 1 FROM ${shortlist} WHERE ${shortlist.jobId} = ${jobs.id})`;
}

/**
 * Lean job storage. A job nobody can be shown any more (outside the 72-hour window, see `freshJobSql`) and that no user
 * refers to needs only its small row, so the collector still knows it has seen it: its description is blanked and its
 * `job_specs` and `job_embeddings` rows are deleted. Rows in `jobs` are never deleted (an undated job inserted again
 * would count as new).
 *
 * Works in batches of `batchSize`, each one short transaction that locks only its own rows and skips rows a poll is
 * writing (`SKIP LOCKED`), at most `maxBatches` per run. Idempotent: a trimmed job no longer matches. Anything that
 * needs a trimmed job's text again reads the posting (`fillJobDescription`, `addJobByUrl`).
 */
export async function sweepStaleJobs(db: Db, opts: SweepOptions = {}): Promise<SweepResult> {
  const now = opts.now ?? new Date();
  const batchSize = Math.max(1, Math.floor(opts.batchSize ?? SWEEP_BATCH_SIZE));
  const maxBatches = Math.max(1, Math.floor(opts.maxBatches ?? SWEEP_MAX_BATCHES));
  // Fresh as of `graceHours` ago = posted within 72 + graceHours hours of now.
  const asOf = new Date(now.getTime() - Math.max(0, opts.graceHours ?? SWEEP_GRACE_HOURS) * HOUR_MS);
  // coalesce: an undated job compares as null in the dated half; like everywhere else, null is not fresh.
  const stale = and(sql`NOT coalesce((${freshJobSql(asOf)}), false)`, unreferencedSql());
  // What there is to trim. A literal '' so the partial index on jobs with text can serve the first.
  const needs: SQL[] = [
    sql`${jobs.descriptionText} <> ''`,
    sql`${jobs.id} IN (SELECT ${jobEmbeddings.jobId} FROM ${jobEmbeddings})`,
    sql`${jobs.id} IN (SELECT ${jobSpecs.jobId} FROM ${jobSpecs})`,
  ];

  const out: SweepResult = { jobs: 0, descriptions: 0, specs: 0, embeddings: 0, batches: 0, more: false };
  for (;;) {
    if (out.batches >= maxBatches || opts.signal?.aborted) { out.more = true; break; }
    const done = await db.transaction(async (tx) => {
      const ids: string[] = [];
      for (const need of needs) {
        if (ids.length >= batchSize) break;
        const rows = await tx.select({ id: jobs.id }).from(jobs).innerJoin(companies, eq(companies.id, jobs.companyId))
          .where(and(need, stale, ids.length ? notInArray(jobs.id, ids) : undefined))
          .limit(batchSize - ids.length)
          .for("no key update", { of: jobs, skipLocked: true });
        ids.push(...rows.map((r) => r.id));
      }
      if (ids.length === 0) return 0;
      const blanked = await tx.update(jobs).set({ descriptionText: "" })
        .where(and(inArray(jobs.id, ids), sql`${jobs.descriptionText} <> ''`)).returning({ id: jobs.id });
      const specs = await tx.delete(jobSpecs).where(inArray(jobSpecs.jobId, ids)).returning({ id: jobSpecs.id });
      const embeddings = await tx.delete(jobEmbeddings).where(inArray(jobEmbeddings.jobId, ids)).returning({ id: jobEmbeddings.jobId });
      out.jobs += ids.length;
      out.descriptions += blanked.length;
      out.specs += specs.length;
      out.embeddings += embeddings.length;
      return ids.length;
    });
    if (done === 0) break;
    out.batches++;
    if (done < batchSize) break;
  }
  return out;
}
