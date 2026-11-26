import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companies } from "@norinote/db";
import { discoverCompany } from "@norinote/ingest";
import { makeApi, type Api } from "./testkit.js";

const board = { jobs: [{ id: 1, title: "Engineer", absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1", first_published: "2026-11-20T00:00:00Z", location: { name: "Remote - US" }, company_name: "Acme Robotics", content: "" }] };
const requested: string[] = [];
const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  requested.push(url);
  if (url.startsWith("https://boards-api.greenhouse.io/v1/boards/acme/jobs")) return Response.json(board);
  if (url === "https://boards-api.greenhouse.io/v1/boards/broken/jobs?content=true") return new Response("", { status: 500 });
  return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
}) as typeof fetch;

let api: Api;
beforeAll(async () => {
  api = await makeApi({
    config: { engineAts: ["greenhouse"] },
    discoverCompany: (db, query) => discoverCompany(db, query, { fetch: fakeFetch, lookup: async () => ["93.184.216.34"], http: { sleep: async () => {}, random: () => 0 } }),
  });
});
afterAll(() => api.close());

describe("POST /api/companies", () => {
  it("adds a company's board to the shared registry, then says it is already there", async () => {
    const { cookie } = await api.signup("companies@example.com");
    const added = await api.call("POST", "/api/companies", { cookie, body: { query: "job-boards.greenhouse.io/acme" } });
    expect(added.status).toBe(201);
    expect(added.json).toEqual({ status: "added", openJobs: 1, company: { id: expect.any(String), name: "Acme Robotics", system: "greenhouse", systemName: "Greenhouse", reading: true } });
    const again = await api.call("POST", "/api/companies", { cookie, body: { query: "Acme Robotics" } });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ status: "exists", company: { name: "Acme Robotics" } });
    expect(await api.db.select().from(companies)).toHaveLength(1);
  });

  it("says plainly when there is no board, and refuses sites Nori never reads", async () => {
    const { cookie } = await api.signup("companies2@example.com");
    const none = await api.call("POST", "/api/companies", { cookie, body: { query: "Nowhere Widgets" } });
    expect(none.status).toBe(404);
    expect(none.json.error).toMatch(/^Nori couldn't find a public job board for Nowhere Widgets\./);
    const before = requested.length;
    const linkedin = await api.call("POST", "/api/companies", { cookie, body: { query: "https://www.linkedin.com/company/acme" } });
    expect(linkedin.status).toBe(422);
    expect(linkedin.json.error).toMatch(/LinkedIn, Indeed or Glassdoor/);
    expect(requested.length).toBe(before);
    expect((await api.call("POST", "/api/companies", { cookie, body: { query: "http://127.0.0.1/careers" } })).status).toBe(422);
    expect((await api.call("POST", "/api/companies", { cookie, body: {} })).status).toBe(400);
    const broken = await api.call("POST", "/api/companies", { cookie, body: { query: "https://job-boards.greenhouse.io/broken" } });
    expect(broken.status).toBe(503);
  });

  it("marks a board on a system the worker does not read yet", async () => {
    const leverApi = await makeApi({
      config: { engineAts: ["greenhouse"] },
      discoverCompany: async (db) => {
        const [row] = await db.insert(companies).values({ name: "Globex", atsType: "lever", atsToken: "globex" }).returning();
        return { status: "added", openJobs: 3, company: { id: row!.id, name: "Globex", atsType: "lever", token: "globex", status: "active" } };
      },
    });
    const { cookie } = await leverApi.signup("lever@example.com");
    const res = await leverApi.call("POST", "/api/companies", { cookie, body: { query: "Globex" } });
    expect(res.json.company).toMatchObject({ systemName: "Lever", reading: false });
    await leverApi.close();
  });

  it("limits each person to 10 requests an hour", async () => {
    const { cookie } = await api.signup("limit@example.com");
    const other = await api.signup("limit-other@example.com");
    for (let i = 0; i < 10; i++) expect((await api.call("POST", "/api/companies", { cookie, body: { query: "Acme Robotics" } })).status).toBe(200);
    const limited = await api.call("POST", "/api/companies", { cookie, body: { query: "Acme Robotics" } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(limited.json.error).toMatch(/Try again in an hour/);
    expect((await api.call("POST", "/api/companies", { cookie: other.cookie, body: { query: "Acme Robotics" } })).status).toBe(200);
  });

  it("needs a signed-in person", async () => {
    expect((await api.call("POST", "/api/companies", { body: { query: "Acme" } })).status).toBe(401);
  });
});
