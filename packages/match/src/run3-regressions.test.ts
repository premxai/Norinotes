import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fakeEmbedding } from "@norinote/ai";
import { eq, profiles } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { widenedTooFar } from "./alignment.js";
import { RESUME_POINT_ID, buildRequirements, scoreFit } from "./fit.js";
import type { EvidencePoint } from "./profile.js";
import { clearRolePoolCache } from "./roles.js";
import { buildShortlist, clearRequirementVectorCache } from "./shortlist.js";
import { NOW, baseSpec, seedCompany, seedJob, seedLane, seedPoint, seedUser } from "./test-helpers.js";

/**
 * Regressions from evaluation run 3 (docs/eval/matching-run3.md). The nurse fixtures are the real specs of three of her
 * sixteen lane jobs (gpt-4.1-mini output in the eval index), reduced to the fields matching reads, and the career points
 * the resume parser produced: the licences (Minnesota RN, BLS, ACLS) never became points, they are only in the resume.
 */

const NURSE_RESUME = `Tasha Williams, BSN, RN
Saint Cloud, MN
Minnesota RN license, active through 2027. US citizen.
EXPERIENCE
Registered Nurse, Telemetry Unit (Charge Nurse), Mississippi Valley Medical Center (Saint Cloud, MN), March 2023 - Present
Registered Nurse, Medical-Surgical Unit, Lakeshore Regional Hospital (Saint Cloud, MN), June 2020 - February 2023
Nursing Assistant (CNA), Lakeshore Regional Hospital, 2018 - 2020
EDUCATION
B.S. in Nursing (BSN), College of Saint Benedict and Saint John's University, 2020
LICENSES AND CERTIFICATIONS
Registered Nurse, Minnesota; BLS; ACLS; PALS; Telemetry certification (Cardiac Medical Certification, CMC), 2024.`;

const NURSE_POINTS: Array<Parameters<typeof seedPoint>[2]> = [
  { title: "Registered Nurse, Telemetry Unit (Charge Nurse)", org: "Mississippi Valley Medical Center", start: "2023-03", skills: ["patient assessment", "cardiac rhythm interpretation", "medication administration", "staff management", "epic", "pyxis"], text: "Provide care for 4 to 5 patients per shift on a 32-bed cardiac telemetry unit; interpret rhythms, titrate cardiac drips per protocol." },
  { title: "Registered Nurse, Medical-Surgical Unit", org: "Lakeshore Regional Hospital", start: "2020-06", end: "2023-02", skills: ["patient care", "wound care", "pain management", "iv therapy", "discharge teaching"], text: "Cared for post-operative adult patients (orthopedics and general surgery)." },
  { title: "Nursing Assistant (CNA)", org: "Lakeshore Regional Hospital", start: "2018", end: "2020", skills: ["nursing assistance"], text: "Provided nursing assistant support at Lakeshore Regional Hospital." },
  { kind: "education", title: "B.S. in Nursing (BSN)", end: "2020", skills: ["nursing"], text: "B.S. in Nursing (BSN), College of Saint Benedict and Saint John's University, 2020" },
  { kind: "skill", title: "Patient Care Skills", skills: ["patient assessment", "medication administration", "discharge education", "charge nurse duties"], text: "Skilled in patient assessment, medication administration, discharge education and charge nurse duties." },
];

const req = (name: string, required = true) => ({ name, level: "working" as const, years: null, required });
const TELEMETRY = baseSpec({
  mustHaves: ["Graduate from a nursing program", "Current Minnesota RN license", "Current American Heart Association (AHA) BLS Healthcare Provider care"],
  niceToHaves: ["BSN or MSN degree", "National Certification in Nursing Specialty", "Advanced Cardiac Life Support (ACLS)", "Previous nursing experience"],
  skills: [req("nursing"), req("American Heart Association BLS Healthcare Provider care"), req("Advanced Cardiac Life Support (ACLS)", false)],
  seniority: "entry", roleFamily: "healthcare nursing",
  requirementWeights: { "Graduate from a nursing program": 1, "Current Minnesota RN license": 1, "Current American Heart Association (AHA) BLS Healthcare Provider care": 1, "BSN or MSN degree": 0.4, "Previous nursing experience": 0.3, "Advanced Cardiac Life Support (ACLS)": 0.3, "National Certification in Nursing Specialty": 0.3 },
});
const FLOAT_POOL = baseSpec({
  mustHaves: ["Graduate from an accredited nursing program", "Current Minnesota RN License", "Current American Heart Association (AHA) BLS Healthcare Provider card", "BSN or higher required within 36 months of being hired"],
  niceToHaves: ["Previous nursing experience", "BSN or MSN preferred"],
  skills: [req("Registered Nurse"), req("Basic Life Support (BLS)")], seniority: "entry", roleFamily: "nursing",
  requirementWeights: { "Graduate from an accredited nursing program": 1, "Current Minnesota RN License": 1, "Current American Heart Association (AHA) BLS Healthcare Provider card": 1, "BSN or higher required within 36 months of being hired": 0.8, "Previous nursing experience": 0.4, "BSN or MSN preferred": 0.4 },
});
const TRAUMA = baseSpec({
  mustHaves: ["Graduate from a nursing program", "Current MN RN license", "BSN required within 3 years of hire", "Current BLS Healthcare Provider card", "Advanced Cardiac Life Support (ACLS) within 6 months of hire", "Trauma Nursing Core Curriculum (TNCC) within 12 months of hire", "Emergency Nurse Pediatric Course (ENPC) within 18 months of hire"],
  skills: [req("Registered Nurse (RN)"), req("Basic Life Support (BLS)"), req("Advanced Cardiac Life Support (ACLS)"), req("Trauma Nursing Core Curriculum (TNCC)"), req("Emergency Nurse Pediatric Course (ENPC)")],
  seniority: "mid", roleFamily: "nursing",
});

describe("the registered nurse (run 3: 16 lane jobs, all below the minimum)", () => {
  let n = 0;
  const points: EvidencePoint[] = NURSE_POINTS.map((p) => ({
    id: `n${n++}`, kind: p.kind ?? "role", title: p.title, org: p.org ?? null, startDate: p.start ?? null, endDate: p.end ?? null, text: p.text ?? "",
    skills: p.skills ?? [], scope: {}, metrics: {}, embedding: null,
  }));
  const target = { laneTitles: ["Registered Nurse", "Telemetry Nurse"], roleTitles: ["Registered Nurse, Telemetry Unit (Charge Nurse)", "Registered Nurse, Medical-Surgical Unit"] };
  const fit = (spec: ReturnType<typeof baseSpec>, title: string, resumeText: string | null) =>
    scoreFit({ spec, points, similarity: 0.6, experienceYears: 8.8, now: NOW, jobTitle: title, target, quality: { heuristic: false, descriptionChars: 3000 }, resumeText });

  it("finds licences and certifications in the resume text when the career points missed them", () => {
    const without = fit(TELEMETRY, "Registered Nurse | Telemetry", null);
    const withResume = fit(TELEMETRY, "Registered Nurse | Telemetry", NURSE_RESUME);
    expect(without.capped).toBe(true);
    expect(without.fit).toBeLessThan(0.45);
    expect(withResume.fit).toBeGreaterThanOrEqual(0.6);
    const licence = withResume.fitMap.find((e) => e.requirement === "Current Minnesota RN license")!;
    expect(licence.score).toBeGreaterThan(0.5);
    // The resume is evidence, never a career point id (tailoring looks those up).
    expect(withResume.fitMap.every((e) => !e.careerPointIds.includes(RESUME_POINT_ID))).toBe(true);
  });

  it("meets a nursing-programme requirement with the BSN and does not mark an experienced nurse down on an 'entry' staff posting", () => {
    const r = fit(FLOAT_POOL, "Registered Nurse | Float Pool", NURSE_RESUME);
    expect(r.fitMap.find((e) => e.requirement === "Graduate from an accredited nursing program")!.score).toBeGreaterThan(0.5);
    expect(r.components.seniority).toBe(1);
    expect(r.fit).toBeGreaterThanOrEqual(0.6);
  });

  it("treats certificates obtainable after hire as nice-to-haves, and does not list a skill twice", () => {
    const reqs = buildRequirements(TRAUMA);
    expect(reqs.find((r) => r.text.startsWith("Trauma Nursing Core Curriculum (TNCC) within"))).toMatchObject({ mustHave: false });
    expect(reqs.find((r) => r.text === "BSN required within 3 years of hire")).toMatchObject({ mustHave: false, years: null });
    // "Trauma Nursing Core Curriculum (TNCC)" and "Basic Life Support (BLS)" are already named by requirement texts.
    expect(reqs.filter((r) => /TNCC/.test(r.text))).toHaveLength(1);
    expect(reqs.some((r) => r.text === "Basic Life Support (BLS)")).toBe(false);
    expect(fit(TRAUMA, "Registered Nurse | Emergency Trauma Center", NURSE_RESUME).fit).toBeGreaterThanOrEqual(0.6);
  });
});

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());
beforeEach(() => { clearRequirementVectorCache(); clearRolePoolCache(); });

describe("shortlists", () => {
  it("gives the nurse her lane jobs from the real specs", async () => {
    const co = await seedCompany(t.db, { name: "CentraCare" });
    const userId = await seedUser(t.db, { location: "Saint Cloud, MN", workAuth: { US: { citizen: true, authorized: true } } });
    await t.db.update(profiles).set({ resumeText: NURSE_RESUME }).where(eq(profiles.userId, userId));
    await seedLane(t.db, userId, { titles: ["Registered Nurse", "Telemetry Nurse"], locations: ["Saint Cloud, MN", "Minneapolis, MN"], remote: false, minFit: 0.6 });
    for (const p of NURSE_POINTS) await seedPoint(t.db, userId, p);
    const where = "Saint Cloud, MN, United States";
    await seedJob(t.db, { companyId: co, title: "Registered Nurse | Telemetry", location: where, spec: TELEMETRY, embedText: "registered nurse telemetry" });
    await seedJob(t.db, { companyId: co, title: "Registered Nurse | Float Pool", location: where, spec: FLOAT_POOL, embedText: "registered nurse float pool" });
    await seedJob(t.db, { companyId: co, title: "Registered Nurse | Emergency Trauma Center", location: where, spec: TRAUMA, embedText: "registered nurse emergency" });

    const stats = await buildShortlist(t.db, userId, { profileEmbedding: fakeEmbedding("registered nurse telemetry"), now: NOW, widen: false });
    expect(stats.belowMinFit).toBe(0);
    expect(stats.laneMatches).toBe(3);
  });

  it("keeps widened jobs within one level of the user and inside the user's function", async () => {
    const co = await seedCompany(t.db, { name: "WidenCo" });
    const userId = await seedUser(t.db, { location: "Austin, TX", workAuth: { US: { authorized: true, needsSponsorship: false } } });
    await seedLane(t.db, userId, { titles: ["Backend Engineer"], locations: ["Austin, TX"], remote: false, minFit: 0.6 });
    await seedPoint(t.db, userId, { title: "Backend Engineer", start: "2023-10", skills: ["Python", "PostgreSQL"], text: "python services on postgresql" });
    const text = "backend engineer python postgresql";
    const spec = (over: Partial<ReturnType<typeof baseSpec>> = {}) => baseSpec({ mustHaves: ["Python", "PostgreSQL"], ...over });
    await seedJob(t.db, { companyId: co, title: "Backend Engineer", location: "Austin, TX", spec: spec(), embedText: text });
    // Adjacent titles: one level up is fine, two is not (the gates let both through: no stated minimum, 3 years).
    const oneUp = await seedJob(t.db, { companyId: co, title: "Senior Software Engineer, Payments", location: "Austin, TX", spec: spec({ seniority: "senior" }), embedText: text });
    const twoUp = await seedJob(t.db, { companyId: co, title: "Staff Software Engineer, Payments", location: "Austin, TX", spec: spec({ seniority: "staff" }), embedText: text });
    const stated = await seedJob(t.db, { companyId: co, title: "Software Engineer, Platform", location: "Austin, TX", spec: spec({ yearsMin: 5 }), embedText: text });
    // Role pool, another function: a Python-heavy solutions engineer shares skills but not the job.
    const solutions = await seedJob(t.db, { companyId: co, title: "Solutions Engineer, Python", location: "Austin, TX", spec: spec(), embedText: text });

    const stats = await buildShortlist(t.db, userId, { profileEmbedding: fakeEmbedding(text), now: NOW });
    const widened = stats.widened.map((w) => w.jobId);
    expect(widened).toContain(oneUp);
    expect(widened).toContain(stated);
    expect(widened).not.toContain(twoUp);
    expect(widened).not.toContain(solutions);
  });

  it("widenedTooFar names the reason", () => {
    const backend = { laneTitles: ["Backend Engineer"], roleTitles: ["Backend Engineer"] };
    expect(widenedTooFar("Staff Software Engineer", baseSpec({ seniority: "staff" }), backend, 3)).toBe("too_senior");
    expect(widenedTooFar("Software Engineer", baseSpec({ yearsMin: 8 }), backend, 3)).toBe("too_senior");
    expect(widenedTooFar("Senior Software Engineer", baseSpec(), backend, 3)).toBeNull();
    expect(widenedTooFar("Solution Engineer - Salesforce", baseSpec(), { laneTitles: ["Marketing Manager"], roleTitles: [] }, 7)).toBe("other_function");
    // Same function, or a shared core word across families, stays.
    expect(widenedTooFar("Product Marketing Manager", baseSpec(), { laneTitles: ["Marketing Manager"], roleTitles: [] }, 7)).toBeNull();
    expect(widenedTooFar("Design Engineer", baseSpec(), { laneTitles: ["Product Designer"], roleTitles: [] }, 6)).toBeNull();
  });
});
