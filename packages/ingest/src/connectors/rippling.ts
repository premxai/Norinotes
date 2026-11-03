import { htmlToText } from "../html.js";
import { RateLimitedError } from "../http.js";
import type { Connector, HttpOptions, ListResult, NormalizedJob } from "../types.js";
import { parseDate, prettifyToken, REMOTE_RE, safeUrl } from "../util.js";
import { feedError, getFeed, joinParts, mapLimit, parseJsonBody, str, uniq } from "./feed-kit.js";

/*
 * Ported from the MIT-licensed kalil0321/ats-scrapers (src/ats_scrapers/scrapers/rippling.py), checked against live
 * boards on 2026-11-02. NOTE: the reference reads `api.rippling.com/platform/api/ats/v1/board/{slug}/jobs`; the same
 * path on `ats.rippling.com` answers an HTML 404, so this connector uses api.rippling.com. An unknown board answers 404
 * with `{"error_code":"RESOURCE_NOT_FOUND"}`. The list (one response, no paging; 679 jobs seen on Rippling's own board)
 * has only title, department and location; each job's detail JSON adds the description, company name and creation date.
 */

/** Detail requests per read; the rest keep list-level data (no description). */
const MAX_DETAILS = 400;
const DETAIL_CONCURRENCY = 4;

type RpListItem = {
  uuid?: string; id?: string; name?: string; url?: string;
  department?: { id?: string; label?: string } | string; workLocation?: { label?: string; id?: string } | string;
};
type RpDetail = {
  uuid?: string; name?: string; url?: string; companyName?: string; createdOn?: string; workLocations?: unknown[];
  description?: { company?: string; role?: string } | string;
  employmentType?: { label?: string; id?: string };
};

const api = (token: string) => `https://api.rippling.com/platform/api/ats/v1/board/${encodeURIComponent(token)}/jobs`;
const hostedUrl = (token: string, id: string) => `https://ats.rippling.com/${encodeURIComponent(token)}/jobs/${encodeURIComponent(id)}`;

function locationLabel(v: unknown): string | null {
  if (typeof v === "string") return str(v);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return str(o["label"]) ?? str(o["displayName"]) ?? (joinParts([str(o["city"]), str(o["country"])]) || null);
  }
  return null;
}

function toJob(token: string, item: RpListItem, detail: RpDetail | null, company: string | null): NormalizedJob | null {
  const id = str(item.uuid) ?? str(item.id) ?? str(detail?.uuid);
  const title = str(item.name) ?? str(detail?.name);
  if (!id || !title) return null;
  const location = uniq([locationLabel(item.workLocation), ...(detail?.workLocations ?? []).map(locationLabel)]).join(" | ") || null;
  const d = detail?.description;
  const description = typeof d === "string" ? htmlToText(d) : [d?.role, d?.company].map((h) => htmlToText(h ?? "")).filter(Boolean).join("\n\n");
  return {
    atsType: "rippling",
    externalId: id,
    companyName: str(detail?.companyName) ?? company ?? prettifyToken(token),
    companyToken: token,
    title,
    location,
    remote: REMOTE_RE.test(location ?? "") || REMOTE_RE.test(title),
    descriptionText: description,
    applyUrl: str(item.url) ?? str(detail?.url) ?? hostedUrl(token, id),
    postedAt: parseDate(detail?.createdOn),
  };
}

type Listing = RpListItem[] | "gone";

async function readList(token: string, http?: HttpOptions): Promise<Listing> {
  const url = api(token);
  const res = await getFeed(url, http);
  if (res.status === 404) return "gone";
  if (res.status !== 200) throw feedError(url, res.status);
  const data = parseJsonBody<unknown>(url, res.body);
  const items = Array.isArray(data) ? data : (data as { items?: unknown; jobs?: unknown } | null)?.items ?? (data as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(items)) throw new Error(`GET ${url} returned something that is not a job list`);
  return items as RpListItem[];
}

async function readDetail(token: string, id: string, http?: HttpOptions): Promise<RpDetail | null | RateLimitedError> {
  try {
    const res = await getFeed(`${api(token)}/${encodeURIComponent(id)}`, http);
    return res.status === 200 ? (JSON.parse(res.body) as RpDetail) : null;
  } catch (err) { return err instanceof RateLimitedError ? err : null; }
}

async function readBoard(token: string, http?: HttpOptions): Promise<ListResult> {
  const list = await readList(token, http);
  if (list === "gone") return { jobs: [], complete: true, notFound: true };
  // A job listed once per location shares its uuid: keep one, with every location.
  const byId = new Map<string, RpListItem>();
  for (const it of list) {
    const id = str(it?.uuid) ?? str(it?.id);
    if (!id) continue;
    const have = byId.get(id);
    if (!have) { byId.set(id, it); continue; }
    const merged = uniq([locationLabel(have.workLocation), locationLabel(it.workLocation)]).join(" | ");
    have.workLocation = merged;
  }
  const items = [...byId.values()];
  const state: { limited: RateLimitedError | null; company: string | null } = { limited: null, company: null };
  const details = await mapLimit(items.slice(0, MAX_DETAILS), DETAIL_CONCURRENCY, async (it) => {
    const d = await readDetail(token, (str(it.uuid) ?? str(it.id)) as string, http);
    if (d instanceof RateLimitedError) { state.limited = d; return null; }
    state.company = state.company ?? str(d?.companyName);
    return d;
  });
  if (state.limited) throw state.limited; // do not turn a refusing host into description-less jobs
  const jobs = items.map((it, i) => toJob(token, it, details[i] ?? null, state.company)).filter((j): j is NormalizedJob => j !== null);
  return { jobs, complete: true };
}

/** Rippling public ATS board API: list plus per-job detail. */
export const rippling: Connector = {
  atsType: "rippling",
  ready: true,
  capabilities: { maxConcurrencyPerHost: 4 },
  listJobs: (token, http) => readBoard(token, http),
  async fetchJob(token, externalId, http) {
    const url = `${api(token)}/${encodeURIComponent(externalId)}`;
    const res = await getFeed(url, http);
    if (res.status === 404) return null;
    if (res.status !== 200) throw feedError(url, res.status);
    const d = parseJsonBody<RpDetail>(url, res.body);
    return toJob(token, { uuid: externalId, name: d.name, url: d.url }, d, null);
  },
  parseUrl(url) {
    const u = safeUrl(url);
    if (!u || u.hostname.toLowerCase() !== "ats.rippling.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] && /^[a-z]{2}-[A-Za-z]{2}$/.test(parts[0]) && parts.length > 1) parts.shift(); // locale prefix
    const [token, seg, id] = parts;
    if (!token || ["platform", "api", "_next", "static"].includes(token.toLowerCase())) return null;
    return { token: decodeURIComponent(token), externalId: seg === "jobs" && id ? id : null };
  },
};
