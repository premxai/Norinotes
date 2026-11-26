import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, applications, companies, eq, jobs, runEvents, shortlist, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { saveNoriSettings } from "./batch.js";
import { DEFAULT_SCHEDULE, saveSchedule } from "./schedule.js";
import { autopilotSendsStrongFit, autopilotStrongFit, newStrongFits, prepareStrongFitsAhead, STRONG_FIT_STEP } from "./strong-fit.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());

const NOW = new Date("2026-11-26T18:00:00Z");
let seq = 0;
async function user() {
  const [u] = await t.db.insert(users).values({ email: `strong${seq++}@example.test`, passwordHash: "x" }).returning();
  return u!.id;
}
async function job(company: string, opts: { companyId?: string; atsType?: "greenhouse" | "workday" } = {}) {
  const n = seq++;
  const atsType = opts.atsType ?? "greenhouse";
  const companyId = opts.companyId ?? (await t.db.insert(companies).values({ name: company, atsType, atsToken: `c${n}` }).returning())[0]!.id;
  const [j] = await t.db.insert(jobs).values({ companyId, atsType, externalId: `e${n}`, title: `Engineer ${n}`, applyUrl: `https://job-boards.greenhouse.io/x/jobs/${n}`, dedupeKey: `k${n}` }).returning();
  return { id: j!.id, companyId };
}
const fitOn = (userId: string, jobId: string, fit: number, status: "new" | "dismissed" = "new") =>
  t.db.insert(shortlist).values({ userId, jobId, fit, status });

describe("newStrongFits", () => {
  it("returns the new shortlist rows at 0.8 or more for these jobs, best first", async () => {
    const u = await user();
    const [a, b, c, d] = [await job("A"), await job("B"), await job("C"), await job("D")];
    await fitOn(u, a.id, 0.81);
    await fitOn(u, b.id, 0.79);
    await fitOn(u, c.id, 0.95);
    await fitOn(u, d.id, 0.9, "dismissed");
    expect(await newStrongFits(t.db, [a.id, b.id, c.id, d.id])).toEqual([{ userId: u, jobId: c.id, fit: 0.95 }, { userId: u, jobId: a.id, fit: 0.81 }]);
    expect(await newStrongFits(t.db, [])).toEqual([]);
  });
});

describe("prepareStrongFitsAhead", () => {
  it("creates an application per strong fit, marked as prepared ahead, and the job leaves the list", async () => {
    const u = await user();
    const a = await job("Alpha");
    await fitOn(u, a.id, 0.9);
    const res = await prepareStrongFitsAhead(t.db, u, await newStrongFits(t.db, [a.id]), { now: NOW });
    expect(res.created).toEqual([{ jobId: a.id, applicationId: expect.any(String), fit: 0.9 }]);
    const [app] = await t.db.select().from(applications).where(eq(applications.id, res.created[0]!.applicationId));
    expect(app).toMatchObject({ status: "queued", approvedAt: null });
    expect((await t.db.select().from(runEvents).where(and(eq(runEvents.applicationId, app!.id), eq(runEvents.step, STRONG_FIT_STEP)))).length).toBe(1);
    expect((await t.db.select().from(shortlist).where(and(eq(shortlist.userId, u), eq(shortlist.jobId, a.id))))[0]!.status).toBe("applied");
  });

  it("follows the batch rules: skip list, recent company, one per company, job systems, only this person's fits", async () => {
    const u = await user();
    const other = await user();
    await saveNoriSettings(t.db, u, { skipCompanies: ["Skipme"] });
    const good = await job("Good");
    const sameCompany = await job("Good", { companyId: good.companyId });
    const skipped = await job("Skipme Inc");
    const workday = await job("Wd", { atsType: "workday" });
    const recent = await job("Recent");
    const recentOther = await job("Recent", { companyId: recent.companyId });
    await t.db.insert(applications).values({ userId: u, jobId: recentOther.id, status: "submitted", createdAt: NOW });
    for (const j of [good, sameCompany, skipped, workday, recent]) await fitOn(u, j.id, 0.85);
    await fitOn(other, good.id, 0.85);
    const fits = await newStrongFits(t.db, [good.id, sameCompany.id, skipped.id, workday.id, recent.id]);
    const res = await prepareStrongFitsAhead(t.db, u, fits, { now: NOW, atsTypes: ["greenhouse"] });
    expect(res.created.map((c) => c.jobId)).toEqual([expect.any(String)]);
    expect([good.id, sameCompany.id]).toContain(res.created[0]!.jobId);
    expect(res.skipped).toEqual(expect.arrayContaining([
      { jobId: skipped.id, reason: "skipped_company" }, { jobId: workday.id, reason: "not_supported" }, { jobId: recent.id, reason: "applied_recently" },
    ]));
    expect(res.skipped.some((s) => s.reason === "same_company")).toBe(true);
    expect((await t.db.select().from(applications).where(eq(applications.userId, other))).length).toBe(0);
  });

  it("prepares at most the daily limit of strong fits ahead in a day", async () => {
    const u = await user();
    await saveNoriSettings(t.db, u, { dailyLimit: 2 });
    const js = [await job("P"), await job("Q"), await job("R")];
    for (const j of js) await fitOn(u, j.id, 0.9);
    const first = await prepareStrongFitsAhead(t.db, u, await newStrongFits(t.db, [js[0]!.id, js[1]!.id]), { now: NOW });
    expect(first.created.length).toBe(2);
    const second = await prepareStrongFitsAhead(t.db, u, await newStrongFits(t.db, [js[2]!.id]), { now: NOW });
    expect(second).toEqual({ created: [], skipped: [{ jobId: js[2]!.id, reason: "daily_limit" }] });
    const tomorrow = await prepareStrongFitsAhead(t.db, u, await newStrongFits(t.db, [js[2]!.id]), { now: new Date(NOW.getTime() + 86_400_000) });
    expect(tomorrow.created.length).toBe(1);
  });
});

describe("autopilot for strong fits", () => {
  /** A strong fit Nori prepared ahead for this person, now prepared and waiting. */
  async function preparedAhead(userId: string, company = "Auto", companyId?: string) {
    const j = await job(company, companyId ? { companyId } : {});
    await fitOn(userId, j.id, 0.9);
    const res = await prepareStrongFitsAhead(t.db, userId, await newStrongFits(t.db, [j.id]), { now: NOW });
    const id = res.created[0]!.applicationId;
    await t.db.update(applications).set({ status: "prepared", preparedAt: NOW }).where(eq(applications.id, id));
    return { id, job: j };
  }
  const statusOf = async (id: string) => (await t.db.select().from(applications).where(eq(applications.id, id)))[0]!;

  it("decides in one predicate: schedule on, not paused, fit 0.8 or more", () => {
    const on = { ...DEFAULT_SCHEDULE, enabled: true };
    expect(autopilotSendsStrongFit({ schedule: on, fit: 0.85 })).toBe(true);
    expect(autopilotSendsStrongFit({ schedule: on, fit: 0.79 })).toBe(false);
    expect(autopilotSendsStrongFit({ schedule: on, fit: null })).toBe(false);
    expect(autopilotSendsStrongFit({ schedule: { ...on, paused: true }, fit: 0.9 })).toBe(false);
    expect(autopilotSendsStrongFit({ schedule: DEFAULT_SCHEDULE, fit: 0.9 })).toBe(false);
  });

  it("sends a prepared strong fit at once when the schedule is on, and never when it is off or paused", async () => {
    const off = await user();
    const a = await preparedAhead(off);
    expect(await autopilotStrongFit(t.db, a.id, { now: NOW })).toEqual({ started: false, reason: "autopilot_off" });
    await saveSchedule(t.db, off, { enabled: true, paused: true });
    expect(await autopilotStrongFit(t.db, a.id, { now: NOW })).toEqual({ started: false, reason: "autopilot_off" });
    expect(await statusOf(a.id)).toMatchObject({ status: "prepared", approvedAt: null });

    await saveSchedule(t.db, off, { paused: false });
    expect(await autopilotStrongFit(t.db, a.id, { now: NOW })).toEqual({ started: true });
    expect(await statusOf(a.id)).toMatchObject({ status: "applying", approvedAt: NOW });
    // Asked again (a retried job): nothing more happens.
    expect(await autopilotStrongFit(t.db, a.id, { now: NOW })).toEqual({ started: false, reason: "not_waiting" });
  });

  it("leaves alone an application the person prepared themselves", async () => {
    const u = await user();
    await saveSchedule(t.db, u, { enabled: true });
    const j = await job("Own");
    await fitOn(u, j.id, 0.95);
    const [app] = await t.db.insert(applications).values({ userId: u, jobId: j.id, status: "prepared", preparedAt: NOW }).returning();
    expect(await autopilotStrongFit(t.db, app!.id, { now: NOW })).toEqual({ started: false, reason: "not_strong_fit" });
  });

  it("stays within the daily limit, the company cooldown, the skip list and the job systems", async () => {
    const u = await user();
    await saveSchedule(t.db, u, { enabled: true });
    const first = await preparedAhead(u, "One");
    const second = await preparedAhead(u, "Two");
    await saveNoriSettings(t.db, u, { dailyLimit: 1 });
    expect(await autopilotStrongFit(t.db, second.id, { now: NOW, atsTypes: ["lever"] })).toEqual({ started: false, reason: "not_supported" });
    expect(await autopilotStrongFit(t.db, first.id, { now: NOW })).toEqual({ started: true });
    expect(await autopilotStrongFit(t.db, second.id, { now: NOW })).toEqual({ started: false, reason: "daily_limit" });
    expect(await statusOf(second.id)).toMatchObject({ status: "prepared", approvedAt: null });

    const v = await user();
    await saveSchedule(t.db, v, { enabled: true });
    const sameCompany = await preparedAhead(v, "Cool");
    await t.db.insert(applications).values({ userId: v, jobId: (await job("Cool", { companyId: sameCompany.job.companyId })).id, status: "submitted", createdAt: NOW });
    expect(await autopilotStrongFit(t.db, sameCompany.id, { now: NOW })).toEqual({ started: false, reason: "applied_recently" });
    const skipped = await preparedAhead(v, "Skipme");
    await saveNoriSettings(t.db, v, { skipCompanies: ["Skipme"] });
    expect(await autopilotStrongFit(t.db, skipped.id, { now: NOW })).toEqual({ started: false, reason: "skipped_company" });
  });
});
