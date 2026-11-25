import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS, fakeEmbedding } from "@norinote/ai";
import { careerPointEmbeddings, careerPoints, companies, eq, jobEmbeddings, jobSpecs, jobs, profiles, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { RESUME_READ_BASIC } from "@norinote/graph";
import { HEURISTIC_SPEC_VERSION, SPEC_VERSION, heuristicOnlyJobs, type StoredJobSpec } from "@norinote/match";
import { repairAiStubRows } from "./repair-ai-stub.js";

const NOW = new Date("2026-10-31T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
/** What the old no-key fake stored: the first enum value, "fake", 0 and [] everywhere. */
const STUB_SPEC: StoredJobSpec = {
  mustHaves: [], niceToHaves: [], skills: [], seniority: "intern", roleFamily: "fake", yearsMin: 0,
  location: { remote: "remote", countries: [], cities: [] }, citizenshipRequired: false, clearanceRequired: false, sponsorship: "yes",
  responsibilities: [], requirementWeights: {},
};
const dense = () => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => ((i % 7) + 1) / 100);

let t: TestDb;
let companyId: string;
let n = 0;
beforeAll(async () => {
  t = await createTestDb();
  const [c] = await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: "repair-co", name: "Initrode", firstReadAt: hoursAgo(720) }).returning();
  companyId = c!.id;
});
afterAll(() => t.close());

async function seedJob(title: string, spec: StoredJobSpec | null, embedding: number[] | null): Promise<string> {
  const id = `repair-${n++}`;
  const [j] = await t.db.insert(jobs).values({
    companyId, atsType: "greenhouse", externalId: id, title, location: "Austin, TX", remote: false,
    descriptionText: "Requirements\n- 5+ years of Python and PostgreSQL\nWe are unable to provide visa sponsorship.",
    applyUrl: `https://example.test/jobs/${id}`, postedAt: hoursAgo(10), firstSeenAt: hoursAgo(10), dedupeKey: id,
  }).returning();
  if (spec) await t.db.insert(jobSpecs).values({ jobId: j!.id, version: SPEC_VERSION, spec, model: "gpt-4.1-mini", createdAt: hoursAgo(10) });
  if (embedding) await t.db.insert(jobEmbeddings).values({ jobId: j!.id, embedding, model: "text-embedding-3-small" });
  return j!.id;
}

describe("repairAiStubRows", () => {
  it("puts back what the no-key fake wrote, so the catch-up reads it again, and leaves real rows alone", async () => {
    const stub = await seedJob("Senior Backend Engineer", STUB_SPEC, fakeEmbedding("Senior Backend Engineer at Initrode."));
    const real = await seedJob("Data Engineer", { ...STUB_SPEC, roleFamily: "data engineering", seniority: "mid" }, dense());
    const realSpecFakeVector = await seedJob("Platform Engineer", { ...STUB_SPEC, roleFamily: "platform engineering" }, fakeEmbedding("Platform Engineer"));

    const [u] = await t.db.insert(users).values({ email: "repair@example.test", passwordHash: "x" }).returning();
    const [other] = await t.db.insert(users).values({ email: "repair-real@example.test", passwordHash: "x" }).returning();
    await t.db.insert(profiles).values([
      { userId: u!.id, resumeText: "Backend engineer", preferences: { theme: "dark" } },
      { userId: other!.id, resumeText: "Analyst", preferences: {} },
    ]);
    const [p] = await t.db.insert(careerPoints).values({ userId: u!.id, kind: "role", title: "Backend Engineer", text: "Built APIs" }).returning();
    const [q] = await t.db.insert(careerPoints).values({ userId: other!.id, kind: "role", title: "Analyst", text: "Reports" }).returning();
    await t.db.insert(careerPointEmbeddings).values([
      { careerPointId: p!.id, userId: u!.id, embedding: fakeEmbedding("Backend Engineer Built APIs"), model: "text-embedding-3-small" },
      { careerPointId: q!.id, userId: other!.id, embedding: dense(), model: "text-embedding-3-small" },
    ]);

    expect(await repairAiStubRows(t.db, NOW)).toEqual({ specs: 1, jobEmbeddings: 1, pointEmbeddings: 1, resumes: 1 });

    const specs = await t.db.select().from(jobSpecs).where(eq(jobSpecs.jobId, stub));
    expect(specs).toEqual([expect.objectContaining({ version: HEURISTIC_SPEC_VERSION, model: "heuristic" })]);
    expect(specs[0]!.spec).toMatchObject({ roleFamily: "backend engineering", seniority: "senior", sponsorship: "no" });
    expect(await t.db.select().from(jobEmbeddings).where(eq(jobEmbeddings.jobId, stub))).toHaveLength(0);
    expect(await heuristicOnlyJobs(t.db, { now: NOW })).toContain(stub);

    expect(await t.db.select().from(jobSpecs).where(eq(jobSpecs.jobId, real))).toEqual([expect.objectContaining({ version: SPEC_VERSION })]);
    expect(await t.db.select().from(jobEmbeddings).where(eq(jobEmbeddings.jobId, real))).toHaveLength(1);
    expect(await t.db.select().from(jobSpecs).where(eq(jobSpecs.jobId, realSpecFakeVector))).toEqual([expect.objectContaining({ version: SPEC_VERSION })]);
    expect(await t.db.select().from(jobEmbeddings).where(eq(jobEmbeddings.jobId, realSpecFakeVector))).toHaveLength(0);

    expect(await t.db.select().from(careerPointEmbeddings).where(eq(careerPointEmbeddings.userId, u!.id))).toHaveLength(0);
    expect(await t.db.select().from(careerPointEmbeddings).where(eq(careerPointEmbeddings.userId, other!.id))).toHaveLength(1);
    const prefs = async (id: string) => (await t.db.select({ p: profiles.preferences }).from(profiles).where(eq(profiles.userId, id)))[0]!.p;
    expect(await prefs(u!.id)).toEqual({ theme: "dark", [RESUME_READ_BASIC]: true });
    expect(await prefs(other!.id)).toEqual({});

    expect(await repairAiStubRows(t.db, NOW)).toEqual({ specs: 0, jobEmbeddings: 0, pointEmbeddings: 0, resumes: 0 });
  });
});
