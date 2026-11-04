import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { careerPoints, eq } from "@norinote/db";
import { makeApi, RESUME, type Api } from "./testkit.js";

let api: Api;
beforeAll(async () => { api = await makeApi(); });
afterAll(() => api.close());

type Node = { id: string; type: string; label: string; props: Record<string, unknown>; startDate: string | null; endDate: string | null; source: string };

async function graphOf(cookie: string): Promise<Node[]> {
  return (await api.call("GET", "/api/graph", { cookie })).json.nodes;
}

describe("editing a graph card", () => {
  it("changes only the fields sent, re-reads metrics, keeps the source and re-runs matching", async () => {
    const { cookie } = await api.signup("edit-card@example.com");
    await api.call("POST", "/api/profile/resume", { cookie, body: { text: RESUME } });
    const role = (await graphOf(cookie)).find((n) => n.type === "role")!;
    const before = api.queuedOf("match.user").length;

    const res = await api.call("PATCH", `/api/graph/nodes/${role.id}`, {
      cookie,
      body: { title: "Staff Engineer", statement: "Cut page load time by 40%.", skills: ["typescript", "Postgres"], startDate: "2019-03", endDate: null },
    });
    expect(res.status).toBe(200);
    expect(res.json.node).toMatchObject({
      id: role.id, type: "role", startDate: "2019-03", endDate: null, source: "your resume",
      props: { title: "Staff Engineer", statement: "Cut page load time by 40%." },
    });
    expect(res.json.node.props.skills).toEqual(expect.arrayContaining(["TypeScript"]));
    expect(api.queuedOf("match.user").length).toBe(before + 1);

    const [row] = await api.db.select().from(careerPoints).where(eq(careerPoints.id, role.id));
    expect(row?.org).toBe(role.props.org ?? null);
    expect((row?.metrics as { items?: unknown[] }).items?.length).toBeGreaterThan(0);
    expect((await graphOf(cookie)).find((n) => n.id === role.id)?.props.title).toBe("Staff Engineer");

    // Clearing the company.
    expect((await api.call("PATCH", `/api/graph/nodes/${role.id}`, { cookie, body: { org: null } })).json.node.props.org).toBeUndefined();
  });

  it("refuses bad edits, skills and other users' cards", async () => {
    const a = await api.signup("edit-a@example.com");
    const b = await api.signup("edit-b@example.com");
    await api.call("POST", "/api/profile/resume", { cookie: a.cookie, body: { text: RESUME } });
    const nodes = await graphOf(a.cookie);
    const role = nodes.find((n) => n.type === "role")!;
    const skill = nodes.find((n) => n.type === "skill")!;
    const patch = (id: string, body: unknown, cookie = a.cookie) => api.call("PATCH", `/api/graph/nodes/${id}`, { cookie, body });

    expect((await patch(role.id, {})).status).toBe(400);
    expect((await patch(role.id, { title: "" })).status).toBe(400);
    expect((await patch(role.id, { startDate: "May 2020" })).status).toBe(400);
    expect((await patch(role.id, { kind: "project" })).status).toBe(400);
    expect((await patch(role.id, { startDate: "2022-01", endDate: "2021" })).status).toBe(400);
    expect((await patch(skill.id, { title: "Rust" })).status).toBe(422);
    expect((await patch(role.id, { title: "Mine now" }, b.cookie)).status).toBe(404);
    expect((await patch("not-a-uuid", { title: "x" })).status).toBe(404);
    expect((await graphOf(a.cookie)).find((n) => n.id === role.id)?.props.title).toBe(role.props.title);
  });
});
