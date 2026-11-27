import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, applyBatches, companies, eq, jobs, profiles, shortlist, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { placeInGroup } from "@norinote/match/testing";
import { batchView, drainBatches, getNoriSettings, saveNoriSettings, startBatch } from "./batch.js";
import { isNoriPaused, readNoriPaused, setNoriPaused } from "./pause.js";
import { DEFAULT_SCHEDULE, getSchedule, runSchedules, saveSchedule } from "./schedule.js";
import { autopilotStrongFit, newStrongFits, prepareStrongFitsAhead } from "./strong-fit.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());

// Monday 2026-11-09, 09:10 in Los Angeles (17:10 UTC): ten minutes after the default 09:00 run.
const MON_0910 = new Date("2026-11-09T17:10:00Z");

let seq = 0;
async function user() {
  const [u] = await t.db.insert(users).values({ email: `pause${seq++}@example.test`, passwordHash: "x" }).returning();
  return u!.id;
}
async function company(name: string) {
  const n = seq++;
  const [c] = await t.db.insert(companies).values({ name, atsType: "greenhouse", atsToken: `pause-${n}` }).returning();
  return c!.id;
}
async function job(companyId: string, name = "Engineer") {
  const n = seq++;
  const [j] = await t.db.insert(jobs).values({
    companyId, atsType: "greenhouse", externalId: `pe${n}`, title: `${name} ${n}`,
    applyUrl: `https://job-boards.greenhouse.io/pause/jobs/${n}`, dedupeKey: `pk${n}`,
    postedAt: new Date(MON_0910.getTime() - 3_600_000), firstSeenAt: new Date(MON_0910.getTime() - 3_600_000),
  }).returning();
  return j!.id;
}
const statusOf = async (id: string) => (await t.db.select().from(applications).where(eq(applications.id, id)))[0]!;
const preparedAt = (id: string) => t.db.update(applications).set({ status: "prepared", preparedAt: MON_0910 }).where(eq(applications.id, id));

describe("the pause flag", () => {
  it("reads only its own key and writes only its own key", async () => {
    const u = await user();
    await saveNoriSettings(t.db, u, { dailyLimit: 7 });
    await saveSchedule(t.db, u, { enabled: true, time: "08:30" });

    expect(readNoriPaused(undefined)).toBe(false);
    expect(await isNoriPaused(t.db, u)).toBe(false);
    await setNoriPaused(t.db, u, true);
    expect(await isNoriPaused(t.db, u)).toBe(true);
    // Neither setting is disturbed.
    expect((await getNoriSettings(t.db, u)).dailyLimit).toBe(7);
    expect(await getSchedule(t.db, u)).toMatchObject({ enabled: true, time: "08:30" });
  });

  it("survives the scheduler marking a day as run, and a pause write leaves the schedule alone", async () => {
    const u = await user();
    await saveSchedule(t.db, u, { enabled: true });
    await setNoriPaused(t.db, u, true);
    // The write the scheduler makes when it starts a run: it must not put the pause back to off.
    await saveSchedule(t.db, u, { lastRunOn: "2026-11-09" });
    expect(await isNoriPaused(t.db, u)).toBe(true);
    await setNoriPaused(t.db, u, false);
    expect(await getSchedule(t.db, u)).toMatchObject({ enabled: true, lastRunOn: "2026-11-09" });
    const [row] = await t.db.select({ preferences: profiles.preferences }).from(profiles).where(eq(profiles.userId, u));
    expect(row!.preferences).toMatchObject({ noriPaused: false });
  });
});

describe("what the pause stops", () => {
  it("starts no scheduled batch while paused, and starts it once resumed inside the hour", async () => {
    const u = await user();
    const c = await company("Sched Pause");
    await t.db.insert(shortlist).values({ userId: u, jobId: await job(c), fit: 0.9, fitMap: [], reasons: [], status: "new" });
    await placeInGroup(t.db, u, (await t.db.select({ id: shortlist.jobId }).from(shortlist).where(eq(shortlist.userId, u)))[0]!.id, "strong");
    await saveNoriSettings(t.db, u, { dailyLimit: 3 });
    await saveSchedule(t.db, u, { ...DEFAULT_SCHEDULE, enabled: true });

    await setNoriPaused(t.db, u, true);
    expect((await runSchedules(t.db, { now: MON_0910 })).filter((r) => r.userId === u)).toEqual([]);
    // Today was not marked as run: the pause held the run back rather than spending it.
    expect((await getSchedule(t.db, u)).lastRunOn).toBeNull();
    expect(await t.db.select().from(applyBatches).where(eq(applyBatches.userId, u))).toEqual([]);

    await setNoriPaused(t.db, u, false);
    const runs = (await runSchedules(t.db, { now: MON_0910 })).filter((r) => r.userId === u);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.created).toHaveLength(1);
  });

  it("sends nothing from a running batch while paused, and carries on after", async () => {
    const u = await user();
    const res = await startBatch(t.db, u, [await job(await company("Batch One")), await job(await company("Batch Two"))]);
    const ids = res.added.map((a) => a.applicationId);
    for (const id of ids) await preparedAt(id);
    const drain = async () => (await drainBatches(t.db, { now: MON_0910 })).filter((s) => s.batchId === res.batchId);
    const [batch] = await t.db.select().from(applyBatches).where(eq(applyBatches.id, res.batchId!));

    await setNoriPaused(t.db, u, true);
    expect(await drain()).toEqual([]);
    expect(await statusOf(ids[0]!)).toMatchObject({ status: "prepared", approvedAt: null });
    expect((await batchView(t.db, batch!, MON_0910)).waitingFor).toBe("paused");

    await setNoriPaused(t.db, u, false);
    expect((await drain()).map((s) => s.applicationId)).toEqual([ids[0]]);
  });

  it("prepares no strong fit ahead and sends none while paused", async () => {
    const u = await user();
    const j = await job(await company("Strong Pause"));
    await t.db.insert(shortlist).values({ userId: u, jobId: j, fit: 0.9, fitMap: [], reasons: [], status: "new" });
    await placeInGroup(t.db, u, j, "strong");
    await saveSchedule(t.db, u, { ...DEFAULT_SCHEDULE, enabled: true });

    await setNoriPaused(t.db, u, true);
    const fits = await newStrongFits(t.db, [j]);
    expect(await prepareStrongFitsAhead(t.db, u, fits, { now: MON_0910 })).toEqual({ created: [], skipped: [{ jobId: j, reason: "paused" }] });

    // A strong fit prepared before the pause is not sent by autopilot while it lasts.
    await setNoriPaused(t.db, u, false);
    const ahead = await prepareStrongFitsAhead(t.db, u, await newStrongFits(t.db, [j]), { now: MON_0910 });
    const id = ahead.created[0]!.applicationId;
    await preparedAt(id);
    await setNoriPaused(t.db, u, true);
    expect(await autopilotStrongFit(t.db, id, { now: MON_0910 })).toEqual({ started: false, reason: "paused" });
    expect(await statusOf(id)).toMatchObject({ status: "prepared", approvedAt: null });
  });
});
