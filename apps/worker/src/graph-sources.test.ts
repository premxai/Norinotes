import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { careerPoints, eq, graphSources, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { createFakeProvider, setProvider } from "@norinote/ai";
import { readGraphSource, repoDrafts, robotsAllows } from "./graph-sources.js";

const NOW = new Date("2026-11-07T12:00:00Z");
const publicLookup = async () => ["93.184.216.34"];
let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());
afterEach(() => setProvider(null));

let seq = 0;
async function source(kind: "github" | "site" | "linkedin", value: string) {
  const [u] = await t.db.insert(users).values({ email: `src${seq++}@example.test`, passwordHash: "x" }).returning();
  const [s] = await t.db.insert(graphSources).values({ userId: u!.id, kind, value }).returning();
  return s!;
}

const repo = (over: Record<string, unknown>) => ({
  name: "tool", description: "A tool", language: "TypeScript", topics: [], html_url: "https://github.com/ada/tool", fork: false, archived: false,
  created_at: "2025-01-10T00:00:00Z", pushed_at: "2026-10-01T00:00:00Z", ...over,
});

/** Answers like the given routes; anything else is a 404. Records every URL asked for. */
function fakeFetch(routes: Record<string, () => Response>) {
  const asked: string[] = [];
  const f = (async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    return hit ? hit[1]() : new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { f, asked };
}

describe("reading a GitHub source", () => {
  it("turns the person's own repos into project facts and replaces them on the next read", async () => {
    const s = await source("github", "ada");
    const repos = [
      repo({ name: "norinote-cli", description: "CLI for job search", topics: ["cli", "postgresql"], html_url: "https://github.com/ada/norinote-cli" }),
      repo({ name: "forked-thing", fork: true }),
      repo({ name: "old", archived: true }),
      repo({ name: "empty", description: null, language: null, topics: [] }),
      repo({ name: "stale", description: "Old work", pushed_at: "2024-03-02T00:00:00Z", html_url: "https://github.com/ada/stale" }),
    ];
    const { f, asked } = fakeFetch({ "https://api.github.com/users/ada/repos": () => Response.json(repos) });
    const res = await readGraphSource(t.db, s.id, { fetch: f, now: () => NOW });
    expect(res).toMatchObject({ status: "done", factsAdded: 2 });
    // Only the named account was asked for: no search.
    expect(asked.every((u) => u.startsWith("https://api.github.com/users/ada/"))).toBe(true);

    const facts = await t.db.select().from(careerPoints).where(eq(careerPoints.graphSourceId, s.id));
    const cli = facts.find((p) => p.title === "norinote-cli")!;
    expect(cli).toMatchObject({ kind: "project", source: "github", sourceRef: "https://github.com/ada/norinote-cli", text: "CLI for job search", endDate: null });
    expect(cli.skills.map((x) => x.toLowerCase())).toEqual(expect.arrayContaining(["typescript"]));
    expect(facts.find((p) => p.title === "stale")!.endDate).toBe("2024-03");
    const [row] = await t.db.select().from(graphSources).where(eq(graphSources.id, s.id));
    expect(row).toMatchObject({ status: "done", factsAdded: 2, error: null });

    // Read again with one repo: the old facts are replaced, not added to.
    const again = fakeFetch({ "https://api.github.com/users/ada/repos": () => Response.json([repos[0]]) });
    await readGraphSource(t.db, s.id, { fetch: again.f, now: () => NOW });
    expect(await t.db.select().from(careerPoints).where(eq(careerPoints.graphSourceId, s.id))).toHaveLength(1);
  });

  it("marks an unknown account failed with a clear message", async () => {
    const s = await source("github", "nobody-here");
    const { f } = fakeFetch({});
    expect(await readGraphSource(t.db, s.id, { fetch: f, now: () => NOW })).toMatchObject({ status: "failed", error: "There is no GitHub account called nobody-here." });
    const [row] = await t.db.select().from(graphSources).where(eq(graphSources.id, s.id));
    expect(row!.status).toBe("failed");
  });

  it("keeps only meaningful repos as cards", () => {
    expect(repoDrafts([repo({ fork: true }), repo({ description: null, language: null })], NOW)).toEqual([]);
  });
});

describe("reading a site", () => {
  it("reads the page with the resume reader, keeping only quoted facts", async () => {
    const s = await source("site", "https://ada.example.com/");
    const page = "<html><body><h1>Ada</h1><p>Senior Engineer at Acme Cloud since 2021. Built the billing platform in Go.</p></body></html>";
    const { f } = fakeFetch({
      "https://ada.example.com/robots.txt": () => new Response("User-agent: *\nDisallow: /private", { headers: { "content-type": "text/plain" } }),
      "https://ada.example.com/": () => new Response(page, { headers: { "content-type": "text/html" } }),
    });
    const noScope = { team_size: null, users: null, budget: null, ownership: null };
    setProvider(createFakeProvider({
      chat: (req) => req.jsonSchema?.name === "career_graph" ? {
        roles: [{ title: "Senior Engineer", org: "Acme Cloud", start: "2021", end: null, text: "Built the billing platform in Go.", skills: ["Go"], scope: noScope, metrics: [], source_quote: "Senior Engineer at Acme Cloud since 2021" }],
        projects: [], achievements: [], education: [], certifications: [], skills: [],
      } : undefined,
    }));
    const res = await readGraphSource(t.db, s.id, { fetch: f, lookup: publicLookup, now: () => NOW });
    expect(res).toMatchObject({ status: "done" });
    const facts = await t.db.select().from(careerPoints).where(eq(careerPoints.graphSourceId, s.id));
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((p) => p.source === "site" && p.sourceRef === "https://ada.example.com/")).toBe(true);
  });

  it("honours robots.txt and never reads a private address", async () => {
    const blocked = await source("site", "https://shy.example.com/");
    const robots = fakeFetch({ "https://shy.example.com/robots.txt": () => new Response("User-agent: *\nDisallow: /", { headers: { "content-type": "text/plain" } }) });
    expect(await readGraphSource(t.db, blocked.id, { fetch: robots.f, lookup: publicLookup, now: () => NOW })).toMatchObject({ status: "failed", error: "That site's robots.txt asks not to be read." });

    const internal = await source("site", "https://intranet.example.com/");
    const any = fakeFetch({ "https://intranet.example.com/": () => new Response("<p>secret</p>") });
    const res = await readGraphSource(t.db, internal.id, { fetch: any.f, lookup: async () => ["10.0.0.5"], now: () => NOW });
    expect(res!.status).toBe("failed");
    expect(any.asked).toEqual([]);
  });

  it("never fetches a LinkedIn link", async () => {
    const s = await source("linkedin", "https://www.linkedin.com/in/ada");
    const { f, asked } = fakeFetch({});
    expect(await readGraphSource(t.db, s.id, { fetch: f, now: () => NOW })).toMatchObject({ status: "done", factsAdded: 0 });
    expect(asked).toEqual([]);
  });

  it("parses robots.txt groups", () => {
    expect(robotsAllows("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /tmp", "/about")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /tmp", "/tmp/x")).toBe(false);
    expect(robotsAllows("", "/")).toBe(true);
  });
});
