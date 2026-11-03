import { and, applications, companies, desc, eq, freshJobSql, inArray, isNotNull, isNull, jobs, lanes, ne, or, queryRows, savedJobs, shortlist, sql, type Db } from "@norinote/db";
import { inlineLanesFitSql, laneFitsSql, loadTemporaryLane, needsUsCitizenshipOrClearance } from "@norinote/match";
import type { SQL } from "drizzle-orm";
import { toJob, toMatch } from "./serialize.js";

const LIST_DESCRIPTION_CHARS = 1200;
/** The most rows one list request reads while it filters and groups. */
const MAX_SCAN = 2400;

export type JobListParams = {
  view: "best" | "new" | "today";
  sort: "best" | "new";
  lanes: boolean;
  /** Posted within this many hours, at most 72. */
  maxAgeHours: number;
  clearance: "hide" | "show";
  limit: number;
  q?: string;
  minScore?: number;
  status: "open" | "all";
  group: boolean;
};

/** The user added this job by pasting its link (`since`: only links added since then). */
const savedByUser = (userId: string, since?: Date) =>
  sql`EXISTS (SELECT 1 FROM ${savedJobs} WHERE ${savedJobs.userId} = ${userId} AND ${savedJobs.jobId} = ${jobs.id}${since ? sql` AND ${savedJobs.createdAt} >= ${since.toISOString()}::timestamptz` : sql``})`;

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/** Does one of the user's enabled lanes fit this job? */
const laneExists = (userId: string) => sql`EXISTS (SELECT 1 FROM ${lanes} WHERE ${lanes.userId} = ${userId} AND ${lanes.enabled} AND ${laneFitsSql()})`;

/**
 * What "fits the user's lanes" means for this user: their enabled lanes, else a temporary lane from their latest role and
 * location (so a new user's Best match is not the whole index), else nothing to filter by.
 */
async function laneCondition(db: Db, userId: string, now: Date): Promise<SQL | undefined> {
  if (await hasEnabledLanes(db, userId)) return laneExists(userId);
  const temporary = await loadTemporaryLane(db, userId, now);
  return temporary ? inlineLanesFitSql([temporary]) : undefined;
}

export async function hasEnabledLanes(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.select({ id: lanes.id }).from(lanes).where(and(eq(lanes.userId, userId), eq(lanes.enabled, true))).limit(1);
  return !!row;
}

const columns = (description: SQL<string> | typeof jobs.descriptionText) => ({
  id: jobs.id, companyId: jobs.companyId, atsType: jobs.atsType, externalId: jobs.externalId, title: jobs.title, location: jobs.location,
  remote: jobs.remote, descriptionText: description, applyUrl: jobs.applyUrl, postedAt: jobs.postedAt, firstSeenAt: jobs.firstSeenAt,
  lastSeenAt: jobs.lastSeenAt, closedAt: jobs.closedAt, dedupeKey: jobs.dedupeKey, companyName: companies.name,
  fit: shortlist.fit, fitMap: shortlist.fitMap, reasons: shortlist.reasons, matchAt: shortlist.createdAt, appStatus: applications.status,
});

export type JobListItem = {
  job: ReturnType<typeof toJob>;
  match: ReturnType<typeof toMatch> | null;
  applicationStatus: string | null;
  locations?: number;
  locationNames?: string[];
};

/**
 * The jobs list for one user: open jobs from the shared index (one indexed scan, newest or best-fit first), joined with the
 * user's shortlist fit and application state. Filters that SQL cannot express (the US-citizenship / clearance detector) and
 * grouping by company and title run on pages of rows until `limit` results are found. Jobs the user added by link always
 * belong, whatever their age or lane fit (in New today: links added in the last 24 hours).
 */
export async function listJobs(db: Db, userId: string, p: JobListParams, now: Date): Promise<JobListItem[]> {
  const today = p.view === "today";
  const saved = savedByUser(userId, today ? new Date(now.getTime() - 24 * 3_600_000) : undefined);
  const conds: (SQL | undefined)[] = [eq(companies.blocked, false), or(freshJobSql(now, today ? Math.min(24, p.maxAgeHours) : p.maxAgeHours), saved)];
  if (p.status === "open") conds.push(isNull(jobs.closedAt));
  if (p.view === "best") conds.push(or(isNull(shortlist.status), ne(shortlist.status, "dismissed")));
  if (p.lanes) {
    const fits = await laneCondition(db, userId, now);
    // Jobs on the user's own shortlist (including ones added by widening) always belong to Best match.
    if (fits) conds.push(p.view === "best" ? or(fits, and(isNotNull(shortlist.id), eq(shortlist.status, "new")), saved) : or(fits, saved));
  }
  if (p.q) conds.push(sql`(${jobs.title} ilike ${likePattern(p.q)} or ${companies.name} ilike ${likePattern(p.q)})`);
  if (p.minScore !== undefined) conds.push(sql`${shortlist.fit} >= ${p.minScore}`);

  const order = p.sort === "best"
    ? [sql`${shortlist.fit} desc nulls last`, sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt}) desc`, jobs.id]
    : [desc(sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt})`), jobs.id];

  const needFullText = p.clearance === "hide";
  const select = columns(needFullText ? jobs.descriptionText : sql<string>`left(${jobs.descriptionText}, ${LIST_DESCRIPTION_CHARS})`);
  const pageSize = needFullText || p.group ? Math.min(300, Math.max(60, p.limit * 3)) : p.limit;

  const picked = new Map<string, Awaited<ReturnType<typeof fetchPage>>[number]>();
  const fetchPage = (offset: number) => db.select(select).from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(shortlist, and(eq(shortlist.jobId, jobs.id), eq(shortlist.userId, userId)))
    .leftJoin(applications, and(eq(applications.jobId, jobs.id), eq(applications.userId, userId)))
    .where(and(...conds)).orderBy(...order).limit(pageSize).offset(offset);

  for (let offset = 0; offset < MAX_SCAN && picked.size < p.limit; offset += pageSize) {
    const page = await fetchPage(offset);
    for (const row of page) {
      if (picked.size >= p.limit) break;
      if (needFullText && needsUsCitizenshipOrClearance({ title: row.title, descriptionText: row.descriptionText })) continue;
      const key = p.group ? `${row.companyId}|${row.title.trim().toLowerCase()}` : row.id;
      if (!picked.has(key)) picked.set(key, row);
    }
    if (page.length < pageSize) break;
  }

  const rows = [...picked.entries()];
  const places = p.group ? await postingPlaces(db, rows.map(([, r]) => r.companyId), now, p) : null;
  return rows.map(([key, row]): JobListItem => {
    const description = needFullText ? row.descriptionText.slice(0, LIST_DESCRIPTION_CHARS) : row.descriptionText;
    const item: JobListItem = {
      job: toJob({ ...row, descriptionText: description }, row.companyName),
      match: row.fit === null ? null : toMatch(row.id, { fit: row.fit, fitMap: row.fitMap ?? [], reasons: row.reasons ?? [], createdAt: row.matchAt ?? now }),
      applicationStatus: row.appStatus,
    };
    const here = places?.get(key);
    if (here) { item.locations = here.count; item.locationNames = here.names; }
    return item;
  });
}

/** For each (company, title) group: how many postings are open and where (up to 8 names). One query over the groups' companies. */
async function postingPlaces(db: Db, companyIds: string[], now: Date, p: JobListParams): Promise<Map<string, { count: number; names: string[] }>> {
  const out = new Map<string, { count: number; names: string[] }>();
  if (companyIds.length === 0) return out;
  const rows = await db.select({ companyId: jobs.companyId, title: jobs.title, location: jobs.location }).from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(inArray(jobs.companyId, [...new Set(companyIds)]), isNull(jobs.closedAt), freshJobSql(now, p.maxAgeHours)));
  for (const r of rows) {
    const key = `${r.companyId}|${r.title.trim().toLowerCase()}`;
    const e = out.get(key) ?? { count: 0, names: [] };
    e.count += 1;
    if (r.location && !e.names.includes(r.location) && e.names.length < 8) e.names.push(r.location);
    out.set(key, e);
  }
  return out;
}

/** Counts over open jobs posted in the last 72 hours: all of them, the last 24 hours, and those that fit the user's lanes. */
export async function jobsSummary(db: Db, userId: string, now: Date) {
  const hasLanes = await hasEnabledLanes(db, userId);
  const fitsCondition = hasLanes ? laneExists(userId) : await laneCondition(db, userId, now);
  const [row] = await queryRows<{ open: number; today: number; fits: number }>(db, sql`
    SELECT count(*)::int AS open,
      (count(*) FILTER (WHERE ${freshJobSql(now, 24)}))::int AS today,
      ${fitsCondition ? sql`(count(*) FILTER (WHERE ${fitsCondition}))::int` : sql`0`} AS fits
    FROM ${jobs} INNER JOIN ${companies} ON ${companies.id} = ${jobs.companyId}
    WHERE ${jobs.closedAt} IS NULL AND ${companies.blocked} = false AND ${freshJobSql(now)}`);
  return { open: row?.open ?? 0, newToday: row?.today ?? 0, fitsLanes: row?.fits ?? 0, hasLanes };
}
