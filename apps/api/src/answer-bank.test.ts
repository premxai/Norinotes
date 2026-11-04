import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { answerBank, eq } from "@norinote/db";
import { makeApi, type Api } from "./testkit.js";

let api: Api;
beforeAll(async () => { api = await makeApi(); });
afterAll(() => api.close());

async function remember(userId: string, questionText: string, answer: string, source: "default" | "user" | "model", lastUsedAt: Date | null) {
  const [row] = await api.db.insert(answerBank).values({ userId, questionText, answer, source, lastUsedAt }).returning();
  return row!.id;
}

describe("the answer bank", () => {
  it("lists the user's answers, most recently used first", async () => {
    const s = await api.signup("bank-list@example.com");
    const other = await api.signup("bank-other@example.com");
    await remember(s.user.id, "Are you willing to relocate?", "Yes", "default", new Date(Date.now() - 86_400_000));
    await remember(s.user.id, "Why do you want to work here?", "The mission.", "model", new Date());
    await remember(s.user.id, "Never used", "Maybe", "user", null);
    await remember(other.user.id, "Theirs", "Not yours", "user", new Date());

    const res = await api.call("GET", "/api/profile/answers", { cookie: s.cookie });
    expect(res.status).toBe(200);
    expect(res.json.map((a: { questionText: string }) => a.questionText)).toEqual(["Why do you want to work here?", "Are you willing to relocate?", "Never used"]);
    expect(res.json[0]).toEqual({ id: expect.any(String), questionText: "Why do you want to work here?", answer: "The mission.", source: "model", lastUsedAt: expect.any(String) });
    expect((await api.call("GET", "/api/profile/answers")).status).toBe(401);
  });

  it("edits an answer, which then counts as the user's own, and deletes one", async () => {
    const s = await api.signup("bank-edit@example.com");
    const other = await api.signup("bank-edit-other@example.com");
    const id = await remember(s.user.id, "Salary expectation?", "120000", "model", new Date());

    const edited = await api.call("PATCH", `/api/profile/answers/${id}`, { cookie: s.cookie, body: { answer: "  140000 USD  " } });
    expect(edited.status).toBe(200);
    expect(edited.json).toMatchObject({ id, answer: "140000 USD", source: "user", questionText: "Salary expectation?" });
    expect((await api.call("PATCH", `/api/profile/answers/${id}`, { cookie: s.cookie, body: { answer: " " } })).status).toBe(400);
    expect((await api.call("PATCH", `/api/profile/answers/${id}`, { cookie: other.cookie, body: { answer: "mine" } })).status).toBe(404);
    expect((await api.call("DELETE", `/api/profile/answers/${id}`, { cookie: other.cookie })).status).toBe(404);
    expect((await api.call("PATCH", "/api/profile/answers/not-a-uuid", { cookie: s.cookie, body: { answer: "x" } })).status).toBe(404);

    expect((await api.call("DELETE", `/api/profile/answers/${id}`, { cookie: s.cookie })).status).toBe(200);
    expect(await api.db.select().from(answerBank).where(eq(answerBank.id, id))).toEqual([]);
    expect((await api.call("DELETE", `/api/profile/answers/${id}`, { cookie: s.cookie })).status).toBe(404);
  });
});
