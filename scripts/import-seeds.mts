/**
 * Import candidate boards from the public seed lists into `companies` (status `candidate`, priority 0).
 *
 *   npx tsx scripts/import-seeds.mts                       download everything and import (DATABASE_URL, else PGlite)
 *   npx tsx scripts/import-seeds.mts --dry-run             download and count, write nothing
 *   npx tsx scripts/import-seeds.mts --only workday,oracle limit to some job systems
 *   npx tsx scripts/import-seeds.mts --include-empty       also take open-ats-feed boards that had no postings
 *   npx tsx scripts/import-seeds.mts --dir ./seeds         read {system}.csv and companies.json from a folder (no network)
 *
 * Sources and licences: see packages/ingest/src/seeds.ts and docs/job-collection.md. Every row is only a candidate; the
 * worker validates it with its first poll. Safe to run again: boards already in `companies` are skipped.
 * Downloads are a few dozen polite GETs to raw.githubusercontent.com, one at a time. Nothing else touches the network.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { connect, migrate } from "@norinote/db";
import {
  importSeeds, parseOpenAtsFeed, parseSeedCsv, SEED_CSV_SYSTEMS, SEED_LICENCES, USER_AGENT, type SeedCompany,
} from "@norinote/ingest";
import type { AtsType } from "@norinote/shared";

const CSV_BASE = "https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies";
const FEED_URL = "https://raw.githubusercontent.com/veresk06/open-ats-feed/main/actor/data/companies.json";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const dryRun = flag("dry-run");
const dir = value("dir");
const only = value("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const systems = SEED_CSV_SYSTEMS.filter((s) => !only || only.includes(s));
if (only) {
  const unknown = only.filter((s) => !(SEED_CSV_SYSTEMS as readonly string[]).includes(s));
  if (unknown.length) { console.error(`unknown job system(s): ${unknown.join(", ")}`); process.exit(2); }
}

async function load(file: string, remote: string): Promise<string | null> {
  if (dir) {
    try { return await readFile(path.join(dir, file), "utf8"); } catch { return null; }
  }
  const res = await fetch(remote, { headers: { "user-agent": USER_AGENT } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${remote} failed: ${res.status}`);
  const text = await res.text();
  await new Promise((r) => setTimeout(r, 250));
  return text;
}

const rows: SeedCompany[] = [];
const parsed: Record<string, { rows: number; skipped: number }> = {};
const count = (system: string, key: "rows" | "skipped", n: number) => {
  parsed[system] ??= { rows: 0, skipped: 0 };
  parsed[system]![key] += n;
};

// Verified boards first, so when both lists know a board the verified entry is the one kept.
const feedText = await load("companies.json", FEED_URL);
if (feedText) {
  const feed = parseOpenAtsFeed(JSON.parse(feedText), { includeEmpty: flag("include-empty") });
  for (const r of feed.rows) { if (!only || only.includes(r.atsType)) { rows.push(r); count(r.atsType, "rows", 1); } }
  console.log(`open-ats-feed: ${feed.rows.length} verified boards (${SEED_LICENCES["seed:open-ats-feed"]})`);
} else console.log("open-ats-feed: companies.json not found, skipped");

for (const system of systems) {
  const text = await load(`${system}.csv`, `${CSV_BASE}/${system}.csv`);
  if (!text) { console.log(`ats-scrapers/${system}.csv: not found, skipped`); continue; }
  const csv = parseSeedCsv(system, text);
  rows.push(...csv.rows);
  count(system, "rows", csv.rows.length);
  count(system, "skipped", csv.skipped);
  console.log(`ats-scrapers/${system}.csv: ${csv.rows.length} usable rows, ${csv.skipped} unusable`);
}
console.log(`licence: ${SEED_LICENCES["seed:ats-scrapers"]}`);

if (dryRun) {
  console.log("\ndry run, nothing written. Parsed rows per system (before de-duplication):");
  for (const [system, c] of Object.entries(parsed)) console.log(`  ${system.padEnd(16)} ${String(c.rows).padStart(6)}  (unusable: ${c.skipped})`);
  process.exit(0);
}

const url = process.env.DATABASE_URL?.trim() || undefined;
const handle = await connect({ url, pgliteDir: process.env.PGLITE_DIR || path.resolve("data/pglite") });
try {
  await migrate(handle);
  const result = await importSeeds(handle.db, rows);
  console.log("\nimported as candidates:");
  let total = 0;
  for (const system of Object.keys(parsed) as AtsType[]) {
    const n = result.inserted[system] ?? 0;
    total += n;
    console.log(`  ${system.padEnd(16)} ${String(n).padStart(6)}`);
  }
  console.log(`total ${total}; already known or repeated: ${result.duplicates}; unsupported system: ${result.unsupported}; blocklisted: ${result.blocked}`);
} finally {
  await handle.close();
}
