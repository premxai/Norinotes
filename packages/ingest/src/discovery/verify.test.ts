import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boardCandidates, companies, eq } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { json, noSleep, routeFetch, withRobots } from "../__fixtures__/helpers.js";
import { PRIORITY } from "../schedule.js";
import type { NormalizedJob } from "../types.js";
import { FAILS_TO_PARK, REVERIFY_MS, scoreJobs, verifyCandidates, type TargetClassifier } from "./verify.js";

const NOW = new Date("2026-11-20T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const classify: TargetClassifier = (title) => (/engineer/i.test(title) ? "software" : /product manager/i.test(title) ? "product" : null);

const job = (title: string, postedAt: Date | null, location: string | null = "New York, NY"): NormalizedJob => ({
  atsType: "greenhouse", externalId: title + String(postedAt?.getTime()), companyName: "Acme", companyToken: "acme", title, location,
  remote: false, descriptionText: "", applyUrl: "https://example.test", postedAt,
});

describe("scoreJobs", () => {
  it("counts open US jobs dated in the last 7 days, by target family", () => {
    const s = scoreJobs([
      job("Software Engineer", daysAgo(1)),
      job("Backend Engineer", daysAgo(6), "Remote"),
      job("Product Manager", daysAgo(2), "San Francisco, CA"),
      job("Account Executive", daysAgo(1)),
      job("Software Engineer", daysAgo(9)),
      job("Software Engineer", null),
      job("Software Engineer", daysAgo(1), "London, UK"),
    ], NOW, classify);
    expect(s).toEqual({ openJobs: 7, freshUsJobs: 4, targetJobs: { software: 2, product: 1 }, score: 3 });
  });
});

const gh = (jobs: { title: string; posted: Date; location?: string }[], company = "Acme Robotics") => json({
  jobs: jobs.map((j, i) => ({ id: i + 1, title: j.title, absolute_url: `https://job-boards.greenhouse.io/x/jobs/${i + 1}`, first_published: j.posted.toISOString(), location: { name: j.location ?? "Austin, TX" }, company_name: company })),
  meta: { total: jobs.length },
});

describe("verifyCandidates", () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.db.delete(boardCandidates);
    await t.db.delete(companies);
  });

  const add = (token: string, extra: Partial<typeof boardCandidates.$inferInsert> = {}) =>
    t.db.insert(boardCandidates).values({ atsType: "greenhouse", atsToken: token, name: token.charAt(0).toUpperCase() + token.slice(1), sources: ["seed:test"], ...extra }).returning();
  const row = async (token: string) => (await t.db.select().from(boardCandidates).where(eq(boardCandidates.atsToken, token)))[0]!;
  const base = { classify, now: () => NOW, http: noSleep, sleep: async () => {} };

  it("promotes a board at the bar into companies, and marks low-value, empty and dead boards", async () => {
    await add("acme");
    await add("thin");
    await add("empty");
    await add("gone");
    const fetch = withRobots(routeFetch({
      "https://boards-api.greenhouse.io/v1/boards/acme/": () => gh([{ title: "Software Engineer", posted: daysAgo(1) }, { title: "Product Manager", posted: daysAgo(3) }]),
      "https://boards-api.greenhouse.io/v1/boards/thin/": () => gh([{ title: "Software Engineer", posted: daysAgo(1) }, { title: "Account Executive", posted: daysAgo(1) }]),
      "https://boards-api.greenhouse.io/v1/boards/empty/": () => gh([]),
    }));
    const done = await verifyCandidates(t.db, { ...base, fetch });
    expect(Object.fromEntries(done.map((d) => [d.token, d.outcome]))).toEqual({ acme: "promoted", thin: "low_value", empty: "empty", gone: "dead" });

    const acme = await row("acme");
    expect(acme).toMatchObject({ status: "promoted", name: "Acme Robotics", openJobs: 2, freshUsJobs: 2, score: 2, targetJobs: { software: 1, product: 1 } });
    expect(acme.nextVerifyAt).toEqual(new Date(NOW.getTime() + REVERIFY_MS.promoted));
    const [company] = await t.db.select().from(companies).where(eq(companies.atsToken, "acme"));
    expect(company).toMatchObject({ id: acme.companyId, status: "active", discoveredVia: "seed:test", priority: PRIORITY.discovered, name: "Acme Robotics" });

    expect(await row("thin")).toMatchObject({ status: "low_value", score: 1, statusReason: expect.stringMatching(/1 fresh US jobs.*bar 2/) });
    expect(await row("empty")).toMatchObject({ status: "empty", openJobs: 0 });
    expect((await row("gone")).nextVerifyAt).toEqual(new Date(NOW.getTime() + REVERIFY_MS.dead));
    expect(await t.db.select().from(companies)).toHaveLength(1);

    // Nothing is due again until its re-verification time.
    expect(await verifyCandidates(t.db, { ...base, fetch })).toEqual([]);
  });

  it("only refreshes the numbers of a board already in the registry", async () => {
    const [live] = await t.db.insert(companies).values({ name: "Live", atsType: "greenhouse", atsToken: "live", status: "active", priority: 100 }).returning();
    await add("live", { status: "promoted", companyId: live!.id });
    const fetch = withRobots(routeFetch({ "https://boards-api.greenhouse.io/v1/boards/live/": () => gh([{ title: "Account Executive", posted: daysAgo(1) }]) }));
    const [done] = await verifyCandidates(t.db, { ...base, fetch });
    expect(done).toMatchObject({ outcome: "promoted" });
    expect(await row("live")).toMatchObject({ status: "promoted", score: 0, openJobs: 1 });
    expect((await t.db.select().from(companies))[0]).toMatchObject({ priority: 100 });
  });

  it("brings back a registry row that a validation poll left dead, but never a blocked one", async () => {
    await t.db.insert(companies).values([
      { name: "Back", atsType: "greenhouse", atsToken: "back", status: "dead", statusReason: "board not found" },
      { name: "Blocked", atsType: "greenhouse", atsToken: "blocked", status: "active", blocked: true },
    ]);
    await add("back");
    await add("blocked");
    const two = () => gh([{ title: "Software Engineer", posted: daysAgo(1) }, { title: "Data Engineer", posted: daysAgo(1) }]);
    const fetch = withRobots(routeFetch({ "https://boards-api.greenhouse.io/v1/boards/back/": two, "https://boards-api.greenhouse.io/v1/boards/blocked/": two }));
    await verifyCandidates(t.db, { ...base, fetch });
    const [back] = await t.db.select().from(companies).where(eq(companies.atsToken, "back"));
    expect(back).toMatchObject({ status: "active", statusReason: null, priority: PRIORITY.discovered, nextPollAt: NOW });
    expect(await row("blocked")).toMatchObject({ status: "disallowed", statusReason: "blocked in the registry" });
  });

  it("obeys robots.txt and marks the board disallowed without reading its feed", async () => {
    await add("acme");
    const feed = routeFetch({});
    await verifyCandidates(t.db, { ...base, fetch: withRobots(feed, "User-agent: *\nDisallow: /v1/") });
    expect(feed).not.toHaveBeenCalled();
    expect(await row("acme")).toMatchObject({ status: "disallowed", nextVerifyAt: new Date(NOW.getTime() + REVERIFY_MS.disallowed) });
  });

  it("retries a failing board a day later and parks it after FAILS_TO_PARK failures", async () => {
    await add("flaky", { errorStreak: FAILS_TO_PARK - 2 });
    const fetch = withRobots(routeFetch({ "https://boards-api.greenhouse.io/v1/boards/flaky/": () => new Response("boom", { status: 500 }) }));
    const [first] = await verifyCandidates(t.db, { ...base, fetch });
    expect(first).toMatchObject({ outcome: "retry" });
    expect(await row("flaky")).toMatchObject({ status: "new", errorStreak: FAILS_TO_PARK - 1, nextVerifyAt: daysAgo(-1) });
    const [second] = await verifyCandidates(t.db, { ...base, fetch, now: () => daysAgo(-1) });
    expect(second).toMatchObject({ outcome: "failing" });
    expect(await row("flaky")).toMatchObject({ status: "failing", errorStreak: FAILS_TO_PARK });
  });

  it("reads one board at a time per feed host with the gap between boards", async () => {
    await add("a");
    await add("b");
    await add("c");
    let inFlight = 0;
    let most = 0;
    const gaps: number[] = [];
    const fetch = withRobots(routeFetch({
      "https://boards-api.greenhouse.io/v1/boards/": async () => {
        most = Math.max(most, ++inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return gh([]);
      },
    }));
    await verifyCandidates(t.db, { ...base, fetch, gapMs: 1234, sleep: async (ms) => { gaps.push(ms); } });
    expect(most).toBe(1);
    expect(gaps).toEqual([1234, 1234]);
  });
});
