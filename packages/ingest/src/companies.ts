import type { AtsType } from "@norinote/shared";
import { companies, eq, inArray, queryRows, sql } from "@norinote/db";
import type { CompanyStatus, Db } from "@norinote/db";
import { isBlockedCompany } from "./blocklist.js";
import { BOARD_REGISTRY } from "./board-registry.js";
import { getConnector, SUPPORTED_ATS_TYPES } from "./connectors/index.js";
import { hostKey } from "./hosts.js";
import { PRIORITY } from "./schedule.js";

export type SeedResult = {
  /** Registry boards inserted this call. */
  inserted: number;
  /** Existing rows (registry or user-added) that were flagged `blocked` this call because they are reposting aggregators. */
  markedBlocked: number;
};

/**
 * Put the verified registry boards into `companies` so the poller knows them: `discovered_via = 'registry'`, `active`,
 * priority 100 (polled before any seed). Idempotent: existing rows keep their name and poll times; a registry board
 * that was imported earlier as a seed candidate is promoted to active with registry priority. Boards of blocked
 * aggregators are never inserted, and any existing row that matches the blocklist is flagged `blocked = true`. Rows are
 * never deleted and never un-blocked, so boards a user added are safe.
 */
export async function seedCompanies(db: Db): Promise<SeedResult> {
  const entries = BOARD_REGISTRY.filter((b) => !isBlockedCompany({ name: b.name, token: b.token }));
  let inserted = 0;
  for (let i = 0; i < entries.length; i += 100) {
    const rows = await db.insert(companies)
      .values(entries.slice(i, i + 100).map((b) => ({
        name: b.name, atsType: b.atsType, atsToken: b.token, host: hostKey(b.atsType, b.token),
        discoveredVia: "registry", status: "active" as const, priority: PRIORITY.registry,
      })))
      .onConflictDoNothing().returning({ id: companies.id });
    inserted += rows.length;
  }

  const all = await db.select({
    id: companies.id, name: companies.name, atsType: companies.atsType, token: companies.atsToken, blocked: companies.blocked,
    priority: companies.priority, status: companies.status, discoveredVia: companies.discoveredVia,
  }).from(companies);
  const toBlock = all.filter((c) => !c.blocked && isBlockedCompany({ name: c.name, token: c.token })).map((c) => c.id);
  if (toBlock.length) await db.update(companies).set({ blocked: true }).where(inArray(companies.id, toBlock));

  const registryKeys = new Set(entries.map((b) => `${b.atsType}|${b.token}`));
  for (const c of all) {
    if (!registryKeys.has(`${c.atsType}|${c.token}`)) continue;
    const promote = c.discoveredVia.startsWith("seed:");
    if (!promote && c.priority >= PRIORITY.registry) continue;
    await db.update(companies).set({
      priority: Math.max(c.priority, PRIORITY.registry),
      ...(promote ? { discoveredVia: "registry", status: c.status === "candidate" ? "active" as const : c.status } : {}),
    }).where(eq(companies.id, c.id));
  }
  return { inserted, markedBlocked: toBlock.length };
}

export type DueBoard = {
  id: string;
  atsType: AtsType;
  token: string;
  name: string;
  status: CompanyStatus;
  priority: number;
  host: string;
  nextPollAt: Date | null;
  lastPolledAt: Date | null;
};

export type NextBoardsOptions = {
  now: Date;
  /** Most boards returned. Default 50. */
  limit?: number;
  /** Most boards returned for one host group (see `hostKey`), so one slow system cannot fill a whole run. Default 10. */
  perHostLimit?: number;
  /** `only` returns just candidates (validation polls), `exclude` returns none of them. Default both. */
  candidates?: "include" | "only" | "exclude";
};

type Row = {
  id: string; ats_type: AtsType; ats_token: string; name: string; status: CompanyStatus; priority: number;
  host: string | null; next_poll_at: string | Date | null; last_polled_at: string | Date | null;
};
const toDate = (v: string | Date | null): Date | null => (v == null ? null : new Date(v));

/**
 * The boards to poll now, best first: highest priority (boosted companies count as priority 200 until their
 * `boost_until`), then the longest overdue (never polled first). A board is due
 * when it is a candidate, active or on probation and `next_poll_at` is empty or past; disabled and dead boards are due
 * only when their weekly recheck time has come. Blocked boards, placeholder job systems and blocklisted names are
 * skipped. At most `perHostLimit` boards per host group are returned.
 */
export async function nextBoards(db: Db, opts: NextBoardsOptions): Promise<DueBoard[]> {
  const limit = opts.limit ?? 50;
  const perHost = opts.perHostLimit ?? 10;
  const mode = opts.candidates ?? "include";
  const now = opts.now.toISOString();
  const systems = sql.join([...SUPPORTED_ATS_TYPES].map((t) => sql`${t}`), sql`, `);
  const scope = mode === "only" ? sql`and c.status = 'candidate'` : mode === "exclude" ? sql`and c.status <> 'candidate'` : sql``;
  const rows = await queryRows<Row>(db, sql`
    select id, ats_type, ats_token, name, status, eff as priority, host, next_poll_at, last_polled_at from (
      select c.*, row_number() over (
        partition by coalesce(c.host, c.ats_type)
        order by c.eff desc, c.next_poll_at asc nulls first, c.created_at, c.id
      ) as rn
      from (
        select companies.*, case when boost_until is not null and boost_until > ${now}::timestamptz then greatest(priority, ${PRIORITY.boost}) else priority end as eff
        from companies
      ) c
      where c.blocked = false
        and c.ats_type in (${systems})
        and ((c.status in ('candidate', 'active', 'probation') and (c.next_poll_at is null or c.next_poll_at <= ${now}::timestamptz))
          or (c.status in ('dead', 'disabled') and c.next_poll_at is not null and c.next_poll_at <= ${now}::timestamptz))
        ${scope}
    ) q
    where rn <= ${perHost}
    order by eff desc, next_poll_at asc nulls first, created_at, id
    limit ${limit}`);
  return rows
    .filter((r) => !isBlockedCompany({ name: r.name, token: r.ats_token }))
    .map((r) => ({
      id: r.id, atsType: r.ats_type, token: r.ats_token, name: r.name, status: r.status, priority: Number(r.priority),
      host: r.host ?? hostKey(r.ats_type, r.ats_token), nextPollAt: toDate(r.next_poll_at), lastPolledAt: toDate(r.last_polled_at),
    }));
}

/** Concurrent polls allowed against one host group when a system does not say. */
export const DEFAULT_POLLS_PER_HOST = 4;

/** Workable answers 429 above 2 to 4 concurrent requests, so it gets 2 whatever its connector says. */
const POLLS_PER_HOST_CAP: Partial<Record<AtsType, number>> = { workable: 2 };

/** How many boards of one host group may be polled at the same time. */
export function maxPollsPerHost(atsType: AtsType, fallback = DEFAULT_POLLS_PER_HOST): number {
  const declared = getConnector(atsType).capabilities?.maxConcurrencyPerHost ?? fallback;
  const cap = POLLS_PER_HOST_CAP[atsType];
  return Math.max(1, cap ? Math.min(declared, cap) : declared);
}
