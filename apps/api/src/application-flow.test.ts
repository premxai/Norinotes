import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { outcomes } from "@norinote/db";
import { makeApi, seedApplication, seedJob, type Api } from "./testkit.js";

const NOW = new Date("2026-11-07T18:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("GET /api/applications/flow", () => {
  let api: Api;
  let cookie: string;
  let userId: string;
  beforeAll(async () => {
    api = await makeApi({ now: () => NOW });
    const u = await api.signup("flow@example.com");
    cookie = u.cookie;
    userId = u.user.id;
    const app = async (company: string, extra: Parameters<typeof seedApplication>[3], kinds: Array<"reply" | "interview" | "rejection" | "offer"> = []) => {
      const { job } = await seedJob(api.db, { company });
      const a = await seedApplication(api.db, userId, job.id, { createdAt: daysAgo(40), ...extra });
      for (const kind of kinds) await api.db.insert(outcomes).values({ applicationId: a.id, kind, source: "manual", at: NOW });
      return a;
    };
    await app("Offer Co", { status: "submitted", submittedAt: daysAgo(20) }, ["reply", "interview", "offer"]);
    await app("Interview Co", { status: "submitted", submittedAt: daysAgo(10) }, ["interview"]);
    await app("No Co", { status: "submitted", submittedAt: daysAgo(15) }, ["rejection"]);
    await app("Reply Co", { status: "submitted", submittedAt: daysAgo(5) }, ["reply"]);
    await app("Quiet Co", { status: "submitted", submittedAt: daysAgo(3) });
    await app("Ghost Co", { status: "submitted", submittedAt: daysAgo(45) });
    await app("Parked Co", { status: "needs_user" });
    await app("Stopped Co", { status: "failed", error: "Cancelled by you" });
    await app("Busy Co", { status: "applying", createdAt: daysAgo(1) });
  });
  afterAll(() => api.close());

  it("follows every application along one path, ready for a Sankey", async () => {
    const res = await api.call("GET", "/api/applications/flow", { cookie });
    expect(res.status).toBe(200);
    expect(res.json.total).toBe(9);
    const link = (s: string, t: string) => res.json.links.find((l: { source: string; target: string }) => l.source === s && l.target === t)?.value ?? 0;
    expect(link("started", "sent")).toBe(6);
    expect(link("started", "needs_you")).toBe(1);
    expect(link("started", "cancelled")).toBe(1);
    expect(link("started", "in_progress")).toBe(1);
    expect(link("sent", "interview")).toBe(2);
    expect(link("interview", "offer")).toBe(1);
    expect(link("interview", "interviewing")).toBe(1);
    expect(link("sent", "rejected")).toBe(1);
    expect(link("sent", "replied")).toBe(1);
    expect(link("sent", "waiting")).toBe(1);
    expect(link("sent", "silent")).toBe(1);
    const node = (id: string) => res.json.nodes.find((n: { id: string }) => n.id === id);
    expect(node("started")).toMatchObject({ label: "Started", count: 9, stage: 0 });
    expect(node("silent")).toMatchObject({ label: "No reply", stage: 2 });
    expect(node("offer")).toMatchObject({ label: "Offer", count: 1, stage: 3 });
    // What flows into a node equals the node's count.
    for (const n of res.json.nodes.filter((x: { stage: number }) => x.stage > 0)) {
      const into = res.json.links.filter((l: { target: string }) => l.target === n.id).reduce((s: number, l: { value: number }) => s + l.value, 0);
      expect(into).toBe(n.count);
    }
  });

  it("limits to recent applications with ?days, and is private to the user", async () => {
    const recent = await api.call("GET", "/api/applications/flow?days=7", { cookie });
    expect(recent.json.total).toBe(1);
    const other = await api.signup("flow-other@example.com");
    expect((await api.call("GET", "/api/applications/flow", { cookie: other.cookie })).json).toMatchObject({ total: 0, nodes: [], links: [] });
    expect((await api.call("GET", "/api/applications/flow")).status).toBe(401);
  });
});
