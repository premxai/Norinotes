import { describe, expect, it } from "vitest";
import type { CareerPoint, FitMapEntry } from "@norinote/shared";
import { SPEC } from "./test-fixtures.js";
import { entryWeight, orderSkills, selectContent, splitBullets, yearsOfExperience } from "./select.js";

const pt = (id: string, p: Partial<CareerPoint> & Pick<CareerPoint, "kind" | "title">): CareerPoint => ({
  id, org: null, startDate: null, endDate: null, text: "", skills: [], scope: {}, metrics: {}, sourceQuote: null, ...p,
});
const fit = (requirement: string, ids: string[], score = 0.8, mustHave = false): FitMapEntry => ({ requirement, mustHave, score, careerPointIds: ids });
const contact = { name: "Ada Lovelace", email: "ada@example.test" };
const NOW = new Date("2026-06-01");

describe("selectContent", () => {
  const points: CareerPoint[] = [
    pt("acme", { kind: "role", title: "Backend Engineer", org: "Acme", startDate: "2021-03", text: "Built REST APIs in TypeScript serving 2M requests per day\nMigrated the billing service to PostgreSQL, cutting query time by 40%\nWrote onboarding docs for new engineers", skills: ["TypeScript", "PostgreSQL"] }),
    pt("redis", { kind: "achievement", title: "Caching", org: "Acme", startDate: "2022-06", text: "Reduced p95 latency from 800ms to 200ms by adding Redis caching", skills: ["Redis"] }),
    pt("globex", { kind: "role", title: "Intern", org: "Globex", startDate: "2020-06", endDate: "2020-09", text: "Built dashboards in React", skills: ["React"] }),
    pt("cafe", { kind: "role", title: "Barista", org: "Cafe", startDate: "2018-05", endDate: "2019-08", text: "Served customers and managed the till" }),
    pt("router", { kind: "project", title: "Pocket Router", text: "Built a Rust load balancer for 10000 connections", skills: ["Rust"] }),
    pt("recipes", { kind: "project", title: "Recipe App", text: "Built a recipe sharing app", skills: ["Flutter"] }),
    pt("school", { kind: "education", title: "BS Computer Science", org: "State University", startDate: "2017", endDate: "2021" }),
    pt("docker", { kind: "skill", title: "Docker" }),
  ];
  const fitMap = [
    fit("Build REST APIs in TypeScript", ["acme"], 0.9, true),
    fit("PostgreSQL experience", ["acme"], 0.8, true),
    fit("Redis caching", ["redis"], 0.7),
    fit("Rust systems work", ["router"], 0.6),
    fit("Kubernetes", [], 0),
  ];

  it("weights must-haves double and scales by score", () => {
    expect(entryWeight(fit("a", [], 0.9, true))).toBeCloseTo(1.8);
    expect(entryWeight(fit("a", [], 0.5, false))).toBeCloseTo(0.5);
  });

  it("orders bullets in a role by the weight of the requirements they cover, ties in written order", () => {
    const { content } = selectContent({ points, fitMap, spec: SPEC, contact, now: NOW });
    const acme = content.experience.find((r) => r.careerPointId === "acme")!;
    // The Redis achievement covers a requirement of its own and inherits half of the role's; the three text lines share the role's credit.
    expect(acme.bullets.map((b) => b.id)).toEqual(["redis", "acme#0", "acme#1", "acme#2"]);
    expect(acme.bullets[0]!.careerPointIds).toEqual(["redis", "acme"]);
    expect(acme.bullets[0]!.weight).toBeGreaterThan(acme.bullets[3]!.weight);
  });

  it("shows roles most recent first and keeps zero-weight roles only if room remains", () => {
    const { content } = selectContent({ points, fitMap, spec: SPEC, contact, now: NOW });
    expect(content.experience.map((r) => r.company)).toEqual(["Acme", "Globex", "Cafe"]);
  });

  it("picks roles by coverage but always keeps the latest", () => {
    const many: CareerPoint[] = [
      pt("r1", { kind: "role", title: "Dev", org: "A", startDate: "2025-01", text: "Did unrelated support work for customers" }),
      pt("r2", { kind: "role", title: "Dev", org: "B", startDate: "2023-01", endDate: "2024-12", text: "Built TypeScript services" }),
      pt("r3", { kind: "role", title: "Dev", org: "C", startDate: "2021-01", endDate: "2022-12", text: "Built PostgreSQL schemas" }),
      pt("r4", { kind: "role", title: "Dev", org: "D", startDate: "2019-01", endDate: "2020-12", text: "Built Redis caches" }),
      pt("r5", { kind: "role", title: "Dev", org: "E", startDate: "2017-01", endDate: "2018-12", text: "Answered phones" }),
      pt("r6", { kind: "role", title: "Dev", org: "F", startDate: "2015-01", endDate: "2016-12", text: "Filed paperwork" }),
    ];
    const f = [fit("TypeScript", ["r2"], 0.9, true), fit("PostgreSQL", ["r3"], 0.8, true), fit("Redis", ["r4"], 0.7)];
    const { content } = selectContent({ points: many, fitMap: f, spec: SPEC, contact, now: NOW });
    // r1 is the latest (kept despite covering nothing); the three covering roles fill the rest; E and F are cut.
    expect(content.experience.map((r) => r.company)).toEqual(["A", "B", "C", "D"]);
  });

  it("caps bullets by role position and includes only projects that cover a requirement", () => {
    const { content } = selectContent({ points, fitMap, spec: SPEC, contact, now: NOW });
    expect(content.projects.map((p) => p.name)).toEqual(["Pocket Router"]);
    expect(content.experience[0]!.bullets.length).toBeLessThanOrEqual(5);
    expect(content.experience[1]!.bullets.length).toBeLessThanOrEqual(4);
  });

  it("orders skills like the posting, then the rest by use", () => {
    const { content } = selectContent({ points, fitMap, spec: SPEC, contact, now: NOW });
    const core = content.skills.find((g) => g.group === "Core")!;
    // The posting lists TypeScript, PostgreSQL, Kubernetes, Docker, Redis; the user has no Kubernetes and it is not invented.
    expect(core.items).toEqual(["TypeScript", "PostgreSQL", "Docker", "Redis"]);
    const extra = content.skills.find((g) => g.group === "Additional")!;
    expect(extra.items).toEqual(expect.arrayContaining(["React", "Rust", "Flutter"]));
    expect(extra.items).not.toContain("Kubernetes");
  });

  it("counts years from covering roles only", () => {
    const sel = selectContent({ points, fitMap, spec: SPEC, contact, now: NOW });
    // Acme (2021-03 to now) + the Globex internship are covered... Globex is not in the fit map, so only Acme counts: 5 years.
    expect(sel.years).toBe(5);
    expect(yearsOfExperience(points.filter((p) => p.kind === "role"), NOW)).toBe(6);
  });

  it("records the requirements each bullet supports", () => {
    const { covers } = selectContent({ points, fitMap, spec: SPEC, contact, now: NOW });
    expect(covers.get("redis")).toEqual(["Redis caching"]);
    expect(covers.get("acme#0")).toEqual(["Build REST APIs in TypeScript", "PostgreSQL experience"]);
  });

  it("falls back to skill mentions when there is no fit map", () => {
    const { content } = selectContent({ points, fitMap: [], spec: SPEC, contact, now: NOW });
    const acme = content.experience.find((r) => r.careerPointId === "acme")!;
    expect(acme.bullets[0]!.text).toMatch(/TypeScript|PostgreSQL|Redis/);
    expect(content.projects).toEqual([]);
  });

  it("uses the user's own spelling of a skill the posting names differently", () => {
    const groups = orderSkills([pt("a", { kind: "role", title: "x", skills: ["Postgres", "JS"] })], ["JavaScript", "PostgreSQL"]);
    expect(groups[0]!.items).toEqual(["JS", "Postgres"]);
  });
});

describe("splitBullets", () => {
  it("splits lines, strips bullet marks, and breaks one long paragraph into sentences", () => {
    expect(splitBullets("- Built a thing\n* Shipped another thing")).toEqual(["Built a thing", "Shipped another thing"]);
    const long = `${"Built the ingest pipeline for the data team and ".repeat(3)}shipped it to production. Cut the cost of the nightly job by half after profiling it. Wrote runbooks for the on-call rotation and trained the team to use them well in practice.`;
    expect(splitBullets(long).length).toBeGreaterThan(1);
    expect(splitBullets("")).toEqual([]);
  });
});
