import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createFakeProvider, setProvider, type ChatRequest } from "@norinote/ai";
import { applications, careerPoints, eq, resumes } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { fakePdfRenderer, seedWorld, type World } from "./test-fixtures.js";
import { tailorResume, type TailorInput } from "./tailor.js";
import type { TailoringReport } from "./types.js";
import { SPEC } from "./test-fixtures.js";

const SPEC_NURSE = { ...SPEC, mustHaves: ["Current RN license", "BLS certification"], niceToHaves: ["Epic charting"], skills: [{ name: "Patient Education", level: "working" as const, years: null, required: true }] };

let t: TestDb;
let dir: string;
beforeAll(async () => {
  t = await createTestDb();
  dir = await mkdtemp(path.join(tmpdir(), "norinote-tailor-"));
});
afterAll(async () => { await t.close(); await rm(dir, { recursive: true, force: true }); });
afterEach(() => setProvider(null));

const NOW = new Date("2026-06-01");
type Offered = { id: string; sourceId: string; text: string; supports: string[] };
type Body = { mode?: string; bullets: Offered[]; summary?: unknown };
type Reply = { summary: string; bullets: { id: string; sourceId: string; text: string }[] };

/** A scripted model, routed by the call's purpose (rewrite, retry, critique, revise). */
function scriptModel(script: { rewrite: (offered: Offered[]) => Reply; retry?: (offered: Offered[]) => Reply; critique?: () => unknown }) {
  const provider = createFakeProvider({
    chat: (req: ChatRequest) => {
      const purpose = req.jsonSchema!.name.replace("resume_", "");
      const body = JSON.parse(req.messages.at(-1)!.content) as Body;
      if (purpose === "rewrite") return script.rewrite(body.bullets);
      if (purpose === "retry") return script.retry ? script.retry(body.bullets) : { summary: "", bullets: [] };
      if (purpose === "critique") return script.critique ? script.critique() : { gaps: [], fixes: [] };
      return { summary: "", bullets: [] };
    },
  });
  setProvider(provider);
  return provider;
}

const GOOD_SUMMARY = "Backend Engineer with 5 years of experience building TypeScript REST APIs on PostgreSQL. Cut latency with Redis caching.";
const find = (offered: Offered[], needle: string) => offered.find((o) => o.text.includes(needle))!;
const keep = (offered: Offered[], rewrites: Record<string, string>, summary = GOOD_SUMMARY): Reply => ({
  summary, bullets: offered.map((o) => ({ id: o.id, sourceId: o.sourceId, text: rewrites[o.id] ?? o.text })),
});
const run = (w: World, extra: Partial<TailorInput> = {}) => tailorResume(t.db, { userId: w.userId, jobId: w.jobId, artifactsDir: dir, now: NOW, renderer: fakePdfRenderer().renderer, ...extra });

describe("tailorResume", () => {
  it("rewrites in the posting's words, gates every bullet, retries once, and stores the report with the resume", async () => {
    const w = await seedWorld(t.db, "e2e", { withApplication: true });
    const good = "Delivered TypeScript REST APIs that served 2M requests per day for the billing and payments services at Acme";
    const provider = scriptModel({
      rewrite: (offered) => keep(offered, {
        [find(offered, "REST APIs").id]: good,
        [find(offered, "billing service").id]: "Migrate the billing service to PostgreSQL on Kubernetes, cutting query time by 40% for the reporting team",
        [find(offered, "p95").id]: "Reduce p95 latency from 800ms to 100ms by adding Redis caching in front of the slowest billing queries",
      }),
      retry: (offered) => keep(offered, {}),
    });

    const r = await run(w);

    expect(provider.calls[0]!.model).toBe("gpt-4.1");
    expect(provider.calls.map((c) => c.jsonSchema!.name)).toContain("resume_retry");
    expect(r.model).toBe("gpt-4.1");

    // The good rewrite is applied; the fabricated tool and number fail twice and revert to the user's own words.
    const acme = r.content.experience.find((e) => e.careerPointId === w.pointIds.acme)!;
    const texts = acme.bullets.map((b) => b.text);
    expect(texts).toContain(good);
    expect(texts).toContain("Migrated the billing service to PostgreSQL, cutting query time by 40%");
    expect(texts).toContain("Reduced p95 latency from 800ms to 200ms by adding Redis caching");
    const reasons = r.rejected.map((x) => x.reason).join("\n");
    expect(reasons).toMatch(/Kubernetes/);
    expect(reasons).toMatch(/number/);

    const change = r.changes.find((c) => c.kind === "bullet")!;
    expect(r.changes.filter((c) => c.kind === "bullet")).toHaveLength(1);
    expect(change).toMatchObject({ before: "Built REST APIs in TypeScript serving 2M requests per day", after: good, careerPointIds: [w.pointIds.acme], gate: { ok: true }, attempts: 1 });
    expect(r.content.summary).toBe(GOOD_SUMMARY);

    // The report: coverage before and after, gaps, per-bullet sources and gate results.
    expect(r.report.coverage.after.pct).toBe(100);
    expect(r.report.coverage.before.total).toBe(2);
    expect(r.report.gaps.map((g) => g.requirement)).toContain("Kubernetes");
    const reverted = r.report.bullets.filter((b) => b.reverted);
    expect(reverted).toHaveLength(2);
    for (const b of reverted) expect(b.gate.failures.length).toBeGreaterThan(0);
    expect(r.report.bullets.every((b) => b.sourceIds.length > 0)).toBe(true);
    expect(r.report.costMicros).toBeGreaterThan(0);

    const [row] = await t.db.select().from(resumes).where(eq(resumes.id, r.resumeId));
    expect(row!.applicationId).toBe(r.applicationId);
    expect(row!.pages).toBe(1);
    expect(row!.changes).toEqual(JSON.parse(JSON.stringify(r.changes)));
    const stored = row!.atsChecks as { keywordCoverage: number; tailoring: TailoringReport };
    expect(stored.keywordCoverage).toBe(100);
    expect(stored.tailoring.coverage.after.pct).toBe(100);
    expect(stored.tailoring.bullets).toHaveLength(r.report.bullets.length);
    expect(existsSync(r.pdfPath)).toBe(true);
    expect((await readFile(r.pdfPath)).toString()).toContain("/Type /Page");
    const [app] = await t.db.select().from(applications).where(eq(applications.id, r.applicationId));
    expect(app!.resumeId).toBe(r.resumeId);
  });

  it("without the AI service: deterministic selection, ordering and skills, no rewrites, a facts-only summary", async () => {
    const w = await seedWorld(t.db, "noai");
    setProvider(createFakeProvider({ chat: () => { throw Object.assign(new Error("upstream down"), { status: 503 }); } }));
    const r = await run(w);
    expect(r.model).toBeNull();
    expect(r.report.aiUnavailable).toBe(true);
    expect(r.changes.filter((c) => c.kind === "bullet")).toEqual([]);
    const acme = r.content.experience[0]!;
    expect(acme.bullets[0]!.text).toBe("Built REST APIs in TypeScript serving 2M requests per day");
    expect(r.content.skills[0]!.items.slice(0, 4)).toEqual(["REST APIs", "TypeScript", "PostgreSQL", "Redis"]);
    expect(r.content.summary).toBe("Backend Engineer with 5 years of experience, working with REST APIs, TypeScript and PostgreSQL.");
    expect(r.changes.find((c) => c.kind === "summary")!.reason).toMatch(/model unavailable/);
    expect(r.report.coverage.after.pct).toBe(100);
  });

  it("for a job the person does not fit: gaps are reported, and the facts summary never lists the posting's skills", async () => {
    const w = await seedWorld(t.db, "misfit", { withShortlist: false });
    const { jobSpecs } = await import("@norinote/db");
    await t.db.update(jobSpecs).set({ spec: { ...SPEC_NURSE } }).where(eq(jobSpecs.jobId, w.jobId));
    setProvider(createFakeProvider({ chat: () => { throw Object.assign(new Error("upstream down"), { status: 503 }); } }));
    const r = await run(w);
    expect(r.content.summary).toBe("Backend Engineer with 5 years of experience.");
    expect(r.content.skills.find((g) => g.group === "Core")).toBeUndefined();
    expect(r.report.gaps.map((g) => g.requirement)).toEqual(expect.arrayContaining(["Current RN license", "BLS certification"]));
    expect(r.report.coverage.after.pct).toBeNull();
  });

  it("replaces a summary that invents a number, a skill or more years, even after the retry", async () => {
    for (const [i, bad] of [
      "Backend engineer with 9 years of experience building TypeScript REST APIs on PostgreSQL.",
      "Backend engineer who scaled TypeScript APIs to 50 million users on PostgreSQL.",
      "Backend engineer who ran Kubernetes clusters and TypeScript APIs on PostgreSQL daily.",
    ].entries()) {
      const w = await seedWorld(t.db, `badsum-${i}`);
      scriptModel({ rewrite: (offered) => keep(offered, {}, bad), retry: (offered) => keep(offered, {}, bad) });
      const r = await run(w);
      expect(r.content.summary, bad).toMatch(/^Backend Engineer with 5 years of experience/);
      expect(r.changes.find((c) => c.kind === "summary")!.reason).toMatch(/model summary rejected/);
      expect(r.report.summary.source).toBe("facts");
    }
  });

  it("builds only from the user's own lines when nothing is rewritten, with skills in the job's spelling", async () => {
    const w = await seedWorld(t.db, "plain");
    scriptModel({ rewrite: (offered) => keep(offered, {}) });
    const r = await run(w);
    const all = [...r.content.experience.flatMap((e) => e.bullets), ...r.content.projects.flatMap((p) => p.bullets)];
    const source = w.points.map((p) => p.text + "\n" + p.title).join("\n");
    for (const b of all) expect(source).toContain(b.text);
    expect(r.content.skills[0]!.items).toEqual(["REST APIs", "TypeScript", "PostgreSQL", "Redis", "React", "Docker"]);
    expect(r.content.skills[0]!.items).not.toContain("Kubernetes");
    expect(r.content.contact).toMatchObject({ location: "Austin, TX", linkedin: "linkedin.com/in/ada", email: "plain@example.test" });
  });

  it("trims the lowest-weight bullets to one page, never a role's best one, and records each cut", async () => {
    const w = await seedWorld(t.db, "trim");
    scriptModel({ rewrite: (offered) => keep(offered, {}) });
    // Measure how many list items the template renders untrimmed, then allow two fewer per page.
    const probe = fakePdfRenderer(() => 1000);
    await run(w, { renderer: probe.renderer });
    const fake = fakePdfRenderer(() => probe.calls[0]!.bullets - 2);
    const r = await run(w, { renderer: fake.renderer });
    const cuts = r.changes.filter((c) => c.kind === "trim");
    expect(cuts.length).toBeGreaterThan(0);
    expect(r.pages).toBe(1);
    const acme = r.content.experience.find((e) => e.careerPointId === w.pointIds.acme)!;
    expect(acme.bullets[0]!.text).toBe("Built REST APIs in TypeScript serving 2M requests per day");
    expect(cuts.map((c) => c.before)).toContain("Reduced p95 latency from 800ms to 200ms by adding Redis caching");
    for (const c of cuts) { expect(c.after).toBeNull(); expect(c.bulletId).toBeTruthy(); }
  });

  it("creates the application when none exists, and reuses it afterwards", async () => {
    const w = await seedWorld(t.db, "newapp");
    scriptModel({ rewrite: (offered) => keep(offered, {}) });
    const first = await run(w);
    const second = await run(w);
    expect(second.applicationId).toBe(first.applicationId);
    expect(second.resumeId).not.toBe(first.resumeId);
    const [app] = await t.db.select().from(applications).where(eq(applications.id, first.applicationId));
    expect(app!.status).toBe("queued");
    expect(app!.resumeId).toBe(second.resumeId);
  });

  it("works without a shortlist row (no fit map): evidence comes from the spec and the career points", async () => {
    const w = await seedWorld(t.db, "nofit", { withShortlist: false });
    scriptModel({ rewrite: (offered) => keep(offered, {}) });
    const r = await run(w);
    expect(r.content.experience.length).toBeGreaterThan(0);
    expect(r.report.coverage.after.total).toBe(2);
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
