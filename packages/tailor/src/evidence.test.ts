import { describe, expect, it } from "vitest";
import type { CareerPoint, FitMapEntry, JobSpec } from "@norinote/shared";
import { buildEvidence, buildRequirements, bulletSupports, coverageScore, requirementShown } from "./evidence.js";
import { SPEC } from "./test-fixtures.js";
import { containsPhrase, keyPhraseOf } from "./key-phrases.js";
import type { ResumeContent } from "./types.js";

const pt = (id: string, p: Partial<CareerPoint> & Pick<CareerPoint, "kind" | "title">): CareerPoint => ({
  id, org: null, startDate: null, endDate: null, text: "", skills: [], scope: {}, metrics: {}, sourceQuote: null, ...p,
});

const points: CareerPoint[] = [
  pt("acme", { kind: "role", title: "Backend Engineer", org: "Acme", startDate: "2021-03", text: "Built REST APIs in TypeScript serving 2M requests per day\nMigrated billing to Postgres, cutting query time by 40%", skills: ["TypeScript"] }),
  pt("ops", { kind: "role", title: "Ops Engineer", org: "Globex", startDate: "2019-01", endDate: "2021-02", text: "Ran K8s clusters for the payments team\nOwned services end to end, from design to on-call" }),
];

const spec: JobSpec = {
  ...SPEC,
  mustHaves: ["Build REST APIs in TypeScript", "PostgreSQL experience", "Kubernetes and Terraform in production", "Owned services from design to on-call"],
  niceToHaves: ["Experience with Snowflake"],
  skills: [{ name: "TypeScript", level: "advanced", years: 3, required: true }, { name: "Datadog", level: "working", years: null, required: false }],
};

describe("buildRequirements", () => {
  it("lists must-haves, nice-to-haves and unnamed listed skills, with the job's spelling of each term", () => {
    const reqs = buildRequirements(spec);
    expect(reqs.map((r) => r.text)).toEqual([
      "Build REST APIs in TypeScript", "PostgreSQL experience", "Kubernetes and Terraform in production", "Owned services from design to on-call",
      "Experience with Snowflake", "Datadog",
    ]);
    expect(reqs[2]!.terms).toEqual([{ key: "kubernetes", jobString: "Kubernetes" }, { key: "terraform", jobString: "Terraform" }]);
    expect(reqs[3]!.terms).toEqual([]);
  });

  it("uses fit-map rows when there is no spec, without repeating a skill the spec named", () => {
    const fit: FitMapEntry[] = [{ requirement: "TypeScript", mustHave: true, score: 0.9, careerPointIds: ["acme"] }, { requirement: "Ship fast", mustHave: false, score: 0.5, careerPointIds: [] }];
    expect(buildRequirements(null, fit).map((r) => r.text)).toEqual(["TypeScript", "Ship fast"]);
    expect(buildRequirements(spec, fit).filter((r) => r.text === "TypeScript")).toEqual([]);
  });
});

describe("buildEvidence", () => {
  const index = buildEvidence({ spec, fitMap: [], points });
  const entry = (text: string) => index.entries.find((e) => e.text === text)!;

  it("supports a requirement by exact match first", () => {
    expect(entry("Build REST APIs in TypeScript").support).toEqual([{ pointId: "acme", via: "exact", score: 1, terms: ["rest apis", "typescript"] }]);
  });

  it("supports through an alias (Postgres for PostgreSQL, K8s for Kubernetes)", () => {
    expect(entry("PostgreSQL experience").support[0]).toMatchObject({ pointId: "acme", via: "alias" });
    const k = entry("Kubernetes and Terraform in production");
    expect(k.supported).toBe(true);
    expect(k.supportedTerms).toEqual(["kubernetes"]);
    expect(k.lackedTerms).toEqual(["terraform"]);
  });

  it("supports a descriptive requirement by shared words", () => {
    expect(entry("Owned services from design to on-call").support[0]).toMatchObject({ pointId: "ops", via: "words" });
  });

  it("reports a requirement with no support as a gap, and the terms the person lacks", () => {
    expect(index.gaps.map((g) => g.text)).toEqual(["Experience with Snowflake", "Datadog"]);
    expect(index.lackedJobTerms.map((t) => t.jobString)).toEqual(["Terraform", "Snowflake", "Datadog"]);
    expect(index.supportedJobTerms.map((t) => t.jobString)).toEqual(["REST APIs", "TypeScript", "PostgreSQL", "Kubernetes"]);
  });

  it("falls back to embedding similarity for descriptive requirements only", () => {
    const sim = (text: string, id: string) => (text === "Experience scaling payment systems" && id === "acme" ? 0.6 : text === "Experience with Snowflake" ? 0.9 : 0.1);
    const s: JobSpec = { ...spec, mustHaves: ["Experience scaling payment systems"], niceToHaves: ["Experience with Snowflake"], skills: [] };
    const idx = buildEvidence({ spec: s, fitMap: [], points, similarity: sim });
    expect(idx.entries[0]!.support).toEqual([{ pointId: "acme", via: "semantic", score: 0.6, terms: [] }]);
    // A term requirement is never supported by similarity: Snowflake stays a gap, the similar points are only "related".
    expect(idx.entries[1]!.supported).toBe(false);
    expect(idx.entries[1]!.related).toEqual(["acme", "ops"]);
  });

  it("uses the fit map for a descriptive requirement it scored", () => {
    const s: JobSpec = { ...spec, mustHaves: ["Experience with high-volume payment flows"], niceToHaves: [], skills: [] };
    const idx = buildEvidence({ spec: s, fitMap: [{ requirement: "Experience with high-volume payment flows", mustHave: true, score: 0.6, careerPointIds: ["ops"] }], points });
    expect(idx.entries[0]!.support).toEqual([{ pointId: "ops", via: "fitmap", score: 0.6, terms: [] }]);
  });
});

describe("coverage", () => {
  const index = buildEvidence({ spec, fitMap: [], points });
  const content = (bullets: string[], skills: string[] = []): ResumeContent => ({
    name: "A", contact: {}, education: [], projects: [], skills: skills.length ? [{ group: "Core", items: skills }] : [],
    experience: [{ careerPointId: "acme", title: "Backend Engineer", company: "Acme", bullets: bullets.map((text, i) => ({ id: `b${i}`, text, careerPointIds: ["acme"], weight: 1 })) }],
  });

  it("scores supported must-haves shown, alias aware or by the job's exact spelling", () => {
    const c = content(["Built REST APIs in TypeScript", "Migrated billing to Postgres", "Ran K8s clusters", "Owned services end to end"]);
    expect(coverageScore(index, c)).toEqual({ shown: 4, total: 4, pct: 100, missing: [] });
    const exact = coverageScore(index, c, "exact");
    expect(exact.missing).toEqual(["PostgreSQL experience", "Kubernetes and Terraform in production"]);
    expect(coverageScore(index, content(["Built REST APIs in TypeScript"], ["PostgreSQL", "Kubernetes"]), "exact").shown).toBe(3);
  });

  it("does not count a lacked term against coverage: only what the person has must show", () => {
    const e = index.entries.find((x) => x.text.startsWith("Kubernetes"))!;
    expect(requirementShown(e, "Ran Kubernetes clusters")).toBe(true);
  });

  it("knows which requirements a bullet's own text supports", () => {
    expect(bulletSupports(index, "Migrated billing to Postgres", ["acme"]).map((e) => e.text)).toEqual(["PostgreSQL experience"]);
    expect(bulletSupports(index, "Wrote docs", ["acme"])).toEqual([]);
  });
});

describe("soft requirements and key phrases", () => {
  it("supports a soft requirement only where a point shows the behaviour", () => {
    const s: JobSpec = { ...spec, mustHaves: ["Ability to manage feature development end-to-end", "Experience working in high-growth startup environments", "Comfortable with ambiguity"], niceToHaves: [], skills: [] };
    const fit = [{ requirement: "Comfortable with ambiguity", mustHave: true, score: 0.9, careerPointIds: ["acme"] }];
    const idx = buildEvidence({ spec: s, fitMap: fit, points, similarity: () => 0.9 });
    const [e2e, startup, amb] = idx.entries;
    expect(e2e!.soft).toBe("end-to-end");
    expect(e2e!.keyPhrase).toBe("end-to-end");
    expect(e2e!.support).toEqual([{ pointId: "ops", via: "behaviour", score: 0.8, terms: [] }]);
    expect(e2e!.mirror).toBe(true);
    // No point shows startup work or ambiguity: gaps, whatever the fit map or embeddings say.
    expect(startup!.supported).toBe(false);
    expect(startup!.keyPhrase).toBe("high-growth startup environments");
    expect(amb!.supported).toBe(false);
    expect(amb!.related).toEqual(["acme"]);
  });

  it("gives a soft requirement to the line that shows it, not to every line of the role", () => {
    const s: JobSpec = { ...spec, mustHaves: ["Own services end-to-end"], niceToHaves: [], skills: [] };
    const idx = buildEvidence({ spec: s, fitMap: [], points });
    expect(bulletSupports(idx, "Owned services end to end, from design to on-call", ["ops"]).map((e) => e.text)).toEqual(["Own services end-to-end"]);
    expect(bulletSupports(idx, "Ran K8s clusters for the payments team", ["ops"])).toEqual([]);
  });

  it("measures key phrases verbatim: the phrase mode", () => {
    const s: JobSpec = { ...spec, mustHaves: ["Experience building and operating production services", "Build REST APIs in TypeScript"], niceToHaves: [], skills: [] };
    const pts = [{ ...points[0]!, text: "Built and operated production services in TypeScript\nBuilt REST APIs in TypeScript" }];
    const idx = buildEvidence({ spec: s, fitMap: [], points: pts });
    const one = (bullets: string[]): ResumeContent => ({
      name: "A", contact: {}, education: [], projects: [], skills: [],
      experience: [{ careerPointId: "acme", title: "Backend Engineer", company: "Acme", bullets: bullets.map((text, i) => ({ id: `b${i}`, text, careerPointIds: ["acme"], weight: 1 })) }],
    });
    expect(idx.entries[0]!.keyPhrase).toBe("production services");
    expect(coverageScore(idx, one(["Operated live backend systems", "Built REST APIs in TypeScript"]), "phrase").pct).toBe(50);
    expect(coverageScore(idx, one(["Built and operated production services", "Built REST APIs in TypeScript"]), "phrase").pct).toBe(100);
  });
});

describe("keyPhraseOf", () => {
  it("keeps the posting's own words and drops the lead-in", () => {
    expect(keyPhraseOf("Experience building and operating production services")).toBe("production services");
    expect(keyPhraseOf("Experience working with large, heterogeneous datasets")).toBe("large, heterogeneous datasets");
    expect(keyPhraseOf("Ability to manage feature development end-to-end")).toBe("end-to-end");
    expect(keyPhraseOf("Experience owning end-to-end analytics and model development projects")).toBe("end-to-end");
    expect(keyPhraseOf("Ability to collaborate with product, engineering, and business stakeholders")).toBe("business stakeholders");
    expect(keyPhraseOf("Experience in Higher Education vertical sales")).toBe("Higher Education vertical sales");
    expect(keyPhraseOf("5+ years of experience designing scalable data pipelines and APIs")).toBe("scalable data pipelines");
  });

  it("matches phrases word for word, ignoring case, commas and hyphens", () => {
    expect(containsPhrase("Owned the flow end to end, shipping weekly", "end-to-end")).toBe(true);
    expect(containsPhrase("Modelled large heterogeneous datasets", "large, heterogeneous datasets")).toBe(true);
    expect(containsPhrase("Modelled large datasets", "large, heterogeneous datasets")).toBe(false);
  });
});
