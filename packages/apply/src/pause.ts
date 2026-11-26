/**
 * One pause for everything Nori does on its own (`profiles.preferences.noriPaused`). While it is on, the scheduler starts
 * no batch, a running batch sends nothing more, autopilot does not send a prepared strong fit, strong fits are not
 * prepared ahead, and questions are not answered and resent on the person's behalf. The person's own clicks still work:
 * a pause stops Nori acting alone, not the person.
 *
 * The flag is its own key so no other writer can clear it: `saveSchedule` writes only the schedule's fields and
 * `saveNoriSettings` only the `nori` settings, so a scheduler run marking today as done never turns a pause off.
 */
import { eq, profiles, sql, type Db } from "@norinote/db";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function readNoriPaused(preferences: unknown): boolean {
  return rec(preferences).noriPaused === true;
}

export async function isNoriPaused(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.select({ preferences: profiles.preferences }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return readNoriPaused(row?.preferences);
}

/** Pauses or resumes Nori for this person. Writes only this key; nothing else in `preferences` changes. */
export async function setNoriPaused(db: Db, userId: string, paused: boolean): Promise<boolean> {
  const value = sql`jsonb_build_object('noriPaused', ${paused}::boolean)`;
  await db.insert(profiles).values({ userId, preferences: { noriPaused: paused } }).onConflictDoUpdate({
    target: profiles.userId,
    set: { preferences: sql`coalesce(${profiles.preferences}, '{}'::jsonb) || ${value}` },
  });
  return paused;
}
