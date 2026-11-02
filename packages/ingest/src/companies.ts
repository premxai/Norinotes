import type { AtsType } from "@norinote/shared";
import { and, companies, eq, inArray, sql } from "@norinote/db";
import type { Db } from "@norinote/db";
import { isBlockedCompany } from "./blocklist.js";
import { BOARD_REGISTRY } from "./board-registry.js";
import { SUPPORTED_ATS_TYPES } from "./connectors/index.js";

/** How long a board rests between polls. */
export const POLL_INTERVAL_MS = 3 * 60 * 60 * 1000;

export type SeedResult = {
  /** Registry boards inserted this call. */
  inserted: number;
  /** Existing rows (registry or user-added) that were flagged `blocked` this call because they are reposting aggregators. */
  markedBlocked: number;
};

/**
 * Put the verified registry boards into `companies` so the poller knows them. Idempotent: existing rows keep their
 * name and poll times, new registry entries are inserted, and boards of blocked aggregators are never inserted. Any
 * existing row that matches the blocklist is flagged `blocked = true` (so it is never polled). Rows are never deleted
 * and never un-blocked, so boards a user added are safe.
 */
export async function seedCompanies(db: Db): Promise<SeedResult> {
  const entries = BOARD_REGISTRY.filter((b) => !isBlockedCompany({ name: b.name, token: b.token }));
  let inserted = 0;
  for (let i = 0; i < entries.length; i += 100) {
    const rows = await db.insert(companies)
      .values(entries.slice(i, i + 100).map((b) => ({ name: b.name, atsType: b.atsType, atsToken: b.token })))
      .onConflictDoNothing().returning({ id: companies.id });
    inserted += rows.length;
  }

  const all = await db.select({ id: companies.id, name: companies.name, token: companies.atsToken, blocked: companies.blocked }).from(companies);
  const toBlock = all.filter((c) => !c.blocked && isBlockedCompany({ name: c.name, token: c.token })).map((c) => c.id);
  if (toBlock.length) await db.update(companies).set({ blocked: true }).where(inArray(companies.id, toBlock));
  return { inserted, markedBlocked: toBlock.length };
}

export type DueBoard = { id: string; atsType: AtsType; token: string; name: string; lastPolledAt: Date | null };

/**
 * Boards that are due for a poll: not blocked, a supported job system, and either never polled or last polled at least
 * `every` ago. Never-polled boards come first, then the oldest `last_polled_at`. `limit` caps how many are returned
 * (default 50).
 */
export async function dueBoards(db: Db, opts: { now: Date; every?: number; limit?: number }): Promise<DueBoard[]> {
  const every = opts.every ?? POLL_INTERVAL_MS;
  const cutoff = new Date(opts.now.getTime() - every);
  const rows = await db.select({
    id: companies.id, atsType: companies.atsType, token: companies.atsToken, name: companies.name, lastPolledAt: companies.lastPolledAt,
  }).from(companies)
    .where(and(
      eq(companies.blocked, false),
      inArray(companies.atsType, [...SUPPORTED_ATS_TYPES]),
      sql`(${companies.lastPolledAt} is null or ${companies.lastPolledAt} <= ${cutoff.toISOString()}::timestamptz)`,
    ))
    .orderBy(sql`${companies.lastPolledAt} asc nulls first`, companies.createdAt, companies.name, companies.id)
    .limit(opts.limit ?? 50);
  return rows.filter((r) => !isBlockedCompany({ name: r.name, token: r.token }));
}
