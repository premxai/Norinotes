import { htmlToText } from "../html.js";
import { getJson, getJsonConditional } from "../http.js";
import type { Connector, NormalizedJob } from "../types.js";
import { parseDate, prettifyToken, REMOTE_RE, safeUrl } from "../util.js";

type LeverPosting = {
  id: string; text: string; hostedUrl?: string; applyUrl?: string;
  description?: string; descriptionPlain?: string; additional?: string; additionalPlain?: string;
  lists?: { text: string; content: string }[];
  categories?: { location?: string; allLocations?: string[]; team?: string; commitment?: string };
  createdAt?: number; workplaceType?: string;
};

function toJob(token: string, p: LeverPosting): NormalizedJob {
  const listsText = (p.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join("\n\n");
  const text = [p.descriptionPlain ?? htmlToText(p.description ?? ""), listsText, p.additionalPlain ?? htmlToText(p.additional ?? "")]
    .filter((s) => s && s.trim()).join("\n\n");
  const location = p.categories?.location || p.categories?.allLocations?.[0] || null;
  const wt = (p.workplaceType ?? "").toLowerCase();
  return {
    atsType: "lever",
    externalId: p.id,
    companyName: prettifyToken(token),
    companyToken: token,
    title: p.text,
    location,
    remote: wt === "remote" || REMOTE_RE.test(location ?? ""),
    descriptionText: text,
    applyUrl: p.hostedUrl ?? p.applyUrl ?? "",
    postedAt: parseDate(p.createdAt),
  };
}

/**
 * Lever public postings API: `GET api.lever.co/v0/postings/{token}?mode=json` lists every open posting;
 * `.../postings/{token}/{id}` returns one. Lever does not name the company, so the name comes from the token.
 */
export const lever: Connector = {
  atsType: "lever",
  capabilities: { conditional: true, maxConcurrencyPerHost: 2 },
  async listJobs(token, http, opts) {
    const res = await getJsonConditional<LeverPosting[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`, http, opts?.etag);
    if (res.status === "notFound") return { jobs: [], complete: true, notFound: true };
    if (res.status === "notModified") return { jobs: [], complete: true, notModified: true, etag: res.etag };
    return { jobs: Array.isArray(res.data) ? res.data.map((p) => toJob(token, p)) : [], complete: true, etag: res.etag };
  },
  async fetchJob(token, externalId, http) {
    const p = await getJson<LeverPosting>(`https://api.lever.co/v0/postings/${encodeURIComponent(token)}/${encodeURIComponent(externalId)}`, http);
    return p && p.id ? toJob(token, p) : null;
  },
  parseUrl(url) {
    const u = safeUrl(url);
    if (!u || !/^jobs\.(eu\.)?lever\.co$/i.test(u.hostname)) return null;
    const [token, externalId] = u.pathname.split("/").filter(Boolean);
    return token ? { token, externalId: externalId ?? null } : null;
  },
};
