import { htmlToText } from "../html.js";
import type { Connector, HttpOptions, ListResult, NormalizedJob } from "../types.js";
import { parseDate, prettifyToken, REMOTE_RE, safeUrl } from "../util.js";
import { feedError, getFeed, isHostLabel, joinParts, parseJsonBody, str, uniq } from "./feed-kit.js";

/*
 * Ported from the MIT-licensed kalil0321/ats-scrapers (src/ats_scrapers/scrapers/recruitee.py) and checked against the
 * live endpoint on 2026-11-02: `GET https://{slug}.recruitee.com/api/offers/` returns every published offer with its
 * description and requirements in one response; an unknown tenant answers 404.
 */

type RcLocation = { name?: string; city?: string; state?: string; country?: string };
type RcOffer = {
  id?: number | string; slug?: string; title?: string; position?: string | number; status?: string;
  company_name?: string; location?: string; city?: string; state_code?: string; country_code?: string;
  locations?: RcLocation[]; remote?: boolean; description?: string; requirements?: string;
  careers_url?: string; careers_apply_url?: string; created_at?: string; published_at?: string;
};

const baseUrl = (token: string) => `https://${token}.recruitee.com`;

/** Recruitee writes "2025-12-05 21:44:46 UTC", which is not ISO, so normalise before parsing. */
function parseRecruiteeDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?(?:\s*(?:UTC|Z))?$/);
  return m ? parseDate(`${m[1]}T${m[2]}${m[3] ?? ":00"}Z`) : parseDate(v);
}

function locationOf(o: RcOffer): string | null {
  const many = uniq((o.locations ?? []).map((l) => joinParts([l.city, l.country]) || str(l.name)));
  if (many.length > 1) return many.join(" | ");
  return str(o.location) ?? many[0] ?? (joinParts([o.city, o.state_code, o.country_code]) || null);
}

function toJob(token: string, o: RcOffer): NormalizedJob | null {
  const id = o.id ?? o.slug;
  const title = str(o.title) ?? str(typeof o.position === "string" ? o.position : null);
  if (id == null || !title) return null;
  // Draft or closed offers are not on the public board; skip anything that says it is not published.
  if (o.status && o.status !== "published") return null;
  const location = locationOf(o);
  const slug = str(o.slug) ?? String(id);
  const description = [o.description, o.requirements].map((h) => htmlToText(h ?? "")).filter(Boolean).join("\n\n");
  return {
    atsType: "recruitee",
    externalId: String(id),
    companyName: str(o.company_name) ?? prettifyToken(token),
    companyToken: token,
    title,
    location,
    remote: o.remote === true || REMOTE_RE.test(location ?? "") || REMOTE_RE.test(title),
    descriptionText: description,
    applyUrl: str(o.careers_apply_url) ?? str(o.careers_url) ?? `${baseUrl(token)}/o/${encodeURIComponent(slug)}`,
    postedAt: parseRecruiteeDate(o.published_at) ?? parseRecruiteeDate(o.created_at),
  };
}

async function readOffers(token: string, http?: HttpOptions): Promise<ListResult> {
  if (!isHostLabel(token)) return { jobs: [], complete: true, notFound: true };
  const url = `${baseUrl(token)}/api/offers/`;
  const res = await getFeed(url, http);
  if (res.status === 404) return { jobs: [], complete: true, notFound: true };
  if (res.status !== 200) throw feedError(url, res.status);
  const data = parseJsonBody<{ offers?: RcOffer[] }>(url, res.body);
  if (!Array.isArray(data.offers)) throw new Error(`GET ${url} returned no offers list`);
  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  for (const o of data.offers) {
    const job = toJob(token, o);
    if (job && !seen.has(job.externalId)) { seen.add(job.externalId); jobs.push(job); }
  }
  return { jobs, complete: true };
}

/** Recruitee public offers API. `fetchJob` accepts the numeric id or the offer slug (what a posting URL carries). */
export const recruitee: Connector = {
  atsType: "recruitee",
  ready: true,
  capabilities: { maxConcurrencyPerHost: 4 },
  listJobs: (token, http) => readOffers(token, http),
  async fetchJob(token, externalId, http) {
    if (!isHostLabel(token)) return null;
    const url = `${baseUrl(token)}/api/offers/${encodeURIComponent(externalId)}`;
    const res = await getFeed(url, http);
    if (res.status === 404) return null;
    if (res.status !== 200) throw feedError(url, res.status);
    const offer = parseJsonBody<{ offer?: RcOffer }>(url, res.body).offer;
    return offer ? toJob(token, offer) : null;
  },
  parseUrl(url) {
    const u = safeUrl(url);
    const m = u?.hostname.toLowerCase().match(/^([a-z0-9-]+)\.recruitee\.com$/);
    if (!u || !m || ["www", "api", "app", "support"].includes(m[1] as string)) return null;
    const [seg, slug] = u.pathname.split("/").filter(Boolean);
    return { token: m[1] as string, externalId: seg === "o" && slug ? decodeURIComponent(slug) : null };
  },
};
