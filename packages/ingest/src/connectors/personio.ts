import { htmlToText } from "../html.js";
import type { Connector, HttpOptions, ListResult, NormalizedJob } from "../types.js";
import { parseDate, prettifyToken, REMOTE_RE, safeUrl } from "../util.js";
import { feedError, getFeed, isHostLabel, uniq } from "./feed-kit.js";
import { childOf, childrenOf, parseXml, textOf, type XmlNode } from "./xml.js";

/*
 * Ported in spirit from the MIT-licensed kalil0321/ats-scrapers (src/ats_scrapers/scrapers/personio.py). That project
 * reads the JSON search endpoints and then every detail page; Personio's documented XML feed carries the full job
 * descriptions in one response, so this connector uses it instead: `GET https://{slug}.jobs.personio.de/xml`, falling
 * back to `.jobs.personio.com`. Checked against live tenants on 2026-11-02 (both hosts answer, with the same ETag).
 * Some tenants publish empty `<jobDescriptions/>`; those jobs come through with an empty description.
 */

const HOSTS = ["jobs.personio.de", "jobs.personio.com"] as const;

function toJob(token: string, host: string, p: XmlNode): NormalizedJob | null {
  const id = textOf(p, "id");
  const title = textOf(p, "name");
  if (!id || !title) return null;
  const extra = childOf(p, "additionalOffices")?.children.filter((c) => c.name === "office").map((o) => o.text.trim()) ?? [];
  const location = uniq([textOf(p, "office"), ...extra]).join(" | ") || null;
  const description = childrenOf(childOf(p, "jobDescriptions") ?? p, "jobDescription")
    .map((d) => {
      const heading = textOf(d, "name");
      const body = htmlToText(textOf(d, "value") ?? "");
      return body ? (heading ? `${heading}\n${body}` : body) : "";
    })
    .filter(Boolean)
    .join("\n\n");
  return {
    atsType: "personio",
    externalId: id,
    companyName: textOf(p, "subcompany") ?? prettifyToken(token),
    companyToken: token,
    title,
    location,
    remote: REMOTE_RE.test(location ?? "") || REMOTE_RE.test(title),
    descriptionText: description,
    applyUrl: `https://${token}.${host}/job/${encodeURIComponent(id)}`,
    postedAt: parseDate(textOf(p, "createdAt")),
  };
}

async function readXml(token: string, http?: HttpOptions, etag?: string | null): Promise<ListResult> {
  if (!isHostLabel(token)) return { jobs: [], complete: true, notFound: true };
  for (const host of HOSTS) {
    const url = `https://${token}.${host}/xml`;
    const res = await getFeed(url, http, { accept: "text/xml, application/xml", etag });
    if (res.status === 404) continue; // not on this host; try the other
    if (res.status === 304) return { jobs: [], complete: true, notModified: true, etag: etag ?? res.etag };
    if (res.status !== 200) throw feedError(url, res.status);
    let root: XmlNode;
    try { root = parseXml(res.body); } catch (err) { throw new Error(`GET ${url} returned malformed XML: ${(err as Error).message}`); }
    if (root.name !== "workzag-jobs") throw new Error(`GET ${url} returned <${root.name}>, not a Personio feed`);
    const jobs: NormalizedJob[] = [];
    const seen = new Set<string>();
    for (const p of childrenOf(root, "position")) {
      const job = toJob(token, host, p);
      if (job && !seen.has(job.externalId)) { seen.add(job.externalId); jobs.push(job); }
    }
    return { jobs, complete: true, etag: res.etag };
  }
  return { jobs: [], complete: true, notFound: true };
}

/** Personio XML feed. One request reads the whole board, descriptions included. */
export const personio: Connector = {
  atsType: "personio",
  ready: true,
  capabilities: { conditional: true, maxConcurrencyPerHost: 4 },
  listJobs: (token, http, opts) => readXml(token, http, opts?.etag),
  async fetchJob(token, externalId, http) {
    const { jobs } = await readXml(token, http);
    return jobs.find((j) => j.externalId === externalId) ?? null;
  },
  parseUrl(url) {
    const u = safeUrl(url);
    const m = u?.hostname.toLowerCase().match(/^([a-z0-9-]+)\.jobs\.personio\.(?:de|com)$/);
    if (!u || !m) return null;
    const [seg, id] = u.pathname.split("/").filter(Boolean);
    return { token: m[1] as string, externalId: seg === "job" && id ? id : null };
  },
};
