import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { careerPoints, eq } from "@norinote/db";
import { makeApi, type Api } from "./testkit.js";

let api: Api;
let cookie: string;
let userId: string;
beforeAll(async () => {
  api = await makeApi();
  const s = await api.signup("sources@example.com");
  cookie = s.cookie;
  userId = s.user.id;
});
afterAll(() => api.close());

const add = (kind: string, value: string, c = cookie) => api.call("POST", "/api/graph/sources", { cookie: c, body: { kind, value } });

describe("career graph sources", () => {
  it("adds a GitHub account (a profile link counts) and queues reading it", async () => {
    const res = await add("github", "https://github.com/ada-l/");
    expect(res.status).toBe(201);
    expect(res.json.source).toMatchObject({ kind: "github", value: "ada-l", status: "pending", factsAdded: 0, lastReadAt: null });
    expect(api.queuedOf("graph.read-source").map((q) => (q.payload as { sourceId: string }).sourceId)).toContain(res.json.source.id);
    // The same source again is the same source.
    const again = await add("github", "ada-l");
    expect(again.status).toBe(200);
    expect(again.json.source.id).toBe(res.json.source.id);
  });

  it("keeps a LinkedIn link without reading it, and checks site links", async () => {
    const before = api.queuedOf("graph.read-source").length;
    const li = await add("linkedin", "linkedin.com/in/ada-lovelace/");
    expect(li.json.source).toMatchObject({ kind: "linkedin", value: "https://www.linkedin.com/in/ada-lovelace", status: "done" });
    expect(api.queuedOf("graph.read-source").length).toBe(before);

    expect((await add("site", "ada.example.com")).json.source).toMatchObject({ kind: "site", value: "https://ada.example.com/" });
    expect((await add("site", "http://localhost:3000")).status).toBe(422);
    expect((await add("site", "http://10.0.0.5/admin")).status).toBe(422);
    expect((await add("site", "https://www.linkedin.com/in/ada")).status).toBe(400);
    expect((await add("github", "not a name!")).status).toBe(400);
    expect((await add("linkedin", "https://example.com/in/ada")).status).toBe(400);
    expect((await add("twitter", "ada")).status).toBe(400);
  });

  it("lists, refreshes and removes a source with its facts, re-running matching", async () => {
    const list = (await api.call("GET", "/api/graph/sources", { cookie })).json.sources as { id: string; kind: string }[];
    expect(list.map((s) => s.kind)).toEqual(["github", "linkedin", "site"]);
    const gh = list[0]!;

    const refresh = await api.call("POST", `/api/graph/sources/${gh.id}/refresh`, { cookie });
    expect(refresh.json.source.status).toBe("pending");

    await api.db.insert(careerPoints).values({ userId, kind: "project", title: "norinote-cli", text: "CLI", source: "github", sourceRef: "https://github.com/ada-l/norinote-cli", graphSourceId: gh.id });
    const graph = (await api.call("GET", "/api/graph", { cookie })).json;
    const node = graph.nodes.find((n: { label: string }) => n.label === "norinote-cli");
    expect(node).toMatchObject({ source: "GitHub", origin: { kind: "github", ref: "https://github.com/ada-l/norinote-cli", label: "ada-l/norinote-cli" } });

    const other = await api.signup("sources-other@example.com");
    expect((await api.call("DELETE", `/api/graph/sources/${gh.id}`, { cookie: other.cookie })).status).toBe(404);

    const matches = api.queuedOf("match.user").length;
    const del = await api.call("DELETE", `/api/graph/sources/${gh.id}`, { cookie });
    expect(del.json).toEqual({ ok: true, factsRemoved: 1 });
    expect(await api.db.select().from(careerPoints).where(eq(careerPoints.graphSourceId, gh.id))).toEqual([]);
    expect(api.queuedOf("match.user").length).toBe(matches + 1);
    expect((await api.call("GET", "/api/graph/sources", { cookie })).json.sources).toHaveLength(2);
  });

  it("caps the number of sources", async () => {
    const s = await api.signup("sources-many@example.com");
    for (let i = 0; i < 10; i++) expect((await add("github", `user${i}`, s.cookie)).status).toBe(201);
    expect((await add("github", "user10", s.cookie)).status).toBe(409);
  });

  it("gives every resume or user fact an origin too", async () => {
    await api.db.insert(careerPoints).values({ userId, kind: "role", title: "Engineer", org: "Acme", text: "Built things", source: "resume", sourceQuote: "Engineer, Acme, 2021-2024" });
    const graph = (await api.call("GET", "/api/graph", { cookie })).json;
    const role = graph.nodes.find((n: { type: string }) => n.type === "role");
    expect(role).toMatchObject({ source: "your resume", origin: { kind: "resume", ref: null, label: "Engineer, Acme, 2021-2024" } });
    expect(graph.nodes.filter((n: { type: string }) => n.type === "skill").every((n: { origin: unknown }) => n.origin === null)).toBe(true);
  });
});
