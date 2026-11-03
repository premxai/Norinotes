import { htmlToText } from "../html.js";
import { fetchWithRetry } from "../http.js";
import type { Connector, HttpOptions, ListResult, NormalizedJob } from "../types.js";
import { parseDate, prettifyToken, REMOTE_RE, safeUrl } from "../util.js";
import { BlockedByHostError } from "./workday.js";

/*
 * Oracle Recruiting Cloud (Fusion HCM "Candidate Experience") public REST API. The endpoints, the finder syntax (paging
 * lives inside `finder`, top-level limit/offset are ignored) and the field names follow the MIT-licensed
 * kalil0321/ats-scrapers (src/ats_scrapers/scrapers/oracle.py), re-written here in TypeScript.
 */

/** Requisitions per request. */
export const ORACLE_PAGE_SIZE = 200;
/** Safety net against a tenant that never runs out of pages. */
const MAX_PAGES = 250;

type Row = Record<string, unknown>;
type Target = { host: string; region: string; site: string; origin: string; token: string };

function target(token: string): Target | null {
  const [host, region, site, ...rest] = token.split("|");
  if (!host || !region || !site || rest.length > 0) return null;
  return { host, region, site, origin: `https://${host}.fa.${region}.oraclecloud.com`, token };
}

const api = (t: Target, resource: string) => `${t.origin}/hcmRestApi/resources/latest/${resource}`;
const applyUrl = (t: Target, id: string) => `${t.origin}/hcmUI/CandidateExperience/en/sites/${encodeURIComponent(t.site)}/job/${encodeURIComponent(id)}`;

function listUrl(t: Target, offset: number): string {
  const finder = `findReqs;siteNumber=${t.site},limit=${ORACLE_PAGE_SIZE},offset=${offset},sortBy=POSTING_DATES_DESC`;
  return `${api(t, "recruitingCEJobRequisitions")}?onlyData=true&expand=${encodeURIComponent("requisitionList.workLocation,requisitionList.secondaryLocations")}&finder=${encodeURIComponent(finder)}`;
}

function detailUrl(t: Target, id: string): string {
  return `${api(t, "recruitingCEJobRequisitionDetails")}?onlyData=true&finder=${encodeURIComponent(`ById;Id="${id}",siteNumber=${t.site}`)}`;
}

/** Field lookup that tolerates the name variations between Oracle versions (`Title`, `title`, `TITLE`). */
function reader(row: Row) {
  const lower = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) lower.set(k.toLowerCase(), v);
  const get = (...names: string[]): unknown => {
    for (const n of names) {
      const v = lower.get(n.toLowerCase());
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return undefined;
  };
  const str = (...names: string[]): string | null => {
    const v = get(...names);
    return typeof v === "string" ? v.trim() || null : typeof v === "number" ? String(v) : null;
  };
  return { get, str };
}

function locationOf(r: ReturnType<typeof reader>): string | null {
  const names = (v: unknown, ...keys: string[]): string[] =>
    (Array.isArray(v) ? v : []).map((x) => (x && typeof x === "object" ? reader(x as Row).str(...keys) : null)).filter((s): s is string => Boolean(s));
  const primary = r.str("PrimaryLocation", "Location")
    ?? names(r.get("workLocation"), "LocationName", "Name", "TownOrCity", "Region2", "Country")[0] ?? null;
  const more = names(r.get("secondaryLocations"), "Name", "LocationName");
  const parts = primary ? [primary] : [];
  for (const m of more) if (!parts.some((p) => p.toLowerCase().includes(m.toLowerCase()))) parts.push(m);
  return parts.length ? parts.join(" | ") : null;
}

/** `workplace` is a code like ORA_REMOTE, ORA_HYBRID or ORA_ONSITE; the others are free text. */
const isRemote = (workplace: string | null, ...text: (string | null)[]) =>
  (workplace != null && /remote/i.test(workplace)) || text.some((p) => p != null && REMOTE_RE.test(p));

function toJob(t: Target, row: Row): NormalizedJob | null {
  const r = reader(row);
  const id = r.str("Id", "JobId", "RequisitionId", "RequisitionNumber");
  if (!id) return null;
  const title = r.str("Title", "Name", "JobTitle") ?? "Untitled";
  const location = locationOf(r);
  const workplace = r.str("WorkplaceTypeCode", "WorkplaceType");
  return {
    atsType: "oracle",
    externalId: id,
    companyName: prettifyToken(t.host),
    companyToken: t.token,
    title,
    location,
    remote: isRemote(workplace, location, title),
    descriptionText: htmlToText(r.str("ShortDescriptionStr", "ShortDescription") ?? ""),
    applyUrl: applyUrl(t, id),
    postedAt: parseDate(r.get("PostedDate", "PostingStartDate", "ExternalPostedStartDate", "CreatedOn")),
  };
}

const drop = (res: Response) => { void res.body?.cancel().catch(() => {}); };

/** One page: the requisitions and the total (`TotalJobsCount`, read from the first page only). */
type Page = { rows: Row[]; total: number | null };

function parsePage(body: unknown): Page {
  const items = (body as { items?: unknown })?.items;
  const head = Array.isArray(items) ? (items[0] as Row | undefined) : undefined;
  if (!head) return { rows: [], total: 0 };
  const h = reader(head);
  const list = h.get("requisitionList");
  const totalRaw = Number(h.get("TotalJobsCount", "totalJobsCount"));
  const total = Number.isFinite(totalRaw) ? totalRaw : null;
  if (Array.isArray(list)) return { rows: list.filter((x): x is Row => Boolean(x) && typeof x === "object"), total };
  // Some deployments answer with the requisitions themselves as `items`.
  if (h.get("Id", "Title") !== undefined) return { rows: (items as Row[]), total: Number.isFinite(Number((body as Row).count)) ? Number((body as Row).count) : null };
  return { rows: [], total };
}

class StatusError extends Error {
  constructor(readonly url: string, readonly status: number) { super(`${url} failed: ${status}`); }
}

async function getPage(t: Target, offset: number, http: HttpOptions | undefined): Promise<Page> {
  const url = listUrl(t, offset);
  const res = await fetchWithRetry(url, { method: "GET" }, http);
  if (!res.ok) { drop(res); throw new StatusError(url, res.status); }
  return parsePage(await res.json());
}

function detailText(d: Row): string {
  const r = reader(d);
  const sections = [r.str("ExternalDescriptionStr"), r.str("ExternalResponsibilitiesStr"), r.str("ExternalQualificationsStr")]
    .map((s) => htmlToText(s ?? "")).filter(Boolean);
  return sections.length ? sections.join("\n\n") : htmlToText(r.str("ShortDescriptionStr") ?? "");
}

/**
 * Oracle Recruiting Cloud: `GET {host}.fa.{region}.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions`
 * with the paging inside `finder` lists requisitions (200 per request, with a short description); the details resource
 * returns the full description. Token: `host|region|siteNumber`.
 */
export const oracle: Connector = {
  atsType: "oracle",
  ready: true,
  capabilities: { maxConcurrencyPerHost: 4 },
  async listJobs(token: string, http?: HttpOptions): Promise<ListResult> {
    const t = target(token);
    if (!t) return { jobs: [], complete: false, notFound: true };

    // The very first request decides whether the board exists; its failures are the caller's, not "incomplete".
    let first: Page;
    try {
      first = await getPage(t, 0, http);
    } catch (err) {
      if (err instanceof StatusError) {
        if (err.status === 404 || err.status === 422) return { jobs: [], complete: false, notFound: true };
        if (err.status === 401 || err.status === 403) throw new BlockedByHostError(err.url, err.status);
        throw new Error(`GET ${err.url} failed: ${err.status}`);
      }
      throw err;
    }

    const total = first.total ?? first.rows.length;
    const jobs = new Map<string, NormalizedJob>();
    let complete = true;
    const add = (rows: Row[]): number => {
      let fresh = 0;
      for (const row of rows) {
        const job = toJob(t, row);
        if (job && !jobs.has(job.externalId)) { jobs.set(job.externalId, job); fresh++; }
      }
      return fresh;
    };
    add(first.rows);
    // A total with no requisitions is what a missing `expand` looks like: do not call that an empty board.
    if (total > 0 && jobs.size === 0) return { jobs: [], complete: false };

    let offset = first.rows.length;
    for (let pages = 1; offset < total && pages < MAX_PAGES; pages++) {
      let page: Page;
      try {
        page = await getPage(t, offset, http);
      } catch {
        complete = false;
        break;
      }
      // Empty, or nothing new (offsets that wrap): stop and do not trust the read.
      if (page.rows.length === 0 || add(page.rows) === 0) { complete = false; break; }
      offset += page.rows.length;
    }
    if (jobs.size < total && complete) complete = false;
    return { jobs: [...jobs.values()], complete };
  },
  async fetchJob(token: string, externalId: string, http?: HttpOptions) {
    const t = target(token);
    if (!t) return null;
    const url = detailUrl(t, externalId);
    const res = await fetchWithRetry(url, { method: "GET" }, http);
    if (res.status === 404 || res.status === 422) { drop(res); return null; }
    if (res.status === 401 || res.status === 403) { drop(res); throw new BlockedByHostError(url, res.status); }
    if (!res.ok) { drop(res); throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`); }
    const head = ((await res.json()) as { items?: Row[] }).items?.[0];
    if (!head) return null;
    const job = toJob(t, { Id: externalId, ...head });
    return job ? { ...job, descriptionText: detailText(head) } : null;
  },
  parseUrl(url) {
    const u = safeUrl(url);
    const host = u?.hostname.match(/^([a-z0-9-]+)\.fa\.([a-z0-9-]+)\.oraclecloud\.com$/i);
    if (!u || !host) return null;
    const m = u.pathname.match(/\/hcmUI\/CandidateExperience\/[^/]+\/sites\/([^/]+)(?:\/(.*))?$/i);
    if (!m?.[1]) return null;
    const id = m[2]?.match(/(?:^|\/)job\/([^/?#]+)/i)?.[1] ?? null;
    return { token: `${host[1]}|${host[2]}|${decodeURIComponent(m[1])}`, externalId: id ? decodeURIComponent(id) : null };
  },
};
