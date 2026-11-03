import { decodeEntities, htmlToText } from "../html.js";
import type { Connector, HttpOptions, ListResult, NormalizedJob } from "../types.js";
import { prettifyToken, REMOTE_RE, safeUrl } from "../util.js";
import { getFeed, isHostLabel, mapLimit } from "./feed-kit.js";
import { parseJobPostingJsonLd, type JobPostingFields } from "./jsonld.js";

/*
 * Ported from the MIT-licensed kalil0321/ats-scrapers (src/ats_scrapers/scrapers/icims.py), checked against a live
 * portal on 2026-11-02. iCIMS has no public JSON: `GET https://careers-{slug}.icims.com/jobs/search?ss=1&pr={page}&in_iframe=1`
 * returns 50 job cards per page ("Page 1 of 29" is in the markup), and each job page carries a schema.org JobPosting
 * (read with jsonld.ts) with the full description. Some portals sit behind bot protection and answer 403: that is never
 * worked around; it surfaces as IcimsBlockedError (first page) or as an incomplete read (later pages). Details are read
 * for the first MAX_DETAILS jobs per read, at 2 concurrent requests; jobs past that keep the card's short summary.
 */

/** Bot protection (403) on the portal. The poller should back this board off, not retry in a loop. */
export class IcimsBlockedError extends Error {
  constructor(readonly url: string, readonly status = 403) {
    super(`GET ${url} was refused with ${status}: iCIMS bot protection; not retrying`);
    this.name = "IcimsBlockedError";
  }
}

const MAX_PAGES = 60;
const MAX_DETAILS = 150;
const DETAIL_CONCURRENCY = 2;

const CARD_RE = /<li\b[^>]*class="[^"]*iCIMS_JobCardItem[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
const ANCHOR_RE = /<a\b[^>]*href="([^"]*?\/jobs\/(\d+)\/[^"]*)"[^>]*class="[^"]*iCIMS_Anchor[^"]*"[^>]*>([\s\S]*?)<\/a>/i;
const ANCHOR_RE_ALT = /<a\b[^>]*class="[^"]*iCIMS_Anchor[^"]*"[^>]*href="([^"]*?\/jobs\/(\d+)\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
const LOCATION_RE = /<span\b[^>]*class="[^"]*field-label[^"]*"[^>]*>\s*Job Locations?\s*<\/span>\s*<span\b[^>]*>([\s\S]*?)<\/span>/i;
const DATE_RE = /<span\b[^>]*title="(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?"/i;
const DESC_RE = /<div\b[^>]*class="[^"]*\bdescription\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
const HEADER_RE = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>\s*<span\b[^>]*>([\s\S]*?)<\/span>/gi;
const DASH_LOC_RE = /^([A-Z]{2,3})-([A-Z0-9 ]{1,40})(?:-([^-].*))?$/;

type Card = {
  id: string; url: string; title: string; location: string | null; postedAt: Date | null;
  summary: string; remoteOption: boolean | null; department: string | null;
};

const text = (html: string) => htmlToText(html);

/** The portal host for a token: a slug (`careers-{slug}.icims.com`) or a full `*.icims.com` host or URL. */
function hostOf(token: string): string | null {
  const t = token.trim();
  let host: string;
  if (/^https?:\/\//i.test(t)) host = safeUrl(t)?.hostname.toLowerCase() ?? "";
  else if (t.includes(".")) host = t.toLowerCase().replace(/\/.*$/, "");
  else host = isHostLabel(t) ? `careers-${t.toLowerCase()}.icims.com` : "";
  return /^[a-z0-9-]+\.icims\.com$/.test(host) ? host : null;
}

const companyFromHost = (host: string): string => prettifyToken(host.replace(/\.icims\.com$/, "").replace(/^(?:us|ca|uk|eu)?careers-/, ""));

/** iCIMS writes locations as country-state-city ("US-DC-Washington"); turn that into "Washington, DC, US". */
function normaliseLocation(raw: string): string {
  return raw.split(/\s*(?:\||;|\n)\s*/).map((part) => {
    const m = part.trim().match(DASH_LOC_RE);
    return m ? [m[3], m[2], m[1]].map((x) => x?.trim()).filter(Boolean).join(", ") : part.trim();
  }).filter(Boolean).join(" | ");
}

function usDate(m: RegExpMatchArray): Date | null {
  const [, mo, d, y, h, mi, ap] = m;
  let hour = Number(h);
  if (ap) hour = (hour % 12) + (ap.toUpperCase() === "PM" ? 12 : 0);
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), hour, Number(mi)));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parseCards(html: string, base: string): Card[] {
  const out: Card[] = [];
  const seen = new Set<string>();
  for (const c of html.matchAll(CARD_RE)) {
    const body = c[1] ?? "";
    const a = body.match(ANCHOR_RE) ?? body.match(ANCHOR_RE_ALT);
    if (!a) continue;
    const id = a[2] as string;
    if (seen.has(id)) continue;
    const title = text(a[3]?.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "");
    if (!title) continue;
    seen.add(id);
    const href = decodeEntities(a[1] as string);
    let url: string;
    try { url = new URL(href, base).toString(); } catch { continue; }
    const loc = body.match(LOCATION_RE)?.[1];
    const date = body.match(DATE_RE);
    const fields = new Map<string, string>();
    for (const h of body.matchAll(HEADER_RE)) fields.set(text(h[1] ?? "").toLowerCase(), text(h[2] ?? ""));
    const tele = [...fields].find(([k]) => /telecommute|remote|telework/.test(k))?.[1];
    out.push({
      id, url, title,
      location: loc ? normaliseLocation(text(loc)) || null : null,
      postedAt: date ? usDate(date) : null,
      summary: text(body.match(DESC_RE)?.[1] ?? ""),
      remoteOption: tele ? /remote|work from home/i.test(tele) && !/\bno\b|not allowed|none|occasional|hybrid|partial/i.test(tele) : null,
      department: fields.get("category") ?? null,
    });
  }
  return out;
}

function toJob(token: string, company: string, card: Card, ld: JobPostingFields | null): NormalizedJob {
  const location = card.location ?? ld?.location ?? null;
  return {
    atsType: "icims",
    externalId: card.id,
    companyName: company,
    companyToken: token,
    title: card.title,
    location,
    remote: ld?.remote === true || card.remoteOption === true || REMOTE_RE.test(location ?? ""),
    descriptionText: ld?.descriptionText || card.summary,
    applyUrl: card.url.replace(/[?&]in_iframe=1$/, "").replace(/\?in_iframe=1&/, "?"),
    postedAt: ld?.postedAt ?? card.postedAt,
  };
}

const pageUrl = (host: string, page: number) => `https://${host}/jobs/search?ss=1&pr=${page}&in_iframe=1`;

/** GET an HTML page; a 403 is bot protection and throws IcimsBlockedError. Other statuses are returned for the caller to judge. */
async function getHtml(url: string, http?: HttpOptions): Promise<{ status: number; body: string }> {
  const res = await getFeed(url, http, { accept: "text/html,application/xhtml+xml" });
  if (res.status === 403) throw new IcimsBlockedError(url);
  return { status: res.status, body: res.body };
}

async function readBoard(token: string, http?: HttpOptions): Promise<ListResult> {
  const host = hostOf(token);
  if (!host) return { jobs: [], complete: true, notFound: true };
  const base = `https://${host}`;
  const cards = new Map<string, Card>();
  let totalPages: number | null = null;
  let complete = true;
  for (let page = 0; ; page++) {
    if (page > 0 && totalPages !== null && page >= totalPages) break;
    if (page >= MAX_PAGES) { complete = false; break; }
    const url = pageUrl(host, page);
    let res: { status: number; body: string };
    try {
      res = await getHtml(url, http);
      if (res.status === 404 && page === 0) return { jobs: [], complete: true, notFound: true };
      if (res.status !== 200) throw new Error(`GET ${url} failed: ${res.status}`);
    } catch (err) {
      if (page === 0) throw err;
      complete = false; // paging cut short: report what was read, never let the caller close jobs on it
      break;
    }
    const found = parseCards(res.body, base);
    if (page === 0) {
      totalPages = Number(res.body.match(/Page\s+1\s+of\s+(\d+)/i)?.[1]) || null;
      // A 200 page with no cards and no iCIMS markup is a challenge or error page, not an empty board.
      if (!found.length && !/icims/i.test(res.body)) throw new Error(`GET ${url} did not look like an iCIMS search page`);
    }
    const fresh = found.filter((c) => !cards.has(c.id));
    for (const c of fresh) cards.set(c.id, c);
    if (!fresh.length) {
      if (totalPages !== null && page + 1 < totalPages) complete = false; // an empty page before the advertised end
      break;
    }
  }
  const list = [...cards.values()];
  const state = { blocked: false, company: null as string | null };
  const lds = await mapLimit(list.slice(0, MAX_DETAILS), DETAIL_CONCURRENCY, async (card) => {
    if (state.blocked) return null;
    try {
      const res = await getHtml(card.url, http);
      if (res.status !== 200) return null;
      const ld = parseJobPostingJsonLd(res.body, card.url);
      state.company = state.company ?? (ld?.companyName && !/^unavailable$/i.test(ld.companyName) ? ld.companyName : null);
      return ld;
    } catch (err) {
      if (err instanceof IcimsBlockedError) state.blocked = true; // stop asking; the cards' summaries still stand
      return null;
    }
  });
  const company = state.company ?? companyFromHost(host);
  return { jobs: list.map((c, i) => toJob(token, company, c, lds[i] ?? null)), complete };
}

/** iCIMS career portals: HTML search pages for the list, JobPosting JSON-LD on each job page for the description. */
export const icims: Connector = {
  atsType: "icims",
  ready: true,
  capabilities: { maxConcurrencyPerHost: 2 },
  listJobs: (token, http) => readBoard(token, http),
  async fetchJob(token, externalId, http) {
    const host = hostOf(token);
    if (!host || !/^\d+$/.test(externalId)) return null;
    const url = `https://${host}/jobs/${externalId}/job?in_iframe=1`;
    const res = await getHtml(url, http);
    if (res.status === 404) return null;
    if (res.status !== 200) throw new Error(`GET ${url} failed: ${res.status}`);
    const ld = parseJobPostingJsonLd(res.body, `https://${host}/jobs/${externalId}/job`);
    if (!ld?.title || ld.closed) return null;
    const company = ld.companyName && !/^unavailable$/i.test(ld.companyName) ? ld.companyName : companyFromHost(host);
    const card: Card = { id: externalId, url: ld.applyUrl, title: ld.title, location: null, postedAt: null, summary: "", remoteOption: null, department: ld.department };
    return toJob(token, company, card, ld);
  },
  parseUrl(url) {
    const u = safeUrl(url);
    const host = u?.hostname.toLowerCase() ?? "";
    if (!u || !/^[a-z0-9-]+\.icims\.com$/.test(host)) return null;
    const first = host.split(".")[0] as string;
    if (["www", "c", "app", "api", "help", "login", "community"].includes(first)) return null;
    const id = u.pathname.match(/\/jobs\/(\d+)(?:\/|$)/)?.[1] ?? null;
    const slug = /^careers-(.+)$/.exec(first)?.[1];
    // Other portal names (uscareers-x, jobs-x, external-x) are only recognised on a /jobs path, to stay clear of icims.com's own sites.
    if (slug) return { token: slug, externalId: id };
    return /^\/jobs(\/|$)/.test(u.pathname) ? { token: host, externalId: id } : null;
  },
};
