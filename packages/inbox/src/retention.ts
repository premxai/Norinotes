import { sql, type Db } from "@norinote/db";
import { DEFAULT_RETENTION_DAYS } from "./address.js";

/** `INBOX_RETENTION_DAYS` (1 to 3650), else 90. */
export function retentionDaysFromEnv(env: Record<string, string | undefined> = process.env): number {
  const n = Number.parseInt(env.INBOX_RETENTION_DAYS ?? "", 10);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : DEFAULT_RETENTION_DAYS;
}

/**
 * Deletes inbox messages older than the retention period: the user's own setting (`profiles.preferences.inbox.retentionDays`)
 * or `defaultDays`. Returns how many rows went. Idempotent, so several workers running it at once is harmless.
 */
export async function purgeExpiredInbox(db: Db, opts: { now?: Date; defaultDays?: number } = {}): Promise<number> {
  const now = (opts.now ?? new Date()).toISOString();
  const days = Math.max(1, Math.floor(opts.defaultDays ?? DEFAULT_RETENTION_DAYS));
  const res = await db.execute(sql`
    delete from inbox_messages m
    where m.received_at < ${now}::timestamptz - make_interval(days => coalesce((
      select case when (p.preferences->'inbox'->>'retentionDays') ~ '^[0-9]{1,3}$' then (p.preferences->'inbox'->>'retentionDays')::int end
      from profiles p where p.user_id = m.user_id
    ), ${days}::int))
    returning m.id`);
  const rows = (res as unknown as { rows?: unknown[] }).rows ?? (Array.isArray(res) ? res : []);
  return rows.length;
}

/**
 * Runs `purgeExpiredInbox` now and then every `intervalMs` (default 6 hours) in this process. Returns the stop function.
 * The worker calls this once at start.
 */
export function startInboxRetention(db: Db, opts: { intervalMs?: number; defaultDays?: number; log?: (event: string, fields: Record<string, unknown>) => void } = {}): () => void {
  const run = () => purgeExpiredInbox(db, { defaultDays: opts.defaultDays ?? retentionDaysFromEnv() })
    .then((deleted) => { if (deleted) opts.log?.("inbox.retention", { deleted }); })
    .catch((err) => opts.log?.("inbox.retention", { ok: false, error: err instanceof Error ? err.message : String(err) }));
  void run();
  const timer = setInterval(run, opts.intervalMs ?? 6 * 3_600_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
