/**
 * Board discovery from the candidate sources (packages/ingest/src/discovery/).
 *
 *   npx tsx scripts/discover-boards.mts load              list every enabled source into board_candidates
 *   npx tsx scripts/discover-boards.mts load --dry-run    list and count, write nothing
 *   npx tsx scripts/discover-boards.mts verify [--systems greenhouse,lever] [--limit 500] [--gap 1000] [--all]
 *                                                       verify due candidates against their live feeds and promote
 *                                                       (--all: keep going until nothing is due)
 *   npx tsx scripts/discover-boards.mts report [--json]   candidates found, verified, promoted, and fresh US target-role
 *                                                       jobs per family before (registry and people's additions) and after
 *
 * Uses DATABASE_URL, else the local PGlite in data/pglite (PGLITE_DIR). Never point it at a production database.
 * Downloads are a handful of polite GETs to raw.githubusercontent.com, one at a time. Verification reads each board's
 * public feed once, one board at a time per feed host with a gap, robots.txt obeyed.
 */
import path from "node:path";
import type { AtsType } from "@norinote/shared";
import { boardCandidates, companies, connect, eq, migrate } from "@norinote/db";
import { CANDIDATE_SOURCES, DISCOVERY_ATS, loadCandidates, politeDownload, seedCompanies, verifyCandidates } from "@norinote/ingest";
import { TARGET_FAMILIES, targetFamilyOf } from "@norinote/match";

const [command = "", ...args] = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

if (!["load", "verify", "report"].includes(command)) {
  console.error("usage: npx tsx scripts/discover-boards.mts load [--dry-run] | verify [--systems a,b] [--limit n] [--gap ms] [--all] | report [--json]");
  process.exit(2);
}

const download = politeDownload();
if (command === "load" && flag("dry-run")) {
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
const db = handle.db;
try {
  await migrate(handle);
  if (command === "load") {
    await seedCompanies(db);
    const report = await loadCandidates(db, CANDIDATE_SOURCES, { download, env: process.env });
    console.log("source                    listed   added   known  skipped");
    for (const r of report) {
      const note = r.disabled ? `  off: ${r.disabled}` : r.error ? `  failed: ${r.error}` : "";
      console.log(`${r.source.padEnd(24)} ${String(r.listed).padStart(7)} ${String(r.added).padStart(7)} ${String(r.alreadyKnown).padStart(7)} ${String(r.skipped).padStart(8)}${note}`);
    }
  } else if (command === "verify") {
    const atsTypes = (value("systems")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null) as AtsType[] | null;
    const limit = Number(value("limit") ?? 200);
    const gapMs = Number(value("gap") ?? 1000);
    const tally: Record<string, number> = {};
    let n = 0;
    const started = Date.now();
    const onBoard = (b: { outcome: string }) => {
      tally[b.outcome] = (tally[b.outcome] ?? 0) + 1;
      if (++n % 100 === 0) console.log(`${n} verified in ${Math.round((Date.now() - started) / 60_000)} min: ${JSON.stringify(tally)}`);
    };
    if (!flag("all")) await verifyCandidates(db, { classify: targetFamilyOf, limit, gapMs, atsTypes, onBoard });
    // Until nothing is due: one loop per job system, side by side (each system is its own feed host).
    else await Promise.all((atsTypes ?? DISCOVERY_ATS).map(async (system) => {
      while ((await verifyCandidates(db, { classify: targetFamilyOf, limit, gapMs, atsTypes: [system], onBoard })).length > 0) { /* next batch */ }
    }));
    console.log(`done: ${n} verified: ${JSON.stringify(tally)}`);
  } else {
    const rows = await db.select({
      atsType: boardCandidates.atsType, status: boardCandidates.status, sources: boardCandidates.sources, verifiedAt: boardCandidates.verifiedAt,
      targetJobs: boardCandidates.targetJobs, discoveredVia: companies.discoveredVia,
    }).from(boardCandidates).leftJoin(companies, eq(companies.id, boardCandidates.companyId));
    const before = (r: (typeof rows)[number]) => r.status === "promoted" && (r.discoveredVia === "registry" || r.discoveredVia === "user" || r.discoveredVia === "url");
    const sum = (list: typeof rows, systems: readonly string[]) => {
      const out: Record<string, number> = Object.fromEntries(TARGET_FAMILIES.map((f) => [f, 0]));
      for (const r of list) if (systems.includes(r.atsType)) for (const [f, n] of Object.entries(r.targetJobs ?? {})) out[f] = (out[f] ?? 0) + n;
      out.total = Object.values(out).reduce((a, b) => a + b, 0);
      return out;
    };
    const count = (pred: (r: (typeof rows)[number]) => boolean) => {
      const out: Record<string, number> = { all: 0 };
      for (const r of rows) if (pred(r)) { out[r.atsType] = (out[r.atsType] ?? 0) + 1; out.all!++; }
      return out;
    };
    const live = rows.filter((r) => r.status === "promoted" && r.verifiedAt);
    const report = {
      candidates: count(() => true),
      fromFreeLists: count((r) => r.sources.some((s) => s.startsWith("seed:"))),
      verified: count((r) => r.verifiedAt !== null),
      byStatus: Object.fromEntries(["new", "promoted", "low_value", "empty", "dead", "disallowed", "failing"].map((s) => [s, count((r) => r.status === s && (s === "new" || r.verifiedAt !== null)).all])),
      boardsBefore: count((r) => before(r)),
      promotedNow: count((r) => r.status === "promoted" && !before(r)),
      freshUsTargetJobs: Object.fromEntries([["all", DISCOVERY_ATS], ...DISCOVERY_ATS.map((s) => [s, [s]])].map(([label, systems]) => [label, {
        before: sum(live.filter(before), systems as readonly string[]), after: sum(live, systems as readonly string[]),
      }])),
    };
    if (flag("json")) console.log(JSON.stringify(report, null, 2));
    else {
      console.log("candidates found     ", JSON.stringify(report.candidates));
      console.log("from free lists      ", JSON.stringify(report.fromFreeLists));
      console.log("verified             ", JSON.stringify(report.verified));
      console.log("by status            ", JSON.stringify(report.byStatus));
      console.log("boards before        ", JSON.stringify(report.boardsBefore));
      console.log("promoted by discovery", JSON.stringify(report.promotedNow));
      console.log("\nfresh US target-role jobs (last 7 days), before -> after");
      for (const [label, { before: b, after: a }] of Object.entries(report.freshUsTargetJobs)) {
        console.log(`  ${label.padEnd(11)} ${[...TARGET_FAMILIES, "total"].map((f) => `${f} ${b[f]} -> ${a[f]}`).join(", ")}`);
      }
    }
  }
} finally {
  await handle.close();
}
