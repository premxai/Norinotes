import type { AtsType } from "@norinote/shared";
import { and, companies, eq, inArray, isFreshJob, jobs, sql } from "@norinote/db";
import type { Db } from "@norinote/db";
import { dedupeKey } from "./dedupe.js";
import { hostKey } from "./hosts.js";
import type { NormalizedJob } from "./types.js";

const CHUNK = 100;

/** Postgres text cannot hold NUL characters; some feeds contain them. */
const clean = (s: string): string => s.replaceAll("\u0000", "");

/**
 * Resolve (or create) the companies row for a board and return its id. A user-added or seeded row is never renamed.
 * A row created here is `active` (somebody asked for this board) and polled right away; `discoveredVia` says who asked.
 */
export async function ensureCompany(db: Db, atsType: AtsType, token: string, name: string, discoveredVia = "user"): Promise<string> {
  const find = async () => (await db.select({ id: companies.id }).from(companies)
    .where(and(eq(companies.atsType, atsType), eq(companies.atsToken, token))).limit(1))[0]?.id;
  const existing = await find();
  if (existing) return existing;
  await db.insert(companies).values({ name, atsType, atsToken: token, host: hostKey(atsType, token), discoveredVia, status: "active" }).onConflictDoNothing();
  const created = await find();
  if (!created) throw new Error(`could not create a company row for ${atsType}:${token}`);
  return created;
}

export type UpsertResult = {
  /** Every job id written, in input order after de-duplication by external id. */
  ids: string[];
  /** Ids of rows that did not exist before. */
  newIds: string[];
  /** Number of rows that already existed. */
  updated: number;
  /** Jobs whose feed text was not stored because nobody can be shown them (see `UpsertOptions.keepText`). */
  trimmed: number;
};

export type UpsertOptions = {
  /**
   * Store the description whatever the job's age. Default false: a job that is not fresh when written (posted more than
   * 72 hours ago, or undated and listed on the board's first read; see `isFreshJob`) is stored without its description,
   * and a known one keeps the text it has. A pasted link sets this, so an older job gets (or gets back) its text.
   */
  keepText?: boolean;
};

/**
 * Insert new jobs and refresh existing ones, keyed on (atsType, externalId). New rows get `firstSeenAt = now`; every
 * row gets `lastSeenAt = now` and is reopened (`closedAt = null`). `postedAt` keeps its stored value when the feed no
 * longer says one. Duplicates by external id inside one batch collapse (the last wins).
 *
 * Only fresh jobs carry their description (unless `opts.keepText`): users are shown nothing older than 72 hours, and
 * the text is almost all of a job's size. A job that is not fresh is written with an empty description, and since an
 * empty incoming description never overwrites a stored one, later reads neither refill nor wipe it.
 */
export async function upsertJobs(db: Db, companyId: string, atsType: AtsType, input: NormalizedJob[], now: Date, opts: UpsertOptions = {}): Promise<UpsertResult> {
  const byId = new Map<string, NormalizedJob>();
  for (const j of input) byId.set(j.externalId, j);
  const list = [...byId.values()];
  const ids: string[] = [];
  const newIds: string[] = [];
  let updated = 0;
  let trimmed = 0;
  // Null while the board's first read is being written (pollBoard sets it afterwards).
  const [company] = opts.keepText ? [] : await db.select({ firstReadAt: companies.firstReadAt }).from(companies).where(eq(companies.id, companyId)).limit(1);
  const firstReadAt = company?.firstReadAt ?? null;

  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    const existing = await db.select({ externalId: jobs.externalId, postedAt: jobs.postedAt, firstSeenAt: jobs.firstSeenAt }).from(jobs)
      .where(and(eq(jobs.atsType, atsType), inArray(jobs.externalId, chunk.map((j) => j.externalId))));
    const have = new Map(existing.map((e) => [e.externalId, e]));

    const rows = await db.insert(jobs).values(chunk.map((j) => {
      const title = clean(j.title).trim();
      const location = j.location ? clean(j.location).trim() || null : null;
      const stored = have.get(j.externalId);
      const fresh = opts.keepText || isFreshJob({ postedAt: j.postedAt ?? stored?.postedAt ?? null, firstSeenAt: stored?.firstSeenAt ?? now, firstReadAt }, now);
      if (!fresh && j.descriptionText.trim()) trimmed++;
      return {
        companyId,
        atsType,
        externalId: j.externalId,
        title,
        location,
        remote: j.remote,
        descriptionText: fresh ? clean(j.descriptionText) : "",
        applyUrl: clean(j.applyUrl),
        postedAt: j.postedAt,
        firstSeenAt: now,
        lastSeenAt: now,
        closedAt: null,
        missingReads: 0,
        dedupeKey: dedupeKey({ companyName: clean(j.companyName), title, location }),
      };
    })).onConflictDoUpdate({
      target: [jobs.atsType, jobs.externalId],
      set: {
        companyId: sql`excluded.company_id`,
        title: sql`excluded.title`,
        location: sql`excluded.location`,
        remote: sql`excluded.remote`,
        // A list feed without text (Workday) must not wipe a description that fetchJob filled in, and a job that is not
        // fresh (sent as '') keeps what it has: nothing if it was trimmed, its text if a user still needs it.
        descriptionText: sql`case when excluded.description_text = '' then ${jobs.descriptionText} else excluded.description_text end`,
        applyUrl: sql`excluded.apply_url`,
        postedAt: sql`coalesce(excluded.posted_at, ${jobs.postedAt})`,
        lastSeenAt: sql`excluded.last_seen_at`,
        closedAt: sql`null`,
        missingReads: sql`0`,
        dedupeKey: sql`excluded.dedupe_key`,
      },
    }).returning({ id: jobs.id, externalId: jobs.externalId });

    for (const r of rows) {
      ids.push(r.id);
      if (have.has(r.externalId)) updated++; else newIds.push(r.id);
    }
  }
  return { ids, newIds, updated, trimmed };
}
