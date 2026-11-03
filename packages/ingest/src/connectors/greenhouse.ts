import { htmlToText, unescapeHtml } from "../html.js";
import { getJson, getJsonConditional } from "../http.js";
import type { Connector, NormalizedJob } from "../types.js";
import { parseDate, prettifyToken, REMOTE_RE, safeUrl } from "../util.js";

type GhJob = {
  id: number | string; title: string; absolute_url: string; updated_at?: string; first_published?: string;
  location?: { name?: string }; content?: string; company_name?: string;
};

function toJob(token: string, j: GhJob): NormalizedJob {
  const html = unescapeHtml(j.content ?? "");
  const location = j.location?.name || null;
  return {
    atsType: "greenhouse",
    externalId: String(j.id),
    companyName: j.company_name || prettifyToken(token),
    companyToken: token,
    title: j.title,
    location,
    remote: REMOTE_RE.test(location ?? "") || REMOTE_RE.test(j.title),
    descriptionText: htmlToText(html),
    applyUrl: j.absolute_url,
    // first_published is when the job went live; updated_at moves on every edit, so it is only a fallback.
    postedAt: parseDate(j.first_published) ?? parseDate(j.updated_at),
  };
}

/**
 * Greenhouse public job board API: `GET boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` lists every open
 * job with its (entity-escaped) HTML description; `.../jobs/{id}?content=true` returns one.
 */
export const greenhouse: Connector = {
  atsType: "greenhouse",
  capabilities: { conditional: true, maxConcurrencyPerHost: 4 },
  async listJobs(token, http, opts) {
    const res = await getJsonConditional<{ jobs?: GhJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`, http, opts?.etag);
    if (res.status === "notFound") return { jobs: [], complete: true, notFound: true };
    if (res.status === "notModified") return { jobs: [], complete: true, notModified: true, etag: res.etag };
    return { jobs: (res.data?.jobs ?? []).map((j) => toJob(token, j)), complete: true, etag: res.etag };
  },
  async fetchJob(token, externalId, http) {
    const j = await getJson<GhJob>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs/${encodeURIComponent(externalId)}?content=true`, http);
    return j ? toJob(token, j) : null;
  },
  parseUrl(url) {
    const u = safeUrl(url);
    if (!u || !/^(boards|job-boards)(\.eu)?\.greenhouse\.io$/i.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    // Embedded form: /embed/job_app?for={token}&token={jobId}
    if (parts[0] === "embed") {
      const token = u.searchParams.get("for");
      return token ? { token, externalId: u.searchParams.get("token") } : null;
    }
    if (!parts[0]) return null;
    const externalId = parts[1] === "jobs" && parts[2] ? parts[2] : null;
    return { token: parts[0], externalId };
  },
};

/**
 * Where the application form really is. Many companies set their Greenhouse board to redirect to their own careers
 * site (the feed's absolute_url points there too), and that site renders the form late, inside an iframe, or not at
 * all for a headless browser. Greenhouse always serves the bare form at the embed address, so for a Greenhouse job
 * whose link is not on greenhouse.io, open that instead. Returns null when the link is already Greenhouse's own or
 * the board token or job id is unknown.
 */
export function greenhouseFormUrl(job: { atsType: string; applyUrl: string; externalId: string }, boardToken: string | null | undefined): string | null {
  if (job.atsType !== "greenhouse" || !boardToken || !/^\d+$/.test(job.externalId)) return null;
  try {
    const host = new URL(job.applyUrl).hostname;
    if (/(^|\.)greenhouse\.io$/i.test(host)) return null;
  } catch { /* an unparseable link: the embed address is still the best bet */ }
  return `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(boardToken)}&token=${job.externalId}`;
}
