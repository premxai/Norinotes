import { describe, expect, it } from "vitest";
import { buildVocab, supportOf, validateBullet, validateSummary } from "./validate.js";

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
