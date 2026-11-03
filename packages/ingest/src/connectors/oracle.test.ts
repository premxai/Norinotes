import { describe, expect, it, vi } from "vitest";
import detail from "../__fixtures__/oracle-detail.json";
import list from "../__fixtures__/oracle-list.json";
import { json, noSleep } from "../__fixtures__/helpers.js";
import { RateLimitedError, USER_AGENT } from "../http.js";
import type { ListResult } from "../types.js";
import { oracle, ORACLE_PAGE_SIZE } from "./oracle.js";
import { BlockedByHostError } from "./workday.js";

const TOKEN = "eeho|us2|CX_45001";
const ORIGIN = "https://eeho.fa.us2.oraclecloud.com";
const LIST = `${ORIGIN}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`;
const DETAILS = `${ORIGIN}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails`;

type Row = Record<string, unknown>;

const envelope = (rows: Row[], total: number) => ({ items: [{ SiteNumber: "CX_45001", TotalJobsCount: total, requisitionList: rows }], count: 1, hasMore: false });
const row = (id: number): Row => ({ Id: String(id), Title: `Job ${id}`, PostedDate: "2026-11-01", PrimaryLocation: "Austin, TX, United States" });

/** A mocked Oracle: `handle` gets the offset and limit parsed from the finder. */
function oracleFetch(handle: (offset: number, limit: number, url: URL) => Response | object) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.origin + url.pathname === LIST) {
      const finder = url.searchParams.get("finder") ?? "";
      const offset = Number(finder.match(/offset=(\d+)/)?.[1]);
      const limit = Number(finder.match(/limit=(\d+)/)?.[1]);
      const out = handle(offset, limit, url);
      return out instanceof Response ? out : json(out);
    }
    return new Response("not found", { status: 404 });
  }) as ReturnType<typeof vi.fn> & typeof fetch;
}

const pagedServer = (total: number) => oracleFetch((offset, limit) =>
  envelope(Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => row(offset + i + 1)), total));

describe("oracle parseUrl", () => {
  it("recognises board and posting URLs", () => {
    expect(oracle.parseUrl(`${ORIGIN}/hcmUI/CandidateExperience/en/sites/CX_45001`)).toEqual({ token: TOKEN, externalId: null });
    expect(oracle.parseUrl(`${ORIGIN}/hcmUI/CandidateExperience/en/sites/CX_45001/jobs?mode=location`)).toEqual({ token: TOKEN, externalId: null });
    expect(oracle.parseUrl(`${ORIGIN}/hcmUI/CandidateExperience/fr/sites/CX_45001/job/333299?lastSelectedFacet=x`)).toEqual({ token: TOKEN, externalId: "333299" });
    expect(oracle.parseUrl("https://ehtf.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/1234/")).toEqual({ token: "ehtf|us2|CX_1", externalId: "1234" });
  });
  it("returns null for other hosts and other Oracle paths", () => {
    expect(oracle.parseUrl("https://jobs.lever.co/acme/1")).toBeNull();
    expect(oracle.parseUrl(`${ORIGIN}/hcmUI/Other/en/sites/CX_1`)).toBeNull();
    expect(oracle.parseUrl("https://example.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1")).toBeNull();
  });
  it("is a ready connector with a host concurrency limit", () => {
    expect(oracle.ready).toBe(true);
    expect(oracle.capabilities?.maxConcurrencyPerHost).toBe(4);
  });
});

describe("oracle listJobs", () => {
  it("normalises requisitions and asks with the expand and finder the API needs", async () => {
    const f = oracleFetch(() => list);
    const out = await oracle.listJobs(TOKEN, { fetch: f }) as ListResult;
    expect(out.complete).toBe(true);
    expect(out.jobs).toHaveLength(2);
    expect(out.jobs[0]).toMatchObject({
      atsType: "oracle", externalId: "333299", companyName: "Eeho", companyToken: TOKEN,
      title: "Principal, End-to-End Data Center Power Delivery Manager", remote: false,
      applyUrl: `${ORIGIN}/hcmUI/CandidateExperience/en/sites/CX_45001/job/333299`,
    });
    expect(out.jobs[0]?.location).toBe("NM, United States");
    expect(out.jobs[0]?.postedAt?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(out.jobs[0]?.descriptionText).toMatch(/^Accountable for end-to-end program oversight/);
    expect(out.jobs[1]).toMatchObject({ location: "Remote - United States", remote: true });

    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    const u = new URL(url);
    expect(u.searchParams.get("onlyData")).toBe("true");
    expect(u.searchParams.get("expand")).toBe("requisitionList.workLocation,requisitionList.secondaryLocations");
    expect(u.searchParams.get("finder")).toBe("findReqs;siteNumber=CX_45001,limit=200,offset=0,sortBy=POSTING_DATES_DESC");
    expect(init.headers).toMatchObject({ "user-agent": USER_AGENT });
  });

  it("pages 200 at a time until TotalJobsCount", async () => {
    const f = pagedServer(450);
    const out = await oracle.listJobs(TOKEN, { fetch: f }) as ListResult;
    expect(out.jobs).toHaveLength(450);
    expect(out.complete).toBe(true);
    expect(ORACLE_PAGE_SIZE).toBe(200);
    expect(f.mock.calls.map((c) => new URL(String(c[0])).searchParams.get("finder")?.match(/offset=(\d+)/)?.[1])).toEqual(["0", "200", "400"]);
  });

  it("steps by what a tenant actually returns when it gives fewer than 200", async () => {
    const f = oracleFetch((offset) => envelope(Array.from({ length: Math.min(50, 120 - offset) }, (_, i) => row(offset + i + 1)), 120));
    const out = await oracle.listJobs(TOKEN, { fetch: f }) as ListResult;
    expect(out.jobs).toHaveLength(120);
    expect(out.complete).toBe(true);
    expect(f.mock.calls).toHaveLength(3);
  });

  it("tolerates field-name variations", async () => {
    const f = oracleFetch(() => ({
      items: [{
        totalJobsCount: 3,
        requisitionList: [
          { id: 11, title: "Lower case", postedDate: "2026-10-30T08:00:00Z", primaryLocation: "Paris, France", workplaceTypeCode: "ORA_REMOTE" },
          { Id: "12", Name: "Name instead of title", PostingStartDate: "2026-10-29", Location: "Berlin", ShortDescriptionStr: "<p>Short</p><ul><li>one</li></ul>" },
          { Id: "13", Title: "From work location", workLocation: [{ LocationName: "Dublin, Ireland" }], secondaryLocations: [{ Name: "Cork, Ireland" }, { Name: "dublin, ireland" }] },
        ],
      }],
    }));
    const out = await oracle.listJobs(TOKEN, { fetch: f }) as ListResult;
    expect(out.jobs.map((j) => j.externalId)).toEqual(["11", "12", "13"]);
    expect(out.jobs[0]).toMatchObject({ title: "Lower case", location: "Paris, France", remote: true });
    expect(out.jobs[0]?.postedAt?.toISOString()).toBe("2026-10-30T08:00:00.000Z");
    expect(out.jobs[1]).toMatchObject({ title: "Name instead of title", location: "Berlin", descriptionText: "Short\n\n- one" });
    expect(out.jobs[1]?.postedAt?.toISOString()).toBe("2026-10-29T00:00:00.000Z");
    expect(out.jobs[2]).toMatchObject({ location: "Dublin, Ireland | Cork, Ireland", postedAt: null });
  });

  it("treats an empty board as complete, and a total with no requisitions as incomplete", async () => {
    expect(await oracle.listJobs(TOKEN, { fetch: oracleFetch(() => envelope([], 0)) })).toEqual({ jobs: [], complete: true });
    expect(await oracle.listJobs(TOKEN, { fetch: oracleFetch(() => ({ items: [] })) })).toEqual({ jobs: [], complete: true });
    expect(await oracle.listJobs(TOKEN, { fetch: oracleFetch(() => envelope([], 40)) })).toEqual({ jobs: [], complete: false });
  });

  it("stops on a page of ids already seen (wrapping offsets) as incomplete", async () => {
    const f = oracleFetch((_offset, limit) => envelope(Array.from({ length: Math.min(limit, 200) }, (_, i) => row(i + 1)), 1000));
    const out = await oracle.listJobs(TOKEN, { fetch: f }) as ListResult;
    expect(out.jobs).toHaveLength(200);
    expect(out.complete).toBe(false);
    expect(f.mock.calls).toHaveLength(2);
  });

  it("returns what it has with complete:false when a later page fails", async () => {
    const f = oracleFetch((offset, limit) => (offset >= 200 ? new Response("boom", { status: 500 }) : envelope(Array.from({ length: limit }, (_, i) => row(offset + i + 1)), 450)));
    const out = await oracle.listJobs(TOKEN, { fetch: f, ...noSleep }) as ListResult;
    expect(out.jobs).toHaveLength(200);
    expect(out.complete).toBe(false);
  });

  it("answers notFound for 404 and 422 on the first request", async () => {
    for (const status of [404, 422]) {
      expect(await oracle.listJobs(TOKEN, { fetch: oracleFetch(() => new Response("", { status })) })).toEqual({ jobs: [], complete: false, notFound: true });
    }
    expect(await oracle.listJobs("bad-token", { fetch: pagedServer(1) })).toMatchObject({ notFound: true });
  });

  it("throws BlockedByHostError for 401 and 403, and plain errors for 5xx and 429", async () => {
    for (const status of [401, 403]) {
      const err = await oracle.listJobs(TOKEN, { fetch: oracleFetch(() => new Response("", { status })) }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BlockedByHostError);
      expect(err).toMatchObject({ status, host: "eeho.fa.us2.oraclecloud.com" });
    }
    await expect(oracle.listJobs(TOKEN, { fetch: oracleFetch(() => new Response("gateway", { status: 504 })) })).rejects.toThrow(/504/);
    await expect(oracle.listJobs(TOKEN, { fetch: oracleFetch(() => new Response("", { status: 429 })), ...noSleep })).rejects.toBeInstanceOf(RateLimitedError);
  });
});

describe("oracle fetchJob", () => {
  const detailFetch = (res: () => Response) => vi.fn(async (input: string | URL | Request) => {
    const u = new URL(String(input));
    expect(u.origin + u.pathname).toBe(DETAILS);
    expect(u.searchParams.get("finder")).toBe('ById;Id="333299",siteNumber=CX_45001');
    expect(u.searchParams.get("onlyData")).toBe("true");
    return res();
  }) as ReturnType<typeof vi.fn> & typeof fetch;

  it("reads the full description from the details resource", async () => {
    const job = await oracle.fetchJob?.(TOKEN, "333299", { fetch: detailFetch(() => json(detail)) });
    expect(job).toMatchObject({
      atsType: "oracle", externalId: "333299", title: "Principal, End-to-End Data Center Power Delivery Manager", location: "NM, United States",
      applyUrl: `${ORIGIN}/hcmUI/CandidateExperience/en/sites/CX_45001/job/333299`,
    });
    expect(job?.descriptionText).toContain("Power Delivery Manager");
    expect(job?.descriptionText).not.toMatch(/<[a-z]/);
    expect(job?.postedAt?.toISOString()).toBe("2026-11-02T19:44:43.000Z");
  });

  it("returns null for an empty answer or a 404, and throws BlockedByHostError on 403", async () => {
    expect(await oracle.fetchJob?.(TOKEN, "333299", { fetch: detailFetch(() => json({ items: [] })) })).toBeNull();
    expect(await oracle.fetchJob?.(TOKEN, "333299", { fetch: detailFetch(() => new Response("", { status: 404 })) })).toBeNull();
    await expect(oracle.fetchJob?.(TOKEN, "333299", { fetch: detailFetch(() => new Response("", { status: 403 })) })).rejects.toBeInstanceOf(BlockedByHostError);
  });
});
