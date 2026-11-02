import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider, fakeEmbedding, setProvider } from "@norinote/ai";
import { and, applications, eq, shortlist, sql } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { FitMapEntry } from "@norinote/shared";
import { laneFitsJob } from "./lanes.js";
import { buildShortlist, clearRequirementVectorCache, matchNewJobs, saveShortlistRows } from "./shortlist.js";
import { NOW, baseSpec, daysAgo, seedCompany, seedJob, seedLane, seedPoint, seedUser } from "./test-helpers.js";

let t: TestDb;
let companyId: string;
beforeAll(async () => {
  t = await createTestDb();
  companyId = await seedCompany(t.db);
});
afterAll(() => t.close());
beforeEach(() => clearRequirementVectorCache());
afterEach(() => setProvider(null));

const rowsOf = (userId: string) => t.db.select().from(shortlist).where(eq(shortlist.userId, userId));
const profileVec = (text: string) => fakeEmbedding(text);

describe("buildShortlist: the SQL filter", () => {
  it("keeps open, fresh, unblocked jobs that fit an enabled lane, and nothing else", async () => {
    const userId = await seedUser(t.db);
    await seedLane(t.db, userId, { titles: ["Senior Zeta Engineer"], locations: ["San Francisco, CA"], remote: true });
    await seedLane(t.db, userId, { titles: ["Zeta Manager"], locations: [], enabled: false });
    const blocked = await seedCompany(t.db, { name: "Blocked Inc", blocked: true });
    const mk = (title: string, over: Parameters<typeof seedJob>[1] extends infer P ? Partial<P> : never = {}) =>
      seedJob(t.db, { companyId, title, embedText: "zeta engineer", spec: baseSpec(), ...over });

    const ok = {
      sf: await mk("Zeta Engineer II"),
      developer: await mk("Staff Zeta Developer, Payments", { location: "San Francisco Bay Area" }),
      remote: await mk("Zeta Engineers", { location: "Remote - Germany", remote: true }),
      noPostedDate: await mk("Zeta Engineer", { postedAt: null, firstSeenAt: daysAgo(10) }),
      justInside: await mk("Zeta Engineer, Platform", { postedAt: daysAgo(59) }),
    };
    const out = {
      tooOld: await mk("Zeta Engineer", { postedAt: daysAgo(61), firstSeenAt: daysAgo(61) }),
      oldFirstSeen: await mk("Zeta Engineer", { postedAt: null, firstSeenAt: daysAgo(61) }),
      closed: await mk("Zeta Engineer", { closedAt: daysAgo(1) }),
      blocked: await seedJob(t.db, { companyId: blocked, title: "Zeta Engineer", embedText: "zeta engineer", spec: baseSpec() }),
      wrongTitle: await mk("Zeta Marketing Manager"),
      disabledLaneTitle: await mk("Zeta Manager"),
      wrongCity: await mk("Zeta Engineer", { location: "London, UK" }),
      noLocation: await mk("Zeta Engineer", { location: null }),
      missingWord: await mk("Zeta Analyst"),
    };
    // A job nobody embedded yet cannot be ranked, so it is not a candidate.
    await seedJob(t.db, { companyId, title: "Zeta Engineer", spec: baseSpec() });

    const stats = await buildShortlist(t.db, userId, { profileEmbedding: profileVec("zeta engineer"), now: NOW, candidates: 100 });
    expect(new Set(stats.candidateIds)).toEqual(new Set(Object.values(ok)));
    for (const id of Object.values(out)) expect(stats.candidateIds).not.toContain(id);
  });

  it("agrees with the in-memory lane matcher across many titles and places", async () => {
    const userId = await seedUser(t.db);
    const lanesInput = [
      { name: "A", titles: ["Product Designer", "UX Designer"], locations: ["New York, NY", "United States"], remote: false },
      { name: "B", titles: ["Senior Data Scientist"], locations: ["Austin, TX"], remote: true },
    ];
    for (const l of lanesInput) await seedLane(t.db, userId, l);
    const titles = ["Product Designer", "Senior UX Designer II", "Designer", "Data Scientist, Growth", "Data Analyst", "Product Design Lead", "Staff Data Scientists"];
    const places: Array<[string | null, boolean]> = [["New York City", false], ["Remote - US", true], ["Austin, Texas", false], ["Berlin", true], ["Berlin", false], [null, false], ["Chicago, USA", false]];
    const jobsMade: Array<{ id: string; title: string; location: string | null; remote: boolean }> = [];
    for (const title of titles) for (const [location, remote] of places) {
      const id = await seedJob(t.db, { companyId, title: `Theta ${title}`, location, remote, embedText: "designer", spec: baseSpec() });
      jobsMade.push({ id, title: `Theta ${title}`, location, remote });
    }
    // "Theta" is not in any lane title, so make the lanes ignore it: lane words must all be present, so it never matters.
    const stats = await buildShortlist(t.db, userId, { profileEmbedding: profileVec("designer"), now: NOW, candidates: 1000 });
    const expected = jobsMade.filter((j) => lanesInput.some((l) => laneFitsJob({ ...l, enabled: true }, j))).map((j) => j.id);
    expect(expected.length).toBeGreaterThan(10);
    expect(expected.length).toBeLessThan(jobsMade.length);
    expect(new Set(stats.candidateIds)).toEqual(new Set(expected));
  });

  it("skips jobs the user already dismissed, applied to or started", async () => {
    const userId = await seedUser(t.db);
    await seedLane(t.db, userId, { titles: ["Iota Engineer"], locations: [] });
    const fresh = await seedJob(t.db, { companyId, title: "Iota Engineer", embedText: "iota", spec: baseSpec() });
    const dismissed = await seedJob(t.db, { companyId, title: "Iota Engineer", embedText: "iota", spec: baseSpec() });
    const applied = await seedJob(t.db, { companyId, title: "Iota Engineer", embedText: "iota", spec: baseSpec() });
    const started = await seedJob(t.db, { companyId, title: "Iota Engineer", embedText: "iota", spec: baseSpec() });
    await t.db.insert(shortlist).values([
      { userId, jobId: dismissed, fit: 0.9, status: "dismissed" },
      { userId, jobId: applied, fit: 0.9, status: "applied" },
    ]);
    await t.db.insert(applications).values({ userId, jobId: started });
    const stats = await buildShortlist(t.db, userId, { profileEmbedding: profileVec("iota"), now: NOW });
    expect(stats.candidateIds).toEqual([fresh]);
  });

  it("returns nothing for a user with no enabled lane", async () => {
    const userId = await seedUser(t.db);
    await seedLane(t.db, userId, { enabled: false });
    const stats = await buildShortlist(t.db, userId, { profileEmbedding: profileVec("x"), now: NOW });
    expect(stats).toMatchObject({ considered: 0, saved: 0, items: [] });
  });
});

describe("buildShortlist: vector ranking", () => {
  it("orders candidates by cosine similarity to the profile and keeps only the nearest", async () => {
    const userId = await seedUser(t.db);
    await seedLane(t.db, userId, { titles: ["Kappa Engineer"], locations: [] });
    const make = (embedText: string) => seedJob(t.db, { companyId, title: "Kappa Engineer", embedText, spec: baseSpec() });
    const best = await make("typescript react node services");
    const middle = await make("typescript react design");
    const weak = await make("typescript cooking");
    const none = await make("watercolour painting lessons");
    const profileEmbedding = profileVec("typescript react node services");

    const all = await buildShortlist(t.db, userId, { profileEmbedding, now: NOW });
    expect(all.candidateIds).toEqual([best, middle, weak, none]);
    const top2 = await buildShortlist(t.db, userId, { profileEmbedding, now: NOW, candidates: 2 });
    expect(top2.candidateIds).toEqual([best, middle]);
  });
});

describe("buildShortlist: detailed fit, gates and saving", () => {
  let seq = 0;
  async function setup(workAuth: Record<string, unknown> = {}) {
    const word = `Lambda${"abcdefghijklmnop"[seq++]}`;
    const userId = await seedUser(t.db, { workAuth });
    const laneId = await seedLane(t.db, userId, { name: "Backend", titles: [`${word} Engineer`], locations: [], minFit: 0.5 });
    const backend = await seedPoint(t.db, userId, {
      title: "Backend Engineer", org: "Acme", start: "2020-01", skills: ["TypeScript", "Postgres"], text: "built typescript services on postgresql",
      scope: { teamSize: 5 }, metrics: { latency: "-30%" },
    });
    await seedPoint(t.db, userId, { title: "Platform Engineer", org: "Initech", start: "2018-01", end: "2019-12", skills: ["Docker", "Kubernetes"], text: "ran docker and kubernetes platform" });
    const job = (title: string, spec: ReturnType<typeof baseSpec>, over: Partial<Parameters<typeof seedJob>[1]> = {}) =>
      seedJob(t.db, { companyId, title: title.replace("Lambda", word), spec, embedText: `${word} engineer typescript postgresql services backend`, ...over });
    return { userId, laneId, backend, job, word };
  }

  it("scores each requirement, caps on must-haves, applies gates and the lane minimum, and saves the rest", async () => {
    const { userId, backend, job, word } = await setup({ US: { authorized: true, needsSponsorship: true } });
    const strong = await job("Lambda Engineer", baseSpec({ mustHaves: ["TypeScript"], niceToHaves: ["Docker"], skills: [{ name: "PostgreSQL", level: "working", years: null, required: true }], yearsMin: 3 }));
    const capped = await job("Lambda Engineer, Systems", baseSpec({ mustHaves: ["Rust"], niceToHaves: ["TypeScript", "PostgreSQL", "Docker"], requirementWeights: { Rust: 1, TypeScript: 1, PostgreSQL: 1, Docker: 1 } }));
    const gated = await job("Lambda Engineer, Public", baseSpec({ mustHaves: ["TypeScript"], sponsorship: "no" }));
    const noSpec = await seedJob(t.db, { companyId, title: `${word} Engineer, New`, embedText: "lambda engineer" });

    const stats = await buildShortlist(t.db, userId, { profileEmbedding: profileVec("typescript postgresql backend services"), now: NOW });
    expect(stats.considered).toBe(4);
    expect(stats.withoutSpec).toBe(1);
    expect(noSpec).toBeTruthy();
    expect(stats.gated).toEqual([{ jobId: gated, reasons: ["This role does not offer visa sponsorship and you need it to work in US."] }]);
    expect(stats.belowMinFit).toBe(1);
    expect(stats.scored).toBe(2);
    expect(stats.saved).toBe(1);

    const rows = await rowsOf(userId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.jobId).toBe(strong);
    expect(row.status).toBe("new");
    expect(row.fit).toBeGreaterThan(0.75);
    expect(row.reasons.length).toBeGreaterThanOrEqual(2);
    expect(row.reasons.length).toBeLessThanOrEqual(3);
    const fitMap = row.fitMap as Array<{ requirement: string; careerPointIds: string[]; score: number; evidence: string; note: string }>;
    for (const e of fitMap) expect(FitMapEntry.safeParse(e).success).toBe(true);
    const ts = fitMap.find((e) => e.requirement === "TypeScript")!;
    expect(ts).toMatchObject({ careerPointIds: [backend], evidence: "exact" });
    expect(ts.note).toMatch(/Backend Engineer at Acme/);
    // The listed skill "PostgreSQL" is scored as a requirement even though no text names it; Docker came from another job.
    expect(fitMap.map((e) => e.requirement)).toEqual(expect.arrayContaining(["TypeScript", "Docker", "PostgreSQL"]));
    expect(capped).toBeTruthy();
  });

  it("a low-fit job under a low minimum is saved with a capped fit", async () => {
    const { userId, laneId, job } = await setup();
    await t.db.execute(sql`UPDATE lanes SET min_fit = 0 WHERE id = ${laneId}`);
    const capped = await job("Lambda Engineer, Systems", baseSpec({ mustHaves: ["Rust"], niceToHaves: ["TypeScript", "PostgreSQL", "Docker"], requirementWeights: { Rust: 1, TypeScript: 1, PostgreSQL: 1, Docker: 1 } }));
    const stats = await buildShortlist(t.db, userId, { profileEmbedding: profileVec("typescript postgresql"), now: NOW });
    expect(stats.saved).toBe(1);
    const [row] = await rowsOf(userId);
    expect(row!.jobId).toBe(capped);
    expect(row!.fit).toBeLessThanOrEqual(0.31);
    expect(row!.reasons).toContain("Gap: Rust");
  });

  it("keeps only the best `limit` rows, best first", async () => {
    const { userId, laneId, job } = await setup();
    await t.db.execute(sql`UPDATE lanes SET min_fit = 0 WHERE id = ${laneId}`);
    const good = await job("Lambda Engineer", baseSpec({ mustHaves: ["TypeScript"] }));
    const ok = await job("Lambda Engineer", baseSpec({ mustHaves: ["TypeScript"], niceToHaves: ["Rust"] }));
    await job("Lambda Engineer", baseSpec({ mustHaves: ["Rust"] }));
    const stats = await buildShortlist(t.db, userId, { profileEmbedding: profileVec("typescript"), now: NOW, limit: 2 });
    expect(stats.items.map((i) => i.jobId)).toEqual([good, ok]);
    expect(stats.items[0]!.fit).toBeGreaterThan(stats.items[1]!.fit);
    expect(await rowsOf(userId)).toHaveLength(2);
  });

  it("refreshes rows that are still new on a rebuild, and never brings back dismissed or applied ones", async () => {
    const { userId, job } = await setup();
    const a = await job("Lambda Engineer", baseSpec({ mustHaves: ["TypeScript"] }));
    const b = await job("Lambda Engineer", baseSpec({ mustHaves: ["TypeScript"] }));
    const c = await job("Lambda Engineer", baseSpec({ mustHaves: ["TypeScript"] }));
    const opts = { profileEmbedding: profileVec("typescript postgresql backend services"), now: NOW };
    expect((await buildShortlist(t.db, userId, opts)).saved).toBe(3);

    const set = (jobId: string, patch: Partial<typeof shortlist.$inferInsert>) =>
      t.db.update(shortlist).set(patch).where(and(eq(shortlist.userId, userId), eq(shortlist.jobId, jobId)));
    await set(a, { fit: 0.111, status: "dismissed", reasons: ["user said no"] });
    await set(b, { fit: 0.222, status: "applied" });
    await set(c, { fit: 0.333 });

    // The rebuild does not even consider a and b; c is refreshed back to its real fit.
    const again = await buildShortlist(t.db, userId, opts);
    expect(again.candidateIds).toEqual([c]);
    const byJob = new Map((await rowsOf(userId)).map((r) => [r.jobId, r]));
    expect(byJob.get(a)).toMatchObject({ fit: 0.111, status: "dismissed", reasons: ["user said no"] });
    expect(byJob.get(b)).toMatchObject({ fit: 0.222, status: "applied" });
    expect(byJob.get(c)!.fit).toBeGreaterThan(0.7);
    expect(byJob.get(c)!.status).toBe("new");
  });

  it("saveShortlistRows itself leaves dismissed and applied rows alone even when asked to overwrite them", async () => {
    const userId = await seedUser(t.db);
    const mk = () => seedJob(t.db, { companyId, title: "Rho Engineer" });
    const [j1, j2, j3] = [await mk(), await mk(), await mk()];
    await t.db.insert(shortlist).values([
      { userId, jobId: j1, fit: 0.1, status: "dismissed", reasons: ["old"] },
      { userId, jobId: j2, fit: 0.2, status: "applied", reasons: ["old"] },
      { userId, jobId: j3, fit: 0.3, status: "new", reasons: ["old"] },
    ]);
    const saved = await saveShortlistRows(t.db, userId, [j1, j2, j3].map((jobId) => ({ jobId, fit: 0.99, fitMap: [], reasons: ["new"] })));
    expect(saved).toBe(1);
    const byJob = new Map((await rowsOf(userId)).map((r) => [r.jobId, r]));
    expect(byJob.get(j1)).toMatchObject({ fit: 0.1, status: "dismissed", reasons: ["old"] });
    expect(byJob.get(j2)).toMatchObject({ fit: 0.2, status: "applied", reasons: ["old"] });
    expect(byJob.get(j3)).toMatchObject({ fit: 0.99, status: "new", reasons: ["new"] });
  });

  it("makes no model call unless asked, then one budgeted call per top match", async () => {
    const { userId, job } = await setup();
    await job("Lambda Engineer", baseSpec({ mustHaves: ["TypeScript"] }));
    await job("Lambda Engineer, Two", baseSpec({ mustHaves: ["TypeScript"] }));
    const fake = createFakeProvider({ chat: () => ({ line: "You have shipped TypeScript services at Acme." }) });
    setProvider(fake);
    const opts = { profileEmbedding: profileVec("typescript postgresql backend services"), now: NOW };

    await buildShortlist(t.db, userId, opts);
    expect(fake.calls.filter((c) => c.jsonSchema)).toHaveLength(0);

    await t.db.delete(shortlist).where(eq(shortlist.userId, userId));
    const stats = await buildShortlist(t.db, userId, { ...opts, explain: { top: 1 } });
    expect(fake.calls.filter((c) => c.jsonSchema)).toHaveLength(1);
    expect(fake.calls.find((c) => c.jsonSchema)!.model).toBe("gpt-4.1-mini");
    expect(stats.items[0]!.reasons[0]).toBe("You have shipped TypeScript services at Acme.");
    expect(stats.items[0]!.reasons.length).toBeLessThanOrEqual(3);
    expect(stats.items[1]!.reasons[0]).not.toMatch(/shipped/);
    const [saved] = await t.db.select().from(shortlist).where(and(eq(shortlist.userId, userId), eq(shortlist.jobId, stats.items[0]!.jobId)));
    expect(saved!.reasons[0]).toBe("You have shipped TypeScript services at Acme.");
  });

  it("falls back to the plain reasons when the model call fails", async () => {
    const { userId, job } = await setup();
    await job("Lambda Engineer", baseSpec({ mustHaves: ["TypeScript"] }));
    setProvider({ name: "broken", chat: () => Promise.reject(new Error("boom")), embed: async (r) => ({ vectors: r.texts.map((x) => fakeEmbedding(x)), promptTokens: 1 }) });
    const stats = await buildShortlist(t.db, userId, { profileEmbedding: profileVec("typescript"), now: NOW, explain: {} });
    expect(stats.saved).toBe(1);
    expect(stats.items[0]!.reasons[0]).toMatch(/^Strong evidence for TypeScript/);
  });
});

describe("matchNewJobs", () => {
  it("only evaluates users whose lanes fit the new jobs and whose profile is close", async () => {
    const jobText = "sigma engineer typescript postgresql services backend";
    const pointOf = (userId: string) => seedPoint(t.db, userId, { title: "Backend Engineer", org: "Acme", start: "2021-01", skills: ["TypeScript", "PostgreSQL"], text: "built typescript services on postgresql" });

    const fits = await seedUser(t.db);
    await seedLane(t.db, fits, { titles: ["Sigma Engineer"], locations: ["San Francisco, CA"], minFit: 0.4 });
    await pointOf(fits);
    const wrongLane = await seedUser(t.db);
    await seedLane(t.db, wrongLane, { titles: ["Sigma Nurse"], locations: ["San Francisco, CA"] });
    await pointOf(wrongLane);
    const wrongCity = await seedUser(t.db);
    await seedLane(t.db, wrongCity, { titles: ["Sigma Engineer"], locations: ["London"] });
    await pointOf(wrongCity);
    const noProfile = await seedUser(t.db);
    await seedLane(t.db, noProfile, { titles: ["Sigma Engineer"], locations: ["San Francisco, CA"] });
    const disabled = await seedUser(t.db);
    await seedLane(t.db, disabled, { titles: ["Sigma Engineer"], locations: ["San Francisco, CA"], enabled: false });
    await pointOf(disabled);

    const spec = baseSpec({ mustHaves: ["TypeScript"], niceToHaves: ["PostgreSQL"] });
    const close = await seedJob(t.db, { companyId, title: "Sigma Engineer", spec, embedText: jobText });
    const far = await seedJob(t.db, { companyId, title: "Sigma Engineer, Marine", spec, embedText: "marine biology fieldwork diving" });
    const closed = await seedJob(t.db, { companyId, title: "Sigma Engineer", spec, embedText: jobText, closedAt: daysAgo(1) });

    const result = await matchNewJobs(t.db, [close, far, closed], { now: NOW });
    // Pairs: the fitting user with the two open jobs. Everyone else is not even looked at.
    expect(result.lanePairs).toBe(2);
    expect(result.usersEvaluated).toBe(1);
    expect(Object.keys(result.perUser)).toEqual([fits]);
    expect(result.pairsFitted).toBe(1);
    expect(result.saved).toBe(1);

    const rows = await rowsOf(fits);
    expect(rows.map((r) => r.jobId)).toEqual([close]);
    expect(rows[0]!.fit).toBeGreaterThan(0.7);
    for (const other of [wrongLane, wrongCity, noProfile, disabled]) expect(await rowsOf(other)).toEqual([]);

    // Running it again refreshes the same row and never duplicates it.
    expect((await matchNewJobs(t.db, [close], { now: NOW })).saved).toBe(1);
    expect(await rowsOf(fits)).toHaveLength(1);
  });

  it("honours a stricter similarity threshold, gates and dismissed rows", async () => {
    const userId = await seedUser(t.db, { workAuth: { US: { needsSponsorship: true } } });
    await seedLane(t.db, userId, { titles: ["Omega Engineer"], locations: [], minFit: 0.3 });
    await seedPoint(t.db, userId, { title: "Backend Engineer", start: "2021-01", skills: ["TypeScript"], text: "typescript services" });
    const text = "omega engineer typescript services";
    const ok = await seedJob(t.db, { companyId, title: "Omega Engineer", spec: baseSpec({ mustHaves: ["TypeScript"] }), embedText: text });
    const noSponsor = await seedJob(t.db, { companyId, title: "Omega Engineer", spec: baseSpec({ mustHaves: ["TypeScript"], sponsorship: "no" }), embedText: text });
    const dismissed = await seedJob(t.db, { companyId, title: "Omega Engineer", spec: baseSpec({ mustHaves: ["TypeScript"] }), embedText: text });
    await t.db.insert(shortlist).values({ userId, jobId: dismissed, fit: 0.5, status: "dismissed" });

    expect((await matchNewJobs(t.db, [ok], { now: NOW, minSimilarity: 0.99 })).saved).toBe(0);
    const r = await matchNewJobs(t.db, [ok, noSponsor, dismissed], { now: NOW });
    expect(r.lanePairs).toBe(2);
    expect(r.perUser[userId]!.gated.map((g) => g.jobId)).toEqual([noSponsor]);
    expect((await rowsOf(userId)).map((x) => [x.jobId, x.status]).sort()).toEqual([[dismissed, "dismissed"], [ok, "new"]].sort());
  });

  it("does nothing for an empty batch", async () => {
    expect(await matchNewJobs(t.db, [], { now: NOW })).toMatchObject({ usersEvaluated: 0, lanePairs: 0, saved: 0 });
  });
});
