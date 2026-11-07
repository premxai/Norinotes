import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cosineDistance, eq, sql, asc, and, desc } from "drizzle-orm";
import { EMBEDDING_DIMENSIONS, companies, jobEmbeddings, jobs, llmUsage, migrate, queryRows, shortlist, users, connect } from "./index.js";
import { createTestDb, type TestDb } from "./testing.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());

/** A unit-ish vector pointing mostly along one axis, so cosine distances are easy to predict. */
const axis = (i: number, other = 0): number[] => {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[i] = 1;
  v[(i + 1) % EMBEDDING_DIMENSIONS] = other;
  return v;
};

async function makeJob(externalId: string, extra: Partial<typeof jobs.$inferInsert> = {}) {
  const [company] = await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: `co-${externalId}`, name: `Co ${externalId}` }).returning();
  const [job] = await t.db.insert(jobs).values({
    companyId: company!.id, atsType: "greenhouse", externalId, title: `Engineer ${externalId}`, applyUrl: `https://example.test/${externalId}`,
    dedupeKey: `co|engineer-${externalId}|remote`, ...extra,
  }).returning();
  return job!;
}

describe("schema on PGlite with pgvector", () => {
  it("migrates every table and is safe to migrate again", async () => {
    await migrate({ db: t.db, kind: "pglite" });
    const rows = await queryRows<{ table_name: string }>(t.db, sql`select table_name from information_schema.tables where table_schema = 'public'`);
    const names = new Set(rows.map((r) => r.table_name));
    for (const expected of [
      "companies", "jobs", "job_specs", "job_embeddings", "users", "sessions", "auth_tokens", "profiles", "lanes", "career_points",
      "career_point_embeddings", "shortlist", "applications", "resumes", "answer_bank", "run_events", "inbox_addresses",
      "inbox_messages", "channels", "llm_usage", "outcomes",
    ]) expect(names.has(expected), expected).toBe(true);
  });

  it("creates the hnsw cosine indexes and the key unique indexes", async () => {
    const rows = await queryRows<{ indexname: string; indexdef: string }>(t.db, sql`select indexname, indexdef from pg_indexes where schemaname = 'public'`);
    const defs = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    for (const name of ["job_embeddings_hnsw_idx", "career_point_embeddings_hnsw_idx", "answer_bank_hnsw_idx"]) {
      expect(defs.get(name), name).toMatch(/hnsw .*vector_cosine_ops/);
    }
    expect(defs.get("jobs_ats_external_uq")).toMatch(/UNIQUE .*ats_type, external_id/);
    expect(defs.get("shortlist_user_status_fit_idx")).toMatch(/fit DESC/);
    expect(defs.has("jobs_closed_posted_idx")).toBe(true);
    // Open jobs by age (freshJobSql's leading range); the unused text index on dedupe_key is gone.
    expect(defs.get("jobs_open_recency_idx")).toMatch(/COALESCE\(posted_at, first_seen_at\).*WHERE \(closed_at IS NULL\)/);
    expect(defs.has("jobs_dedupe_key_idx")).toBe(false);
    expect(defs.has("applications_user_status_idx")).toBe(true);
    expect(defs.has("answer_bank_user_idx")).toBe(true);
  });

  it("ranks job embeddings by cosine distance", async () => {
    const a = await makeJob("vec-a");
    const b = await makeJob("vec-b");
    const c = await makeJob("vec-c");
    await t.db.insert(jobEmbeddings).values([
      { jobId: a.id, embedding: axis(0), model: "test" },
      { jobId: b.id, embedding: axis(0, 0.5), model: "test" },
      { jobId: c.id, embedding: axis(7), model: "test" },
    ]);
    const query = axis(0);
    const ranked = await t.db
      .select({ jobId: jobEmbeddings.jobId, distance: cosineDistance(jobEmbeddings.embedding, query) })
      .from(jobEmbeddings)
      .orderBy(asc(cosineDistance(jobEmbeddings.embedding, query)))
      .limit(3);
    expect(ranked.map((r) => r.jobId)).toEqual([a.id, b.id, c.id]);
    expect(Number(ranked[0]!.distance)).toBeCloseTo(0, 5);
    expect(Number(ranked[2]!.distance)).toBeCloseTo(1, 5);
  });

  it("rejects a duplicate (ats_type, external_id)", async () => {
    const job = await makeJob("dupe");
    await expect(t.db.insert(jobs).values({
      companyId: job.companyId, atsType: "greenhouse", externalId: "dupe", title: "again", applyUrl: "https://example.test/x", dedupeKey: "k",
    })).rejects.toThrow();
  });

  it("round-trips arrays, jsonb and numeric through a shortlist row", async () => {
    const job = await makeJob("short");
    const [user] = await t.db.insert(users).values({ email: "a@example.test", passwordHash: "x" }).returning();
    await t.db.insert(shortlist).values([
      { userId: user!.id, jobId: job.id, fit: 0.82, reasons: ["Used Postgres at scale"], fitMap: [{ requirement: "Postgres", score: 0.9 }] },
    ]);
    const [row] = await t.db.select().from(shortlist).where(and(eq(shortlist.userId, user!.id), eq(shortlist.status, "new"))).orderBy(desc(shortlist.fit));
    expect(row!.fit).toBeCloseTo(0.82);
    expect(row!.reasons).toEqual(["Used Postgres at scale"]);
    expect(row!.fitMap).toEqual([{ requirement: "Postgres", score: 0.9 }]);
  });

  it("keeps one llm_usage row per user per day with bigint micros", async () => {
    const [user] = await t.db.insert(users).values({ email: "b@example.test", passwordHash: "x" }).returning();
    await t.db.insert(llmUsage).values({ userId: user!.id, day: "2026-10-31", costMicros: 123 });
    await expect(t.db.insert(llmUsage).values({ userId: user!.id, day: "2026-10-31" })).rejects.toThrow();
  });

  it("each createTestDb is isolated", async () => {
    const other = await createTestDb();
    try {
      const rows = await other.db.select().from(users);
      expect(rows).toHaveLength(0);
    } finally {
      await other.close();
    }
  });

  it("connect() with no url opens an in-memory PGlite", async () => {
    const h = await connect({ pgliteDir: ":memory:" });
    try {
      const r = await queryRows<{ ok: number }>(h.db, sql`select 1 as ok`);
      expect(r[0]!.ok).toBe(1);
    } finally {
      await h.close();
    }
  });
});
