/**
 * Board discovery from the candidate sources (packages/ingest/src/discovery/sources.ts).
 *
 *   npx tsx scripts/discover-boards.mts load              list every enabled source into board_candidates
 *   npx tsx scripts/discover-boards.mts load --dry-run    list and count, write nothing
 *
 * Uses DATABASE_URL, else the local PGlite in data/pglite (PGLITE_DIR). Never point it at a production database.
 * Downloads are a handful of polite GETs to raw.githubusercontent.com, one at a time. Nothing a source lists is trusted
 * until it is verified against the board's live public feed.
 */
import path from "node:path";
import { connect, migrate } from "@norinote/db";
import { CANDIDATE_SOURCES, loadCandidates, politeDownload, seedCompanies } from "@norinote/ingest";

const [command = "", ...args] = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);

if (command !== "load") {
  console.error("usage: npx tsx scripts/discover-boards.mts load [--dry-run]");
  process.exit(2);
}

const download = politeDownload();
if (flag("dry-run")) {
  for (const source of CANDIDATE_SOURCES) {
    const off = source.disabledReason(process.env);
    if (off || source.id === "user") { console.log(`${source.id.padEnd(24)} ${off ?? "reads the database, skipped in a dry run"}`); continue; }
    const boards = await source.list({ db: undefined as never, download, env: process.env });
    const per: Record<string, number> = {};
    for (const b of boards) per[b.atsType] = (per[b.atsType] ?? 0) + 1;
    console.log(`${source.id.padEnd(24)} ${String(boards.length).padStart(6)}  ${JSON.stringify(per)}  (${source.licence})`);
  }
  process.exit(0);
}

const handle = await connect({ url: process.env.DATABASE_URL?.trim() || undefined, pgliteDir: process.env.PGLITE_DIR || path.resolve("data/pglite") });
try {
  await migrate(handle);
  await seedCompanies(handle.db);
  const report = await loadCandidates(handle.db, CANDIDATE_SOURCES, { download, env: process.env });
  console.log("source                    listed   added   known  skipped");
  for (const r of report) {
    const note = r.disabled ? `  off: ${r.disabled}` : r.error ? `  failed: ${r.error}` : "";
    console.log(`${r.source.padEnd(24)} ${String(r.listed).padStart(7)} ${String(r.added).padStart(7)} ${String(r.alreadyKnown).padStart(7)} ${String(r.skipped).padStart(8)}${note}`);
  }
} finally {
  await handle.close();
}
