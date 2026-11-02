import { describe, expect, it } from "vitest";
import { APPLICATION_STATUSES } from "@norinote/shared";
import {
  MAX_ATTEMPTS, TRANSITIONS, canTransition, checkTransition, isTerminal, submitMayHaveHappened, transitionPatch, unansweredQuestions,
  type AppSnapshot,
} from "./state.js";

const app = (over: Partial<AppSnapshot> = {}): AppSnapshot => ({
  status: "queued", resumeId: null, answers: {}, pendingQuestions: [], receipt: null, error: null, attempts: 0, approvedAt: null, ...over,
});
const q = (id: string, text = id, required = true) => ({ id, text, type: "text", options: [], required });

describe("transition table", () => {
  it("covers every status, and only with real statuses", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...APPLICATION_STATUSES].sort());
    for (const targets of Object.values(TRANSITIONS)) for (const t of targets) expect(APPLICATION_STATUSES).toContain(t);
  });

  it("follows queued -> preparing -> prepared -> applying -> awaiting_code -> submitted", () => {
    const path = ["queued", "preparing", "prepared", "applying", "awaiting_code", "submitted"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });

  it("rejects skipping steps and going backwards", () => {
    expect(canTransition("queued", "applying")).toBe(false);
    expect(canTransition("queued", "submitted")).toBe(false);
    expect(canTransition("preparing", "applying")).toBe(false);
    expect(canTransition("prepared", "submitted")).toBe(false);
    expect(canTransition("applying", "queued")).toBe(false);
    expect(canTransition("submitted", "applying")).toBe(false);
  });

  it("lets submitted and failed go nowhere on their own (failed only back to queued for the user)", () => {
    expect(TRANSITIONS.submitted).toEqual([]);
    expect(TRANSITIONS.failed).toEqual(["queued"]);
    expect(isTerminal("submitted")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("needs_user")).toBe(false);
  });
});

describe("guards", () => {
  it("refuses a no-op move", () => {
    expect(checkTransition(app({ status: "queued" }), "queued")).toEqual({ ok: false, reason: "already queued" });
  });

  it("prepared needs a resume", () => {
    expect(checkTransition(app({ status: "preparing" }), "prepared")).toMatchObject({ ok: false });
    expect(checkTransition(app({ status: "preparing", resumeId: "r1" }), "prepared")).toEqual({ ok: true });
  });

  it("applying needs the user's approval", () => {
    const prepared = app({ status: "prepared", resumeId: "r1" });
    expect(checkTransition(prepared, "applying")).toMatchObject({ ok: false, reason: expect.stringMatching(/not approved/) });
    expect(checkTransition({ ...prepared, approvedAt: new Date() }, "applying")).toEqual({ ok: true });
  });

  it("applying stops at the attempt limit, but awaiting_code -> applying does not count an attempt", () => {
    const base = app({ status: "prepared", approvedAt: new Date(), attempts: MAX_ATTEMPTS });
    expect(checkTransition(base, "applying")).toMatchObject({ ok: false, reason: expect.stringMatching(/attempt limit/) });
    expect(checkTransition({ ...base, status: "awaiting_code", receipt: { awaitingCode: true, submitClicked: true } }, "applying")).toEqual({ ok: true });
  });

  it("needs_user -> applying waits for every required question to be answered", () => {
    const parked = app({ status: "needs_user", approvedAt: new Date(), pendingQuestions: [q("why"), q("office"), q("nick", "Nickname", false)] });
    expect(checkTransition(parked, "applying")).toMatchObject({ ok: false, reason: expect.stringMatching(/2 required/) });
    expect(checkTransition({ ...parked, answers: { why: "Robots" } }, "applying")).toMatchObject({ ok: false, reason: expect.stringMatching(/1 required/) });
    expect(checkTransition({ ...parked, answers: { why: "Robots", office: "NYC" } }, "applying")).toEqual({ ok: true });
  });

  it("finds answers by question id or by question text, and ignores blank ones", () => {
    const pendingQuestions = [q("why", "Why do you want to work here?")];
    expect(unansweredQuestions({ pendingQuestions, answers: {} })).toHaveLength(1);
    expect(unansweredQuestions({ pendingQuestions, answers: { why: "  " } })).toHaveLength(1);
    expect(unansweredQuestions({ pendingQuestions, answers: { why: "x" } })).toHaveLength(0);
    expect(unansweredQuestions({ pendingQuestions, answers: { "Why do you want to work here?": "x" } })).toHaveLength(0);
  });

  it("never sends again after a submit click, unless the run was only waiting for a code", () => {
    expect(submitMayHaveHappened({ receipt: { submitClicked: true } })).toBe(true);
    expect(submitMayHaveHappened({ receipt: { submitClicked: true, awaitingCode: true } })).toBe(false);
    expect(submitMayHaveHappened({ receipt: null })).toBe(false);
    const clicked = app({ status: "needs_user", approvedAt: new Date(), receipt: { submitClicked: true } });
    expect(checkTransition(clicked, "applying")).toMatchObject({ ok: false, reason: expect.stringMatching(/already clicked/) });
  });

  it("a dry run may return to prepared; a real run may not", () => {
    const applying = app({ status: "applying", approvedAt: new Date() });
    expect(checkTransition(applying, "prepared")).toMatchObject({ ok: false });
    expect(checkTransition(applying, "prepared", { receipt: { dryRun: true } })).toEqual({ ok: true });
  });

  it("only the user can retry a failed application, and not after a submit click", () => {
    const failed = app({ status: "failed" });
    expect(checkTransition(failed, "queued")).toMatchObject({ ok: false });
    expect(checkTransition(failed, "queued", { by: "user" })).toEqual({ ok: true });
    expect(checkTransition({ ...failed, receipt: { submitClicked: true } }, "queued", { by: "user" })).toMatchObject({ ok: false });
  });
});

describe("transition patches", () => {
  const now = new Date("2026-10-31T10:00:00Z");

  it("stamps preparedAt when preparing finishes and counts an attempt when applying starts", () => {
    expect(transitionPatch(app({ status: "preparing" }), "prepared", { now })).toMatchObject({ status: "prepared", preparedAt: now, error: null });
    expect(transitionPatch(app({ status: "prepared", attempts: 1 }), "applying", { now })).toMatchObject({ status: "applying", attempts: 2 });
    expect(transitionPatch(app({ status: "awaiting_code", attempts: 1 }), "applying", { now })).not.toHaveProperty("attempts");
  });

  it("stamps submittedAt and clears questions on submit; stores the reason on needs_user and failed", () => {
    expect(transitionPatch(app({ status: "applying" }), "submitted", { now })).toMatchObject({ submittedAt: now, pendingQuestions: [], error: null });
    expect(transitionPatch(app({ status: "applying" }), "needs_user", { error: "Captcha" })).toMatchObject({ error: "Captcha" });
    expect(transitionPatch(app({ status: "applying" }), "failed", { error: "Boom" })).toMatchObject({ error: "Boom" });
  });

  it("a dry run resets attempts so the next click starts fresh", () => {
    expect(transitionPatch(app({ status: "applying", attempts: 2 }), "prepared", { receipt: { dryRun: true } })).toMatchObject({ attempts: 0 });
  });
});
