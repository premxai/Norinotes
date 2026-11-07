/**
 * "Apply for me" from the command line, against the database in .env.production: list a person's Greenhouse matches,
 * start a batch, and watch it. The same thing the Nori page does, for testing before the page ships.
 *
 *   npx tsx scripts/batch-run.mts --email you@example.com --list            Greenhouse matches, best fit first
 *   npx tsx scripts/batch-run.mts --email you@example.com --start <jobId>…  start a batch (sends for real)
 *   npx tsx scripts/batch-run.mts --email you@example.com --watch <batchId> its applications and run log
 *
 * Reads DATABASE_URL_POOLER (or DATABASE_URL) from the environment or .env.production.
 */
import { existsSync, readFileSync } from "node:fs";
import { and, applications, applyBatches, asc, companies, connect, desc, eq, freshJobSql, inArray, isNull, jobs, runEvents, shortlist, users } from "@norinote/db";
import { batchView, startBatch } from "@norinote/apply";
import { JOBS, createQueue } from "@norinote/queue";

const args = process.argv.slice(2);
const value = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const rest = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.slice(i + 1).filter((a) => !a.startsWith("--")) : []; };
const fileEnv: Record<string, string> = existsSync(".env.production")
  ? Object.fromEntries(readFileSync(".env.production", "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]))
  : {};
const env = (name: string) => process.env[name]?.trim() || fileEnv[name];

const email = value("email")?.trim().toLowerCase();
const url = env("DATABASE_URL_POOLER") || env("DATABASE_URL");
if (!email || !url) { console.error("Needs --email and DATABASE_URL_POOLER (or DATABASE_URL)."); process.exit(2); }

const handle = await connect({ url });
const { db } = handle;
try {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new Error(`No Norinote account for ${email}`);

  if (args.includes("--list")) {
    const rows = await db.select({ jobId: jobs.id, title: jobs.title, company: companies.name, fit: shortlist.fit, location: jobs.location, applyUrl: jobs.applyUrl })
      .from(shortlist).innerJoin(jobs, eq(jobs.id, shortlist.jobId)).innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(and(eq(shortlist.userId, user.id), eq(shortlist.status, "new"), eq(jobs.atsType, "greenhouse"), isNull(jobs.closedAt), eq(companies.blocked, false), freshJobSql(new Date())))
      .orderBy(desc(shortlist.fit)).limit(15);
    const sent = new Set((await db.select({ jobId: applications.jobId }).from(applications).where(eq(applications.userId, user.id))).map((a) => a.jobId));
    for (const r of rows) console.log(`${r.jobId}  ${Math.round(r.fit * 100)}%  ${r.company} | ${r.title} | ${r.location ?? ""}${sent.has(r.jobId) ? "  (already has an application)" : ""}`);
  } else if (args.includes("--start")) {
    const jobIds = rest("start");
    const res = await startBatch(db, user.id, jobIds, { atsTypes: ["greenhouse"] });
    console.log(JSON.stringify({ batchId: res.batchId, added: res.added, skipped: res.skipped }, null, 2));
    const created = res.added.filter((a) => a.created);
    if (created.length) {
      const queue = createQueue(url);
      await queue.start();
      for (const a of created) await queue.enqueue(JOBS.prepareApplication, { applicationId: a.applicationId });
      await queue.stop();
      console.log(`Queued preparation for ${created.length} application(s).`);
    }
  } else if (args.includes("--watch")) {
    const batchId = value("watch")!;
    const [batch] = await db.select().from(applyBatches).where(and(eq(applyBatches.id, batchId), eq(applyBatches.userId, user.id))).limit(1);
    if (!batch) throw new Error("Batch not found");
    const view = await batchView(db, batch, new Date());
    console.log(`Batch ${batch.status}: ${JSON.stringify(view.counts)}  waitingFor=${view.waitingFor ?? "-"}  nextAt=${view.nextAt ?? "-"}`);
    const apps = await db.select({ id: applications.id, status: applications.status, error: applications.error, company: companies.name, title: jobs.title })
      .from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId)).innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(eq(applications.batchId, batchId)).orderBy(asc(applications.createdAt));
    for (const a of apps) {
      console.log(`\n${a.company} | ${a.title}: ${a.status}${a.error ? ` (${a.error})` : ""}`);
      const events = await db.select({ at: runEvents.ts, message: runEvents.message }).from(runEvents)
        .where(inArray(runEvents.applicationId, [a.id])).orderBy(desc(runEvents.ts)).limit(6);
      for (const e of events.reverse()) console.log(`  ${e.at.toISOString().slice(11, 19)}  ${e.message}`);
    }
  } else {
    console.error("Pass --list, --start <jobId>… or --watch <batchId>.");
    process.exitCode = 2;
  }
} finally {
  await handle.close();
}
