/**
 * Why does a person see so few matches? Runs the same full match the worker runs (buildShortlist) for one person against
 * the database in .env.production, inside a transaction that is always rolled back, and prints where jobs dropped out:
 * how many fit their places, how many were ranked (by embedding or by skill overlap), gated, below their minimum fit,
 * and kept. Writes nothing.
 *
 *   npx tsx scripts/match-diagnose.mts --user <user id prefix>
 */
import { existsSync, readFileSync } from "node:fs";
import { and, careerPoints, companies, connect, eq, freshJobSql, inArray, isNull, jobs, lanes, sql, users } from "@norinote/db";
import { profileEmbedding } from "@norinote/graph";
import { buildShortlist, engineJobSql, laneFitsSql } from "@norinote/match";
import { locationFitsSql } from "../packages/match/src/lanes.js";

const args = process.argv.slice(2);
const value = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const fileEnv: Record<string, string> = existsSync(".env.production")
  ? Object.fromEntries(readFileSync(".env.production", "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]))
  : {};
const env = (name: string) => process.env[name]?.trim() || fileEnv[name];
const url = env("DATABASE_URL_POOLER") || env("DATABASE_URL");
const prefix = value("user");
if (!url || !prefix) { console.error("Needs --user <id prefix> and DATABASE_URL_POOLER (or DATABASE_URL)."); process.exit(2); }
const engineAts = (process.env.ENGINE_ATS ?? "greenhouse").split(",").map((s) => s.trim()).filter(Boolean);

class Rollback extends Error {}
const handle = await connect({ url });
try {
  const [user] = await handle.db.select({ id: users.id }).from(users).where(sql`${users.id}::text LIKE ${prefix + "%"}`).limit(1);
  if (!user) throw new Error(`No user with id starting ${prefix}`);
  const now = new Date();
  const vector = await profileEmbedding(handle.db, user.id, now);
  console.log(`profile embedding: ${vector ? "yes" : "none"}`);
  const myLanes = await handle.db.select({ titles: lanes.titles, locations: lanes.locations, remote: lanes.remote, minFit: lanes.minFit }).from(lanes).where(and(eq(lanes.userId, user.id), eq(lanes.enabled, true)));
  console.log("roles:", JSON.stringify(myLanes));
  const pool = async (fit: ReturnType<typeof sql>) => (await handle.db.select({ n: sql<number>`count(DISTINCT ${jobs.id})::int` }).from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId)).innerJoin(lanes, and(eq(lanes.userId, user.id), eq(lanes.enabled, true)))
    .where(and(isNull(jobs.closedAt), eq(companies.blocked, false), freshJobSql(now), engineJobSql(engineAts), fit)))[0]!.n;
  console.log(`fresh engine jobs in their places: ${await pool(locationFitsSql())}; of those whose title fits a role: ${await pool(laneFitsSql())}`);
  const near = sql`${jobs.title} ~* '(machine learning|\mml\M|\mai\M|llm|applied scien|research (engineer|scientist)|data scien|genai|generative)'`;
  const eng = sql`${jobs.title} ~* '(engineer|developer|scientist)'`;
  console.log(`  ...AI/ML-ish titles: ${await pool(and(locationFitsSql(), near) as never)}; any engineer/scientist title: ${await pool(and(locationFitsSql(), eng) as never)}`);
  await handle.db.transaction(async (tx) => {
    const stats = await buildShortlist(tx as never, user.id, { now, profileEmbedding: vector, limit: 20, engineAts, widen: false });
    console.log({
      considered: stats.considered, lexical: stats.lexical, withoutSpec: stats.withoutSpec, scored: stats.scored,
      gated: stats.gated.length, belowMinFit: stats.belowMinFit, saved: stats.saved, temporaryLane: stats.temporaryLane,
    });
    const reasons = new Map<string, number>();
    for (const g of stats.gated) for (const r of g.reasons) reasons.set(r, (reasons.get(r) ?? 0) + 1);
    console.log("gate reasons:", Object.fromEntries([...reasons].sort((a, b) => b[1] - a[1]).slice(0, 10)));
    const yearsGated = stats.gated.filter((g) => g.reasons.some((r) => r.includes("years of experience"))).slice(0, 15);
    if (yearsGated.length) {
      const titles = await tx.select({ id: jobs.id, title: jobs.title }).from(jobs).where(inArray(jobs.id, yearsGated.map((g) => g.jobId)));
      const byId = new Map(titles.map((t) => [t.id, t.title]));
      console.log("years-gated examples:");
      for (const g of yearsGated) console.log(`  ${byId.get(g.jobId)}: ${g.reasons.find((r) => r.includes("years"))}`);
    }
    const roles = await tx.select({ title: careerPoints.title, start: careerPoints.startDate, end: careerPoints.endDate, kind: careerPoints.kind }).from(careerPoints).where(eq(careerPoints.userId, user.id));
    console.log("dated roles/projects:", roles.filter((r) => r.kind === "role" || r.kind === "project").map((r) => `${r.kind}:${r.title} ${r.start ?? "?"}..${r.end ?? "now"}`).join(" | "));
    console.log("kept:", stats.items.slice(0, 20).map((i) => `${Math.round(i.fit * 100)}% ${i.jobId.slice(0, 8)}`).join(", "));
    throw new Rollback();
  }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
} finally {
  await handle.close();
}
