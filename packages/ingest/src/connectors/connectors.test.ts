import { describe, expect, it } from "vitest";
import ashbyBoard from "../__fixtures__/ashby-board.json";
import ghBoard from "../__fixtures__/greenhouse-board.json";
import ghJob from "../__fixtures__/greenhouse-job.json";
import { json, noSleep, routeFetch } from "../__fixtures__/helpers.js";
import leverBoard from "../__fixtures__/lever-board.json";
import srDetail from "../__fixtures__/smartrecruiters-detail.json";
import srList from "../__fixtures__/smartrecruiters-list.json";
import { RateLimitedError } from "../http.js";
import { ashby, CONNECTORS, getConnector, greenhouse, greenhouseFormUrl, isSupportedAts, lever, matchJobUrl, oracle, smartrecruiters, workday } from "./index.js";

describe("greenhouse", () => {
  it("normalises the board", async () => {
    const f = routeFetch({ "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true": () => json(ghBoard) });
    const out = await greenhouse.listJobs("acme", { fetch: f });
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      atsType: "greenhouse", externalId: "4001", companyToken: "acme", companyName: "Acme Robotics", title: "Senior Frontend Engineer",
      location: "Remote - US", remote: true, applyUrl: "https://boards.greenhouse.io/acme/jobs/4001",
    });
    expect(out[0]?.descriptionText).toBe("Build UI with React & TypeScript.\n\n- 4+ years of experience\n- Café culture");
    // first_published wins over updated_at
    expect(out[0]?.postedAt?.toISOString()).toBe("2025-02-10T14:00:00.000Z");
    expect(out[1]).toMatchObject({ companyName: "Acme", remote: false, location: "New York, NY" });
    expect(out[1]?.postedAt?.toISOString()).toBe("2025-03-02T15:00:00.000Z");
    expect(out[2]).toMatchObject({ location: null, descriptionText: "", postedAt: null });
  });

  it("returns [] for an unknown board, throws on a server error, and surfaces rate limiting", async () => {
    expect(await greenhouse.listJobs("missing", { fetch: routeFetch({}) })).toEqual([]);
    await expect(greenhouse.listJobs("x", { fetch: routeFetch({ "https://": () => new Response("boom", { status: 500 }) }) })).rejects.toThrow(/500/);
    await expect(greenhouse.listJobs("x", { fetch: routeFetch({ "https://": () => new Response("", { status: 429 }) }), ...noSleep })).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("fetches one job", async () => {
    const f = routeFetch({ "https://boards-api.greenhouse.io/v1/boards/acme/jobs/4001?content=true": () => json(ghJob) });
    expect(await greenhouse.fetchJob?.("acme", "4001", { fetch: f })).toMatchObject({ externalId: "4001", title: "Senior Frontend Engineer", descriptionText: "Build UI." });
    expect(await greenhouse.fetchJob?.("acme", "9", { fetch: f })).toBeNull();
  });

  it("recognises board, posting and embed URLs", () => {
    expect(greenhouse.parseUrl("https://boards.greenhouse.io/acme/jobs/4001")).toEqual({ token: "acme", externalId: "4001" });
    expect(greenhouse.parseUrl("https://job-boards.greenhouse.io/acme/jobs/4001?gh_src=x")).toEqual({ token: "acme", externalId: "4001" });
    expect(greenhouse.parseUrl("https://job-boards.eu.greenhouse.io/acme/jobs/4001")).toEqual({ token: "acme", externalId: "4001" });
    expect(greenhouse.parseUrl("https://boards.greenhouse.io/acme")).toEqual({ token: "acme", externalId: null });
    expect(greenhouse.parseUrl("https://job-boards.greenhouse.io/embed/job_app?for=acme&token=4001")).toEqual({ token: "acme", externalId: "4001" });
    expect(greenhouse.parseUrl("https://job-boards.greenhouse.io/embed/job_app")).toBeNull();
    expect(greenhouse.parseUrl("https://jobs.lever.co/acme/1")).toBeNull();
  });
});

describe("greenhouseFormUrl", () => {
  const job = (applyUrl: string, atsType = "greenhouse", externalId = "7746572") => ({ atsType, applyUrl, externalId });

  it("sends a company-hosted Greenhouse posting to the embedded form", () => {
    expect(greenhouseFormUrl(job("https://www.coinbase.com/careers/positions/7746572?gh_jid=7746572"), "coinbase"))
      .toBe("https://job-boards.greenhouse.io/embed/job_app?for=coinbase&token=7746572");
  });

  it("leaves Greenhouse's own addresses alone and needs a token, numeric id and Greenhouse job", () => {
    expect(greenhouseFormUrl(job("https://job-boards.greenhouse.io/vercel/jobs/123"), "vercel")).toBeNull();
    expect(greenhouseFormUrl(job("https://www.coinbase.com/careers/positions/7746572"), null)).toBeNull();
    expect(greenhouseFormUrl(job("https://www.coinbase.com/x", "greenhouse", "abc"), "coinbase")).toBeNull();
    expect(greenhouseFormUrl(job("https://jobs.lever.co/acme/1", "lever"), "acme")).toBeNull();
  });
});

describe("lever", () => {
  it("normalises postings, joining description, lists and closing text", async () => {
    const f = routeFetch({ "https://api.lever.co/v0/postings/globex?mode=json": () => json(leverBoard) });
    const out = await lever.listJobs("globex", { fetch: f });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      atsType: "lever", externalId: "11111111-aaaa-bbbb-cccc-222222222222", companyName: "Globex", title: "Backend Engineer",
      location: "San Francisco, CA", remote: false, applyUrl: "https://jobs.lever.co/globex/11111111-aaaa-bbbb-cccc-222222222222",
    });
    expect(out[0]?.descriptionText).toBe("Build services in Go.\n\nRequirements\n- Go\n- Postgres\n\nWe are an equal opportunity employer.");
    expect(out[0]?.postedAt?.getTime()).toBe(1700000000000);
    expect(out[1]).toMatchObject({ remote: true, location: "Anywhere" });
  });

  it("returns [] on 404, fetches one posting, and parses URLs", async () => {
    expect(await lever.listJobs("nope", { fetch: routeFetch({}) })).toEqual([]);
    const f = routeFetch({ "https://api.lever.co/v0/postings/globex/3333": () => json(leverBoard[1]) });
    expect(await lever.fetchJob?.("globex", "3333", { fetch: f })).toMatchObject({ title: "Designer" });
    expect(await lever.fetchJob?.("globex", "gone", { fetch: f })).toBeNull();
    expect(lever.parseUrl("https://jobs.lever.co/globex/11111111-aaaa")).toEqual({ token: "globex", externalId: "11111111-aaaa" });
    expect(lever.parseUrl("https://jobs.eu.lever.co/globex")).toEqual({ token: "globex", externalId: null });
    expect(lever.parseUrl("https://example.com/globex/1")).toBeNull();
  });
});

describe("ashby", () => {
  it("normalises listed jobs only, using plain text or stripped HTML", async () => {
    const f = routeFetch({ "https://api.ashbyhq.com/posting-api/job-board/initech": () => json(ashbyBoard) });
    const out = await ashby.listJobs("initech", { fetch: f });
    expect(out.map((j) => j.externalId)).toEqual(["a1", "a2"]);
    expect(out[0]).toMatchObject({
      companyName: "Initech", remote: true, location: "Remote", descriptionText: "Train models",
      applyUrl: "https://jobs.ashbyhq.com/initech/a1/application",
    });
    expect(out[0]?.postedAt?.toISOString()).toBe("2025-01-02T00:00:00.000Z");
    expect(out[1]).toMatchObject({ remote: false, applyUrl: "https://jobs.ashbyhq.com/initech/a2", postedAt: null });
    expect(out[1]?.descriptionText).toBe("Run the platform.\n\n- Kubernetes");
  });

  it("fetches one job from the board and parses URLs", async () => {
    const f = routeFetch({ "https://api.ashbyhq.com/posting-api/job-board/initech": () => json(ashbyBoard) });
    expect(await ashby.fetchJob?.("initech", "a2", { fetch: f })).toMatchObject({ title: "Platform Engineer" });
    expect(await ashby.fetchJob?.("initech", "a3", { fetch: f })).toBeNull();
    expect(ashby.parseUrl("https://jobs.ashbyhq.com/initech/a1")).toEqual({ token: "initech", externalId: "a1" });
    expect(ashby.parseUrl("https://jobs.ashbyhq.com/Acme%20Co")).toEqual({ token: "Acme Co", externalId: null });
    expect(ashby.parseUrl("https://ashbyhq.com/initech")).toBeNull();
  });
});

describe("smartrecruiters", () => {
  const routes = () => routeFetch({
    "https://api.smartrecruiters.com/v1/companies/Hooli/postings/743999": () => json(srDetail),
    "https://api.smartrecruiters.com/v1/companies/Hooli/postings/744000": () => new Response("boom", { status: 500 }),
    "https://api.smartrecruiters.com/v1/companies/Hooli/postings?": () => json(srList),
  });

  it("lists, reads each detail, and keeps list data when a detail fails", async () => {
    const out = await smartrecruiters.listJobs("Hooli", { fetch: routes() });
    expect(out.map((j) => j.externalId)).toEqual(["743999", "744000"]);
    expect(out[0]).toMatchObject({
      companyName: "Hooli", title: "SRE", location: "Austin, US", remote: false, applyUrl: "https://jobs.smartrecruiters.com/Hooli/743999-sre",
    });
    expect(out[0]?.descriptionText).toBe("Job Description\nKeep it up\n\nQualifications\n- Kubernetes");
    expect(out[0]?.postedAt?.toISOString()).toBe("2025-03-15T12:00:00.000Z");
    expect(out[1]).toMatchObject({ remote: true, descriptionText: "", applyUrl: "https://jobs.smartrecruiters.com/Hooli/744000", postedAt: new Date("2025-04-01T00:00:00.000Z") });
  });

  it("returns [] for an unknown company, fetches one job, and parses URLs", async () => {
    expect(await smartrecruiters.listJobs("Nobody", { fetch: routeFetch({}) })).toEqual([]);
    expect(await smartrecruiters.fetchJob?.("Hooli", "743999", { fetch: routes() })).toMatchObject({ title: "SRE" });
    expect(await smartrecruiters.fetchJob?.("Hooli", "1", { fetch: routes() })).toBeNull();
    expect(smartrecruiters.parseUrl("https://jobs.smartrecruiters.com/Hooli/743999-site-reliability-engineer")).toEqual({ token: "Hooli", externalId: "743999" });
    expect(smartrecruiters.parseUrl("https://careers.smartrecruiters.com/Hooli")).toEqual({ token: "Hooli", externalId: null });
  });
});

describe("connector registry", () => {
  it("covers every job system; Workday and Oracle are stubs that throw", async () => {
    expect(Object.keys(CONNECTORS).sort()).toEqual(["ashby", "greenhouse", "lever", "oracle", "smartrecruiters", "workday"]);
    expect(getConnector("lever")).toBe(lever);
    expect(isSupportedAts("greenhouse")).toBe(true);
    expect(isSupportedAts("workday")).toBe(false);
    await expect(workday.listJobs("t|wd5|site")).rejects.toThrow(/not implemented/);
    await expect(oracle.listJobs("x")).rejects.toThrow(/not implemented/);
    await expect(workday.fetchJob?.("t", "1")).rejects.toThrow(/not implemented/);
  });

  it("matches a URL to the right connector", () => {
    expect(matchJobUrl("https://jobs.ashbyhq.com/initech/a1")).toMatchObject({ token: "initech", externalId: "a1" });
    expect(matchJobUrl("https://jobs.ashbyhq.com/initech/a1")?.connector).toBe(ashby);
    expect(matchJobUrl("https://example.com/careers/1")).toBeNull();
  });
});
