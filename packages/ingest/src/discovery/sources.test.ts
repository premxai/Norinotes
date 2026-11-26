import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boardCandidates, companies } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import {
  CANDIDATE_SOURCES, loadCandidates, parseAtsCompanySlugs, parseAtsDirectory, parseOpenJobsSlugs, politeDownload, tregSource,
  type CandidateSource,
} from "./sources.js";

describe("parseAtsDirectory", () => {
  it("keeps boards a probe confirmed, skips dead, unconfirmed, EU-host and other-system rows", () => {
    const text = [
      JSON.stringify({ provider: "greenhouse", slug: "acme", region: null, name: "Acme", status: "ok" }),
      JSON.stringify({ provider: "lever", slug: "Palantir", region: null, name: null, status: "ok" }),
      JSON.stringify({ provider: "lever", slug: "bunq", region: "eu", name: null, status: "ok" }),
      JSON.stringify({ provider: "ashby", slug: "gone", region: null, name: null, status: "dead" }),
      JSON.stringify({ provider: "ashby", slug: "maybe", region: null, name: null, status: "unconfirmed" }),
      JSON.stringify({ provider: "recruitee", slug: "parked", region: null, name: null, status: "ok" }),
      "not json",
      "",
    ].join("\n");
    expect(parseAtsDirectory(text)).toEqual([
      { atsType: "greenhouse", token: "acme", name: "Acme" },
      { atsType: "lever", token: "Palantir", name: null },
    ]);
  });
});

describe("parseAtsCompanySlugs", () => {
  it("reads company, ats and slug from rows whose board answered", () => {
    const csv = "company,ats,slug,industry,open_jobs,board_ok,checked\r\nspacex,greenhouse,spacex,Tech,2849,True,2026-11-13\r\n\"Veeva, Inc.\",lever,veeva,,861,True,2026-11-13\r\nold,ashby,old,,0,False,2026-11-13\r\nbad,ashby,../x,,1,True,2026-11-13\r\n";
    expect(parseAtsCompanySlugs(csv)).toEqual([
      { atsType: "greenhouse", token: "spacex", name: "spacex" },
      { atsType: "lever", token: "veeva", name: "Veeva, Inc." },
    ]);
  });
  it("returns nothing for a file without the expected columns", () => {
    expect(parseAtsCompanySlugs("a,b\n1,2\n")).toEqual([]);
  });
});

describe("parseOpenJobsSlugs", () => {
  it("takes running boards of discovery systems and leaves gone boards and other systems out", () => {
    const data = { ats: { greenhouse: ["acme", "  "], lever: ["15five"], workday: ["acme.wd1.myworkdayjobs.com"], paycom: ["x"] }, gone: { greenhouse: ["old"] } };
    expect(parseOpenJobsSlugs(data)).toEqual([
      { atsType: "greenhouse", token: "acme", name: null },
      { atsType: "lever", token: "15five", name: null },
    ]);
    expect(parseOpenJobsSlugs(null)).toEqual([]);
  });
});

describe("tregSource", () => {
  it("stays off without a key, and with one until it is built", () => {
    expect(tregSource.disabledReason({})).toMatch(/no TREG_API_KEY/);
    expect(tregSource.disabledReason({ TREG_API_KEY: "set" })).toMatch(/not built/);
    expect(CANDIDATE_SOURCES.at(-1)).toBe(tregSource);
  });
});

describe("politeDownload", () => {
  it("sends the User-Agent, waits between files and treats 404 as absent", async () => {
    const asked: { url: string; ua: string | null }[] = [];
    const waits: number[] = [];
    const download = politeDownload({
      gapMs: 700,
      sleep: async (ms) => { waits.push(ms); },
      fetch: (async (url: string, init?: RequestInit) => {
        asked.push({ url, ua: new Headers(init?.headers).get("user-agent") });
        return url.endsWith("missing") ? new Response("no", { status: 404 }) : new Response("body");
      }) as typeof fetch,
    });
    expect(await download("https://example.test/file")).toBe("body");
    expect(await download("https://example.test/missing")).toBeNull();
    expect(asked[0]!.ua).toMatch(/^NorinoteJobAgent/);
    expect(waits).toEqual([700]);
  });
});

describe("loadCandidates", () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.db.delete(boardCandidates);
    await t.db.delete(companies);
  });

  const listing = (id: string, boards: { atsType: "greenhouse" | "lever" | "ashby" | "recruitee"; token: string; name?: string | null }[]): CandidateSource => ({
    id, licence: "test", disabledReason: () => null,
    list: async () => boards.map((b) => ({ ...b, name: b.name ?? null })),
  });
  const ctx = { download: async () => null, env: {} };

  it("stores new boards once, records every source that listed them, and skips blocked and parked systems", async () => {
    const report = await loadCandidates(t.db, [
      listing("seed:a", [{ atsType: "greenhouse", token: "acme", name: "Acme" }, { atsType: "lever", token: "beta" }, { atsType: "recruitee", token: "parked" }]),
      listing("seed:b", [{ atsType: "greenhouse", token: "ACME" }, { atsType: "ashby", token: "gamma" }, { atsType: "ashby", token: "gamma" }]),
    ], ctx);
    expect(report.map((r) => [r.source, r.listed, r.added, r.alreadyKnown, r.skipped])).toEqual([
      ["seed:a", 3, 2, 0, 1],
      ["seed:b", 3, 1, 2, 0],
    ]);
    const rows = await t.db.select().from(boardCandidates);
    const byToken = Object.fromEntries(rows.map((r) => [r.atsToken, r]));
    expect(byToken.acme).toMatchObject({ name: "Acme", sources: ["seed:a", "seed:b"], status: "new" });
    expect(byToken.beta).toMatchObject({ name: "Beta", sources: ["seed:a"] });
    expect(byToken.gamma).toMatchObject({ sources: ["seed:b"] });

    // Loading again adds nothing and does not repeat a source.
    await loadCandidates(t.db, [listing("seed:a", [{ atsType: "greenhouse", token: "acme" }])], ctx);
    const [acme] = (await t.db.select().from(boardCandidates)).filter((r) => r.atsToken === "acme");
    expect(acme!.sources).toEqual(["seed:a", "seed:b"]);
  });

  it("links a board that is already live in the registry as promoted, and treats a dead one as new", async () => {
    const [live] = await t.db.insert(companies).values({ name: "Live", atsType: "greenhouse", atsToken: "live", status: "active" }).returning();
    await t.db.insert(companies).values({ name: "Dead", atsType: "greenhouse", atsToken: "dead", status: "dead" });
    await loadCandidates(t.db, [listing("seed:a", [{ atsType: "greenhouse", token: "live" }, { atsType: "greenhouse", token: "dead" }])], ctx);
    const rows = await t.db.select().from(boardCandidates);
    expect(rows.find((r) => r.atsToken === "live")).toMatchObject({ status: "promoted", companyId: live!.id });
    expect(rows.find((r) => r.atsToken === "dead")).toMatchObject({ status: "new", companyId: null });
  });

  it("lists people's additions from the registry", async () => {
    await t.db.insert(companies).values([
      { name: "Added", atsType: "ashby", atsToken: "added", status: "active", discoveredVia: "user" },
      { name: "Curated", atsType: "ashby", atsToken: "curated", status: "active", discoveredVia: "registry" },
    ]);
    const [user] = CANDIDATE_SOURCES;
    await loadCandidates(t.db, [user!], ctx);
    const rows = await t.db.select().from(boardCandidates);
    expect(rows.map((r) => [r.atsToken, r.status, r.sources])).toEqual([["added", "promoted", ["user"]]]);
  });

  it("reports a disabled source without calling it and goes on after a failing one", async () => {
    const failing: CandidateSource = { id: "seed:broken", licence: "test", disabledReason: () => null, list: async () => { throw new Error("offline"); } };
    const report = await loadCandidates(t.db, [tregSource, failing, listing("seed:a", [{ atsType: "lever", token: "ok" }])], ctx);
    expect(report[0]).toMatchObject({ source: "aggregator:treg", disabled: expect.stringMatching(/TREG_API_KEY/), listed: 0 });
    expect(report[1]).toMatchObject({ source: "seed:broken", error: "offline" });
    expect(report[2]).toMatchObject({ source: "seed:a", added: 1 });
  });
});
