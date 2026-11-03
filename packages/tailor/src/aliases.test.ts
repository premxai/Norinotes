import { describe, expect, it } from "vitest";
import { ALIAS_GROUPS, acronymPair, aliasGroupOf, canonicalTerm, parseAliasTable } from "./aliases.js";
import { countTerm, findTerms, mentionsSkill, sameSkill } from "./text.js";
import { BANNED_PHRASES, bannedIn, bannedPhraseExamples, openerTense } from "./phrases.js";
import { releaseYearOf } from "./release-years.js";

describe("alias table", () => {
  it("has at least 150 terms across tech, business and healthcare, with unique names", () => {
    expect(ALIAS_GROUPS.length).toBeGreaterThanOrEqual(150);
    const seen = new Map<string, string>();
    for (const g of ALIAS_GROUPS) for (const n of new Set(g.names.map((x) => x.toLowerCase()))) {
      expect(seen.get(n), `${n} is in both ${seen.get(n)} and ${g.display}`).toBeUndefined();
      seen.set(n, g.display);
    }
    for (const t of ["kubernetes", "fp&a", "electronic health records", "basic life support", "customer relationship management", "search engine optimization"]) {
      expect(aliasGroupOf(t), t).not.toBeNull();
    }
  });

  it("maps aliases and acronyms to one canonical term", () => {
    expect(canonicalTerm("K8s")).toBe("kubernetes");
    expect(canonicalTerm("continuous integration")).toBe("ci/cd");
    expect(canonicalTerm("JS")).toBe("javascript");
    expect(canonicalTerm("Postgres")).toBe("postgresql");
    expect(canonicalTerm("machine learning")).toBe(canonicalTerm("ML"));
    expect(canonicalTerm("Amazon Web Services")).toBe("aws");
    expect(canonicalTerm("EMR")).toBe(canonicalTerm("Electronic Health Records"));
    expect(canonicalTerm("Something Unknown")).toBe("something unknown");
    expect(sameSkill("Postgres", "PostgreSQL")).toBe(true);
    expect(sameSkill("Docker", "Kubernetes")).toBe(false);
  });

  it("matches short ambiguous names only with their exact case", () => {
    expect(mentionsSkill("Built services in Go and Python", "Go")).toBe(true);
    expect(mentionsSkill("Ready to go live next week", "Go")).toBe(false);
    expect(mentionsSkill("Triage in the ED during night shifts", "Emergency Department")).toBe(true);
    expect(mentionsSkill("He edited the report", "Emergency Department")).toBe(false);
    expect(mentionsSkill("Charted in Epic daily", "Epic")).toBe(true);
    expect(mentionsSkill("an epic effort", "Epic")).toBe(false);
    expect(mentionsSkill("Modelled in R and SQL", "R")).toBe(true);
    expect(mentionsSkill("Funded R&D for the lab", "R")).toBe(false);
  });

  it("finds every table term in a text, first mention first, as written", () => {
    const found = findTerms("Ran K8s and Terraform on AWS; wrote Postgres migrations and CI/CD pipelines");
    expect(found.map((f) => f.key)).toEqual(["kubernetes", "terraform", "aws", "postgresql", "ci/cd"]);
    expect(found[0]!.as).toBe("K8s");
    expect(findTerms("Charge nurse on a med-surg unit, BLS and ACLS certified").map((f) => f.key))
      .toEqual(["charge nurse", "medical-surgical", "basic life support", "advanced cardiovascular life support"]);
  });

  it("does not read a sales-qualified lead as the query language", () => {
    expect(mentionsSkill("MQL to SQL conversion up from 14% to 21%", "SQL")).toBe(false);
    expect(findTerms("Rebuilt nurture flows; MQL to SQL conversion rose").map((f) => f.key)).toEqual([]);
    expect(mentionsSkill("Automated reconciliations with SQL and VBA", "SQL")).toBe(true);
  });

  it("counts every spelling of a term", () => {
    expect(countTerm("Kubernetes here, K8s there, kubernetes again", "Kubernetes")).toBe(3);
  });

  it("pairs acronyms with long forms, not spelling variants", () => {
    expect(acronymPair("AWS")).toEqual({ acronym: "AWS", long: "amazon web services" });
    expect(acronymPair("Electronic Health Records")?.acronym).toBe("EHR");
    expect(acronymPair("FP&A")?.long).toBe("financial planning and analysis");
    expect(acronymPair("Postgres")).toBeNull();
    expect(acronymPair("Kubernetes")).toBeNull();
  });

  it("parses case-sensitive names", () => {
    const [g] = parseAliasTable("~Go | golang; ~GO");
    expect(g).toEqual({ key: "go", display: "Go", names: ["Go", "golang", "GO"], exact: ["Go", "GO"] });
  });
});

describe("style lists", () => {
  it("bans generic phrases, whole words only", () => {
    expect(BANNED_PHRASES.length).toBeGreaterThan(40);
    expect(bannedIn("Leveraged synergies and spearheaded a results-driven, cutting-edge rollout")).toEqual(
      expect.arrayContaining(["leveraged", "synergies", "spearheaded", "results-driven", "cutting-edge"]));
    expect(bannedIn("Responsible for the API and worked on billing")).toEqual(["responsible for", "worked on"]);
    expect(bannedIn("Built the billing API in Go")).toEqual([]);
    expect(bannedIn("Managed 3 paid media specialists")).toEqual([]);
    expect(bannedIn("Demonstrated strong proficiency in TypeScript as tech lead")).toEqual(["demonstrated strong proficiency"]);
    expect(bannedPhraseExamples()).toContain("leverag");
    expect(bannedPhraseExamples()).toContain("results-driven");
  });

  it("reads the tense of an opening verb", () => {
    expect(openerTense("Built the API")).toBe("past");
    expect(openerTense("Reduced latency")).toBe("past");
    expect(openerTense("Build the API")).toBe("present");
    expect(openerTense("Manages a team")).toBe("present");
    expect(openerTense("Quarterly planning")).toBe("unknown");
  });

  it("knows when common tools were released", () => {
    expect(releaseYearOf("kubernetes")).toBe(2014);
    expect(releaseYearOf("langchain")).toBe(2022);
    expect(releaseYearOf("cobol")).toBeNull();
  });
});
