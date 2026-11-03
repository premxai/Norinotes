import { htmlToText } from "../html.js";
import type { Connector, HttpOptions, ListResult, NormalizedJob } from "../types.js";
import { parseDate, prettifyToken, REMOTE_RE, safeUrl } from "../util.js";
import { feedError, getFeed, joinParts, parseJsonBody, str, uniq } from "./feed-kit.js";

/*
 * Ported from the MIT-licensed kalil0321/ats-scrapers (src/ats_scrapers/scrapers/workable.py) and checked against the
 * live widget endpoint on 2026-11-02. Unlike that project we ask for `details=true`, which returns each job's HTML
 * description, requirements and benefits in the same response, so no per-job request is needed.
 */

type WkLocation = { city?: string; region?: string; country?: string; hidden?: boolean };
type WkJob = {
  title?: string; shortcode?: string; code?: string; employment_type?: string; telecommuting?: boolean;
  department?: string; url?: string; shortlink?: string; application_url?: string;
  published_on?: string; created_at?: string; country?: string; city?: string; state?: string;
  locations?: WkLocation[]; description?: string; requirements?: string; benefits?: string;
};
type WkPage = { name?: string; jobs?: WkJob[]; nextPage?: unknown; next_page?: unknown; token?: unknown; paging?: { next?: unknown } };

/** Safety bound on continuation pages (the widget has not been seen to paginate; see nextToken). */
const MAX_PAGES = 20;

const widgetUrl = (token: string) => `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}?details=true`;

/** A continuation token, if the response carries one. Only a plain non-empty string counts. */
function nextToken(p: WkPage): string | null {
  for (const v of [p.nextPage, p.next_page, p.paging?.next, p.token]) if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function locationOf(j: WkJob): string | null {
  const shown = (j.locations ?? []).filter((l) => l && !l.hidden);
  const fromList = uniq(shown.map((l) => joinParts([l.city, l.region, l.country]))).join(" | ");
  return fromList || joinParts([j.city, j.state, j.country]) || null;
}

function toJob(token: string, j: WkJob): NormalizedJob | null {
  const id = str(j.shortcode) ?? str(j.code);
  const title = str(j.title);
  if (!id || !title) return null;
  const location = locationOf(j);
  const description = [j.description, j.requirements, j.benefits].map((h) => htmlToText(h ?? "")).filter(Boolean).join("\n\n");
  return {
    atsType: "workable",
    externalId: id,
    companyName: prettifyToken(token), // replaced by the account name once the board has been read
    companyToken: token,
    title,
    location,
    remote: j.telecommuting === true || REMOTE_RE.test(location ?? "") || REMOTE_RE.test(title),
    descriptionText: description,
    applyUrl: str(j.application_url) ?? str(j.url) ?? str(j.shortlink) ?? `https://apply.workable.com/j/${id}`,
    postedAt: parseDate(j.published_on) ?? parseDate(j.created_at),
  };
}

/** Merge a repeated shortcode (one row per location) into the first, joining the locations. */
function mergeDuplicate(into: NormalizedJob, other: NormalizedJob): void {
  into.location = uniq(`${into.location ?? ""} | ${other.location ?? ""}`.split(" | ")).join(" | ") || null;
  into.remote = into.remote || other.remote;
}

async function readBoard(token: string, http?: HttpOptions): Promise<ListResult> {
  const base = widgetUrl(token);
  const byId = new Map<string, NormalizedJob>();
  const seenTokens = new Set<string>();
  let name: string | null = null;
  let url = base;
  const result = (complete: boolean): ListResult => ({
    jobs: [...byId.values()].map((j) => ({ ...j, companyName: name ?? j.companyName })),
    complete,
  });
  for (let page = 0; page < MAX_PAGES; page++) {
    let data: WkPage;
    try {
      const res = await getFeed(url, http);
      if (res.status === 404) return page === 0 ? { jobs: [], complete: true, notFound: true } : result(false);
      if (res.status !== 200) throw feedError(url, res.status);
      data = parseJsonBody<WkPage>(url, res.body);
    } catch (err) {
      if (page === 0) throw err;
      return result(false); // a later page failed: report what we have, but never let the caller close jobs on it
    }
    name = name ?? str(data.name);
    for (const raw of data.jobs ?? []) {
      const job = toJob(token, raw);
      if (!job) continue;
      const have = byId.get(job.externalId);
      if (have) mergeDuplicate(have, job); else byId.set(job.externalId, job);
    }
    const next = nextToken(data);
    if (!next) return result(true);
    if (seenTokens.has(next)) return result(false);
    seenTokens.add(next);
    url = `${base}&token=${encodeURIComponent(next)}`;
  }
  return result(false); // page cap reached with more to read
}

/**
 * Workable public widget API: `GET apply.workable.com/api/v1/widget/accounts/{slug}?details=true` lists every open job
 * with its description. Workable answers 429 above 2 to 4 concurrent requests, so the scheduler keeps it at 2 per host.
 * If a response ever carries a continuation token (`nextPage`, `next_page`, `paging.next` or `token`) the next page is
 * requested with `&token=`; a page that fails after the first makes the read incomplete.
 */
export const workable: Connector = {
  atsType: "workable",
  ready: true,
  capabilities: { maxConcurrencyPerHost: 2 },
  listJobs: (token, http) => readBoard(token, http),
  async fetchJob(token, externalId, http) {
    // The widget has no single-job endpoint, so read the board and pick the job out of it.
    const { jobs } = await readBoard(token, http);
    return jobs.find((j) => j.externalId.toLowerCase() === externalId.toLowerCase()) ?? null;
  },
  parseUrl(url) {
    const u = safeUrl(url);
    if (!u || u.hostname.toLowerCase() !== "apply.workable.com") return null;
    const [first, second, third] = u.pathname.split("/").filter(Boolean);
    // The short form /j/{SHORTCODE} names no board, so it cannot give a token.
    if (!first || ["j", "api", "static", "assets", "_next"].includes(first.toLowerCase())) return null;
    return { token: decodeURIComponent(first), externalId: second === "j" && third ? third : null };
  },
};
