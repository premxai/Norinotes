import { htmlToText } from "../html.js";
import { RateLimitedError } from "../http.js";
import type { Connector, HttpOptions, ListResult, NormalizedJob } from "../types.js";
import { parseDate, prettifyToken, REMOTE_RE, safeUrl } from "../util.js";
import { feedError, getFeed, isHostLabel, isRedirect, joinParts, mapLimit, str } from "./feed-kit.js";

/*
 * Ported from the MIT-licensed kalil0321/ats-scrapers (src/ats_scrapers/scrapers/bamboohr.py), checked against live
 * tenants on 2026-11-02. That project says `/careers/list` was removed in 2024; it still answers today
 * (`{"meta":{"totalCount":N},"result":[...]}`), so it is tried first. If it is gone, `/jobs/embed2.php` is read: it now
 * answers JSON (`departments[].positions[]`), and older tenants still serve the HTML widget the reference parses.
 * Neither list carries descriptions, so each job's `/careers/{id}/detail` JSON is read (best effort per job).
 * A tenant that does not exist answers 302 to www.bamboohr.com.
 */

/** Detail requests per read: a board larger than this keeps list-level data (no description) for the rest. */
const MAX_DETAILS = 300;
const DETAIL_CONCURRENCY = 4;

type Place = { city?: string | null; state?: string | null; province?: string | null; country?: string | null; addressCountry?: string | null };
type ListItem = {
  id: string; title: string; department: string | null; location: string | null; remote: boolean; employmentType: string | null;
};
type Opening = {
  jobOpeningName?: string; jobOpeningStatus?: string; departmentLabel?: string; employmentStatusLabel?: string;
  description?: string; datePosted?: string; locationType?: string | number | null; isRemote?: boolean | null;
  location?: Place; atsLocation?: Place; jobOpeningShareUrl?: string;
};

const base = (token: string) => `https://${token}.bamboohr.com`;
const detailUrl = (token: string, id: string) => `${base(token)}/careers/${encodeURIComponent(id)}/detail`;

function placeText(...places: Array<Place | null | undefined>): string | null {
  for (const p of places) {
    const t = p ? joinParts([p.city, p.state ?? p.province, p.country ?? p.addressCountry]) : "";
    if (t) return t;
  }
  return null;
}

/** BambooHR's locationType: 0 on site, 1 remote, 2 hybrid. */
const isRemoteType = (t: unknown): boolean => String(t ?? "").trim() === "1";

function itemFromList(r: Record<string, unknown>): ListItem | null {
  const id = r["id"] != null ? String(r["id"]) : null;
  const title = str(r["jobOpeningName"]);
  if (!id || !title) return null;
  const location = placeText(r["atsLocation"] as Place, r["location"] as Place);
  return {
    id, title,
    department: str(r["departmentLabel"]),
    location,
    remote: r["isRemote"] === true || isRemoteType(r["locationType"]) || REMOTE_RE.test(location ?? ""),
    employmentType: str(r["employmentStatusLabel"]),
  };
}

// --- legacy HTML widget (embed2.php before it became JSON) -------------------------------------------------------
const POSITION_RE = /<li\b[^>]*id="bhrPositionID_(\d+)"[^>]*>([\s\S]*?)<\/li>/gi;
const DEPT_RE = /<li\b[^>]*id="bhrDepartmentID_\d+"[^>]*>([\s\S]*?)(?=<li\b[^>]*id="bhrDepartmentID_|$)/gi;

function itemsFromWidgetHtml(html: string): ListItem[] {
  const out: ListItem[] = [];
  const seen = new Set<string>();
  const take = (chunk: string, department: string | null) => {
    for (const m of chunk.matchAll(POSITION_RE)) {
      const id = m[1] as string;
      const body = m[2] as string;
      const title = htmlToText(body.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "");
      if (!title || seen.has(id)) continue;
      seen.add(id);
      const location = htmlToText(body.match(/<span\b[^>]*class="[^"]*BambooHR-ATS-Location[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "") || null;
      out.push({ id, title, department, location, remote: REMOTE_RE.test(location ?? ""), employmentType: null });
    }
  };
  let consumed = 0;
  for (const d of html.matchAll(DEPT_RE)) {
    consumed = (d.index ?? 0) + d[0].length;
    const name = htmlToText(d[1]?.match(/<div\b[^>]*class="[^"]*BambooHR-ATS-Department-Header[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "") || null;
    take(d[1] ?? "", name);
  }
  take(html.slice(consumed), null); // jobs outside any department block
  if (!out.length && /bhrPositionID_/i.test(html)) throw new Error("BambooHR widget lists jobs but none could be read");
  return out;
}

function itemsFromEmbedJson(data: unknown): ListItem[] {
  const depts = (data as { departments?: unknown }).departments;
  if (!Array.isArray(depts)) throw new Error("BambooHR embed answered JSON without a department list");
  const out: ListItem[] = [];
  for (const d of depts as Array<{ label?: string; positions?: Array<{ id?: number | string; name?: string; location?: string }> }>) {
    for (const p of d.positions ?? []) {
      const id = p.id != null ? String(p.id) : null;
      const title = str(p.name);
      if (!id || !title) continue;
      const location = str(p.location);
      out.push({ id, title, department: str(d.label), location, remote: REMOTE_RE.test(location ?? ""), employmentType: null });
    }
  }
  return out;
}

type Listing = { items: ListItem[] } | "gone";

async function readListing(token: string, http?: HttpOptions): Promise<Listing> {
  const listUrl = `${base(token)}/careers/list`;
  const res = await getFeed(listUrl, http, { manualRedirect: true });
  if (isRedirect(res.status)) return "gone";
  if (res.status === 200) {
    try {
      const data = JSON.parse(res.body) as { result?: unknown };
      if (Array.isArray(data.result)) {
        return { items: data.result.map((r) => itemFromList(r as Record<string, unknown>)).filter((i): i is ListItem => i !== null) };
      }
    } catch { /* not JSON: fall through to the widget */ }
  } else if (res.status !== 404 && res.status !== 410) {
    throw feedError(listUrl, res.status);
  }
  const embedUrl = `${base(token)}/jobs/embed2.php`;
  const emb = await getFeed(embedUrl, http, { manualRedirect: true, accept: "application/json, text/html" });
  if (isRedirect(emb.status) || emb.status === 404 || emb.status === 410) return "gone";
  if (emb.status !== 200) throw feedError(embedUrl, emb.status);
  const trimmed = emb.body.trimStart();
  if (trimmed.startsWith("{")) {
    try { return { items: itemsFromEmbedJson(JSON.parse(trimmed)) }; } catch (err) { throw new Error(`GET ${embedUrl}: ${(err as Error).message}`); }
  }
  return { items: itemsFromWidgetHtml(emb.body) };
}

async function readDetail(token: string, id: string, http?: HttpOptions): Promise<Opening | null | "error" | RateLimitedError> {
  const url = detailUrl(token, id);
  try {
    const res = await getFeed(url, http, { headers: { "x-requested-with": "XMLHttpRequest" } });
    if (res.status === 404) return null;
    if (res.status !== 200) return "error";
    const opening = (JSON.parse(res.body) as { result?: { jobOpening?: Opening } }).result?.jobOpening;
    return opening && typeof opening === "object" ? opening : "error";
  } catch (err) { return err instanceof RateLimitedError ? err : "error"; }
}

function toJob(token: string, id: string, item: ListItem | null, d: Opening | null): NormalizedJob | null {
  const title = str(d?.jobOpeningName) ?? item?.title;
  if (!title) return null;
  const location = placeText(d?.location, d?.atsLocation) ?? item?.location ?? null;
  return {
    atsType: "bamboohr",
    externalId: id,
    companyName: prettifyToken(token),
    companyToken: token,
    title,
    location,
    remote: (d ? d.isRemote === true || isRemoteType(d.locationType) : false) || (item?.remote ?? false) || REMOTE_RE.test(location ?? ""),
    descriptionText: htmlToText(d?.description ?? ""),
    applyUrl: `${base(token)}/careers/${encodeURIComponent(id)}`,
    postedAt: parseDate(d?.datePosted),
  };
}

async function readBoard(token: string, http?: HttpOptions): Promise<ListResult> {
  if (!isHostLabel(token)) return { jobs: [], complete: true, notFound: true };
  const listing = await readListing(token, http);
  if (listing === "gone") return { jobs: [], complete: true, notFound: true };
  const state: { limited: RateLimitedError | null } = { limited: null };
  const detailed = await mapLimit(listing.items.slice(0, MAX_DETAILS), DETAIL_CONCURRENCY, async (item) => {
    const d = await readDetail(token, item.id, http);
    if (d instanceof RateLimitedError) state.limited = d;
    return toJob(token, item.id, item, d !== null && typeof d === "object" && !(d instanceof RateLimitedError) ? d : null);
  });
  // A host that refuses us must not turn into a board full of description-less jobs: let the queue retry later.
  if (state.limited) throw state.limited;
  const rest = listing.items.slice(MAX_DETAILS).map((item) => toJob(token, item.id, item, null));
  const jobs = [...detailed, ...rest].filter((j): j is NormalizedJob => j !== null);
  return { jobs, complete: true };
}

/** BambooHR careers pages: list (or embed widget) plus per-job detail JSON. */
export const bamboohr: Connector = {
  atsType: "bamboohr",
  ready: true,
  capabilities: { maxConcurrencyPerHost: 4 },
  listJobs: (token, http) => readBoard(token, http),
  async fetchJob(token, externalId, http) {
    if (!isHostLabel(token)) return null;
    const d = await readDetail(token, externalId, http);
    if (d === null) return null;
    if (d instanceof RateLimitedError) throw d;
    if (d === "error") throw new Error(`GET ${detailUrl(token, externalId)} failed`);
    if (d.jobOpeningStatus && d.jobOpeningStatus.toLowerCase() !== "open") return null;
    return toJob(token, externalId, null, d);
  },
  parseUrl(url) {
    const u = safeUrl(url);
    const m = u?.hostname.toLowerCase().match(/^([a-z0-9-]+)\.bamboohr\.com$/);
    if (!u || !m || ["www", "api", "app", "help", "documentation"].includes(m[1] as string)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "careers") return { token: m[1] as string, externalId: parts[1] && /^\d+$/.test(parts[1]) ? parts[1] : null };
    if (parts[0] === "jobs") {
      const id = u.searchParams.get("id");
      return { token: m[1] as string, externalId: id && /^\d+$/.test(id) ? id : null };
    }
    return null;
  },
};
