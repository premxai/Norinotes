import { htmlToText } from "../html.js";
import { fetchWithRetry, RateLimitedError } from "../http.js";
import type { Connector, HttpOptions, ListOptions, ListResult, NormalizedJob } from "../types.js";
import { prettifyToken, REMOTE_RE, safeUrl } from "../util.js";

/*
 * Workday "CXS" careers API. The request shapes, the facet-splitting idea (Workday caps `total` at 2,000 and refuses
 * pages larger than 20) and the field mapping follow the MIT-licensed kalil0321/ats-scrapers
 * (src/ats_scrapers/scrapers/workday.py), re-written here in TypeScript.
 */

/** A job system refused us with 401/403. The registry disables the board instead of retrying (no retry storms). */
export class BlockedByHostError extends Error {
  constructor(readonly url: string, readonly status: number) {
    super(`${url} refused us with ${status}; the host blocks servers, skipping this board`);
    this.name = "BlockedByHostError";
  }
  get host(): string { return new URL(this.url).hostname; }
}

/** Options Workday understands on top of the shared ones. */
export type WorkdayListOptions = ListOptions & {
  /**
   * Jobs whose description should be fetched too (one request each): externalIds (requisition ids) or externalPaths.
   * Leave it out to keep the read cheap; descriptions can be filled later with `fetchJob`.
   */
  detailsFor?: ReadonlySet<string>;
};

/** Workday returns 400 for a larger page. */
export const PAGE_SIZE = 20;
/** Workday reports at most this as `total`; a slice that reports it is truncated and has to be split. */
export const TOTAL_CAP = 2000;
/** How many facet levels a split may nest. */
export const MAX_SPLIT_DEPTH = 4;
const DETAIL_CONCURRENCY = 4;
const PREFERRED_FACETS = ["jobFamilyGroup", "locationHierarchy1", "locations", "timeType", "workerSubType"];

type Posting = {
  title?: string; externalPath?: string; locationsText?: string; postedOn?: string; bulletFields?: string[]; remoteType?: string;
};
type FacetValue = { id?: string; descriptor?: string; count?: number; facetParameter?: string; values?: FacetValue[] };
type Facet = { facetParameter?: string; descriptor?: string; values?: FacetValue[] };
type ListPage = { total?: number; jobPostings?: Posting[]; facets?: Facet[] };
type DetailInfo = {
  title?: string; jobDescription?: string; location?: string; additionalLocations?: string[]; postedOn?: string; jobReqId?: string; remoteType?: string;
};
type Detail = { jobPostingInfo?: DetailInfo; hiringOrganization?: { name?: string } };
type Applied = Record<string, string[]>;
type Target = { tenant: string; wd: string; site: string; base: string; token: string };

function target(token: string): Target | null {
  const [tenant, wd, site, ...rest] = token.split("|");
  if (!tenant || !wd || !site || rest.length > 0 || !/^wd\d+$/i.test(wd)) return null;
  return { tenant, wd, site, base: `https://${tenant}.${wd}.myworkdayjobs.com`, token };
}

const listUrl = (t: Target) => `${t.base}/wday/cxs/${t.tenant}/${t.site}/jobs`;
const detailUrl = (t: Target, externalPath: string) => `${t.base}/wday/cxs/${t.tenant}/${t.site}${externalPath}`;
const applyUrl = (t: Target, externalPath: string) => `${t.base}/${t.site}${externalPath}`;

const DAY_MS = 86_400_000;

/**
 * "Posted Today", "Posted Yesterday", "Posted 3 Days Ago", "Posted 30+ Days Ago", "Posted 2 Months Ago" to the start
 * (UTC) of the approximate day. "30+" is the oldest bucket Workday shows, so 30 days is as close as it gets.
 */
export function parsePostedOn(text: string | null | undefined, now: number = Date.now()): Date | null {
  const s = text?.trim().toLowerCase();
  if (!s) return null;
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  if (/\btoday\b/.test(s)) return new Date(today);
  if (/\byesterday\b/.test(s)) return new Date(today - DAY_MS);
  const m = s.match(/(\d+)\s*\+?\s*(day|week|month)s?\s+ago/);
  if (!m) return null;
  const n = Number(m[1]);
  const days = m[2] === "day" ? n : m[2] === "week" ? n * 7 : n * 30;
  return new Date(today - days * DAY_MS);
}

const isRemote = (...parts: (string | undefined | null)[]): boolean => parts.some((p) => p != null && REMOTE_RE.test(p));

function toJob(t: Target, p: Posting, now: number): NormalizedJob | null {
  const externalPath = p.externalPath;
  if (!externalPath) return null;
  const location = p.locationsText?.trim() || null;
  const title = p.title?.trim() || "Untitled";
  const reqId = p.bulletFields?.find((b) => typeof b === "string" && b.trim())?.trim();
  return {
    atsType: "workday",
    externalId: reqId || externalPath,
    companyName: prettifyToken(t.tenant),
    companyToken: t.token,
    title,
    location,
    remote: isRemote(location, title, p.remoteType),
    descriptionText: "",
    applyUrl: applyUrl(t, externalPath),
    postedAt: parsePostedOn(p.postedOn, now),
  };
}

/** The facets worth splitting by, flattened (Workday nests some, like `locationMainGroup`, inside group entries). */
function flattenFacets(facets: Facet[] | undefined, out: { param: string; values: { id: string; count: number | null }[] }[] = []) {
  for (const f of facets ?? []) {
    const values = f.values ?? [];
    const leaves = values.filter((v) => typeof v.id === "string" && v.id);
    if (f.facetParameter && leaves.length > 0) {
      out.push({ param: f.facetParameter, values: leaves.map((v) => ({ id: v.id as string, count: typeof v.count === "number" ? v.count : null })) });
    }
    flattenFacets(values.filter((v) => Array.isArray(v.values)), out);
  }
  return out;
}

/** The facet with the most values that was not applied already (ties go to the better partitioning facets). */
function chooseFacet(facets: Facet[] | undefined, applied: Applied) {
  const rank = (p: string) => { const i = PREFERRED_FACETS.indexOf(p); return i === -1 ? PREFERRED_FACETS.length : i; };
  return flattenFacets(facets)
    .filter((f) => !(f.param in applied))
    .map((f) => ({ ...f, values: f.values.filter((v) => v.count !== 0) }))
    .filter((f) => f.values.length >= 2)
    .sort((a, b) => b.values.length - a.values.length || rank(a.param) - rank(b.param))[0] ?? null;
}

/** A non-2xx answer from the board. */
class StatusError extends Error {
  constructor(readonly url: string, readonly status: number) { super(`${url} failed: ${status}`); }
}

const drop = (res: Response) => { void res.body?.cancel().catch(() => {}); };

async function postPage(t: Target, applied: Applied, offset: number, searchText: string, http: HttpOptions | undefined): Promise<ListPage> {
  const url = listUrl(t);
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appliedFacets: applied, limit: PAGE_SIZE, offset, searchText }),
  }, http);
  if (!res.ok) { drop(res); throw new StatusError(url, res.status); }
  return (await res.json()) as ListPage;
}

type ReadState = { jobs: Map<string, NormalizedJob>; complete: boolean; aborted: boolean; t: Target; http: HttpOptions | undefined; now: number };

/** Add a page's postings (deduped by externalPath across the whole read); returns how many were new to this slice. */
function addPage(state: ReadState, page: ListPage, seen: Set<string>): number {
  let fresh = 0;
  for (const p of page.jobPostings ?? []) {
    const job = toJob(state.t, p, state.now);
    if (!job || !p.externalPath) continue;
    if (!seen.has(p.externalPath)) { seen.add(p.externalPath); fresh++; }
    if (!state.jobs.has(p.externalPath)) state.jobs.set(p.externalPath, job);
  }
  return fresh;
}

/**
 * Read one slice (the jobs matching `applied`): page it by offset when it is under the cap, otherwise split it by the
 * best facet and read each value as a slice of its own. Marks the read incomplete when something may be missing.
 */
async function readSlice(state: ReadState, applied: Applied, depth: number, firstPage?: ListPage): Promise<void> {
  const seen = new Set<string>(); // wrap detection is per slice: overlapping slices legitimately share jobs
  const fail = (err: unknown) => { state.complete = false; if (err instanceof RateLimitedError) state.aborted = true; };
  let first: ListPage;
  try {
    first = firstPage ?? await postPage(state.t, applied, 0, "", state.http);
  } catch (err) {
    fail(err);
    return;
  }
  const total = typeof first.total === "number" ? first.total : (first.jobPostings?.length ?? 0);
  addPage(state, first, seen);
  const capped = total >= TOTAL_CAP;

  if (capped) {
    const facet = depth < MAX_SPLIT_DEPTH ? chooseFacet(first.facets, applied) : null;
    if (facet) {
      // Overlap only inflates the sum, so a deficit means some jobs lack this facet and would be missed.
      const sum = facet.values.reduce((n, v) => n + (v.count ?? 0), 0);
      if (sum < total && facet.values.every((v) => v.count != null)) state.complete = false;
      for (const v of facet.values) {
        if (state.aborted) { state.complete = false; return; }
        await readSlice(state, { ...applied, [facet.param]: [v.id] }, depth + 1);
      }
      return;
    }
    // Nothing left to split by: take what the cap allows and say it may be partial.
    state.complete = false;
  }

  for (let offset = PAGE_SIZE; offset < Math.min(total, TOTAL_CAP); offset += PAGE_SIZE) {
    if (state.aborted) { state.complete = false; return; }
    let page: ListPage;
    try {
      page = await postPage(state.t, applied, offset, "", state.http);
    } catch (err) {
      fail(err);
      return;
    }
    // An empty page, or one made only of jobs this slice already gave us (offsets that wrap): stop, and do not trust it.
    if (!page.jobPostings?.length || addPage(state, page, seen) === 0) {
      state.complete = false;
      return;
    }
  }
}

async function getDetail(t: Target, externalPath: string, http: HttpOptions | undefined): Promise<Detail | null> {
  const url = detailUrl(t, externalPath);
  const res = await fetchWithRetry(url, { method: "GET" }, http);
  if (res.status === 404 || res.status === 422) { drop(res); return null; }
  if (res.status === 401 || res.status === 403) { drop(res); throw new BlockedByHostError(url, res.status); }
  if (!res.ok) { drop(res); throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`); }
  return (await res.json()) as Detail;
}

/** "N Locations" in the list is replaced by the real places when the detail names them. */
function detailLocation(info: DetailInfo, fallback: string | null): string | null {
  const names = [info.location, ...(info.additionalLocations ?? [])].filter((s): s is string => typeof s === "string" && s.trim() !== "");
  return names.length ? names.join(" | ") : fallback;
}

function withDetail(job: NormalizedJob, detail: Detail): NormalizedJob {
  const info = detail.jobPostingInfo;
  if (!info) return job;
  const location = detailLocation(info, job.location);
  return {
    ...job,
    descriptionText: htmlToText(info.jobDescription ?? ""),
    location,
    remote: job.remote || isRemote(location, info.remoteType),
    companyName: detail.hiringOrganization?.name?.trim() || job.companyName,
  };
}

/** Fetch the description of the wanted jobs, a few at a time. A failing detail request keeps the job as it is. */
async function fillDetails(t: Target, byPath: Map<string, NormalizedJob>, wanted: ReadonlySet<string>, http: HttpOptions | undefined): Promise<NormalizedJob[]> {
  const entries = [...byPath.entries()].map(([path, job]) => ({ path, job }));
  const out = entries.map((e) => e.job);
  const queue = entries.map((e, index) => ({ ...e, index })).filter((e) => wanted.has(e.job.externalId) || wanted.has(e.path));
  const workers = Array.from({ length: DETAIL_CONCURRENCY }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      try {
        const detail = await getDetail(t, next.path, http);
        if (detail) out[next.index] = withDetail(next.job, detail);
      } catch { /* keep list-level data */ }
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Workday CXS jobs API: `POST {tenant}.{wdN}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` pages 20 postings at a
 * time and has no descriptions; `GET .../{site}{externalPath}` returns one posting with its HTML description.
 * Token: `tenant|wdN|site`. `externalId` of a listed job is its requisition id (else its externalPath); `fetchJob`
 * and `parseUrl` use the externalPath (a requisition id is looked up by search).
 */
export const workday: Connector = {
  atsType: "workday",
  ready: true,
  capabilities: { maxConcurrencyPerHost: 8 },
  async listJobs(token: string, http?: HttpOptions, opts?: WorkdayListOptions): Promise<ListResult> {
    const t = target(token);
    if (!t) return { jobs: [], complete: false, notFound: true };
    const now = http?.now?.() ?? Date.now();

    // The very first request decides whether the board exists at all; its failures are the caller's, not "incomplete".
    let first: ListPage;
    try {
      first = await postPage(t, {}, 0, "", http);
    } catch (err) {
      if (err instanceof StatusError) {
        if (err.status === 404 || err.status === 422) return { jobs: [], complete: false, notFound: true };
        if (err.status === 401 || err.status === 403) throw new BlockedByHostError(err.url, err.status);
        throw new Error(`POST ${err.url} failed: ${err.status}`);
      }
      throw err;
    }

    const state: ReadState = { jobs: new Map(), complete: true, aborted: false, t, http, now };
    await readSlice(state, {}, 0, first);
    const wanted = opts?.detailsFor;
    const jobs = wanted && wanted.size > 0 ? await fillDetails(t, state.jobs, wanted, http) : [...state.jobs.values()];
    return { jobs, complete: state.complete };
  },
  async fetchJob(token: string, externalId: string, http?: HttpOptions) {
    const t = target(token);
    if (!t) return null;
    const now = http?.now?.() ?? Date.now();
    let externalPath = externalId.startsWith("/") ? externalId : null;
    let posting: Posting | null = null;
    if (!externalPath) {
      // A requisition id is not an address: search for it to learn the posting's externalPath.
      let page: ListPage;
      try { page = await postPage(t, {}, 0, externalId, http); } catch (err) {
        if (err instanceof StatusError) {
          if (err.status === 401 || err.status === 403) throw new BlockedByHostError(err.url, err.status);
          if (err.status === 404 || err.status === 422) return null;
        }
        throw err;
      }
      posting = page.jobPostings?.find((p) => p.bulletFields?.includes(externalId) || p.externalPath?.endsWith(`_${externalId}`)) ?? null;
      externalPath = posting?.externalPath ?? null;
    }
    if (!externalPath) return null;
    const detail = await getDetail(t, externalPath, http);
    const info = detail?.jobPostingInfo;
    if (!detail || !info) return null;
    const base = toJob(t, {
      title: info.title ?? posting?.title, externalPath, locationsText: info.location ?? posting?.locationsText,
      postedOn: info.postedOn ?? posting?.postedOn, bulletFields: info.jobReqId ? [info.jobReqId] : posting?.bulletFields, remoteType: info.remoteType,
    }, now);
    return base ? withDetail(base, detail) : null;
  },
  parseUrl(url) {
    const u = safeUrl(url);
    const host = u?.hostname.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/i);
    if (!u || !host) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 1 && /^[a-z]{2}[-_][a-z]{2,4}$/i.test(parts[0] as string)) return null; // a bare language, no site
    // An optional language segment ("en-US", "fr") comes before the site name.
    if (parts[0] && /^[a-z]{2}([-_][a-z]{2,4})?$/i.test(parts[0]) && parts[1] && parts[1].toLowerCase() !== "job") parts.shift();
    const site = parts[0];
    if (!site || site.toLowerCase() === "wday") return null;
    const token = `${host[1]}|${(host[2] as string).toLowerCase()}|${site}`;
    const jobAt = parts.indexOf("job", 1);
    if (jobAt === -1) return { token, externalId: null };
    const path = parts.slice(jobAt).filter((p) => !/^apply(manually)?$/i.test(p));
    return { token, externalId: `/${path.join("/")}` };
  },
};
