import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fakeEmbedding, setProvider } from "@norinote/ai";
import { jobSpecs } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { heuristicSpec } from "./heuristic-spec.js";
import { clearRolePoolCache } from "./roles.js";
import { buildShortlist, clearRequirementVectorCache } from "./shortlist.js";
import { NOW, baseSpec, daysAgo, hoursAgo, seedCompany, seedJob, seedLane, seedPoint, seedUser } from "./test-helpers.js";
import { HEURISTIC_SPEC_VERSION } from "./understand.js";
import { WIDEN_MIN_FIT } from "./widen.js";

/**
 * Shortlists for profiles that mirror the matching baseline's worst rows (docs/eval/matching-baseline.md): what must stay
 * out, what must come first, and what widening may add.
 */

let t: TestDb;
let co: string;
beforeAll(async () => {
  t = await createTestDb();
  co = await seedCompany(t.db, { name: "Quality Co" });
});
afterAll(() => t.close());
beforeEach(() => { clearRequirementVectorCache(); clearRolePoolCache(); });
afterEach(() => setProvider(null));

const US_AUTH = { US: { authorized: true, needsSponsorship: false } };

/** Stores a heuristic spec (no model read the posting) for a job seeded without one. */
async function heuristicJob(o: Parameters<typeof seedJob>[1]): Promise<string> {
  const id = await seedJob(t.db, o);
  const spec = heuristicSpec({ title: o.title ?? "", descriptionText: o.description ?? "", location: o.location ?? null, remote: o.remote ?? false });
  await t.db.insert(jobSpecs).values({ jobId: id, version: HEURISTIC_SPEC_VERSION, spec, model: "heuristic" });
  return id;
}

describe("location: the Europe-remote contractor", () => {
  it("is gated for a US-based backend engineer instead of ranking first", async () => {
    const userId = await seedUser(t.db, { location: "Austin, TX", workAuth: US_AUTH });
    await seedLane(t.db, userId, { titles: ["Backend Engineer", "Software Engineer"], locations: ["Austin, TX", "San Francisco, CA", "New York, NY"], remote: true, minFit: 0.6 });
    await seedPoint(t.db, userId, { title: "Backend Engineer", start: "2021-01", skills: ["Python", "PostgreSQL"], text: "python services on postgresql" });
    const spec = baseSpec({ mustHaves: ["Python", "PostgreSQL"] });
    const text = "software engineer python postgresql backend";
    const contractor = await seedJob(t.db, { companyId: co, title: "Business Title IT Dev Senior (Software Engineer) - Contractor", location: "Europe Remote - Parking", remote: true, spec, embedText: text });
    const philippines = await seedJob(t.db, { companyId: co, title: "Backend Engineer", location: "Remote - Philippines", remote: true, spec, embedText: text });
    const us = await seedJob(t.db, { companyId: co, title: "Backend Engineer", location: "Remote (United States)", remote: true, spec, embedText: text });
    const nyc = await seedJob(t.db, { companyId: co, title: "Software Engineer, Backend", location: "NYC - 1211 Ave of the Americas", spec, embedText: text });

    const stats = await buildShortlist(t.db, userId, { profileEmbedding: fakeEmbedding(text), now: NOW, widen: false });
    const ids = stats.items.map((i) => i.jobId);
    expect(ids).not.toContain(contractor);
    expect(ids).not.toContain(philippines);
    expect(stats.gated.map((g) => g.jobId)).toEqual(expect.arrayContaining([contractor, philippines]));
    expect(new Set(ids)).toEqual(new Set([us, nyc]));
    expect(stats.laneMatches).toBe(2);
  });
});

describe("ordering by fit, confidence and recency", () => {
  it("ranks well-specified jobs first, keeps the empty Workday graphic designer out and the bare listing last", async () => {
    const userId = await seedUser(t.db, { location: "New York, NY", workAuth: US_AUTH });
    await seedLane(t.db, userId, { titles: ["Product Designer", "UX Designer"], locations: ["New York, NY"], remote: true, minFit: 0.6 });
    await seedPoint(t.db, userId, { title: "Senior Product Designer", start: "2020-01", skills: ["Figma", "Accessibility"], text: "product design for a fintech app", scope: { teamSize: 5 } });
    await seedPoint(t.db, userId, { title: "Product Designer", start: "2017-01", end: "2019-12", skills: ["Figma"], text: "designed onboarding flows" });
    const text = "product designer figma accessibility";
    const spec = baseSpec({ mustHaves: ["Figma", "Accessibility"], seniority: "senior", roleFamily: "product design" });
    const best = await seedJob(t.db, { companyId: co, title: "Senior Product Designer", location: "New York, NY", spec, embedText: text, postedAt: hoursAgo(60) });
    const fresh = await seedJob(t.db, { companyId: co, title: "Product Designer, Payments", location: "New York, NY", spec, embedText: text, postedAt: hoursAgo(3) });
    // No description at all: a heuristic spec from the title only. The 0.99 graphic designer of the baseline came in through
    // the design role pool when the shortlist widened.
    const graphic = await heuristicJob({ companyId: co, title: "Senior Graphic Designer, Video Content", location: "Remote", remote: true, description: "", embedText: text });
    const bare = await heuristicJob({ companyId: co, title: "Senior Product Designer", location: "New York, NY", description: "", embedText: text });

    const stats = await buildShortlist(t.db, userId, { profileEmbedding: fakeEmbedding(text), now: NOW });
    const ids = stats.items.map((i) => i.jobId);
    expect(ids).not.toContain(graphic);
    expect(stats.widened.map((w) => w.jobId)).not.toContain(graphic);
    expect(ids.slice(0, 2).sort()).toEqual([best, fresh].sort());
    const byId = new Map(stats.items.map((i) => [i.jobId, i]));
    if (byId.has(bare)) {
      // It may appear, but only after the well-specified jobs, with a confidence penalty and a capped fit.
      expect(ids.indexOf(bare)).toBe(stats.laneMatches - 1);
      expect(byId.get(bare)!.confidence).toBeLessThan(1);
      expect(byId.get(bare)!.fit).toBeLessThanOrEqual(0.65);
    }
    for (const i of stats.items) expect(i.fit).toBeLessThan(0.97);
    // Same fit, fresher posting first (the recency bonus is small but breaks ties).
    expect(byId.get(fresh)!.rankScore!).toBeGreaterThan(byId.get(best)!.rankScore! - 0.05);
  });
});

describe("seniority: the new grad", () => {
  it("does not see senior roles, and does see new-grad roles", async () => {
    const userId = await seedUser(t.db, { location: "New York, NY", workAuth: US_AUTH });
    await seedLane(t.db, userId, { titles: ["Software Engineer", "Backend Engineer"], locations: ["New York, NY"], remote: true, minFit: 0.6 });
    await seedPoint(t.db, userId, { title: "Software Engineering Intern", start: "2025-06", end: "2025-08", skills: ["Python", "Distributed Systems"], text: "built a python service" });
    await seedPoint(t.db, userId, { kind: "education", title: "B.S. Computer Science", start: "2022-09", end: "2026-05", skills: ["Python"] });
    const text = "software engineer python distributed systems";
    const must = { mustHaves: ["Python", "Distributed Systems"] };
    const senior = await seedJob(t.db, { companyId: co, title: "Senior Software Engineer", location: "New York, NY", spec: baseSpec({ ...must, seniority: "senior", yearsMin: 6 }), embedText: text });
    const staff = await seedJob(t.db, { companyId: co, title: "Staff Backend Engineer", location: "New York, NY", spec: baseSpec({ ...must, seniority: "staff" }), embedText: text });
    const newGrad = await seedJob(t.db, { companyId: co, title: "Software Engineer, New Grad", location: "New York, NY", spec: baseSpec({ ...must, seniority: "entry" }), embedText: text });
    const plain = await seedJob(t.db, { companyId: co, title: "Backend Engineer", location: "New York, NY", spec: baseSpec({ ...must, seniority: "mid", yearsMin: 1 }), embedText: text });

    const stats = await buildShortlist(t.db, userId, { profileEmbedding: fakeEmbedding(text), now: NOW, widen: false });
    const ids = stats.items.map((i) => i.jobId);
    expect(ids).not.toContain(senior);
    expect(ids).not.toContain(staff);
    expect(ids[0]).toBe(newGrad);
    expect(ids).toContain(plain);
  });
});

describe("widening", () => {
  it("never re-admits a lane job that failed the lane minimum, and keeps only widened jobs above the floor", async () => {
    const userId = await seedUser(t.db, { location: "Philadelphia, PA", workAuth: US_AUTH });
    await seedLane(t.db, userId, { titles: ["Frontend Engineer"], locations: ["Philadelphia, PA"], remote: false, minFit: 0.6 });
    // The bootcamp career switcher: eight years of teaching, React projects.
    await seedPoint(t.db, userId, { title: "Mathematics Teacher", start: "2018-08", end: "2026-06", skills: ["Python"], text: "taught algebra and statistics" });
    await seedPoint(t.db, userId, { kind: "project", title: "Plantwise", start: "2026-01", skills: ["React", "TypeScript", "Node.js"], text: "react app with auth" });
    const text = "frontend engineer react typescript";
    const react = baseSpec({ mustHaves: ["React", "TypeScript"], seniority: "entry" });
    const lane = await seedJob(t.db, { companyId: co, title: "Frontend Engineer", location: "Philadelphia, PA", spec: react, embedText: text });
    // Fits the lane by title and place, but asks for Angular and Go: below the lane minimum.
    const weakLane = await seedJob(t.db, { companyId: co, title: "Frontend Engineer, Platform", location: "Philadelphia, PA", spec: baseSpec({ mustHaves: ["Angular", "Kubernetes"], seniority: "mid" }), embedText: text });
    // Adjacent titles: a plausible junior web role, a senior role the user cannot do yet, an RPA role (another trade).
    const web = await seedJob(t.db, { companyId: co, title: "Web Developer", location: "Philadelphia, PA", spec: react, embedText: text });
    const seniorSwe = await seedJob(t.db, { companyId: co, title: "Senior Software Engineer", location: "Philadelphia, PA", spec: baseSpec({ mustHaves: ["React", "TypeScript"], seniority: "senior", yearsMin: 5 }), embedText: text });
    const rpa = await seedJob(t.db, { companyId: co, title: "Software Engineer, RPA (UiPath)", location: "Philadelphia, PA", spec: baseSpec({ mustHaves: ["UiPath"], seniority: "mid" }), embedText: text });
    // Older than 72 hours and weak: no step ever widens age, so it never comes in.
    const oldWeak = await seedJob(t.db, { companyId: co, title: "Frontend Engineer, Legacy", location: "Philadelphia, PA", spec: baseSpec({ mustHaves: ["Angular", "Kubernetes"] }), embedText: text, postedAt: daysAgo(10), firstSeenAt: daysAgo(10) });

    const stats = await buildShortlist(t.db, userId, { profileEmbedding: fakeEmbedding(text), now: NOW });
    const ids = stats.items.map((i) => i.jobId);
    expect(stats.laneMatches).toBe(1);
    expect(ids[0]).toBe(lane);
    expect(stats.belowMinFit).toBeGreaterThanOrEqual(1);
    expect(ids).not.toContain(weakLane);
    expect(stats.widened.map((w) => w.jobId)).not.toContain(weakLane);
    expect(ids).toContain(web);
    for (const bad of [seniorSwe, rpa, oldWeak]) expect(ids).not.toContain(bad);
    for (const i of stats.items.filter((x) => x.widenedBy)) expect(i.fit).toBeGreaterThanOrEqual(WIDEN_MIN_FIT);
    // Lane matches come before widened rows.
    expect(stats.items.findIndex((i) => i.widenedBy)).toBe(1);
  });

  it("orders widened rows by rank, not by the ladder step that found them", async () => {
    const userId = await seedUser(t.db, { location: "San Francisco, CA", workAuth: US_AUTH });
    await seedLane(t.db, userId, { titles: ["Frontend Engineer"], locations: ["San Francisco, CA"], remote: false, minFit: 0.6 });
    await seedPoint(t.db, userId, { title: "Frontend Engineer", start: "2020-01", skills: ["React", "TypeScript"], text: "react apps" });
    const text = "frontend engineer react typescript";
    const spec = baseSpec({ mustHaves: ["React", "TypeScript"] });
    // Adjacent step: a general software role (a little further from frontend). Remote step: a frontend role.
    const adjacent = await seedJob(t.db, { companyId: co, title: "Software Engineer, Growth", location: "San Francisco, CA", spec, embedText: text });
    const remote = await seedJob(t.db, { companyId: co, title: "Frontend Engineer, Checkout", location: "Remote - US", remote: true, spec, embedText: text });

    const stats = await buildShortlist(t.db, userId, { profileEmbedding: fakeEmbedding(text), now: NOW });
    expect(stats.widened.map((w) => w.jobId)).toEqual([adjacent, remote]);
    const widenedOrder = stats.items.filter((i) => i.widenedBy).map((i) => i.jobId);
    expect(widenedOrder).toEqual([remote, adjacent]);
  });
});
