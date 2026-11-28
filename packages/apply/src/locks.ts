/**
 * Short leases in the database, so "one application at a time" holds across worker machines rather than inside one
 * process. Two kinds of key share the table (`apply_locks`): `company:<key>` is held for as long as a run fills that
 * company's form and cools down afterwards, and `user-send:<id>` marks when Nori last started one of a person's
 * applications, so their batches are spaced whatever machine sends them.
 *
 * Times come from the caller, never from the database clock, so a pass with an explicit `now` (tests, a backfill)
 * reads the same state on any machine. The lease is what makes a crashed run harmless: an expired row is free again.
 */
import { and, eq, sql, type Db } from "@norinote/db";
import { applyLocks, queryRows } from "@norinote/db";

export const companyLockKey = (company: string): string => `company:${company}`;
export const userSendLockKey = (userId: string): string => `user-send:${userId}`;

/** Gives the key back: it cools down, then anyone may take it. */
export type LockRelease = () => Promise<void>;

export type AcquireOptions = {
  /** The clock to read, so a pass with an explicit time stays deterministic. */
  now: () => Date;
  /** How long the holder may keep it without renewing. */
  holdMs: number;
  /** How long after the release the key stays taken. */
  cooldownMs: number;
};

/**
 * Tries to take one key until `now` moves past it. Returns null when someone else holds it or it is cooling down. The
 * insert-or-update is one statement, so two processes that ask at the same moment cannot both get it.
 */
export async function acquireLock(db: Db, key: string, opts: AcquireOptions): Promise<LockRelease | null> {
  const holder = crypto.randomUUID();
  const at = opts.now();
  const heldUntil = new Date(at.getTime() + Math.max(0, opts.holdMs));
  const freeAt = new Date(at.getTime() + Math.max(0, opts.holdMs) + Math.max(0, opts.cooldownMs));
  const rows = await queryRows<{ key: string }>(db, sql`
    insert into ${applyLocks} (key, holder, held_until, free_at)
    values (${key}, ${holder}, ${heldUntil}, ${freeAt})
    on conflict (key) do update
      set holder = excluded.holder, held_until = excluded.held_until, free_at = excluded.free_at
      where ${applyLocks.heldUntil} <= ${at} and ${applyLocks.freeAt} <= ${at}
    returning key`);
  if (rows.length === 0) return null;
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    const releasedAt = opts.now();
    await db.update(applyLocks)
      .set({ heldUntil: releasedAt, freeAt: new Date(releasedAt.getTime() + Math.max(0, opts.cooldownMs)) })
      .where(and(eq(applyLocks.key, key), eq(applyLocks.holder, holder)));
  };
}

/** Whether the key is held, or cooling down, at `now`. */
export async function lockTaken(db: Db, key: string, now: Date): Promise<boolean> {
  const [row] = await db.select({ heldUntil: applyLocks.heldUntil, freeAt: applyLocks.freeAt })
    .from(applyLocks).where(eq(applyLocks.key, key)).limit(1);
  return !!row && (row.heldUntil > now || row.freeAt > now);
}

/** Records that something started for this key now, and holds nobody: the key stays taken for `cooldownMs`. */
export async function stampLock(db: Db, key: string, now: Date, cooldownMs: number): Promise<void> {
  const holder = `stamp:${crypto.randomUUID()}`;
  const freeAt = new Date(now.getTime() + Math.max(0, cooldownMs));
  await db.insert(applyLocks).values({ key, holder, heldUntil: now, freeAt })
    .onConflictDoUpdate({ target: applyLocks.key, set: { holder, heldUntil: now, freeAt } });
}
