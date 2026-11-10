import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, applyBatches, companies, eq, jobs, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { countBatch, drainBatches, readNoriSettings, saveNoriSettings, startBatch, stopBatch, batchView } from "./batch.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());

let seq = 0;
async function user() {
  const [u] = await t.db.insert(users).values({ email: `batch${seq++}@example.test`, passwordHash: "x" }).returning();
  return u!.id;
}
async function job(company: string, title = "Engineer") {
  const n = seq++;
  const [c] = await t.db.insert(companies).values({ name: company, atsType: "greenhouse", atsToken: `${company.toLowerCase().replace(/\W+/g, "-")}-${n}` }).returning();
  const [j] = await t.db.insert(jobs).values({ companyId: c!.id, atsType: "greenhouse", externalId: `e${n}`, title, applyUrl: `https://job-boards.greenhouse.io/x/jobs/${n}`, dedupeKey: `k${n}` }).returning();
  return j!.id;
}
async function jobAt(companyId: string, title: string) {
  const n = seq++;
  const [j] = await t.db.insert(jobs).values({ companyId, atsType: "greenhouse", externalId: `e${n}`, title, applyUrl: `https://job-boards.greenhouse.io/x/jobs/${n}`, dedupeKey: `k${n}` }).returning();
  return j!.id;
}
const statusOf = async (id: string) => (await t.db.select().from(applications).where(eq(applications.id, id)))[0]!;
const setStatus = (id: string, status: "prepared" | "submitted" | "needs_user", extra: Record<string, unknown> = {}) =>
  t.db.update(applications).set({ status, ...(status === "prepared" ? { preparedAt: new Date() } : {}), ...extra }).where(eq(applications.id, id));

describe("Nori settings", () => {
  it("has sensible defaults and keeps what the person saves", async () => {
    expect(readNoriSettings(undefined, 0)).toEqual({ spacingMinutes: 4, minFit: 0.7, skipCompanies: [], dailyLimit: 20 });
    const u = await user();
    const s = await saveNoriSettings(t.db, u, { spacingMinutes: 10, skipCompanies: ["Acme Inc"], dailyLimit: 5 });
    expect(s).toEqual({ spacingMinutes: 10, minFit: 0.7, skipCompanies: ["Acme Inc"], dailyLimit: 5 });
  });
});

describe("starting a batch", () => {
  it("takes one job per company, never a skipped company, adopts an unsent application and leaves a sent one", async () => {
    const u = await user();
    await saveNoriSettings(t.db, u, { skipCompanies: ["Skipme"] });
    const a = await job("Alpha");
    const [alpha] = await t.db.select({ c: jobs.companyId }).from(jobs).where(eq(jobs.id, a));
    const a2 = await jobAt(alpha!.c, "Senior Engineer");
    const b = await job("Beta");
    const skip = await job("Skipme Inc");
    const sentJob = await job("Gamma");
    const [sent] = await t.db.insert(applications).values({ userId: u, jobId: sentJob, status: "submitted", approvedAt: new Date() }).returning();
    const unsentJob = await job("Delta");
    const [unsent] = await t.db.insert(applications).values({ userId: u, jobId: unsentJob, status: "prepared" }).returning();

    const res = await startBatch(t.db, u, [a, a2, b, skip, sentJob, unsentJob, "00000000-0000-0000-0000-000000000000"]);
    expect(res.batchId).toBeTruthy();
    expect(res.added.map((x) => x.jobId).sort()).toEqual([a, b, unsentJob].sort());
    expect(res.added.find((x) => x.jobId === unsentJob)).toMatchObject({ applicationId: unsent!.id, created: false });
    expect(res.skipped).toEqual(expect.arrayContaining([
      { jobId: a2, reason: "same_company" }, { jobId: skip, reason: "skipped_company" },
      { jobId: sentJob, reason: "already_applied" }, { jobId: "00000000-0000-0000-0000-000000000000", reason: "not_found" },
    ]));
    expect((await statusOf(sent!.id)).batchId).toBeNull();
    const [batch] = await t.db.select().from(applyBatches).where(eq(applyBatches.id, res.batchId!));
    expect(batch).toMatchObject({ status: "running", total: 3 });
  });

  it("takes only the job systems it is told to (the Greenhouse-only demo)", async () => {
    const u = await user();
    const gh = await job("Green Co");
    const [c] = await t.db.insert(companies).values({ name: "Lever Co", atsType: "lever", atsToken: `lever-co-${seq++}` }).returning();
    const n = seq++;
    const [lv] = await t.db.insert(jobs).values({ companyId: c!.id, atsType: "lever", externalId: `e${n}`, title: "Engineer", applyUrl: `https://jobs.lever.co/x/${n}`, dedupeKey: `k${n}` }).returning();
    const res = await startBatch(t.db, u, [gh, lv!.id], { atsTypes: ["greenhouse"] });
    expect(res.added.map((x) => x.jobId)).toEqual([gh]);
    expect(res.skipped).toEqual([{ jobId: lv!.id, reason: "not_supported" }]);
  });

  it("never sends an embedded form, nor a second job at a company applied to recently", async () => {
    const u = await user();
    const ok = await job("Fresh Co");
    const emb = await job("Embedded Co");
    await t.db.update(jobs).set({ applyUrl: "https://embedded.example/careers/1?gh_jid=1" }).where(eq(jobs.id, emb));
    const first = await job("Again Co");
    const [again] = await t.db.select({ c: jobs.companyId }).from(jobs).where(eq(jobs.id, first));
    await t.db.insert(applications).values({ userId: u, jobId: first, status: "submitted", approvedAt: new Date() });
    const second = await jobAt(again!.c, "Another Role");
    const res = await startBatch(t.db, u, [ok, emb, second]);
    expect(res.added.map((x) => x.jobId)).toEqual([ok]);
    expect(res.skipped).toEqual(expect.arrayContaining([{ jobId: emb, reason: "embedded_form" }, { jobId: second, reason: "applied_recently" }]));
  });

  it("makes no batch when nothing can be added", async () => {
    const u = await user();
    await saveNoriSettings(t.db, u, { skipCompanies: ["Nope"] });
    expect(await startBatch(t.db, u, [await job("Nope")])).toMatchObject({ batchId: null, added: [] });
  });
});

describe("sending a batch", () => {
  it("sends one at a time, spaced, within the daily limit, and finishes", async () => {
    const u = await user();
    await saveNoriSettings(t.db, u, { spacingMinutes: 5, dailyLimit: 2 });
    const res = await startBatch(t.db, u, [await job("One"), await job("Two"), await job("Three")]);
    const ids = res.added.map((x) => x.applicationId);
    // Other tests leave batches running; this one looks at its own batch only.
    const drain = async (now: Date) => (await drainBatches(t.db, { now })).filter((s) => s.batchId === res.batchId);
    const t0 = new Date("2026-11-07T15:00:00Z");

    // Nothing prepared yet: nothing starts.
    expect(await drain(t0)).toEqual([]);
    for (const id of ids) await setStatus(id, "prepared");

    const first = await drain(t0);
    expect(first).toEqual([{ batchId: res.batchId, applicationId: ids[0] }]);
    expect(await statusOf(ids[0]!)).toMatchObject({ status: "applying" });
    expect((await statusOf(ids[0]!)).approvedAt).toBeTruthy();
    // One on the page at a time.
    expect(await drain(new Date(t0.getTime() + 10 * 60_000))).toEqual([]);

    await setStatus(ids[0]!, "submitted", { submittedAt: t0 });
    // Spacing: 5 minutes from the last start.
    expect(await drain(new Date(t0.getTime() + 2 * 60_000))).toEqual([]);
    const [b1] = await t.db.select().from(applyBatches).where(eq(applyBatches.id, res.batchId!));
    expect((await batchView(t.db, b1!, new Date(t0.getTime() + 2 * 60_000))).waitingFor).toBe("spacing");
    const second = await drain(new Date(t0.getTime() + 6 * 60_000));
    expect(second.map((s) => s.applicationId)).toEqual([ids[1]]);
    await setStatus(ids[1]!, "submitted", { submittedAt: t0 });

    // Daily limit of 2 reached: the third waits.
    expect(await drain(new Date(t0.getTime() + 20 * 60_000))).toEqual([]);
    const [b2] = await t.db.select().from(applyBatches).where(eq(applyBatches.id, res.batchId!));
    expect((await batchView(t.db, b2!, new Date(t0.getTime() + 20 * 60_000))).waitingFor).toBe("daily_limit");

    // The next day it goes, then the batch is done.
    const nextDay = new Date(t0.getTime() + 24 * 3600_000);
    expect((await drain(nextDay)).map((s) => s.applicationId)).toEqual([ids[2]]);
    await setStatus(ids[2]!, "submitted", { submittedAt: nextDay });
    await drain(new Date(nextDay.getTime() + 60_000));
    const [done] = await t.db.select().from(applyBatches).where(eq(applyBatches.id, res.batchId!));
    expect(done!.status).toBe("done");
  });

  it("finishes with one parked, then carries on when the person answers it", async () => {
    const u = await user();
    const res = await startBatch(t.db, u, [await job("Parked Co")]);
    const id = res.added[0]!.applicationId;
    const drain = async (now: Date) => (await drainBatches(t.db, { now })).filter((s) => s.batchId === res.batchId);
    const batchRow = async () => (await t.db.select().from(applyBatches).where(eq(applyBatches.id, res.batchId!)))[0]!;
    await setStatus(id, "needs_user", { pendingQuestions: [{ id: "q", text: "Consent?", required: true }] });
    await drain(new Date());
    expect((await batchRow()).status).toBe("done");
    // Answered: prepared again, so the batch reopens and sends it.
    await setStatus(id, "prepared", { pendingQuestions: [] });
    expect((await drain(new Date())).map((s) => s.applicationId)).toEqual([id]);
    expect(await batchRow()).toMatchObject({ status: "running", finishedAt: null, notifiedAt: null });
  });

  it("leaves parked ones for the person, and Stop cancels what has not started", async () => {
    const u = await user();
    const res = await startBatch(t.db, u, [await job("P1"), await job("P2"), await job("P3")]);
    const [a, b, c] = res.added.map((x) => x.applicationId);
    await setStatus(a!, "submitted", { approvedAt: new Date() });
    await setStatus(b!, "needs_user", { pendingQuestions: [{ id: "q", text: "Why?", required: true }] });
    const stop = await stopBatch(t.db, u, res.batchId!);
    expect(stop).toEqual({ ok: true, cancelled: 2 });
    expect(await statusOf(a!)).toMatchObject({ status: "submitted" });
    expect(await statusOf(b!)).toMatchObject({ status: "failed", error: "Cancelled by you" });
    expect(await statusOf(c!)).toMatchObject({ status: "failed", error: "Cancelled by you" });
    const [batch] = await t.db.select().from(applyBatches).where(eq(applyBatches.id, res.batchId!));
    expect(batch!.status).toBe("stopped");
    const apps = await t.db.select().from(applications).where(eq(applications.batchId, res.batchId!));
    expect(countBatch(apps)).toMatchObject({ total: 3, sent: 1, cancelled: 2 });
    expect(await stopBatch(t.db, await user(), res.batchId!)).toEqual({ ok: false, cancelled: 0 });
  });
});
