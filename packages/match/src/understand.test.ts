import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createFakeProvider, setProvider } from "@norinote/ai";
import { eq, jobEmbeddings, jobSpecs } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { JobSpec } from "@norinote/shared";
import { SPEC_VERSION, finalizeSpec, jobEmbeddingText, understandJob, type JobSpecModelOutput } from "./understand.js";
import { seedCompany, seedJob } from "./test-helpers.js";

let t: TestDb;
let companyId: string;
beforeAll(async () => {
  t = await createTestDb();
  companyId = await seedCompany(t.db, { name: "Globex" });
});
afterAll(() => t.close());
afterEach(() => setProvider(null));

const modelOutput = (over: Partial<JobSpecModelOutput> = {}): JobSpecModelOutput => ({
  mustHaves: [{ text: "3+ years of Python", weight: 0.9 }, { text: "Production experience with k8s", weight: 0.7 }, { text: "3+ years of Python", weight: 0.2 }],
  niceToHaves: [{ text: "Terraform", weight: 7 }],
  skills: [
    { name: "k8s", level: "advanced", years: 2, required: true },
    { name: "Kubernetes", level: "working", years: null, required: false },
    { name: "Python", level: "advanced", years: 3, required: true },
    { name: "Obscure Tool", level: "basic", years: null, required: false },
  ],
  seniority: "mid",
  roleFamily: "  Backend Engineering ",
  yearsMin: 3,
  location: { remote: "unknown", countries: ["United States"], cities: ["Austin"] },
  citizenshipRequired: false,
  clearanceRequired: false,
  sponsorship: "unknown",
  responsibilities: ["Build APIs", "Run on-call"],
  ...over,
});

const useModel = (out: JobSpecModelOutput) => {
  const fake = createFakeProvider({ chat: () => out });
  setProvider(fake);
  return fake;
};

describe("understandJob", () => {
  it("writes a contract-valid spec with normalised skills, then embeds a compact job text", async () => {
    const fake = useModel(modelOutput());
    const jobId = await seedJob(t.db, { companyId, title: "Backend Engineer", description: "Build APIs in Python on Kubernetes.", remote: true });
    const r = await understandJob(t.db, jobId);

    expect(r).toMatchObject({ jobId, skipped: false, embedded: true });
    expect(fake.calls.filter((c) => c.jsonSchema)).toHaveLength(1);
    expect(fake.calls[0]!.model).toBe("gpt-4.1-mini");
    expect(fake.calls[0]!.jsonSchema?.strict).toBe(true);

    const [row] = await t.db.select().from(jobSpecs).where(eq(jobSpecs.jobId, jobId));
    expect(row!.version).toBe(SPEC_VERSION);
    expect(row!.model).toBe("gpt-4.1-mini");
    const spec = row!.spec;
    expect(JobSpec.safeParse(spec).success).toBe(true);
    // Duplicate requirement dropped, weights clamped to 0..1, role family tidied.
    expect(spec.mustHaves).toEqual(["3+ years of Python", "Production experience with k8s"]);
    expect(spec.niceToHaves).toEqual(["Terraform"]);
    expect((spec as { requirementWeights?: Record<string, number> }).requirementWeights).toEqual({
      "3+ years of Python": 0.9, "Production experience with k8s": 0.7, Terraform: 1,
    });
    expect(spec.roleFamily).toBe("backend engineering");
    // k8s and Kubernetes merge into one canonical skill, keeping the stronger level, the years and the required flag.
    expect(spec.skills).toEqual([
      { name: "Kubernetes", level: "advanced", years: 2, required: true },
      { name: "Python", level: "advanced", years: 3, required: true },
      { name: "Obscure Tool", level: "basic", years: null, required: false },
    ]);
    // The job row is remote, so "unknown" location becomes remote.
    expect(spec.location.remote).toBe("remote");

    const [emb] = await t.db.select().from(jobEmbeddings).where(eq(jobEmbeddings.jobId, jobId));
    expect(emb!.embedding).toHaveLength(1536);
  });

  it("is idempotent: a job with a current spec makes no model call and writes nothing new", async () => {
    const fake = useModel(modelOutput());
    const jobId = await seedJob(t.db, { companyId });
    await understandJob(t.db, jobId);
    const callsAfterFirst = fake.calls.length;
    const again = await understandJob(t.db, jobId);
    expect(again).toMatchObject({ skipped: true, embedded: false });
    expect(fake.calls.length).toBe(callsAfterFirst);
    expect(await t.db.select().from(jobSpecs).where(eq(jobSpecs.jobId, jobId))).toHaveLength(1);
  });

  it("fills in a missing embedding from the stored spec without calling the model", async () => {
    const fake = useModel(modelOutput());
    const jobId = await seedJob(t.db, { companyId });
    await understandJob(t.db, jobId);
    await t.db.delete(jobEmbeddings).where(eq(jobEmbeddings.jobId, jobId));
    const chatCalls = fake.calls.length;
    const r = await understandJob(t.db, jobId);
    expect(r).toMatchObject({ skipped: true, embedded: true });
    expect(fake.calls.length).toBe(chatCalls);
    expect(await t.db.select().from(jobEmbeddings).where(eq(jobEmbeddings.jobId, jobId))).toHaveLength(1);
  });

  it("re-understands when only an older spec version exists", async () => {
    const fake = useModel(modelOutput());
    const jobId = await seedJob(t.db, { companyId });
    // Pretend a version 0 spec is all there is (versions below the current one do not count).
    await t.db.insert(jobSpecs).values({ jobId, version: 0, spec: finalizeSpec(modelOutput(), { title: "x", descriptionText: "", remote: false }), model: "old" });
    const r = await understandJob(t.db, jobId);
    expect(r.skipped).toBe(false);
    expect(fake.calls.filter((c) => c.jsonSchema)).toHaveLength(1);
  });

  it("lets the deterministic detectors override the model when they are sure", async () => {
    // The model misses a citizenship requirement, invents a clearance, and says sponsorship is unknown.
    useModel(modelOutput({ citizenshipRequired: false, clearanceRequired: true, sponsorship: "unknown" }));
    const jobId = await seedJob(t.db, {
      companyId,
      title: "Software Engineer",
      description: "Candidates must be U.S. citizens. No clearance required. We are unable to provide visa sponsorship.",
    });
    const { spec } = await understandJob(t.db, jobId);
    expect(spec.citizenshipRequired).toBe(true);
    // "No clearance required" clears the model's invented clearance; the citizenship sentence is untouched by it.
    expect(spec.clearanceRequired).toBe(false);
    expect(spec.sponsorship).toBe("no");
  });

  it("clears a model guess when the posting explicitly says nothing is needed, and keeps the model when the text is silent", async () => {
    useModel(modelOutput({ clearanceRequired: true, citizenshipRequired: true }));
    const cleared = await seedJob(t.db, { companyId, description: "We do not require a security clearance. Citizens of any country may apply." });
    const a = await understandJob(t.db, cleared);
    expect(a.spec.clearanceRequired).toBe(false);
    expect(a.spec.citizenshipRequired).toBe(false);

    useModel(modelOutput({ clearanceRequired: true, sponsorship: "yes" }));
    const silent = await seedJob(t.db, { companyId, description: "Great team, great snacks." });
    const b = await understandJob(t.db, silent);
    expect(b.spec.clearanceRequired).toBe(true);
    expect(b.spec.sponsorship).toBe("yes");
  });

  it("finds a restriction that only shows in the title or a must-have", async () => {
    useModel(modelOutput({ mustHaves: [{ text: "Active Secret clearance", weight: 1 }] }));
    const a = await seedJob(t.db, { companyId, description: "Build things." });
    expect((await understandJob(t.db, a)).spec.clearanceRequired).toBe(true);
    useModel(modelOutput());
    const b = await seedJob(t.db, { companyId, title: "Systems Engineer (TS/SCI)", description: "Build things." });
    expect((await understandJob(t.db, b)).spec.clearanceRequired).toBe(true);
  });

  it("works with the fake provider's default minimal reply and rejects an unknown job", async () => {
    const jobId = await seedJob(t.db, { companyId, description: "Plain posting." });
    const r = await understandJob(t.db, jobId);
    expect(JobSpec.safeParse(r.spec).success).toBe(true);
    await expect(understandJob(t.db, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/not found/);
  });
});

describe("jobEmbeddingText", () => {
  it("is compact and carries the role, skills, requirements and a snippet of the posting", () => {
    const spec = finalizeSpec(modelOutput(), { title: "Backend Engineer", descriptionText: "", remote: false });
    const text = jobEmbeddingText({ title: "Backend Engineer", companyName: "Globex", location: "Austin, TX", descriptionText: "x".repeat(5000) }, spec);
    expect(text).toContain("Backend Engineer at Globex");
    expect(text).toContain("Skills: Kubernetes, Python, Obscure Tool");
    expect(text).toContain("Requirements: 3+ years of Python");
    expect(text.length).toBeLessThanOrEqual(2000);
  });
});
