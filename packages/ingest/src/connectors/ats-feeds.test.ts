import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { noSleep, routeFetch } from "../__fixtures__/helpers.js";
import { RateLimitedError } from "../http.js";
import type { ListResult } from "../types.js";
import { bamboohr, breezy, icims, personio, pinpoint, recruitee, rippling, teamtailor, workable } from "./index.js";
import { IcimsBlockedError } from "./icims.js";

const fx = (name: string) => readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), "utf8");
const fj = <T = unknown>(name: string): T => JSON.parse(fx(name)) as T;
const reply = (body: string, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers });
const asList = (r: unknown): ListResult => r as ListResult;
const headerOf = (f: { mock: { calls: unknown[][] } }, call: number, name: string) =>
  ((f.mock.calls[call]?.[1] as RequestInit | undefined)?.headers as Record<string, string> | undefined)?.[name];

describe("workable", () => {
  const url = "https://apply.workable.com/api/v1/widget/accounts/";

  it("normalises the widget response and merges rows that share a shortcode", async () => {
    const f = routeFetch({ [`${url}1000heads?details=true`]: () => reply(fx("workable-widget.json")) });
    const r = asList(await workable.listJobs("1000heads", { fetch: f }));
    expect(r.complete).toBe(true);
    expect(r.jobs).toHaveLength(2);
    expect(r.jobs[0]).toMatchObject({
      atsType: "workable", externalId: "E4335D00D8", companyName: "1000heads", companyToken: "1000heads", title: "Account Director",
      location: "New York, New York, United States", remote: false, applyUrl: "https://apply.workable.com/j/E4335D00D8/apply",
    });
    expect(r.jobs[0]?.postedAt?.toISOString()).toBe("2026-07-28T00:00:00.000Z");
    expect(r.jobs[0]?.descriptionText).toMatch(/^The Account Director will be responsible/);
    expect(r.jobs[1]).toMatchObject({ remote: true, location: "London, England, United Kingdom | New York, New York, United States | Melbourne, Victoria, Australia" });
  });

  it("answers notFound for a 404, throws on server errors, and surfaces rate limiting", async () => {
    expect(await workable.listJobs("nope", { fetch: routeFetch({}) })).toMatchObject({ jobs: [], complete: true, notFound: true });
    await expect(workable.listJobs("x", { fetch: routeFetch({ "https://": () => reply("boom", 500) }) })).rejects.toThrow(/500/);
    await expect(workable.listJobs("x", { fetch: routeFetch({ "https://": () => reply("", 429) }), ...noSleep })).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("follows a continuation token and marks the read incomplete when a later page fails", async () => {
    const job = (id: string) => ({ title: `Job ${id}`, shortcode: id, published_on: "2026-01-01", locations: [{ city: "Oslo", country: "Norway" }], description: `<p>${id}</p>` });
    const paged = routeFetch({
      [`${url}acme?details=true&token=t%201`]: () => reply(JSON.stringify({ name: "Acme", jobs: [job("B")] })),
      [`${url}acme?details=true`]: () => reply(JSON.stringify({ name: "Acme", jobs: [job("A")], nextPage: "t 1" })),
    });
    const ok = asList(await workable.listJobs("acme", { fetch: paged }));
    expect(ok.jobs.map((j) => j.externalId)).toEqual(["A", "B"]);
    expect(ok).toMatchObject({ complete: true });
    expect(ok.jobs.every((j) => j.companyName === "Acme")).toBe(true);

    const broken = routeFetch({
      [`${url}acme?details=true&token=`]: () => reply("boom", 500),
      [`${url}acme?details=true`]: () => reply(JSON.stringify({ name: "Acme", jobs: [job("A")], nextPage: "t1" })),
    });
    const partial = asList(await workable.listJobs("acme", { fetch: broken, ...noSleep }));
    expect(partial.jobs.map((j) => j.externalId)).toEqual(["A"]);
    expect(partial.complete).toBe(false);

    const loop = routeFetch({ [`${url}acme?details=true`]: () => reply(JSON.stringify({ name: "Acme", jobs: [job("A")], nextPage: "same" })) });
    expect(asList(await workable.listJobs("acme", { fetch: loop })).complete).toBe(false);
  });

  it("declares its strict concurrency, finds one job, and parses URLs", async () => {
    expect(workable.ready).toBe(true);
    expect(workable.capabilities?.maxConcurrencyPerHost).toBe(2);
    const f = routeFetch({ [`${url}1000heads?details=true`]: () => reply(fx("workable-widget.json")) });
    expect(await workable.fetchJob?.("1000heads", "e4335d00d8", { fetch: f })).toMatchObject({ title: "Account Director" });
    expect(await workable.fetchJob?.("1000heads", "NOPE", { fetch: f })).toBeNull();
    expect(workable.parseUrl("https://apply.workable.com/1000heads/")).toEqual({ token: "1000heads", externalId: null });
    expect(workable.parseUrl("https://apply.workable.com/1000heads/j/E4335D00D8/")).toEqual({ token: "1000heads", externalId: "E4335D00D8" });
    expect(workable.parseUrl("https://apply.workable.com/j/E4335D00D8")).toBeNull();
    expect(workable.parseUrl("https://www.workable.com/1000heads")).toBeNull();
  });
});

describe("recruitee", () => {
  const url = "https://by433.recruitee.com/api/offers/";

  it("normalises offers: apply link, UTC date, remote flag, descriptions", async () => {
    const r = asList(await recruitee.listJobs("by433", { fetch: routeFetch({ [url]: () => reply(fx("recruitee-offers.json")) }) }));
    expect(r.complete).toBe(true);
    expect(r.jobs).toHaveLength(3);
    expect(r.jobs[0]).toMatchObject({
      atsType: "recruitee", externalId: "2805848", companyName: "433", companyToken: "by433", title: "Head of Tech & Product",
      location: "Amsterdam , Noord-Holland, Netherlands", remote: false, applyUrl: "https://careers.by433.com/o/head-of-tech-product/c/new",
    });
    expect(r.jobs[0]?.postedAt?.toISOString()).toBe("2026-11-02T13:56:20.000Z");
    expect(r.jobs[0]?.descriptionText).toMatch(/^Do you want to shape the technology and product/);
    expect(r.jobs[0]?.descriptionText).toContain("\n\n");
    expect(r.jobs[1]).toMatchObject({ remote: true, location: "Remote, Netherlands" });
  });

  it("skips unpublished offers, answers notFound for a 404 or a bad token, and never calls out for a bad token", async () => {
    const body = fj<{ offers: Array<Record<string, unknown>> }>("recruitee-offers.json");
    body.offers[1] = { ...body.offers[1], status: "draft" };
    const r = asList(await recruitee.listJobs("by433", { fetch: routeFetch({ [url]: () => reply(JSON.stringify(body)) }) }));
    expect(r.jobs.map((j) => j.externalId)).toEqual(["2805848", "2784132"]);
    expect(await recruitee.listJobs("by433", { fetch: routeFetch({ [url]: () => reply('{"error":"Not Found"}', 404) }) })).toMatchObject({ notFound: true, complete: true });
    const f = routeFetch({});
    expect(await recruitee.listJobs("evil.example.com/x", { fetch: f })).toMatchObject({ notFound: true });
    expect(f).not.toHaveBeenCalled();
    await expect(recruitee.listJobs("by433", { fetch: routeFetch({ [url]: () => reply("<html>oops</html>") }) })).rejects.toThrow(/not JSON/);
  });

  it("fetches one offer by slug or id, and parses URLs", async () => {
    const one = fj<{ offers: unknown[] }>("recruitee-offers.json").offers[0];
    const f = routeFetch({ [`${url}head-of-tech-product`]: () => reply(JSON.stringify({ offer: one })) });
    expect(await recruitee.fetchJob?.("by433", "head-of-tech-product", { fetch: f })).toMatchObject({ externalId: "2805848" });
    expect(await recruitee.fetchJob?.("by433", "gone", { fetch: f })).toBeNull();
    expect(recruitee.parseUrl("https://by433.recruitee.com/o/head-of-tech-product")).toEqual({ token: "by433", externalId: "head-of-tech-product" });
    expect(recruitee.parseUrl("https://by433.recruitee.com")).toEqual({ token: "by433", externalId: null });
    expect(recruitee.parseUrl("https://www.recruitee.com/o/x")).toBeNull();
    expect(recruitee.parseUrl("https://by433.example.com/o/x")).toBeNull();
    expect(recruitee.capabilities).toMatchObject({ maxConcurrencyPerHost: 4 });
  });
});

describe("teamtailor", () => {
  const url = "https://1komma5.teamtailor.com/jobs.rss";

  it("normalises RSS items (location, remoteStatus, id from the link, decoded HTML description)", async () => {
    const f = routeFetch({ [url]: () => reply(fx("teamtailor-jobs.xml"), 200, { etag: 'W/"abc"' }) });
    const r = asList(await teamtailor.listJobs("1komma5", { fetch: f }));
    expect(r).toMatchObject({ complete: true, etag: 'W/"abc"' });
    expect(r.jobs).toHaveLength(3);
    expect(r.jobs[0]).toMatchObject({
      atsType: "teamtailor", externalId: "8640668", companyName: "1KOMMA5° Sverige", companyToken: "1komma5",
      title: "Redovisningschef till 1KOMMA5° i Malmö", location: "Malmö, Sweden", remote: false,
      applyUrl: "https://jobb.1komma5.com/jobs/8640668-redovisningschef-till-1komma5-i-malmo",
    });
    expect(r.jobs[0]?.postedAt?.toISOString()).toBe("2026-10-30T07:50:40.000Z");
    expect(r.jobs[0]?.descriptionText).toMatch(/^Välkommen till 1KOMMA5°, en global ledare/);
    expect(r.jobs[0]?.descriptionText).not.toMatch(/&lt;|<p>/);
    expect(r.jobs[1]?.remote).toBe(true); // remoteStatus "fully"
  });

  it("sends If-None-Match and reports notModified on 304", async () => {
    const f = routeFetch({ [url]: () => new Response(null, { status: 304, headers: { etag: 'W/"abc"' } }) });
    const r = asList(await teamtailor.listJobs("1komma5", { fetch: f }, { etag: 'W/"abc"' }));
    expect(r).toMatchObject({ notModified: true, complete: true, jobs: [], etag: 'W/"abc"' });
    expect(headerOf(f, 0, "if-none-match")).toBe('W/"abc"');
    expect(teamtailor.capabilities?.conditional).toBe(true);
  });

  it("answers notFound for a 404, and throws for HTML or truncated XML instead of reporting an empty board", async () => {
    expect(await teamtailor.listJobs("zz", { fetch: routeFetch({}) })).toMatchObject({ notFound: true });
    await expect(teamtailor.listJobs("zz", { fetch: routeFetch({ "https://zz.teamtailor.com/jobs.rss": () => reply("<html><body>hi</body></html>") }) })).rejects.toThrow(/not an RSS feed/);
    const cutOff = fx("teamtailor-jobs.xml").slice(0, 900);
    await expect(teamtailor.listJobs("zz", { fetch: routeFetch({ "https://zz.teamtailor.com/jobs.rss": () => reply(cutOff) }) })).rejects.toThrow(/malformed RSS/);
  });

  it("fetches one job from the feed and parses URLs", async () => {
    const f = routeFetch({ [url]: () => reply(fx("teamtailor-jobs.xml")) });
    expect(await teamtailor.fetchJob?.("1komma5", "8619697", { fetch: f })).toMatchObject({ title: expect.stringContaining("Sales Teamlead") });
    expect(await teamtailor.fetchJob?.("1komma5", "1", { fetch: f })).toBeNull();
    expect(teamtailor.parseUrl("https://1komma5.teamtailor.com/jobs/8640668-redovisningschef")).toEqual({ token: "1komma5", externalId: "8640668" });
    expect(teamtailor.parseUrl("https://1komma5.teamtailor.com/jobs")).toEqual({ token: "1komma5", externalId: null });
    expect(teamtailor.parseUrl("https://www.teamtailor.com/jobs/1")).toBeNull();
  });
});

describe("personio", () => {
  it("normalises positions with their description sections and extra offices", async () => {
    const f = routeFetch({ "https://360volt-gmbh.jobs.personio.de/xml": () => reply(fx("personio-xml.xml"), 200, { etag: '"e1"' }) });
    const r = asList(await personio.listJobs("360volt-gmbh", { fetch: f }));
    expect(r).toMatchObject({ complete: true, etag: '"e1"' });
    expect(r.jobs).toHaveLength(2);
    expect(r.jobs[0]).toMatchObject({
      atsType: "personio", externalId: "2524442", companyName: "360Volt GmbH", companyToken: "360volt-gmbh",
      title: "Disponent / Operations Planner (m/w/d) – Wärmepumpen", location: "Bochum | Alsbach-Hähnlein", remote: false,
      applyUrl: "https://360volt-gmbh.jobs.personio.de/job/2524442",
    });
    expect(r.jobs[0]?.postedAt?.toISOString()).toBe("2026-02-10T09:02:24.000Z");
    expect(r.jobs[0]?.descriptionText).toMatch(/^Deine Aufgaben\nDu sorgst dafür/);
    expect(r.jobs[1]?.descriptionText).toMatch(/\n\nDein Profil\n/);
    expect(r.jobs[1]?.descriptionText).not.toMatch(/<[a-z]/);
  });

  it("handles tenants with empty descriptions and flags remote offices", async () => {
    const f = routeFetch({ "https://1nce.jobs.personio.de/xml": () => reply(fx("personio-xml-nodesc.xml")) });
    const r = asList(await personio.listJobs("1nce", { fetch: f }));
    expect(r.jobs[0]).toMatchObject({ descriptionText: "", remote: true, location: "Remote Germany", companyName: "1NCE GmbH" });
    expect(r.jobs[1]?.location).toBe("Remote Norway | Remote Denmark | Remote Sweden");
  });

  it("falls back from .de to .com, answers notFound when neither has the tenant, and honours 304", async () => {
    const f = routeFetch({ "https://1nce.jobs.personio.com/xml": () => reply(fx("personio-xml-nodesc.xml")) });
    const r = asList(await personio.listJobs("1nce", { fetch: f }));
    expect(r.jobs).toHaveLength(2);
    expect(r.jobs[0]?.applyUrl).toBe("https://1nce.jobs.personio.com/job/2536632");
    expect(f).toHaveBeenCalledTimes(2);
    expect(await personio.listJobs("nobody", { fetch: routeFetch({}) })).toMatchObject({ notFound: true, complete: true });
    const g = routeFetch({ "https://1nce.jobs.personio.de/xml": () => new Response(null, { status: 304 }) });
    expect(asList(await personio.listJobs("1nce", { fetch: g }, { etag: '"e1"' }))).toMatchObject({ notModified: true, etag: '"e1"' });
    expect(headerOf(g, 0, "if-none-match")).toBe('"e1"');
    await expect(personio.listJobs("1nce", { fetch: routeFetch({ "https://1nce.jobs.personio.de/xml": () => reply("<html/>") }) })).rejects.toThrow(/not a Personio feed/);
  });

  it("fetches one job and parses URLs", async () => {
    const f = routeFetch({ "https://1nce.jobs.personio.de/xml": () => reply(fx("personio-xml-nodesc.xml")) });
    expect(await personio.fetchJob?.("1nce", "2509340", { fetch: f })).toMatchObject({ title: "Account Manager - Nordics (all)" });
    expect(await personio.fetchJob?.("1nce", "1", { fetch: f })).toBeNull();
    expect(personio.parseUrl("https://1nce.jobs.personio.de/job/2536632?language=en")).toEqual({ token: "1nce", externalId: "2536632" });
    expect(personio.parseUrl("https://1nce.jobs.personio.com/")).toEqual({ token: "1nce", externalId: null });
    expect(personio.parseUrl("https://www.personio.com/job/1")).toBeNull();
  });
});

describe("bamboohr", () => {
  const host = "https://321theagency.bamboohr.com";
  const routes = (extra: Record<string, () => Response> = {}) => routeFetch({
    [`${host}/careers/146/detail`]: () => reply(fx("bamboohr-detail.json")),
    [`${host}/careers/148/detail`]: () => reply("boom", 500),
    [`${host}/careers/list`]: () => reply(fx("bamboohr-list.json")),
    ...extra,
  });

  it("reads the list and each detail, keeping list data when a detail fails", async () => {
    const f = routes();
    const r = asList(await bamboohr.listJobs("321theagency", { fetch: f, ...noSleep }));
    expect(r.complete).toBe(true);
    expect(r.jobs.map((j) => j.externalId)).toEqual(["146", "148", "154"]);
    expect(r.jobs[0]).toMatchObject({
      atsType: "bamboohr", companyName: "321theagency", title: "Project Manager (Creative & Digital)",
      location: "Orlando, Florida, United States", remote: true, applyUrl: `${host}/careers/146`,
    });
    expect(r.jobs[0]?.postedAt?.toISOString()).toBe("2025-07-15T00:00:00.000Z");
    expect(r.jobs[0]?.descriptionText).toMatch(/^The JD TL;DR\n\nAt 321, our Project Management team/);
    // detail 500 and detail 404: the job is still reported, without a description
    expect(r.jobs[1]).toMatchObject({ title: "Senior Client Account Strategist (Digital)", descriptionText: "", remote: true });
    expect(r.jobs[2]).toMatchObject({ descriptionText: "", remote: false, location: "Austin, Texas, United States" });
  });

  it("answers notFound for a redirect to bamboohr.com, and for a missing list plus missing widget", async () => {
    const redirect = routeFetch({ [`${host}/careers/list`]: () => new Response(null, { status: 302, headers: { location: "https://www.bamboohr.com" } }) });
    expect(await bamboohr.listJobs("321theagency", { fetch: redirect })).toMatchObject({ jobs: [], complete: true, notFound: true });
    expect(await bamboohr.listJobs("321theagency", { fetch: routeFetch({}) })).toMatchObject({ notFound: true });
    await expect(bamboohr.listJobs("321theagency", { fetch: routeFetch({ [`${host}/careers/list`]: () => reply("boom", 500) }), ...noSleep })).rejects.toThrow(/500/);
  });

  it("falls back to the embed widget (JSON today, HTML on older tenants) when the list is gone", async () => {
    const jsonWidget = routes({ [`${host}/careers/list`]: () => reply("", 404), [`${host}/jobs/embed2.php`]: () => reply(fx("bamboohr-embed.json")) });
    const a = asList(await bamboohr.listJobs("321theagency", { fetch: jsonWidget, ...noSleep }));
    expect(a.jobs.map((j) => j.externalId)).toEqual(["161", "148", "173", "175"].slice(0, a.jobs.length));
    expect(a.jobs.length).toBeGreaterThan(0);
    expect(a.jobs[0]?.remote).toBe(true);

    const html = `<ul><li id="bhrDepartmentID_1" class="BambooHR-ATS-Department-Item"><div id="department_1" class="BambooHR-ATS-Department-Header">Engineering</div>
      <ul class="BambooHR-ATS-Jobs-List"><li id="bhrPositionID_146" class="BambooHR-ATS-Jobs-Item"><a href="//321theagency.bamboohr.com/careers/146">Backend &amp; Data Engineer</a><span class="BambooHR-ATS-Location">Remote, US</span></li></ul></li>
      <li id="bhrDepartmentID_2" class="BambooHR-ATS-Department-Item"><div class="BambooHR-ATS-Department-Header">Sales</div>
      <ul class="BambooHR-ATS-Jobs-List"><li id="bhrPositionID_150" class="BambooHR-ATS-Jobs-Item"><a href="/careers/150">Account Executive</a><span class="BambooHR-ATS-Location">Austin, TX</span></li></ul></li></ul>`;
    const legacy = routes({ [`${host}/careers/list`]: () => reply("", 404), [`${host}/jobs/embed2.php`]: () => reply(html, 200, { "content-type": "text/html" }) });
    const b = asList(await bamboohr.listJobs("321theagency", { fetch: legacy, ...noSleep }));
    expect(b.jobs.map((j) => [j.externalId, j.title, j.location, j.remote])).toEqual([
      ["146", "Project Manager (Creative & Digital)", "Orlando, Florida, United States", true], // detail wins over the widget row
      ["150", "Account Executive", "Austin, TX", false],
    ]);
  });

  it("reads one posting from its detail endpoint, and parses URLs", async () => {
    expect(await bamboohr.fetchJob?.("321theagency", "146", { fetch: routes() })).toMatchObject({ title: "Project Manager (Creative & Digital)", externalId: "146" });
    expect(await bamboohr.fetchJob?.("321theagency", "999", { fetch: routes() })).toBeNull();
    const closed = fj<{ result: { jobOpening: Record<string, unknown> } }>("bamboohr-detail.json");
    closed.result.jobOpening["jobOpeningStatus"] = "Closed";
    expect(await bamboohr.fetchJob?.("321theagency", "146", { fetch: routeFetch({ [`${host}/careers/146/detail`]: () => reply(JSON.stringify(closed)) }) })).toBeNull();
    expect(bamboohr.parseUrl("https://321theagency.bamboohr.com/careers/146")).toEqual({ token: "321theagency", externalId: "146" });
    expect(bamboohr.parseUrl("https://321theagency.bamboohr.com/careers")).toEqual({ token: "321theagency", externalId: null });
    expect(bamboohr.parseUrl("https://321theagency.bamboohr.com/jobs/view.php?id=146")).toEqual({ token: "321theagency", externalId: "146" });
    expect(bamboohr.parseUrl("https://www.bamboohr.com/careers")).toBeNull();
    expect(bamboohr.ready).toBe(true);
  });
});

describe("breezy", () => {
  const host = "https://1001.breezy.hr";
  const routes = () => routeFetch({
    [`${host}/p/77078545d414-android-developer`]: () => reply(fx("breezy-detail.html")),
    [`${host}/p/`]: () => reply("boom", 500),
    [`${host}/json`]: () => reply(fx("breezy-json.json"), 200, { etag: 'W/"2-x"' }),
  });

  it("normalises the list and reads descriptions from each position page (JSON-LD)", async () => {
    const r = asList(await breezy.listJobs("1001", { fetch: routes(), ...noSleep }));
    expect(r).toMatchObject({ complete: true, etag: 'W/"2-x"' });
    expect(r.jobs).toHaveLength(3);
    expect(r.jobs[0]).toMatchObject({
      atsType: "breezy", externalId: "77078545d414", companyName: "1001", title: "Android Developer", location: "Baghdad/Erbil, IQ",
      remote: true, applyUrl: `${host}/p/77078545d414-android-developer`,
    });
    expect(r.jobs[0]?.postedAt?.toISOString()).toBe("2023-08-22T11:14:51.803Z");
    expect(r.jobs[0]?.descriptionText).toMatch(/^1001 is seeking a skilled/);
    // the other pages answered 500: still listed, without a description
    expect(r.jobs[1]).toMatchObject({ externalId: "8e183aec4d84", descriptionText: "" });
  });

  it("falls back to the description block when a page has no JSON-LD", async () => {
    const page = '<html><body><div class="description"><p>Plain &amp; simple</p><ul><li>One</li></ul></div><div class="apply-container">x</div></body></html>';
    const one = fj<Array<Record<string, unknown>>>("breezy-json.json").slice(0, 1);
    const f = routeFetch({ [`${host}/p/`]: () => reply(page), [`${host}/json`]: () => reply(JSON.stringify(one)) });
    const r = asList(await breezy.listJobs("1001", { fetch: f }));
    expect(r.jobs[0]?.descriptionText).toBe("Plain & simple\n\n- One");
  });

  it("answers notFound for a redirect to breezy.hr or a 404, and treats 403 as retryable", async () => {
    const redirect = routeFetch({ [`${host}/json`]: () => new Response(null, { status: 302, headers: { location: "https://breezy.hr/" } }) });
    expect(await breezy.listJobs("1001", { fetch: redirect })).toMatchObject({ jobs: [], complete: true, notFound: true });
    expect(await breezy.listJobs("1001", { fetch: routeFetch({}) })).toMatchObject({ notFound: true });
    await expect(breezy.listJobs("1001", { fetch: routeFetch({ [`${host}/json`]: () => reply("denied", 403) }) })).rejects.toThrow(/403/);
    await expect(breezy.listJobs("1001", { fetch: routeFetch({ [`${host}/json`]: () => reply('{"a":1}') }) })).rejects.toThrow(/position list/);
  });

  it("sends If-None-Match and reports notModified on 304; an empty board is complete", async () => {
    const f = routeFetch({ [`${host}/json`]: () => new Response(null, { status: 304 }) });
    expect(asList(await breezy.listJobs("1001", { fetch: f }, { etag: 'W/"2-x"' }))).toMatchObject({ notModified: true, etag: 'W/"2-x"' });
    expect(headerOf(f, 0, "if-none-match")).toBe('W/"2-x"');
    expect(asList(await breezy.listJobs("1001", { fetch: routeFetch({ [`${host}/json`]: () => reply("[]") }) }))).toMatchObject({ jobs: [], complete: true });
    expect(breezy.capabilities?.conditional).toBe(true);
  });

  it("fetches one position and parses URLs", async () => {
    expect(await breezy.fetchJob?.("1001", "77078545d414", { fetch: routes() })).toMatchObject({ title: "Android Developer", descriptionText: expect.stringContaining("Android") });
    expect(await breezy.fetchJob?.("1001", "nope", { fetch: routes() })).toBeNull();
    expect(breezy.parseUrl("https://1001.breezy.hr/p/77078545d414-android-developer")).toEqual({ token: "1001", externalId: "77078545d414" });
    expect(breezy.parseUrl("https://1001.breezy.hr/")).toEqual({ token: "1001", externalId: null });
    expect(breezy.parseUrl("https://breezy.hr/p/x")).toBeNull();
  });
});

describe("rippling", () => {
  const api = "https://api.rippling.com/platform/api/ats/v1/board/1nhealth/jobs";
  const id = "7615d61f-adf1-491b-9a4c-6c9dc1681d65";

  it("reads the list and each job's detail (company name, description, created date)", async () => {
    const f = routeFetch({ [`${api}/${id}`]: () => reply(fx("rippling-detail.json")), [api]: () => reply(fx("rippling-list.json")) });
    const r = asList(await rippling.listJobs("1nhealth", { fetch: f }));
    expect(r.complete).toBe(true);
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0]).toMatchObject({
      atsType: "rippling", externalId: id, companyName: "1nHealth, Inc.", companyToken: "1nhealth", title: "Patient Coordinator Support Lead",
      location: "Remote (United States)", remote: true, applyUrl: `https://ats.rippling.com/1nhealth/jobs/${id}`,
    });
    expect(r.jobs[0]?.postedAt?.toISOString()).toBe("2026-11-02T19:50:55.300Z");
    expect(r.jobs[0]?.descriptionText).toMatch(/^About the role/);
    expect(r.jobs[0]?.descriptionText).toContain("About 1nHealth");
  });

  it("merges list rows that repeat a uuid, and keeps list data when a detail fails", async () => {
    const list = fj<Array<Record<string, unknown>>>("rippling-list.json");
    const twin = { ...list[0], workLocation: { label: "Austin, TX", id: "Austin, TX" } };
    const f = routeFetch({ [`${api}/${id}`]: () => reply("boom", 500), [api]: () => reply(JSON.stringify([list[0], twin])) });
    const r = asList(await rippling.listJobs("1nhealth", { fetch: f, ...noSleep }));
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0]).toMatchObject({ location: "Remote (United States) | Austin, TX", companyName: "1nhealth", descriptionText: "", postedAt: null });
  });

  it("answers notFound for an unknown board, throws on other errors", async () => {
    const gone = routeFetch({ [api]: () => reply('{"error_code":"RESOURCE_NOT_FOUND","message":"Job Board not found"}', 404) });
    expect(await rippling.listJobs("1nhealth", { fetch: gone })).toMatchObject({ jobs: [], complete: true, notFound: true });
    await expect(rippling.listJobs("1nhealth", { fetch: routeFetch({ [api]: () => reply("boom", 500) }) })).rejects.toThrow(/500/);
    await expect(rippling.listJobs("1nhealth", { fetch: routeFetch({ [api]: () => reply('{"x":1}') }) })).rejects.toThrow(/job list/);
  });

  it("fetches one job and parses board and posting URLs", async () => {
    const f = routeFetch({ [`${api}/${id}`]: () => reply(fx("rippling-detail.json")) });
    expect(await rippling.fetchJob?.("1nhealth", id, { fetch: f })).toMatchObject({ externalId: id, title: "Patient Coordinator Support Lead", companyName: "1nHealth, Inc." });
    expect(await rippling.fetchJob?.("1nhealth", "other", { fetch: f })).toBeNull();
    expect(rippling.parseUrl(`https://ats.rippling.com/1nhealth/jobs/${id}`)).toEqual({ token: "1nhealth", externalId: id });
    expect(rippling.parseUrl("https://ats.rippling.com/1nhealth/jobs")).toEqual({ token: "1nhealth", externalId: null });
    expect(rippling.parseUrl(`https://ats.rippling.com/en-GB/1nhealth/jobs/${id}`)).toEqual({ token: "1nhealth", externalId: id });
    expect(rippling.parseUrl("https://example.com/1nhealth/jobs")).toBeNull();
    expect(rippling.ready).toBe(true);
  });
});

describe("pinpoint", () => {
  const url = "https://workwithus.pinpointhq.com/postings.json";

  it("normalises postings: sections, department-free fields, workplace type", async () => {
    const f = routeFetch({ [url]: () => reply(fx("pinpoint-postings.json"), 200, { etag: 'W/"p1"' }) });
    const r = asList(await pinpoint.listJobs("workwithus", { fetch: f }));
    expect(r).toMatchObject({ complete: true, etag: 'W/"p1"' });
    expect(r.jobs).toHaveLength(3);
    expect(r.jobs[0]).toMatchObject({
      atsType: "pinpoint", externalId: "559663", companyName: "Workwithus", companyToken: "workwithus", title: "Founding Legal Counsel",
      location: "Remote", remote: true, applyUrl: "https://workwithus.pinpointhq.com/en/postings/ce6c9e5c-a2d3-42b0-a01e-9edeae315b04", postedAt: null,
    });
    expect(r.jobs[0]?.descriptionText).toMatch(/^Hi .* I'm Ellis, COO at Pinpoint\./);
    expect(r.jobs[0]?.descriptionText).toContain("What you'll do\n");
    expect(r.jobs[0]?.descriptionText).not.toMatch(/<[a-z!]/);
    expect(r.jobs[1]?.location).toBe("United Kingdom");
  });

  it("skips postings whose deadline has passed, and reads published dates when given", async () => {
    const body = fj<{ data: Array<Record<string, unknown>> }>("pinpoint-postings.json");
    body.data[1] = { ...body.data[1], deadline_at: "2020-01-01T00:00:00Z" };
    body.data[2] = { ...body.data[2], first_published_at: "2026-10-01T09:00:00Z" };
    const r = asList(await pinpoint.listJobs("workwithus", { fetch: routeFetch({ [url]: () => reply(JSON.stringify(body)) }) }));
    expect(r.jobs.map((j) => j.externalId)).toEqual(["559663", "591998"]);
    expect(r.jobs[1]?.postedAt?.toISOString()).toBe("2026-10-01T09:00:00.000Z");
  });

  it("answers notFound for a 404 or a redirect, honours 304, and throws on a bad payload", async () => {
    expect(await pinpoint.listJobs("zz", { fetch: routeFetch({}) })).toMatchObject({ jobs: [], complete: true, notFound: true });
    const redirect = routeFetch({ "https://zz.pinpointhq.com/postings.json": () => new Response(null, { status: 302, headers: { location: "https://www.pinpointhq.com" } }) });
    expect(await pinpoint.listJobs("zz", { fetch: redirect })).toMatchObject({ notFound: true });
    const f = routeFetch({ [url]: () => new Response(null, { status: 304 }) });
    expect(asList(await pinpoint.listJobs("workwithus", { fetch: f }, { etag: 'W/"p1"' }))).toMatchObject({ notModified: true, etag: 'W/"p1"' });
    expect(headerOf(f, 0, "if-none-match")).toBe('W/"p1"');
    await expect(pinpoint.listJobs("workwithus", { fetch: routeFetch({ [url]: () => reply('{"data":null}') }) })).rejects.toThrow(/postings list/);
  });

  it("fetches one posting by feed id or posting-URL uuid, and parses URLs", async () => {
    const f = routeFetch({ [url]: () => reply(fx("pinpoint-postings.json")) });
    expect(await pinpoint.fetchJob?.("workwithus", "567495", { fetch: f })).toMatchObject({ title: "Enterprise Implementation Manager" });
    expect(await pinpoint.fetchJob?.("workwithus", "8fa6a0e0-0beb-4233-8ab0-409fe6bfccb1", { fetch: f })).toMatchObject({ externalId: "567495" });
    expect(await pinpoint.fetchJob?.("workwithus", "nope", { fetch: f })).toBeNull();
    expect(pinpoint.parseUrl("https://workwithus.pinpointhq.com/en/postings/8fa6a0e0-0beb-4233-8ab0-409fe6bfccb1")).toEqual({ token: "workwithus", externalId: "8fa6a0e0-0beb-4233-8ab0-409fe6bfccb1" });
    expect(pinpoint.parseUrl("https://workwithus.pinpointhq.com/postings/abc")).toEqual({ token: "workwithus", externalId: "abc" });
    expect(pinpoint.parseUrl("https://workwithus.pinpointhq.com")).toEqual({ token: "workwithus", externalId: null });
    expect(pinpoint.parseUrl("https://www.pinpointhq.com/postings/x")).toBeNull();
  });
});

describe("icims", () => {
  const host = "https://careers-peraton.icims.com";
  /** The fixture search page with its ids changed, and "Page N of total" rewritten, to stand in for later pages. */
  const searchPage = (page: number, total: number, idShift = 0) =>
    fx("icims-search.html").replace(/Page 1 of \d+/, `Page ${page + 1} of ${total}`).replace(/\/jobs\/(\d+)\//g, (_m, n: string) => `/jobs/${Number(n) + idShift}/`);
  const detail = () => reply(fx("icims-detail.html"));

  it("normalises job cards (location, posted date, remote option) and enriches from JobPosting JSON-LD", async () => {
    const f = routeFetch({
      [`${host}/jobs/173137/`]: detail,
      [`${host}/jobs/search?ss=1&pr=0&in_iframe=1`]: () => reply(searchPage(0, 1)),
    });
    const r = asList(await icims.listJobs("peraton", { fetch: f }));
    expect(r.complete).toBe(true);
    expect(r.jobs.map((j) => j.externalId)).toEqual(["173137", "173099", "173098"]);
    expect(r.jobs[0]).toMatchObject({
      atsType: "icims", companyName: "Peraton", companyToken: "peraton", title: "Senior Watch Officer (SWO) / Active Secret",
      location: "Washington, DC, US", remote: false,
      applyUrl: "https://careers-peraton.icims.com/jobs/173137/senior-watch-officer-%28swo%29---active-secret/job",
    });
    expect(r.jobs[0]?.postedAt?.toISOString()).toBe("2026-11-02T05:00:00.000Z"); // JSON-LD beats the card
    expect(r.jobs[0]?.descriptionText).toMatch(/^Peraton Overview/);
    // jobs whose detail page is unavailable keep the card's summary, date (read as UTC) and remote option
    expect(r.jobs[1]).toMatchObject({ location: "Chantilly, VA, US", remote: false, applyUrl: expect.not.stringContaining("in_iframe") });
    expect(r.jobs[1]?.postedAt?.toISOString()).toBe("2026-11-02T15:18:00.000Z");
    expect(r.jobs[1]?.descriptionText).toMatch(/^Peraton is seeking to fill a critical role/);
    expect(r.jobs[2]).toMatchObject({ remote: true });
  });

  it("pages until the advertised last page and de-duplicates ids", async () => {
    const f = routeFetch({
      [`${host}/jobs/search?ss=1&pr=0&in_iframe=1`]: () => reply(searchPage(0, 2)),
      [`${host}/jobs/search?ss=1&pr=1&in_iframe=1`]: () => reply(searchPage(1, 2, 1000)),
      [`${host}/jobs/`]: () => reply("", 404),
    });
    const r = asList(await icims.listJobs("peraton", { fetch: f }));
    expect(r.complete).toBe(true);
    expect(r.jobs.map((j) => j.externalId)).toEqual(["173137", "173099", "173098", "174137", "174099", "174098"]);
    const search = f.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/jobs/search"));
    expect(search).toHaveLength(2);
  });

  it("returns what it has with complete:false when paging is cut short (403, error or empty page)", async () => {
    const base = { [`${host}/jobs/search?ss=1&pr=0&in_iframe=1`]: () => reply(searchPage(0, 3)), [`${host}/jobs/173`]: () => reply("", 404) };
    const forbidden = routeFetch({ ...base, [`${host}/jobs/search?ss=1&pr=1`]: () => reply("denied", 403) });
    const a = asList(await icims.listJobs("peraton", { fetch: forbidden }));
    expect(a.complete).toBe(false);
    expect(a.jobs).toHaveLength(3);
    const failing = routeFetch({ ...base, [`${host}/jobs/search?ss=1&pr=1`]: () => reply("boom", 500) });
    expect(asList(await icims.listJobs("peraton", { fetch: failing, ...noSleep })).complete).toBe(false);
    const empty = routeFetch({ ...base, [`${host}/jobs/search?ss=1&pr=1`]: () => reply("<html>icims</html>") });
    expect(asList(await icims.listJobs("peraton", { fetch: empty })).complete).toBe(false);
  });

  it("throws a typed error on 403 for the first page, and stops asking for details once blocked", async () => {
    const blocked = routeFetch({ [`${host}/jobs/search`]: () => reply("<html>Access denied</html>", 403) });
    const err = await icims.listJobs("peraton", { fetch: blocked }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IcimsBlockedError);
    expect(blocked).toHaveBeenCalledTimes(1);

    const detailBlocked = routeFetch({
      [`${host}/jobs/search?ss=1&pr=0`]: () => reply(searchPage(0, 1)),
      [`${host}/jobs/`]: () => reply("denied", 403),
    });
    const r = asList(await icims.listJobs("peraton", { fetch: detailBlocked }));
    expect(r.jobs).toHaveLength(3);
    expect(r.jobs[0]?.descriptionText).toMatch(/^Peraton is seeking a Senior Watch Officer/);
    // the first detail request hit the block; the remaining ones were not sent (2 workers may already be in flight)
    expect(detailBlocked.mock.calls.length).toBeLessThanOrEqual(1 + 2);
  });

  it("answers notFound for a missing portal or token, and refuses a page that is not an iCIMS search page", async () => {
    expect(await icims.listJobs("peraton", { fetch: routeFetch({}) })).toMatchObject({ jobs: [], complete: true, notFound: true });
    const f = routeFetch({});
    expect(await icims.listJobs("evil.example.com", { fetch: f })).toMatchObject({ notFound: true });
    expect(f).not.toHaveBeenCalled();
    const odd = routeFetch({ [`${host}/jobs/search`]: () => reply("<html><body>Just a moment...</body></html>") });
    await expect(icims.listJobs("peraton", { fetch: odd })).rejects.toThrow(/did not look like an iCIMS/);
    const none = routeFetch({ [`${host}/jobs/search`]: () => reply('<html><script src="https://cdn.icims.com/x.js"></script><p>No jobs</p></html>') });
    expect(asList(await icims.listJobs("peraton", { fetch: none }))).toMatchObject({ jobs: [], complete: true });
  });

  it("accepts a full portal host as the token", async () => {
    const f = routeFetch({ "https://external-92y.icims.com/jobs/search?ss=1&pr=0": () => reply(searchPage(0, 1).replace(/careers-peraton/g, "external-92y")), "https://external-92y.icims.com/jobs/": () => reply("", 404) });
    const r = asList(await icims.listJobs("https://external-92y.icims.com", { fetch: f }));
    expect(r.jobs).toHaveLength(3);
    expect(r.jobs[0]?.companyName).toBe("External 92y");
  });

  it("fetches one posting via JSON-LD, returns null for a missing or closed one, and parses URLs", async () => {
    const f = routeFetch({ [`${host}/jobs/173137/job?in_iframe=1`]: detail });
    expect(await icims.fetchJob?.("peraton", "173137", { fetch: f })).toMatchObject({
      externalId: "173137", companyName: "Peraton", title: "Senior Watch Officer (SWO) / Active Secret", location: "Washington, DC, US",
      applyUrl: "https://careers-peraton.icims.com/jobs/173137/senior-watch-officer-%28swo%29---active-secret/job",
    });
    expect(await icims.fetchJob?.("peraton", "1", { fetch: f })).toBeNull();
    expect(await icims.fetchJob?.("peraton", "../x", { fetch: f })).toBeNull();
    const closed = fx("icims-detail.html").replace("2027-11-02T04:00:00.000Z", "2020-01-01T00:00:00.000Z");
    expect(await icims.fetchJob?.("peraton", "173137", { fetch: routeFetch({ [`${host}/jobs/173137/job`]: () => reply(closed) }) })).toBeNull();
    await expect(icims.fetchJob?.("peraton", "173137", { fetch: routeFetch({ [`${host}/jobs/`]: () => reply("denied", 403) }) })).rejects.toBeInstanceOf(IcimsBlockedError);

    expect(icims.parseUrl("https://careers-peraton.icims.com/jobs/173137/senior-watch-officer/job?in_iframe=1")).toEqual({ token: "peraton", externalId: "173137" });
    expect(icims.parseUrl("https://careers-peraton.icims.com/jobs/search?ss=1")).toEqual({ token: "peraton", externalId: null });
    expect(icims.parseUrl("https://uscareers-rws.icims.com/jobs/55/x/job")).toEqual({ token: "uscareers-rws.icims.com", externalId: "55" });
    expect(icims.parseUrl("https://www.icims.com/jobs/1")).toBeNull();
    expect(icims.parseUrl("https://external-92y.icims.com/")).toBeNull();
    expect(icims.capabilities?.maxConcurrencyPerHost).toBe(2);
    expect(icims.ready).toBe(true);
  });
});
