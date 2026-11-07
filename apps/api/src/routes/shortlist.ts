import { Hono } from "hono";
import { and, applications, careerPoints, companies, desc, eq, freshJobSql, inArray, isNull, jobs, shortlist, sql } from "@norinote/db";
import { WIDENED_BY, widenedByOf, withoutWidenedReasons, type WidenedBy } from "@norinote/match";
import { JOBS } from "@norinote/queue";
import { requireUser } from "../auth/session.js";
import { intParam, notFound, uuidParam } from "../http.js";
import { brandfetchLogo, companyLogoDomain } from "../serialize.js";
import { enqueueSoft, type AppEnv, type Ctx } from "../types.js";

export function shortlistRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db } = ctx;
  const logo = brandfetchLogo(ctx.config.brandfetchClientId);

  type Entry = { row: Row; locations: string[]; widenedBy: WidenedBy | null };
  type Row = Awaited<ReturnType<typeof loadRows>>[number];

  /**
   * Visible rows (new, open, posted in the last 72 hours, company not blocked): the jobs the lanes fit first, then the
   * widened ones, each best fit first.
   */
  const loadRows = (userId: string, take: number) => db.select({
    id: shortlist.id, jobId: shortlist.jobId, fit: shortlist.fit, reasons: shortlist.reasons, status: shortlist.status, createdAt: shortlist.createdAt,
    jobTitle: jobs.title, location: jobs.location, remote: jobs.remote, applyUrl: jobs.applyUrl, atsType: jobs.atsType, postedAt: jobs.postedAt, companyName: companies.name,
    logoDomain: companyLogoDomain,
  }).from(shortlist)
    .innerJoin(jobs, eq(jobs.id, shortlist.jobId))
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(eq(shortlist.userId, userId), eq(shortlist.status, "new"), isNull(jobs.closedAt), eq(companies.blocked, false), freshJobSql(ctx.now())))
    .orderBy(sql`(EXISTS (SELECT 1 FROM unnest(${shortlist.reasons}) AS r WHERE r LIKE ${WIDENED_LIKE})) asc`, desc(shortlist.fit), desc(shortlist.createdAt)).limit(take);

  /** One entry per company and role: keep the best-fitting posting, list the other cities. */
  async function loadEntries(userId: string, limit: number): Promise<Entry[]> {
    // Read extra rows: the same role posted in several cities collapses into one entry.
    const rows = await loadRows(userId, limit * 4);
    if (rows.length === 0) await queueFirstRun(userId);
    const groups = new Map<string, Entry>();
    for (const s of rows) {
      const key = roleKey(s.companyName, s.jobTitle);
      const g = groups.get(key);
      if (!g) groups.set(key, { row: s, locations: s.location ? [s.location] : [], widenedBy: widenedByOf(s.reasons) });
      else if (s.location && !g.locations.includes(s.location)) g.locations.push(s.location);
    }
    return [...groups.values()].slice(0, limit);
  }

  r.get("/", auth, async (c) => {
    const limit = intParam(c.req.query("limit"), 50, 1, 200);
    const entries = await loadEntries(c.get("user").id, limit);
    return c.json(entries.map(({ row: s, locations, widenedBy }) => ({
      id: s.id, jobId: s.jobId, fit: s.fit, reasons: withoutWidenedReasons(s.reasons), status: s.status, createdAt: s.createdAt.toISOString(),
      // Set when the job is here because the lanes were widened ("Showing similar roles while we look for more").
      widenedBy,
      locations: Math.max(1, locations.length), locationNames: locations.slice(0, 8),
      job: { id: s.jobId, companyName: s.companyName, companyLogoUrl: logo(s.logoDomain), title: s.jobTitle, location: s.location, remote: s.remote, applyUrl: s.applyUrl, atsType: s.atsType, postedAt: s.postedAt ? s.postedAt.toISOString() : null },
    })));
  });

  /**
   * What the list above is made of, for the banner: how many roles, which widening steps were used (in ladder order),
   * how many fit the lanes as written, and whether the role-family pool contributed.
   */
  r.get("/meta", auth, async (c) => {
    const entries = await loadEntries(c.get("user").id, 200);
    const used = new Set(entries.flatMap((e) => (e.widenedBy ? [e.widenedBy] : [])));
    return c.json({
      total: entries.length,
      widened: WIDENED_BY.filter((w) => used.has(w)),
      lanesMatched: entries.filter((e) => e.widenedBy === null).length,
      poolUsed: used.has("role_pool"),
    });
  });

  /** A user with career points but no shortlist rows at all has never been matched: queue one run (deduplicated). */
  async function queueFirstRun(userId: string): Promise<void> {
    const [any] = await db.select({ id: shortlist.id }).from(shortlist).where(eq(shortlist.userId, userId)).limit(1);
    if (any) return;
    const [apps] = await db.select({ id: applications.id }).from(applications).where(eq(applications.userId, userId)).limit(1);
    if (apps) return;
    const [points] = await db.select({ n: sql<number>`count(*)::int` }).from(careerPoints).where(eq(careerPoints.userId, userId));
    if ((points?.n ?? 0) === 0) return;
    await enqueueSoft(ctx, JOBS.matchUser, { userId, reason: "manual" }, { dedupeKey: `first-shortlist:${userId}`, dedupeSeconds: 300 });
  }

  r.post("/:jobId/dismiss", auth, async (c) => {
    await dismissShortlistJob(ctx, c.get("user").id, uuidParam(c, "jobId"));
    return c.json({ ok: true });
  });

  return r;
}

/** Skip a job (the web's dismiss, or Telegram's Skip). Its postings in other cities go too. 404 when it is not on the list. */
export async function dismissShortlistJob(ctx: Ctx, userId: string, jobId: string): Promise<void> {
  const { db } = ctx;
  const done = await db.update(shortlist).set({ status: "dismissed" })
    .where(and(eq(shortlist.userId, userId), eq(shortlist.jobId, jobId), eq(shortlist.status, "new"))).returning({ id: shortlist.id });
  if (done.length > 0) {
    // Dismissing a role dismisses its postings in other cities too, so the same role does not come straight back.
    const [job] = await db.select({ title: jobs.title, companyId: jobs.companyId }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (job?.companyId) {
      const siblings = await db.select({ id: jobs.id, title: jobs.title }).from(jobs).where(and(eq(jobs.companyId, job.companyId), isNull(jobs.closedAt)));
      const ids = siblings.filter((s) => s.id !== jobId && normTitle(s.title) === normTitle(job.title)).map((s) => s.id);
      if (ids.length) {
        await db.update(shortlist).set({ status: "dismissed" })
          .where(and(eq(shortlist.userId, userId), eq(shortlist.status, "new"), inArray(shortlist.jobId, ids)));
      }
    }
  }
  if (done.length === 0) {
    // Already dismissed or applied: nothing to do. Not on the list at all: 404.
    const [row] = await db.select({ id: shortlist.id }).from(shortlist).where(and(eq(shortlist.userId, userId), eq(shortlist.jobId, jobId))).limit(1);
    if (!row) throw notFound("That job is not on your shortlist");
  }
}

const WIDENED_LIKE = "widened:%";
const normTitle = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const roleKey = (company: string, title: string) => `${company.toLowerCase().trim()}|${normTitle(title)}`;
