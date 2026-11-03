/**
 * Product-level outcome rates (all users, not per user): response, interview and rejection rates and the median days to a
 * first reply, by fit band and by job system, for later analysis of whether fit predicts replies. Read-only: it never
 * migrates, syncs or writes. Run `npm run db:migrate` first on a database older than migration 0006.
 *
 *   npx tsx scripts/outcomes-report.mts [--since 2026-09-01] [--json]
 *
 * DATABASE_URL picks Postgres; otherwise the local PGlite under PGLITE_DIR (default data/pglite).
 * Small groups (under 5 settled applications) show counts only.
 */
import path from "node:path";
import { connect, loadDotEnv } from "@norinote/db";
import { loadOutcomeHistory, summarizeOutcomes, type OutcomeStats } from "@norinote/match";

loadDotEnv();
const args = process.argv.slice(2);
const value = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const sinceRaw = value("since");
const since = sinceRaw ? new Date(sinceRaw) : undefined;
if (since && Number.isNaN(since.getTime())) throw new Error(`--since: not a date: ${sinceRaw}`);

const handle = await connect({ url: process.env.DATABASE_URL?.trim() || undefined, pgliteDir: process.env.PGLITE_DIR || path.resolve("data/pglite") });
try {
  const now = new Date();
  const history = await loadOutcomeHistory(handle.db, since ? { since } : {});
  const s = summarizeOutcomes(history, now);
  const users = new Set(history.map((h) => h.userId)).size;
  const tables = { overall: [s.overall], byFitBand: s.byFitBand, bySystem: s.bySystem, byRoleFamily: s.byRoleFamily, byResume: s.byResume };

  if (args.includes("--json")) {
    console.log(JSON.stringify({ generatedAt: now.toISOString(), since: since?.toISOString() ?? null, users, minSample: s.minSample, noResponseDays: s.noResponseDays, ...tables }, null, 2));
  } else {
    const pct = (x: number | null) => (x == null ? "  -  " : `${(x * 100).toFixed(1).padStart(5)}%`);
    const line = (g: OutcomeStats) => [
      g.key.padEnd(18), String(g.applications).padStart(6), String(g.settled).padStart(7), String(g.responses).padStart(6), String(g.interviews).padStart(6),
      String(g.rejections).padStart(6), String(g.noResponse).padStart(6), pct(g.responseRate), pct(g.interviewRate), pct(g.rejectionRate),
      (g.medianDaysToFirstReply == null ? "-" : g.medianDaysToFirstReply.toFixed(1)).padStart(7), g.smallSample ? "  small sample" : "",
    ].join(" ");
    const head = `${"group".padEnd(18)} ${"apps".padStart(6)} ${"settled".padStart(7)} ${"resp".padStart(6)} ${"intv".padStart(6)} ${"rej".padStart(6)} ${"silent".padStart(6)} ${"resp%".padStart(6)} ${"intv%".padStart(6)} ${"rej%".padStart(6)} ${"med.d".padStart(7)}`;
    console.log(`Outcomes report, ${now.toISOString().slice(0, 10)}${since ? ` (submitted since ${since.toISOString().slice(0, 10)})` : ""}: ${history.length} submitted applications from ${users} users.`);
    console.log(`Rates are over settled applications (an outcome, or ${s.noResponseDays} days of silence); groups under ${s.minSample} settled show counts only.`);
    for (const [name, rows] of Object.entries(tables)) {
      console.log(`\n${name}\n${head}`);
      for (const g of rows) console.log(line(g));
    }
  }
} finally {
  await handle.close();
}
