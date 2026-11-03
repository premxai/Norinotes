import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fakeEmbedding } from "@norinote/ai";
import { jobEmbeddings, jobSpecs, jobs } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { familyYears, statedYearsMin, titleAlignment, titlePairScore } from "./alignment.js";
import { scoreFit } from "./fit.js";
import { checkGates } from "./gates.js";
import { yearsFromText } from "./heuristic-spec.js";
import type { EvidencePoint } from "./profile.js";
import { clearRolePoolCache, roleFamilyOf } from "./roles.js";
import { buildShortlist, clearRequirementVectorCache } from "./shortlist.js";
import { NEUTRAL_DESCRIPTION, NOW, baseSpec, daysAgo, profileOf, seedCompany, seedJob, seedLane, seedPoint, seedUser } from "./test-helpers.js";
import { SPEC_VERSION } from "./understand.js";

/**
 * Regressions from evaluation run 2 (docs/eval/matching-run2.md): the years gate rejected most jobs for early-career and
 * data profiles, nursing had no family, and big profiles got short shortlists.
 */

let n = 0;
const pt = (kind: string, title: string, startDate: string, endDate: string | null, skills: string[] = [], text = ""): EvidencePoint => ({
  id: `x${n++}`, kind, title, org: "Org", startDate, endDate, text, skills, scope: {}, metrics: {}, embedding: null,
});

describe("years: a soft penalty, a gate only for large gaps", () => {
  const newGrad = profileOf({
    location: "New York, NY", experienceYears: 0.3,
    lanes: [{ id: "l", name: "SWE", titles: ["Software Engineer"], locations: ["New York, NY"], remote: true, minFit: 0.6, enabled: true }],
    points: [
      pt("role", "Software Engineering Intern", "2025-06", "2025-08", ["python"]),
      pt("project", "Transit Delay Tracker", "2025-09", "2026-04", ["react", "postgresql"]),
      pt("education", "B.S. Computer Science", "2022-09", "2026-05", ["python"]),
    ],
  });
  const job = (title: string) => ({ title, location: "New York, NY", remote: false });

  it("lets a new grad through '2+ years' and '3+ years' software roles (the 372 run-2 rejections), not senior titles", () => {
    expect(checkGates(baseSpec({ yearsMin: 2 }), newGrad, job("Software Engineer"), { now: NOW }).ok).toBe(true);
    expect(checkGates(baseSpec({ yearsMin: 3 }), newGrad, job("Software Engineer, Product"), { now: NOW }).ok).toBe(true);
    expect(checkGates(baseSpec({ seniority: "senior" }), newGrad, job("Software Engineer"), { now: NOW }).ok).toBe(true);
    expect(checkGates(baseSpec({ yearsMin: 5 }), newGrad, job("Software Engineer"), { now: NOW }).ok).toBe(false);
    expect(checkGates(baseSpec(), newGrad, job("Senior Software Engineer"), { now: NOW }).ok).toBe(false);
    expect(checkGates(baseSpec(), newGrad, job("Staff Engineer"), { now: NOW }).ok).toBe(false);
  });

  it("still marks a stretch down softly in the fit", () => {
    const pts = newGrad.points;
    const two = scoreFit({ spec: baseSpec({ mustHaves: ["Python"], yearsMin: 3 }), points: pts, now: NOW, jobTitle: "Software Engineer", similarity: 0.4 });
    const none = scoreFit({ spec: baseSpec({ mustHaves: ["Python"], seniority: "entry" }), points: pts, now: NOW, jobTitle: "Software Engineer", similarity: 0.4 });
    expect(two.fit).toBeLessThan(none.fit);
    expect(two.fit).toBeGreaterThan(none.fit * 0.6);
  });

  it("counts internships, and projects at part weight, for early-career people only", () => {
    // 3 months of internship plus half of 8 months of project work.
    expect(familyYears(newGrad.points, "Software Engineer", NOW)).toBeCloseTo(0.6, 1);
    const veteran = [pt("role", "Backend Engineer", "2018-01", null), pt("project", "Side project", "2024-01", "2025-01", ["go"])];
    expect(familyYears(veteran, "Software Engineer", NOW)).toBeCloseTo(8.8, 0);
    // Projects do not count toward unrelated functions.
    expect(familyYears(newGrad.points, "Account Executive", NOW)).toBe(0);
  });

  it("counts ML engineer, data scientist, data analyst and research scientist roles toward each other at a high weight", () => {
    const ds = [
      pt("role", "Senior Data Scientist", "2022-01", null), pt("role", "Machine Learning Engineer", "2020-01", "2021-12"),
      pt("role", "Data Analyst", "2019-01", "2019-12"), pt("role", "Research Scientist", "2017-01", "2018-12"),
    ];
    const total = 9.8;
    for (const title of ["Senior Machine Learning Engineer", "Staff Data Scientist", "Applied Scientist", "Senior Data Analyst"]) {
      expect(familyYears(ds, title, NOW)!).toBeGreaterThan(total * 0.85);
    }
  });

  it("never gates on years the posting only prefers", () => {
    const preferred = baseSpec({ yearsMin: 5, mustHaves: ["Python"], niceToHaves: ["5+ years of industry experience"] });
    const inline = baseSpec({ yearsMin: 5, mustHaves: ["5+ years of experience preferred"] });
    const required = baseSpec({ yearsMin: 5, mustHaves: ["5+ years of experience with Python"] });
    expect(statedYearsMin(preferred)).toBeNull();
    expect(statedYearsMin(inline)).toBeNull();
    expect(statedYearsMin(required)).toBe(5);
    expect(checkGates(preferred, newGrad, job("Software Engineer"), { now: NOW }).ok).toBe(true);
    expect(checkGates(required, newGrad, job("Software Engineer"), { now: NOW }).ok).toBe(false);
    expect(yearsFromText("Requirements: Python. 5+ years of experience preferred.")).toBeNull();
    expect(yearsFromText("Requirements: 3+ years of experience with Python. 7+ years preferred.")).toBe(3);
  });
});

describe("families: healthcare, education and unknown titles", () => {
  it("classifies nursing as healthcare and keeps nursing specialties apart", () => {
    expect(roleFamilyOf("Registered Nurse | Telemetry")).toMatchObject({ family: "healthcare", specialty: "nursing" });
    expect(roleFamilyOf("Nursing Assistant (CNA)")).toMatchObject({ family: "healthcare", specialty: "care_support" });
    const nurse = { laneTitles: ["Registered Nurse", "Telemetry Nurse"], roleTitles: ["Registered Nurse, Telemetry Unit (Charge Nurse)"] };
    expect(titleAlignment("Registered Nurse | Cardiac Intensive Care Unit", nurse)).toBe(1);
    expect(titleAlignment("Staff Nurse - Med Surg", nurse)).toBeGreaterThanOrEqual(0.9);
    expect(titleAlignment("Pharmacist", nurse)).toBeLessThanOrEqual(0.3);
    expect(titleAlignment("Software Engineer", nurse)).toBe(0.1);
  });

  it("applies no different-family penalty when a family is unknown, and falls back to title words", () => {
    expect(roleFamilyOf("Lighthouse Keeper").family).toBe("unknown");
    expect(titlePairScore("Lighthouse Keeper", "Senior Lighthouse Keeper")).toBe(1);
    expect(titlePairScore("Lighthouse Keeper", "Lighthouse Maintenance Lead")).toBeGreaterThan(0.6);
    expect(titlePairScore("Lighthouse Keeper", "Barista")).toBe(0.5);
    expect(titlePairScore("Software Engineer", "Barista")).toBe(0.5);
    // A known job outside the families is still a different function.
    expect(titlePairScore("Software Engineer", "Mechanical Engineer")).toBe(0.1);
  });

  it("counts a teacher's years toward education roles", () => {
    expect(familyYears([pt("role", "Mathematics Teacher", "2018-08", "2026-06")], "Curriculum Specialist", NOW)).toBeGreaterThan(7);
  });
});

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());
beforeEach(() => { clearRequirementVectorCache(); clearRolePoolCache(); });

describe("shortlists", () => {
  it("gives the registered nurse her nursing jobs (run 2: 16 lane-fit, all below the minimum)", async () => {
    const co = await seedCompany(t.db, { name: "CentraCare" });
    const userId = await seedUser(t.db, { location: "Saint Cloud, MN", workAuth: { US: { citizen: true, authorized: true } } });
    await seedLane(t.db, userId, { titles: ["Registered Nurse", "Telemetry Nurse"], locations: ["Saint Cloud, MN", "Minneapolis, MN"], remote: false, minFit: 0.6 });
    await seedPoint(t.db, userId, {
      title: "Registered Nurse, Telemetry Unit (Charge Nurse)", org: "Mississippi Valley Medical Center", start: "2023-03",
      text: "Care for 4 to 5 patients per shift on a 32-bed cardiac telemetry unit; interpret rhythms; charge nurse on night shifts.", skills: ["Epic", "Telemetry"],
    });
    await seedPoint(t.db, userId, { title: "Registered Nurse, Medical-Surgical Unit", org: "Lakeshore Regional Hospital", start: "2020-06", end: "2023-02", text: "Post-operative adult patients, wound care, IV therapy, discharge teaching." });
    await seedPoint(t.db, userId, { kind: "achievement", title: "Licenses and certifications", text: "Registered Nurse, Minnesota RN license; BLS; ACLS; PALS; Telemetry certification (CMC).", skills: ["BLS", "ACLS", "PALS"] });
    const spec = baseSpec({
      mustHaves: ["Current Minnesota RN license", "BLS certification", "ACLS certification"], niceToHaves: ["Telemetry experience"],
      roleFamily: "nursing", seniority: "mid",
    });
    const units = ["Telemetry", "Medical Unit 1", "Orthopedics", "Float Pool", "Cardiac Intensive Care Unit", "Emergency Trauma Center"];
    for (const u of units) await seedJob(t.db, { companyId: co, title: `Registered Nurse | ${u}`, location: "Saint Cloud, MN, United States", spec, embedText: `registered nurse ${u}` });

    const stats = await buildShortlist(t.db, userId, { profileEmbedding: fakeEmbedding("registered nurse telemetry"), now: NOW });
    expect(stats.belowMinFit).toBe(0);
    expect(stats.laneMatches).toBe(units.length);
    for (const i of stats.items) expect(i.fit).toBeGreaterThanOrEqual(0.6);
  });

  it("fills 20 rows from a 320-job lane for a new grad, past a first page of senior roles", async () => {
    const co = await seedCompany(t.db, { name: "BigCo" });
    const userId = await seedUser(t.db, { location: "New York, NY", workAuth: { US: { authorized: true, needsSponsorship: false } } });
    await seedLane(t.db, userId, { titles: ["Software Engineer"], locations: ["New York, NY"], remote: true, minFit: 0.6 });
    await seedPoint(t.db, userId, { title: "Software Engineering Intern", start: "2025-06", end: "2025-08", skills: ["Python", "Distributed Systems"], text: "python services" });
    await seedPoint(t.db, userId, { kind: "project", title: "Distributed cache", start: "2025-09", end: "2026-04", skills: ["Go", "Distributed Systems"] });
    const must = ["Python", "Distributed Systems"];
    const profileText = "software engineer python distributed systems";
    const rows = [
      // The nearest 260: senior and staff roles the gates must reject.
      ...Array.from({ length: 260 }, (_, i) => ({ title: `${i % 2 ? "Staff" : "Senior"} Software Engineer, Team ${i}`, spec: baseSpec({ mustHaves: must, seniority: "senior", yearsMin: 6 }), text: profileText })),
      // Further away: 60 plausible entry and junior roles.
      ...Array.from({ length: 60 }, (_, i) => ({ title: `Software Engineer, Team ${i}`, spec: baseSpec({ mustHaves: must, seniority: i % 3 ? "entry" : "mid", yearsMin: i % 3 ? null : 2 }), text: "software engineer python services" })),
    ];
    const inserted = await t.db.insert(jobs).values(rows.map((r, i) => ({
      companyId: co, atsType: "greenhouse" as const, externalId: `big-${i}`, title: r.title, location: "New York, NY", remote: false,
      descriptionText: NEUTRAL_DESCRIPTION, applyUrl: `https://example.test/big/${i}`, postedAt: daysAgo(3), firstSeenAt: daysAgo(3), dedupeKey: `big-${i}`,
    }))).returning({ id: jobs.id });
    const vectors = new Map<string, number[]>();
    const vec = (s: string) => { if (!vectors.has(s)) vectors.set(s, fakeEmbedding(s)); return vectors.get(s)!; };
    await t.db.insert(jobSpecs).values(inserted.map((j, i) => ({ jobId: j.id, version: SPEC_VERSION, spec: rows[i]!.spec, model: "test" })));
    await t.db.insert(jobEmbeddings).values(inserted.map((j, i) => ({ jobId: j.id, embedding: vec(rows[i]!.text), model: "test" })));

    const stats = await buildShortlist(t.db, userId, { profileEmbedding: fakeEmbedding(profileText), now: NOW });
    expect(stats.items).toHaveLength(20);
    expect(stats.laneMatches).toBe(20);
    expect(stats.widened).toEqual([]);
    const titleOf = new Map(inserted.map((j, i) => [j.id, rows[i]!.title]));
    for (const i of stats.items) {
      expect(titleOf.get(i.jobId)).toMatch(/^Software Engineer, Team/);
      expect(i.fit).toBeGreaterThanOrEqual(0.6);
    }
  });
});
