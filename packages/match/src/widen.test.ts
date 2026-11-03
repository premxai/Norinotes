import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeEmbedding, setProvider } from "@norinote/ai";
import { eq, profiles, shortlist } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { clearRolePoolCache } from "./roles.js";
import { buildShortlist, clearRequirementVectorCache } from "./shortlist.js";
import { NEUTRAL_DESCRIPTION, NOW, baseSpec, daysAgo, hoursAgo, seedCompany, seedJob, seedLane, seedPoint, seedUser } from "./test-helpers.js";
import { deriveTemporaryLane, loadTemporaryLane, widenedByOf, withoutWidenedReasons, wideningPlan } from "./widen.js";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
  clearRequirementVectorCache();
  clearRolePoolCache();
});
afterEach(async () => {
  setProvider(null);
  await t.close();
});

const vec = fakeEmbedding("frontend engineer react typescript");
const SPEC = baseSpec({ roleFamily: "frontend engineering", skills: [{ name: "React", level: "working", years: null, required: true }], mustHaves: ["React"] });
/** A posting the heuristic spec can read (widened jobs without a stored spec are read this way). */
const REACT_POSTING = `Requirements: React and TypeScript. ${NEUTRAL_DESCRIPTION}`;

/**
 * A frontend engineer in San Francisco whose lane matches `laneJobs` jobs, plus pools of jobs for each widening step. Every
 * widened job is a plausible frontend job (widening has a fit floor): some have a stored spec, the rest a posting the
 * heuristic spec reads; some have an embedding, the rest are ranked by skill overlap. `stale` jobs fit the lane but were posted more
 * than 72 hours ago: no step ever brings them in.
 */
async function seed(o: { laneJobs: number; adjacent?: number; remote?: number; stale?: number; pool?: number; remoteExcluded?: boolean; lanes?: boolean }) {
  const co = await seedCompany(t.db, { name: "Index Co" });
  const userId = await seedUser(t.db, { location: "San Francisco, CA", workAuth: { US: { authorized: true, needsSponsorship: false } } });
  await seedPoint(t.db, userId, { title: "Frontend Engineer", org: "Prev", start: "2021-01", end: null, text: "Built React apps", skills: ["react", "typescript"] });
  if (o.lanes !== false) await seedLane(t.db, userId, { titles: ["Frontend Engineer"], locations: ["San Francisco, CA"], remote: false, minFit: 0.2 });
  if (o.remoteExcluded) await t.db.update(profiles).set({ preferences: { remote: "no" } }).where(eq(profiles.userId, userId));
  const make = async (n: number, title: (i: number) => string, over: Partial<Parameters<typeof seedJob>[1]> | ((i: number) => Partial<Parameters<typeof seedJob>[1]>) = {}) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      ids.push(await seedJob(t.db, {
        companyId: co, title: title(i), embedText: i % 2 === 0 ? "frontend engineer react" : undefined, spec: i % 3 === 0 ? SPEC : undefined,
        description: i % 3 === 0 ? undefined : REACT_POSTING, postedAt: hoursAgo(2 + i), ...(typeof over === "function" ? over(i) : over),
      }));
    }
    return ids;
  };
  const ids = {
    lane: await make(o.laneJobs, (i) => `Frontend Engineer, Lane ${i}`, { spec: SPEC }),
    adjacent: await make(o.adjacent ?? 0, (i) => `Software Engineer, Adjacent ${i}`),
    remote: await make(o.remote ?? 0, (i) => `Frontend Engineer, Remote ${i}`, { location: "Remote - US", remote: true }),
    stale: await make(o.stale ?? 0, (i) => `Frontend Engineer, Stale ${i}`, (i) => ({ postedAt: hoursAgo(73 + i), firstSeenAt: hoursAgo(73 + i) })),
    // Same family (software), not one of the adjacent titles: only the role pool brings these in.
    pool: await make(o.pool ?? 0, (i) => `React Developer, Pool ${i}`),
  };
  return { co, userId, ids };
}

const rowsOf = (userId: string) => t.db.select().from(shortlist).where(eq(shortlist.userId, userId));
const options = { profileEmbedding: vec, now: NOW };

describe("buildShortlist: the widening ladder", () => {
  it("widens from 3 lane matches to 20 in the order adjacent titles, remote, role pool, labels each step, and never widens age", async () => {
    const { userId, ids } = await seed({ laneJobs: 3, adjacent: 4, remote: 4, stale: 4, pool: 12 });
    const stats = await buildShortlist(t.db, userId, options);

    expect(stats.laneMatches).toBe(3);
    expect(stats.items).toHaveLength(20);
    expect(stats.saved).toBe(20);
    const by = (step: string) => stats.widened.filter((w) => w.by === step).map((w) => w.jobId);
    expect(new Set(by("adjacent_titles"))).toEqual(new Set(ids.adjacent));
    expect(new Set(by("remote"))).toEqual(new Set(ids.remote));
    expect(by("older")).toEqual([]);
    for (const id of ids.stale) expect(stats.items.map((i) => i.jobId)).not.toContain(id);
    expect(by("role_pool")).toHaveLength(9);
    expect(by("role_pool").every((id) => ids.pool.includes(id))).toBe(true);
    // Ladder order: the widened list never goes back to an earlier step.
    expect(stats.widened.map((w) => w.by)).toEqual([...Array(4).fill("adjacent_titles"), ...Array(4).fill("remote"), ...Array(9).fill("role_pool")]);
    expect(stats.poolUsed).toBe(true);
    expect(stats.temporaryLane).toBe(false);

    const rows = await rowsOf(userId);
    expect(rows).toHaveLength(20);
    const laneRows = rows.filter((r) => widenedByOf(r.reasons) === null);
    expect(new Set(laneRows.map((r) => r.jobId))).toEqual(new Set(ids.lane));
    for (const r of rows.filter((x) => widenedByOf(x.reasons) !== null)) {
      expect(r.reasons.at(-1)).toBe(`widened:${widenedByOf(r.reasons)}`);
      expect(withoutWidenedReasons(r.reasons).length).toBe(r.reasons.length - 1);
    }
  });

  it("stops at the first step that fills the list and does nothing when the lanes already give 20", async () => {
    const small = await seed({ laneJobs: 3, adjacent: 25, remote: 5, stale: 5, pool: 5 });
    const stats = await buildShortlist(t.db, small.userId, options);
    expect(stats.items).toHaveLength(20);
    expect(new Set(stats.widened.map((w) => w.by))).toEqual(new Set(["adjacent_titles"]));
    expect(stats.poolUsed).toBe(false);
    expect(stats.widened).toHaveLength(17);

    const full = await seed({ laneJobs: 22, adjacent: 5 });
    const s2 = await buildShortlist(t.db, full.userId, options);
    expect(s2.laneMatches).toBe(20);
    expect(s2.widened).toEqual([]);
    expect(await rowsOf(full.userId)).toHaveLength(20);
  });

  it("can be switched off, and falls short without error when the whole index has fewer jobs", async () => {
    const { userId } = await seed({ laneJobs: 2, adjacent: 1, pool: 1 });
    const off = await buildShortlist(t.db, userId, { ...options, widen: false });
    expect(off.items).toHaveLength(2);
    expect(off.widened).toEqual([]);
    const on = await buildShortlist(t.db, userId, options);
    expect(on.items).toHaveLength(4);
  });

  it("keeps the gates: citizenship, clearance and sponsorship rules still remove widened jobs", async () => {
    const { userId, co } = await seed({ laneJobs: 2 });
    await t.db.update(profiles).set({ workAuth: { US: { authorized: true, needsSponsorship: true, citizen: false } } }).where(eq(profiles.userId, userId));
    const ok = await seedJob(t.db, { companyId: co, title: "Software Engineer, Fine", embedText: "frontend engineer react", spec: baseSpec() });
    const citizen = await seedJob(t.db, { companyId: co, title: "Software Engineer, Citizens Only", embedText: "frontend engineer react", spec: baseSpec({ citizenshipRequired: true }) });
    const clearance = await seedJob(t.db, { companyId: co, title: "Software Engineer, Cleared", description: "Active TS/SCI security clearance required. US citizens only." });
    const noSponsor = await seedJob(t.db, { companyId: co, title: "Software Engineer, No Visa", spec: baseSpec({ sponsorship: "no", location: { remote: "unknown", countries: ["United States"], cities: [] } }) });
    const poolCitizen = await seedJob(t.db, { companyId: co, title: "React Developer, Citizens", description: `You must be a U.S. citizen to apply. ${REACT_POSTING}`, location: "San Francisco, CA" });
    const poolOk = await seedJob(t.db, { companyId: co, title: "React Developer, Open", description: REACT_POSTING, location: "San Francisco, CA" });

    const stats = await buildShortlist(t.db, userId, options);
    const ids = stats.items.map((i) => i.jobId);
    expect(ids).toContain(ok);
    expect(ids).toContain(poolOk);
    for (const bad of [citizen, clearance, noSponsor, poolCitizen]) expect(ids).not.toContain(bad);
    expect(stats.gated.map((g) => g.jobId)).toEqual(expect.arrayContaining([citizen, poolCitizen]));
  });

  it("keeps blocked companies, dismissed jobs and applied jobs out while widening", async () => {
    const { userId, co } = await seed({ laneJobs: 1 });
    const blocked = await seedCompany(t.db, { name: "Blocked", blocked: true });
    const fine = await seedJob(t.db, { companyId: co, title: "Software Engineer, Fine", spec: baseSpec(), embedText: "frontend engineer react" });
    const dismissed = await seedJob(t.db, { companyId: co, title: "Software Engineer, Dismissed", spec: baseSpec() });
    const poolDismissed = await seedJob(t.db, { companyId: co, title: "React Developer, Dismissed", description: REACT_POSTING, location: "San Francisco, CA" });
    const fromBlocked = await seedJob(t.db, { companyId: blocked, title: "Software Engineer, Blocked", spec: baseSpec() });
    const poolBlocked = await seedJob(t.db, { companyId: blocked, title: "React Developer, Blocked", description: REACT_POSTING, location: "San Francisco, CA" });
    const closed = await seedJob(t.db, { companyId: co, title: "Software Engineer, Closed", closedAt: daysAgo(1) });
    await t.db.insert(shortlist).values([dismissed, poolDismissed].map((jobId) => ({ userId, jobId, fit: 0.9, status: "dismissed" as const })));

    const stats = await buildShortlist(t.db, userId, options);
    const ids = stats.items.map((i) => i.jobId);
    expect(ids).toContain(fine);
    for (const bad of [dismissed, poolDismissed, fromBlocked, poolBlocked, closed]) expect(ids).not.toContain(bad);
    expect((await rowsOf(userId)).filter((r) => r.status === "dismissed").map((r) => r.jobId).sort()).toEqual([dismissed, poolDismissed].sort());
  });

  it("skips the remote step for a user who said no remote, and never admits remote jobs that way", async () => {
    const { userId, ids } = await seed({ laneJobs: 2, remote: 6, stale: 2, remoteExcluded: true });
    const stats = await buildShortlist(t.db, userId, options);
    expect(stats.widened.map((w) => w.by)).not.toContain("remote");
    for (const id of ids.remote) expect(stats.items.map((i) => i.jobId)).not.toContain(id);
    for (const id of ids.stale) expect(stats.items.map((i) => i.jobId)).not.toContain(id);
    expect(wideningPlan([{ titles: ["Frontend Engineer"], locations: ["San Francisco, CA"], remote: false }], { remoteExcluded: true }).map((s) => s.by)).toEqual(["adjacent_titles", "role_pool"]);
  });

  it("only adds steps that change something: a remote lane has no remote step, an unknown title no adjacent step, and no step widens age", () => {
    expect(wideningPlan([{ titles: ["Frontend Engineer"], locations: ["San Francisco, CA"], remote: false }], { remoteExcluded: false }).map((s) => s.by)).toEqual(["adjacent_titles", "remote", "role_pool"]);
    expect(wideningPlan([{ titles: ["Frontend Engineer"], locations: ["Austin"], remote: true }], { remoteExcluded: false }).map((s) => s.by)).toEqual(["adjacent_titles", "role_pool"]);
    expect(wideningPlan([{ titles: ["Barista"], locations: [], remote: false }], { remoteExcluded: false })).toEqual([]);
    const pool = wideningPlan([{ titles: ["Product Manager"], locations: ["Boston, MA"], remote: false }], { remoteExcluded: false }).at(-1)!;
    expect(pool).toMatchObject({ by: "role_pool", pool: { family: "product", metro: "Boston, MA", remote: true } });
  });

  it("removes widened rows a later run no longer chooses, and clears the label when the lanes match", async () => {
    const { userId, co, ids } = await seed({ laneJobs: 2, adjacent: 3 });
    await buildShortlist(t.db, userId, options);
    expect((await rowsOf(userId)).filter((r) => widenedByOf(r.reasons) === "adjacent_titles")).toHaveLength(3);

    // The adjacent jobs close and 20 jobs now fit the lane itself.
    for (const id of ids.adjacent) await t.db.execute(`update jobs set closed_at = now() where id = '${id}'`);
    for (let i = 0; i < 20; i++) await seedJob(t.db, { companyId: co, title: `Frontend Engineer, Fresh ${i}`, embedText: "frontend engineer react", spec: SPEC });
    const stats = await buildShortlist(t.db, userId, options);
    expect(stats.widened).toEqual([]);
    const rows = await rowsOf(userId);
    expect(rows.every((r) => widenedByOf(r.reasons) === null)).toBe(true);
    expect(rows.some((r) => ids.adjacent.includes(r.jobId))).toBe(false);
  });
});

describe("temporary lane from career points", () => {
  it("takes the most recent role title and the profile location", () => {
    const lane = deriveTemporaryLane([
      { kind: "role", title: "Junior Developer at Old Co", startDate: "2015-01", endDate: "2017-06", scope: {} },
      { kind: "role", title: "Senior Frontend Engineer at Acme", startDate: "2020-03", endDate: null, scope: { location: "Denver, CO" } },
      { kind: "role", title: "Software Engineer", startDate: "2017-07", endDate: "2020-02", scope: {} },
      { kind: "project", title: "Side project", startDate: "2024-01", endDate: null, scope: {} },
    ], "Seattle, WA", NOW);
    expect(lane).toMatchObject({ titles: ["Senior Frontend Engineer"], locations: ["Seattle, WA"], remote: true, temporary: true, enabled: true });
    expect(deriveTemporaryLane([{ kind: "role", title: "Barista", startDate: "2020", endDate: null, scope: { city: "Reno" } }], null, NOW)?.locations).toEqual(["Reno"]);
    expect(deriveTemporaryLane([{ kind: "project", title: "x", startDate: null, endDate: null, scope: {} }], "Austin", NOW)).toBeNull();
    expect(deriveTemporaryLane([], "Austin", NOW)).toBeNull();
  });

  it("builds a shortlist for a user with no lanes, from their last role and location, without saving a lane", async () => {
    const { userId, ids } = await seed({ laneJobs: 5, adjacent: 3, lanes: false });
    expect((await loadTemporaryLane(t.db, userId, NOW))?.titles).toEqual(["Frontend Engineer"]);
    const stats = await buildShortlist(t.db, userId, options);
    expect(stats.temporaryLane).toBe(true);
    expect(stats.laneMatches).toBe(5);
    expect(new Set(stats.items.slice(0, 5).map((i) => i.jobId))).toEqual(new Set(ids.lane));
    expect(stats.items.length).toBe(8);
    expect(await t.db.execute("select count(*)::int as n from lanes")).toBeTruthy();
    const { rows } = (await t.db.execute(`select count(*)::int as n from lanes where user_id = '${userId}'`)) as unknown as { rows: Array<{ n: number }> };
    expect(rows[0]!.n).toBe(0);
  });

  it("has no shortlist for a user with neither lanes nor roles", async () => {
    const userId = await seedUser(t.db);
    expect((await buildShortlist(t.db, userId, { profileEmbedding: vec, now: NOW })).items).toEqual([]);
  });
});
