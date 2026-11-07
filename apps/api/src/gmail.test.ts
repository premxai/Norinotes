import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getGmailConnection, type ComposioGmail, type GmailConnectionStatus } from "@norinote/inbox";
import { makeApi, type Api } from "./testkit.js";

function fakeGmail() {
  const state = { status: "INITIATED" as GmailConnectionStatus, disconnected: [] as string[], connectedFor: [] as string[], fail: false };
  const gmail: ComposioGmail = {
    connect: async (userId) => {
      if (state.fail) throw new Error("Composio down");
      state.connectedFor.push(userId);
      return { url: "https://connect.composio.dev/link/ln_test", connectedAccountId: `ca_${userId.slice(0, 8)}` };
    },
    status: async () => state.status,
    disconnect: async (id) => { state.disconnected.push(id); },
    fetch: async () => [],
  };
  return { gmail, state };
}

describe("connected Gmail endpoints", () => {
  let api: Api;
  let user: { cookie: string; user: { id: string } };
  const fake = fakeGmail();
  beforeAll(async () => {
    api = await makeApi({ gmail: fake.gmail });
    user = await api.signup("gmail-a@example.com");
  });
  afterAll(() => api.close());

  it("starts a connection, reports it once active, and disconnects", async () => {
    expect((await api.call("GET", "/api/inbox/gmail", { cookie: user.cookie })).json).toEqual({ available: true, connected: false, status: null });

    const start = await api.call("POST", "/api/inbox/gmail/connect", { cookie: user.cookie });
    expect(start.status).toBe(200);
    expect(start.json).toEqual({ url: "https://connect.composio.dev/link/ln_test" });
    expect(fake.state.connectedFor).toEqual([user.user.id]);
    expect((await getGmailConnection(api.db, user.user.id))?.connectedAccountId).toBe(`ca_${user.user.id.slice(0, 8)}`);

    expect((await api.call("GET", "/api/inbox/gmail", { cookie: user.cookie })).json).toEqual({ available: true, connected: false, status: "INITIATED" });
    fake.state.status = "ACTIVE";
    expect((await api.call("GET", "/api/inbox/gmail", { cookie: user.cookie })).json).toEqual({ available: true, connected: true, status: "ACTIVE" });
    expect((await getGmailConnection(api.db, user.user.id))?.activeAt).toBeTruthy();

    expect((await api.call("DELETE", "/api/inbox/gmail", { cookie: user.cookie })).status).toBe(200);
    expect(fake.state.disconnected).toEqual([`ca_${user.user.id.slice(0, 8)}`]);
    expect(await getGmailConnection(api.db, user.user.id)).toBeNull();
    expect((await api.call("GET", "/api/inbox/gmail", { cookie: user.cookie })).json).toMatchObject({ connected: false });
  });

  it("needs a session, and reports a Composio failure as unavailable for now", async () => {
    expect((await api.call("POST", "/api/inbox/gmail/connect")).status).toBe(401);
    fake.state.fail = true;
    expect((await api.call("POST", "/api/inbox/gmail/connect", { cookie: user.cookie })).status).toBe(503);
    fake.state.fail = false;
  });
});

describe("without Composio configured", () => {
  let api: Api;
  beforeAll(async () => { api = await makeApi(); });
  afterAll(() => api.close());

  it("says Gmail cannot be connected", async () => {
    const u = await api.signup("gmail-b@example.com");
    expect((await api.call("GET", "/api/inbox/gmail", { cookie: u.cookie })).json).toEqual({ available: false, connected: false, status: null });
    expect((await api.call("POST", "/api/inbox/gmail/connect", { cookie: u.cookie })).status).toBe(503);
  });
});
