import { describe, expect, it } from "vitest";
import { fakeEmbedding } from "@norinote/ai";
import { buildRequirements, recencyFactor, scoreFit, scoreRequirement, similarityToRelevance, type Requirement } from "./fit.js";
import type { EvidencePoint } from "./profile.js";
import { NOW, baseSpec } from "./test-helpers.js";

let n = 0;
const point = (over: Partial<EvidencePoint> = {}): EvidencePoint => ({
  id: `p${n++}`, kind: "role", title: "Backend Engineer", org: "Acme", startDate: "2022-01", endDate: null, text: "", skills: [], scope: {}, metrics: {}, embedding: null,
  ...over,
});
const req = (over: Partial<Requirement> = {}): Requirement => ({ text: "Python", mustHave: true, weight: 1, skills: ["python"], years: null, ...over });

describe("buildRequirements", () => {
  it("turns must-haves, nice-to-haves and unmentioned skills into weighted requirements", () => {
    const spec = baseSpec({
      mustHaves: ["5+ years of Python", "Strong communication"],
      niceToHaves: ["Kubernetes"],
      skills: [
        { name: "Python", level: "advanced", years: 5, required: true },
        { name: "Terraform", level: "working", years: null, required: false },
      ],
      requirementWeights: { "5+ years of Python": 0.9, "Strong communication": 0.2, Kubernetes: 0.3 },
    });
    const reqs = buildRequirements(spec);
    expect(reqs.map((r) => [r.text, r.mustHave, r.weight, r.skills, r.years])).toEqual([
      ["5+ years of Python", true, 0.9, ["python"], 5],
      ["Strong communication", true, 0.2, [], null],
      ["Kubernetes", false, 0.3, ["kubernetes"], null],
      // Python is already named by a requirement text, so it is not listed twice; Terraform is.
      ["Terraform", false, 0.3, ["terraform"], 1],
    ]);
  });

  it("uses default weights when the spec has none and caps very long postings", () => {
    const spec = baseSpec({ mustHaves: ["Python"], niceToHaves: ["Go"] });
    expect(buildRequirements(spec).map((r) => r.weight)).toEqual([1, 0.4]);
    const long = baseSpec({ mustHaves: Array.from({ length: 12 }, (_, i) => `must ${i}`), niceToHaves: Array.from({ length: 12 }, (_, i) => `nice ${i}`) });
    const reqs = buildRequirements(long);
    expect(reqs).toHaveLength(20);
    expect(reqs.filter((r) => r.mustHave)).toHaveLength(12);
  });
});

describe("scoreRequirement", () => {
  const opts = { now: NOW };

  it("scores exact skill evidence highest, related skills partially, and nothing as zero", () => {
    const exact = scoreRequirement(req({ text: "SQL", skills: ["sql"] }), [point({ skills: ["sql"] })], undefined, opts);
    const child = scoreRequirement(req({ text: "SQL", skills: ["sql"] }), [point({ skills: ["postgresql"] })], undefined, opts);
    const sibling = scoreRequirement(req({ text: "PostgreSQL", skills: ["postgresql"] }), [point({ skills: ["mysql"] })], undefined, opts);
    const broader = scoreRequirement(req({ text: "React", skills: ["react"] }), [point({ skills: ["javascript"] })], undefined, opts);
    const none = scoreRequirement(req({ text: "Figma", skills: ["figma"] }), [point({ skills: ["python"] })], undefined, opts);
    expect(exact.best?.via).toBe("exact");
    expect(child.best?.via).toBe("related");
    expect(exact.score).toBeGreaterThan(0.9);
    expect(child.score).toBeCloseTo(exact.score * 0.75, 2);
    expect(sibling.score).toBeCloseTo(exact.score * 0.5, 2);
    expect(broader.score).toBeCloseTo(exact.score * 0.4, 2);
    expect(exact.score).toBeGreaterThan(child.score);
    expect(child.score).toBeGreaterThan(sibling.score);
    expect(sibling.score).toBeGreaterThan(broader.score);
    expect(none).toEqual({ score: 0, best: null, yearsOfEvidence: 0 });
  });

  it("falls back to embedding similarity, capped below an exact match", () => {
    const text = "operating kubernetes clusters in production";
    const r = req({ text, skills: [] });
    const similar = scoreRequirement(r, [point({ title: "Platform", embedding: fakeEmbedding(text) })], fakeEmbedding(text), opts);
    const unrelated = scoreRequirement(r, [point({ embedding: fakeEmbedding("watercolour painting lessons") })], fakeEmbedding(text), opts);
    expect(similar.best?.via).toBe("semantic");
    expect(similar.score).toBeGreaterThan(0.7);
    expect(similar.score).toBeLessThan(0.86);
    expect(unrelated.score).toBe(0);
    expect(similarityToRelevance(0.1)).toBe(0);
    expect(similarityToRelevance(1)).toBeCloseTo(0.85);
  });

  it("prefers the exact skill over a semantic hit and reports the best point", () => {
    const exact = point({ title: "Data Engineer", skills: ["python"] });
    const vague = point({ title: "Misc", embedding: fakeEmbedding("python") });
    const s = scoreRequirement(req({ text: "python", skills: ["python"] }), [vague, exact], fakeEmbedding("python"), opts);
    expect(s.best?.point.id).toBe(exact.id);
  });

  it("rewards depth: years of relevant work against what the posting asks", () => {
    const five = req({ years: 5 });
    const deep = scoreRequirement(five, [point({ skills: ["python"], startDate: "2019-01" })], undefined, opts);
    const shallow = scoreRequirement(five, [point({ skills: ["python"], startDate: "2026-05" })], undefined, opts);
    expect(deep.yearsOfEvidence).toBeGreaterThan(5);
    expect(shallow.yearsOfEvidence).toBeLessThan(1);
    expect(deep.score).toBeGreaterThan(shallow.score + 0.25);
  });

  it("counts overlapping jobs once when adding up years", () => {
    const a = point({ skills: ["python"], startDate: "2020-01", endDate: "2022-12" });
    const b = point({ skills: ["python"], startDate: "2021-01", endDate: "2022-12" });
    const s = scoreRequirement(req({ years: 3 }), [a, b], undefined, opts);
    expect(s.yearsOfEvidence).toBeCloseTo(3, 0);
  });

  it("discounts old work and rewards scope", () => {
    const current = scoreRequirement(req(), [point({ skills: ["python"] })], undefined, opts);
    const old = scoreRequirement(req(), [point({ skills: ["python"], startDate: "2008-01", endDate: "2012-12" })], undefined, opts);
    const big = scoreRequirement(req(), [point({ skills: ["python"], scope: { teamSize: 8, users: "2M" }, metrics: { latency: "-40%" } })], undefined, opts);
    expect(old.score).toBeLessThan(current.score);
    expect(big.score).toBeGreaterThan(current.score);
    expect(recencyFactor({ startDate: null, endDate: null }, NOW)).toBe(0.85);
    expect(recencyFactor({ startDate: "2008", endDate: "2009" }, NOW)).toBe(0.65);
  });
});

describe("scoreFit", () => {
  const strongPoints = [
    point({ skills: ["python", "postgresql"], startDate: "2019-01" }),
    point({ title: "Data Engineer", skills: ["airflow", "sql"], startDate: "2017-01", endDate: "2018-12" }),
  ];

  it("gives a high fit when must-haves are well evidenced", () => {
    const spec = baseSpec({ mustHaves: ["Python"], niceToHaves: ["Airflow"] });
    const r = scoreFit({ spec, points: strongPoints, similarity: 0.5, now: NOW });
    expect(r.fit).toBeGreaterThan(0.8);
    expect(r.capped).toBe(false);
    expect(r.fitMap[0]).toMatchObject({ requirement: "Python", mustHave: true, evidence: "exact", careerPointIds: [strongPoints[0]!.id] });
    expect(r.fitMap[0]!.note).toMatch(/Backend Engineer at Acme/);
  });

  it("lets a missing must-have cap the score however many nice-to-haves match", () => {
    const spec = baseSpec({
      mustHaves: ["Kubernetes"],
      niceToHaves: ["Python", "PostgreSQL", "Airflow", "SQL"],
      requirementWeights: { Kubernetes: 1, Python: 1, PostgreSQL: 1, Airflow: 1, SQL: 1 },
    });
    const r = scoreFit({ spec, points: strongPoints, similarity: 0.5, now: NOW });
    expect(r.requirementScore).toBeGreaterThan(0.6);
    expect(r.capped).toBe(true);
    expect(r.fit).toBeLessThanOrEqual(0.3);
    expect(r.reasons).toContain("Gap: Kubernetes");
    // With the must-have evidenced the same job scores far higher.
    const withK8s = scoreFit({ spec, points: [...strongPoints, point({ title: "SRE", skills: ["kubernetes"] })], similarity: 0.5, now: NOW });
    expect(withK8s.fit).toBeGreaterThan(r.fit + 0.5);
  });

  it("scales the cap by how central the must-have is", () => {
    const heavy = scoreFit({ spec: baseSpec({ mustHaves: ["Kubernetes", "Python"], requirementWeights: { Kubernetes: 1, Python: 1 } }), points: strongPoints, now: NOW });
    const light = scoreFit({ spec: baseSpec({ mustHaves: ["Kubernetes", "Python"], requirementWeights: { Kubernetes: 0.2, Python: 1 } }), points: strongPoints, now: NOW });
    expect(light.fit).toBeGreaterThan(heavy.fit);
  });

  it("gives partial credit through skill groups", () => {
    const spec = baseSpec({ mustHaves: ["SQL"] });
    const viaPostgres = scoreFit({ spec, points: [point({ skills: ["postgresql"] })], now: NOW });
    const direct = scoreFit({ spec, points: [point({ skills: ["sql"] })], now: NOW });
    const unrelated = scoreFit({ spec, points: [point({ skills: ["figma"] })], now: NOW });
    expect(viaPostgres.fitMap[0]).toMatchObject({ evidence: "related" });
    expect(viaPostgres.fit).toBeGreaterThan(0.5);
    expect(viaPostgres.fit).toBeLessThan(direct.fit);
    expect(unrelated.fit).toBeLessThan(0.1);
  });

  it("uses profile similarity when the spec has no requirements", () => {
    const r = scoreFit({ spec: baseSpec(), points: strongPoints, similarity: 0.5, now: NOW });
    expect(r.fit).toBeCloseTo(0.8, 2);
    expect(r.fitMap).toEqual([]);
    expect(scoreFit({ spec: baseSpec(), points: [], similarity: null, now: NOW }).fit).toBe(0);
  });

  it("trims the score when the user is short of the years asked", () => {
    const spec = baseSpec({ mustHaves: ["Python"], yearsMin: 6 });
    const enough = scoreFit({ spec, points: strongPoints, experienceYears: 8, now: NOW });
    const short = scoreFit({ spec, points: strongPoints, experienceYears: 4, now: NOW });
    expect(short.fit).toBeLessThan(enough.fit);
    expect(short.fit).toBeGreaterThan(enough.fit * 0.8);
  });

  it("writes entries that satisfy the shared FitMapEntry contract and 2 or 3 reasons", async () => {
    const { FitMapEntry } = await import("@norinote/shared");
    const spec = baseSpec({ mustHaves: ["Python", "Kubernetes"], niceToHaves: ["Airflow"] });
    const r = scoreFit({ spec, points: strongPoints, similarity: 0.4, laneName: "Backend", now: NOW });
    for (const e of r.fitMap) expect(FitMapEntry.safeParse(e).success).toBe(true);
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
    expect(r.reasons.length).toBeLessThanOrEqual(3);
    const bare = scoreFit({ spec: baseSpec({ mustHaves: ["Figma"] }), points: [], similarity: 0.3, laneName: "Design", now: NOW });
    expect(bare.reasons.length).toBeGreaterThanOrEqual(2);
  });
});
