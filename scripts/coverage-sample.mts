/**
 * Live coverage check: validate a random sample of candidate companies per job system against their real public feeds
 * and report how many are live and how many open jobs they carry. Read-only towards the job systems (one board read per
 * company, our User-Agent, per-system concurrency limits). Writes only to the local database it is pointed at.
 *
 *   npx tsx scripts/coverage-sample.mts [--per 20] [--only workday,lever] [--concurrency 4]
 */
import path from "node:path";
import { connect, migrate, companies, jobs, and, eq, isNull, sql } from "@norinote/db";
import type { AtsType } from "@norinote/shared";
import { getConnector, isSupportedAts, pollBoard } from "@norinote/ingest";

const args = process.argv.slice(2);
const value = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const per = Number(value("per") ?? 20);
const only = value("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const defaultConcurrency = Number(value("concurrency") ?? 4);

const handle = await connect({ url: process.env.DATABASE_URL?.trim() || undefined, pgliteDir: process.env.PGLITE_DIR || path.resolve("data/pglite") });
await migrate(handle);
const db = handle.db;

const systems = (await db.selectDistinct({ ats: companies.atsType }).from(companies)).map((r) => r.ats as AtsType)
  .filter((a) => isSupportedAts(a) && (!only || only.includes(a)));

type Row = { system: string; sampled: number; live: number; empty: number; dead: number; blocked: number; errors: number; jobs: number; incomplete: number; ms: number };
const report: Row[] = [];

for (const system of systems) {
  const sample = await db.select({ token: companies.atsToken }).from(companies)
    .where(and(eq(companies.atsType, system), eq(companies.status, "candidate"), eq(companies.blocked, false)))
    .orderBy(sql`random()`).limit(per);
  const limit = Math.max(1, Math.min(defaultConcurrency, getConnector(system).capabilities?.maxConcurrencyPerHost ?? defaultConcurrency));
  const row: Row = { system, sampled: sample.length, live: 0, empty: 0, dead: 0, blocked: 0, errors: 0, jobs: 0, incomplete: 0, ms: 0 };
  const started = Date.now();
  let next = 0;
  const work = async () => {
    while (next < sample.length) {
      const { token } = sample[next++]!;
      try {
        const r = await pollBoard(db, { atsType: system, token });
        const status = (await db.select({ s: companies.status }).from(companies)
          .where(and(eq(companies.atsType, system), eq(companies.atsToken, token))).limit(1))[0]?.s;
        if (status === "dead") row.dead++;
        else if (status === "disabled") row.blocked++;
        else if (r.total > 0) { row.live++; row.jobs += r.total; }
        else row.empty++;
        if ((r as { complete?: boolean }).complete === false) row.incomplete++;
      } catch {
        row.errors++;
      }
    }
  };
  await Promise.all(Array.from({ length: limit }, work));
  row.ms = Date.now() - started;
  report.push(row);
  console.log(JSON.stringify(row));
}

const [{ open }] = await db.select({ open: sql<number>`count(*)::int` }).from(jobs).where(isNull(jobs.closedAt));
const totals = await db.select({ ats: companies.atsType, n: sql<number>`count(*)::int` }).from(companies).groupBy(companies.atsType);
console.log("\nsystem          sampled  live empty dead blocked err  jobs  jobs/live  candidates  est.jobs");
for (const r of report) {
  const cand = totals.find((t) => t.ats === r.system)?.n ?? 0;
  const perLive = r.live ? r.jobs / r.live : 0;
  const liveRate = r.sampled ? r.live / r.sampled : 0;
  const est = Math.round(cand * liveRate * perLive);
  console.log(`${r.system.padEnd(15)} ${String(r.sampled).padStart(7)} ${String(r.live).padStart(5)} ${String(r.empty).padStart(5)} ${String(r.dead).padStart(4)} ${String(r.blocked).padStart(7)} ${String(r.errors).padStart(3)} ${String(r.jobs).padStart(5)} ${perLive.toFixed(1).padStart(10)} ${String(cand).padStart(11)} ${String(est).padStart(9)}`);
}
console.log(`\nopen jobs collected in this sample: ${open}`);
await handle.close();
