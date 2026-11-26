import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, applyBatches, companies, eq, jobs, shortlist, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { placeInGroup, type DECISION_FIT_MAPS } from "@norinote/match/testing";
import { DEFAULT_SCHEDULE, isDue, localClock, nextRunOn, readSchedule, runSchedules, saveSchedule } from "./schedule.js";
import { saveNoriSettings } from "./batch.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());

// Monday 2026-11-09, 09:10 in Los Angeles (17:10 UTC).
const MON_0910 = new Date("2026-11-09T17:10:00Z");
const on = { ...DEFAULT_SCHEDULE, enabled: true };

describe("when the schedule runs", () => {
  it("reads the local day and time", () => {
    expect(localClock(MON_0910, "America/Los_Angeles")).toEqual({ date: "2026-11-09", day: "mon", minutes: 9 * 60 + 10 });
  });

  it("is due on a chosen day within the hour after the time, once", () => {
    expect(isDue(on, MON_0910)).toBe(true);
    expect(isDue({ ...on, lastRunOn: "2026-11-09" }, MON_0910)).toBe(false);
    expect(isDue({ ...on, time: "10:00" }, MON_0910)).toBe(false);
    expect(isDue({ ...on, days: ["tue"] }, MON_0910)).toBe(false);
    expect(isDue({ ...on, paused: true }, MON_0910)).toBe(false);
    expect(isDue(DEFAULT_SCHEDULE, MON_0910)).toBe(false);
    expect(isDue(on, new Date("2026-11-09T19:30:00Z"))).toBe(false); // 11:30, more than an hour late
  });

  it("says the next day it runs", () => {
    expect(nextRunOn(on, MON_0910)).toBe("2026-11-09");
    expect(nextRunOn({ ...on, lastRunOn: "2026-11-09" }, MON_0910)).toBe("2026-11-10");
    expect(nextRunOn({ ...on, days: ["sat"] }, MON_0910)).toBe("2026-11-14");
    expect(nextRunOn({ ...on, paused: true }, MON_0910)).toBeNull();
  });

  it("falls back to sensible values for anything malformed", () => {
    expect(readSchedule({ noriSchedule: { enabled: true, days: ["funday"], time: "25:00", timezone: "Mars/Base" } })).toMatchObject({ enabled: true, days: DEFAULT_SCHEDULE.days, time: "09:00", timezone: "America/Los_Angeles" });
  });
});

describe("running the schedules", () => {
  it("starts one batch of Recommended jobs within today's limit, and only once a day", async () => {
    const [u] = await t.db.insert(users).values({ email: "schedule@example.test", passwordHash: "x" }).returning();
    await saveNoriSettings(t.db, u!.id, { dailyLimit: 2, minFit: 0.7 });
    for (const [i, fit] of [0.9, 0.85, 0.8, 0.5].entries()) {
      const [c] = await t.db.insert(companies).values({ name: `Sched ${i}`, atsType: "greenhouse", atsToken: `sched-${i}` }).returning();
      const [j] = await t.db.insert(jobs).values({ companyId: c!.id, atsType: "greenhouse", externalId: `s${i}`, title: "Engineer", applyUrl: `https://job-boards.greenhouse.io/sched-${i}/jobs/${i}`, dedupeKey: `sched${i}`, postedAt: new Date(MON_0910.getTime() - 3_600_000), firstSeenAt: new Date(MON_0910.getTime() - 3_600_000) }).returning();
      await t.db.insert(shortlist).values({ userId: u!.id, jobId: j!.id, fit, fitMap: [], reasons: [], status: "new" });
      await placeInGroup(t.db, u!.id, j!.id, fit >= 0.8 ? "strong" : "stretch");
    }
    // Off: nothing happens.
    expect((await runSchedules(t.db, { now: MON_0910 })).filter((r) => r.userId === u!.id)).toEqual([]);

    await saveSchedule(t.db, u!.id, { enabled: true });
    const runs = (await runSchedules(t.db, { now: MON_0910 })).filter((r) => r.userId === u!.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.created).toHaveLength(2);
    const batches = await t.db.select().from(applyBatches).where(eq(applyBatches.userId, u!.id));
    expect(batches).toHaveLength(1);
    // Once a day.
    expect((await runSchedules(t.db, { now: new Date(MON_0910.getTime() + 60_000) })).filter((r) => r.userId === u!.id)).toEqual([]);
  });

  /** A person with the schedule on and these new matches, each placed in its apply decision group; returns the job ids. */
  async function scheduled(name: string, jobsIn: Array<{ group: keyof typeof DECISION_FIT_MAPS; hoursOld: number }>) {
    const [u] = await t.db.insert(users).values({ email: `${name}@example.test`, passwordHash: "x" }).returning();
    const ids: string[] = [];
    for (const [i, j] of jobsIn.entries()) {
      const at = new Date(MON_0910.getTime() - j.hoursOld * 3_600_000);
      const [c] = await t.db.insert(companies).values({ name: `${name} ${i}`, atsType: "greenhouse", atsToken: `${name}-${i}` }).returning();
      const [row] = await t.db.insert(jobs).values({ companyId: c!.id, atsType: "greenhouse", externalId: `${name}${i}`, title: "Backend Engineer", applyUrl: `https://job-boards.greenhouse.io/${name}-${i}/jobs/${i}`, dedupeKey: `${name}${i}`, postedAt: at, firstSeenAt: at }).returning();
      await t.db.insert(shortlist).values({ userId: u!.id, jobId: row!.id, fit: 0.8, fitMap: [], reasons: [], status: "new" });
      await placeInGroup(t.db, u!.id, row!.id, j.group);
      ids.push(row!.id);
    }
    await saveSchedule(t.db, u!.id, { enabled: true });
    return { userId: u!.id, ids };
  }
  const sentJobs = async (userId: string, now = MON_0910) => {
    const run = (await runSchedules(t.db, { now })).find((r) => r.userId === userId);
    if (!run?.created.length) return [];
    return (await t.db.select({ jobId: applications.jobId }).from(applications).where(eq(applications.userId, userId))).map((a) => a.jobId).sort();
  };
  const mix = [{ group: "strong", hoursOld: 3 }, { group: "worth_a_shot", hoursOld: 3 }, { group: "worth_a_shot", hoursOld: 72 }, { group: "stretch", hoursOld: 3 }, { group: "hard_no", hoursOld: 3 }] as const;

  it("on cautious sends only strong jobs", async () => {
    const p = await scheduled("cautious", [...mix]);
    await saveNoriSettings(t.db, p.userId, { aggressiveness: "cautious" });
    expect(await sentJobs(p.userId)).toEqual([p.ids[0]]);
  });

  it("on balanced also sends worth-a-shot jobs posted in the last 2 days, never a stretch or a hard no", async () => {
    const p = await scheduled("balanced", [...mix]);
    expect(await sentJobs(p.userId)).toEqual([p.ids[0], p.ids[1]].sort());
  });

  it("stops when the weekly pace is used up", async () => {
    const p = await scheduled("paced", [{ group: "strong", hoursOld: 3 }, { group: "strong", hoursOld: 3 }, { group: "strong", hoursOld: 3 }]);
    // Cautious: 10 a week; 9 approved in the last 7 days leave room for one.
    await saveNoriSettings(t.db, p.userId, { aggressiveness: "cautious" });
    const [c] = await t.db.insert(companies).values({ name: "Paced past", atsType: "greenhouse", atsToken: "paced-past" }).returning();
    for (let i = 0; i < 9; i++) {
      const [old] = await t.db.insert(jobs).values({ companyId: c!.id, atsType: "greenhouse", externalId: `pp${i}`, title: `Old ${i}`, applyUrl: `https://job-boards.greenhouse.io/pp/jobs/${i}`, dedupeKey: `pp${i}` }).returning();
      await t.db.insert(applications).values({ userId: p.userId, jobId: old!.id, status: "submitted", approvedAt: new Date(MON_0910.getTime() - (i + 2) * 86_400_000 / 2) , createdAt: new Date(MON_0910.getTime() - 90 * 86_400_000) });
    }
    const run = (await runSchedules(t.db, { now: MON_0910 })).find((r) => r.userId === p.userId);
    expect(run!.created).toHaveLength(1);
  });
});
