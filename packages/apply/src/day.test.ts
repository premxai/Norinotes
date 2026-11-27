import { describe, expect, it } from "vitest";
import { capDayStart, DEFAULT_DAILY_CAP, DEFAULT_TIME_ZONE, effectiveDailyCap, localClock, readTimeZone, validTimeZone } from "./day.js";

describe("the person's own day", () => {
  it("starts at their local midnight, whatever UTC says", () => {
    // Los Angeles is UTC-8 in November: local midnight is 08:00 UTC.
    expect(capDayStart(new Date("2026-11-26T09:00:00Z"), "America/Los_Angeles").toISOString()).toBe("2026-11-26T08:00:00.000Z");
    expect(capDayStart(new Date("2026-11-26T02:00:00Z"), "America/Los_Angeles").toISOString()).toBe("2026-11-25T08:00:00.000Z");
    expect(localClock(new Date("2026-11-26T02:00:00Z"), "America/Los_Angeles")).toEqual({ date: "2026-11-25", day: "wed", minutes: 18 * 60 });
    // Tokyo is UTC+9: the day starts at 15:00 UTC the afternoon before.
    expect(capDayStart(new Date("2026-11-26T12:00:00Z"), "Asia/Tokyo").toISOString()).toBe("2026-11-25T15:00:00.000Z");
    expect(capDayStart(new Date("2026-11-26T12:00:00Z"), "UTC").toISOString()).toBe("2026-11-26T00:00:00.000Z");
  });

  it("holds across a clock change", () => {
    // 8 March 2026 is the spring-forward day in the United States (PST to PDT at 2am, after midnight).
    expect(capDayStart(new Date("2026-03-08T12:00:00Z"), "America/Los_Angeles").toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(capDayStart(new Date("2026-03-09T12:00:00Z"), "America/Los_Angeles").toISOString()).toBe("2026-03-09T07:00:00.000Z");
    // And the autumn one (PDT to PST), where the boundary moves the other way.
    expect(capDayStart(new Date("2026-11-01T20:00:00Z"), "America/Los_Angeles").toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(capDayStart(new Date("2026-11-02T20:00:00Z"), "America/Los_Angeles").toISOString()).toBe("2026-11-02T08:00:00.000Z");
  });

  it("reads the time zone from the schedule, and falls back to the default", () => {
    expect(readTimeZone({ noriSchedule: { timezone: "Europe/London" } })).toBe("Europe/London");
    expect(readTimeZone({ noriSchedule: { timezone: "Mars/Olympus" } })).toBe(DEFAULT_TIME_ZONE);
    expect(readTimeZone(undefined)).toBe(DEFAULT_TIME_ZONE);
    expect(validTimeZone("Asia/Tokyo")).toBe(true);
    expect(validTimeZone("nope")).toBe(false);
    // A limit of 0 is "not set", never "no limit": one number everywhere.
    expect(effectiveDailyCap(0)).toBe(DEFAULT_DAILY_CAP);
    expect(effectiveDailyCap(null)).toBe(DEFAULT_DAILY_CAP);
    expect(effectiveDailyCap(undefined)).toBe(DEFAULT_DAILY_CAP);
    expect(effectiveDailyCap(-3)).toBe(DEFAULT_DAILY_CAP);
    expect(effectiveDailyCap(5)).toBe(5);
  });
});
