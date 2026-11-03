import { describe, expect, it } from "vitest";
import { buildVocab, gateBullet, newNumbers, supportOf, untruthfulTitle, validateBullet, validateSummary, yearClaims, yearsVerdict, type GateContext } from "./validate.js";

const original = "Built REST APIs in TypeScript serving 2M requests per day";
const roleText = `Backend Engineer\nAcme\n${original}\nMigrated the billing service to PostgreSQL, cutting query time by 40%\nTypeScript, PostgreSQL, REST`;
const support = supportOf([original, roleText]);
const vocab = buildVocab({
  userSkills: ["TypeScript", "PostgreSQL", "REST", "Redis"], specSkills: ["TypeScript", "PostgreSQL", "Kubernetes"],
  orgs: ["Acme", "Globex"], titles: ["Backend Engineer", "Engineering Manager"],
});
const check = (text: string) => validateBullet(original, text, support, vocab);

describe("validateBullet", () => {
  it("accepts a reword that only reorders and tightens what the career point says", () => {
    expect(check("Built TypeScript REST APIs serving 2M requests per day")).toEqual({ ok: true });
    expect(check("Delivered REST APIs in TypeScript at 2M requests per day")).toEqual({ ok: true });
  });

  it("rejects a skill the career points do not contain", () => {
    const v = check("Built REST APIs in TypeScript on Kubernetes serving 2M requests per day");
    expect(v).toMatchObject({ ok: false });
    expect((v as { reason: string }).reason).toMatch(/Kubernetes/);
  });

  it("rejects a skill that is common tech but not in the spec either", () => {
    expect(check("Built REST APIs in TypeScript with Terraform serving 2M requests per day")).toMatchObject({ ok: false, reason: expect.stringMatching(/terraform/i) });
  });

  it("rejects a skill that exists in the user's graph but not in the source this bullet comes from", () => {
    // Redis is the user's skill, but from a different role: moving it here would claim something this role did not do.
    expect(check("Built REST APIs in TypeScript with Redis serving 2M requests per day")).toMatchObject({ ok: false, reason: expect.stringMatching(/Redis/) });
  });

  it("rejects a new employer", () => {
    expect(check("Built REST APIs in TypeScript at Globex serving 2M requests per day")).toMatchObject({ ok: false, reason: expect.stringMatching(/Globex/) });
    expect(check("Built REST APIs in TypeScript for Stripe serving 2M requests per day")).toMatchObject({ ok: false, reason: expect.stringMatching(/Stripe/) });
  });

  it("rejects a new title or seniority claim", () => {
    expect(check("Served as Engineering Manager building REST APIs in TypeScript at 2M requests per day")).toMatchObject({ ok: false, reason: expect.stringMatching(/title/i) });
    expect(check("Built senior REST APIs in TypeScript serving 2M requests per day")).toMatchObject({ ok: false, reason: expect.stringMatching(/senior/i) });
  });

  it("rejects an invented number but accepts numbers already present", () => {
    expect(check("Built REST APIs in TypeScript serving 5M requests per day")).toMatchObject({ ok: false, reason: expect.stringMatching(/5/) });
    expect(check("Built REST APIs in TypeScript serving 2M requests per day with 40% less query time")).toEqual({ ok: true });
  });

  it("rejects raised ownership, first person, filler, bad length and no-op rewrites", () => {
    expect(check("Led the team that built REST APIs in TypeScript serving 2M requests per day")).toMatchObject({ ok: false, reason: expect.stringMatching(/led/i) });
    expect(check("I built REST APIs in TypeScript serving 2M requests per day")).toMatchObject({ ok: false, reason: expect.stringMatching(/first-person/) });
    expect(check("Built robust REST APIs in TypeScript serving 2M requests per day")).toMatchObject({ ok: false, reason: expect.stringMatching(/robust/) });
    expect(check("Built APIs")).toMatchObject({ ok: false, reason: expect.stringMatching(/length/) });
    expect(check(original)).toMatchObject({ ok: false, reason: "unchanged" });
    expect(check("   ")).toMatchObject({ ok: false });
  });

  it("treats a known alias as the same skill", () => {
    const aliasVocab = buildVocab({ userSkills: ["PostgreSQL"], specSkills: [], orgs: [], titles: [] });
    const src = supportOf(["Migrated the billing service to Postgres, cutting query time by 40%"]);
    expect(validateBullet("Migrated the billing service to Postgres, cutting query time by 40%", "Migrated billing to PostgreSQL, cutting query time by 40%", src, aliasVocab)).toEqual({ ok: true });
  });
});

describe("validateSummary", () => {
  const corpus = supportOf([roleText, "Reduced p95 latency from 800ms to 200ms by adding Redis caching"]);
  const sv = (s: string, years: number | null = 5) => validateSummary(s, corpus, vocab, { years });

  it("accepts a short summary built from the career", () => {
    expect(sv("Backend engineer with 5 years of experience building TypeScript REST APIs on PostgreSQL. Cut latency with Redis caching.")).toEqual({ ok: true });
  });

  it("rejects more years than the dates show, and numbers that are not in the career", () => {
    expect(sv("Backend engineer with 8 years of experience building TypeScript REST APIs on PostgreSQL.")).toMatchObject({ ok: false, reason: expect.stringMatching(/8 years/) });
    expect(sv("Backend engineer building TypeScript REST APIs for 3 million users on PostgreSQL.")).toMatchObject({ ok: false, reason: expect.stringMatching(/3/) });
  });

  it("rejects a new skill, an employer, and a summary that is too long or too short", () => {
    expect(sv("Backend engineer building TypeScript APIs on PostgreSQL and Kubernetes clusters in production.")).toMatchObject({ ok: false, reason: expect.stringMatching(/Kubernetes/) });
    expect(sv("Backend engineer who shipped TypeScript APIs on PostgreSQL at Initech and earlier at Acme.")).toMatchObject({ ok: false, reason: expect.stringMatching(/Initech/) });
    expect(sv("Fake")).toMatchObject({ ok: false, reason: "too short" });
    expect(sv("One thing here today. Two things there now. Three things over there too. Four things all around.")).toMatchObject({ ok: false });
  });
});

describe("gateBullet", () => {
  const line = "Built REST APIs in Node.js and Postgres serving 2M requests per day for the billing team";
  const src = supportOf([line, "Backend Engineer\nAcme\n2021-03 to present"]);
  const gv = buildVocab({ userSkills: ["Node.js", "PostgreSQL", "Redis"], specSkills: ["PostgreSQL", "Kubernetes", "Terraform"], orgs: ["Acme", "Globex"], titles: ["Backend Engineer", "Engineering Manager"] });
  const ctx = (extra: Partial<GateContext> = {}): GateContext => ({ source: src, original: line, vocab: gv, lackedTerms: ["Kubernetes", "Terraform"], ...extra });
  const good = "Built REST APIs in Node.js and PostgreSQL that serve 2M requests per day for the billing team's invoicing and payment flows";
  const rules = (text: string, extra: Partial<GateContext> = {}) => gateBullet(text, ctx(extra)).failures.map((f) => f.rule);

  it("passes a faithful rewrite that uses the job's spelling of a term the source has under an alias", () => {
    expect(gateBullet(good, ctx())).toEqual({ ok: true, failures: [] });
  });

  it("rejects a fabricated number, in digits or words", () => {
    expect(rules("Built REST APIs in Node.js and PostgreSQL that serve 5M requests per day for the billing team's invoicing flows")).toEqual(["number"]);
    expect(rules("Built REST APIs in Node.js and PostgreSQL for three teams, serving 2M requests per day across the billing and payment flows")).toEqual(["number"]);
  });

  it("rejects a fabricated tool the source does not name", () => {
    const g = gateBullet("Built REST APIs in Node.js, PostgreSQL and Redis that serve 2M requests per day for the billing team's payment flows", ctx());
    expect(g.failures).toEqual([{ rule: "tool", detail: expect.stringMatching(/Redis/) }]);
  });

  it("rejects a requirement the person lacks, reported as such", () => {
    const g = gateBullet("Built REST APIs in Node.js and PostgreSQL on Kubernetes serving 2M requests per day for the billing team's payment flows", ctx());
    expect(g.failures.map((f) => f.rule)).toEqual(["lacked_requirement"]);
    expect(g.failures[0]!.detail).toMatch(/Kubernetes/);
  });

  it("rejects a tool newer than the role", () => {
    const old = "Built web dashboards in React and Node.js for the support team, used daily by 40 agents across two offices";
    const oldSrc = supportOf([old, "Web Developer\nInitech\n2010-01 to 2012-06"]);
    const g = gateBullet("Built React dashboards with Node.js for the support team, used daily by 40 agents across both regional offices", { source: oldSrc, original: old, vocab: gv, roleYears: { start: 2010, end: 2012 } });
    expect(g.failures.map((f) => f.rule)).toEqual(["anachronism"]);
    expect(g.failures[0]!.detail).toMatch(/React \(released 2013\)/);
  });

  it("rejects an employer, a title and a proper noun the source does not have", () => {
    expect(rules("Built REST APIs in Node.js and PostgreSQL at Globex serving 2M requests per day for the billing team's payment flows")).toContain("employer");
    expect(rules("Built REST APIs as Engineering Manager in Node.js and PostgreSQL serving 2M requests per day for the billing team")).toContain("title");
    expect(rules("Built senior-level REST APIs in Node.js and PostgreSQL serving 2M requests per day for the billing team's flows")).toContain("title");
    expect(rules("Built REST APIs in Node.js and PostgreSQL for Stripe serving 2M requests per day across the billing team's flows")).toContain("proper_noun");
  });

  it("rejects bad length, banned phrases, first person and raised ownership", () => {
    expect(rules("Built REST APIs in Node.js")).toEqual(["length"]);
    expect(rules("Leveraged Node.js and PostgreSQL to build REST APIs serving 2M requests per day for the billing team's payment flows")).toEqual(["banned_phrase"]);
    expect(rules("Built REST APIs in Node.js and PostgreSQL that serve 2M requests per day for my billing team and its payment flows")).toEqual(["pronoun"]);
    expect(rules("Led the team building REST APIs in Node.js and PostgreSQL that serve 2M requests per day for billing flows")).toContain("inflation");
  });

  it("rejects an opening verb another bullet already uses", () => {
    expect(rules(good, { usedOpeners: new Set(["built"]) })).toEqual(["repeated_verb"]);
  });

  it("requires past tense for every bullet, the current role included", () => {
    expect(rules(good)).toEqual([]);
    expect(rules("Build REST APIs in Node.js and PostgreSQL that serve 2M requests per day for the billing team's payment flows")).toEqual(["tense"]);
    expect(rules("Leads REST API work in Node.js and PostgreSQL that serves 2M requests per day for the billing team's payment flows")).toContain("tense");
    expect(rules("Build REST APIs in Node.js and PostgreSQL that serve 2M requests per day for the billing team's payment flows", { tense: false })).toEqual([]);
  });

  it("rejects a term used more than three times across the resume", () => {
    const terms = [{ key: "postgresql", jobString: "PostgreSQL" }];
    const twice = "Built REST APIs in Node.js and PostgreSQL that serve 2M requests per day, keeping PostgreSQL queries fast for billing";
    expect(rules(twice, { termUses: { counts: new Map([["postgresql", 2]]), terms } })).toEqual(["overuse"]);
    expect(rules(twice, { termUses: { counts: new Map([["postgresql", 1]]), terms } })).toEqual([]);
    // Saying it as often as the original did is never overuse.
    expect(rules(good, { termUses: { counts: new Map([["postgresql", 5]]), terms } })).toEqual([]);
  });

  it("returns every failure at once, so the retry can fix them all", () => {
    expect(rules("Spearheaded Kubernetes work at Globex for 9 teams")).toEqual(expect.arrayContaining(["length", "number", "lacked_requirement", "employer", "banned_phrase"]));
  });

  it("newNumbers ignores numbers the source or the original has", () => {
    expect(newNumbers("Served 2M requests and 40% faster", supportOf(["2M requests, 40% faster"]))).toEqual([]);
    expect(newNumbers("Served dozens of teams", supportOf(["Served teams"]))).toEqual(["dozens"]);
  });
});

describe("untruthfulTitle", () => {
  it("allows the target title only if the person held it or in a targeted phrase", () => {
    expect(untruthfulTitle("Data Scientist with 4 years building models.", "Senior Data Scientist", ["Data Scientist"])).toBeNull();
    expect(untruthfulTitle("Data analyst with 4 years of SQL, ready for Data Scientist roles.", "Data Scientist", ["Data Analyst"])).toBeNull();
    expect(untruthfulTitle("Data Scientist with 4 years of SQL and dashboards.", "Data Scientist", ["Data Analyst"])).toBe("Data Scientist");
    expect(untruthfulTitle("Backend engineer building APIs.", "Staff Software Engineer", ["Backend Engineer"])).toBeNull();
  });
});

describe("summary years", () => {
  it("allows only the exact whole years in the target function, and only from 2 up", () => {
    expect(yearsVerdict("Backend engineer with 5 years of experience.", 5)).toEqual({ ok: true });
    expect(yearsVerdict("Backend engineer with 4 years of experience.", 5)).toMatchObject({ ok: false, reason: expect.stringMatching(/claims 4 years/) });
    expect(yearsVerdict("Backend engineer with five years of experience.", 5)).toEqual({ ok: true });
    expect(yearsVerdict("Backend engineer with 6+ years of experience.", 5)).toMatchObject({ ok: false });
    expect(yearsVerdict("New engineer with 1 year of experience.", null)).toMatchObject({ ok: false, reason: expect.stringMatching(/leave years out/) });
    expect(yearsVerdict("New engineer with a year of experience.", null)).toMatchObject({ ok: false });
    expect(yearsVerdict("Backend engineer building APIs.", null)).toEqual({ ok: true });
    expect(yearClaims("6 years in ops, 3-year plan, many years")).toEqual([6, 3]);
  });
});

describe("lacked soft requirements", () => {
  it("rejects startup or ownership wording the source does not show", () => {
    const src = supportOf(["Built REST APIs in Node.js serving 2M requests per day"]);
    const v = buildVocab({ userSkills: ["Node.js"], specSkills: [], orgs: [], titles: [] });
    const g = gateBullet("Built REST APIs in Node.js at high-growth startup pace, serving 2M requests per day for the billing team's flows",
      { source: src, original: "Built REST APIs in Node.js serving 2M requests per day", vocab: v, lackedPatterns: [/\bstart-?ups?\b|\bhigh[- ]growth\b/i] });
    expect(g.failures.map((f) => f.rule)).toEqual(["lacked_requirement"]);
  });
});
