import type { AtsType } from "@norinote/shared";
import { and, companies, eq, inArray, jobs, sql } from "@norinote/db";
import type { Db } from "@norinote/db";
import { dedupeKey } from "./dedupe.js";
import type { NormalizedJob } from "./types.js";

const CHUNK = 100;

/** Postgres text cannot hold NUL characters; some feeds contain them. */
const clean = (s: string): string => s.replaceAll("\u0000", "");

/** Resolve (or create) the companies row for a board and return its id. A user-added or seeded row is never renamed. */
export async function ensureCompany(db: Db, atsType: AtsType, token: string, name: string): Promise<string> {
  const find = async () => (await db.select({ id: companies.id }).from(companies)
    .where(and(eq(companies.atsType, atsType), eq(companies.atsToken, token))).limit(1))[0]?.id;
  const existing = await find();
  if (existing) return existing;
  await db.insert(companies).values({ name, atsType, atsToken: token }).onConflictDoNothing();
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
};

/**
 * Insert new jobs and refresh existing ones, keyed on (atsType, externalId). New rows get `firstSeenAt = now`; every
 * row gets `lastSeenAt = now` and is reopened (`closedAt = null`). `postedAt` keeps its stored value when the feed no
 * longer says one. Duplicates by external id inside one batch collapse (the last wins).
 */
export async function upsertJobs(db: Db, companyId: string, atsType: AtsType, input: NormalizedJob[], now: Date): Promise<UpsertResult> {
  const byId = new Map<string, NormalizedJob>();
  for (const j of input) byId.set(j.externalId, j);
  const list = [...byId.values()];
  const ids: string[] = [];
  const newIds: string[] = [];
  let updated = 0;

  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    const existing = await db.select({ externalId: jobs.externalId }).from(jobs)
      .where(and(eq(jobs.atsType, atsType), inArray(jobs.externalId, chunk.map((j) => j.externalId))));
    const have = new Set(existing.map((e) => e.externalId));

    const rows = await db.insert(jobs).values(chunk.map((j) => {
      const title = clean(j.title).trim();
      const location = j.location ? clean(j.location).trim() || null : null;
      return {
        companyId,
        atsType,
        externalId: j.externalId,
        title,
        location,
        remote: j.remote,
        descriptionText: clean(j.descriptionText),
        applyUrl: clean(j.applyUrl),
        postedAt: j.postedAt,
        firstSeenAt: now,
        lastSeenAt: now,
        closedAt: null,
        dedupeKey: dedupeKey({ companyName: clean(j.companyName), title, location }),
      };
    })).onConflictDoUpdate({
      target: [jobs.atsType, jobs.externalId],
      set: {
        companyId: sql`excluded.company_id`,
        title: sql`excluded.title`,
        location: sql`excluded.location`,
        remote: sql`excluded.remote`,
        descriptionText: sql`excluded.description_text`,
        applyUrl: sql`excluded.apply_url`,
        postedAt: sql`coalesce(excluded.posted_at, ${jobs.postedAt})`,
        lastSeenAt: sql`excluded.last_seen_at`,
        closedAt: sql`null`,
        dedupeKey: sql`excluded.dedupe_key`,
      },
    }).returning({ id: jobs.id, externalId: jobs.externalId });

    for (const r of rows) {
      ids.push(r.id);
      if (have.has(r.externalId)) updated++; else newIds.push(r.id);
    }
  }
  return { ids, newIds, updated };
}
