import { htmlToText } from "../html.js";
import { getJson } from "../http.js";
import type { Connector, HttpOptions, ListResult, NormalizedJob } from "../types.js";
import { parseDate, prettifyToken, safeUrl } from "../util.js";

type SrListItem = {
  id: string; name: string; releasedDate?: string;
  company?: { identifier?: string; name?: string };
  location?: { city?: string; region?: string; country?: string; remote?: boolean; fullLocation?: string };
};
type SrDetail = SrListItem & {
  applyUrl?: string; postingUrl?: string;
  jobAd?: { sections?: Record<string, { title?: string; text?: string } | undefined> };
};

const SECTION_ORDER = ["companyDescription", "jobDescription", "qualifications", "additionalInformation"];
/** A board with more openings than this is read up to this many (SmartRecruiters needs one request per posting for the text). */
const MAX_POSTINGS = 200;
const DETAIL_CONCURRENCY = 5;

function locationOf(l: SrListItem["location"]): string | null {
  if (!l) return null;
  return l.fullLocation || [l.city, l.region, l.country?.toUpperCase()].filter(Boolean).join(", ") || null;
}

function toJob(token: string, d: SrDetail): NormalizedJob {
  const sections = SECTION_ORDER.map((k) => d.jobAd?.sections?.[k]).filter((s): s is { title?: string; text?: string } => Boolean(s?.text));
  const text = sections.map((s) => `${s.title ?? ""}\n${htmlToText(s.text ?? "")}`).join("\n\n").trim();
  return {
    atsType: "smartrecruiters",
    externalId: String(d.id),
    companyName: d.company?.name || prettifyToken(token),
    companyToken: token,
    title: d.name,
    location: locationOf(d.location),
    remote: Boolean(d.location?.remote),
    descriptionText: text,
    applyUrl: d.postingUrl || d.applyUrl || `https://jobs.smartrecruiters.com/${token}/${d.id}`,
    postedAt: parseDate(d.releasedDate),
  };
}

function fetchDetail(token: string, id: string, http?: HttpOptions): Promise<SrDetail | null> {
  return getJson<SrDetail>(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings/${encodeURIComponent(id)}`, http);
}

/**
 * SmartRecruiters public posting API: `GET api.smartrecruiters.com/v1/companies/{token}/postings?limit=100&offset=n`
 * lists postings without text; `.../postings/{id}` returns the job ad sections. The list order is kept; a posting
 * whose detail request fails keeps its list-level data (no description) and is still reported.
 */
export const smartrecruiters: Connector = {
  atsType: "smartrecruiters",
  capabilities: { maxConcurrencyPerHost: 4 },
  async listJobs(token, http): Promise<ListResult> {
    const items: SrListItem[] = [];
    // A board bigger than MAX_POSTINGS (or a page that vanished midway) is a partial read: nothing may be closed on it.
    let complete = true;
    for (let offset = 0; items.length < MAX_POSTINGS; offset += 100) {
      const page = await getJson<{ content?: SrListItem[]; totalFound?: number }>(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=100&offset=${offset}`, http);
      if (!page) {
        if (offset === 0) return { jobs: [], complete: true, notFound: true };
        complete = false;
        break;
      }
      const batch = page.content ?? [];
      items.push(...batch);
      if (batch.length < 100 || items.length >= (page.totalFound ?? 0)) break;
      if (items.length >= MAX_POSTINGS) complete = false;
    }
    if (items.length > MAX_POSTINGS) complete = false;
    const queue = items.slice(0, MAX_POSTINGS).map((item, index) => ({ item, index }));
    const out: NormalizedJob[] = new Array<NormalizedJob>(queue.length);
    const workers = Array.from({ length: DETAIL_CONCURRENCY }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        let detail: SrDetail | null = null;
        try { detail = await fetchDetail(token, next.item.id, http); } catch { /* keep list-level data */ }
        out[next.index] = toJob(token, detail ?? next.item);
      }
    });
    await Promise.all(workers);
    return { jobs: out, complete };
  },
  async fetchJob(token, externalId, http) {
    const d = await fetchDetail(token, externalId, http);
    return d ? toJob(token, d) : null;
  },
  parseUrl(url) {
    const u = safeUrl(url);
    if (!u || !/^(jobs|careers)\.smartrecruiters\.com$/i.test(u.hostname)) return null;
    const [token, slug] = u.pathname.split("/").filter(Boolean);
    if (!token) return null;
    const externalId = slug ? (slug.match(/^(\d+)/)?.[1] ?? slug) : null;
    return { token, externalId };
  },
};
