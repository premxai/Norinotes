/**
 * Candidate sources: where board discovery hears about boards. Each source lists boards on allowed job systems
 * (`CandidateBoard`); `loadCandidates` stores them in `board_candidates` as `new`, and verification (verify.ts) decides
 * which ones reach `companies`. Nothing a source says is trusted: every board is read through its live public feed first.
 *
 * Free public lists (all downloaded from raw.githubusercontent.com, one file at a time; licences in docs/job-collection.md):
 * - seed:open-ats-feed: veresk06/open-ats-feed, MIT code, measurements public domain.
 * - seed:ats-scrapers: kalil0321/ats-scrapers, MIT (the repository licence covers its ats-companies CSVs).
 * - seed:ats-directory: moonie0201/ats-directory, CC0 1.0. Rows a live probe confirmed (`status: ok`).
 * - seed:ats-company-slugs: datakit457/ats-company-slugs, CC0 (stated in its README). Rows with `board_ok`.
 * - seed:open-jobs: elliottdehn/open-jobs `slugs.json`, CC0 1.0. Boards its crawler runs (not the ones it marks gone).
 * NOT used: Riley-Dorrington/job-board-aggregator (CC BY-NC), lists with no licence, and Common Crawl (its terms).
 *
 * Other sources:
 * - registry: the curated registry, scored like everything else (the "before" numbers of a discovery run).
 * - user: boards people added (POST /api/companies). They are already in `companies`; listing them here gives them the
 *   same scoring and slow re-verification, and they are never demoted.
 * - aggregator:treg: a paid aggregator (Treg/MobiusEngine). A stub that stays off: no TREG_API_KEY, and Prem has not
 *   decided on paid sources.
 */
import type { AtsType } from "@norinote/shared";
import { boardCandidates, companies, inArray, sql, type Db } from "@norinote/db";
import { isBlockedBoard, isBlockedCompany } from "../blocklist.js";
import { BOARD_REGISTRY } from "../board-registry.js";
import { isSupportedAts } from "../connectors/index.js";
import { USER_AGENT } from "../http.js";
import { parseCsv, parseOpenAtsFeed, parseSeedCsv, SEED_CSV_SYSTEMS } from "../seeds.js";
import { prettifyToken } from "../util.js";

/** A board a source knows about, in our token format. `name` is null when the source does not say it. */
export type CandidateBoard = { atsType: AtsType; token: string; name: string | null };

/** Downloads one file: its text, or null when it is not there (404). */
export type Download = (url: string) => Promise<string | null>;

export type SourceContext = { db: Db; download: Download; env: Record<string, string | undefined> };

export interface CandidateSource {
  /** Stored in `board_candidates.sources` and, once promoted, in `companies.discovered_via`. */
  id: string;
  licence: string;
  /** Null when the source can run; otherwise why it is off, in plain words. */
  disabledReason(env: Record<string, string | undefined>): string | null;
  list(ctx: SourceContext): Promise<CandidateBoard[]>;
}

/** Job systems discovery reads: the live ones whose board token is a plain slug. */
export const DISCOVERY_ATS: readonly AtsType[] = (["greenhouse", "lever", "ashby", "workable", "rippling"] as const).filter((t) => isSupportedAts(t));

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const slug = (raw: unknown): string | null => (typeof raw === "string" && SLUG_RE.test(raw.trim()) ? raw.trim() : null);
const system = (raw: unknown): AtsType | null => {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (DISCOVERY_ATS as readonly string[]).includes(s) ? (s as AtsType) : null;
};
const board = (atsType: AtsType | null, token: string | null, name?: unknown): CandidateBoard | null => {
  if (!atsType || !token) return null;
  const n = typeof name === "string" && name.trim() ? name.trim() : null;
  return { atsType, token, name: n };
};

/** moonie0201/ats-directory `companies.jsonl`: one `{provider, slug, region, name, status}` per line; only `ok` rows outside the EU host. */
export function parseAtsDirectory(text: string): CandidateBoard[] {
  const out: CandidateBoard[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let row: { provider?: unknown; slug?: unknown; region?: unknown; name?: unknown; status?: unknown };
    try { row = JSON.parse(line); } catch { continue; }
    if (row.status !== "ok" || row.region) continue;
    const b = board(system(row.provider), slug(row.slug), row.name);
    if (b) out.push(b);
  }
  return out;
}

/** datakit457/ats-company-slugs `data/boards.csv`: `company,ats,slug,industry,open_jobs,board_ok,checked`; rows with board_ok. */
export function parseAtsCompanySlugs(text: string): CandidateBoard[] {
  const [header = [], ...rows] = parseCsv(text);
  const col = (n: string) => header.findIndex((h) => h.trim().toLowerCase() === n);
  const [iName, iAts, iSlug, iOk] = [col("company"), col("ats"), col("slug"), col("board_ok")];
  if (iAts < 0 || iSlug < 0) return [];
  const out: CandidateBoard[] = [];
  for (const r of rows) {
    if (iOk >= 0 && !/^true$/i.test((r[iOk] ?? "").trim())) continue;
    const b = board(system(r[iAts]), slug(r[iSlug]), iName >= 0 ? r[iName] : null);
    if (b) out.push(b);
  }
  return out;
}

/** elliottdehn/open-jobs `slugs.json`: `{ ats: { greenhouse: [slug, ...], ... }, gone: {...} }`; boards in `ats` only. */
export function parseOpenJobsSlugs(data: unknown): CandidateBoard[] {
  const ats = (data as { ats?: Record<string, unknown> } | null)?.ats ?? {};
  const out: CandidateBoard[] = [];
  for (const [name, list] of Object.entries(ats)) {
    const atsType = system(name);
    if (!atsType || !Array.isArray(list)) continue;
    for (const s of list) { const b = board(atsType, slug(s)); if (b) out.push(b); }
  }
  return out;
}

const RAW = "https://raw.githubusercontent.com";
const always = () => null;

export const openAtsFeedSource: CandidateSource = {
  id: "seed:open-ats-feed",
  licence: "veresk06/open-ats-feed: MIT code, measurements public domain",
  disabledReason: always,
  async list({ download }) {
    const text = await download(`${RAW}/veresk06/open-ats-feed/main/actor/data/companies.json`);
    return text ? parseOpenAtsFeed(JSON.parse(text)).rows.map((r) => ({ atsType: r.atsType, token: r.token, name: null })) : [];
  },
};

export const atsScrapersSource: CandidateSource = {
  id: "seed:ats-scrapers",
  licence: "kalil0321/ats-scrapers: MIT",
  disabledReason: always,
  async list({ download }) {
    const out: CandidateBoard[] = [];
    for (const atsType of SEED_CSV_SYSTEMS.filter((s) => DISCOVERY_ATS.includes(s))) {
      const text = await download(`${RAW}/kalil0321/ats-scrapers/main/ats-companies/${atsType}.csv`);
      if (text) out.push(...parseSeedCsv(atsType, text).rows.map((r) => ({ atsType, token: r.token, name: r.name })));
    }
    return out;
  },
};

export const atsDirectorySource: CandidateSource = {
  id: "seed:ats-directory",
  licence: "moonie0201/ats-directory: CC0 1.0",
  disabledReason: always,
  async list({ download }) {
    const text = await download(`${RAW}/moonie0201/ats-directory/main/companies.jsonl`);
    return text ? parseAtsDirectory(text) : [];
  },
};

export const atsCompanySlugsSource: CandidateSource = {
  id: "seed:ats-company-slugs",
  licence: "datakit457/ats-company-slugs: CC0",
  disabledReason: always,
  async list({ download }) {
    const text = await download(`${RAW}/datakit457/ats-company-slugs/main/data/boards.csv`);
    return text ? parseAtsCompanySlugs(text) : [];
  },
};

export const openJobsSource: CandidateSource = {
  id: "seed:open-jobs",
  licence: "elliottdehn/open-jobs: CC0 1.0",
  disabledReason: always,
  async list({ download }) {
    const text = await download(`${RAW}/elliottdehn/open-jobs/main/slugs.json`);
    return text ? parseOpenJobsSlugs(JSON.parse(text)) : [];
  },
};

/** The curated registry (board-registry.ts): listed so its boards are scored like the rest and give the "before" numbers. */
export const registrySource: CandidateSource = {
  id: "registry",
  licence: "our own verified list",
  disabledReason: always,
  async list() {
    return BOARD_REGISTRY.filter((b) => DISCOVERY_ATS.includes(b.atsType)).map((b) => ({ atsType: b.atsType, token: b.token, name: b.name }));
  },
};

/** Boards people added through POST /api/companies (`discovered_via` user or url). */
export const userSource: CandidateSource = {
  id: "user",
  licence: "people's own additions",
  disabledReason: always,
  async list({ db }) {
    const rows = await db.select({ atsType: companies.atsType, token: companies.atsToken, name: companies.name }).from(companies)
      .where(inArray(companies.discoveredVia, ["user", "url"]));
    return rows.filter((r) => DISCOVERY_ATS.includes(r.atsType));
  },
};

/** Paid aggregator (Treg/MobiusEngine). Off without TREG_API_KEY; not built until Prem decides on paid sources. */
export const tregSource: CandidateSource = {
  id: "aggregator:treg",
  licence: "paid, terms to be agreed",
  disabledReason: (env) => (env.TREG_API_KEY?.trim() ? "Treg is not built yet: Prem decides on paid sources first" : "no TREG_API_KEY: paid source, off"),
  async list() {
    throw new Error("the Treg source is a stub");
  },
};

/** Every source, best first: when two list the same board, the first one is recorded first. */
export const CANDIDATE_SOURCES: readonly CandidateSource[] = [
  registrySource, userSource, openAtsFeedSource, atsDirectorySource, atsCompanySlugsSource, openJobsSource, atsScrapersSource, tregSource,
];

/** A download that sends our User-Agent, waits `gapMs` after each file, and treats 404 as absent. */
export function politeDownload(opts: { fetch?: typeof fetch; gapMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Download {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return async (url) => {
    const res = await doFetch(url, { headers: { "user-agent": USER_AGENT } });
    if (res.status === 404) { void res.body?.cancel().catch(() => {}); return null; }
    if (!res.ok) { void res.body?.cancel().catch(() => {}); throw new Error(`GET ${url} failed: ${res.status}`); }
    const text = await res.text();
    await sleep(opts.gapMs ?? 500);
    return text;
  };
}

export type SourceLoad = { source: string; listed: number; added: number; alreadyKnown: number; skipped: number; disabled: string | null; error: string | null };

const key = (atsType: string, token: string) => `${atsType}|${token.toLowerCase()}`;

/**
 * List every source and store the boards in `board_candidates`. A board already listed by an earlier source (in any
 * letter case) only gains the source's id. A board that is already live in `companies` (active or on probation) is
 * stored as `promoted` and linked, so it is scored but never promoted twice. Blocklisted boards and systems outside
 * DISCOVERY_ATS are skipped. A disabled source is reported and not called; a failing one is reported and the rest go on.
 */
export async function loadCandidates(db: Db, sources: readonly CandidateSource[], ctx: Omit<SourceContext, "db">): Promise<SourceLoad[]> {
  const report: SourceLoad[] = [];
  const existing = await db.select({ id: boardCandidates.id, atsType: boardCandidates.atsType, token: boardCandidates.atsToken, sources: boardCandidates.sources })
    .from(boardCandidates);
  const known = new Map(existing.map((e) => [key(e.atsType, e.token), e]));
  const live = await db.select({ id: companies.id, atsType: companies.atsType, token: companies.atsToken }).from(companies)
    .where(sql`${companies.status} in ('active', 'probation') and ${companies.blocked} = false`);
  const liveIds = new Map(live.map((c) => [key(c.atsType, c.token), c.id]));

  for (const source of sources) {
    const load: SourceLoad = { source: source.id, listed: 0, added: 0, alreadyKnown: 0, skipped: 0, disabled: source.disabledReason(ctx.env), error: null };
    report.push(load);
    if (load.disabled) continue;
    let boards: CandidateBoard[];
    try {
      boards = await source.list({ ...ctx, db });
    } catch (err) {
      load.error = err instanceof Error ? err.message : String(err);
      continue;
    }
    load.listed = boards.length;
    const fresh = new Map<string, CandidateBoard>();
    const gained: string[] = [];
    for (const b of boards) {
      const name = b.name ?? prettifyToken(b.token);
      if (!DISCOVERY_ATS.includes(b.atsType) || isBlockedBoard(b.atsType, b.token) || isBlockedCompany({ name, token: b.token })) { load.skipped++; continue; }
      const k = key(b.atsType, b.token);
      const seen = known.get(k);
      if (seen) {
        load.alreadyKnown++;
        if (!seen.sources.includes(source.id)) { seen.sources.push(source.id); gained.push(seen.id); }
        continue;
      }
      if (fresh.has(k)) { load.alreadyKnown++; continue; }
      fresh.set(k, { ...b, name });
    }
    for (let i = 0; i < gained.length; i += 500) {
      await db.update(boardCandidates).set({ sources: sql`array_append(${boardCandidates.sources}, ${source.id})` })
        .where(inArray(boardCandidates.id, gained.slice(i, i + 500)));
    }
    const rows = [...fresh.entries()];
    for (let i = 0; i < rows.length; i += 500) {
      const written = await db.insert(boardCandidates).values(rows.slice(i, i + 500).map(([k, b]) => {
        const companyId = liveIds.get(k) ?? null;
        return { atsType: b.atsType, atsToken: b.token, name: b.name!, sources: [source.id], status: companyId ? "promoted" as const : "new" as const, companyId };
      })).onConflictDoNothing().returning({ id: boardCandidates.id, atsType: boardCandidates.atsType, token: boardCandidates.atsToken, sources: boardCandidates.sources });
      for (const w of written) known.set(key(w.atsType, w.token), w);
      load.added += written.length;
      load.alreadyKnown += Math.min(500, rows.length - i) - written.length;
    }
  }
  return report;
}
