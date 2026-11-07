/**
 * Nori's schedule (autopilot, the Nori page): on the days and at the time the person chose, in their time zone, Nori
 * starts an "Apply for me" batch of their new Recommended jobs, within the daily limit. Off until the person turns it
 * on; `paused` stops it without losing the settings. The batch summary goes out like any batch's (Telegram).
 * Stored in `profiles.preferences.noriSchedule`.
 */
import { dailyCapUse } from "./store.js";
import { and, eq, profiles, sql, type Db } from "@norinote/db";
import { MAX_BATCH, getNoriSettings, recommendedJobIds, startBatch } from "./batch.js";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type NoriSchedule = { enabled: boolean; days: Weekday[]; time: string; timezone: string; paused: boolean; lastRunOn: string | null };

export const DEFAULT_SCHEDULE: NoriSchedule = { enabled: false, days: ["mon", "tue", "wed", "thu", "fri"], time: "09:00", timezone: "America/Los_Angeles", paused: false, lastRunOn: null };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function readSchedule(preferences: unknown): NoriSchedule {
  const o = rec(rec(preferences).noriSchedule);
  const days = Array.isArray(o.days) ? WEEKDAYS.filter((d) => (o.days as unknown[]).includes(d)) : DEFAULT_SCHEDULE.days;
  return {
    enabled: o.enabled === true,
    days: days.length ? days : DEFAULT_SCHEDULE.days,
    time: typeof o.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.time) ? o.time : DEFAULT_SCHEDULE.time,
    timezone: validTimeZone(o.timezone) ? o.timezone : DEFAULT_SCHEDULE.timezone,
    paused: o.paused === true,
    lastRunOn: typeof o.lastRunOn === "string" ? o.lastRunOn : null,
  };
}

/** The local date (YYYY-MM-DD), weekday and minutes since midnight of `at` in `tz`. */
export function localClock(at: Date, tz: string): { date: string; day: Weekday; minutes: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(at).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, day: parts.weekday!.toLowerCase().slice(0, 3) as Weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** The next local date it runs on (YYYY-MM-DD), or null when it is off or paused. */
export function nextRunOn(s: NoriSchedule, now: Date): string | null {
  if (!s.enabled || s.paused) return null;
  for (let d = 0; d < 8; d++) {
    const c = localClock(new Date(now.getTime() + d * 86_400_000), s.timezone);
    if (!s.days.includes(c.day)) continue;
    if (d === 0 && (s.lastRunOn === c.date || c.minutes >= minutesOf(s.time) + 60)) continue;
    return c.date;
  }
  return null;
}

/** Is it time? On a chosen day, at or after the time (within the hour after), and not already run today. */
export function isDue(s: NoriSchedule, now: Date): boolean {
  if (!s.enabled || s.paused) return false;
  const c = localClock(now, s.timezone);
  const at = minutesOf(s.time);
  return s.days.includes(c.day) && c.minutes >= at && c.minutes < at + 60 && s.lastRunOn !== c.date;
}

export async function getSchedule(db: Db, userId: string): Promise<NoriSchedule> {
  const [row] = await db.select({ preferences: profiles.preferences }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return readSchedule(row?.preferences);
}

export async function saveSchedule(db: Db, userId: string, patch: Partial<Omit<NoriSchedule, "lastRunOn">> & { lastRunOn?: string | null }): Promise<NoriSchedule> {
  const next = { ...(await getSchedule(db, userId)), ...patch };
  const json = JSON.stringify(next);
  await db.insert(profiles).values({ userId, preferences: { noriSchedule: next } }).onConflictDoUpdate({
    target: profiles.userId,
    set: { preferences: sql`coalesce(${profiles.preferences}, '{}'::jsonb) || jsonb_build_object('noriSchedule', ${json}::jsonb)` },
  });
  return next;
}

export type ScheduledRun = { userId: string; batchId: string | null; created: string[]; reason?: string };

/**
 * One pass over everyone whose schedule is on: for each that is due, start a batch of new Recommended jobs (as many as
 * today's limit still allows), and mark today as run whether or not there was anything to send. Returns the new
 * applications the caller must queue `prepare.application` for.
 */
export async function runSchedules(db: Db, opts: { now?: Date; atsTypes?: readonly string[] | null } = {}): Promise<ScheduledRun[]> {
  const now = opts.now ?? new Date();
  const rows = await db.select({ userId: profiles.userId, preferences: profiles.preferences }).from(profiles)
    .where(and(sql`${profiles.preferences} -> 'noriSchedule' ->> 'enabled' = 'true'`, sql`coalesce(${profiles.preferences} -> 'noriSchedule' ->> 'paused', 'false') <> 'true'`));
  const out: ScheduledRun[] = [];
  for (const row of rows) {
    const s = readSchedule(row.preferences);
    if (!isDue(s, now)) continue;
    await saveSchedule(db, row.userId, { lastRunOn: localClock(now, s.timezone).date });
    const settings = await getNoriSettings(db, row.userId);
    const use = await dailyCapUse(db, row.userId, now);
    const room = Math.min(MAX_BATCH, Math.max(0, settings.dailyLimit - use.used));
    if (room === 0) { out.push({ userId: row.userId, batchId: null, created: [], reason: "daily limit used" }); continue; }
    const ids = await recommendedJobIds(db, row.userId, { now, limit: room, atsTypes: opts.atsTypes ?? null });
    if (!ids.length) { out.push({ userId: row.userId, batchId: null, created: [], reason: "nothing recommended" }); continue; }
    const res = await startBatch(db, row.userId, ids, { now, atsTypes: opts.atsTypes ?? null });
    out.push({ userId: row.userId, batchId: res.batchId, created: res.added.filter((a) => a.created).map((a) => a.applicationId) });
  }
  return out;
}
