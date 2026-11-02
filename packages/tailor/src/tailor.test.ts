import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createFakeProvider, setProvider } from "@norinote/ai";
import { applications, careerPoints, eq, resumes } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { fakePdfRenderer, seedWorld, type World } from "./test-fixtures.js";
import { tailorResume, type TailorInput } from "./tailor.js";

let t: TestDb;
let dir: string;
beforeAll(async () => {
  t = await createTestDb();
  dir = await mkdtemp(path.join(tmpdir(), "norinote-tailor-"));
});
afterAll(async () => { await t.close(); await rm(dir, { recursive: true, force: true }); });
afterEach(() => setProvider(null));

const NOW = new Date("2026-06-01");
type Offered = { id: string; text: string; supports: string[] };
type Reply = { summary: string; rewrites: { id: string; text: string; reason: string }[] };

/** A scripted large model: reads the offered bullets from the request and answers with `script(offered)`. */
function scriptModel(script: (offered: Offered[], req: { model: string }) => Reply) {
  const provider = createFakeProvider({
    chat: (req) => {
      const input = JSON.parse(req.messages.at(-1)!.content) as { bullets: Offered[] };
      return script(input.bullets, req);
    },
  });
  setProvider(provider);
  return provider;
}

const GOOD_SUMMARY = "Backend engineer with 5 years of experience building TypeScript REST APIs on PostgreSQL. Cut latency with Redis caching.";
const find = (offered: Offered[], needle: string) => offered.find((o) => o.text.includes(needle))!;
const run = (w: World, extra: Partial<TailorInput> = {}) => tailorResume(t.db, { userId: w.userId, jobId: w.jobId, artifactsDir: dir, now: NOW, renderer: fakePdfRenderer().renderer, ...extra });

describe("tailorResume", () => {
  it("rewrites at most five bullets in the posting's words, rejects fabrications, and records everything", async () => {
    const w = await seedWorld(t.db, "e2e", { withApplication: true });
    const provider = scriptModel((offered) => ({
      summary: GOOD_SUMMARY,
      rewrites: [
        { id: find(offered, "REST APIs").id, text: "Built TypeScript REST APIs serving 2M requests per day", reason: "Leads with the posting's TypeScript requirement" },
        { id: find(offered, "billing service").id, text: "Migrated the billing service to PostgreSQL and Kubernetes, cutting query time by 40%", reason: "x" },
        { id: find(offered, "p95").id, text: "Reduced p95 latency from 800ms to 100ms by adding Redis caching", reason: "x" },
        { id: find(offered, "onboarding").id, text: "Wrote onboarding docs for new engineers at Stripe", reason: "x" },
        { id: "made-up-id", text: "Built something entirely different and new here today", reason: "x" },
      ],
    }));

    const r = await run(w);

    // One large-model call, and only one.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.model).toBe("gpt-4.1");
    expect(r.model).toBe("gpt-4.1");
    expect(r.modelError).toBeNull();

    // The valid rewrite is applied; every rejected one keeps its original bullet.
    const acme = r.content.experience.find((e) => e.careerPointId === w.pointIds.acme)!;
    const texts = acme.bullets.map((b) => b.text);
    expect(texts).toContain("Built TypeScript REST APIs serving 2M requests per day");
    expect(texts).toContain("Migrated the billing service to PostgreSQL, cutting query time by 40%");
    expect(texts).toContain("Reduced p95 latency from 800ms to 200ms by adding Redis caching");
    expect(texts).toContain("Wrote onboarding docs for new engineers");
    expect(r.rejected.map((x) => x.reason).join("\n")).toMatch(/Kubernetes/);
    expect(r.rejected.map((x) => x.reason).join("\n")).toMatch(/number/);
    expect(r.rejected.map((x) => x.reason).join("\n")).toMatch(/Stripe/);
    expect(r.rejected.find((x) => x.bulletId === "made-up-id")!.reason).toMatch(/not one of the bullets offered/);
    expect(r.rejected).toHaveLength(4);

    // Changes: the bullet (before, after, reason, career point ids) and the summary.
    const bulletChange = r.changes.find((c) => c.kind === "bullet")!;
    expect(r.changes.filter((c) => c.kind === "bullet")).toHaveLength(1);
    expect(bulletChange).toEqual({
      kind: "bullet", before: "Built REST APIs in TypeScript serving 2M requests per day", after: "Built TypeScript REST APIs serving 2M requests per day",
      reason: "Leads with the posting's TypeScript requirement", careerPointIds: [w.pointIds.acme],
    });
    const summaryChange = r.changes.find((c) => c.kind === "summary")!;
    expect(summaryChange.after).toBe(GOOD_SUMMARY);
    expect(summaryChange.careerPointIds).toContain(w.pointIds.acme);
    expect(r.content.summary).toBe(GOOD_SUMMARY);

    // Persisted: resume row, ATS checks, PDF on disk, application points at it.
    const [row] = await t.db.select().from(resumes).where(eq(resumes.id, r.resumeId));
    expect(row!.applicationId).toBe(r.applicationId);
    expect(row!.pages).toBe(1);
    expect(row!.changes).toEqual(JSON.parse(JSON.stringify(r.changes)));
    expect((row!.content as { name: string }).name).toBe("Ada Lovelace");
    expect((row!.atsChecks as { keywordCoverage: number }).keywordCoverage).toBe(100);
    expect(row!.pdfPath).toBe(r.pdfPath);
    expect(r.pdfPath.startsWith(path.resolve(dir, "resumes", w.userId))).toBe(true);
    expect(existsSync(r.pdfPath)).toBe(true);
    expect((await readFile(r.pdfPath)).toString()).toContain("/Type /Page");
    const [app] = await t.db.select().from(applications).where(eq(applications.id, r.applicationId));
    expect(app!.resumeId).toBe(r.resumeId);
  });

  it("falls back to the original bullets and a facts-only summary when the model is unavailable", async () => {
    const w = await seedWorld(t.db, "nomodel");
    setProvider(createFakeProvider({ chat: () => { throw new Error("model down"); } }));
    const r = await run(w);
    expect(r.model).toBeNull();
    expect(r.modelError).toMatch(/model down/);
    expect(r.changes.filter((c) => c.kind === "bullet")).toEqual([]);
    expect(r.content.experience[0]!.bullets.map((b) => b.text)).toContain("Built REST APIs in TypeScript serving 2M requests per day");
    // Built from the career points: the latest title, the years from the dates, and posting skills the user really has.
    expect(r.content.summary).toBe("Backend Engineer with 5 years of experience, working with TypeScript, PostgreSQL and Redis.");
    expect(r.changes.find((c) => c.kind === "summary")!.reason).toMatch(/model unavailable/);
  });

  it("replaces a summary that invents a number, a skill or more years", async () => {
    for (const [i, bad] of [
      "Backend engineer with 9 years of experience building TypeScript REST APIs on PostgreSQL.",
      "Backend engineer who scaled TypeScript APIs to 50 million users on PostgreSQL.",
      "Backend engineer who ran Kubernetes clusters and TypeScript APIs on PostgreSQL daily.",
    ].entries()) {
      const w = await seedWorld(t.db, `badsum-${i}`);
      scriptModel(() => ({ summary: bad, rewrites: [] }));
      const r = await run(w);
      expect(r.content.summary, bad).toMatch(/^Backend Engineer with 5 years of experience/);
      expect(r.changes.find((c) => c.kind === "summary")!.reason).toMatch(/model summary rejected/);
    }
  });

  it("builds from the fit map stored on the shortlist, and drops nothing the user did not write", async () => {
    const w = await seedWorld(t.db, "plain");
    scriptModel(() => ({ summary: GOOD_SUMMARY, rewrites: [] }));
    const r = await run(w);
    const all = [...r.content.experience.flatMap((e) => e.bullets), ...r.content.projects.flatMap((p) => p.bullets)];
    const source = w.points.map((p) => p.text + "\n" + p.title).join("\n");
    for (const b of all) expect(source).toContain(b.text);
    expect(r.content.skills[0]!.items).toEqual(["TypeScript", "PostgreSQL", "Docker", "Redis"]);
    expect(r.content.contact).toMatchObject({ location: "Austin, TX", linkedin: "linkedin.com/in/ada", email: "plain@example.test" });
  });

  it("trims the lowest-weight bullets to one page and records each cut", async () => {
    const w = await seedWorld(t.db, "trim");
    scriptModel(() => ({ summary: GOOD_SUMMARY, rewrites: [] }));
    const fake = fakePdfRenderer(() => 5);
    const r = await run(w, { renderer: fake.renderer });
    const cuts = r.changes.filter((c) => c.kind === "trim");
    expect(cuts).toHaveLength(3);
    expect(r.pages).toBe(1);
    expect(fake.calls.length).toBeGreaterThan(1);
    // What stays in the top role is its best bullet (the Redis achievement), the cuts are the weaker lines.
    const acme = r.content.experience.find((e) => e.careerPointId === w.pointIds.acme)!;
    expect(acme.bullets.map((b) => b.id)).toEqual([w.pointIds.redis]);
    expect(cuts.map((c) => c.before)).toContain("Wrote onboarding docs for new engineers");
    for (const c of cuts) expect(c.after).toBeNull();
  });

  it("creates the application when none exists, and reuses it afterwards", async () => {
    const w = await seedWorld(t.db, "newapp");
    scriptModel(() => ({ summary: GOOD_SUMMARY, rewrites: [] }));
    const first = await run(w);
    const second = await run(w);
    expect(second.applicationId).toBe(first.applicationId);
    expect(second.resumeId).not.toBe(first.resumeId);
    const [app] = await t.db.select().from(applications).where(eq(applications.id, first.applicationId));
    expect(app!.status).toBe("queued");
    expect(app!.resumeId).toBe(second.resumeId);
  });

  it("works without a shortlist row (no fit map): selects by skill mentions", async () => {
    const w = await seedWorld(t.db, "nofit", { withShortlist: false });
    scriptModel(() => ({ summary: GOOD_SUMMARY, rewrites: [] }));
    const r = await run(w);
    expect(r.content.experience.length).toBeGreaterThan(0);
    expect(r.pages).toBe(1);
  });

  it("fails clearly for a missing job, a missing application and a user with no career points", async () => {
    const w = await seedWorld(t.db, "errors");
    await expect(run(w, { jobId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(/Job .* not found/);
    await expect(run(w, { applicationId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(/Application .* not found/);
    const empty = await seedWorld(t.db, "empty");
    await t.db.delete(careerPoints).where(eq(careerPoints.userId, empty.userId));
    await expect(run(empty)).rejects.toThrow(/no career points/);
  });
});
