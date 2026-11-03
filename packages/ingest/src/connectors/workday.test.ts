import { describe, expect, it, vi } from "vitest";
import capped from "../__fixtures__/workday-capped.json";
import detail from "../__fixtures__/workday-detail.json";
import list from "../__fixtures__/workday-list.json";
import { json, noSleep } from "../__fixtures__/helpers.js";
import { RateLimitedError, USER_AGENT } from "../http.js";
import type { ListResult } from "../types.js";
import { BlockedByHostError, MAX_SPLIT_DEPTH, PAGE_SIZE, parsePostedOn, TOTAL_CAP, workday } from "./workday.js";

const TOKEN = "nvidia|wd5|NVIDIAExternalCareerSite";
const LIST_URL = "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs";
const DETAIL_BASE = "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite";
const NOW = Date.UTC(2026, 10, 2, 15, 0);

type Body = { appliedFacets: Record<string, string[]>; limit: number; offset: number; searchText: string };
type Page = { total?: number; jobPostings?: unknown[]; facets?: unknown[] };

const posting = (id: string) => ({
  title: `Job ${id}`, externalPath: `/job/US-CA-Santa-Clara/Job-${id}_${id}`, locationsText: "US, CA, Santa Clara", postedOn: "Posted Today", bulletFields: [id],
});

/** `n` postings of a slice, as the page at `offset` would show them. */
const pageOf = (prefix: string, total: number, offset: number): Page => ({
  total: offset === 0 ? total : undefined,
  jobPostings: Array.from({ length: Math.max(0, Math.min(PAGE_SIZE, total - offset)) }, (_, i) => posting(`${prefix}${offset + i}`)),
});

/** A mocked Workday: `handle` answers each list POST from its body; detail GETs go to `onGet`. */
function workdayFetch(handle: (body: Body) => Page | Response, onGet?: (url: string) => Response) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      expect(url).toBe(LIST_URL);
      const out = handle(JSON.parse(String(init.body)) as Body);
      return out instanceof Response ? out : json(out);
    }
    return onGet ? onGet(url) : new Response("not found", { status: 404 });
  }) as ReturnType<typeof vi.fn> & typeof fetch;
}

const bodies = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST").map((c) => JSON.parse(String((c[1] as RequestInit).body)) as Body);
const facetValues = (param: string, counts: number[]) => ({ facetParameter: param, descriptor: param, values: counts.map((count, i) => ({ descriptor: `${param}${i}`, id: `${param}-${i}`, count })) });

describe("workday parseUrl", () => {
  it("recognises board and posting URLs, with or without a language segment", () => {
    expect(workday.parseUrl("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite")).toEqual({ token: TOKEN, externalId: null });
    expect(workday.parseUrl("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite")).toEqual({ token: TOKEN, externalId: null });
    expect(workday.parseUrl("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Engineer_JR1?src=x"))
      .toEqual({ token: TOKEN, externalId: "/job/US-CA-Santa-Clara/Engineer_JR1" });
    expect(workday.parseUrl("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Engineer_JR1/apply"))
      .toEqual({ token: TOKEN, externalId: "/job/US-CA-Santa-Clara/Engineer_JR1" });
    expect(workday.parseUrl("https://acme.wd1.myworkdayjobs.com/fr/Careers/job/Paris/Dev_R-1")).toEqual({ token: "acme|wd1|Careers", externalId: "/job/Paris/Dev_R-1" });
  });

  it("returns null for other hosts and a missing site", () => {
    expect(workday.parseUrl("https://nvidia.wd5.myworkdayjobs.com/")).toBeNull();
    expect(workday.parseUrl("https://nvidia.wd5.myworkdayjobs.com/en-US")).toBeNull();
    expect(workday.parseUrl("https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/x/jobs")).toBeNull();
    expect(workday.parseUrl("https://jobs.lever.co/acme/1")).toBeNull();
  });

  it("is a ready connector with a host concurrency limit", () => {
    expect(workday.ready).toBe(true);
    expect(workday.capabilities?.maxConcurrencyPerHost).toBe(8);
  });
});

describe("parsePostedOn", () => {
  it("turns relative strings into approximate days", () => {
    const iso = (s: string) => parsePostedOn(s, NOW)?.toISOString();
    expect(iso("Posted Today")).toBe("2026-11-02T00:00:00.000Z");
    expect(iso("Posted Yesterday")).toBe("2026-11-01T00:00:00.000Z");
    expect(iso("Posted 3 Days Ago")).toBe("2026-10-30T00:00:00.000Z");
    expect(iso("Posted 1 Day Ago")).toBe("2026-11-01T00:00:00.000Z");
    expect(iso("Posted 30+ Days Ago")).toBe("2026-10-03T00:00:00.000Z");
    expect(iso("Posted 2 Months Ago")).toBe("2026-09-03T00:00:00.000Z");
  });
  it("returns null for anything else", () => {
    expect(parsePostedOn("", NOW)).toBeNull();
    expect(parsePostedOn(undefined, NOW)).toBeNull();
    expect(parsePostedOn("Sometime", NOW)).toBeNull();
  });
});

describe("workday listJobs", () => {
  it("normalises postings from a real-shaped page", async () => {
    const f = workdayFetch(() => list);
    const out = await workday.listJobs(TOKEN, { fetch: f, now: () => NOW });
    expect(out).toMatchObject({ complete: true });
    const jobs = (out as ListResult).jobs;
    expect(jobs).toHaveLength(5);
    expect(jobs[0]).toMatchObject({
      atsType: "workday", externalId: "JR2009256", companyName: "Nvidia", companyToken: TOKEN, title: "Developer Relations Manager - GSI",
      location: "2 Locations", remote: false, descriptionText: "",
      applyUrl: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Developer-Relations-Manager---GSI_JR2009256",
    });
    expect(jobs[0]?.postedAt?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(jobs[1]?.postedAt?.toISOString()).toBe("2026-10-30T00:00:00.000Z");
    expect(jobs[2]).toMatchObject({ location: "Remote, US", remote: true });
    expect(jobs[2]?.postedAt?.toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(jobs[3]?.title).toBe("Critical Facilities Mechanical Engineer – Data Center");
    expect(jobs[3]?.postedAt?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    // no requisition id in bulletFields: the externalPath is the id
    expect(jobs[4]?.externalId).toBe("/job/US-CA-Santa-Clara/DSX-Energy-Engineer_JR2028854");
  });

  it("sends our headers and a 20-posting JSON body", async () => {
    const f = workdayFetch(() => list);
    await workday.listJobs(TOKEN, { fetch: f });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(LIST_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "user-agent": USER_AGENT, "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ appliedFacets: {}, limit: 20, offset: 0, searchText: "" });
  });

  it("pages 20 at a time up to the first page's total", async () => {
    const f = workdayFetch((b) => pageOf("a", 45, b.offset));
    const out = await workday.listJobs(TOKEN, { fetch: f }) as { jobs: unknown[]; complete: boolean };
    expect(out.jobs).toHaveLength(45);
    expect(out.complete).toBe(true);
    expect(bodies(f).map((b) => [b.offset, b.limit])).toEqual([[0, 20], [20, 20], [40, 20]]);
  });

  it("does not trust a total on later pages (reads it from the first page only)", async () => {
    const f = workdayFetch((b) => ({ ...pageOf("a", 25, b.offset), total: b.offset === 0 ? 25 : 0 }));
    const out = await workday.listJobs(TOKEN, { fetch: f }) as { jobs: unknown[]; complete: boolean };
    expect(out.jobs).toHaveLength(25);
    expect(out.complete).toBe(true);
  });

  it("stops when offsets wrap (a page of ids already seen) and reports an incomplete read", async () => {
    const f = workdayFetch((b) => pageOf("w", 100, b.offset % 40 === 0 ? 0 : 20));
    const out = await workday.listJobs(TOKEN, { fetch: f }) as { jobs: unknown[]; complete: boolean };
    // offset 0 -> w0..19, offset 20 -> w20..39, offset 40 -> wraps to offset 0's ids
    expect(out.jobs).toHaveLength(40);
    expect(out.complete).toBe(false);
    expect(bodies(f)).toHaveLength(3);
  });

  it("returns what it collected with complete:false when a later page fails", async () => {
    const f = workdayFetch((b) => (b.offset === 20 ? new Response("boom", { status: 500 }) : pageOf("a", 60, b.offset)));
    const out = await workday.listJobs(TOKEN, { fetch: f }) as { jobs: unknown[]; complete: boolean };
    expect(out.jobs).toHaveLength(20);
    expect(out.complete).toBe(false);
    expect(bodies(f)).toHaveLength(2);
  });

  it("stops the whole read when a later page is rate limited through every retry", async () => {
    const f = workdayFetch((b) => (b.offset === 20 ? new Response("", { status: 429 }) : pageOf("a", 60, b.offset)));
    const out = await workday.listJobs(TOKEN, { fetch: f, ...noSleep }) as { jobs: unknown[]; complete: boolean };
    expect(out).toMatchObject({ complete: false });
    expect(out.jobs).toHaveLength(20);
  });

  it("answers notFound for 404 and 422 on the first request", async () => {
    for (const status of [404, 422]) {
      const out = await workday.listJobs(TOKEN, { fetch: workdayFetch(() => new Response("", { status })) });
      expect(out).toEqual({ jobs: [], complete: false, notFound: true });
    }
    expect(await workday.listJobs("not-a-token", { fetch: workdayFetch(() => list) })).toMatchObject({ notFound: true });
  });

  it("throws BlockedByHostError for 401 and 403, and plain errors for 5xx and 429", async () => {
    for (const status of [401, 403]) {
      const err = await workday.listJobs(TOKEN, { fetch: workdayFetch(() => new Response("", { status })) }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BlockedByHostError);
      expect(err).toMatchObject({ status, host: "nvidia.wd5.myworkdayjobs.com" });
    }
    await expect(workday.listJobs(TOKEN, { fetch: workdayFetch(() => new Response("", { status: 500 })) })).rejects.toThrow(/500/);
    await expect(workday.listJobs(TOKEN, { fetch: workdayFetch(() => new Response("", { status: 429 })), ...noSleep })).rejects.toBeInstanceOf(RateLimitedError);
  });
});

describe("workday cap and facet splitting", () => {
  it("does not split below the cap", async () => {
    const f = workdayFetch((b) => ({ ...pageOf("a", TOTAL_CAP - 1, b.offset), facets: [facetValues("jobFamilyGroup", [10, 10])] }));
    const out = await workday.listJobs(TOKEN, { fetch: f }) as { jobs: unknown[]; complete: boolean };
    expect(out.jobs).toHaveLength(TOTAL_CAP - 1);
    expect(out.complete).toBe(true);
    expect(bodies(f).every((b) => Object.keys(b.appliedFacets).length === 0)).toBe(true);
  });

  it("applies each value of the chosen facet as its own slice and merges them", async () => {
    const f = workdayFetch((b) => {
      const v = b.appliedFacets.jobFamilyGroup?.[0];
      if (!v) return { total: TOTAL_CAP, jobPostings: [posting("root")], facets: [facetValues("timeType", [1500, 600]), facetValues("jobFamilyGroup", [1200, 900, 0])] };
      if (v === "jobFamilyGroup-0") return pageOf("a", 30, b.offset);
      // slice 1 shares one job (a5) with slice 0
      const p = pageOf("b", 25, b.offset);
      if (b.offset === 0) p.jobPostings = [posting("a5"), ...(p.jobPostings as unknown[]).slice(1)];
      return p;
    });
    const out = await workday.listJobs(TOKEN, { fetch: f }) as { jobs: { externalId: string }[]; complete: boolean };
    // the zero-count value is skipped; the two others are read, paging each by its own first-page total
    const applied = bodies(f).map((b) => b.appliedFacets.jobFamilyGroup?.[0]).filter(Boolean);
    expect([...new Set(applied)]).toEqual(["jobFamilyGroup-0", "jobFamilyGroup-1"]);
    expect(bodies(f).filter((b) => b.appliedFacets.jobFamilyGroup?.[0] === "jobFamilyGroup-0").map((b) => b.offset)).toEqual([0, 20]);
    const ids = out.jobs.map((j) => j.externalId);
    expect(new Set(ids).size).toBe(ids.length);
    // 1 root + 30 + 25, with a5 present in both slices counted once (b0 replaced by a5)
    expect(ids).toHaveLength(1 + 30 + 24);
    expect(ids).toContain("a5");
    expect(out.complete).toBe(true);
  });

  it("reads the real nested facet shape (locationMainGroup) and chooses the facet with the most values", async () => {
    // The fixture keeps three countries of the real response; give them counts that cover the capped total.
    const nestedOnly = structuredClone({ ...capped, facets: capped.facets.filter((fc) => fc.facetParameter === "locationMainGroup") });
    const countries = (nestedOnly.facets[0]?.values as { facetParameter: string; values: { count: number }[] }[]).find((v) => v.facetParameter === "locationHierarchy1");
    countries?.values.forEach((v, i) => { v.count = [1000, 800, 400][i] ?? 0; });
    const f = workdayFetch((b) => {
      const key = Object.keys(b.appliedFacets)[0];
      return key ? pageOf(`${key}-${b.appliedFacets[key]?.[0]}-`, 3, b.offset) : nestedOnly;
    });
    const out = await workday.listJobs(TOKEN, { fetch: f }) as { jobs: unknown[]; complete: boolean };
    const slices = bodies(f).filter((b) => b.offset === 0 && Object.keys(b.appliedFacets).length > 0);
    // locationHierarchy1 has 3 values, locationHierarchy2 has 2
    expect(slices).toHaveLength(3);
    expect(slices.every((b) => Object.keys(b.appliedFacets).join() === "locationHierarchy1")).toBe(true);
    // 8 postings on the capped root page + 3 per slice
    expect(out.jobs).toHaveLength(8 + 9);
    expect(out.complete).toBe(true);
  });

  it("splits a still-capped slice again by a different facet, and gives up (incomplete) at the depth limit", async () => {
    const facets = ["a", "b", "c", "d", "e", "f"].map((p) => facetValues(p, [1900, 1800]));
    const f = workdayFetch((b) => {
      const key = JSON.stringify(b.appliedFacets);
      return { total: b.offset === 0 ? TOTAL_CAP : undefined, jobPostings: Array.from({ length: PAGE_SIZE }, (_, i) => posting(`${key}#${b.offset + i}`)), facets };
    });
    const out = await workday.listJobs(TOKEN, { fetch: f }) as { jobs: unknown[]; complete: boolean };
    const depths = bodies(f).map((b) => Object.keys(b.appliedFacets).length);
    expect(Math.max(...depths)).toBe(MAX_SPLIT_DEPTH);
    // a facet is never applied twice on one path
    expect(bodies(f).every((b) => Object.values(b.appliedFacets).every((v) => v.length === 1))).toBe(true);
    expect(out.complete).toBe(false);
    expect(out.jobs.length).toBeGreaterThan(TOTAL_CAP);
  });

  it("is incomplete when the capped read has no facet left to split by", async () => {
    const f = workdayFetch((b) => ({ ...pageOf("c", TOTAL_CAP, b.offset), facets: [] }));
    const out = await workday.listJobs(TOKEN, { fetch: f }) as { jobs: unknown[]; complete: boolean };
    expect(out.jobs).toHaveLength(TOTAL_CAP);
    expect(out.complete).toBe(false);
  });

  it("is incomplete when the facet's counts do not cover the capped total (jobs lacking that facet)", async () => {
    const f = workdayFetch((b) => (b.appliedFacets.jobFamilyGroup
      ? pageOf(`s${b.appliedFacets.jobFamilyGroup[0]}`, 10, b.offset)
      : { total: TOTAL_CAP, jobPostings: [posting("root")], facets: [facetValues("jobFamilyGroup", [100, 100])] }));
    const out = await workday.listJobs(TOKEN, { fetch: f }) as { jobs: unknown[]; complete: boolean };
    expect(out.complete).toBe(false);
    expect(out.jobs).toHaveLength(21);
  });

  it("is incomplete when a slice fails, but still returns the other slices", async () => {
    const f = workdayFetch((b) => {
      const v = b.appliedFacets.jobFamilyGroup?.[0];
      if (!v) return { total: TOTAL_CAP, jobPostings: [], facets: [facetValues("jobFamilyGroup", [1200, 1200])] };
      return v === "jobFamilyGroup-0" ? new Response("boom", { status: 500 }) : pageOf("ok", 10, b.offset);
    });
    const out = await workday.listJobs(TOKEN, { fetch: f }) as { jobs: unknown[]; complete: boolean };
    expect(out.jobs).toHaveLength(10);
    expect(out.complete).toBe(false);
  });
});

describe("workday descriptions", () => {
  const detailFetch = (extra?: (url: string) => Response | undefined) => workdayFetch(() => list, (url) => {
    const special = extra?.(url);
    if (special) return special;
    return url === `${DETAIL_BASE}/job/US-CA-Santa-Clara/Senior-Software-Engineer--Machine-Learning-Safety_JR2023004` ? json(detail) : new Response("nope", { status: 404 });
  });

  it("reads no descriptions unless asked", async () => {
    const f = detailFetch();
    await workday.listJobs(TOKEN, { fetch: f });
    expect(f.mock.calls.every((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(true);
  });

  it("fetches details only for jobs in detailsFor (by requisition id or path)", async () => {
    const f = detailFetch();
    const out = await workday.listJobs(TOKEN, { fetch: f }, { detailsFor: new Set(["JR2023004"]) } as never) as { jobs: { externalId: string; descriptionText: string; location: string | null }[] };
    const gets = f.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "GET").map((c) => c[0]);
    expect(gets).toEqual([`${DETAIL_BASE}/job/US-CA-Santa-Clara/Senior-Software-Engineer--Machine-Learning-Safety_JR2023004`]);
    const withText = out.jobs.filter((j) => j.descriptionText);
    expect(withText.map((j) => j.externalId)).toEqual(["JR2023004"]);
    expect(withText[0]?.descriptionText).toContain("Deep Learning Safety group");
    expect(withText[0]?.descriptionText).toContain("- Build things\n- Ship things");
    expect(withText[0]?.location).toBe("US, CA, Santa Clara | US, TX, Austin");
    expect(out.jobs.filter((j) => !j.descriptionText)).toHaveLength(4);
  });

  it("keeps the list data of a job whose detail request fails", async () => {
    const f = detailFetch((url) => (url.includes("JR2023004") ? new Response("boom", { status: 500 }) : undefined));
    const out = await workday.listJobs(TOKEN, { fetch: f }, { detailsFor: new Set(["JR2023004"]) } as never) as { jobs: { descriptionText: string }[]; complete: boolean };
    expect(out.jobs).toHaveLength(5);
    expect(out.jobs.every((j) => j.descriptionText === "")).toBe(true);
    expect(out.complete).toBe(true);
  });

  it("fetchJob reads one posting by externalPath", async () => {
    const f = detailFetch();
    const job = await workday.fetchJob?.(TOKEN, "/job/US-CA-Santa-Clara/Senior-Software-Engineer--Machine-Learning-Safety_JR2023004", { fetch: f, now: () => NOW });
    expect(job).toMatchObject({
      atsType: "workday", externalId: "JR2023004", title: "Senior Software Engineer, Machine Learning Safety", companyToken: TOKEN,
      applyUrl: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-Software-Engineer--Machine-Learning-Safety_JR2023004",
    });
    expect(job?.descriptionText).toContain("Deep Learning Safety group");
    expect(job?.postedAt?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("fetchJob finds a requisition id by search, and returns null when it is gone", async () => {
    const f = workdayFetch((b) => (b.searchText === "JR2023004" ? list : { total: 0, jobPostings: [] }), (url) =>
      url.endsWith("Safety_JR2023004") ? json(detail) : new Response("nope", { status: 404 }));
    expect(await workday.fetchJob?.(TOKEN, "JR2023004", { fetch: f })).toMatchObject({ externalId: "JR2023004" });
    expect(bodies(f)[0]).toMatchObject({ searchText: "JR2023004" });
    expect(await workday.fetchJob?.(TOKEN, "JR0", { fetch: f })).toBeNull();
    expect(await workday.fetchJob?.(TOKEN, "/job/x/gone_JR1", { fetch: f })).toBeNull();
  });

  it("fetchJob throws BlockedByHostError on 403", async () => {
    const f = workdayFetch(() => list, () => new Response("", { status: 403 }));
    await expect(workday.fetchJob?.(TOKEN, "/job/x/y_JR1", { fetch: f })).rejects.toBeInstanceOf(BlockedByHostError);
  });
});
