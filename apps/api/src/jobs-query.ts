import { and, applications, companies, desc, eq, freshJobSql, inArray, isNotNull, isNull, jobBookmarks, jobs, lanes, ne, or, queryRows, savedJobs, shortlist, sql, type Db } from "@norinote/db";
import { inlineLanesFitSql, laneFitsSql, loadTemporaryLane, needsUsCitizenshipOrClearance } from "@norinote/match";
import type { SQL } from "drizzle-orm";
import { PAY_SQL_PATTERN } from "./listing-facts.js";
import { companyLogoDomain, toJob, toMatch, type LogoUrl } from "./serialize.js";

const LIST_DESCRIPTION_CHARS = 1200;
/** The most rows one list request reads while it filters and groups. */
const MAX_SCAN = 2400;

export type JobListParams = {
  /**
   * `saved`: the user's bookmarked jobs, newest saved first; `applied`: jobs with an application of theirs, newest
   * application first. Both whatever the job's age or lane fit, open or closed.
   */
  view: "best" | "new" | "today" | "saved" | "applied";
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
  /** Location contains this text (case-insensitive). */
  location?: string;
  /** Remote jobs only. */
  remote?: boolean;
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
  logoDomain: companyLogoDomain, savedAt: jobBookmarks.createdAt, fit: shortlist.fit, fitMap: shortlist.fitMap, reasons: shortlist.reasons, matchAt: shortlist.createdAt, appStatus: applications.status,
});

export type JobListItem = {
  job: ReturnType<typeof toJob>;
  match: ReturnType<typeof toMatch> | null;
  applicationStatus: string | null;
  /** The user saved this job (the Save button). */
  saved: boolean;
  locations?: number;
  locationNames?: string[];
};

/**
 * The jobs list for one user: open jobs from the shared index (one indexed scan, newest or best-fit first), joined with the
 * user's shortlist fit and application state. Filters that SQL cannot express (the US-citizenship / clearance detector) and
 * grouping by company and title run on pages of rows until `limit` results are found. Jobs the user added by link always
 * belong, whatever their age or lane fit (in New today: links added in the last 24 hours).
 */
export async function listJobs(db: Db, userId: string, p: JobListParams, now: Date, logo: LogoUrl = () => null): Promise<JobListItem[]> {
  const today = p.view === "today";
  const bookmarks = p.view === "saved";
  const applied = p.view === "applied";
  const ownList = bookmarks || applied;
  const saved = savedByUser(userId, today ? new Date(now.getTime() - 24 * 3_600_000) : undefined);
  const conds: (SQL | undefined)[] = [eq(companies.blocked, false)];
  // Saved: every bookmarked job, open or closed, whatever its age (job.closedAt says when one closed).
  if (bookmarks) conds.push(isNotNull(jobBookmarks.createdAt));
  else if (applied) conds.push(isNotNull(applications.id));
  else conds.push(or(freshJobSql(now, today ? Math.min(24, p.maxAgeHours) : p.maxAgeHours), saved));
  if (p.status === "open" && !ownList) conds.push(isNull(jobs.closedAt));
  if (p.view === "best") conds.push(or(isNull(shortlist.status), ne(shortlist.status, "dismissed")));
  if (p.location) conds.push(sql`${jobs.location} ilike ${likePattern(p.location)}`);
  if (p.remote) conds.push(eq(jobs.remote, true));
  if (p.view === "best" && p.lanes && (await hasEnabledLanes(db, userId))) {
    // With roles, Best match is the person's own matches (the shortlist, scored against those roles), plus jobs they
    // added by link. Re-checking every fresh job against the roles here took seconds and starved the connection pool.
    // Only the matches (no "or added by link"): the OR stopped Postgres from starting at the person's few shortlist rows,
    // and the query scanned every fresh job (over a minute). Jobs added by link show in the New list.
    conds.push(isNotNull(shortlist.id), eq(shortlist.status, "new"));
  } else if (p.lanes && !ownList) {
    const fits = await laneCondition(db, userId, now);
    // Jobs on the user's own shortlist (including ones added by widening) always belong to Best match.
    if (fits) conds.push(p.view === "best" ? or(fits, and(isNotNull(shortlist.id), eq(shortlist.status, "new")), saved) : or(fits, saved));
  }
  if (p.q) {
    // Title (trigram index) or one of the companies whose name matches (looked up first: the companies table is small).
    const named = await db.select({ id: companies.id }).from(companies).where(sql`${companies.name} ilike ${likePattern(p.q)}`).limit(500);
    conds.push(named.length
      ? or(sql`${jobs.title} ilike ${likePattern(p.q)}`, inArray(jobs.companyId, named.map((c) => c.id)))
      : sql`${jobs.title} ilike ${likePattern(p.q)}`);
  }
  if (p.minScore !== undefined) conds.push(sql`${shortlist.fit} >= ${p.minScore}`);

  const order = bookmarks
    ? [desc(jobBookmarks.createdAt), jobs.id]
    : applied
    ? [desc(applications.createdAt), jobs.id]
    : p.sort === "best"
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
    .leftJoin(jobBookmarks, and(eq(jobBookmarks.jobId, jobs.id), eq(jobBookmarks.userId, userId)))
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
  // Pay is found in the full description of the jobs shown only (a regex over every scanned row made lists slow).
  const payTexts = new Map<string, string | null>();
  if (rows.length) {
    const found = await db.select({ id: jobs.id, payText: sql<string | null>`substring(${jobs.descriptionText} from ${PAY_SQL_PATTERN})` })
      .from(jobs).where(inArray(jobs.id, rows.map(([, r]) => r.id)));
    for (const f of found) payTexts.set(f.id, f.payText);
  }
  const places = p.group ? await postingPlaces(db, rows.map(([, r]) => r.companyId), now, p, rows.map(([, r]) => r.title)) : null;
  return rows.map(([key, row]): JobListItem => {
    const description = needFullText ? row.descriptionText.slice(0, LIST_DESCRIPTION_CHARS) : row.descriptionText;
    const item: JobListItem = {
      job: toJob({ ...row, descriptionText: description }, { name: row.companyName, logoUrl: logo(row.logoDomain) }, undefined, { payText: payTexts.get(row.id) ?? null }),
      match: row.fit === null ? null : toMatch(row.id, { fit: row.fit, fitMap: row.fitMap ?? [], reasons: row.reasons ?? [], createdAt: row.matchAt ?? now }),
      applicationStatus: row.appStatus,
      saved: row.savedAt !== null,
    };
    const here = places?.get(key);
    if (here) { item.locations = here.count; item.locationNames = here.names; }
    return item;
  });
}

/** For each (company, title) group: how many postings are open and where (up to 8 names). One query over the groups' companies. */
async function postingPlaces(db: Db, companyIds: string[], now: Date, p: JobListParams, titles: string[] = []): Promise<Map<string, { count: number; names: string[] }>> {
  const out = new Map<string, { count: number; names: string[] }>();
  if (companyIds.length === 0) return out;
  // Only the groups' own titles: a big employer has thousands of open postings, and reading them all made lists slow.
  const wanted = [...new Set(titles.map((t) => t.trim().toLowerCase()))];
  const rows = await db.select({ companyId: jobs.companyId, title: jobs.title, location: jobs.location }).from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(inArray(jobs.companyId, [...new Set(companyIds)]), isNull(jobs.closedAt), freshJobSql(now, p.maxAgeHours),
      wanted.length ? sql`lower(btrim(${jobs.title})) in (${sql.join(wanted.map((t) => sql`${t}`), sql`, `)})` : undefined));
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

/** The most common locations of open jobs from the last 72 hours, for the Jobs page's location filter. */
export async function jobLocations(db: Db, now: Date, limit = 30): Promise<{ name: string; count: number }[]> {
  return queryRows<{ name: string; count: number }>(db, sql`
    SELECT ${jobs.location} AS name, count(*)::int AS count
    FROM ${jobs} INNER JOIN ${companies} ON ${companies.id} = ${jobs.companyId}
    WHERE ${jobs.closedAt} IS NULL AND ${companies.blocked} = false AND ${freshJobSql(now)} AND ${jobs.location} IS NOT NULL AND ${jobs.location} <> ''
    GROUP BY ${jobs.location} ORDER BY count(*) DESC, ${jobs.location} LIMIT ${limit}`);
}
