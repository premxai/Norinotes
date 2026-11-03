import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, companies, eq, inboxMessages, outcomes, resumes, shortlist, type Db } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import {
  NO_RESPONSE_DAYS, OUTCOME_REASON_PREFIX, addManualOutcome, fitBandOf, listOutcomes, loadOutcomeHistory, outcomeNudgeOf, removeOutcome,
  resolveApplication, summarizeOutcomes, syncInboxOutcomes, type OutcomeHistoryRow,
} from "./outcomes.js";
import { NOW, daysAgo, seedCompany, seedJob, seedUser } from "./test-helpers.js";

let t: TestDb;
let companyId: string;
beforeAll(async () => {
  t = await createTestDb();
  companyId = await seedCompany(t.db, { name: "Acme" });
});
afterAll(() => t.close());

async function submittedApp(db: Db, userId: string, o: { title?: string; submitted?: boolean; daysAgo?: number; company?: string } = {}) {
  const jobId = await seedJob(db, { companyId: o.company ?? companyId, title: o.title ?? "Data Analyst", closedAt: daysAgo(1) });
  const submitted = o.submitted ?? true;
  const [a] = await db.insert(applications).values({
    userId, jobId, status: submitted ? "submitted" : "prepared", submittedAt: submitted ? daysAgo(o.daysAgo ?? 10) : null,
  }).returning();
  return a!;
}

let msgSeq = 0;
async function message(db: Db, userId: string, applicationId: string | null, kind: string, meta: Record<string, unknown> = { trusted: true }, receivedAt = daysAgo(5)) {
  const [m] = await db.insert(inboxMessages).values({
    userId, applicationId, kind: kind as never, fromAddress: "no-reply@acme.com", messageId: `<m${msgSeq++}@acme.com>`, subject: kind, body: "", meta, receivedAt,
  }).returning();
  return m!;
}

const rowsOf = (applicationId: string) => t.db.select().from(outcomes).where(eq(outcomes.applicationId, applicationId));

describe("recording outcomes from classified inbox messages", () => {
  it("writes one row per message, with its id, and is idempotent", async () => {
    const userId = await seedUser(t.db);
    const app = await submittedApp(t.db, userId);
    const m = await message(t.db, userId, app.id, "rejection");
    expect(await syncInboxOutcomes(t.db, { userId })).toMatchObject({ recorded: 1 });
    expect(await syncInboxOutcomes(t.db, { userId })).toMatchObject({ recorded: 0, linked: 0 });
    const rows = await rowsOf(app.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "rejection", source: "inbox", messageId: m.id, at: m.receivedAt, deletedAt: null });
  });

  it("maps each outcome kind, and gives the inbox's own row its message id instead of adding a second", async () => {
    const userId = await seedUser(t.db);
    const app = await submittedApp(t.db, userId);
    // The inbox records one row per application and kind as the mail arrives, without the message id.
    await t.db.insert(outcomes).values({ applicationId: app.id, kind: "interview", at: daysAgo(4) });
    const interview = await message(t.db, userId, app.id, "interview", { trusted: true }, daysAgo(4));
    await message(t.db, userId, app.id, "recruiter_reply");
    await message(t.db, userId, app.id, "offer");
    expect(await syncInboxOutcomes(t.db, { userId })).toMatchObject({ recorded: 2, linked: 1 });
    const rows = await rowsOf(app.id);
    expect(rows.map((r) => r.kind).sort()).toEqual(["interview", "offer", "reply"]);
    expect(rows.find((r) => r.kind === "interview")?.messageId).toBe(interview.id);
  });

  it("ignores unlinked, spam, untrusted and non-outcome mail, and applications never submitted", async () => {
    const userId = await seedUser(t.db);
    const app = await submittedApp(t.db, userId);
    const draft = await submittedApp(t.db, userId, { submitted: false });
    await message(t.db, userId, null, "rejection");
    await message(t.db, userId, app.id, "rejection", { trusted: true, spam: true });
    await message(t.db, userId, app.id, "interview", { trusted: false });
    await message(t.db, userId, app.id, "verification_code");
    await message(t.db, userId, app.id, "other");
    await message(t.db, userId, draft.id, "rejection");
    expect(await syncInboxOutcomes(t.db, { userId })).toMatchObject({ recorded: 0, linked: 0, confirmed: 0 });
    expect(await rowsOf(app.id)).toHaveLength(0);
    expect(await rowsOf(draft.id)).toHaveLength(0);
  });

  it("marks a confirmation as a receipt, not an outcome", async () => {
    const userId = await seedUser(t.db);
    const app = await submittedApp(t.db, userId);
    const m = await message(t.db, userId, app.id, "confirmation", { trusted: true }, daysAgo(9));
    expect(await syncInboxOutcomes(t.db, { userId })).toMatchObject({ confirmed: 1, recorded: 0 });
    expect(await syncInboxOutcomes(t.db, { userId })).toMatchObject({ confirmed: 0 });
    const [row] = await t.db.select().from(applications).where(eq(applications.id, app.id));
    expect(row?.confirmedAt).toEqual(m.receivedAt);
    expect(row?.receipt).toMatchObject({ confirmation: { messageId: m.id } });
    expect(await rowsOf(app.id)).toHaveLength(0);
  });

  it("follows a message the model later settled as another kind, or as no outcome", async () => {
    const userId = await seedUser(t.db);
    const app = await submittedApp(t.db, userId);
    const m = await message(t.db, userId, app.id, "rejection");
    await syncInboxOutcomes(t.db, { userId });
    await t.db.update(inboxMessages).set({ kind: "interview" }).where(eq(inboxMessages.id, m.id));
    expect(await syncInboxOutcomes(t.db, { userId })).toMatchObject({ corrected: 1 });
    expect((await rowsOf(app.id)).map((r) => r.kind)).toEqual(["interview"]);
    await t.db.update(inboxMessages).set({ kind: "other" }).where(eq(inboxMessages.id, m.id));
    await syncInboxOutcomes(t.db, { userId });
    expect(await rowsOf(app.id)).toHaveLength(0);
  });

  it("only touches the given user", async () => {
    const a = await seedUser(t.db);
    const b = await seedUser(t.db);
    const appB = await submittedApp(t.db, b);
    await message(t.db, b, appB.id, "rejection");
    expect(await syncInboxOutcomes(t.db, { userId: a })).toMatchObject({ recorded: 0 });
    expect(await rowsOf(appB.id)).toHaveLength(0);
  });
});

describe("manual outcomes", () => {
  it("adds once per kind, removes softly, and a removed automatic outcome never comes back", async () => {
    const userId = await seedUser(t.db);
    const app = await submittedApp(t.db, userId);
    const first = await addManualOutcome(t.db, app.id, "reply", daysAgo(3));
    expect(first).toMatchObject({ created: true, outcome: { kind: "reply", source: "manual", messageId: null } });
    expect(await addManualOutcome(t.db, app.id, "reply", daysAgo(2))).toMatchObject({ created: false, outcome: { id: first.outcome.id } });

    // A wrong automatic rejection: the user removes it and says it was an interview.
    await message(t.db, userId, app.id, "rejection");
    await syncInboxOutcomes(t.db, { userId });
    const wrong = (await listOutcomes(t.db, app.id)).find((o) => o.kind === "rejection")!;
    expect(await removeOutcome(t.db, app.id, wrong.id, NOW)).toBe(true);
    expect(await removeOutcome(t.db, app.id, wrong.id, NOW)).toBe(false);
    await addManualOutcome(t.db, app.id, "interview", daysAgo(1));
    await syncInboxOutcomes(t.db, { userId });
    expect((await listOutcomes(t.db, app.id)).map((o) => o.kind)).toEqual(["reply", "interview"]);
    // The row is kept (with deleted_at) so the message stays accounted for.
    expect((await rowsOf(app.id)).filter((r) => r.deletedAt !== null)).toHaveLength(1);
  });

  it("will not remove another application's outcome", async () => {
    const userId = await seedUser(t.db);
    const a = await submittedApp(t.db, userId);
    const b = await submittedApp(t.db, userId);
    const o = await addManualOutcome(t.db, a.id, "offer", daysAgo(1));
    expect(await removeOutcome(t.db, b.id, o.outcome.id, NOW)).toBe(false);
    expect(await listOutcomes(t.db, a.id)).toHaveLength(1);
  });
});

describe("no-response derivation", () => {
  const at = (days: number) => ({ kind: "rejection" as const, at: daysAgo(days) });
  it("is pending under 30 days of silence, no response from 30 days, and never stored", () => {
    expect(resolveApplication({ submittedAt: daysAgo(NO_RESPONSE_DAYS - 1), outcomes: [] }, NOW)).toMatchObject({ state: "pending", settled: false });
    expect(resolveApplication({ submittedAt: daysAgo(NO_RESPONSE_DAYS), outcomes: [] }, NOW)).toMatchObject({ state: "no_response", settled: true, responded: false });
  });
  it("takes the best outcome and the days to the first one", () => {
    const r = resolveApplication({ submittedAt: daysAgo(40), outcomes: [{ kind: "reply", at: daysAgo(30) }, { kind: "interview", at: daysAgo(25) }, at(10)] }, NOW);
    expect(r).toMatchObject({ state: "interview", responded: true, interviewed: true, rejected: true, daysToFirstReply: 10 });
    expect(resolveApplication({ submittedAt: daysAgo(3), outcomes: [at(1)] }, NOW)).toMatchObject({ state: "rejection", settled: true, daysToFirstReply: 2 });
  });
});

describe("summary", () => {
  const row = (o: Partial<OutcomeHistoryRow> & { days?: number; got?: Array<["reply" | "interview" | "rejection" | "offer", number]> }): OutcomeHistoryRow => ({
    applicationId: "a", userId: "u", jobId: "j", title: "Data Analyst", companyName: "Acme", system: "greenhouse", roleFamily: "data_analysis",
    seniority: "unknown", boardSize: "unknown", submittedAt: daysAgo(o.days ?? 45), confirmedAt: null, fit: 0.7, band: "0.6-0.8", tailoring: "v1",
    outcomes: (o.got ?? []).map(([kind, d]) => ({ kind, at: daysAgo(d) })), ...o,
  });

  it("shows counts, never percentages, under 5 settled applications", () => {
    const s = summarizeOutcomes([row({ got: [["reply", 40]] }), row({}), row({ days: 3 })], NOW);
    expect(s.overall).toMatchObject({
      applications: 3, settled: 2, pending: 1, responses: 1, noResponse: 1, responseRate: null, interviewRate: null, rejectionRate: null,
      medianDaysToFirstReply: null, smallSample: true,
    });
    expect(s.minSample).toBe(5);
  });

  it("gives rates over settled applications, by system, role family, fit band and resume", () => {
    const rows = [
      row({ got: [["reply", 41]] }), row({ got: [["interview", 40], ["rejection", 30]] }), row({ got: [["rejection", 35]] }), row({ got: [["offer", 42]] }),
      row({ got: [["reply", 37]] }), row({}), row({ days: 2 }),
      row({ system: "lever", band: "widened", tailoring: "off", roleFamily: "sales" }),
    ];
    const s = summarizeOutcomes(rows, NOW);
    expect(s.overall).toMatchObject({ applications: 8, settled: 7, pending: 1, responses: 5, interviews: 2, rejections: 2, offers: 1, noResponse: 2, smallSample: false });
    expect(s.overall.responseRate).toBeCloseTo(5 / 7, 3);
    expect(s.overall.interviewRate).toBeCloseTo(2 / 7, 3);
    expect(s.overall.rejectionRate).toBeCloseTo(2 / 7, 3);
    // Days to first reply: 4, 5, 10, 3, 8 -> median 5.
    expect(s.overall.medianDaysToFirstReply).toBe(5);
    expect(s.bySystem.map((g) => [g.key, g.applications, g.smallSample])).toEqual([["greenhouse", 7, false], ["lever", 1, true]]);
    expect(s.bySystem[1]).toMatchObject({ responseRate: null, noResponse: 1 });
    expect(s.byFitBand.map((g) => g.key)).toEqual(["0.6-0.8", "widened"]);
    expect(s.byResume.map((g) => g.key)).toEqual(["v1", "off"]);
    expect(s.byRoleFamily.map((g) => g.key)).toEqual(["data_analysis", "sales"]);
  });

  it("bands fit: widened apart, then 0.8+, 0.6-0.8, under 0.6, unranked", () => {
    expect([fitBandOf(0.85, false), fitBandOf(0.8, false), fitBandOf(0.6, false), fitBandOf(0.59, false), fitBandOf(0.9, true), fitBandOf(null, false)])
      .toEqual(["0.8+", "0.8+", "0.6-0.8", "under 0.6", "widened", "unranked"]);
    expect(outcomeNudgeOf(["Fits", `${OUTCOME_REASON_PREFIX}3 of 4 data analysis applications led to a reply or interview, against 5 of 12 overall (+0.02 fit)`])).toBe(0.02);
    expect(outcomeNudgeOf([`${OUTCOME_REASON_PREFIX}x (-0.05 fit)`])).toBe(-0.05);
    expect(outcomeNudgeOf(["widened:remote"])).toBe(0);
  });

  it("loads history from the database: raw fit band, widened rows, and the recorded tailoring version", async () => {
    const userId = await seedUser(t.db);
    const big = await seedCompany(t.db, { name: "Bigco" });
    await t.db.update(companies).set({ lastJobCount: 400 }).where(eq(companies.id, big));
    const nudged = await submittedApp(t.db, userId, { company: big });
    const widened = await submittedApp(t.db, userId, { title: "Sales Development Representative" });
    const plain = await submittedApp(t.db, userId, { daysAgo: 50 });
    const unsubmitted = await submittedApp(t.db, userId, { submitted: false });
    // Stored fit 0.82 includes a +0.03 nudge: the raw fit is 0.79, band 0.6-0.8.
    await t.db.insert(shortlist).values([
      { userId, jobId: nudged.jobId, fit: 0.82, reasons: ["Strong SQL", `${OUTCOME_REASON_PREFIX}x (+0.03 fit)`], status: "applied" },
      { userId, jobId: widened.jobId, fit: 0.9, reasons: ["widened:role_pool"], status: "applied" },
    ]);
    const [tailored] = await t.db.insert(resumes).values({ applicationId: nudged.id, content: {}, atsChecks: { score: 80, tailoring: { version: 1, model: "gpt-4.1" } } }).returning();
    const [selection] = await t.db.insert(resumes).values({ applicationId: widened.id, content: {}, atsChecks: { tailoring: { version: 1, model: null } } }).returning();
    await t.db.update(applications).set({ resumeId: tailored!.id }).where(eq(applications.id, nudged.id));
    await t.db.update(applications).set({ resumeId: selection!.id }).where(eq(applications.id, widened.id));
    await addManualOutcome(t.db, plain.id, "rejection", daysAgo(40));

    expect((await syncInboxOutcomes(t.db, { userId })).stamped).toBe(3);
    // Recorded once: a later change to the resume does not rewrite history.
    await t.db.update(resumes).set({ atsChecks: {} }).where(eq(resumes.id, tailored!.id));
    const history = await loadOutcomeHistory(t.db, { userId });
    expect(history.map((h) => h.applicationId).sort()).toEqual([nudged.id, widened.id, plain.id].sort());
    expect(history.some((h) => h.applicationId === unsubmitted.id)).toBe(false);
    const by = new Map(history.map((h) => [h.applicationId, h]));
    expect(by.get(nudged.id)).toMatchObject({ fit: 0.79, band: "0.6-0.8", tailoring: "v1", boardSize: "large", roleFamily: "data_analysis" });
    expect(by.get(widened.id)).toMatchObject({ band: "widened", tailoring: "v1-selection", roleFamily: "sales" });
    expect(by.get(plain.id)).toMatchObject({ band: "unranked", tailoring: "off", outcomes: [{ kind: "rejection" }] });
  });
});
