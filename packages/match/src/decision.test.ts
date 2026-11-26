import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, eq, profiles, shortlist } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { APPLY_POLICIES, assessJob, decideApplies, readAggressiveness, type JobForDecision } from "./decision.js";
import type { EvidencePoint } from "./profile.js";
import { NOW, baseSpec, hoursAgo, profileOf, seedCompany, seedJob, seedLane, seedPoint, seedUser } from "./test-helpers.js";

const point: EvidencePoint = {
  id: "p1", kind: "role", title: "Software Engineer", org: "Acme", startDate: "2022-01", endDate: null, text: "Built payment APIs in Python",
  skills: ["python"], scope: {}, metrics: {}, embedding: null,
};
const person = profileOf({ points: [point], experienceYears: 4 });
const balanced = APPLY_POLICIES.balanced;
const must = (requirement: string, score: number, weight = 1) => ({ requirement, mustHave: true, score, weight });

const job = (over: Partial<JobForDecision> = {}): JobForDecision => ({
  jobId: "j", title: "Software Engineer", location: null, remote: false, companyId: "c", companyName: "Initrode", postedAt: hoursAgo(10),
  fit: 0.82, fitMap: [must("Python", 0.8), must("APIs", 0.75)], spec: baseSpec({ seniority: "mid" }), heuristicSpec: false, ...over,
});

describe("assessJob", () => {
  it("strong: every must-have evidenced, inside the level band, own function, a posting the model read", () => {
    expect(assessJob(job(), person, balanced, NOW)).toMatchObject({ hardNo: null, group: "strong" });
  });

  it("hard no: a gate, a seniority gap of two levels either way, a central must-have clearly missing", () => {
    expect(assessJob(job({ spec: baseSpec({ citizenshipRequired: true }) }), person, balanced, NOW).hardNo).toMatch(/US citizenship/);
    expect(assessJob(job({ title: "Principal Software Engineer" }), person, balanced, NOW).hardNo).toBe("Two or more levels above your experience");
    expect(assessJob(job({ title: "Software Engineering Intern" }), person, balanced, NOW).hardNo).toBe("Two or more levels below your experience");
    expect(assessJob(job({ fitMap: [must("Python", 0.8), must("Kubernetes", 0.2, 0.9)] }), person, balanced, NOW)).toMatchObject({ group: null, hardNo: "Missing a must-have: Kubernetes" });
  });

  it("worth a shot: most must-haves, a reasonable title, fresh under 48 hours; otherwise a stretch", () => {
    const most = { fitMap: [must("Python", 0.8), must("APIs", 0.8), must("Go", 0.2, 0.3)] };
    expect(assessJob(job(most), person, balanced, NOW).group).toBe("worth_a_shot");
    expect(assessJob(job({ ...most, postedAt: hoursAgo(60) }), person, balanced, NOW)).toMatchObject({ group: "stretch", reasons: ["Posted more than 2 days ago"] });
    expect(assessJob(job({ title: "Staff Software Engineer" }), person, balanced, NOW).group).toBe("worth_a_shot");
    expect(assessJob(job({ title: "Staff Software Engineer", postedAt: hoursAgo(60) }), person, balanced, NOW).group).toBe("stretch");
    // Cautious asks more evidence for worth-a-shot than balanced; wide asks less.
    const half = { fitMap: [must("Python", 0.8), must("Go", 0.2, 0.45)] };
    expect(assessJob(job(half), person, APPLY_POLICIES.wide, NOW).group).toBe("worth_a_shot");
    expect(assessJob(job(half), person, APPLY_POLICIES.cautious, NOW).group).toBe("stretch");
  });

  it("a posting no model read is never strong", () => {
    expect(assessJob(job({ heuristicSpec: true }), person, balanced, NOW).group).toBe("worth_a_shot");
  });
});

describe("readAggressiveness", () => {
  it("reads preferences.nori.aggressiveness and defaults to balanced", () => {
    expect(readAggressiveness({ nori: { aggressiveness: "wide" } })).toBe("wide");
    expect(readAggressiveness({ nori: { aggressiveness: "reckless" } })).toBe("balanced");
    expect(readAggressiveness(null)).toBe("balanced");
  });
});

describe("decideApplies", () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());

  it("sends within the weekly pace, one per company, spread across kinds of jobs; asks, holds and skips the rest", async () => {
    const userId = await seedUser(t.db);
    await t.db.update(profiles).set({ preferences: { nori: { aggressiveness: "cautious" }, excludeCompanies: ["Skipped Co"] } }).where(eq(profiles.userId, userId));
    await seedLane(t.db, userId, { titles: ["Backend Engineer", "Frontend Engineer"], locations: [] });
    await seedPoint(t.db, userId, { title: "Software Engineer", org: "Acme", start: "2022-01", text: "Built payment APIs in Python and React", skills: ["python", "react"] });
    const strongMap = [must("Python", 0.8)];
    const add = async (name: string, title: string, fit: number, fitMap: unknown[], spec = baseSpec({ seniority: "mid" })) => {
      const companyId = await seedCompany(t.db, { name });
      const jobId = await seedJob(t.db, { companyId, title, spec, location: null, postedAt: hoursAgo(5) });
      await t.db.insert(shortlist).values({ userId, jobId, fit, fitMap, reasons: [] });
      return { jobId, companyId };
    };
    const backend = await add("A", "Backend Engineer", 0.9, strongMap);
    const backend2 = await add("B", "Backend Engineer, Payments", 0.88, strongMap);
    const frontend = await add("C", "Frontend Engineer", 0.8, strongMap);
    const stretch = await add("D", "Staff Software Engineer", 0.7, [must("Python", 0.8), must("Go", 0.2, 0.3)]);
    const skipped = await add("Skipped Co", "Backend Engineer", 0.95, strongMap);
    const recent = await add("E", "Backend Engineer", 0.93, strongMap);
    const old = await seedJob(t.db, { companyId: recent.companyId, title: "Platform Engineer", location: null });
    await t.db.insert(applications).values({ userId, jobId: old, canonicalUrl: "https://example.test/old", status: "submitted", createdAt: hoursAgo(24 * 20), approvedAt: hoursAgo(24 * 20) });

    // Cautious: 10 a week; the application 20 days ago is outside the week. Allow 2 sends now.
    const r = await decideApplies(t.db, userId, { now: NOW, maxSends: 2 });
    expect(r).toMatchObject({ aggressiveness: "cautious", weekUsed: 0, weekLeft: 10 });
    const by = Object.fromEntries(r.decisions.map((d) => [d.jobId, d]));
    // The two sends are the best backend job and the frontend job (variety), not the two backend jobs.
    expect(r.decisions.slice(0, 2).map((d) => d.jobId)).toEqual([backend.jobId, frontend.jobId]);
    expect(by[backend2.jobId]).toMatchObject({ action: "later", group: "strong" });
    // Cautious never sends worth-a-shot or stretch jobs on its own.
    expect(by[stretch.jobId]!.action).toBe("ask");
    expect(by[skipped.jobId]).toMatchObject({ action: "skip", reasons: ["A company you skip"] });
    expect(by[recent.jobId]).toMatchObject({ action: "skip", reasons: ["You applied to this company in the last 60 days"] });
  });

  it("decides a job already applied to when asked by id: its own application does not count against its company", async () => {
    const userId = await seedUser(t.db);
    const companyId = await seedCompany(t.db, { name: "Prepared Co" });
    const jobId = await seedJob(t.db, { companyId, title: "Software Engineer", spec: baseSpec({ seniority: "mid" }), location: null, postedAt: hoursAgo(5) });
    await t.db.insert(shortlist).values({ userId, jobId, fit: 0.9, fitMap: [must("Python", 0.8)], reasons: [], status: "applied" });
    await t.db.insert(applications).values({ userId, jobId, canonicalUrl: "https://example.test/prepared", status: "prepared", createdAt: hoursAgo(1) });
    expect((await decideApplies(t.db, userId, { now: NOW })).decisions).toEqual([]);
    expect((await decideApplies(t.db, userId, { now: NOW, jobIds: [jobId] })).decisions).toMatchObject([{ jobId, group: "strong", action: "send" }]);
    // Another job at the same company is still held back by it.
    const other = await seedJob(t.db, { companyId, title: "Software Engineer II", spec: baseSpec({ seniority: "mid" }), location: null, postedAt: hoursAgo(5) });
    await t.db.insert(shortlist).values({ userId, jobId: other, fit: 0.9, fitMap: [must("Python", 0.8)], reasons: [] });
    expect((await decideApplies(t.db, userId, { now: NOW, jobIds: [other] })).decisions).toMatchObject([{ jobId: other, action: "skip", reasons: ["You applied to this company in the last 60 days"] }]);
  });
});
