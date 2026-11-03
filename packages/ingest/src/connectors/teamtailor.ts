import { htmlToText } from "../html.js";
import type { Connector, HttpOptions, ListResult, NormalizedJob } from "../types.js";
import { parseDate, prettifyToken, REMOTE_RE, safeUrl } from "../util.js";
import { feedError, getFeed, isHostLabel, joinParts, uniq } from "./feed-kit.js";
import { childOf, childrenOf, descendants, parseXml, textOf, type XmlNode } from "./xml.js";

/*
 * Ported from the MIT-licensed kalil0321/ats-scrapers (src/ats_scrapers/scrapers/teamtailor.py) and checked against the
 * live feed on 2026-11-02. Teamtailor's API needs a key, but every careers site publishes `/jobs.rss` with every open
 * job: title, link, pubDate, guid, `remoteStatus`, `tt:locations`, `tt:department` and an entity-escaped HTML
 * description. The feed sends an ETag, so a conditional request answers 304 when nothing changed.
 */

const feedUrl = (token: string) => `https://${token}.teamtailor.com/jobs.rss`;

function locationOf(item: XmlNode): string | null {
  const places = childOf(item, "tt:locations")?.children.filter((c) => c.name === "tt:location") ?? [];
  const names = places.map((p) => joinParts([textOf(p, "tt:city"), textOf(p, "tt:country")]) || textOf(p, "tt:name"));
  return uniq(names).join(" | ") || null;
}

function toJob(token: string, company: string, item: XmlNode): NormalizedJob | null {
  const link = textOf(item, "link");
  const title = textOf(item, "title");
  if (!link || !title) return null;
  // The numeric id in the URL is stable and public; the guid (a UUID) is the fallback.
  const externalId = link.match(/\/jobs\/(\d+)/)?.[1] ?? textOf(item, "guid");
  if (!externalId) return null;
  const location = locationOf(item);
  const status = (textOf(item, "remoteStatus") ?? "").toLowerCase();
  return {
    atsType: "teamtailor",
    externalId,
    companyName: company,
    companyToken: token,
    title,
    location,
    // "fully" is remote, "none" is not; "hybrid" and "temporary" leave it to the location and title.
    remote: status === "fully" || (status !== "none" && (REMOTE_RE.test(location ?? "") || REMOTE_RE.test(title))),
    descriptionText: htmlToText(textOf(item, "description") ?? ""),
    applyUrl: link,
    postedAt: parseDate(textOf(item, "pubDate")),
  };
}

async function readFeed(token: string, http?: HttpOptions, etag?: string | null): Promise<ListResult> {
  if (!isHostLabel(token)) return { jobs: [], complete: true, notFound: true };
  const url = feedUrl(token);
  const res = await getFeed(url, http, { accept: "application/rss+xml, text/xml", etag });
  if (res.status === 304) return { jobs: [], complete: true, notModified: true, etag: etag ?? res.etag };
  if (res.status === 404) return { jobs: [], complete: true, notFound: true };
  if (res.status !== 200) throw feedError(url, res.status);
  let root: XmlNode;
  try { root = parseXml(res.body); } catch (err) { throw new Error(`GET ${url} returned malformed RSS: ${(err as Error).message}`); }
  // Well-formed XML that is not a feed (an HTML error page) must not read as "no jobs".
  if (root.name.toLowerCase() !== "rss") throw new Error(`GET ${url} returned <${root.name}>, not an RSS feed`);
  const channel = childrenOf(root, "channel")[0];
  const company = (channel && textOf(channel, "title")) || prettifyToken(token);
  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  for (const item of descendants(root, "item")) {
    const job = toJob(token, company, item);
    if (job && !seen.has(job.externalId)) { seen.add(job.externalId); jobs.push(job); }
  }
  return { jobs, complete: true, etag: res.etag };
}

/** Teamtailor public RSS feed (`/jobs.rss`). One request reads the whole board. */
export const teamtailor: Connector = {
  atsType: "teamtailor",
  ready: true,
  capabilities: { conditional: true, maxConcurrencyPerHost: 4 },
  listJobs: (token, http, opts) => readFeed(token, http, opts?.etag),
  async fetchJob(token, externalId, http) {
    // No single-job endpoint: read the feed and pick the job out of it.
    const { jobs } = await readFeed(token, http);
    return jobs.find((j) => j.externalId === externalId) ?? null;
  },
  parseUrl(url) {
    const u = safeUrl(url);
    const m = u?.hostname.toLowerCase().match(/^([a-z0-9-]+)\.teamtailor\.com$/);
    if (!u || !m || ["www", "api", "app", "support", "docs", "career"].includes(m[1] as string)) return null;
    const [seg, rest] = u.pathname.split("/").filter(Boolean);
    return { token: m[1] as string, externalId: seg === "jobs" && rest ? (rest.match(/^(\d+)/)?.[1] ?? null) : null };
  },
};
