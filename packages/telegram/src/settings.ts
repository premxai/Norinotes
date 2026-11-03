import { z } from "zod";
import { eq, profiles, sql, type Db } from "@norinote/db";

/** Telegram settings, kept in `profiles.preferences.telegram` (no extra table). */
export type TelegramSettings = {
  /** Local time of the daily shortlist, HH:MM. */
  dailyTime: string;
  /** IANA time zone, e.g. Europe/London. */
  timezone: string;
  /** Jobs in the daily shortlist, 1 to 10. */
  count: number;
  /** Local time of the daily summary, HH:MM. */
  summaryTime: string;
  quietHours: { enabled: boolean; start: string; end: string };
  events: { digest: boolean; questions: boolean; submitted: boolean; needsUser: boolean; inbox: boolean; summary: boolean };
};

export const DEFAULT_SETTINGS: TelegramSettings = {
  dailyTime: "09:00",
  timezone: "UTC",
  count: 5,
  summaryTime: "20:00",
  quietHours: { enabled: true, start: "22:00", end: "08:00" },
  events: { digest: true, questions: true, submitted: true, needsUser: true, inbox: true, summary: true },
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const time = z.string().regex(HHMM, "Use HH:MM (24-hour)");
const zone = z.string().min(1).max(64).refine(isTimeZone, "Unknown time zone");

/** What PUT /api/channels/telegram accepts: any subset. */
export const SettingsPatch = z.object({
  dailyTime: time.optional(),
  timezone: zone.optional(),
  count: z.number().int().min(1).max(10).optional(),
  summaryTime: time.optional(),
  quietHours: z.object({ enabled: z.boolean().optional(), start: time.optional(), end: time.optional() }).optional(),
  events: z.object({
    digest: z.boolean().optional(), questions: z.boolean().optional(), submitted: z.boolean().optional(),
    needsUser: z.boolean().optional(), inbox: z.boolean().optional(), summary: z.boolean().optional(),
  }).optional(),
}).strict();
export type SettingsPatch = z.infer<typeof SettingsPatch>;

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const pick = <T>(v: unknown, ok: (x: unknown) => boolean, fallback: T): T => (ok(v) ? (v as T) : fallback);
const isTime = (v: unknown) => typeof v === "string" && HHMM.test(v);
const isBool = (v: unknown) => typeof v === "boolean";

/** Settings from a `preferences` object, every missing or broken value replaced by its default. */
export function readTelegramSettings(preferences: unknown): TelegramSettings {
  const o = rec(rec(preferences).telegram);
  const q = rec(o.quietHours);
  const e = rec(o.events);
  const d = DEFAULT_SETTINGS;
  return {
    dailyTime: pick(o.dailyTime, isTime, d.dailyTime),
    timezone: pick(o.timezone, (v) => typeof v === "string" && isTimeZone(v), d.timezone),
    count: pick(o.count, (v) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 10, d.count),
    summaryTime: pick(o.summaryTime, isTime, d.summaryTime),
    quietHours: { enabled: pick(q.enabled, isBool, d.quietHours.enabled), start: pick(q.start, isTime, d.quietHours.start), end: pick(q.end, isTime, d.quietHours.end) },
    events: Object.fromEntries(Object.entries(d.events).map(([k, v]) => [k, pick(e[k], isBool, v)])) as TelegramSettings["events"],
  };
}

export function mergeSettings(current: TelegramSettings, patch: SettingsPatch): TelegramSettings {
  return {
    ...current,
    ...(patch.dailyTime !== undefined ? { dailyTime: patch.dailyTime } : {}),
    ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
    ...(patch.count !== undefined ? { count: patch.count } : {}),
    ...(patch.summaryTime !== undefined ? { summaryTime: patch.summaryTime } : {}),
    quietHours: { ...current.quietHours, ...Object.fromEntries(Object.entries(patch.quietHours ?? {}).filter(([, v]) => v !== undefined)) },
    events: { ...current.events, ...Object.fromEntries(Object.entries(patch.events ?? {}).filter(([, v]) => v !== undefined)) },
  };
}

export async function loadTelegramSettings(db: Db, userId: string): Promise<TelegramSettings> {
  const [row] = await db.select({ preferences: profiles.preferences }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return readTelegramSettings(row?.preferences);
}

/** Validated patch merged into the stored settings; only `preferences.telegram` is written. */
export async function saveTelegramSettings(db: Db, userId: string, patch: SettingsPatch): Promise<TelegramSettings> {
  const next = mergeSettings(await loadTelegramSettings(db, userId), SettingsPatch.parse(patch));
  await db.insert(profiles).values({ userId, preferences: { telegram: next } })
    .onConflictDoUpdate({ target: profiles.userId, set: { preferences: sql`coalesce(${profiles.preferences}, '{}'::jsonb) || jsonb_build_object('telegram', ${JSON.stringify(next)}::jsonb)` } });
  return next;
}
