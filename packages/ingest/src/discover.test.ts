import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { companies } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import ashbyBoard from "./__fixtures__/ashby-board.json";
import ghBoard from "./__fixtures__/greenhouse-board.json";
import { json, noSleep, publicLookup, routeFetch } from "./__fixtures__/helpers.js";
import leverBoard from "./__fixtures__/lever-board.json";
import { BlockedSourceError } from "./blocklist.js";
import { boardsInPage, CompanyInputError, companyNameKey, discoverCompany, MAX_VERIFY_REQUESTS, tokensForName } from "./discover.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t.close(); });
beforeEach(async () => { await t.db.delete(companies); });

const GH = "https://boards-api.greenhouse.io/v1/boards/";
const ASHBY = "https://api.ashbyhq.com/posting-api/job-board/";
const LEVER = "https://api.lever.co/v0/postings/";
const opts = (fetch: typeof globalThis.fetch) => ({ fetch, lookup: publicLookup, http: noSleep });
const urls = (f: { mock: { calls: unknown[][] } }) => f.mock.calls.map((c) => String(c[0]));
const html = (body: string, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers: { "content-type": "text/html", ...headers } });
const robotsTxt = (body: string) => () => new Response(body, { headers: { "content-type": "text/plain" } });

describe("discoverCompany: discovery", () => {
  it("adds a board from its own link after reading its live feed", async () => {
    const f = routeFetch({ [`${GH}acme/jobs`]: () => json(ghBoard) });
    const res = await discoverCompany(t.db, "https://job-boards.greenhouse.io/acme", opts(f));
    expect(res).toMatchObject({ status: "added", openJobs: ghBoard.jobs.length, company: { atsType: "greenhouse", token: "acme", name: "Acme Robotics", status: "active" } });
    const [row] = await t.db.select().from(companies);
    expect(row).toMatchObject({ atsToken: "acme", discoveredVia: "user", status: "active", host: "boards-api.greenhouse.io" });
    expect(urls(f)).toContain("https://boards-api.greenhouse.io/robots.txt");
  });

  it("finds a board from a company name by trying the tokens it is likely to use on each system", async () => {
    const f = routeFetch({ [`${ASHBY}initech`]: () => json(ashbyBoard) });
    const res = await discoverCompany(t.db, "Initech, Inc.", opts(f));
    expect(res).toMatchObject({ status: "added", company: { atsType: "ashby", token: "initech", name: "Initech, Inc." } });
    expect(urls(f)).toContain(`${GH}initech/jobs?content=true`); // Greenhouse was tried first and had no board
    expect(urls(f).every((u) => !/linkedin|indeed|glassdoor|google|bing/.test(u))).toBe(true);
  });

  it("finds the board a company's careers page links to, reading the page once", async () => {
    const page = '<html><a href="https://jobs.lever.co/globex">Open roles</a><script>{"u":"https:\\/\\/jobs.lever.co\\/globex\\/abc"}</script></html>';
    const f = routeFetch({ "https://globex.example/careers": () => html(page), [`${LEVER}globex`]: () => json(leverBoard) });
    const res = await discoverCompany(t.db, "globex.example/careers", opts(f));
    expect(res).toMatchObject({ status: "added", company: { atsType: "lever", token: "globex" } });
    expect(urls(f).filter((u) => u === "https://globex.example/careers")).toHaveLength(1);
    expect(urls(f)).toContain("https://globex.example/robots.txt");
  });

  it("takes the board from a careers page that redirects to it, without requesting the board page", async () => {
    const f = routeFetch({
      "https://acme.example/jobs": () => new Response(null, { status: 302, headers: { location: "https://boards.greenhouse.io/acme" } }),
      [`${GH}acme/jobs`]: () => json(ghBoard),
    });
    expect(await discoverCompany(t.db, "https://acme.example/jobs", opts(f))).toMatchObject({ status: "added", company: { token: "acme" } });
    expect(urls(f).some((u) => u.startsWith("https://boards.greenhouse.io/"))).toBe(false);
  });

  it("says plainly when nothing is found", async () => {
    const noBoard = await discoverCompany(t.db, "https://quiet.example/careers", opts(routeFetch({ "https://quiet.example/careers": () => html("<p>We are not hiring</p>") })));
    expect(noBoard).toEqual({ status: "not_found", message: "Nori couldn't find a job board linked from quiet.example. Nori can add boards on Greenhouse, Ashby, Lever, Workable, Rippling or Workday." });
    const noName = await discoverCompany(t.db, "Nowhere Widgets", opts(routeFetch({})));
    expect(noName).toMatchObject({ status: "not_found", message: expect.stringMatching(/^Nori couldn't find a public job board for Nowhere Widgets\./) });
    expect(await t.db.select().from(companies)).toHaveLength(0);
  });

  it("refuses LinkedIn, Indeed and Glassdoor without a request", async () => {
    const f = routeFetch({});
    for (const link of ["https://www.linkedin.com/company/acme/jobs", "indeed.com/cmp/acme", "https://www.glassdoor.co.uk/Overview/acme", "https://lnkd.in/abc"]) {
      await expect(discoverCompany(t.db, link, opts(f))).rejects.toBeInstanceOf(CompanyInputError);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses a careers page that links out to LinkedIn only and never follows that link", async () => {
    const f = routeFetch({ "https://acme.example/careers": () => html('<a href="https://www.linkedin.com/company/acme/jobs">Jobs</a>') });
    expect(await discoverCompany(t.db, "https://acme.example/careers", opts(f))).toMatchObject({ status: "not_found" });
    expect(urls(f).some((u) => u.includes("linkedin"))).toBe(false);
  });

  it("refuses blocked aggregators", async () => {
    await expect(discoverCompany(t.db, "Jobgether", opts(routeFetch({})))).rejects.toBeInstanceOf(BlockedSourceError);
    await expect(discoverCompany(t.db, "https://jobs.lever.co/jobgether", opts(routeFetch({})))).rejects.toBeInstanceOf(BlockedSourceError);
  });
});

describe("discoverCompany: verification", () => {
  it("does not add a board whose feed says it does not exist", async () => {
    const res = await discoverCompany(t.db, "https://jobs.lever.co/ghost", opts(routeFetch({ [`${LEVER}ghost`]: () => json({ ok: false }, 404) })));
    expect(res).toMatchObject({ status: "not_found", message: expect.stringMatching(/didn't answer as a live public board/) });
    expect(await t.db.select().from(companies)).toHaveLength(0);
  });

  it("does not add an empty board guessed from a name (it may be a different company)", async () => {
    const f = routeFetch({ [`${GH}hooli/jobs`]: () => json({ jobs: [] }) });
    expect(await discoverCompany(t.db, "Hooli", opts(f))).toMatchObject({ status: "not_found" });
    expect(await t.db.select().from(companies)).toHaveLength(0);
  });

  it("reads a big board only far enough to see it answer", async () => {
    const posting = (i: number) => ({ title: `Engineer ${i}`, externalPath: `/job/US-CA/Engineer_JR${i}`, postedOn: "Posted Today", bulletFields: [`JR${i}`] });
    const list = (_url: string, init?: RequestInit) => {
      const offset = Number(JSON.parse(String(init?.body ?? "{}")).offset ?? 0);
      return json({ total: 1000, facets: [], jobPostings: Array.from({ length: 20 }, (_, k) => posting(offset + k)) });
    };
    const f = routeFetch({ "https://bigco.wd1.myworkdayjobs.com/wday/cxs/bigco/External/jobs": list });
    const res = await discoverCompany(t.db, "https://bigco.wd1.myworkdayjobs.com/en-US/External", opts(f));
    expect(res).toMatchObject({ status: "added", company: { atsType: "workday", token: "bigco|wd1|External", name: "Bigco" } });
    expect(urls(f).filter((u) => !u.endsWith("/robots.txt")).length).toBeLessThanOrEqual(MAX_VERIFY_REQUESTS);
  });

  it("never requests a feed that robots.txt disallows", async () => {
    const f = routeFetch({ "https://api.lever.co/robots.txt": robotsTxt("User-agent: *\nDisallow: /v0/"), [`${LEVER}globex`]: () => json(leverBoard) });
    expect(await discoverCompany(t.db, "https://jobs.lever.co/globex", opts(f))).toMatchObject({ status: "not_found", message: expect.stringMatching(/doesn't allow automated reading/) });
    expect(urls(f).some((u) => u.startsWith(`${LEVER}globex`))).toBe(false);
  });

  it("never reads a careers page that robots.txt disallows, nor one whose robots.txt is unreadable", async () => {
    const disallowed = routeFetch({ "https://acme.example/robots.txt": robotsTxt("User-agent: NorinoteJobAgent\nDisallow: /careers"), "https://acme.example/careers": () => html("") });
    expect(await discoverCompany(t.db, "https://acme.example/careers", opts(disallowed))).toMatchObject({ status: "not_found", message: expect.stringMatching(/doesn't allow automated reading/) });
    expect(urls(disallowed)).toEqual(["https://acme.example/robots.txt"]);
    const down = routeFetch({ "https://down.example/robots.txt": () => new Response("", { status: 500 }), "https://down.example/careers": () => html("") });
    expect(await discoverCompany(t.db, "https://down.example/careers", opts(down))).toMatchObject({ status: "not_found", message: expect.stringMatching(/couldn't check whether down.example allows/) });
    expect(urls(down)).toEqual(["https://down.example/robots.txt"]);
  });
});

describe("discoverCompany: dedupe", () => {
  it("returns a board already in the registry without any request", async () => {
    await t.db.insert(companies).values({ name: "Acme Robotics", atsType: "greenhouse", atsToken: "acme", discoveredVia: "registry" });
    const f = routeFetch({});
    expect(await discoverCompany(t.db, "https://boards.greenhouse.io/ACME/jobs/123", opts(f))).toMatchObject({ status: "exists", company: { name: "Acme Robotics", token: "acme" } });
    expect(await discoverCompany(t.db, "acme robotics inc", opts(f))).toMatchObject({ status: "exists", company: { token: "acme" } });
    expect(await discoverCompany(t.db, "ACME", opts(f))).toMatchObject({ status: "exists", company: { token: "acme" } }); // the token a name would use
    expect(f).not.toHaveBeenCalled();
    expect(await t.db.select().from(companies)).toHaveLength(1);
  });

  it("matches the boards a careers page links to against the registry before reading any feed", async () => {
    await t.db.insert(companies).values({ name: "Globex", atsType: "lever", atsToken: "globex", discoveredVia: "seed:open-ats-feed" });
    const f = routeFetch({ "https://globex.example/careers": () => html('<iframe src="https://jobs.lever.co/globex?embed=1"></iframe>') });
    expect(await discoverCompany(t.db, "https://globex.example/careers", opts(f))).toMatchObject({ status: "exists", company: { token: "globex" } });
    expect(urls(f).some((u) => u.startsWith(LEVER))).toBe(false);
  });

  it("adds a board once when it is discovered twice", async () => {
    const f = routeFetch({ [`${GH}acme/jobs`]: () => json(ghBoard) });
    expect((await discoverCompany(t.db, "https://job-boards.greenhouse.io/acme", opts(f))).status).toBe("added");
    expect((await discoverCompany(t.db, "Acme Robotics", opts(f))).status).toBe("exists");
    expect(await t.db.select().from(companies)).toHaveLength(1);
  });
});

describe("discovery helpers", () => {
  it("guesses board tokens from a name", () => {
    expect(tokensForName("Acme Robotics, Inc.")).toEqual(["acmerobotics", "acme-robotics"]);
    expect(tokensForName("Initech Labs")).toEqual(["initechlabs", "initech-labs", "initech"]);
    expect(tokensForName("Stripe")).toEqual(["stripe"]);
  });

  it("keys company names the same way the registry match does", () => {
    expect(companyNameKey("Acme, Inc.")).toBe("acme");
    expect(companyNameKey("ACME Robotics LLC")).toBe("acmerobotics");
  });

  it("finds boards on allowed systems in a page and ignores the rest", () => {
    const page = [
      '<a href="https://boards.greenhouse.io/acme">a</a>',
      '<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>',
      '<a href="//jobs.ashbyhq.com/initech/a1">b</a>',
      '<a href="https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/X_1">c</a>',
      '<a href="https://jobs.smartrecruiters.com/Acme">parked</a>',
      '<a href="https://www.linkedin.com/company/acme">no</a>',
    ].join("");
    expect(boardsInPage(page)).toEqual([
      { atsType: "greenhouse", token: "acme" },
      { atsType: "ashby", token: "initech" },
      { atsType: "workday", token: "acme|wd5|Careers" },
    ]);
  });
});
