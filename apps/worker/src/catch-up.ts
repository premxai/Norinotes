/**
 * AI catch-up: what was done without the AI service is done again once it works. Jobs read with the heuristic spec get
 * the model's reading (and a new embedding; the match batch then scores them again), resumes read with the basic parser
 * get the detailed reading, inbox mail the fallback sorted as `other` is read again, and failed site or GitHub reads
 * are tried again a day later. Each part is bounded per run; nothing runs while the service is in a cooldown or off.
 * The first run per database in a process also repairs what the old no-key fake wrote (see repair-ai-stub.ts) first.
 */
import { BudgetExceededError, aiAvailability } from "@norinote/ai";
import { and, eq, graphSources, gt, isNotNull, lt, ne, profiles, sql, type Db } from "@norinote/db";
import { RESUME_READ_BASIC, buildCareerPoints } from "@norinote/graph";
import { reclassifyFallbackMessages, smallModel } from "@norinote/inbox";
import { heuristicOnlyJobs } from "@norinote/match";
import { JOBS, type QueueAdapter } from "@norinote/queue";
import { repairAiStubRows } from "./repair-ai-stub.js";

export type CatchUpDeps = {
  db: Db;
  queue: QueueAdapter;
  now: () => Date;
  engineAts: readonly string[];
  /** Queues understand.job for these jobs (deduplicated); returns how many were queued. */
  enqueueUnderstand: (jobIds: readonly string[]) => Promise<number>;
};

/** Resumes read again per run (one model call each, charged to the person). */
const RESUMES_PER_RUN = 5;
/** Failed graph sources queued again per run. */
const SOURCES_PER_RUN = 20;
const DAY_MS = 86_400_000;
/** Databases whose fake-model rows this process has already repaired. */
const repaired = new WeakSet<Db>();
/** A failed source is tried again once a day while it is younger than this: at most three automatic tries. */
const SOURCE_RETRY_DAYS = 4;

export async function catchUp(deps: CatchUpDeps): Promise<Record<string, string | number | boolean>> {
  if (!aiAvailability().available) return { skipped: "ai unavailable" };
  const { db, queue } = deps;
  const now = deps.now();

  let stub: Record<string, number> = {};
  if (!repaired.has(db)) {
    const r = await repairAiStubRows(db, now);
    repaired.add(db);
    stub = Object.fromEntries(Object.entries(r).filter(([, n]) => n > 0).map(([k, n]) => [`stub${k[0]!.toUpperCase()}${k.slice(1)}`, n]));
  }

  const heuristic = await heuristicOnlyJobs(db, { now, engineAts: deps.engineAts });
  const jobsQueued = await deps.enqueueUnderstand(heuristic);
  const resumes = await rereadBasicResumes(deps);
  const inbox = await reclassifyFallbackMessages(db, { model: smallModel, now });

  const sources = await db.select({ id: graphSources.id }).from(graphSources).where(and(
    eq(graphSources.status, "failed"), ne(graphSources.kind, "linkedin"),
    lt(graphSources.lastReadAt, new Date(now.getTime() - DAY_MS)), gt(graphSources.createdAt, new Date(now.getTime() - SOURCE_RETRY_DAYS * DAY_MS)),
  )).limit(SOURCES_PER_RUN);
  let sourcesQueued = 0;
  for (const s of sources) {
    if (await queue.enqueue(JOBS.graphReadSource, { sourceId: s.id }, { dedupeKey: s.id, dedupeSeconds: 3600 })) sourcesQueued++;
  }

  return { ...stub, heuristicJobs: heuristic.length, jobsQueued, resumes, inboxReread: inbox.reread, inboxOutcomes: inbox.outcomes, sourcesQueued };
}

/** Resumes read with the basic parser get the detailed reading; the shortlist is rebuilt for each one that got it. */
async function rereadBasicResumes(deps: CatchUpDeps): Promise<number> {
  const { db, queue } = deps;
  const rows = await db.select({ userId: profiles.userId, resumeText: profiles.resumeText }).from(profiles)
    .where(and(sql`${profiles.preferences} ->> ${RESUME_READ_BASIC}::text = 'true'`, isNotNull(profiles.resumeText)))
    .limit(RESUMES_PER_RUN);
  let done = 0;
  for (const r of rows) {
    if (!aiAvailability().available) break;
    let built;
    try {
      built = await buildCareerPoints(db, r.userId, r.resumeText!);
    } catch (err) {
      // Over today's allowance: tried again on a later run.
      if (err instanceof BudgetExceededError) continue;
      throw err;
    }
    // Still the basic parser because the service failed again: stop, the next run tries again.
    if (built.source === "heuristic" && built.aiUnavailable) break;
    await db.update(profiles).set({ preferences: sql`${profiles.preferences} - ${RESUME_READ_BASIC}::text` }).where(eq(profiles.userId, r.userId));
    await queue.enqueue(JOBS.matchUser, { userId: r.userId, reason: "profile" });
    done++;
  }
  return done;
}
