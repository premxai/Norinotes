import { Hono } from "hono";
import { and, applications, careerPoints, companies, desc, eq, freshJobSql, inArray, isNull, jobs, profiles, shortlist, sql } from "@norinote/db";
import { z } from "zod";
import { SkipReason, companyKey, isSkippedCompany, readSkipCompanies } from "@norinote/shared";
import {
  MATCHER_SKIP_REASONS, WIDENED_BY, clearSkipEffect, loadSkipEffects, shortlistReading, widenedByOf, withoutWidenedReasons, type WidenedBy,
} from "@norinote/match";
import { JOBS } from "@norinote/queue";
import { requireUser } from "../auth/session.js";
import { intParam, notFound, parseBody, uuidParam } from "../http.js";
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
   * Visible rows (new, open, posted in the last 7 days, company not blocked): the jobs the lanes fit first, then the
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

  /** The person's companies to skip, as keys. */
  const skipKeys = async (userId: string) => {
    const [p] = await db.select({ preferences: profiles.preferences }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
    return new Set(readSkipCompanies(p?.preferences).map(companyKey));
  };

  /** One entry per company and role: keep the best-fitting posting, list the other cities. */
  async function loadEntries(userId: string, limit: number): Promise<Entry[]> {
    // Read extra rows: the same role posted in several cities collapses into one entry.
    const skip = await skipKeys(userId);
    const rows = (await loadRows(userId, limit * 4)).filter((r) => !isSkippedCompany(skip, r.companyName));
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
   * how many fit the lanes as written, whether the role-family pool contributed, and whether most of it was read without
   * the AI (`reading: "basic"`).
   */
  r.get("/meta", auth, async (c) => {
    const userId = c.get("user").id;
    const entries = await loadEntries(userId, 200);
    const used = new Set(entries.flatMap((e) => (e.widenedBy ? [e.widenedBy] : [])));
    return c.json({
      total: entries.length,
      widened: WIDENED_BY.filter((w) => used.has(w)),
      lanesMatched: entries.filter((e) => e.widenedBy === null).length,
      poolUsed: used.has("role_pool"),
      reading: await shortlistReading(db, userId, entries.map((e) => e.row.jobId)),
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
    const jobId = uuidParam(c, "jobId");
    const { reason } = await parseBody(c, Dismiss);
    return c.json({ ok: true, ...await dismissShortlistJob(ctx, c.get("user").id, jobId, reason ?? null) });
  });

  /** What the person's skip reasons currently change in their matches (see skip-feedback.ts in @norinote/match). */
  r.get("/skip-effects", auth, async (c) => {
    const effects = await loadSkipEffects(db, c.get("user").id, ctx.now());
    return c.json(effects.map(({ id, kind, reason, label, skips, delta }) => ({ id, kind, reason, label, skips, delta })));
  });

  /** Undo one effect: the skips behind it stop counting, and the shortlist is matched again. */
  r.delete("/skip-effects/:id", auth, async (c) => {
    const userId = c.get("user").id;
    if (!await clearSkipEffect(db, userId, c.req.param("id"), ctx.now())) throw notFound("That effect is not active");
    await enqueueSoft(ctx, JOBS.matchUser, { userId, reason: "profile" });
    return c.json({ ok: true });
  });

  return r;
}

const Dismiss = z.object({ reason: SkipReason.nullable().optional() });

/**
 * Skip a job (the web's dismiss, or Telegram's Skip), with an optional reason. Its postings in other cities go too. 404
 * when it is not on the list. A reason given for a job already skipped is recorded on it (a second step after Skip).
 * "Company I don't want" adds the company to the skip list; a reason that feeds the matcher queues a new match when it
 * makes an effect active, so the list reflects it.
 */
export async function dismissShortlistJob(ctx: Ctx, userId: string, jobId: string, reason: SkipReason | null = null): Promise<{ reason: SkipReason | null; addedToSkipList: boolean }> {
  const { db } = ctx;
  const now = ctx.now();
  const done = await db.update(shortlist).set({ status: "dismissed", dismissedAt: now, skipReason: reason })
    .where(and(eq(shortlist.userId, userId), eq(shortlist.jobId, jobId), eq(shortlist.status, "new"))).returning({ id: shortlist.id });
  if (done.length > 0) {
    // Dismissing a role dismisses its postings in other cities too, so the same role does not come straight back.
    const [job] = await db.select({ title: jobs.title, companyId: jobs.companyId }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (job?.companyId) {
      const siblings = await db.select({ id: jobs.id, title: jobs.title }).from(jobs).where(and(eq(jobs.companyId, job.companyId), isNull(jobs.closedAt)));
      const ids = siblings.filter((s) => s.id !== jobId && normTitle(s.title) === normTitle(job.title)).map((s) => s.id);
      if (ids.length) {
        await db.update(shortlist).set({ status: "dismissed", dismissedAt: now })
          .where(and(eq(shortlist.userId, userId), eq(shortlist.status, "new"), inArray(shortlist.jobId, ids)));
      }
    }
  } else {
    // Not on the list at all: 404. Applied: nothing to do. Already dismissed: record the reason, if one came.
    const [row] = await db.select({ id: shortlist.id, status: shortlist.status, dismissedAt: shortlist.dismissedAt }).from(shortlist)
      .where(and(eq(shortlist.userId, userId), eq(shortlist.jobId, jobId))).limit(1);
    if (!row) throw notFound("That job is not on your shortlist");
    if (row.status !== "dismissed" || !reason) return { reason: null, addedToSkipList: false };
    await db.update(shortlist).set({ skipReason: reason, dismissedAt: row.dismissedAt ?? now }).where(eq(shortlist.id, row.id));
  }
  if (!reason) return { reason: null, addedToSkipList: false };
  const addedToSkipList = reason === "company" && await addSkipCompany(ctx, userId, jobId);
  if ((MATCHER_SKIP_REASONS as readonly SkipReason[]).includes(reason) && (await loadSkipEffects(db, userId, now)).some((e) => e.reason === reason)) {
    await enqueueSoft(ctx, JOBS.matchUser, { userId, reason: "profile" }, { dedupeKey: `skip-feedback:${userId}`, dedupeSeconds: 60 });
  }
  return { reason, addedToSkipList };
}

/** Adds the job's company to the one skip list (`preferences.excludeCompanies`). False when it was already there. */
async function addSkipCompany(ctx: Ctx, userId: string, jobId: string): Promise<boolean> {
  const { db } = ctx;
  const [job] = await db.select({ name: companies.name }).from(jobs).innerJoin(companies, eq(companies.id, jobs.companyId)).where(eq(jobs.id, jobId)).limit(1);
  const [p] = await db.select({ preferences: profiles.preferences }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const current = readSkipCompanies(p?.preferences);
  if (!job?.name || !companyKey(job.name) || current.some((n) => companyKey(n) === companyKey(job.name))) return false;
  await db.update(profiles)
    .set({ preferences: sql`jsonb_set(coalesce(${profiles.preferences}, '{}'::jsonb), '{excludeCompanies}', ${JSON.stringify([...current, job.name])}::jsonb, true)` })
    .where(eq(profiles.userId, userId));
  return true;
}

const WIDENED_LIKE = "widened:%";
const normTitle = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const roleKey = (company: string, title: string) => `${company.toLowerCase().trim()}|${normTitle(title)}`;
