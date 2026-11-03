import { describe, expect, it } from "vitest";
import { DEFAULT_MIN_FIT, coverageOf, qualityOf, scoreFit, type ScoreFitArgs } from "./fit.js";
import { heuristicSpec } from "./heuristic-spec.js";
import type { EvidencePoint } from "./profile.js";
import { canonicalSkills } from "./skills.js";
import { NOW, baseSpec } from "./test-helpers.js";
import { WIDEN_MIN_FIT } from "./widen.js";

/**
 * The fit scale, on seeded career points and specs that mirror the worst rows of the matching baseline
 * (docs/eval/matching-baseline.md): a strong plausible fit lands at 0.7 to 0.9, an irrelevant one below 0.3.
 */

let n = 0;
const point = (title: string, startDate: string | null, endDate: string | null, skills: string[], over: Partial<EvidencePoint> = {}): EvidencePoint => ({
  id: `p${n++}`, kind: "role", title, org: "Org", startDate, endDate, text: "", skills: canonicalSkills(skills), scope: { teamSize: 6 }, metrics: { growth: "30%" }, embedding: null,
  ...over,
});
const req = (name: string) => ({ name, level: "working" as const, years: null, required: true });
const fit = (a: Omit<ScoreFitArgs, "now">) => scoreFit({ now: NOW, ...a });
const full = { heuristic: false, descriptionChars: 3000 };

const BACKEND = [point("Backend Engineer", "2020-01", null, ["Python", "PostgreSQL", "Kubernetes", "REST APIs"]), point("Software Engineer", "2018-06", "2019-12", ["Python", "Docker"])];
const BACKEND_TARGET = { laneTitles: ["Backend Engineer", "Platform Engineer", "Software Engineer"], roleTitles: ["Backend Engineer", "Software Engineer"] };

const MARKETER = [
  point("Senior Marketing Manager", "2021-01", null, ["Salesforce", "HubSpot", "SEO", "Stakeholder Management"]),
  point("Marketing Manager", "2018-01", "2020-12", ["HubSpot", "SEO"]),
];
const MARKETING_TARGET = { laneTitles: ["Marketing Manager", "Demand Generation Manager", "Product Marketing Manager"], roleTitles: ["Senior Marketing Manager", "Marketing Manager"] };

const DESIGNER = [point("Senior Product Designer", "2020-01", null, ["Figma", "Accessibility"]), point("Product Designer", "2017-01", "2019-12", ["Figma"])];
const DESIGN_TARGET = { laneTitles: ["Product Designer", "UX Designer"], roleTitles: ["Senior Product Designer", "Product Designer"] };

const SWITCHER = [
  point("Mathematics Teacher", "2018-08", "2026-06", ["Python"], { scope: {}, metrics: {} }),
  point("Plantwise", "2026-01", null, ["React", "TypeScript", "Node.js", "PostgreSQL"], { kind: "project" }),
  point("Budgetly", "2026-01", null, ["React", "Redux", "Jest"], { kind: "project" }),
];
const SWITCHER_TARGET = { laneTitles: ["Frontend Engineer", "Junior Frontend Developer", "Web Developer", "Full Stack Engineer"], roleTitles: ["Mathematics Teacher"] };

const NEW_GRAD = [
  point("Software Engineering Intern", "2025-06", "2025-08", ["Python", "Go"]),
  point("B.S. Computer Science", "2022-09", "2026-05", ["Python", "Java"], { kind: "education" }),
  point("Distributed cache project", "2026-01", "2026-04", ["Go", "Distributed Systems"], { kind: "project" }),
];
const NEW_GRAD_TARGET = { laneTitles: ["Software Engineer", "Backend Engineer", "Full Stack Engineer"], roleTitles: ["Software Engineering Intern"] };

describe("the fit scale", () => {
  it("puts a strong, plausible fit between 0.7 and 0.9 and above the default lane minimum", () => {
    const spec = baseSpec({
      mustHaves: ["Python", "PostgreSQL", "Kubernetes", "REST APIs"], niceToHaves: ["Docker"], seniority: "mid", yearsMin: 4,
      requirementWeights: { Python: 1, PostgreSQL: 0.8, Kubernetes: 0.7, "REST APIs": 0.6, Docker: 0.3 },
    });
    const r = fit({ spec, points: BACKEND, similarity: 0.42, jobTitle: "Backend Engineer, Payments", target: BACKEND_TARGET, quality: full, experienceYears: 8 });
    expect(r.fit).toBeGreaterThanOrEqual(0.7);
    expect(r.fit).toBeLessThanOrEqual(0.95);
    expect(r.fit).toBeGreaterThanOrEqual(DEFAULT_MIN_FIT);
    expect(r.confidence).toBe(1);
  });

  it("puts an irrelevant job under 0.3", () => {
    const spec = baseSpec({ mustHaves: ["Active RN license", "BLS certification"], roleFamily: "nursing", seniority: "mid" });
    const r = fit({ spec, points: BACKEND, similarity: 0.12, jobTitle: "Registered Nurse | Telemetry", target: BACKEND_TARGET, quality: full });
    expect(r.fit).toBeLessThan(0.3);
  });

  it("turns evidence strength into coverage between 0.15 and 0.8", () => {
    expect(coverageOf(0.1)).toBe(0);
    expect(coverageOf(0.8)).toBe(1);
    expect(coverageOf(0.475)).toBeCloseTo(0.5, 2);
  });
});

describe("function alignment", () => {
  it("penalises a Salesforce Solution Engineer for a marketing manager even though the skills overlap", () => {
    const spec = baseSpec({ mustHaves: ["Salesforce", "HubSpot", "Stakeholder Management"], roleFamily: "solutions engineering", seniority: "mid" });
    const wrong = fit({ spec, points: MARKETER, similarity: 0.4, jobTitle: "Solution Engineer - Salesforce", target: MARKETING_TARGET, quality: full });
    const right = fit({ spec, points: MARKETER, similarity: 0.4, jobTitle: "Senior Marketing Manager, Demand Generation", target: MARKETING_TARGET, quality: full });
    expect(wrong.components.coverage).toBeGreaterThan(0.7);
    expect(wrong.fit).toBeLessThan(0.15);
    expect(wrong.reasons).toContain("Gap: a different kind of role from the ones you are looking for");
    expect(right.fit).toBeGreaterThanOrEqual(0.7);
  });

  it("does not let a graphic designer role pass for a product designer", () => {
    const spec = baseSpec({ mustHaves: ["Figma", "Accessibility"], roleFamily: "design", seniority: "senior" });
    const graphic = fit({ spec, points: DESIGNER, similarity: 0.45, jobTitle: "Senior Graphic Designer, Video Content", target: DESIGN_TARGET, quality: full });
    const product = fit({ spec, points: DESIGNER, similarity: 0.45, jobTitle: "Senior Product Designer", target: DESIGN_TARGET, quality: full });
    expect(graphic.fit).toBeLessThan(WIDEN_MIN_FIT);
    expect(product.fit).toBeGreaterThanOrEqual(0.7);
  });
});

describe("seniority and years in the function", () => {
  it("fails a teacher-to-frontend switcher on Senior Software Engineer, and fits Junior Frontend Developer", () => {
    const senior = baseSpec({ mustHaves: ["React", "TypeScript"], seniority: "senior", yearsMin: 5 });
    const junior = baseSpec({ mustHaves: ["React", "TypeScript"], niceToHaves: ["Jest"], seniority: "entry", yearsMin: null });
    const s = fit({ spec: senior, points: SWITCHER, similarity: 0.45, jobTitle: "Senior Software Engineer", target: SWITCHER_TARGET, quality: full, experienceYears: 7.8 });
    const j = fit({ spec: junior, points: SWITCHER, similarity: 0.45, jobTitle: "Junior Frontend Developer", target: SWITCHER_TARGET, quality: full, experienceYears: 7.8 });
    // Eight years of teaching are not eight years of software; the bootcamp projects count as a fraction of a year.
    expect(s.components.functionYears).toBeLessThan(1);
    expect(s.fit).toBeLessThan(WIDEN_MIN_FIT);
    expect(s.reasons.some((x) => /more seniority/.test(x))).toBe(true);
    expect(j.fit).toBeGreaterThanOrEqual(DEFAULT_MIN_FIT);
    expect(j.fit).toBeGreaterThan(s.fit + 0.3);
  });

  it("keeps senior roles away from a new grad and entry roles close", () => {
    const spec = (seniority: "senior" | "entry", yearsMin: number | null) => baseSpec({ mustHaves: ["Python", "Distributed Systems"], seniority, yearsMin });
    const senior = fit({ spec: spec("senior", 6), points: NEW_GRAD, similarity: 0.4, jobTitle: "Senior Software Engineer, Infrastructure", target: NEW_GRAD_TARGET, quality: full, experienceYears: 0.3 });
    const entry = fit({ spec: spec("entry", null), points: NEW_GRAD, similarity: 0.4, jobTitle: "Software Engineer, New Grad", target: NEW_GRAD_TARGET, quality: full, experienceYears: 0.3 });
    expect(senior.fit).toBeLessThan(WIDEN_MIN_FIT);
    expect(entry.fit).toBeGreaterThanOrEqual(DEFAULT_MIN_FIT);
  });

  it("marks an overqualified match down too, but less than an underqualified one", () => {
    const spec = (seniority: "intern" | "staff") => baseSpec({ mustHaves: ["Python", "PostgreSQL"], seniority });
    const intern = fit({ spec: spec("intern"), points: BACKEND, similarity: 0.42, jobTitle: "Software Engineering Intern", target: BACKEND_TARGET, quality: full });
    const okay = fit({ spec: baseSpec({ mustHaves: ["Python", "PostgreSQL"], seniority: "mid" }), points: BACKEND, similarity: 0.42, jobTitle: "Backend Engineer", target: BACKEND_TARGET, quality: full });
    expect(intern.fit).toBeLessThan(okay.fit * 0.6);
  });
});

describe("requirements coverage", () => {
  const points = [point("Backend Engineer", "2020-01", null, ["Python", "MySQL"])];

  it("caps the score on a must-have the user clearly lacks, but not on one with partial evidence", () => {
    const lacks = fit({ spec: baseSpec({ mustHaves: ["Python", "Kubernetes"] }), points, similarity: 0.45, quality: full });
    const partial = fit({ spec: baseSpec({ mustHaves: ["Python", "PostgreSQL"] }), points, similarity: 0.45, quality: full });
    expect(lacks.capped).toBe(true);
    expect(lacks.fit).toBeLessThanOrEqual(0.3);
    // MySQL is a sibling of PostgreSQL: partial evidence, no cap.
    expect(partial.capped).toBe(false);
    expect(partial.fit).toBeGreaterThan(0.5);
  });

  it("lets nice-to-haves add a little and never more than 0.05 either way", () => {
    const base = baseSpec({ mustHaves: ["Python"], niceToHaves: ["Kubernetes"] });
    const without = fit({ spec: base, points, similarity: 0.45, quality: full });
    const withIt = fit({ spec: base, points: [...points, point("SRE", "2022-01", null, ["Kubernetes"])], similarity: 0.45, quality: full });
    expect(withIt.fit).toBeGreaterThan(without.fit);
    expect(withIt.fit - without.fit).toBeLessThanOrEqual(0.1);
  });
});

describe("spec quality", () => {
  it("never gives a heuristic spec of an empty Workday posting a near-1.0 fit (the 0.99 graphic designer)", () => {
    const spec = heuristicSpec({ title: "Senior Graphic Designer, Video Content", descriptionText: "", location: "Remote", remote: true });
    const designerWithFigmaTitle = [point("Senior Product Designer", "2020-01", null, ["Figma", "Graphic Design", "Video"]), ...DESIGNER];
    const noTarget = fit({ spec, points: designerWithFigmaTitle, similarity: 0.6, quality: { heuristic: true, descriptionChars: 0 } });
    const withTarget = fit({ spec, points: designerWithFigmaTitle, similarity: 0.6, jobTitle: "Senior Graphic Designer, Video Content", target: DESIGN_TARGET, quality: { heuristic: true, descriptionChars: 0 } });
    expect(noTarget.fit).toBeLessThanOrEqual(0.65);
    expect(noTarget.confidence).toBeLessThan(1);
    expect(withTarget.fit).toBeLessThan(0.3);
  });

  it("caps and discounts by how well the job is described", () => {
    expect(qualityOf(null)).toEqual({ level: "full", cap: 1, confidence: 1 });
    expect(qualityOf({ heuristic: false, descriptionChars: 50 })).toMatchObject({ level: "no_description", cap: 0.65 });
    expect(qualityOf({ heuristic: true, descriptionChars: 5000 })).toMatchObject({ level: "heuristic", cap: 0.75 });
    expect(qualityOf({ heuristic: false, descriptionChars: 400 })).toMatchObject({ level: "thin" });
    // A single exact skill cannot prove a perfect fit: few requirements are pulled toward the middle.
    const one = fit({ spec: baseSpec({ skills: [req("Figma")] }), points: DESIGNER, similarity: 0.5, quality: full });
    expect(one.fit).toBeLessThan(0.9);
  });
});
