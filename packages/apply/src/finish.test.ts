import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { applications, companies, eq, jobs, resumes, runEvents, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import {
  createApplication, createMemoryInputBus, finishApplications, LiveInput, applyLiveInput, CompanyGate,
  type BrowserPool, type Driver, type DriverContext, type FillResult, type FinishDeps, type LiveInputBus, type PoolRunOptions, type SubmitResult,
} from "./index.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());
const savedEnv = process.env.ALLOW_REAL_SUBMIT;
beforeEach(() => { process.env.ALLOW_REAL_SUBMIT = "true"; });
afterEach(() => {
  if (savedEnv === undefined) delete process.env.ALLOW_REAL_SUBMIT;
  else process.env.ALLOW_REAL_SUBMIT = savedEnv;
});

let seq = 0;
/** An application with one step left: prepared, approved, filled once, parked at a wall. */
async function parked(userId?: string) {
  const uid = userId ?? (await t.db.insert(users).values({ email: `f${++seq}@example.test`, passwordHash: "x" }).returning())[0]!.id;
  const [c] = await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: `fin-${++seq}`, name: `Finco ${seq}` }).returning();
  const [j] = await t.db.insert(jobs).values({ companyId: c!.id, atsType: "greenhouse", externalId: `fin-${seq}`, title: `Engineer ${seq}`, applyUrl: `https://boards.greenhouse.io/fin/jobs/${seq}`, dedupeKey: `fin-${seq}` }).returning();
  const res = await createApplication(t.db, uid, j!.id);
  if (!res.created) throw new Error("seed failed");
  const [r] = await t.db.insert(resumes).values({ applicationId: res.application.id, content: {}, pdfPath: "/tmp/resume.pdf" }).returning();
  await t.db.update(applications).set({ status: "ready_to_finish", resumeId: r!.id, approvedAt: new Date(), attempts: 3, error: "One step left", receipt: { totals: { fields: 2 } } })
    .where(eq(applications.id, res.application.id));
  return { userId: uid, id: res.application.id };
}
const getApp = async (id: string) => (await t.db.select().from(applications).where(eq(applications.id, id)))[0]!;
const steps = async (id: string) => (await t.db.select().from(runEvents).where(eq(runEvents.applicationId, id)).orderBy(runEvents.id)).map((e) => e.step);

/** A page with a wall the person can clear: scripts report it while `wall` is true; inputs are recorded. */
function fakePage() {
  const state = { wall: true, closed: false, inputs: [] as string[] };
  const page = {
    frames: () => [],
    mainFrame: () => null,
    isClosed: () => state.closed,
    evaluate: async () => (state.wall ? "wall" : null),
    viewportSize: () => ({ width: 1000, height: 800 }),
    mouse: { click: async (x: number, y: number) => { state.inputs.push(`click ${x},${y}`); }, wheel: async (_x: number, dy: number) => { state.inputs.push(`scroll ${dy}`); } },
    keyboard: { type: async (s: string) => { state.inputs.push(`type ${s.length}`); }, press: async (k: string) => { state.inputs.push(`press ${k}`); } },
    screenshot: async () => new Uint8Array(),
  };
  return { page: page as unknown as Page, state };
}

function sessionPool(page: Page) {
  const runs: PoolRunOptions[] = [];
  const pool: BrowserPool = {
    artifactsDir: "/tmp/artifacts",
    async run(_label, fn, opts = {}) {
      runs.push(opts);
      return { value: await fn(page, { context: {} as never, keepArtifacts: () => {}, screenshot: async () => undefined }), artifacts: {} };
    },
    warmUp: async () => {},
    stats: () => ({ size: 1, active: 0, waiting: 0, browserLaunched: true, launches: 1 }),
    close: async () => {},
  };
  return { pool, runs };
}

const filled = (): FillResult => ({ status: "filled", formUrl: "https://x.test/form", durationMs: 1, pending: [], fields: [{ label: "First Name", value: "Ada", kind: "text" }], files: [] });
const submitted = (): SubmitResult => ({ status: "submitted", submitClicked: true, confirmationText: "Thank you for applying.", durationMs: 1 });

/** A driver whose form shows `kind`'s wall until the person clears it (only when the wall is still up). */
function wallDriver(kind: "captcha" | "account", state: { wall: boolean }, calls: DriverContext[] = []): Driver {
  return {
    name: "greenhouse", detect: () => true, formUrl: () => null,
    async fill(_page, ctx) {
      calls.push(ctx);
      if (state.wall && !(await ctx.handoff?.(kind))) return { ...filled(), status: "needs_user", needsUser: { kind, reason: "wall" } };
      return filled();
    },
    async submit(_page, ctx) { ctx.onEvent("submit", "Clicking Submit"); return submitted(); },
  };
}

function finishDeps(pool: BrowserPool, driver: Driver, inputs: LiveInputBus, over: Partial<FinishDeps> = {}): FinishDeps {
  return {
    pool, inputs, drivers: [driver], companyGate: new CompanyGate(0), handoffPollMs: 20, handoffTimeoutMs: 5000,
    preparer: { prepare: async () => ({ outcome: "prepared" as const }) },
    loadInputs: async () => ({ applyUrl: "https://boards.greenhouse.io/fin/jobs/1", jobTitle: "Engineer", companyName: `Co ${++seq}`, resumePdfPath: "/tmp/resume.pdf", answers: {}, profile: { fullName: "Test Applicant", firstName: "Test", lastName: "Applicant", email: "test@example.test", workAuth: {} } }),
    ...over,
  };
}

/** Waits until the application's receipt says Nori is waiting for the person. */
async function handoffOpen(id: string) {
  for (let i = 0; i < 200; i++) {
    const row = await getApp(id);
    if (row.receipt?.handoff) return row.receipt.handoff as { kind: string };
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no hand-off");
}

describe("Finish in the live view", () => {
  it("hands the captcha to the person, plays their inputs, carries on once it's gone, and submits", async () => {
    const { userId, id } = await parked();
    const { page, state } = fakePage();
    const { pool, runs } = sessionPool(page);
    const inputs = createMemoryInputBus();
    const running = finishApplications(t.db, userId, [id], finishDeps(pool, wallDriver("captcha", state), inputs));

    expect(await handoffOpen(id)).toMatchObject({ kind: "captcha" });
    expect((await getApp(id)).status).toBe("applying");
    await inputs.publish(id, { kind: "click", x: 0.5, y: 0.25 });
    await inputs.publish(id, { kind: "type", text: "hunter2" });
    await inputs.publish(id, { kind: "key", key: "Enter" });
    state.wall = false;
    await inputs.publish(id, { kind: "done" });

    const [res] = await running;
    expect(res).toMatchObject({ applicationId: id, status: "submitted" });
    expect(state.inputs).toEqual(["click 500,200", "type 7", "press Enter"]);
    const row = await getApp(id);
    expect(row.receipt?.handoff).toBeFalsy();
    expect(row.attempts).toBe(1);
    // A fresh context with nothing recorded, closed when the session ends.
    expect(runs).toEqual([expect.objectContaining({ personal: true, owner: userId })]);
    const s = await steps(id);
    expect(s).toEqual(expect.arrayContaining(["status:applying", "handoff", "handoff_done", "submit", "status:submitted"]));
    // What the person typed is never written anywhere.
    const events = await t.db.select().from(runEvents).where(eq(runEvents.applicationId, id));
    expect(JSON.stringify(events)).not.toContain("hunter2");
    expect(JSON.stringify(row)).not.toContain("hunter2");
  });

  it("notices on its own when the wall is gone, without a done", async () => {
    const { userId, id } = await parked();
    const { page, state } = fakePage();
    const inputs = createMemoryInputBus();
    const running = finishApplications(t.db, userId, [id], finishDeps(sessionPool(page).pool, wallDriver("captcha", state), inputs));
    await handoffOpen(id);
    state.wall = false;
    expect((await running)[0]).toMatchObject({ status: "submitted" });
  });

  it("goes back to one step left when the person stops, or nobody takes the step in time", async () => {
    const stopped = await parked();
    const a = fakePage();
    const inputs = createMemoryInputBus();
    const running = finishApplications(t.db, stopped.userId, [stopped.id], finishDeps(sessionPool(a.page).pool, wallDriver("account", a.state), inputs));
    await handoffOpen(stopped.id);
    await inputs.publish(stopped.id, { kind: "cancel" });
    expect((await running)[0]).toMatchObject({ status: "ready_to_finish" });
    expect(await getApp(stopped.id)).toMatchObject({ status: "ready_to_finish", error: expect.stringMatching(/sign in/) });

    const idle = await parked();
    const b = fakePage();
    const res = await finishApplications(t.db, idle.userId, [idle.id], finishDeps(sessionPool(b.page).pool, wallDriver("captcha", b.state), createMemoryInputBus(), { handoffTimeoutMs: 100 }));
    expect(res[0]).toMatchObject({ status: "ready_to_finish" });
    expect((await getApp(idle.id)).receipt?.handoff).toBeFalsy();
    expect(await steps(idle.id)).toContain("handoff_done");
  });

  it("one sign-in covers the next application in the same session", async () => {
    const first = await parked();
    const second = await parked(first.userId);
    const { page, state } = fakePage();
    const { pool, runs } = sessionPool(page);
    const calls: DriverContext[] = [];
    const inputs = createMemoryInputBus();
    const running = finishApplications(t.db, first.userId, [first.id, second.id], finishDeps(pool, wallDriver("account", state, calls), inputs));
    await handoffOpen(first.id);
    state.wall = false; // signed in
    await inputs.publish(first.id, { kind: "done" });
    const res = await running;
    expect(res.map((r) => r.status)).toEqual(["submitted", "submitted"]);
    expect(runs).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(await steps(second.id)).not.toContain("handoff");
  });

  it("takes only the person's own applications with one step left", async () => {
    const mine = await parked();
    const theirs = await parked();
    await t.db.update(applications).set({ status: "prepared" }).where(eq(applications.id, mine.id));
    const { page, state } = fakePage();
    const res = await finishApplications(t.db, mine.userId, [mine.id, theirs.id], finishDeps(sessionPool(page).pool, wallDriver("captcha", state), createMemoryInputBus()));
    expect(res).toEqual([expect.objectContaining({ status: "prepared", advanced: false }), expect.objectContaining({ status: "missing" })]);
    expect((await getApp(theirs.id)).status).toBe("ready_to_finish");
  });

  it("a run that breaks in a session waits for the next Finish instead of a background retry", async () => {
    const { userId, id } = await parked();
    const { page } = fakePage();
    const broken: Driver = { name: "greenhouse", detect: () => true, formUrl: () => null, fill: async () => { throw new Error("page crashed"); }, submit: async () => submitted() };
    const res = await finishApplications(t.db, userId, [id], finishDeps(sessionPool(page).pool, broken, createMemoryInputBus()));
    expect(res[0]).toMatchObject({ status: "ready_to_finish" });
    expect((await getApp(id)).error).toMatch(/page crashed.*Press Finish/);
  });
});

describe("live inputs", () => {
  it("accepts clicks, text, a short list of keys, scroll, done and cancel; nothing else", () => {
    expect(LiveInput.safeParse({ kind: "click", x: 0.1, y: 1 }).success).toBe(true);
    expect(LiveInput.safeParse({ kind: "click", x: 1.5, y: 0 }).success).toBe(false);
    expect(LiveInput.safeParse({ kind: "type", text: "x".repeat(201) }).success).toBe(false);
    expect(LiveInput.safeParse({ kind: "key", key: "Enter", shift: true }).success).toBe(true);
    expect(LiveInput.safeParse({ kind: "key", key: "Control+A" }).success).toBe(false);
    expect(LiveInput.safeParse({ kind: "eval", js: "1" }).success).toBe(false);
  });

  it("the memory bus delivers to subscribers of that application only, until they unsubscribe", async () => {
    const bus = createMemoryInputBus();
    const got: string[] = [];
    const off = await bus.subscribe("a", (i) => got.push(i.kind));
    await bus.publish("b", { kind: "done" });
    await bus.publish("a", { kind: "cancel" });
    await off();
    await bus.publish("a", { kind: "done" });
    expect(got).toEqual(["cancel"]);
  });

  it("plays keys with shift and space", async () => {
    const { page, state } = fakePage();
    await applyLiveInput(page, { kind: "key", key: "Tab", shift: true });
    await applyLiveInput(page, { kind: "key", key: "Space" });
    await applyLiveInput(page, { kind: "scroll", dy: 300 });
    expect(state.inputs).toEqual(["press Shift+Tab", "press  ", "scroll 300"]);
  });
});
