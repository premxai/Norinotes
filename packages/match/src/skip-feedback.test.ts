import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fakeEmbedding } from "@norinote/ai";
import { eq, lanes, profiles, shortlist, type Db } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import type { SkipReason } from "@norinote/shared";
import { rawFitOf } from "./outcomes.js";
import { buildShortlist, clearRequirementVectorCache } from "./shortlist.js";
import {
  SKIP_REASON_PREFIX, clearSkipEffect, loadSkipEffects, skipEffectsOf, skipPenalty, skipPenaltyOf, type SkipSignal,
} from "./skip-feedback.js";
import { NOW, baseSpec, daysAgo, seedCompany, seedJob, seedLane, seedPoint, seedUser } from "./test-helpers.js";

const sig = (reason: SkipReason, title: string, more: Partial<SkipSignal> = {}): SkipSignal => ({ reason, title, location: "San Francisco, CA", remote: false, at: daysAgo(2), ...more });

describe("skipEffectsOf", () => {
  it("needs two skips of the same kind: one tap changes nothing", () => {
    expect(skipEffectsOf([sig("not_my_kind", "Frontend Engineer")], {}, NOW)).toEqual([]);
    expect(skipEffectsOf([sig("not_my_kind", "Frontend Engineer"), sig("not_my_kind", "Data Analyst")], {}, NOW)).toEqual([]);
    expect(skipEffectsOf([sig("too_senior", "Staff Engineer")], {}, NOW)).toEqual([]);
  });

  it("Not my kind of role: penalises the role family (and subfamily) skipped twice", () => {
    const effects = skipEffectsOf([sig("not_my_kind", "Frontend Engineer"), sig("not_my_kind", "Senior Front-End Developer")], {}, NOW);
    expect(effects).toEqual([{ id: "role:software_engineering.frontend", kind: "role", reason: "not_my_kind", value: "software_engineering.frontend", label: "frontend software engineering roles", skips: 2, delta: -0.05 }]);
    expect(skipPenalty(effects, { title: "React Frontend Engineer", location: null, remote: true })).toEqual({
      delta: -0.05, reason: `${SKIP_REASON_PREFIX}2 frontend software engineering jobs as not your kind of role (-0.05 fit)`,
    });
    expect(skipPenalty(effects, { title: "Backend Engineer", location: null, remote: true }).delta).toBe(0);
  });

  it("Too senior: the second-highest level skipped is the floor; Too junior mirrors it", () => {
    const senior = skipEffectsOf([sig("too_senior", "Principal Engineer"), sig("too_senior", "Senior Engineer"), sig("too_senior", "Staff Engineer")], {}, NOW);
    expect(senior).toMatchObject([{ id: "level_above", value: "staff", skips: 2, label: "staff level and above" }]);
    const job = (title: string, seniority: string | null = null) => ({ title, seniority, location: null, remote: true });
    expect(skipPenalty(senior, job("Staff Engineer")).delta).toBe(-0.05);
    expect(skipPenalty(senior, job("Engineer", "principal")).delta).toBe(-0.05);
    expect(skipPenalty(senior, job("Senior Engineer")).delta).toBe(0);
    expect(skipPenalty(senior, job("Engineer")).delta).toBe(0);

    const junior = skipEffectsOf([sig("too_junior", "Software Engineering Intern"), sig("too_junior", "Junior Engineer", { seniority: "entry" })], {}, NOW);
    expect(junior).toMatchObject([{ id: "level_below", value: "entry", skips: 2 }]);
    expect(skipPenalty(junior, job("New Grad Engineer")).reason).toBe(`${SKIP_REASON_PREFIX}2 jobs at entry level or below as too junior (-0.05 fit)`);
    expect(skipPenalty(junior, job("Engineer II")).delta).toBe(0);
  });

  it("Wrong location: the one city (or state) the job names; several places name none", () => {
    const effects = skipEffectsOf([
      sig("wrong_location", "Engineer", { location: "Austin, TX" }), sig("wrong_location", "Analyst", { location: "Austin, Texas" }),
      sig("wrong_location", "Engineer", { location: "Austin, TX; Denver, CO" }),
    ], {}, NOW);
    expect(effects).toMatchObject([{ id: "city:austin", kind: "city", label: "Austin, TX", skips: 2 }]);
    expect(skipPenalty(effects, { title: "Designer", location: "Austin, TX", remote: false }).reason).toBe(`${SKIP_REASON_PREFIX}2 jobs in Austin, TX for the location (-0.05 fit)`);
    expect(skipPenalty(effects, { title: "Designer", location: "Dallas, TX", remote: false }).delta).toBe(0);
    const state = skipEffectsOf([sig("wrong_location", "A", { location: "Texas" }), sig("wrong_location", "B", { location: "TX" })], {}, NOW);
    expect(state).toMatchObject([{ id: "state:TX" }]);
    expect(skipPenalty(state, { title: "Designer", location: "Dallas, TX", remote: false }).delta).toBe(-0.05);
  });

  it("Missing skills and Other change nothing; old skips and skips before an undo do not count", () => {
    expect(skipEffectsOf([sig("missing_skills", "Frontend Engineer"), sig("missing_skills", "Frontend Engineer"), sig("other", "A"), sig("other", "A")], {}, NOW)).toEqual([]);
    const two = [sig("too_senior", "Staff Engineer", { at: daysAgo(5) }), sig("too_senior", "Staff Engineer", { at: daysAgo(3) })];
    expect(skipEffectsOf(two, {}, NOW)).toHaveLength(1);
    expect(skipEffectsOf([sig("too_senior", "Staff Engineer", { at: daysAgo(120) }), ...two.slice(1)], {}, NOW)).toEqual([]);
    expect(skipEffectsOf(two, { level_above: daysAgo(4).toISOString() }, NOW)).toEqual([]);
    expect(skipEffectsOf([...two, sig("too_senior", "Staff Engineer", { at: daysAgo(1) })], { level_above: daysAgo(4).toISOString() }, NOW)).toMatchObject([{ skips: 2 }]);
  });

  it("caps the total at -0.1, names the effect with the most skips, and the raw fit can be recovered", () => {
    const effects = skipEffectsOf([
      ...["Frontend Engineer", "Frontend Developer", "UI Frontend Engineer"].map((t) => sig("not_my_kind", t, { location: "Austin, TX" })),
      sig("too_senior", "Staff Engineer"), sig("too_senior", "Staff Engineer"),
      sig("wrong_location", "X", { location: "Austin, TX" }), sig("wrong_location", "Y", { location: "Austin, TX" }),
    ], {}, NOW);
    expect(effects.map((e) => e.id)).toEqual(["role:software_engineering.frontend", "city:austin", "level_above"]);
    const p = skipPenalty(effects, { title: "Staff Frontend Engineer", location: "Austin, TX", remote: false });
    expect(p).toEqual({ delta: -0.1, reason: `${SKIP_REASON_PREFIX}3 frontend software engineering jobs as not your kind of role (-0.10 fit)` });
    expect(skipPenaltyOf(["Fits", p.reason!])).toBe(-0.1);
    expect(rawFitOf(0.7, ["Fits", p.reason!])).toBe(0.8);
  });
});

describe("skip feedback in the shortlist", () => {
  let t: TestDb;
  let companyId: string;
  beforeAll(async () => { t = await createTestDb(); companyId = await seedCompany(t.db); });
  afterAll(async () => { await t.close(); });
  beforeEach(() => clearRequirementVectorCache());

  const embedFn = async (texts: string[]) => texts.map((x) => fakeEmbedding(x));
  const opts = { profileEmbedding: fakeEmbedding("software engineer typescript"), now: NOW, embedFn, widen: false } as const;

  async function engineer(db: Db): Promise<string> {
    const userId = await seedUser(db);
    await seedLane(db, userId, { titles: ["Software Engineer"], minFit: 0.3 });
    await seedPoint(db, userId, { title: "Software Engineer", org: "Initech", start: "2021-01", end: null, text: "Built TypeScript services", skills: ["TypeScript"] });
    return userId;
  }

  async function skip(db: Db, userId: string, title: string, seniority: "senior" | "staff", reason: SkipReason) {
    const jobId = await seedJob(db, { companyId, title, spec: baseSpec({ seniority }), closedAt: daysAgo(1) });
    await db.insert(shortlist).values({ userId, jobId, fit: 0.7, status: "dismissed", skipReason: reason, dismissedAt: daysAgo(2) });
  }

  it("lowers the fit of jobs like the ones skipped twice, with a reason; never gates or drops a row; undo restores it", async () => {
    const spec = baseSpec({ skills: [{ name: "TypeScript", level: "working", years: null, required: true }] });
    const senior = await seedJob(t.db, { companyId, title: "Senior Software Engineer", spec: { ...spec, seniority: "senior" }, embedText: "software engineer typescript" });
    const mid = await seedJob(t.db, { companyId, title: "Software Engineer", spec, embedText: "software engineer typescript" });
    const gated = await seedJob(t.db, { companyId, title: "Senior Software Engineer, Federal", spec: { ...spec, seniority: "senior", clearanceRequired: true }, embedText: "software engineer typescript" });

    const control = await engineer(t.db);
    const user = await engineer(t.db);
    await skip(t.db, user, "Senior Software Engineer, Payments", "senior", "too_senior");
    // One skip: nothing changes yet.
    const once = await buildShortlist(t.db, user, opts);
    const base = await buildShortlist(t.db, control, opts);
    const fitOf = (s: typeof base, id: string) => s.items.find((i) => i.jobId === id)!;
    expect(fitOf(once, senior).fit).toBe(fitOf(base, senior).fit);

    await skip(t.db, user, "Staff Software Engineer", "staff", "too_senior");
    expect(await loadSkipEffects(t.db, user, NOW)).toMatchObject([{ id: "level_above", value: "senior", skips: 2 }]);
    const after = await buildShortlist(t.db, user, opts);
    expect(fitOf(after, senior).fit).toBeCloseTo(fitOf(base, senior).fit - 0.05, 3);
    expect(fitOf(after, senior).reasons.find((r) => r.startsWith(SKIP_REASON_PREFIX))).toBe(`${SKIP_REASON_PREFIX}2 jobs at senior level or above as too senior (-0.05 fit)`);
    expect(fitOf(after, mid).fit).toBe(fitOf(base, mid).fit);
    expect(fitOf(after, mid).reasons.some((r) => r.startsWith(SKIP_REASON_PREFIX))).toBe(false);
    // The gate still decides: the clearance job stays out, and the penalty does not change that.
    expect(after.gated.map((g) => g.jobId)).toContain(gated);
    const [row] = await t.db.select().from(shortlist).where(eq(shortlist.jobId, senior)).then((rows) => rows.filter((r) => r.userId === user));
    expect(Number(row!.fit)).toBeCloseTo(fitOf(base, senior).fit - 0.05, 3);

    // The lane minimum sees the raw fit: a minimum between the penalised and the raw fit keeps the row.
    await t.db.update(lanes).set({ minFit: fitOf(base, senior).fit - 0.01 }).where(eq(lanes.userId, user));
    const strict = await buildShortlist(t.db, user, opts);
    expect(strict.items.some((i) => i.jobId === senior)).toBe(true);
    await t.db.update(lanes).set({ minFit: 0.3 }).where(eq(lanes.userId, user));

    // Undo: the effect goes, and the next match restores the fit.
    expect(await clearSkipEffect(t.db, user, "level_above", NOW)).toBe(true);
    expect(await clearSkipEffect(t.db, user, "level_above", NOW)).toBe(false);
    expect(await loadSkipEffects(t.db, user, NOW)).toEqual([]);
    const [p] = await t.db.select({ preferences: profiles.preferences }).from(profiles).where(eq(profiles.userId, user));
    expect(p!.preferences).toMatchObject({ skipFeedback: { cleared: { level_above: NOW.toISOString() } } });
    const undone = await buildShortlist(t.db, user, opts);
    expect(fitOf(undone, senior).fit).toBe(fitOf(base, senior).fit);
    expect(fitOf(undone, senior).reasons.some((r) => r.startsWith(SKIP_REASON_PREFIX))).toBe(false);
  });
});
