import type { TelegramSettings } from "./settings.js";

export type LocalClock = { /** YYYY-MM-DD in the zone. */ date: string; /** Minutes since local midnight. */ minutes: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The wall-clock date and time at `now` in `timeZone`. */
export function localClock(now: Date, timeZone: string): LocalClock {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(timeZone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Whether local `minutes` falls in [start, end), wrapping past midnight when start > end. */
export function inWindow(minutes: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/**
 * When a non-urgent message may go out: null when it may go now, else the end of the current quiet hours. Computed in
 * wall-clock minutes from now, so a DST change during the night moves it by at most an hour.
 */
export function quietUntil(now: Date, s: Pick<TelegramSettings, "timezone" | "quietHours">): Date | null {
  if (!s.quietHours.enabled) return null;
  const { minutes } = localClock(now, s.timezone);
  const start = toMinutes(s.quietHours.start);
  const end = toMinutes(s.quietHours.end);
  if (!inWindow(minutes, start, end)) return null;
  const wait = (end - minutes + 1440) % 1440;
  const at = new Date(now.getTime() + wait * 60_000);
  at.setUTCSeconds(0, 0);
  return at;
}
