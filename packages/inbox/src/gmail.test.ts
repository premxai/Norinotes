import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, companies, eq, inboxMessages, jobs, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import {
  awaitVerificationWithGmail, codeQuery, createComposioGmail, getGmailConnection, readGmailMessages, saveGmailConnection,
  type ComposioGmail, type GmailMessage,
} from "./index.js";

describe("reading Composio's GMAIL_FETCH_EMAILS result", () => {
  it("reads the flattened message shape", () => {
    const out = readGmailMessages({ successful: true, data: { messages: [
      { messageId: "m1", sender: "Acme via Greenhouse <no-reply@us.greenhouse-mail.io>", subject: "Security code", messageText: "Your code is 482913", messageTimestamp: "2026-11-07T17:00:00Z" },
      { subject: "no id, skipped" },
    ] } });
    expect(out).toEqual([{ id: "m1", from: "Acme via Greenhouse <no-reply@us.greenhouse-mail.io>", subject: "Security code", text: "Your code is 482913", receivedAt: new Date("2026-11-07T17:00:00Z") }]);
  });

  it("reads Gmail's own payload: headers and a base64url text part", () => {
    const body = Buffer.from("Copy this code: 731905").toString("base64url");
    const out = readGmailMessages({ data: JSON.stringify({ messages: [{ id: "g1", internalDate: "1793984400000", payload: {
      headers: [{ name: "From", value: "no-reply@us.greenhouse-mail.io" }, { name: "Subject", value: "Your security code" }],
      parts: [{ mimeType: "text/html", body: { data: Buffer.from("<b>ignored</b>").toString("base64url") } }, { mimeType: "text/plain", body: { data: body } }],
    } }] }) });
    expect(out[0]).toMatchObject({ id: "g1", from: "no-reply@us.greenhouse-mail.io", subject: "Your security code", text: "Copy this code: 731905" });
    expect(out[0]!.receivedAt?.getTime()).toBe(1793984400000);
  });

  it("returns nothing for an unreadable result", () => {
    expect(readGmailMessages({ data: "not json" })).toEqual([]);
    expect(readGmailMessages(null)).toEqual([]);
  });

  it("asks Gmail only for recent code-like mail", () => {
    const q = codeQuery(new Date("2026-11-07T17:00:00Z"));
    expect(q).toContain(`after:${Date.parse("2026-11-07T17:00:00Z") / 1000 - 60}`);
    expect(q).toMatch(/"code" OR "verification"/);
  });
});

describe("Composio REST client", () => {
  type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
  function fakeFetch(replies: Array<{ status?: number; body: unknown }>) {
    const calls: Call[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const r = replies.shift() ?? { body: {} };
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }) as unknown as typeof fetch;
    return { f, calls };
  }

  it("connects a user: a session, then a Gmail link", async () => {
    const { f, calls } = fakeFetch([{ body: { session_id: "trs_1" } }, { body: { redirect_url: "https://connect.composio.dev/link/ln_1", connected_account_id: "ca_1" } }]);
    const c = createComposioGmail({ apiKey: "ak_test", fetch: f });
    expect(await c.connect("user-1")).toEqual({ url: "https://connect.composio.dev/link/ln_1", connectedAccountId: "ca_1" });
    expect(calls.map((x) => `${x.method} ${x.url}`)).toEqual([
      "POST https://backend.composio.dev/api/v3.1/tool_router/session",
      "POST https://backend.composio.dev/api/v3.1/tool_router/session/trs_1/link",
    ]);
    expect(calls[0]!.headers["x-api-key"]).toBe("ak_test");
    expect(calls[0]!.body).toEqual({ user_id: "user-1" });
    expect(calls[1]!.body).toEqual({ toolkit: "gmail" });
  });

  it("fetches mail through GMAIL_FETCH_EMAILS for the user, and reads the status", async () => {
    const { f, calls } = fakeFetch([
      { body: { successful: true, data: { messages: [{ messageId: "m1", sender: "a@b.c", subject: "s", messageText: "t" }] } } },
      { body: { status: "active" } },
    ]);
    const c = createComposioGmail({ apiKey: "ak_test", fetch: f });
    expect(await c.fetch("user-1", "after:1", 5)).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://backend.composio.dev/api/v3.1/tools/execute/GMAIL_FETCH_EMAILS");
    expect(calls[0]!.body).toMatchObject({ user_id: "user-1", arguments: { query: "after:1", max_results: 5, verbose: true } });
    expect(await c.status("ca_1")).toBe("ACTIVE");
  });

  it("throws on a refused call or a failed tool", async () => {
    const c1 = createComposioGmail({ apiKey: "bad", fetch: fakeFetch([{ status: 401, body: {} }]).f });
    await expect(c1.status("ca_1")).rejects.toThrow(/HTTP 401/);
    const c2 = createComposioGmail({ apiKey: "ak", fetch: fakeFetch([{ body: { successful: false, error: "no connection" } }]).f });
    await expect(c2.fetch("u", "q")).rejects.toThrow(/no connection/);
  });
});

describe("reading the code from a connected Gmail while a run waits", () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());

  async function waitingApplication() {
    const [u] = await t.db.insert(users).values({ email: `g${Date.now()}${Math.random()}@example.test`, passwordHash: "x" }).returning();
    const [c] = await t.db.insert(companies).values({ name: "Acme", atsType: "greenhouse", atsToken: `acme-${Math.random()}` }).returning();
    const [j] = await t.db.insert(jobs).values({ companyId: c!.id, atsType: "greenhouse", externalId: `${Math.random()}`, title: "Engineer", applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1", dedupeKey: `${Math.random()}` }).returning();
    const [a] = await t.db.insert(applications).values({ userId: u!.id, jobId: j!.id, status: "awaiting_code", approvedAt: new Date() }).returning();
    return { userId: u!.id, appId: a!.id };
  }

  function fakeGmail(mail: GmailMessage[]): ComposioGmail & { fetched: number } {
    const g = {
      fetched: 0,
      connect: async () => ({ url: "", connectedAccountId: null }),
      status: async () => "ACTIVE" as const,
      disconnect: async () => undefined,
      fetch: async () => { g.fetched++; return mail; },
    };
    return g;
  }

  it("finds the emailed code in Gmail, links it to the application, and never stores other mail", async () => {
    const { userId, appId } = await waitingApplication();
    await saveGmailConnection(t.db, userId, { connectedAccountId: "ca_1", startedAt: new Date().toISOString(), activeAt: new Date().toISOString() });
    expect(await getGmailConnection(t.db, userId)).toMatchObject({ connectedAccountId: "ca_1" });
    const gmail = fakeGmail([
      { id: "x1", from: "Mom <mom@example.com>", subject: "Dinner on Sunday?", text: "Call me", receivedAt: new Date() },
      { id: "x0", from: "Bank <alerts@bank.example>", subject: "Your one-time passcode", text: "Your one-time passcode is 551177", receivedAt: new Date() },
      { id: "x2", from: "Acme via Greenhouse <no-reply@us.greenhouse-mail.io>", subject: "Security code for your application to Acme", text: "Copy and paste this code into the security code field:\n\n482913", receivedAt: new Date() },
    ]);
    const got = await awaitVerificationWithGmail({ db: t.db, gmail, applicationId: appId, since: new Date(Date.now() - 1000), timeoutMs: 5000, accept: "code", pollMs: 20, intervalMs: 500 });
    expect(got).toMatchObject({ type: "code", code: "482913" });
    const stored = await t.db.select().from(inboxMessages).where(eq(inboxMessages.userId, userId));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ kind: "verification_code", applicationId: appId, code: "482913" });
  });

  it("is the plain waiter without a connection", async () => {
    const { appId } = await waitingApplication();
    const gmail = fakeGmail([]);
    expect(await awaitVerificationWithGmail({ db: t.db, gmail, applicationId: appId, since: new Date(), timeoutMs: 50, accept: "code", pollMs: 10 })).toBeNull();
    expect(gmail.fetched).toBe(0);
  });

  it("keeps waiting through a Gmail error", async () => {
    const { userId, appId } = await waitingApplication();
    await saveGmailConnection(t.db, userId, { connectedAccountId: "ca_2", startedAt: new Date().toISOString(), activeAt: null });
    const events: string[] = [];
    const gmail = { ...fakeGmail([]), fetch: async () => { throw new Error("Composio down"); } };
    expect(await awaitVerificationWithGmail({ db: t.db, gmail, applicationId: appId, since: new Date(), timeoutMs: 100, accept: "code", pollMs: 10, intervalMs: 500, log: (e) => events.push(e) })).toBeNull();
    expect(events).toContain("gmail.fetch_failed");
  });
});
