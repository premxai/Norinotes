import { htmlToText } from "../html.js";
import { RateLimitedError } from "../http.js";
import type { Connector, HttpOptions, ListResult, NormalizedJob } from "../types.js";
import { parseDate, prettifyToken, REMOTE_RE, safeUrl } from "../util.js";
import { feedError, getFeed, isHostLabel, isRedirect, joinParts, mapLimit, parseJsonBody, str, uniq } from "./feed-kit.js";
import { parseJobPostingJsonLd } from "./jsonld.js";

/*
 * Ported from the MIT-licensed kalil0321/ats-scrapers (src/ats_scrapers/scrapers/breezy.py), checked against live
 * tenants on 2026-11-02. `GET https://{slug}.breezy.hr/json` lists every open position (no descriptions) and sends an
 * ETag. A tenant without a careers site answers 404 (seen on 2026-11-02) or redirects to breezy.hr (the reference's
 * report); both mean notFound. Each position's page carries a schema.org JobPosting, read with jsonld.ts (falling back
 * to the `<div class="description">` block the reference uses), for the description.
 */

const MAX_DETAILS = 150;
const DETAIL_CONCURRENCY = 4;

type BzLocation = { name?: string; city?: string; is_remote?: boolean; country?: { name?: string }; state?: { name?: string } };
type BzItem = {
  id?: string; friendly_id?: string; name?: string; url?: string; published_date?: string; department?: string;
  location?: BzLocation; locations?: BzLocation[]; company?: { name?: string };
};

const listUrl = (token: string) => `https://${token}.breezy.hr/json`;

const nameOfLocation = (l: BzLocation | undefined): string | null =>
  l ? str(l.name) ?? (joinParts([l.city, l.state?.name, l.country?.name]) || null) : null;

function descriptionFromPage(html: string, pageUrl: string): string {
  const ld = parseJobPostingJsonLd(html, pageUrl)?.descriptionText;
  if (ld) return ld;
  const block = html.match(/<div class="description">([\s\S]*?)<\/div>\s*<div class="apply/i) ?? html.match(/<div class="description">([\s\S]*?)<\/div>/i);
  return block ? htmlToText(block[1] ?? "") : "";
}

function toJob(token: string, it: BzItem, description: string): NormalizedJob | null {
  const id = str(it.id);
  const title = str(it.name);
  const url = str(it.url);
  if (!id || !title || !url) return null;
  const location = uniq([nameOfLocation(it.location), ...(it.locations ?? []).map(nameOfLocation)]).join(" | ") || null;
  return {
    atsType: "breezy",
    externalId: id,
    companyName: str(it.company?.name) ?? prettifyToken(token),
    companyToken: token,
    title,
    location,
    remote: it.location?.is_remote === true || REMOTE_RE.test(location ?? "") || REMOTE_RE.test(title),
    descriptionText: description,
    applyUrl: url,
    postedAt: parseDate(it.published_date),
  };
}

/** The position's own page, only when it is on this tenant's host (the feed's URL is not trusted blindly). */
const pageUrlOf = (token: string, it: BzItem): string | null => {
  const u = safeUrl(it.url ?? "");
  return u && u.hostname.toLowerCase() === `${token.toLowerCase()}.breezy.hr` ? u.toString() : null;
};

async function readPage(url: string, http?: HttpOptions): Promise<string | null | RateLimitedError> {
  try {
    const res = await getFeed(url, http, { accept: "text/html" });
    return res.status === 200 ? res.body : null;
  } catch (err) { return err instanceof RateLimitedError ? err : null; }
}

type Read = { items: BzItem[]; etag: string | null } | { notModified: true; etag: string | null } | "gone";

async function readList(token: string, http?: HttpOptions, etag?: string | null): Promise<Read> {
  if (!isHostLabel(token)) return "gone";
  const url = listUrl(token);
  const res = await getFeed(url, http, { manualRedirect: true, etag });
  if (res.status === 304) return { notModified: true, etag: etag ?? res.etag };
  if (isRedirect(res.status) || res.status === 404) return "gone";
  // 403 is the edge refusing a burst, not a missing board: let the queue retry later.
  if (res.status !== 200) throw feedError(url, res.status);
  const data = parseJsonBody<unknown>(url, res.body);
  if (!Array.isArray(data)) throw new Error(`GET ${url} returned JSON that is not a position list`);
  return { items: data as BzItem[], etag: res.etag };
}

async function readBoard(token: string, http?: HttpOptions, etag?: string | null): Promise<ListResult> {
  const r = await readList(token, http, etag);
  if (r === "gone") return { jobs: [], complete: true, notFound: true };
  if ("notModified" in r) return { jobs: [], complete: true, notModified: true, etag: r.etag };
  const unique = [...new Map(r.items.filter((i) => i && str(i.id)).map((i) => [i.id as string, i])).values()];
  const state: { limited: RateLimitedError | null } = { limited: null };
  const jobs = await mapLimit(unique.slice(0, MAX_DETAILS), DETAIL_CONCURRENCY, async (it) => {
    const page = pageUrlOf(token, it);
    const html = page ? await readPage(page, http) : null;
    if (html instanceof RateLimitedError) state.limited = html;
    return toJob(token, it, typeof html === "string" && page ? descriptionFromPage(html, page) : "");
  });
  if (state.limited) throw state.limited; // do not turn a refusing host into description-less jobs
  const rest = unique.slice(MAX_DETAILS).map((it) => toJob(token, it, ""));
  return { jobs: [...jobs, ...rest].filter((j): j is NormalizedJob => j !== null), complete: true, etag: r.etag };
}

/** Breezy HR public JSON listing plus each position's page for the description. */
export const breezy: Connector = {
  atsType: "breezy",
  ready: true,
  capabilities: { conditional: true, maxConcurrencyPerHost: 4 },
  listJobs: (token, http, opts) => readBoard(token, http, opts?.etag),
  async fetchJob(token, externalId, http) {
    // No single-job JSON: find the position in the listing, then read its page.
    const r = await readList(token, http);
    if (r === "gone" || "notModified" in r) return null;
    const it = r.items.find((i) => i?.id === externalId);
    if (!it) return null;
    const page = pageUrlOf(token, it);
    const html = page ? await readPage(page, http) : null;
    if (html instanceof RateLimitedError) throw html;
    return toJob(token, it, typeof html === "string" && page ? descriptionFromPage(html, page) : "");
  },
  parseUrl(url) {
    const u = safeUrl(url);
    const m = u?.hostname.toLowerCase().match(/^([a-z0-9-]+)\.breezy\.hr$/);
    if (!u || !m || ["www", "app", "api", "help", "support"].includes(m[1] as string)) return null;
    const [seg, slug] = u.pathname.split("/").filter(Boolean);
    return { token: m[1] as string, externalId: seg === "p" && slug ? (slug.match(/^([0-9a-f]{8,})/i)?.[1] ?? null) : null };
  },
};
