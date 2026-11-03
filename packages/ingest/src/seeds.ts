/**
 * Seed lists: discovery without crawling. Pure parsing (CSV and JSON text in, `SeedCompany` rows out) plus one database
 * function, `importSeeds`. Nothing here touches the network; `scripts/import-seeds.mts` downloads the files.
 *
 * Sources and licences (also in docs/job-collection.md):
 * - `kalil0321/ats-scrapers`, `ats-companies/{system}.csv` (columns `name,slug,url`): code is MIT; the tenant lists are
 *   facts about public career pages, but the data licence is unconfirmed, so rows are only used as candidates that are
 *   verified against the live feed, never redistributed.
 * - `veresk06/open-ats-feed`, `actor/data/companies.json` (verified live boards of Greenhouse, Lever, Ashby, Breezy,
 *   Recruitee, Teamtailor): MIT code, the measurements are public domain.
 * - NOT used: `Riley-Dorrington/job-board-aggregator` (CC BY-NC, non-commercial only).
 *
 * Every row becomes a `candidate`: nothing is trusted until its first poll validates it.
 */
import { ATS_TYPES, type AtsType } from "@norinote/shared";
import { companies, sql } from "@norinote/db";
import type { Db } from "@norinote/db";
import { isBlockedBoard, isBlockedCompany } from "./blocklist.js";
import { isSupportedAts } from "./connectors/index.js";
import { hostKey } from "./hosts.js";
import { PRIORITY } from "./schedule.js";
import { prettifyToken } from "./util.js";

export type SeedSource = "seed:ats-scrapers" | "seed:open-ats-feed";

export const SEED_SOURCES: readonly SeedSource[] = ["seed:ats-scrapers", "seed:open-ats-feed"];

export const SEED_LICENCES: Record<SeedSource, string> = {
  "seed:ats-scrapers": "kalil0321/ats-scrapers: code MIT, data licence to confirm before redistributing (candidates only)",
  "seed:open-ats-feed": "veresk06/open-ats-feed: code MIT, data public domain",
};

/** A board a seed knows about, in our token format. */
export type SeedCompany = {
  atsType: AtsType;
  token: string;
  name: string;
  domain: string | null;
  discoveredVia: SeedSource;
};

/** The job systems that have a `{system}.csv` in kalil0321/ats-scrapers (the file name is the system name). */
export const SEED_CSV_SYSTEMS: readonly AtsType[] = ATS_TYPES;

// ---------------------------------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------------------------------

/** Parse CSV text (RFC 4180: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF, a BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); if (row.length > 1 || row[0] !== "") rows.push(row); }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------------
// URL parsing per system
// ---------------------------------------------------------------------------------------------------------------------

function url(raw: string): URL | null {
  const v = raw.trim();
  if (!v) return null;
  try { return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`); } catch { return null; }
}

const segments = (u: URL): string[] => u.pathname.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
const LOCALE_RE = /^[a-z]{2}([-_][A-Za-z]{2,4})?$/;

/**
 * `https://{tenant}.{wdN}.myworkdayjobs.com/{site}` (an optional locale such as `en-US` before the site is skipped)
 * to the token `tenant|wdN|site`. Null for any other host or a URL without a site.
 */
export function parseWorkdayUrl(raw: string): string | null {
  const u = url(raw);
  const m = u?.hostname.toLowerCase().match(/^([a-z0-9][a-z0-9-]*)\.(wd\d+)\.myworkdayjobs\.com$/);
  if (!u || !m) return null;
  const parts = segments(u);
  if (parts.length > 1 && LOCALE_RE.test(parts[0]!)) parts.shift();
  const site = parts[0];
  if (!site || site === "wday") return null;
  return `${m[1]}|${m[2]}|${site}`;
}

/**
 * `https://{host}.fa.{region}.oraclecloud.com/hcmUI/CandidateExperience/{lang}/sites/{siteNumber}` to the token
 * `host|region|siteNumber`. Null for custom domains (the region cannot be known) and URLs without a site.
 */
export function parseOracleUrl(raw: string): string | null {
  const u = url(raw);
  const m = u?.hostname.toLowerCase().match(/^([a-z0-9][a-z0-9-]*)\.fa\.([a-z0-9-]+)\.oraclecloud\.com$/);
  if (!u || !m) return null;
  const parts = segments(u);
  const at = parts.findIndex((p) => p.toLowerCase() === "sites");
  const site = at >= 0 ? parts[at + 1] : undefined;
  if (!site || !/^[A-Za-z0-9_-]+$/.test(site)) return null;
  return `${m[1]}|${m[2]}|${site}`;
}

/** The subdomain of `{sub}.{suffix}` hosts (suffix without a leading dot), or null. */
function subdomain(raw: string, suffix: RegExp): string | null {
  const u = url(raw);
  const m = u?.hostname.toLowerCase().match(suffix);
  return m?.[1] ?? null;
}

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const cleanSlug = (s: string): string | null => { const v = s.trim(); return SLUG_RE.test(v) ? v : null; };

/** First path segment of a URL on one of these hosts. */
function firstSegment(raw: string, hosts: RegExp): string | null {
  const u = url(raw);
  if (!u || !hosts.test(u.hostname)) return null;
  return cleanSlug(segments(u)[0] ?? "");
}

/**
 * The board token for one seed row, in the format the connector expects (docs/job-collection.md), or null when the row
 * cannot be a board of that system. The URL is preferred over the slug column because it keeps the tenant's own
 * spelling (Workday, Oracle and SmartRecruiters are case-sensitive in places).
 */
function tokenFor(atsType: AtsType, slug: string, link: string): string | null {
  switch (atsType) {
    case "workday": return parseWorkdayUrl(link);
    case "oracle": return parseOracleUrl(link);
    case "greenhouse": return firstSegment(link, /(^|\.)greenhouse\.io$/i) ?? cleanSlug(slug);
    case "lever": return firstSegment(link, /^jobs(\.eu)?\.lever\.co$/i) ?? cleanSlug(slug);
    case "ashby": return firstSegment(link, /^jobs\.ashbyhq\.com$/i) ?? cleanSlug(slug);
    case "smartrecruiters": return firstSegment(link, /^(jobs|careers)\.smartrecruiters\.com$/i) ?? cleanSlug(slug);
    case "workable": return firstSegment(link, /^apply\.workable\.com$/i) ?? cleanSlug(slug);
    case "rippling": return firstSegment(link, /^ats\.rippling\.com$/i) ?? cleanSlug(slug);
    case "recruitee": return subdomain(link, /^([a-z0-9-]+)\.recruitee\.com$/) ?? cleanSlug(slug);
    case "teamtailor": return subdomain(link, /^([a-z0-9-]+)\.teamtailor\.com$/) ?? cleanSlug(slug);
    case "personio": return subdomain(link, /^([a-z0-9-]+)\.jobs\.personio\.(?:com|de)$/) ?? cleanSlug(slug);
    case "bamboohr": return subdomain(link, /^([a-z0-9-]+)\.bamboohr\.com$/) ?? cleanSlug(slug);
    case "breezy": return subdomain(link, /^([a-z0-9-]+)\.breezy\.hr$/) ?? cleanSlug(slug);
    case "pinpoint": return subdomain(link, /^([a-z0-9-]+)\.pinpointhq\.com$/) ?? cleanSlug(slug);
    case "icims": return subdomain(link, /^careers-([a-z0-9-]+)\.icims\.com$/);
  }
}

/** One CSV row (`name`, `slug`, `url`) of a job system to a seed company, or null when it is unusable or blocklisted. */
export function parseSeedRow(
  atsType: AtsType, row: { name?: string; slug?: string; url?: string }, source: SeedSource = "seed:ats-scrapers",
): SeedCompany | null {
  let slug = (row.slug ?? "").trim();
  let link = (row.url ?? "").trim();
  // Legacy two-column files (`name,url`) put the bare slug in the url column.
  if (!slug && link && !/[./:]/.test(link)) { slug = link; link = ""; }
  const token = tokenFor(atsType, slug, link);
  if (!token) return null;
  const name = (row.name ?? "").trim() || prettifyToken(token.split("|")[0]!);
  if (isBlockedBoard(atsType, token) || isBlockedCompany({ name, token })) return null;
  return { atsType, token, name, domain: null, discoveredVia: source };
}

export type ParsedSeeds = { rows: SeedCompany[]; skipped: number };

/** A whole `{system}.csv` from kalil0321/ats-scrapers: header `name,slug,url` (or legacy `name,url`). */
export function parseSeedCsv(atsType: AtsType, text: string): ParsedSeeds {
  const table = parseCsv(text);
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (n: string) => header.indexOf(n);
  const [iName, iSlug, iUrl] = [col("name"), col("slug"), col("url")];
  const rows: SeedCompany[] = [];
  let skipped = 0;
  for (const cells of table.slice(1)) {
    const get = (i: number) => (i >= 0 ? cells[i] ?? "" : "");
    const parsed = parseSeedRow(atsType, { name: get(iName), slug: get(iSlug), url: get(iUrl) });
    if (parsed) rows.push(parsed); else skipped++;
  }
  return { rows, skipped };
}

/**
 * `actor/data/companies.json` from veresk06/open-ats-feed: `{ providers: { greenhouse: { live: [[token, postings], ...],
 * empty: [token, ...] }, ... } }`. Only verified live boards are returned (boards that answered with zero postings
 * only when `includeEmpty`); Lever's unverified tokens are never used.
 */
export function parseOpenAtsFeed(data: unknown, opts: { includeEmpty?: boolean } = {}): ParsedSeeds {
  const providers = (data as { providers?: Record<string, { live?: unknown; empty?: unknown }> } | null)?.providers ?? {};
  const rows: SeedCompany[] = [];
  let skipped = 0;
  const known = new Set<string>(ATS_TYPES);
  for (const [system, entry] of Object.entries(providers)) {
    if (!known.has(system)) continue;
    const atsType = system as AtsType;
    const tokens: string[] = [];
    for (const item of Array.isArray(entry?.live) ? entry.live : []) {
      const token = Array.isArray(item) ? item[0] : item;
      if (typeof token === "string") tokens.push(token);
    }
    if (opts.includeEmpty) for (const token of Array.isArray(entry?.empty) ? entry.empty : []) if (typeof token === "string") tokens.push(token);
    for (const raw of tokens) {
      const token = cleanSlug(raw);
      const name = token ? prettifyToken(token) : "";
      if (!token || isBlockedBoard(atsType, token) || isBlockedCompany({ name, token })) { skipped++; continue; }
      rows.push({ atsType, token, name, domain: null, discoveredVia: "seed:open-ats-feed" });
    }
  }
  return { rows, skipped };
}

// ---------------------------------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------------------------------

export type SeedImportResult = {
  /** Rows written as new candidates, per job system. */
  inserted: Partial<Record<AtsType, number>>;
  /** Rows dropped because the same board (any letter case) was already in `companies` or earlier in the input. */
  duplicates: number;
  /** Rows dropped because their job system has no working connector yet. */
  unsupported: number;
  /** Rows dropped by the blocklist. */
  blocked: number;
};

const dedupeKey = (atsType: string, token: string) => `${atsType}|${token.toLowerCase()}`;

/**
 * Upsert seed rows into `companies` as `candidate` (priority 0, host set), in batches. Existing companies are never
 * touched; the same board twice (in any letter case) is written once, first one wins, so put the better source first.
 * Rows of unsupported job systems and blocklisted names are skipped.
 */
export async function importSeeds(
  db: Db, rows: readonly SeedCompany[], opts: { batchSize?: number; supported?: (atsType: AtsType) => boolean } = {},
): Promise<SeedImportResult> {
  const batchSize = opts.batchSize ?? 500;
  const supported = opts.supported ?? isSupportedAts;
  const result: SeedImportResult = { inserted: {}, duplicates: 0, unsupported: 0, blocked: 0 };

  const wanted: SeedCompany[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!supported(r.atsType)) { result.unsupported++; continue; }
    if (isBlockedBoard(r.atsType, r.token) || isBlockedCompany({ name: r.name, token: r.token })) { result.blocked++; continue; }
    const key = dedupeKey(r.atsType, r.token);
    if (seen.has(key)) { result.duplicates++; continue; }
    seen.add(key);
    wanted.push(r);
  }
  if (!wanted.length) return result;

  const systems = [...new Set(wanted.map((r) => r.atsType))];
  const existing = await db.select({ atsType: companies.atsType, token: companies.atsToken }).from(companies)
    .where(sql`${companies.atsType} in (${sql.join(systems.map((s) => sql`${s}`), sql`, `)})`);
  const have = new Set(existing.map((e) => dedupeKey(e.atsType, e.token)));
  const fresh = wanted.filter((r) => {
    if (!have.has(dedupeKey(r.atsType, r.token))) return true;
    result.duplicates++;
    return false;
  });

  for (let i = 0; i < fresh.length; i += batchSize) {
    const batch = fresh.slice(i, i + batchSize);
    const written = await db.insert(companies).values(batch.map((r) => ({
      atsType: r.atsType, atsToken: r.token, name: r.name, domain: r.domain, host: hostKey(r.atsType, r.token),
      discoveredVia: r.discoveredVia, status: "candidate" as const, priority: PRIORITY.seed,
    }))).onConflictDoNothing().returning({ atsType: companies.atsType });
    for (const w of written) result.inserted[w.atsType] = (result.inserted[w.atsType] ?? 0) + 1;
    result.duplicates += batch.length - written.length;
  }
  return result;
}
