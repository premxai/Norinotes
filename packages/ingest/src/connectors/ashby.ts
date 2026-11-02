import { htmlToText } from "../html.js";
import { getJson } from "../http.js";
import type { Connector, HttpOptions, NormalizedJob } from "../types.js";
import { parseDate, prettifyToken, REMOTE_RE, safeUrl } from "../util.js";

type AshbyJob = {
  id: string; title: string; location?: string; isRemote?: boolean; isListed?: boolean;
  descriptionPlain?: string; descriptionHtml?: string; jobUrl?: string; applyUrl?: string; publishedAt?: string;
  workplaceType?: string;
};

function toJob(token: string, j: AshbyJob): NormalizedJob {
  return {
    atsType: "ashby",
    externalId: j.id,
    companyName: prettifyToken(token),
    companyToken: token,
    title: j.title,
    location: j.location || null,
    remote: Boolean(j.isRemote) || (j.workplaceType ?? "").toLowerCase() === "remote" || REMOTE_RE.test(j.location ?? ""),
    descriptionText: j.descriptionPlain || htmlToText(j.descriptionHtml ?? ""),
    applyUrl: j.applyUrl || j.jobUrl || "",
    postedAt: parseDate(j.publishedAt),
  };
}

async function listJobs(token: string, http?: HttpOptions): Promise<NormalizedJob[]> {
  const data = await getJson<{ jobs?: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`, http);
  return (data?.jobs ?? []).filter((j) => j.isListed !== false).map((j) => toJob(token, j));
}

/**
 * Ashby public job board API: `GET api.ashbyhq.com/posting-api/job-board/{token}` lists every listed job with its
 * description. There is no single-posting endpoint, so `fetchJob` reads the board and picks the posting out.
 */
export const ashby: Connector = {
  atsType: "ashby",
  listJobs,
  async fetchJob(token, externalId, http) {
    return (await listJobs(token, http)).find((j) => j.externalId === externalId) ?? null;
  },
  parseUrl(url) {
    const u = safeUrl(url);
    if (!u || !/^jobs\.ashbyhq\.com$/i.test(u.hostname)) return null;
    const [token, externalId] = u.pathname.split("/").filter(Boolean);
    if (!token) return null;
    let decoded = token;
    try { decoded = decodeURIComponent(token); } catch { /* keep the raw segment */ }
    return { token: decoded, externalId: externalId ?? null };
  },
};
