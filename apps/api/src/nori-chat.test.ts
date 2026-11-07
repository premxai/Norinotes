import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createFakeProvider, setProvider } from "@norinote/ai";
import { eq, lanes } from "@norinote/db";
import { makeApi, seedJob, seedShortlist, type Api } from "./testkit.js";

let api: Api;
beforeAll(async () => { api = await makeApi(); });
afterAll(() => api.close());
afterEach(() => setProvider(null));

/** The model answers with this reply and these actions. */
const says = (reply: string, actions: { kind: string; value: string }[] = []) => {
  const p = createFakeProvider({ chat: () => ({ reply, actions }) });
  setProvider(p);
  return p;
};

describe("the Nori chat", () => {
  it("answers, makes the changes asked for, lists them, and undoes each", async () => {
    const { cookie, user } = await api.signup("chat@example.com");
    await api.call("PUT", "/api/lanes", { cookie, body: [{ name: "AI Engineer", titles: ["AI Engineer"], locations: [], remote: true, enabled: true }] });

    const p = says("Sure, done.", [{ kind: "set_threshold", value: "65" }, { kind: "set_daily_limit", value: "12" }, { kind: "add_role", value: "ML Engineer" }, { kind: "skip_company", value: "Acme" }]);
    const res = await api.call("POST", "/api/nori/chat", { cookie, body: { message: "Lower my threshold to 65, 12 a day, add ML Engineer and skip Acme" } });
    expect(res.status).toBe(200);
    expect(res.json.message).toMatchObject({ role: "user" });
    expect(res.json.reply.text).toBe("Sure, done.");
    expect(res.json.reply.actions.map((a: { kind: string }) => a.kind)).toEqual(["set_threshold", "set_daily_limit", "add_role", "skip_company"]);
    // The model saw the person's context.
    expect(JSON.stringify(p.calls[0])).toContain("AI Engineer");
    const settings = (await api.call("GET", "/api/nori/settings", { cookie })).json.settings;
    expect(settings).toMatchObject({ minFit: 0.65, dailyLimit: 12, skipCompanies: ["Acme"] });
    expect((await api.db.select().from(lanes).where(eq(lanes.userId, user.id))).map((l) => l.name).sort()).toEqual(["AI Engineer", "ML Engineer"]);

    // Undo each.
    for (const a of res.json.reply.actions) expect((await api.call("POST", `/api/nori/chat/undo/${a.undoId}`, { cookie })).json.ok).toBe(true);
    expect((await api.call("GET", "/api/nori/settings", { cookie })).json.settings).toMatchObject({ minFit: 0.7, dailyLimit: 20, skipCompanies: [] });
    expect((await api.db.select().from(lanes).where(eq(lanes.userId, user.id))).map((l) => l.name)).toEqual(["AI Engineer"]);
    // Once only, and only your own.
    expect((await api.call("POST", `/api/nori/chat/undo/${res.json.reply.actions[0].undoId}`, { cookie })).json).toEqual({ ok: false, summary: "Already undone" });
    const other = await api.signup("chat-other@example.com");
    expect((await api.call("POST", `/api/nori/chat/undo/${res.json.reply.actions[1].undoId}`, { cookie: other.cookie })).status).toBe(404);

    const history = (await api.call("GET", "/api/nori/chat", { cookie })).json.messages;
    expect(history.map((m: { role: string }) => m.role)).toEqual(["user", "nori"]);
  });

  it("applies now from Recommended, and undo stops the batch", async () => {
    const { cookie, user } = await api.signup("chat-apply@example.com");
    const { job } = await seedJob(api.db, { company: "Chat Co" });
    await seedShortlist(api.db, user.id, job.id, 0.9);
    says("Sending your Recommended jobs now.", [{ kind: "apply_now", value: "5" }]);
    const res = await api.call("POST", "/api/nori/chat", { cookie, body: { message: "apply now" } });
    const action = res.json.reply.actions[0];
    expect(action).toMatchObject({ kind: "apply_now", summary: "Started Apply for me with 1 Recommended job" });
    expect((await api.call("GET", "/api/nori/batches", { cookie })).json.batches[0].status).toBe("running");
    expect((await api.call("POST", `/api/nori/chat/undo/${action.undoId}`, { cookie })).json).toMatchObject({ ok: true });
    expect((await api.call("GET", "/api/nori/batches", { cookie })).json.batches[0].status).toBe("stopped");
  });

  it("ignores changes it can't make, and says so when AI is unavailable", async () => {
    const { cookie } = await api.signup("chat-odd@example.com");
    says("Okay.", [{ kind: "set_threshold", value: "250" }, { kind: "remove_role", value: "Nothing Here" }]);
    expect((await api.call("POST", "/api/nori/chat", { cookie, body: { message: "do weird things" } })).json.reply.actions).toEqual([]);
    const fail = async () => { throw Object.assign(new Error("401"), { status: 401 }); };
    setProvider({ name: "down", chat: fail, embed: fail });
    const res = await api.call("POST", "/api/nori/chat", { cookie, body: { message: "hello" } });
    expect(res.status).toBe(200);
    expect(res.json.reply.text).toMatch(/can't think right now/);
    expect((await api.call("POST", "/api/nori/chat", { cookie, body: { message: "" } })).status).toBe(400);
  });
});

describe("the schedule", () => {
  it("is off until turned on, validates, and says when it next runs", async () => {
    const { cookie } = await api.signup("schedule-api@example.com");
    expect((await api.call("GET", "/api/nori/schedule", { cookie })).json.schedule).toMatchObject({ enabled: false, nextRunOn: null, time: "09:00" });
    const put = await api.call("PUT", "/api/nori/schedule", { cookie, body: { enabled: true, days: ["mon", "wed"], time: "08:30", timezone: "America/New_York" } });
    expect(put.json.schedule).toMatchObject({ enabled: true, days: ["mon", "wed"], time: "08:30", timezone: "America/New_York", paused: false });
    expect(put.json.schedule.nextRunOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await api.call("PUT", "/api/nori/schedule", { cookie, body: { time: "8am" } })).status).toBe(400);
    expect((await api.call("PUT", "/api/nori/schedule", { cookie, body: { timezone: "Mars/Base" } })).status).toBe(400);
    expect((await api.call("PUT", "/api/nori/schedule", { cookie, body: { days: [] } })).status).toBe(400);
  });

  it("can be turned on and paused from the chat, and undone", async () => {
    const { cookie } = await api.signup("schedule-chat@example.com");
    says("Done.", [{ kind: "schedule_on", value: "07:45" }]);
    const res = await api.call("POST", "/api/nori/chat", { cookie, body: { message: "apply for me every weekday at 7:45" } });
    expect(res.json.reply.actions[0]).toMatchObject({ kind: "schedule_on" });
    expect((await api.call("GET", "/api/nori/schedule", { cookie })).json.schedule).toMatchObject({ enabled: true, time: "07:45" });
    await api.call("POST", `/api/nori/chat/undo/${res.json.reply.actions[0].undoId}`, { cookie });
    expect((await api.call("GET", "/api/nori/schedule", { cookie })).json.schedule).toMatchObject({ enabled: false, time: "09:00" });
  });
});
