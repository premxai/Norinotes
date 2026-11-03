import { describe, expect, it } from "vitest";
import { certificationStatus, scoreFit } from "./fit.js";
import type { EvidencePoint } from "./profile.js";
import { NOW, baseSpec } from "./test-helpers.js";

/** Certification career points (kind "certification") are evidence for licence and certification requirements. */

let n = 0;
const point = (o: Partial<EvidencePoint> & { title: string }): EvidencePoint => ({
  id: `p${n++}`, kind: "role", org: null, startDate: null, endDate: null, text: "", skills: [], scope: {}, metrics: {}, embedding: null, ...o,
});
const cert = (o: Partial<EvidencePoint> & { title: string }) => point({ kind: "certification", ...o });

const req = (name: string, required = true) => ({ name, level: "working" as const, years: null, required });
const fit = (spec: ReturnType<typeof baseSpec>, points: EvidencePoint[], resumeText: string | null = null) =>
  scoreFit({ spec, points, similarity: 0.6, experienceYears: 6, now: NOW, jobTitle: "x", quality: { heuristic: false, descriptionChars: 3000 }, resumeText });
const entry = (r: ReturnType<typeof fit>, requirement: string) => r.fitMap.find((e) => e.requirement === requirement)!;

const NURSE_ROLE = point({ title: "Registered Nurse, Telemetry Unit", org: "General Hospital", startDate: "2020-01", skills: ["patient care"], text: "Cared for telemetry patients." });
const NURSE_SPEC = baseSpec({
  mustHaves: ["Current Minnesota RN license", "Current BLS card", "ACLS certification"],
  skills: [req("Registered Nurse (RN)"), req("Basic Life Support (BLS)"), req("Advanced Cardiac Life Support (ACLS)")], roleFamily: "nursing", seniority: "entry",
});
const RN = cert({ title: "Registered Nurse (RN), Minnesota", org: "Minnesota Board of Nursing", startDate: "2020-06", endDate: "2027-06", skills: ["RN"] });
const BLS = cert({ title: "Basic Life Support (BLS)", org: "American Heart Association", startDate: "2025-02", endDate: "2027-02", skills: ["BLS"] });
const ACLS = cert({ title: "Advanced Cardiac Life Support (ACLS)", org: "American Heart Association", startDate: "2024-03", endDate: "2028-03", skills: ["ACLS"] });
const NURSE_RESUME = "Minnesota RN license. LICENSES AND CERTIFICATIONS: BLS; ACLS.";

describe("certification points as evidence", () => {
  it("a nurse with RN, BLS and ACLS points meets those must-haves, with no resume text", () => {
    const r = fit(NURSE_SPEC, [NURSE_ROLE, RN, BLS, ACLS]);
    for (const text of ["Current Minnesota RN license", "Current BLS card", "ACLS certification"]) {
      const e = entry(r, text);
      expect(e.score, text).toBeGreaterThan(0.6);
      expect(e.careerPointIds[0], text).toBeDefined();
    }
    expect(entry(r, "ACLS certification").careerPointIds).toEqual([ACLS.id]);
  });

  it("an expired ACLS point does not meet the requirement, and the resume fallback does not bring it back", () => {
    const expired = cert({ ...ACLS, id: "acls-old", endDate: "2026-09" });
    expect(certificationStatus(expired, NOW)).toBe("expired");
    const r = fit(NURSE_SPEC, [NURSE_ROLE, RN, BLS, expired], NURSE_RESUME);
    expect(entry(r, "ACLS certification").score).toBeLessThan(0.3);
    expect(entry(r, "ACLS certification").evidence).toBe("none");
    expect(entry(r, "Current BLS card").score).toBeGreaterThan(0.6);
    expect(fit(NURSE_SPEC, [NURSE_ROLE, RN, BLS, ACLS], NURSE_RESUME).fit).toBeGreaterThan(r.fit);
  });

  it("reads expiry by the end of the period it names", () => {
    expect(certificationStatus({ title: "BLS", endDate: "2026-10" }, NOW)).toBe("active");
    expect(certificationStatus({ title: "BLS", endDate: "2026" }, NOW)).toBe("active");
    expect(certificationStatus({ title: "BLS", endDate: "2025" }, NOW)).toBe("expired");
    expect(certificationStatus({ title: "BLS", endDate: "2026-10-30" }, NOW)).toBe("expired");
    expect(certificationStatus({ title: "BLS", endDate: null }, NOW)).toBe("active");
  });

  it("a CFA candidate does not meet 'CFA charterholder', even when the resume text names CFA", () => {
    const spec = baseSpec({ mustHaves: ["CFA charterholder"], roleFamily: "finance" });
    const role = point({ title: "Equity Research Associate", startDate: "2021-01", skills: ["financial modeling"] });
    const candidate = cert({ title: "CFA Program Level III (candidate)", org: "CFA Institute", startDate: "2023-01" });
    const withCandidate = fit(spec, [role, candidate], "CFA Level III candidate, exam in 2027.");
    expect(entry(withCandidate, "CFA charterholder").score).toBeLessThan(0.3);
    const inProgress = cert({ title: "CFA Charter (in progress)", org: "CFA Institute" });
    expect(entry(fit(spec, [role, inProgress]), "CFA charterholder").score).toBeLessThan(0.3);
    const charter = cert({ title: "CFA Charterholder", org: "CFA Institute", startDate: "2024-09", skills: ["CFA"] });
    expect(entry(fit(spec, [role, charter]), "CFA charterholder").score).toBeGreaterThan(0.6);
  });

  it("a cloud engineer's AWS certification point meets an 'AWS certification' must-have", () => {
    const spec = baseSpec({ mustHaves: ["AWS certification"], skills: [req("AWS")] });
    const role = point({ title: "Cloud Engineer", startDate: "2021-01", skills: ["terraform"] });
    const aws = cert({ title: "AWS Certified Solutions Architect - Associate", org: "Amazon Web Services", startDate: "2024-05", endDate: "2027-05", skills: ["AWS Solutions Architect"] });
    const r = fit(spec, [role, aws]);
    expect(entry(r, "AWS certification").score).toBeGreaterThan(0.6);
    expect(entry(r, "AWS certification").careerPointIds).toEqual([aws.id]);
    // The same requirement without the point scores low.
    expect(entry(fit(spec, [role]), "AWS certification").score).toBeLessThan(0.3);
  });

  it("matches a certification's skill by alias", () => {
    const spec = baseSpec({ mustHaves: ["Amazon Web Services certification"], skills: [] });
    const aws = cert({ title: "Cloud Practitioner", startDate: "2024-05", skills: ["AWS"] });
    expect(entry(fit(spec, [aws]), "Amazon Web Services certification").evidence).toBe("exact");
  });

  it("falls back to resume words when there are no certification points", () => {
    const r = fit(NURSE_SPEC, [NURSE_ROLE], NURSE_RESUME);
    expect(entry(r, "ACLS certification").score).toBeGreaterThan(0.5);
    expect(entry(r, "ACLS certification").careerPointIds).toEqual([]);
  });
});
