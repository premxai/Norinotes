import { htmlToText } from "../html.js";
import type { Connector, HttpOptions, ListResult, NormalizedJob } from "../types.js";
import { parseDate, prettifyToken, REMOTE_RE, safeUrl } from "../util.js";
import { feedError, getFeed, isHostLabel, isRedirect, joinParts, parseJsonBody, str } from "./feed-kit.js";

/*
 * Ported from the MIT-licensed kalil0321/ats-scrapers (src/ats_scrapers/scrapers/pinpoint.py), checked against a live
 * tenant on 2026-11-02. `GET https://{slug}.pinpointhq.com/postings.json` returns `{ data: [...] }` with every open
 * posting and its HTML sections in one response, and sends an ETag. An unknown tenant answers 404 (or redirects).
 */

type PpItem = {
  id?: string | number; title?: string; url?: string; description?: string; benefits?: string; benefits_header?: string;
  key_responsibilities?: string; key_responsibilities_header?: string;
  skills_knowledge_expertise?: string; skills_knowledge_expertise_header?: string;
  workplace_type?: string; deadline_at?: string | null;
  first_published_at?: string; published_at?: string; created_at?: string;
  location?: { name?: string; city?: string; province?: string } | null;
};

/** The sections joined in reading order, each under its own header when it has one. */
function descriptionOf(p: PpItem): string {
  const section = (html: string | undefined, header: string | undefined) => {
    const body = htmlToText(html ?? "");
    return body ? (header?.trim() ? `${header.trim()}\n${body}` : body) : "";
  };
  return [
    section(p.description, undefined),
    section(p.key_responsibilities, p.key_responsibilities_header),
    section(p.skills_knowledge_expertise, p.skills_knowledge_expertise_header),
    section(p.benefits, p.benefits_header),
  ].filter(Boolean).join("\n\n");
}

function toJob(token: string, p: PpItem, now: Date): NormalizedJob | null {
  const id = p.id != null ? String(p.id).trim() : "";
  const title = str(p.title);
  const url = str(p.url);
  if (!id || !title || !url) return null;
  // A deadline in the past means applications are closed even if the posting is still listed.
  const deadline = parseDate(p.deadline_at);
  if (deadline && deadline.getTime() < now.getTime()) return null;
  const location = str(p.location?.name) ?? (joinParts([p.location?.city, p.location?.province]) || null);
  const wt = (p.workplace_type ?? "").toLowerCase();
  return {
    atsType: "pinpoint",
    externalId: id,
    companyName: prettifyToken(token),
    companyToken: token,
    title,
    location,
    remote: wt === "remote" || (wt !== "onsite" && wt !== "on_site" && (REMOTE_RE.test(location ?? "") || REMOTE_RE.test(title))),
    descriptionText: descriptionOf(p),
    applyUrl: url,
    postedAt: parseDate(p.first_published_at) ?? parseDate(p.published_at) ?? parseDate(p.created_at),
  };
}

async function readBoard(token: string, http?: HttpOptions, etag?: string | null): Promise<ListResult> {
  if (!isHostLabel(token)) return { jobs: [], complete: true, notFound: true };
  const url = `https://${token}.pinpointhq.com/postings.json`;
  const res = await getFeed(url, http, { manualRedirect: true, etag });
  if (res.status === 304) return { jobs: [], complete: true, notModified: true, etag: etag ?? res.etag };
  if (res.status === 404 || isRedirect(res.status)) return { jobs: [], complete: true, notFound: true };
  if (res.status !== 200) throw feedError(url, res.status);
  const data = parseJsonBody<{ data?: unknown }>(url, res.body);
  if (!Array.isArray(data.data)) throw new Error(`GET ${url} returned no postings list`);
  const now = new Date();
  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  for (const p of data.data as PpItem[]) {
    const job = toJob(token, p, now);
    if (job && !seen.has(job.externalId)) { seen.add(job.externalId); jobs.push(job); }
  }
  return { jobs, complete: true, etag: res.etag };
}

/** Pinpoint public postings feed. One request reads the whole board, descriptions included. */
export const pinpoint: Connector = {
  atsType: "pinpoint",
  ready: true,
  capabilities: { conditional: true, maxConcurrencyPerHost: 4 },
  listJobs: (token, http, opts) => readBoard(token, http, opts?.etag),
  async fetchJob(token, externalId, http) {
    const { jobs } = await readBoard(token, http);
    // A posting URL carries a UUID while the feed's id is numeric, so match either against the id or the posting URL.
    return jobs.find((j) => j.externalId === externalId || j.applyUrl.includes(externalId)) ?? null;
  },
  parseUrl(url) {
    const u = safeUrl(url);
    const m = u?.hostname.toLowerCase().match(/^([a-z0-9-]+)\.pinpointhq\.com$/);
    if (!u || !m || ["www", "app", "api", "help", "support"].includes(m[1] as string)) return null;
    // /postings/{uuid}, or /{locale}/postings/{uuid}.
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.indexOf("postings");
    return { token: m[1] as string, externalId: i >= 0 && parts[i + 1] ? (parts[i + 1] as string) : null };
  },
};
