import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AiUnavailableError, createFakeProvider, fakeEmbedding, setAiLogger, setProvider } from "@norinote/ai";
import { eq, jobEmbeddings, jobSpecs, shortlist } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { JobSpec } from "@norinote/shared";
import { heuristicSpec, roleFamilyFromTitle, seniorityFromTitle, yearsFromText } from "./heuristic-spec.js";
import { lexicalOverlap, lexicalProfile, lexicalSimilarity } from "./lexical.js";
import { buildShortlist as buildWidened, clearRequirementVectorCache, matchNewJobs } from "./shortlist.js";
import { HEURISTIC_SPEC_VERSION, SPEC_VERSION, loadCurrentSpec, understandJob, type JobSpecModelOutput } from "./understand.js";
import { NOW, baseSpec, profileOf, seedCompany, seedJob, seedLane, seedPoint, seedUser } from "./test-helpers.js";

let t: TestDb;
let companyId: string;
beforeAll(async () => {
  setAiLogger(() => undefined);
  t = await createTestDb();
  companyId = await seedCompany(t.db, { name: "Initrode" });
});
afterAll(() => t.close());
beforeEach(() => clearRequirementVectorCache());
afterEach(() => setProvider(null));
/** These tests pin exactly which jobs the lanes produce, so they run without the widening ladder (widen.test.ts covers it). */
const buildShortlist: typeof buildWidened = (db, userId, o) => buildWidened(db, userId, { widen: false, ...o });

/** The vendor rejects our key: a 401 on every call, which is what the smoke run saw. */
function rejectedKey() {
  const fail = () => Promise.reject(Object.assign(new Error("401 Incorrect API key provided: sk-proj-SECRET"), { status: 401 }));
  setProvider({ name: "rejected-key", chat: fail, embed: fail });
}

const POSTING = `Senior Backend Engineer. We build payment APIs.

Requirements
- 5+ years of professional experience building backend services
- Strong Python and PostgreSQL
- Experience running Kubernetes in production

Nice to have
- Terraform
- Kafka

You must be a U.S. citizen. We are unable to provide visa sponsorship.`;

describe("heuristicSpec", () => {
  const spec = heuristicSpec({ title: "Senior Backend Engineer", descriptionText: POSTING, location: "Austin, TX", remote: false });

  it("is a valid shared JobSpec", () => {
    expect(JobSpec.safeParse(spec).success).toBe(true);
  });

  it("reads citizenship, clearance and sponsorship with the shared detectors", () => {
    expect(spec).toMatchObject({ citizenshipRequired: true, clearanceRequired: false, sponsorship: "no" });
    const clear = heuristicSpec({ title: "Systems Engineer (TS/SCI)", descriptionText: "Active TS/SCI clearance. Visa sponsorship is available.", location: null, remote: false });
    expect(clear).toMatchObject({ clearanceRequired: true, sponsorship: "yes" });
    const open = heuristicSpec({ title: "Engineer", descriptionText: "No clearance required. Citizens of any country may apply.", location: null, remote: false });
    expect(open).toMatchObject({ clearanceRequired: false, citizenshipRequired: false });
  });

  it("lists the canonical skills found in the text, required ones from the requirements section", () => {
    const byName = Object.fromEntries(spec.skills.map((s) => [s.name, s.required]));
    expect(byName).toMatchObject({ Python: true, PostgreSQL: true, Kubernetes: true, Terraform: false, Kafka: false });
    expect(spec.skills.every((s) => s.level === "working" && s.years === null)).toBe(true);
    // The skill map's canonical names, not the posting's spelling.
    const alias = heuristicSpec({ title: "Platform Engineer", descriptionText: "You will run k8s and write golang.", location: null, remote: false });
    expect(alias.skills.map((s) => s.name)).toEqual(expect.arrayContaining(["Kubernetes", "Go"]));
  });

  it("takes seniority, years and role family from the title and text", () => {
    expect(spec).toMatchObject({ seniority: "senior", yearsMin: 5, roleFamily: "backend engineering" });
    expect(seniorityFromTitle("Software Engineering Intern")).toBe("intern");
    expect(seniorityFromTitle("New Grad Software Engineer")).toBe("entry");
    expect(seniorityFromTitle("Staff Software Engineer")).toBe("staff");
    expect(seniorityFromTitle("Principal Engineer")).toBe("principal");
    expect(seniorityFromTitle("Engineering Manager")).toBe("manager");
    expect(seniorityFromTitle("Product Manager")).toBeNull();
    expect(seniorityFromTitle("Director of Engineering")).toBe("director");
    expect(seniorityFromTitle("Software Engineer")).toBeNull();
    expect(yearsFromText("3-5 years of experience with Go; 7+ years leading teams, experience required")).toBe(3);
    expect(yearsFromText("At least 4 years in a similar role")).toBe(4);
    expect(yearsFromText("We love puppies")).toBeNull();
    expect(heuristicSpec({ title: "Software Engineer", descriptionText: "2+ years of experience", location: null, remote: false }).seniority).toBe("mid");
    expect(roleFamilyFromTitle("Senior Data Scientist")).toBe("data science");
    expect(roleFamilyFromTitle("Site Reliability Engineer")).toBe("infrastructure engineering");
    expect(roleFamilyFromTitle("iOS Developer")).toBe("mobile engineering");
    expect(roleFamilyFromTitle("Full Stack Engineer")).toBe("full-stack engineering");
  });

  it("is deterministic and takes remote from the job", () => {
    expect(heuristicSpec({ title: "Senior Backend Engineer", descriptionText: POSTING, location: "Austin, TX", remote: false })).toEqual(spec);
    expect(heuristicSpec({ title: "Engineer", descriptionText: "", location: "Remote - US", remote: true }).location).toEqual({ remote: "remote", countries: ["United States"], cities: [] });
  });
});

describe("understandJob without the AI service", () => {
  it("writes a heuristic spec (version below current) instead of failing, and leaves the job unembedded", async () => {
    rejectedKey();
    const jobId = await seedJob(t.db, { companyId, title: "Senior Backend Engineer", description: POSTING });
    const r = await understandJob(t.db, jobId);
    expect(r).toMatchObject({ jobId, skipped: false, heuristic: true, embedded: false, embeddingPending: true });
    expect(JobSpec.safeParse(r.spec).success).toBe(true);

    const rows = await t.db.select().from(jobSpecs).where(eq(jobSpecs.jobId, jobId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ model: "heuristic", version: HEURISTIC_SPEC_VERSION });
    expect(HEURISTIC_SPEC_VERSION).toBeLessThan(SPEC_VERSION);
    expect(await loadCurrentSpec(t.db, jobId)).toBeNull();
    expect(await t.db.select().from(jobEmbeddings).where(eq(jobEmbeddings.jobId, jobId))).toHaveLength(0);

    // Running it again while the service is still down reuses the stored heuristic spec.
    const again = await understandJob(t.db, jobId);
    expect(again).toMatchObject({ heuristic: true, spec: r.spec });
    expect(await t.db.select().from(jobSpecs).where(eq(jobSpecs.jobId, jobId))).toHaveLength(1);
  });

  it("upgrades to the model's spec and embeds once the service is back", async () => {
    rejectedKey();
    const jobId = await seedJob(t.db, { companyId, title: "Backend Engineer", description: "Build APIs in Python." });
    await understandJob(t.db, jobId);

    const out: JobSpecModelOutput = {
      mustHaves: [{ text: "Python", weight: 1 }], niceToHaves: [], skills: [{ name: "Python", level: "expert", years: 5, required: true }],
      seniority: "senior", roleFamily: "backend engineering", yearsMin: 5, location: { remote: "unknown", countries: [], cities: [] },
      citizenshipRequired: false, clearanceRequired: false, sponsorship: "unknown", responsibilities: [],
    };
    setProvider(createFakeProvider({ chat: () => out }));
    const r = await understandJob(t.db, jobId);
    expect(r).toMatchObject({ skipped: false, heuristic: false, embedded: true, embeddingPending: false });
    expect(r.spec.seniority).toBe("senior");
    const rows = await t.db.select().from(jobSpecs).where(eq(jobSpecs.jobId, jobId));
    expect(rows.map((x) => [x.version, x.model]).sort()).toEqual([[HEURISTIC_SPEC_VERSION, "heuristic"], [SPEC_VERSION, "gpt-4.1-mini"]].sort());
    expect(await loadCurrentSpec(t.db, jobId)).toMatchObject({ seniority: "senior" });
    expect(await t.db.select().from(jobEmbeddings).where(eq(jobEmbeddings.jobId, jobId))).toHaveLength(1);
  });

  it("keeps the model's spec when only the embedding fails, and fills the embedding in later", async () => {
    const fake = createFakeProvider();
    setProvider({ name: "half", chat: (req) => fake.chat(req), embed: () => Promise.reject(new AiUnavailableError("server", 503)) });
    const jobId = await seedJob(t.db, { companyId, description: "Plain posting." });
    const r = await understandJob(t.db, jobId);
    expect(r).toMatchObject({ heuristic: false, embedded: false, embeddingPending: true });
    expect(await loadCurrentSpec(t.db, jobId)).not.toBeNull();
    expect(await t.db.select().from(jobEmbeddings).where(eq(jobEmbeddings.jobId, jobId))).toHaveLength(0);

    setProvider(null);
    expect(await understandJob(t.db, jobId)).toMatchObject({ skipped: true, embedded: true, embeddingPending: false });
  });

  it("still throws for errors that are not the service being unavailable", async () => {
    setProvider({ name: "bad", chat: () => Promise.reject(Object.assign(new Error("bad request"), { status: 400 })), embed: () => Promise.reject(new Error("x")) });
    const jobId = await seedJob(t.db, { companyId });
    await expect(understandJob(t.db, jobId)).rejects.toThrow(/bad request/);
    expect(await t.db.select().from(jobSpecs).where(eq(jobSpecs.jobId, jobId))).toHaveLength(0);
  });
});

describe("lexical overlap", () => {
  const points = [
    { id: "p", kind: "role" as const, title: "Backend Engineer", org: null, startDate: "2021-01", endDate: null, text: "Built payment services", skills: ["Python", "PostgreSQL"], scope: {}, metrics: {}, embedding: null },
  ];
  const lp = lexicalProfile(points);

  it("rises with the share of the job's skills the user covers, weighting required skills", () => {
    const spec = (skills: Array<[string, boolean]>) => baseSpec({ skills: skills.map(([name, required]) => ({ name, level: "working" as const, years: null, required })) });
    const full = lexicalOverlap({ title: "Backend Engineer", spec: spec([["Python", true], ["PostgreSQL", true]]) }, lp);
    const half = lexicalOverlap({ title: "Backend Engineer", spec: spec([["Python", true], ["Rust", true]]) }, lp);
    const none = lexicalOverlap({ title: "Pastry Chef", spec: spec([["Baking", true], ["Pastry", true]]) }, lp);
    const missedOptional = lexicalOverlap({ title: "Backend Engineer", spec: spec([["Python", true], ["Rust", false]]) }, lp);
    expect(full).toBeGreaterThan(0.9);
    expect(half).toBeGreaterThan(none);
    expect(full).toBeGreaterThan(half);
    expect(missedOptional).toBeGreaterThan(half);
    expect(none).toBe(0);
    expect(lexicalSimilarity(0)).toBeCloseTo(0.15);
    expect(lexicalSimilarity(1)).toBeCloseTo(0.5);
  });

  it("falls back to title words when the job lists no skills", () => {
    expect(lexicalOverlap({ title: "Backend Engineer", spec: baseSpec() }, lp)).toBeGreaterThan(0.3);
    expect(lexicalOverlap({ title: "Pastry Chef", spec: baseSpec() }, lp)).toBe(0);
  });

  it("is usable with a profile built by the real loader shape", () => {
    expect(profileOf({ points }).points).toHaveLength(1);
  });
});

describe("matching with no AI at all", () => {
  async function setup(word: string) {
    const userId = await seedUser(t.db);
    await seedLane(t.db, userId, { name: "Backend", titles: [`${word} Engineer`], locations: [], minFit: 0.2 });
    // Career points exist but were never embedded (the service was down when the resume was read).
    await seedPoint(t.db, userId, { title: "Backend Engineer", org: "Acme", start: "2021-01", skills: ["Python", "PostgreSQL"], text: "built python services on postgresql", embed: false });
    const job = (title: string, skills: string[], over: Partial<Parameters<typeof seedJob>[1]> = {}) =>
      seedJob(t.db, { companyId, title, location: "Remote - US", remote: true, spec: baseSpec({ skills: skills.map((name) => ({ name, level: "working", years: null, required: true })) }), ...over });
    return { userId, job };
  }

  it("buildShortlist ranks jobs that have a spec but no embedding, with no profile embedding either", async () => {
    setProvider(createFakeProvider());
    const { userId, job } = await setup("Kappa");
    const good = await job("Kappa Engineer", ["Python", "PostgreSQL"]);
    const partial = await job("Kappa Engineer, Platform", ["Python", "Rust"]);
    const unrelated = await job("Kappa Engineer, Games", ["Baking", "Pastry"]);
    const noSpec = await seedJob(t.db, { companyId, title: "Kappa Engineer", location: "Remote - US", remote: true });

    const stats = await buildShortlist(t.db, userId, { profileEmbedding: null, now: NOW });
    expect(stats.lexical).toBe(stats.considered);
    expect(stats.candidateIds).toContain(good);
    expect(stats.candidateIds).toContain(partial);
    expect(stats.candidateIds).not.toContain(noSpec);
    expect(stats.candidateIds.indexOf(good)).toBeLessThan(stats.candidateIds.indexOf(partial));
    // No overlap at all: not a candidate.
    expect(stats.candidateIds).not.toContain(unrelated);

    const rows = await t.db.select().from(shortlist).where(eq(shortlist.userId, userId));
    const byJob = new Map(rows.map((r) => [r.jobId, r.fit]));
    expect(byJob.get(good)).toBeGreaterThan(0.7);
    expect(byJob.get(good)!).toBeGreaterThan(byJob.get(partial) ?? 0);
  });

  it("buildShortlist does the same when the embedding service is rejected while ranking", async () => {
    rejectedKey();
    const { userId, job } = await setup("Lambdax");
    const good = await job("Lambdax Engineer", ["Python", "PostgreSQL"]);
    const stats = await buildShortlist(t.db, userId, { profileEmbedding: null, now: NOW });
    expect(stats.candidateIds).toEqual([good]);
    expect(stats.saved).toBe(1);
  });

  it("mixes embedded and unembedded jobs: the vector path and the lexical path both feed the shortlist", async () => {
    setProvider(createFakeProvider());
    const userId = await seedUser(t.db);
    await seedLane(t.db, userId, { titles: ["Mu Engineer"], locations: [], minFit: 0.2 });
    await seedPoint(t.db, userId, { title: "Backend Engineer", start: "2021-01", skills: ["Python"], text: "python services mu engineer" });
    const spec = baseSpec({ skills: [{ name: "Python", level: "working", years: null, required: true }] });
    const embedded = await seedJob(t.db, { companyId, title: "Mu Engineer", remote: true, location: "Remote", spec, embedText: "mu engineer python services" });
    const unembedded = await seedJob(t.db, { companyId, title: "Mu Engineer II", remote: true, location: "Remote", spec });
    const stats = await buildShortlist(t.db, userId, { profileEmbedding: fakeEmbedding("mu engineer python services"), now: NOW });
    expect(new Set(stats.candidateIds)).toEqual(new Set([embedded, unembedded]));
    expect(stats.lexical).toBe(1);
  });

  it("matchNewJobs matches new jobs to a user by skill overlap when nothing is embedded", async () => {
    rejectedKey();
    const { userId, job } = await setup("Nu");
    const fits = await job("Nu Engineer", ["Python", "PostgreSQL"]);
    const weak = await job("Nu Engineer, Games", ["Baking", "Pastry"]);
    // Users without any career points are not evaluated.
    const bare = await seedUser(t.db);
    await seedLane(t.db, bare, { titles: ["Nu Engineer"], locations: [] });

    const result = await matchNewJobs(t.db, [fits, weak], { now: NOW });
    expect(result.usersEvaluated).toBe(1);
    expect(Object.keys(result.perUser)).toEqual([userId]);
    expect(result.pairsFitted).toBe(1);
    const rows = await t.db.select().from(shortlist).where(eq(shortlist.userId, userId));
    expect(rows.map((r) => r.jobId)).toEqual([fits]);
    expect(await t.db.select().from(shortlist).where(eq(shortlist.userId, bare))).toEqual([]);
  });

  it("matchNewJobs still ignores a job that has neither a spec nor an embedding", async () => {
    const { userId } = await setup("Xi");
    const bare = await seedJob(t.db, { companyId, title: "Xi Engineer", location: "Remote - US", remote: true });
    expect((await matchNewJobs(t.db, [bare], { now: NOW })).lanePairs).toBe(0);
    expect(await t.db.select().from(shortlist).where(eq(shortlist.userId, userId))).toEqual([]);
  });
});
