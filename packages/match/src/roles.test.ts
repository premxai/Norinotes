import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { companies, eq, jobs } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { adjacentTitles, clearRolePoolCache, mainFamilyOf, roleFamilyOf, rolePool } from "./roles.js";
import { NOW, baseSpec, daysAgo, hoursAgo, seedCompany, seedJob } from "./test-helpers.js";

describe("roleFamilyOf", () => {
  const cases: Array<[string, string, string | null]> = [
    ["Frontend Engineer", "software_engineering", "frontend"],
    ["Front-End Developer", "software_engineering", "frontend"],
    ["Senior UI Engineer", "software_engineering", "frontend"],
    ["Software Engineer, Backend", "software_engineering", "backend"],
    ["Back End Engineer (Python)", "software_engineering", "backend"],
    ["Full-Stack Software Engineer", "software_engineering", "full_stack"],
    ["iOS Engineer", "software_engineering", "mobile"],
    ["Android Developer", "software_engineering", "mobile"],
    ["Site Reliability Engineer", "software_engineering", "infrastructure"],
    ["DevOps Engineer", "software_engineering", "infrastructure"],
    ["Platform Engineer", "software_engineering", "infrastructure"],
    ["Machine Learning Engineer", "software_engineering", "data_ml"],
    ["Data Engineer", "software_engineering", "data_ml"],
    ["Research Scientist, Machine Learning", "software_engineering", "data_ml"],
    ["Application Security Engineer", "software_engineering", "security"],
    ["Software Engineer II, Payments", "software_engineering", "general"],
    ["Staff Engineer", "software_engineering", "general"],
    ["Engineering Manager, Data Platform", "software_engineering", "data_ml"],
    ["Software Engineer, Sales Tools", "software_engineering", "general"],
    ["Product Manager, Growth", "marketing", null],
    ["Senior Product Manager", "product", null],
    ["Technical Product Manager", "product", null],
    ["Associate Product Manager", "product", null],
    ["Product Designer", "design", null],
    ["UX Researcher", "design", null],
    ["Data Analyst", "data_analysis", null],
    ["Data Scientist, Growth", "data_analysis", null],
    ["Business Intelligence Analyst", "data_analysis", null],
    ["Account Executive, Enterprise", "sales", null],
    ["Sales Engineer", "sales", null],
    ["Sales Development Representative", "sales", null],
    ["Product Marketing Manager", "marketing", null],
    ["Content Strategist", "marketing", null],
    ["Customer Success Manager", "customer_success", null],
    ["Solutions Engineer", "customer_success", null],
    ["Technical Support Engineer", "customer_success", null],
    ["Operations Manager", "operations", null],
    ["Technical Program Manager", "operations", null],
    ["Chief of Staff", "operations", null],
    ["Financial Analyst", "finance", null],
    ["Senior Accountant", "finance", null],
    ["Technical Recruiter", "people", null],
    ["People Operations Partner", "people", null],
    ["Corporate Counsel", "legal", null],
    ["Paralegal", "legal", null],
    ["Mechanical Engineer", "other", null],
    ["Barista", "unknown", null],
    ["Registered Nurse | Telemetry", "healthcare", null],
    ["Charge Nurse", "healthcare", null],
    ["Physical Therapist", "healthcare", null],
    ["Clinical Research Coordinator", "healthcare", null],
    ["Mathematics Teacher", "education", null],
    ["Software Engineering Instructor", "education", null],
    ["Nurse Recruiter", "people", null],
    ["Clinical Data Scientist", "data_analysis", null],
    ["Hardware Lab Engineer Intern", "other", null],
    ["Senior SDET", "software_engineering", "quality"],
    ["Middle Manual QA Engineer (Growth)", "software_engineering", "quality"],
  ];
  it.each(cases)("%s -> %s", (title, family, subfamily) => {
    const c = roleFamilyOf(title);
    expect(c.family).toBe(family);
    expect(c.subfamily).toBe(subfamily);
  });

  it("reads seniority from the title", () => {
    expect(roleFamilyOf("Senior Frontend Engineer").seniority).toBe("senior");
    expect(roleFamilyOf("Staff Software Engineer").seniority).toBe("staff");
    expect(roleFamilyOf("Software Engineering Intern").seniority).toBe("intern");
    expect(roleFamilyOf("Engineering Manager").seniority).toBe("manager");
    expect(roleFamilyOf("New Grad Software Engineer").seniority).toBe("entry");
    expect(roleFamilyOf("Software Engineer").seniority).toBe("unknown");
  });

  it("is deterministic and insensitive to case and punctuation", () => {
    expect(roleFamilyOf("FRONT-END ENGINEER")).toEqual(roleFamilyOf("frontend engineer"));
    expect(roleFamilyOf("Frontend Engineer")).toEqual(roleFamilyOf("Frontend Engineer"));
  });

  it("names a main family from lane titles and suggests neighbours in the same family", () => {
    expect(mainFamilyOf(["Frontend Engineer", "UI Engineer", "Product Manager"])).toBe("software_engineering");
    expect(mainFamilyOf(["Barista"])).toBe("other");
    expect(adjacentTitles("Frontend Engineer")).toEqual(expect.arrayContaining(["Software Engineer", "UI Engineer"]));
    expect(adjacentTitles("Product Manager")).toContain("Technical Product Manager");
    expect(adjacentTitles("Barista")).toEqual([]);
  });
});

describe("rolePool", () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(() => clearRolePoolCache());

  it("returns the freshest open jobs of one family and place, newest first, with read jobs ahead of unread ones on the same day", async () => {
    const co = await seedCompany(t.db, { name: "PoolCo" });
    const blocked = await seedCompany(t.db, { name: "Blocked", blocked: true });
    const sf = (title: string, over: Partial<Parameters<typeof seedJob>[1]> = {}) => seedJob(t.db, { companyId: co, title, location: "San Francisco, CA", ...over });
    const newest = await sf("Software Engineer, Newest", { postedAt: hoursAgo(5) });
    const unread = await sf("Backend Engineer, Unread", { postedAt: hoursAgo(48), firstSeenAt: hoursAgo(48) });
    const read = await sf("Frontend Engineer, Read", { postedAt: hoursAgo(48), firstSeenAt: hoursAgo(48), spec: baseSpec() });
    const older = await sf("Platform Engineer, Older", { postedAt: hoursAgo(70) });
    const remote = await seedJob(t.db, { companyId: co, title: "Software Engineer, Remote", location: "Remote - US", remote: true, postedAt: hoursAgo(24) });
    const out = [
      await sf("Software Engineer, Too Old", { postedAt: hoursAgo(73), firstSeenAt: hoursAgo(73) }),
      await sf("Software Engineer, Closed", { closedAt: daysAgo(1) }),
      await seedJob(t.db, { companyId: blocked, title: "Software Engineer, Blocked", location: "San Francisco, CA" }),
      await sf("Product Manager, Wrong Family"),
      await sf("Sales Engineer, Wrong Family"),
      await seedJob(t.db, { companyId: co, title: "Software Engineer, London", location: "London, UK" }),
    ];

    const sfOnly = await rolePool(t.db, { family: "software_engineering", metro: "San Francisco, CA", limit: 50, now: NOW });
    expect(sfOnly.map((p) => p.jobId)).toEqual([newest, read, unread, older]);
    expect(sfOnly[1]!.quality).toBe(2);
    expect(sfOnly[2]!.quality).toBe(0);
    expect(sfOnly[0]).toMatchObject({ title: "Software Engineer, Newest", companyName: "PoolCo", remote: false });
    for (const id of out) expect(sfOnly.map((p) => p.jobId)).not.toContain(id);

    const withRemote = await rolePool(t.db, { family: "software_engineering", metro: "San Francisco", remote: true, limit: 50, now: NOW });
    expect(withRemote.map((p) => p.jobId)).toEqual([newest, remote, read, unread, older]);

    const remoteOnly = await rolePool(t.db, { family: "software_engineering", remote: true, now: NOW });
    expect(remoteOnly.map((p) => p.jobId)).toEqual([remote]);

    expect((await rolePool(t.db, { family: "software_engineering", metro: "San Francisco, CA", limit: 2, now: NOW })).map((p) => p.jobId)).toEqual([newest, read]);
    expect(await rolePool(t.db, { family: "other", now: NOW })).toEqual([]);
  });

  it("caches a pool per family, metro and remote for an hour", async () => {
    const co = await seedCompany(t.db, { name: "CacheCo" });
    const first = await seedJob(t.db, { companyId: co, title: "Product Manager, Cache A", location: "Austin, TX", postedAt: daysAgo(1) });
    const opts = { family: "product" as const, metro: "Austin, TX", now: NOW };
    expect((await rolePool(t.db, opts)).map((p) => p.jobId)).toEqual([first]);

    const second = await seedJob(t.db, { companyId: co, title: "Product Manager, Cache B", location: "Austin, TX", postedAt: daysAgo(0.5) });
    // Served from memory: the new job is not there yet, even though the database has it.
    expect((await rolePool(t.db, opts)).map((p) => p.jobId)).toEqual([first]);
    expect((await rolePool(t.db, { ...opts, now: new Date(NOW.getTime() + 59 * 60_000) })).map((p) => p.jobId)).toEqual([first]);
    // A different key is its own pool.
    expect((await rolePool(t.db, { ...opts, remote: true })).map((p) => p.jobId)).toEqual([second, first]);

    // After the hour, or after clearing, the pool is read again.
    expect((await rolePool(t.db, { ...opts, now: new Date(NOW.getTime() + 61 * 60_000) })).map((p) => p.jobId)).toEqual([second, first]);
    clearRolePoolCache();
    await t.db.update(jobs).set({ closedAt: NOW }).where(eq(jobs.id, first));
    expect((await rolePool(t.db, opts)).map((p) => p.jobId)).toEqual([second]);
    await t.db.update(companies).set({ blocked: true }).where(eq(companies.id, co));
    clearRolePoolCache();
    expect(await rolePool(t.db, opts)).toEqual([]);
  });
});
