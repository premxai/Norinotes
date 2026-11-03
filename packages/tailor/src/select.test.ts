import { describe, expect, it } from "vitest";
import type { CareerPoint, FitMapEntry } from "@norinote/shared";
import { SPEC } from "./test-fixtures.js";
import { baselineContent, bulletCount, entryWeight, functionWords, orderSkills, selectContent, splitBullets, targetYears, yearsOfExperience } from "./select.js";

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

  it("orders bullets in a role by the requirements their own text supports, must-haves first, ties in written order", () => {
    const { content } = selectContent({ points, fitMap, spec: SPEC, contact, now: NOW });
    const acme = content.experience.find((r) => r.careerPointId === "acme")!;
    // The two lines that show must-haves (TypeScript REST APIs, PostgreSQL) lead; the Redis achievement shows a nice-to-have;
    // the onboarding line supports nothing and the role already has its three bullets.
    expect(acme.bullets.map((b) => b.id)).toEqual(["acme#0", "acme#1", "redis"]);
    expect(acme.bullets[2]!.careerPointIds).toEqual(["redis", "acme"]);
    expect(acme.bullets[0]!.weight).toBeGreaterThan(acme.bullets[2]!.weight);
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

  it("lists every skill the job names that the user really has first, in the job's order, then the rest by use", () => {
    const { content } = selectContent({ points, fitMap, spec: SPEC, contact, now: NOW });
    const core = content.skills.find((g) => g.group === "Core")!;
    // Must-have terms first (REST APIs, TypeScript, PostgreSQL), then nice-to-haves; Kubernetes is asked for, but the user
    // has none, so it is not listed. "REST APIs" is shown because the Acme text says so, not because a skills list does.
    expect(core.items).toEqual(["REST APIs", "TypeScript", "PostgreSQL", "Redis", "Rust", "Docker"]);
    const extra = content.skills.find((g) => g.group === "Additional")!;
    expect(extra.items).toEqual(expect.arrayContaining(["React", "Flutter"]));
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
    expect(covers.get("acme#0")).toEqual(["Build REST APIs in TypeScript"]);
    expect(covers.get("acme#1")).toEqual(["PostgreSQL experience"]);
  });

  it("falls back to skill mentions when there is no fit map", () => {
    const { content } = selectContent({ points, fitMap: [], spec: SPEC, contact, now: NOW });
    const acme = content.experience.find((r) => r.careerPointId === "acme")!;
    expect(acme.bullets[0]!.text).toMatch(/TypeScript|PostgreSQL|Redis/);
    expect(content.projects).toEqual([]);
  });

  it("uses the job's exact spelling of a skill the user writes differently", () => {
    const groups = orderSkills([pt("a", { kind: "role", title: "x", skills: ["Postgres", "JS"] })], ["JavaScript", "PostgreSQL"]);
    expect(groups[0]!.items).toEqual(["JavaScript", "PostgreSQL"]);
    expect(groups.flatMap((g) => g.items)).not.toContain("Postgres");
  });

  it("adds the long form or acronym once when the user writes the other one", () => {
    const groups = orderSkills([pt("a", { kind: "role", title: "x", skills: ["Amazon Web Services", "machine learning"] })], ["AWS", "Machine Learning", "ML"]);
    expect(groups[0]!.items).toEqual(["Amazon Web Services (AWS)", "Machine Learning"]);
  });

  it("finds a job's skill in the user's text, not only in skills lists, and never lists one the user lacks", () => {
    const groups = orderSkills([pt("a", { kind: "role", title: "Analyst", text: "Built weekly dashboards in Tableau for the sales team" })], ["Tableau", "Looker"]);
    expect(groups[0]!.items).toEqual(["Tableau"]);
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

describe("selection rules", () => {
  const line = (n: number, what: string) => `${what} number ${n} with TypeScript for the platform team`;
  const roles: CareerPoint[] = [
    pt("now", { kind: "role", title: "Engineer", org: "Now Co", startDate: "2023-01", text: [1, 2, 3, 4, 5, 6].map((n) => line(n, "Built service")).join("\n") }),
    pt("mid", { kind: "role", title: "Engineer", org: "Mid Co", startDate: "2020-01", endDate: "2022-12", text: "Answered support tickets\nBuilt TypeScript tools for support\nWrote PostgreSQL reports" }),
    pt("old", { kind: "role", title: "Engineer", org: "Old Co", startDate: "2012-01", endDate: "2015-12", text: "Built TypeScript prototypes\nFiled reports\nUsed TypeScript for internal demos\nRan meetings" }),
  ];
  const f = [fit("TypeScript", ["now", "mid", "old"], 0.9, true), fit("PostgreSQL", ["mid", "old"], 0.8, true)];

  it("gives the latest and recent roles 3 to 5 bullets and older ones 1 to 2", () => {
    const { content } = selectContent({ points: roles, fitMap: f, spec: SPEC, contact, now: NOW });
    const n = Object.fromEntries(content.experience.map((r) => [r.company, r.bullets.length]));
    expect(n["Now Co"]).toBe(5);
    expect(n["Mid Co"]).toBe(3);
    expect(n["Old Co"]).toBe(2);
  });

  it("puts each role's best-supported bullet first, so the one-page fitter (which keeps the heaviest) never drops it", () => {
    const { content } = selectContent({ points: roles, fitMap: f, spec: SPEC, contact, now: NOW });
    const old = content.experience.find((r) => r.company === "Old Co")!;
    expect(old.bullets.map((b) => b.text)).toEqual(["Built TypeScript prototypes", "Used TypeScript for internal demos"]);
    const mid = content.experience.find((r) => r.company === "Mid Co")!;
    expect(mid.bullets[0]!.weight).toBe(Math.max(...mid.bullets.map((b) => b.weight)));
  });

  it("bulletCount: at least 3 for recent or relevant roles even without support, at most 5; 1 or 2 for older ones", () => {
    expect(bulletCount([0, 0, 0, 0], true)).toBe(3);
    expect(bulletCount([2, 2, 2, 2, 2, 2, 2], true)).toBe(5);
    expect(bulletCount([2, 1], true)).toBe(2);
    expect(bulletCount([2, 1, 0], false)).toBe(2);
    expect(bulletCount([2, 0, 0], false)).toBe(1);
    expect(bulletCount([0, 0], false)).toBe(1);
  });

  it("baselineContent keeps the user's own order and wording, the before side of the report", () => {
    const base = baselineContent(roles, contact);
    expect(base.experience[0]!.bullets.map((b) => b.text)).toEqual([1, 2, 3, 4, 5].map((n) => line(n, "Built service")));
    expect(base.summary).toBeUndefined();
  });
});

describe("years of experience for the summary", () => {
  it("counts only roles in the person's own function, never earlier analyst or assistant years", () => {
    const pm: CareerPoint[] = [
      pt("a", { kind: "role", title: "Senior Product Manager", org: "Ledgerline", startDate: "2023-05", text: "Own the invoicing roadmap with TypeScript teams" }),
      pt("b", { kind: "role", title: "Product Manager", org: "Meridian", startDate: "2020-06", endDate: "2023-04", text: "Managed the reporting module" }),
      pt("c", { kind: "role", title: "Business Analyst", org: "Deloitte", startDate: "2017-01", endDate: "2019-06", text: "Wrote TypeScript reports for clients" }),
    ];
    const sel = selectContent({ points: pm, fitMap: [fit("TypeScript", ["a", "c"], 0.9, true)], spec: SPEC, contact, now: NOW });
    expect(sel.years).toBe(5);
    expect(yearsOfExperience(pm, NOW)).toBe(8);
    expect([...functionWords("Registered Nurse, Telemetry Unit (Charge Nurse)")]).toEqual(["registered", "nurse", "telemetry", "charge"]);
    expect([...functionWords("Nursing Assistant (CNA)")]).toEqual(["nursing", "cna"]);
  });
});

describe("job mirroring in selection", () => {
  it("makes the latest role's first three bullets each address a different supported must-have", () => {
    const pts: CareerPoint[] = [pt("now", {
      kind: "role", title: "Backend Engineer", org: "Now Co", startDate: "2022-01",
      text: [
        "Built TypeScript services for billing with 99.9% uptime",
        "Built TypeScript services for payouts with typed clients",
        "Tuned PostgreSQL queries for the reporting team",
        "Ran Redis caches in front of the slowest endpoints",
        "Wrote TypeScript tooling for local development",
      ].join("\n"),
    })];
    const spec = { ...SPEC, mustHaves: ["TypeScript", "PostgreSQL", "Redis"], niceToHaves: [], skills: [] };
    const sel = selectContent({ points: pts, fitMap: [], spec, contact, now: NOW });
    const top = sel.content.experience[0]!.bullets.slice(0, 3);
    expect(top.map((b) => sel.focus.get(b.id))).toEqual(["TypeScript", "PostgreSQL", "Redis"]);
    expect(top.map((b) => b.text)).toEqual([
      "Built TypeScript services for billing with 99.9% uptime", "Tuned PostgreSQL queries for the reporting team", "Ran Redis caches in front of the slowest endpoints",
    ]);
  });

  it("counts summary years in the target function from the person's own dates, none below 2", () => {
    const roles: CareerPoint[] = [
      pt("a", { kind: "role", title: "Senior Data Scientist", startDate: "2022-01", text: "x" }),
      pt("b", { kind: "role", title: "Data Analyst", startDate: "2019-01", endDate: "2021-12", text: "x" }),
      pt("c", { kind: "role", title: "Barista", startDate: "2015-01", endDate: "2018-12", text: "x" }),
    ];
    expect(targetYears(roles, "Data Scientist II", NOW)).toBe(7);
    expect(targetYears(roles, "Machine Learning Scientist", NOW)).toBe(4);
    expect(targetYears(roles, "Registered Nurse", NOW)).toBeNull();
    expect(targetYears([pt("n", { kind: "role", title: "Software Engineer", startDate: "2025-09", text: "x" })], "Software Engineer", NOW)).toBeNull();
  });
});
