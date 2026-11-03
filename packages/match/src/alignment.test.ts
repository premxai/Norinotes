import { describe, expect, it } from "vitest";
import { familyYears, jobLevelBand, levelFromYears, matchTargetOf, recentRoleTitles, seniorityFit, titleAlignment } from "./alignment.js";
import type { EvidencePoint } from "./profile.js";
import { NOW, baseSpec } from "./test-helpers.js";

const target = (laneTitles: string[], roleTitles: string[] = []) => ({ laneTitles, roleTitles });
const MARKETING = target(["Marketing Manager", "Demand Generation Manager", "Product Marketing Manager"], ["Senior Marketing Manager"]);
const PRODUCT_DESIGNER = target(["Product Designer", "UX Designer"], ["Senior Product Designer"]);
const SENIOR_FRONTEND = target(["Senior Frontend Engineer", "Senior Software Engineer", "Staff Frontend Engineer"], ["Senior Frontend Engineer"]);

let n = 0;
const role = (title: string, startDate: string | null, endDate: string | null = null): EvidencePoint => ({
  id: `r${n++}`, kind: "role", title, org: "Org", startDate, endDate, text: "", skills: [], scope: {}, metrics: {}, embedding: null,
});

describe("titleAlignment", () => {
  it("is neutral (null) without a target", () => {
    expect(titleAlignment("Anything", null)).toBeNull();
    expect(titleAlignment("Anything", target([]))).toBeNull();
  });

  it("scores the same kind of role near 1", () => {
    expect(titleAlignment("Senior Content Marketing Manager", MARKETING)).toBe(1);
    expect(titleAlignment("Senior Product Designer", PRODUCT_DESIGNER)).toBe(1);
    expect(titleAlignment("UX Lead", PRODUCT_DESIGNER)).toBeGreaterThanOrEqual(0.85);
    expect(titleAlignment("Registered Nurse | Telemetry", target(["Registered Nurse", "Telemetry Nurse"]))).toBe(1);
  });

  it("penalises a different function heavily, however the words overlap", () => {
    // Salesforce "Solution Engineer" for a marketing manager: customer-facing engineering, not marketing.
    expect(titleAlignment("Solution Engineer - Salesforce", MARKETING)).toBeLessThanOrEqual(0.1);
    // "Product Manager" is in "Product Marketing Manager", but that is a marketing job.
    expect(titleAlignment("Sr Product Marketing Manager, T-Life", target(["Product Manager", "Senior Product Manager"]))).toBeLessThanOrEqual(0.25);
  });

  it("tells design specialties apart: a graphic or instructional designer is not a product designer", () => {
    expect(titleAlignment("Senior Graphic Designer, Video Content", PRODUCT_DESIGNER)).toBeLessThanOrEqual(0.2);
    expect(titleAlignment("Senior Digital Learning Experience Designer - Learning & Inclusion", PRODUCT_DESIGNER)).toBeLessThanOrEqual(0.2);
    expect(titleAlignment("Senior Visual Designer", PRODUCT_DESIGNER)).toBeLessThan(0.6);
  });

  it("reads a generic lane title through the user's specialty", () => {
    // The frontend engineer's "Senior Software Engineer" lane does not make a backend job a perfect match.
    expect(titleAlignment("Software Engineer, Back-End Focus", SENIOR_FRONTEND)).toBeLessThan(0.7);
    expect(titleAlignment("Software Engineer (Frontend)", SENIOR_FRONTEND)).toBeGreaterThanOrEqual(0.9);
    // With only generic titles a generic lane still matches.
    expect(titleAlignment("Software Engineer, Payments", target(["Software Engineer"]))).toBe(1);
  });

  it("keeps enterprise-platform developer roles apart from web development", () => {
    const bootcamp = target(["Frontend Engineer", "Junior Frontend Developer", "Web Developer", "Full Stack Engineer"], ["Mathematics Teacher"]);
    expect(titleAlignment("RPA Developer (UIPath)", bootcamp)).toBeLessThan(0.5);
    expect(titleAlignment("Junior Frontend Developer", bootcamp)).toBe(1);
  });
});

describe("familyYears", () => {
  it("counts a former teacher with a bootcamp as having no software experience", () => {
    const points = [role("Mathematics Teacher", "2018-08", "2026-06"), { ...role("Plantwise (capstone)", "2026-01"), kind: "project" }];
    expect(familyYears(points, "Senior Software Engineer", NOW)).toBe(0);
    expect(familyYears(points, "Frontend Engineer", NOW)).toBe(0);
  });

  it("counts roles of the same family in full and neighbouring families at half", () => {
    const points = [role("Frontend Engineer", "2020-01", "2023-01"), role("Customer Success Manager", "2016-01", "2018-01")];
    expect(familyYears(points, "Senior Software Engineer", NOW)).toBeCloseTo(3, 0);
    // Sales sits next to customer success: two years count as one.
    expect(familyYears(points, "Account Executive", NOW)).toBeCloseTo(1, 0);
  });

  it("matches unclassified titles by their words, and gives up when nothing relates", () => {
    const nurse = [role("Charge Nurse", "2020-01"), role("Registered Nurse", "2018-01", "2020-01")];
    expect(familyYears(nurse, "Registered Nurse | Telemetry", NOW)).toBeGreaterThan(8);
    expect(familyYears([role("Barista", "2020-01")], "Lighthouse Keeper", NOW)).toBeNull();
    expect(familyYears([], "Software Engineer", NOW)).toBeNull();
  });
});

describe("seniorityFit", () => {
  it("maps years to levels", () => {
    expect(levelFromYears(0)).toBe(1);
    expect(levelFromYears(2)).toBe(2);
    expect(levelFromYears(6)).toBe(3);
    expect(levelFromYears(9)).toBe(4);
    expect(levelFromYears(30)).toBe(5);
  });

  it("uses the title first, then the spec, raised by the years asked", () => {
    expect(jobLevelBand("Senior Software Engineer", baseSpec({ seniority: "mid" }))).toEqual([3, 3.5]);
    expect(jobLevelBand("Software Engineer", baseSpec({ seniority: "mid", yearsMin: 6 }))[0]).toBe(3);
    expect(jobLevelBand("Software Engineering LMTS - Data", baseSpec({ seniority: "unknown" }))).toEqual([4, 4.5]);
  });

  it("penalises a job above the user more than one below", () => {
    const newGradVsSenior = seniorityFit("Senior Software Engineer", baseSpec({ seniority: "senior", yearsMin: 5 }), 0.3);
    const bootcampVsSenior = seniorityFit("Senior Frontend Developer", baseSpec({ seniority: "senior" }), 0);
    const seniorVsIntern = seniorityFit("2027 Internship Software Engineer", baseSpec({ seniority: "intern" }), 9);
    expect(newGradVsSenior).toMatchObject({ direction: "above" });
    expect(newGradVsSenior.score).toBeLessThan(0.5);
    expect(bootcampVsSenior.score).toBeLessThan(0.5);
    expect(seniorVsIntern).toMatchObject({ direction: "below" });
    expect(seniorVsIntern.score).toBeLessThan(0.3);
    // One level either way: the job above costs more than the job below.
    const above = seniorityFit("Staff Engineer", baseSpec({ seniority: "staff" }), 6).score;
    const below = seniorityFit("Senior Software Engineer", baseSpec({ seniority: "senior" }), 11).score;
    expect(above).toBeLessThan(below);
  });

  it("does not penalise the band a role usually spans, or unknown experience", () => {
    expect(seniorityFit("2027 Internship Software Engineer", baseSpec({ seniority: "intern" }), 0.3).score).toBeGreaterThan(0.9);
    expect(seniorityFit("Software Engineer (Frontend)", baseSpec({ seniority: "mid" }), 9).score).toBe(1);
    expect(seniorityFit("Senior Software Engineer", baseSpec({ seniority: "senior" }), 5).score).toBe(1);
    expect(seniorityFit("Principal Engineer", baseSpec(), null).score).toBe(1);
  });
});

describe("match target", () => {
  it("takes lane titles and the latest two role titles", () => {
    const points = [role("Junior Developer at Old Co", "2015-01", "2017-06"), role("Senior Frontend Engineer at Acme", "2020-03"), role("Software Engineer", "2017-07", "2020-02")];
    expect(recentRoleTitles(points, NOW)).toEqual(["Senior Frontend Engineer", "Software Engineer"]);
    expect(matchTargetOf({ lanes: [{ titles: ["Frontend Engineer", "UI Engineer"] }, { titles: ["frontend engineer"] }], points }, NOW)).toEqual({
      laneTitles: ["Frontend Engineer", "UI Engineer"], roleTitles: ["Senior Frontend Engineer", "Software Engineer"],
    });
  });
});
