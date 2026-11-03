import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fakeEmbedding } from "@norinote/ai";
import { applications, eq, lanes, outcomes, profiles, type Db } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import {
  OUTCOME_LEARNING, applyOutcomeLearning, learnFromOutcomes, loadOutcomeLearning, outcomeNudge, type OutcomeLearning,
} from "./outcome-learning.js";
import { OUTCOME_REASON_PREFIX, outcomeNudgeOf, type OutcomeHistoryRow } from "./outcomes.js";
import { buildShortlist, clearRequirementVectorCache } from "./shortlist.js";
import { NOW, baseSpec, daysAgo, seedCompany, seedJob, seedLane, seedPoint, seedUser } from "./test-helpers.js";

type Got = "reply" | "interview" | "rejection" | "offer" | "silence";
const row = (roleFamily: string, got: Got, days = 40, more: Partial<OutcomeHistoryRow> = {}): OutcomeHistoryRow => ({
  applicationId: "a", userId: "u", jobId: "j", title: "t", companyName: "c", system: "greenhouse", roleFamily, seniority: "unknown", boardSize: "unknown",
  submittedAt: daysAgo(days), confirmedAt: null, fit: 0.7, band: "0.6-0.8", tailoring: "v1",
  outcomes: got === "silence" ? [] : [{ kind: got, at: daysAgo(days - 5) }], ...more,
});
const many = (n: number, roleFamily: string, got: Got, days = 40) => Array.from({ length: n }, () => row(roleFamily, got, days));

describe("learnFromOutcomes", () => {
  it("learns nothing before 10 resolved applications (pending ones do not count)", () => {
    const history = [...many(5, "data_analysis", "reply"), ...many(4, "sales", "silence"), ...many(6, "sales", "silence", 5)];
    const m = learnFromOutcomes(history, NOW);
    expect(m).toMatchObject({ resolved: 9, active: false, nudges: [] });
    expect(outcomeNudge(m, { roleFamily: "data_analysis", seniority: "x", system: "greenhouse", boardSize: "unknown" })).toEqual({ delta: 0, reason: null });
  });

  it("nudges toward families with replies and away from repeated silence and rejections, capped per dimension", () => {
    const history = [...many(6, "data_analysis", "interview"), ...many(3, "sales", "silence"), ...many(3, "sales", "rejection"), ...many(2, "design", "reply")];
    const m = learnFromOutcomes(history, NOW);
    expect(m).toMatchObject({ resolved: 14, positive: 8, active: true });
    const by = new Map(m.nudges.map((n) => [`${n.dimension}:${n.value}`, n]));
    expect(by.get("roleFamily:data_analysis")!.delta).toBeGreaterThan(0);
    expect(by.get("roleFamily:sales")!.delta).toBeLessThan(0);
    // Two applications are too few for a group of their own.
    expect(by.has("roleFamily:design")).toBe(false);
    // Every application was on greenhouse: that group is the baseline and says nothing.
    expect(by.has("system:greenhouse")).toBe(false);
    for (const n of m.nudges) expect(Math.abs(n.delta)).toBeLessThanOrEqual(OUTCOME_LEARNING.maxPerDimension);

    const up = outcomeNudge(m, { roleFamily: "data_analysis", seniority: "unknown", system: "greenhouse", boardSize: "unknown" });
    expect(up.delta).toBe(0.02);
    expect(up.reason).toBe(`${OUTCOME_REASON_PREFIX}6 of 6 data analysis applications led to a reply or interview, against 8 of 14 overall (+0.02 fit)`);
    expect(outcomeNudgeOf([up.reason!])).toBe(0.02);
    const down = outcomeNudge(m, { roleFamily: "sales", seniority: "unknown", system: "greenhouse", boardSize: "unknown" });
    expect(down.delta).toBe(-0.02);
    expect(down.reason).toContain("0 of 6 sales applications");
  });

  it("caps the total at 0.05 however many signals agree", () => {
    const m: OutcomeLearning = {
      version: 1, computedAt: NOW.toISOString(), resolved: 40, positive: 20, active: true,
      nudges: [
        { dimension: "roleFamily", value: "data_analysis", positive: 9, resolved: 10, delta: 0.02 },
        { dimension: "seniority", value: "entry", positive: 9, resolved: 10, delta: 0.02 },
        { dimension: "system", value: "lever", positive: 9, resolved: 10, delta: 0.02 },
        { dimension: "boardSize", value: "small", positive: 9, resolved: 10, delta: 0.02 },
      ],
    };
    const r = outcomeNudge(m, { roleFamily: "data_analysis", seniority: "entry", system: "lever", boardSize: "small" });
    expect(r.delta).toBe(OUTCOME_LEARNING.maxTotal);
    expect(r.reason).toMatch(/\(\+0\.05 fit\)$/);
    const neg = outcomeNudge({ ...m, nudges: m.nudges.map((n) => ({ ...n, delta: -n.delta })) }, { roleFamily: "data_analysis", seniority: "entry", system: "lever", boardSize: "small" });
    expect(neg.delta).toBe(-0.05);
  });

  it("decays with age and forgets applications older than a year", () => {
    const pattern = (days: number) => [
      ...Array.from({ length: 6 }, () => row("data_analysis", "reply", days)),
      ...Array.from({ length: 3 }, () => row("data_analysis", "silence", days)),
      ...Array.from({ length: 6 }, () => row("sales", "silence", days)),
      // Recent, mixed and neutral: the baseline the old signal is weighed against.
      ...Array.from({ length: 4 }, () => row("product", "reply", 35)), ...Array.from({ length: 4 }, () => row("product", "silence", 35)),
    ];
    const delta = (m: OutcomeLearning, v: string) => m.nudges.find((n) => n.value === v)?.delta ?? 0;
    const recent = learnFromOutcomes(pattern(40), NOW);
    const old = learnFromOutcomes(pattern(300), NOW);
    expect(Math.abs(delta(old, "sales"))).toBeLessThan(Math.abs(delta(recent, "sales")));
    const gone = learnFromOutcomes(pattern(400), NOW);
    expect(gone.resolved).toBe(8);
    expect(gone.active).toBe(false);
  });

  it("learns nothing when there is no contrast (no reply at all yet)", () => {
    const m = learnFromOutcomes([...many(6, "data_analysis", "silence"), ...many(6, "sales", "rejection")], NOW);
    expect(m.active).toBe(true);
    expect(m.nudges).toEqual([]);
  });
});

describe("the shortlist hook", () => {
  let t: TestDb;
  let companyId: string;
  beforeAll(async () => {
    t = await createTestDb();
    companyId = await seedCompany(t.db, { name: "Acme" });
  });
  afterAll(() => t.close());
  beforeEach(() => clearRequirementVectorCache());

  const embedFn = async (texts: string[]) => texts.map((x) => fakeEmbedding(x));

  /** A data analyst who heard back from data roles and never from sales roles. */
  async function analyst(db: Db, withHistory: boolean): Promise<string> {
    const userId = await seedUser(db);
    await seedLane(db, userId, { name: "Data", titles: ["Data Analyst"], locations: ["San Francisco, CA"], minFit: 0.3 });
    await seedPoint(db, userId, { title: "Data Analyst", org: "Initech", start: "2021-01", end: null, text: "Built SQL dashboards and reports", skills: ["SQL", "Tableau"] });
    if (!withHistory) return userId;
    const closedCo = await seedCompany(db, { name: "Closed Co" });
    const add = async (title: string, got: Got, days: number) => {
      const jobId = await seedJob(db, { companyId: closedCo, title, closedAt: daysAgo(1) });
      const [a] = await db.insert(applications).values({ userId, jobId, status: "submitted", submittedAt: daysAgo(days) }).returning();
      if (got !== "silence") await db.insert(outcomes).values({ applicationId: a!.id, kind: got, at: daysAgo(days - 3), source: "manual" });
    };
    for (let i = 0; i < 6; i++) await add("Data Analyst", i < 5 ? "interview" : "silence", 40 + i);
    for (let i = 0; i < 6; i++) await add("Sales Development Representative", i < 3 ? "rejection" : "silence", 40 + i);
    return userId;
  }

  it("moves fit by the learned amount with a factual reason, and leaves gates and the lane minimum to the raw fit", async () => {
    const spec = baseSpec({ roleFamily: "data analysis", skills: [{ name: "SQL", level: "working", years: null, required: true }] });
    const open = await seedJob(t.db, { companyId, title: "Data Analyst", spec, embedText: "data analyst sql" });
    const gated = await seedJob(t.db, { companyId, title: "Data Analyst, Federal", spec: { ...spec, clearanceRequired: true, citizenshipRequired: true }, embedText: "data analyst sql" });
    const opts = { profileEmbedding: fakeEmbedding("data analyst sql"), now: NOW, embedFn, widen: false } as const;

    const control = await analyst(t.db, false);
    const learner = await analyst(t.db, true);
    const base = await buildShortlist(t.db, control, opts);
    const nudged = await buildShortlist(t.db, learner, opts);

    const baseItem = base.items.find((i) => i.jobId === open)!;
    const item = nudged.items.find((i) => i.jobId === open)!;
    expect(item.fit).toBeCloseTo(baseItem.fit + 0.02, 3);
    expect(item.reasons.find((r) => r.startsWith(OUTCOME_REASON_PREFIX))).toMatch(/5 of 6 data analysis applications .* \(\+0\.02 fit\)$/);
    expect(baseItem.reasons.some((r) => r.startsWith(OUTCOME_REASON_PREFIX))).toBe(false);
    // Gates are untouched: the clearance job stays out for both.
    expect(base.gated.map((g) => g.jobId)).toContain(gated);
    expect(nudged.gated.map((g) => g.jobId)).toContain(gated);
    expect(nudged.items.some((i) => i.jobId === gated)).toBe(false);

    // The model was stored on the profile, next to the other preferences.
    const [p] = await t.db.select({ preferences: profiles.preferences }).from(profiles).where(eq(profiles.userId, learner));
    expect((p!.preferences as { outcomeLearning: OutcomeLearning }).outcomeLearning).toMatchObject({ active: true, resolved: 12 });

    // A lane minimum just above the raw fit keeps the job out, although the nudge would lift it over.
    await t.db.update(lanes).set({ minFit: baseItem.fit + 0.01 }).where(eq(lanes.userId, learner));
    const strict = await buildShortlist(t.db, learner, opts);
    expect(strict.items.some((i) => i.jobId === open)).toBe(false);
  });

  it("does nothing for a user without enough history, and never throws", async () => {
    const userId = await analyst(t.db, false);
    const items = [{ jobId: "00000000-0000-0000-0000-000000000000", title: "Data Analyst", fit: 0.7, reasons: ["r"], rankScore: 0.7, confidence: 1 }];
    await applyOutcomeLearning(t.db, userId, items, () => null, NOW);
    expect(items[0]).toMatchObject({ fit: 0.7, reasons: ["r"], rankScore: 0.7 });
    expect((await loadOutcomeLearning(t.db, userId, NOW)).active).toBe(false);
    await applyOutcomeLearning(t.db, "not-a-uuid", items, () => null, NOW);
    expect(items[0]!.fit).toBe(0.7);
  });
});
