import type { AtsType } from "@norinote/shared";
import { and, companies, eq, inArray, sql } from "@norinote/db";
import type { Db } from "@norinote/db";
import { BlockedSourceError, isBlockedBoard, isBlockedCompany } from "./blocklist.js";
import { getConnector, isSupportedAts } from "./connectors/index.js";
import { normalizeCompany } from "./dedupe.js";
import { fetchWithRetry, RateLimitedError } from "./http.js";
import { toListResult } from "./list-result.js";
import { RobotsDisallowedError, RobotsUnavailableError } from "./robots.js";
import { assertPublicUrl, safeFetch, type HostLookup } from "./ssrf.js";
import { ensureCompany } from "./store.js";
import type { HttpOptions } from "./types.js";
import { prettifyToken } from "./util.js";

/** Job systems a person can add a company from, in the order a name is tried. Parked systems drop out (`ready: false`). */
export const DISCOVERY_SYSTEMS: readonly AtsType[] = (["greenhouse", "ashby", "lever", "workable", "rippling", "workday"] as const)
  .filter((t) => isSupportedAts(t));

/** Systems whose board address can be guessed from a company name. Workday needs the tenant, cluster and site from a link. */
const NAME_SYSTEMS: readonly AtsType[] = DISCOVERY_SYSTEMS.filter((t) => t !== "workday");

/** Sites Nori never reads, whatever it is asked. */
const FORBIDDEN_HOST = /(^|\.)(linkedin\.com|lnkd\.in|indeed\.[a-z.]+|glassdoor\.[a-z.]+)$/i;

/** Most requests one verification read may make; enough to see a board answer with jobs without reading all of it. */
export const MAX_VERIFY_REQUESTS = 12;
/** Most bytes read from a company's careers page. */
const MAX_PAGE_BYTES = 1024 * 1024;

const SYSTEM_NAMES: Record<string, string> = {
  greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday", workable: "Workable", rippling: "Rippling",
};
export const systemName = (t: AtsType): string => SYSTEM_NAMES[t] ?? prettifyToken(t);
const systemList = () => {
  const names = DISCOVERY_SYSTEMS.map(systemName);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : (names[0] ?? "");
};

/** The input cannot be used: empty, a site Nori never reads, or not a company. The message is for the person. */
export class CompanyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyInputError";
  }
}

export type DiscoveredCompany = { id: string; name: string; atsType: AtsType; token: string; status: string };

export type DiscoverResult =
  /** A new board, verified against its live feed and added to the shared registry. `openJobs` is null when there were too many to count in one read. */
  | { status: "added"; company: DiscoveredCompany; openJobs: number | null }
  /** The board (or a company of that name) is already in the registry; nothing was fetched or changed. */
  | { status: "exists"; company: DiscoveredCompany }
  /** No public board was found; `message` says so in plain words. */
  | { status: "not_found"; message: string };

export type DiscoverOptions = {
  /** Replaces the global fetch for every request, robots.txt included (tests). */
  fetch?: typeof fetch;
  /** Replaces DNS resolution in the SSRF check (tests). */
  lookup?: HostLookup;
  /** Other request knobs (tests). */
  http?: Omit<HttpOptions, "fetch">;
};

type Candidate = { atsType: AtsType; token: string; fromName: boolean };

const forbidden = (host: string) => FORBIDDEN_HOST.test(host.replace(/\.$/, ""));
const hostOf = (href: string) => { try { return new URL(href).hostname; } catch { return ""; } };

/** "https://..." or "acme.com/careers": a link, not a name. */
function asUrl(raw: string): URL | null {
  if (/\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : /^[^/]+\.[a-z]{2,}(\/|$|:)/i.test(raw) ? `https://${raw}` : null;
  if (!withScheme) return null;
  try { return new URL(withScheme); } catch { return null; }
}

/** The board on an allowed system that this link points to, or null. */
function boardOf(url: string): { atsType: AtsType; token: string } | null {
  for (const atsType of DISCOVERY_SYSTEMS) {
    const hit = getConnector(atsType).parseUrl(url);
    if (hit?.token) return { atsType, token: hit.token };
  }
  return null;
}

/** Board tokens a company name is likely to use: "Acme Robotics, Inc." to acmerobotics, acme-robotics, acme. */
export function tokensForName(name: string): string[] {
  const words = normalizeCompany(name).split(" ").filter((w) => w && w !== "and");
  if (!words.length) return [];
  const out = [words.join(""), words.join("-")];
  if (words.length > 1 && /^(labs?|ai|hq|technologies|technology|tech|software|systems|group|careers|jobs)$/.test(words.at(-1)!)) {
    out.push(words.slice(0, -1).join(""));
  }
  return [...new Set(out)].filter((t) => t.length >= 2 && t.length <= 64);
}

/** Links to boards on allowed systems found in a careers page (hrefs, iframes, scripts and URLs in inline JSON). */
export function boardsInPage(html: string): { atsType: AtsType; token: string }[] {
  const text = html.replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const seen = new Map<string, { atsType: AtsType; token: string }>();
  for (const m of text.matchAll(/(?:https?:)?\/\/[a-z0-9.-]+\.(?:greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workable\.com|rippling\.com)[^\s"'<>)\\]*/gi)) {
    const href = m[0].startsWith("//") ? `https:${m[0]}` : m[0];
    const board = boardOf(href);
    if (board) seen.set(`${board.atsType}|${board.token.toLowerCase()}`, board);
  }
  return [...seen.values()];
}

async function findExisting(db: Db, where: ReturnType<typeof and>): Promise<DiscoveredCompany | null> {
  const [row] = await db.select({ id: companies.id, name: companies.name, atsType: companies.atsType, token: companies.atsToken, status: companies.status })
    .from(companies).where(and(eq(companies.blocked, false), where)).limit(1);
  return row ?? null;
}

const existingBoard = (db: Db, c: { atsType: AtsType; token: string }) =>
  findExisting(db, and(eq(companies.atsType, c.atsType), sql`lower(${companies.atsToken}) = ${c.token.toLowerCase()}`));

const LEGAL_SUFFIX_RE = "[,.]?[[:space:]]+(incorporated|inc|llc|ltd|limited|corp|corporation|co|gmbh|plc)[.]?$";

/** "Acme, Inc." and "ACME" to "acme": the same key in SQL and here. */
export const companyNameKey = (name: string): string =>
  name.toLowerCase().replace(/[,.]?\s+(incorporated|inc|llc|ltd|limited|corp|corporation|co|gmbh|plc)[.]?$/, "").replace(/[^a-z0-9]/g, "");

/** A registry company with this name (punctuation, case and a legal suffix ignored) on an allowed system. */
async function existingByName(db: Db, name: string): Promise<DiscoveredCompany | null> {
  const key = companyNameKey(name);
  if (!key) return null;
  const sameName = sql`regexp_replace(regexp_replace(lower(${companies.name}), ${LEGAL_SUFFIX_RE}, ''), '[^a-z0-9]', '', 'g')`;
  return findExisting(db, and(inArray(companies.atsType, [...DISCOVERY_SYSTEMS]), sql`${sameName} = ${key}`));
}

/**
 * Read a board's live public feed through its connector, within MAX_VERIFY_REQUESTS requests, every one checked
 * against robots.txt. Null when the board does not exist. `openJobs` is null when the read was cut short after the feed
 * had already answered (a big board).
 */
async function verifyBoard(c: Candidate, fetchFn: typeof fetch, http: DiscoverOptions["http"]): Promise<{ openJobs: number | null; name: string | null } | null> {
  let requests = 0;
  let answered = false;
  class ReadEnough extends Error {}
  const budgeted: typeof fetch = async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(href).pathname === "/robots.txt") return fetchFn(input, init);
    if (++requests > MAX_VERIFY_REQUESTS) throw new ReadEnough("verification read is long enough");
    const res = await fetchFn(input, init);
    if (res.ok) answered = true;
    return res;
  };
  try {
    const read = toListResult(await getConnector(c.atsType).listJobs(c.token, { ...http, fetch: budgeted }));
    if (read.notFound) return null;
    return { openJobs: read.jobs.length, name: read.jobs.find((j) => j.companyName && j.companyName !== prettifyToken(c.token))?.companyName ?? null };
  } catch (err) {
    if (err instanceof ReadEnough && answered) return { openJobs: null, name: null };
    throw err;
  }
}

/**
 * Every outgoing request: never a forbidden site, always a public address. robots.txt is obeyed by the request helpers
 * in http.ts (connector reads, and the careers page through fetchWithRetry).
 */
function guardedFetch(base: typeof fetch, lookup: HostLookup | undefined): typeof fetch {
  return async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (forbidden(hostOf(href))) throw new CompanyInputError("Nori doesn't read LinkedIn, Indeed or Glassdoor.");
    await assertPublicUrl(href, { lookup });
    return base(input, init);
  };
}

const defaultFetch = guardedFetch((input, init) => fetch(input, init), undefined);

/** Read a company's own careers page (one GET per hop, robots.txt obeyed) and return the boards it links to. */
async function boardsOnCareersPage(url: URL, fetchFn: typeof fetch, lookup: HostLookup | undefined, http: DiscoverOptions["http"]): Promise<{ atsType: AtsType; token: string }[]> {
  // A careers page that redirects to its board names the board; the board page itself is never requested.
  class RedirectsToBoard extends Error { constructor(readonly board: { atsType: AtsType; token: string }) { super("redirects to a board"); } }
  const stopAtBoard: typeof fetch = (input, init) => {
    const board = boardOf(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (board) throw new RedirectsToBoard(board);
    return fetchWithRetry(String(input instanceof Request ? input.url : input), init, { ...http, fetch: fetchFn });
  };
  let res: Response;
  try {
    res = await safeFetch(url.toString(), { headers: { accept: "text/html" } }, { fetch: stopAtBoard, lookup });
  } catch (err) {
    if (err instanceof RedirectsToBoard) return [err.board];
    throw err;
  }
  if (!res.ok) { void res.body?.cancel().catch(() => {}); return []; }
  const reader = res.body?.getReader();
  if (!reader) return [];
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= MAX_PAGE_BYTES) { void reader.cancel().catch(() => {}); break; }
  }
  return boardsInPage(new TextDecoder().decode(Buffer.concat(chunks)));
}

/**
 * Find a company's public job board from its name or a link and add it to the shared registry (`companies`), so
 * every person's search reads it from then on. Only boards on DISCOVERY_SYSTEMS count.
 *
 * - A board link (job-boards.greenhouse.io/acme, jobs.lever.co/acme, ...) is used as it is.
 * - Any other link is read as the company's careers page: one GET (public address, robots.txt obeyed, 1 MB at most),
 *   and the boards it links to are the candidates. LinkedIn, Indeed and Glassdoor are refused without a request.
 * - A name is first matched against the registry; otherwise the tokens the name is likely to use are tried on each
 *   system's public feed. Nothing searches the web.
 *
 * Every candidate is deduplicated against the registry before any request, and must answer its live feed through the
 * connector (the same read the poller makes, cut short after MAX_VERIFY_REQUESTS). A guess from a name must also have
 * open jobs, so an unrelated empty board with the same token is not added. The new row is `active` with
 * `discovered_via = 'user'` and is polled on the next scheduler tick. No one's identity is stored with it.
 *
 * Throws CompanyInputError, UnsafeUrlError or BlockedSourceError for input that cannot be used.
 */
export async function discoverCompany(db: Db, input: string, opts: DiscoverOptions = {}): Promise<DiscoverResult> {
  const raw = input.trim();
  if (raw.length < 2) throw new CompanyInputError("Type a company name or paste its careers page.");
  if (raw.length > 2000) throw new CompanyInputError("That is too long for a company name or link.");
  const fetchFn = opts.fetch || opts.lookup ? guardedFetch(opts.fetch ?? fetch, opts.lookup) : defaultFetch;
  const notFound = (what: string): DiscoverResult => ({ status: "not_found", message: `${what} Nori can add boards on ${systemList()}.` });

  const url = asUrl(raw);
  let candidates: Candidate[];
  let typedName: string | null = null;
  if (url) {
    if (forbidden(url.hostname)) throw new CompanyInputError("Nori doesn't read LinkedIn, Indeed or Glassdoor. Paste the company's own careers page, or type its name.");
    const board = boardOf(url.toString());
    if (board) candidates = [{ ...board, fromName: false }];
    else {
      let found;
      try {
        found = await boardsOnCareersPage(url, fetchFn, opts.lookup, opts.http);
      } catch (err) {
        if (err instanceof RobotsDisallowedError) {
          return { status: "not_found", message: `${url.hostname} doesn't allow automated reading of that page, so Nori can't look for a job board there. Try the company's name instead.` };
        }
        if (err instanceof RobotsUnavailableError || err instanceof RateLimitedError) {
          return { status: "not_found", message: `Nori couldn't check whether ${url.hostname} allows automated reading right now. Try again later, or type the company's name.` };
        }
        throw err;
      }
      if (!found.length) return notFound(`Nori couldn't find a job board linked from ${url.hostname}.`);
      candidates = found.slice(0, 5).map((b) => ({ ...b, fromName: false }));
    }
  } else {
    if (raw.length > 80 || !/[a-z0-9]/i.test(raw)) throw new CompanyInputError("Type a company name or paste its careers page.");
    typedName = raw.replace(/\s+/g, " ");
    if (isBlockedCompany({ name: typedName })) throw new BlockedSourceError(typedName);
    const known = await existingByName(db, typedName);
    if (known) return { status: "exists", company: known };
    const tokens = tokensForName(typedName);
    candidates = NAME_SYSTEMS.flatMap((atsType) => tokens.map((token) => ({ atsType, token, fromName: true })));
  }

  for (const c of candidates) {
    const known = await existingBoard(db, c);
    if (known) return { status: "exists", company: known };
  }

  let blockedByRobots = false;
  for (const c of candidates) {
    if (isBlockedBoard(c.atsType, c.token)) {
      if (candidates.length === 1) throw new BlockedSourceError(c.token);
      continue;
    }
    let verified;
    try {
      verified = await verifyBoard(c, fetchFn, opts.http);
    } catch (err) {
      if (err instanceof RobotsDisallowedError) { blockedByRobots = true; continue; }
      if (c.fromName) continue; // one system failing to answer a guess is not an answer
      throw err;
    }
    if (!verified || (c.fromName && verified.openJobs === 0)) continue;
    const name = verified.name ?? typedName ?? prettifyToken(c.atsType === "workday" ? c.token.split("|")[0]! : c.token);
    if (isBlockedCompany({ name })) throw new BlockedSourceError(name);
    const id = await ensureCompany(db, c.atsType, c.token, name, "user");
    const company = await findExisting(db, eq(companies.id, id));
    if (!company) throw new Error("the company was not stored");
    return { status: "added", company, openJobs: verified.openJobs };
  }

  if (blockedByRobots) return { status: "not_found", message: "That job board doesn't allow automated reading, so Nori can't add it." };
  if (url) return notFound("That job board didn't answer as a live public board.");
  return notFound(`Nori couldn't find a public job board for ${typedName}.`);
}
