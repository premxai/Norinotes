/**
 * The person's own day, and the one meaning of a daily limit of 0.
 *
 * A daily limit counts from midnight where the person is, not UTC: for someone in Los Angeles a UTC day started at 4pm
 * (5pm in winter), so an application sent in the morning already counted against the next day and the cap looked like it
 * reset in the afternoon. The time zone is the one on their schedule (`preferences.noriSchedule.timezone`), which is
 * also the zone the schedule runs in; before they set one it is `DEFAULT_TIME_ZONE`.
 *
 * `profiles.daily_cap` of 0 means "not set": `DEFAULT_DAILY_CAP` applies, the same number for a click, Apply now, a
 * batch and the schedule. Turning the limit off is not offered: Nori sends applications to employers, so a cap that
 * meant nothing would be a trap.
 */

/** The daily limit a person gets before they set one, and what a stored 0 means. */
export const DEFAULT_DAILY_CAP = 20;
/** The time zone a person's day is counted in before they have a schedule of their own. */
export const DEFAULT_TIME_ZONE = "America/Los_Angeles";

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

/** The person's time zone: their schedule's, else the default. */
export function readTimeZone(preferences: unknown): string {
  const tz = rec(rec(preferences).noriSchedule).timezone;
  return validTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
}

/** A limit that is set, or the default when it is not: 0, a negative or a missing value answers `DEFAULT_DAILY_CAP`. */
export const effectiveDailyCap = (cap: number | null | undefined): number => (typeof cap === "number" && cap > 0 ? cap : DEFAULT_DAILY_CAP);

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: string };

function partsOf(at: Date, timeZone: string): Parts {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour), minute: Number(p.minute), weekday: String(p.weekday) };
}

/** The local date, weekday ("mon" … "sun") and minutes since midnight of `at` in `timeZone`. */
export function localClock(at: Date, timeZone: string): { date: string; day: string; minutes: number } {
  const p = partsOf(at, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, day: p.weekday.toLowerCase().slice(0, 3), minutes: p.hour * 60 + p.minute };
}

/** The wall clock of `at` read as if it were UTC, in milliseconds: the zone's offset at that moment is the difference. */
function wallClockMs(at: Date, timeZone: string): number {
  const p = partsOf(at, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, at.getUTCSeconds(), at.getUTCMilliseconds());
}

/**
 * The instant the person's day that `now` falls in began: their local midnight, as a UTC instant. The offset is taken
 * at `now` and again at the midnight it lands on, so a clock change between the two does not move the boundary.
 */
export function capDayStart(now: Date, timeZone: string = DEFAULT_TIME_ZONE): Date {
  const p = partsOf(now, timeZone);
  const localMidnight = Date.UTC(p.year, p.month - 1, p.day);
  const first = new Date(localMidnight - (wallClockMs(now, timeZone) - now.getTime()));
  return new Date(localMidnight - (wallClockMs(first, timeZone) - first.getTime()));
}
