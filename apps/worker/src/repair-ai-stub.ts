/**
 * Repair for rows written while @norinote/ai answered with its deterministic fake outside tests (no OPENAI_API_KEY, before
 * the fake became test-only). Those rows looked like real model output, so nothing ever read them again:
 *
 * - job specs with role family "fake" (the fake's placeholder string) at the current spec version;
 * - fake embeddings: word-hash vectors whose components are mostly zero, which a real embedding never is.
 *
 * Each is put back to what the no-AI path writes, so the catch-up reads it again: a fresh job gets the heuristic spec
 * (version 0, already due for an upgrade) and loses its fake embedding, and a person's fake point embeddings are deleted
 * (match.user embeds the points again) with their resume marked for the detailed reading.
 */
import { EMBEDDING_DIMENSIONS } from "@norinote/ai";
import { and, careerPointEmbeddings, companies, eq, gte, inArray, isNotNull, isNull, jobEmbeddings, jobSpecs, jobs, profiles, sql, freshJobSql, type Db } from "@norinote/db";
import { RESUME_READ_BASIC } from "@norinote/graph";
import { HEURISTIC_RETRY_AFTER_MS, HEURISTIC_SPEC_VERSION, SPEC_VERSION, heuristicSpec } from "@norinote/match";

export type StubRepair = { specs: number; jobEmbeddings: number; pointEmbeddings: number; resumes: number };

const fakeVectorSql = (column: typeof jobEmbeddings.embedding | typeof careerPointEmbeddings.embedding) =>
  sql`(SELECT count(*) FROM unnest(${column}::real[]) AS x WHERE x = 0) > ${EMBEDDING_DIMENSIONS / 2}`;

export async function repairAiStubRows(db: Db, now: Date): Promise<StubRepair> {
  const fresh = and(isNull(jobs.closedAt), freshJobSql(now));
  const stubSpecs = await db
    .selectDistinct({ jobId: jobs.id, title: jobs.title, descriptionText: jobs.descriptionText, location: jobs.location, remote: jobs.remote })
    .from(jobSpecs)
    .innerJoin(jobs, eq(jobs.id, jobSpecs.jobId))
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(fresh, gte(jobSpecs.version, SPEC_VERSION), sql`${jobSpecs.spec} ->> 'roleFamily' = 'fake'`));
  const dueAt = new Date(now.getTime() - HEURISTIC_RETRY_AFTER_MS - 60_000);
  for (const job of stubSpecs) {
    await db.transaction(async (tx) => {
      await tx.delete(jobSpecs).where(and(eq(jobSpecs.jobId, job.jobId), gte(jobSpecs.version, SPEC_VERSION)));
      await tx.insert(jobSpecs)
        .values({ jobId: job.jobId, version: HEURISTIC_SPEC_VERSION, spec: heuristicSpec(job), model: "heuristic", createdAt: dueAt })
        .onConflictDoUpdate({ target: [jobSpecs.jobId, jobSpecs.version], set: { createdAt: dueAt } });
      await tx.delete(jobEmbeddings).where(eq(jobEmbeddings.jobId, job.jobId));
    });
  }

  const fakeJobVectors = await db.delete(jobEmbeddings)
    .where(and(
      fakeVectorSql(jobEmbeddings.embedding),
      sql`EXISTS (SELECT 1 FROM ${jobs} INNER JOIN ${companies} ON ${companies.id} = ${jobs.companyId} WHERE ${jobs.id} = ${jobEmbeddings.jobId} AND ${fresh})`,
    ))
    .returning({ jobId: jobEmbeddings.jobId });

  const fakePointVectors = await db.delete(careerPointEmbeddings).where(fakeVectorSql(careerPointEmbeddings.embedding))
    .returning({ userId: careerPointEmbeddings.userId });
  const userIds = [...new Set(fakePointVectors.map((r) => r.userId))];
  const resumes = userIds.length === 0 ? [] : await db.update(profiles)
    .set({ preferences: sql`jsonb_set(${profiles.preferences}, ${`{${RESUME_READ_BASIC}}`}::text[], 'true'::jsonb)` })
    .where(and(inArray(profiles.userId, userIds), isNotNull(profiles.resumeText)))
    .returning({ userId: profiles.userId });

  return { specs: stubSpecs.length, jobEmbeddings: fakeJobVectors.length, pointEmbeddings: fakePointVectors.length, resumes: resumes.length };
}
