import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, careerPointEmbeddings, careerPoints, eq, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { AiUnavailableError, BudgetExceededError, createFakeProvider, fakeEmbedding, recordUsage, setAiLogger, setProvider, usageToday, type ChatRequest } from "@norinote/ai";
import {
  addFact, buildCareerPoints, deleteCareerPoint, embedCareerPoints, embeddingTag, getGraph, metricsOf, pointSource, profileEmbedding, summarizeSkills,
} from "./index.js";
import { SAMPLE_RESUME } from "./testkit.js";

let t: TestDb;
let n = 0;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());
beforeAll(() => setAiLogger(() => undefined)); // the cooldown warning is not test output
afterEach(() => { setProvider(null); vi.unstubAllEnvs(); });

async function newUser(): Promise<string> {
  const [u] = await t.db.insert(users).values({ email: `graph${n++}@example.test`, passwordHash: "x" }).returning();
  return u!.id;
}

const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
const noScope = { team_size: null, users: null, budget: null, ownership: null };
const pt = (over: Record<string, unknown>) => ({ title: "", org: null, start: null, end: null, text: "", skills: [], scope: noScope, metrics: [], source_quote: "", ...over });
const empty = { roles: [], projects: [], achievements: [], education: [], certifications: [], skills: [] };

/** Scripts the resume call (schema "career_graph") and the fact call (schema "career_fact"); anything else gets the default fake reply. */
function script(handlers: { resume?: (req: ChatRequest) => unknown; fact?: (req: ChatRequest) => unknown }) {
  const provider = createFakeProvider({
    chat: (req) => (req.jsonSchema?.name === "career_graph" ? handlers.resume?.(req) : req.jsonSchema?.name === "career_fact" ? handlers.fact?.(req) : undefined),
  });
  setProvider(provider);
  return provider;
}

const goodModelOutput = {
  ...empty,
  roles: [
    pt({
      title: "Senior Software Engineer", org: "Acme Cloud", start: "Jan 2021", end: "Present",
      text: "Led platform migration to Kubernetes and built a Kafka pipeline.", skills: ["k8s", "Kafka", "JS", "k8s"],
      scope: { team_size: 5, users: 2_000_000, budget: null, ownership: "lead" },
      metrics: [{ value: 60, unit: "%", measures: "deploy time reduction" }],
      source_quote: "Senior Software Engineer | Acme Cloud | Jan 2021 - Present",
    }),
  ],
  achievements: [
    pt({ title: "Cut cloud spend", org: "Beta Labs", start: "2018-06", end: "2020-12", text: "Reduced cloud spend by $120K per year", skills: ["AWS"], metrics: [{ value: 120000, unit: "USD", measures: "yearly cloud spend saved" }], source_quote: "Reduced cloud spend by $120K per year" }),
    // Paraphrased quote: the resume line it most resembles replaces it.
    pt({ title: "Kubernetes migration", text: "Moved 40 microservices", skills: ["Kubernetes"], source_quote: "Led team of five engineers moving 40 microservices to Kubernetes" }),
    // Invented: nothing like it in the resume.
    pt({ title: "Founder", org: "Imaginary Corp", text: "Founded a unicorn", source_quote: "Founded Imaginary Corp and raised a Series B" }),
  ],
  education: [pt({ title: "B.S. Computer Science", org: "State University", start: "2014", end: "2018", text: "B.S. Computer Science", source_quote: "B.S. Computer Science | State University | 2014 - 2018" })],
  skills: [pt({ title: "Infrastructure", text: "Kubernetes, Docker, Terraform, AWS", skills: ["Kubernetes", "Docker", "Terraform", "AWS"], source_quote: "Infrastructure: Kubernetes, Docker, Terraform, AWS" })],
};

describe("buildCareerPoints", () => {
  it("stores the model's points with canonical skills, normalised dates, scope, metrics and embeddings", async () => {
    const provider = script({ resume: () => goodModelOutput });
    const userId = await newUser();
    const r = await buildCareerPoints(t.db, userId, SAMPLE_RESUME);

    expect(r.source).toBe("model");
    expect(r.contact).toMatchObject({ fullName: "Priya Raman", email: "priya.raman@example.com" });
    expect(r.points.map((p) => p.title)).toEqual(["Senior Software Engineer", "Cut cloud spend", "Kubernetes migration", "B.S. Computer Science", "Infrastructure"]);

    const role = r.points[0]!;
    expect(role).toMatchObject({ kind: "role", org: "Acme Cloud", startDate: "2021-01", endDate: null });
    expect(role.skills).toEqual(["Kubernetes", "Kafka", "JavaScript"]);
    expect(role.scope).toEqual({ teamSize: 5, users: 2_000_000, ownership: "lead" });
    expect(role.source).toBe("resume");
    expect(metricsOf(role)).toEqual([{ value: 60, unit: "%", measures: "deploy time reduction" }]);
    expect(r.points[2]!.sourceQuote).toBe("• Led a team of 5 engineers migrating 40 microservices to k8s, cutting deploy time by 60%");
    expect(r.points.every((p) => pointSource(p) === "resume")).toBe(true);

    const stored = await t.db.select().from(careerPointEmbeddings).where(eq(careerPointEmbeddings.userId, userId));
    expect(stored).toHaveLength(5);
    expect(stored[0]!.embedding).toHaveLength(1536);

    // One model call with stable instructions in `system`, the resume only in the last message, and the user charged.
    expect(provider.calls).toHaveLength(1);
    const call = provider.calls[0]!;
    expect(call.model).toBe("gpt-4.1-mini");
    expect(call.messages[0]!.role).toBe("system");
    expect(call.messages[0]!.content).not.toContain("Priya");
    expect(call.messages.at(-1)!.content).toContain("Priya Raman");
    expect(call.jsonSchema).toMatchObject({ name: "career_graph", strict: true });
    expect((await usageToday(t.db, userId)).calls).toBeGreaterThanOrEqual(2); // chat + embeddings
  });

  it("falls back to the deterministic parser when the model's output is not valid JSON", async () => {
    script({ resume: () => "Sorry, I cannot do that." });
    const userId = await newUser();
    const r = await buildCareerPoints(t.db, userId, SAMPLE_RESUME);
    expect(r.source).toBe("heuristic");
    expect(r.points.find((p) => p.kind === "role" && p.title === "Senior Software Engineer")).toMatchObject({ org: "Acme Cloud", startDate: "2021-01", endDate: null });
    expect(r.points.some((p) => p.kind === "skill")).toBe(true);
    const stored = await t.db.select().from(careerPointEmbeddings).where(eq(careerPointEmbeddings.userId, userId));
    expect(stored).toHaveLength(r.points.length);
  });

  it("falls back when the output has the wrong shape, is empty, or every point is invented", async () => {
    const userId = await newUser();
    script({ resume: () => ({ roles: "none" }) });
    expect((await buildCareerPoints(t.db, userId, SAMPLE_RESUME)).source).toBe("heuristic");
    script({ resume: () => empty });
    expect((await buildCareerPoints(t.db, userId, SAMPLE_RESUME)).source).toBe("heuristic");
    script({ resume: () => ({ ...empty, roles: [pt({ title: "CEO", org: "Nowhere Inc", source_quote: "Chief Executive of Nowhere Inc since 1999" })] }) });
    expect((await buildCareerPoints(t.db, userId, SAMPLE_RESUME)).source).toBe("heuristic");
  });

  it("uses the heuristic under the default fake provider (no scripted output)", async () => {
    const r = await buildCareerPoints(t.db, await newUser(), SAMPLE_RESUME);
    expect(r.source).toBe("heuristic");
    expect(r.points.length).toBeGreaterThan(5);
  });

  it("replaces resume-sourced points but keeps facts the user added", async () => {
    script({ resume: () => goodModelOutput, fact: () => ({ points: [{ ...pt({ title: "Speaker at KubeCon", text: "Spoke at KubeCon 2024", skills: ["k8s"] }), source_quote: undefined, kind: "achievement" }] }) });
    const userId = await newUser();
    await buildCareerPoints(t.db, userId, SAMPLE_RESUME);
    const [fact] = (await addFact(t.db, userId, "I spoke at KubeCon 2024 about k8s")).points;
    const before = await getGraph(t.db, userId);
    expect(before.points).toHaveLength(6);

    script({ resume: () => ({ ...empty, roles: [pt({ title: "Data Analyst", org: "Globex", start: "2019-03", end: "2021-08", text: "Dashboards", skills: ["Tableau"], source_quote: "Data Analyst at Globex" })] }) });
    const second = await buildCareerPoints(t.db, userId, "Jane Doe\n\nEXPERIENCE\nData Analyst at Globex (March 2019 to August 2021)\n");
    expect(second.source).toBe("model");
    const after = await getGraph(t.db, userId);
    expect(after.points.map((p) => p.title).sort()).toEqual(["Data Analyst", "Speaker at KubeCon"]);
    expect(after.points.find((p) => p.id === fact!.id)).toBeDefined();
    // The old resume points' embeddings went with them; the fact's stayed.
    const embeds = await t.db.select().from(careerPointEmbeddings).where(eq(careerPointEmbeddings.userId, userId));
    expect(embeds.map((e) => e.careerPointId).sort()).toEqual(after.points.map((p) => p.id).sort());
  });

  it("keeps the previous points when a resume yields nothing, and refuses empty text", async () => {
    const userId = await newUser();
    await buildCareerPoints(t.db, userId, SAMPLE_RESUME);
    const count = (await getGraph(t.db, userId)).points.length;
    const r = await buildCareerPoints(t.db, userId, "hello world");
    expect(r).toMatchObject({ source: "none", points: [] });
    expect((await getGraph(t.db, userId)).points).toHaveLength(count);
    await expect(buildCareerPoints(t.db, userId, "  \n ")).rejects.toThrow(/empty/);
  });

  it("does not hide a spent daily budget behind the fallback, and leaves existing points alone", async () => {
    const userId = await newUser();
    await buildCareerPoints(t.db, userId, SAMPLE_RESUME);
    const count = (await getGraph(t.db, userId)).points.length;
    await recordUsage(t.db, userId, "gpt-4.1-mini", { promptTokens: 50, completionTokens: 0 });
    vi.stubEnv("AI_DAILY_TOKEN_BUDGET", "10");
    await expect(buildCareerPoints(t.db, userId, SAMPLE_RESUME)).rejects.toBeInstanceOf(BudgetExceededError);
    expect((await getGraph(t.db, userId)).points).toHaveLength(count);
  });

  it("only touches the given user's points", async () => {
    const a = await newUser();
    const b = await newUser();
    await buildCareerPoints(t.db, a, SAMPLE_RESUME);
    await buildCareerPoints(t.db, b, SAMPLE_RESUME);
    const bCount = (await getGraph(t.db, b)).points.length;
    await buildCareerPoints(t.db, a, SAMPLE_RESUME);
    expect((await getGraph(t.db, b)).points).toHaveLength(bCount);
  });
});

describe("addFact", () => {
  it("turns a fact into user-sourced points with canonical skills and embeds them", async () => {
    const provider = script({
      fact: () => ({
        points: [
          { ...pt({ title: "Open-source maintainer", org: "Nori", start: "2023-02", end: null, text: "Maintains an open-source job agent", skills: ["TS", "pgvector"], scope: { ...noScope, users: 300 } }), kind: "project" },
          { ...pt({ title: "Mentored interns", text: "Mentored 4 interns", metrics: [{ value: 4, unit: "interns", measures: "mentees" }] }), kind: "achievement" },
        ],
      }),
    });
    const userId = await newUser();
    const { points: made, source } = await addFact(t.db, userId, "Since Feb 2023 I maintain Nori, an open-source job agent (300 users); I also mentored 4 interns.");
    expect(source).toBe("model");
    expect(made).toHaveLength(2);
    expect(made[0]).toMatchObject({ kind: "project", title: "Open-source maintainer", startDate: "2023-02", endDate: null });
    expect(made[0]!.skills).toEqual(["TypeScript", "pgvector"]);
    expect(made.every((p) => pointSource(p) === "user" && p.sourceQuote?.includes("Nori"))).toBe(true);
    expect(provider.calls[0]!.model).toBe("gpt-4.1-mini");
    expect(provider.calls[0]!.messages[0]!.content).not.toContain("mentored");
    const embeds = await t.db.select().from(careerPointEmbeddings).where(eq(careerPointEmbeddings.userId, userId));
    expect(embeds).toHaveLength(2);
  });

  it("still records the fact, in the user's words, when the model output is invalid", async () => {
    script({ fact: () => "not json" });
    const userId = await newUser();
    const { points: [p], source } = await addFact(t.db, userId, "Reduced build times by 45% using Docker and GitHub Actions. Also led the hackathon.");
    expect(source).toBe("heuristic");
    expect(p).toMatchObject({ kind: "achievement", title: "Reduced build times by 45% using Docker and GitHub Actions", sourceQuote: expect.stringContaining("hackathon") });
    expect(p!.skills).toEqual(expect.arrayContaining(["Docker", "CI/CD"]));
    expect(metricsOf(p!)[0]).toMatchObject({ value: 45, unit: "%" });
    expect(pointSource(p!)).toBe("user");
  });

  it("rejects an empty fact", async () => {
    await expect(addFact(t.db, await newUser(), "   ")).rejects.toThrow(/empty/);
  });
});

/** A provider whose chat and/or embeddings fail the way a rejected API key does (a 401 from the vendor, not yet classified). */
function deadKey(which: { chat?: boolean; embed?: boolean } = { chat: true, embed: true }) {
  const fake = createFakeProvider();
  const err = () => Object.assign(new Error("401 Incorrect API key provided: sk-proj-SECRET"), { status: 401 });
  const provider = {
    name: "dead-key",
    chat: (req: Parameters<typeof fake.chat>[0]) => (which.chat ? Promise.reject(err()) : fake.chat(req)),
    embed: (req: Parameters<typeof fake.embed>[0]) => (which.embed ? Promise.reject(err()) : fake.embed(req)),
  };
  setProvider(provider);
  return provider;
}

describe("when the AI service is unavailable", () => {
  it("buildCareerPoints falls back to the heuristic parser, saves the points and leaves them unembedded", async () => {
    deadKey();
    const userId = await newUser();
    const r = await buildCareerPoints(t.db, userId, SAMPLE_RESUME);
    expect(r.source).toBe("heuristic");
    expect(r).toMatchObject({ embedded: false, aiUnavailable: true });
    expect(r.points.length).toBeGreaterThan(3);
    expect((await getGraph(t.db, userId)).points).toHaveLength(r.points.length);
    expect(await t.db.select().from(careerPointEmbeddings).where(eq(careerPointEmbeddings.userId, userId))).toHaveLength(0);

    // Later, with a working provider, embedCareerPoints picks them all up.
    setProvider(null);
    expect(await embedCareerPoints(t.db, userId)).toEqual({ embedded: r.points.length, skipped: 0 });
  });

  it("buildCareerPoints keeps the model's points when only embedding fails", async () => {
    const fake = createFakeProvider({ chat: () => goodModelOutput });
    const err = () => Object.assign(new Error("boom"), { status: 503 });
    setProvider({ name: "half", chat: (r) => fake.chat(r), embed: () => Promise.reject(err()) });
    const userId = await newUser();
    const r = await buildCareerPoints(t.db, userId, SAMPLE_RESUME);
    expect(r).toMatchObject({ source: "model", embedded: false, aiUnavailable: true });
    expect(r.points.length).toBeGreaterThan(0);
    expect(await t.db.select().from(careerPointEmbeddings).where(eq(careerPointEmbeddings.userId, userId))).toHaveLength(0);
  });

  it("accepts a provider that throws AiUnavailableError itself", async () => {
    const fake = createFakeProvider();
    setProvider({ name: "typed", chat: () => Promise.reject(new AiUnavailableError("network")), embed: (r) => fake.embed(r) });
    const r = await buildCareerPoints(t.db, await newUser(), SAMPLE_RESUME);
    // The failed chat call put the service in cooldown, so the embedding call is refused too: points saved, unembedded.
    expect(r).toMatchObject({ source: "heuristic", embedded: false, aiUnavailable: true });
  });

  it("still throws on a spent budget instead of falling back", async () => {
    const userId = await newUser();
    await recordUsage(t.db, userId, "gpt-4.1-mini", { promptTokens: 50, completionTokens: 0 });
    vi.stubEnv("AI_DAILY_TOKEN_BUDGET", "10");
    setProvider(createFakeProvider({ chat: () => goodModelOutput }));
    await expect(buildCareerPoints(t.db, userId, SAMPLE_RESUME)).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("addFact records the fact in the user's words, flagged heuristic, with no embedding", async () => {
    deadKey();
    const userId = await newUser();
    const r = await addFact(t.db, userId, "Reduced build times by 45% using Docker. Also led the hackathon.");
    expect(r).toMatchObject({ source: "heuristic", embedded: false, aiUnavailable: true });
    expect(r.points).toHaveLength(1);
    expect(r.points[0]).toMatchObject({ kind: "achievement", sourceQuote: expect.stringContaining("hackathon") });
    expect(pointSource(r.points[0]!)).toBe("user");
    expect(await t.db.select().from(careerPointEmbeddings).where(eq(careerPointEmbeddings.userId, userId))).toHaveLength(0);
  });

  it("embedCareerPoints itself still throws AiUnavailableError (callers decide), and the points stay for a retry", async () => {
    const userId = await newUser();
    const [p] = await t.db.insert(careerPoints).values({ userId, kind: "skill", title: "Rust", text: "Rust", skills: ["Rust"], scope: { source: "user" } }).returning();
    deadKey({ embed: true });
    await expect(embedCareerPoints(t.db, userId, [p!.id])).rejects.toBeInstanceOf(AiUnavailableError);
    setProvider(null);
    expect(await embedCareerPoints(t.db, userId)).toEqual({ embedded: 1, skipped: 0 });
  });
});

describe("embedCareerPoints", () => {
  it("skips unchanged points and re-embeds only the one whose content changed", async () => {
    const provider = createFakeProvider();
    const embedSpy = vi.spyOn(provider, "embed");
    setProvider(provider);
    const userId = await newUser();
    const rows = await t.db.insert(careerPoints).values([
      { userId, kind: "role", title: "Platform Engineer", org: "Acme", text: "Kubernetes platform", skills: ["Kubernetes"], scope: { source: "user" } },
      { userId, kind: "project", title: "Search", org: null, text: "Vector search", skills: ["pgvector"], scope: { source: "user" } },
      { userId, kind: "skill", title: "Languages", org: null, text: "Python", skills: ["Python"], scope: { source: "user" } },
    ]).returning();

    expect(await embedCareerPoints(t.db, userId)).toEqual({ embedded: 3, skipped: 0 });
    expect(embedSpy).toHaveBeenCalledTimes(1);
    expect(embedSpy.mock.calls[0]![0].texts).toHaveLength(3);

    expect(await embedCareerPoints(t.db, userId)).toEqual({ embedded: 0, skipped: 3 });
    expect(embedSpy).toHaveBeenCalledTimes(1);

    await t.db.update(careerPoints).set({ text: "Kubernetes platform and Terraform" }).where(eq(careerPoints.id, rows[0]!.id));
    expect(await embedCareerPoints(t.db, userId)).toEqual({ embedded: 1, skipped: 2 });
    expect(embedSpy).toHaveBeenCalledTimes(2);
    expect(embedSpy.mock.calls[1]![0].texts).toEqual(["Platform Engineer\nAcme\nKubernetes platform and Terraform\nKubernetes"]);

    // Restricting to ids leaves other points alone; a model change re-embeds.
    expect(await embedCareerPoints(t.db, userId, [rows[1]!.id])).toEqual({ embedded: 0, skipped: 1 });
    expect(await embedCareerPoints(t.db, userId, [])).toEqual({ embedded: 0, skipped: 0 });
    vi.stubEnv("EMBEDDING_MODEL", "other-embedding-model");
    expect(await embedCareerPoints(t.db, userId)).toEqual({ embedded: 3, skipped: 0 });
    const [stored] = await t.db.select().from(careerPointEmbeddings).where(and(eq(careerPointEmbeddings.careerPointId, rows[1]!.id)));
    expect(cosine(stored!.embedding, fakeEmbedding("Search\nVector search\npgvector"))).toBeCloseTo(1, 5);
    expect(stored!.model).toBe("other-embedding-model");
    expect(stored!.contentHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("reads the old forms: a scope.source user marker, and a model#hash embedding tag", async () => {
    const userId = await newUser();
    const [p] = await t.db.insert(careerPoints).values({ userId, kind: "skill", title: "Rust", text: "Rust", skills: ["Rust"], scope: { source: "user" } }).returning();
    expect(pointSource({ source: p!.source, scope: p!.scope, sourceQuote: p!.sourceQuote })).toBe("user");
    await embedCareerPoints(t.db, userId);
    // An embedding row in the old form (no content hash, tag in model) still counts as fresh.
    await t.db.update(careerPointEmbeddings).set({ model: embeddingTag(p!), contentHash: null }).where(eq(careerPointEmbeddings.careerPointId, p!.id));
    expect(await embedCareerPoints(t.db, userId)).toEqual({ embedded: 0, skipped: 1 });
  });

  it("does not embed another user's points", async () => {
    const a = await newUser();
    const b = await newUser();
    const [p] = await t.db.insert(careerPoints).values({ userId: a, kind: "skill", title: "Go", text: "Go", skills: ["Go"], scope: { source: "user" } }).returning();
    expect(await embedCareerPoints(t.db, b, [p!.id])).toEqual({ embedded: 0, skipped: 0 });
  });
});

describe("profileEmbedding", () => {
  const NOW = new Date("2026-06-15T00:00:00Z");
  async function seed(userId: string, rows: Partial<typeof careerPoints.$inferInsert>[]) {
    await t.db.insert(careerPoints).values(rows.map((r) => ({ userId, kind: "role" as const, title: "x", text: "", skills: [], scope: { source: "user" }, ...r })));
    await embedCareerPoints(t.db, userId);
  }

  it("is null when the user has no embedded points", async () => {
    expect(await profileEmbedding(t.db, await newUser(), NOW)).toBeNull();
  });

  it("is a unit vector of the points' embeddings", async () => {
    const userId = await newUser();
    await seed(userId, [{ title: "Platform Engineer", text: "kubernetes terraform platform", startDate: "2022-01", endDate: null }]);
    const v = (await profileEmbedding(t.db, userId, NOW))!;
    expect(v).toHaveLength(1536);
    expect(Math.hypot(...v)).toBeCloseTo(1, 6);
    expect(cosine(v, fakeEmbedding("Platform Engineer\nkubernetes terraform platform"))).toBeCloseTo(1, 4);
  });

  it("leans toward recent work over old work", async () => {
    const userId = await newUser();
    await seed(userId, [
      { title: "Platform Engineer", text: "kubernetes terraform platform reliability", startDate: "2024-01", endDate: null },
      { title: "Mainframe Programmer", text: "cobol fortran mainframe batch", startDate: "2005-01", endDate: "2008-12" },
    ]);
    const v = (await profileEmbedding(t.db, userId, NOW))!;
    const recent = cosine(v, fakeEmbedding("Platform Engineer\nkubernetes terraform platform reliability"));
    const old = cosine(v, fakeEmbedding("Mainframe Programmer\ncobol fortran mainframe batch"));
    expect(recent).toBeGreaterThan(old * 3);
  });

  it("leans toward substantial, wide-scope points over thin ones from the same period", async () => {
    const userId = await newUser();
    const long = "Designed and ran the payments ledger: reconciliation, settlement and ledgers for card volume across regions, owning the roadmap, on-call and audits for the whole platform. ".repeat(2);
    await seed(userId, [
      { title: "Payments Lead", text: long, startDate: "2023-01", endDate: null, scope: { source: "user", teamSize: 9, users: 1_000_000, ownership: "lead" }, metrics: { items: [{ value: 3, unit: "x", measures: "throughput" }] } },
      { title: "Intern", text: "photography club", startDate: "2023-01", endDate: null },
    ]);
    const v = (await profileEmbedding(t.db, userId, NOW))!;
    const big = cosine(v, fakeEmbedding(`Payments Lead\n${long}`));
    const thin = cosine(v, fakeEmbedding("Intern\nphotography club"));
    expect(big).toBeGreaterThan(thin * 3);
  });

  it("counts only the heaviest points, so a long tail of old ones does not dilute the profile", async () => {
    const userId = await newUser();
    await seed(userId, [
      { title: "Current", text: "rust compilers tooling developer experience", startDate: "2024-01", endDate: null },
      ...Array.from({ length: 20 }, (_, i) => ({ title: `Old${i}`, text: `legacy${i} widget${i}`, startDate: "2001-01", endDate: "2002-01" })),
    ]);
    const v = (await profileEmbedding(t.db, userId, NOW))!;
    expect(cosine(v, fakeEmbedding("Current\nrust compilers tooling developer experience"))).toBeGreaterThan(0.5);
  });
});

describe("getGraph, deleteCareerPoint", () => {
  it("returns points newest first with a skills summary", async () => {
    script({ resume: () => goodModelOutput });
    const userId = await newUser();
    await buildCareerPoints(t.db, userId, SAMPLE_RESUME);
    const g = await getGraph(t.db, userId, new Date("2026-01-15T00:00:00Z"));
    expect(g.points[0]!.endDate).toBeNull();
    const k8s = g.skills.find((s) => s.skill === "Kubernetes")!;
    expect(k8s).toMatchObject({ lastUsed: "2026-01", current: true, parents: ["Container Orchestration", "DevOps"] });
    expect(k8s.years).toBe(5.1); // Jan 2021 to Jan 2026 inclusive: 61 months
    expect(k8s.points.length).toBeGreaterThanOrEqual(2); // role, achievement and the skills list
    expect(g.skills.find((s) => s.skill === "Docker")).toMatchObject({ years: 0, lastUsed: null, current: false });
  });

  it("counts overlapping periods once", () => {
    const base = { kind: "role" as const, title: "t", org: null, text: "", scope: {}, metrics: {}, sourceQuote: null };
    const s = summarizeSkills([
      { ...base, id: "a", startDate: "2020-01", endDate: "2021-12", skills: ["Go"] },
      { ...base, id: "b", startDate: "2021-01", endDate: "2022-12", skills: ["Go", "Rust"] },
      { ...base, id: "c", startDate: "2015-01", endDate: "2015-12", skills: ["Go"] },
    ], new Date("2026-01-01T00:00:00Z"));
    expect(s.find((x) => x.skill === "Go")).toMatchObject({ years: 4, lastUsed: "2022-12", current: false, points: ["a", "b", "c"] });
    expect(s.find((x) => x.skill === "Rust")).toMatchObject({ years: 2 });
    expect(s[0]!.skill).toBe("Go");
  });

  it("deletes one of the user's points with its embedding, and nobody else's", async () => {
    script({ resume: () => goodModelOutput });
    const a = await newUser();
    const b = await newUser();
    await buildCareerPoints(t.db, a, SAMPLE_RESUME);
    const { points } = await getGraph(t.db, a);
    const target = points[0]!;
    expect(await deleteCareerPoint(t.db, b, target.id)).toBe(false);
    expect(await deleteCareerPoint(t.db, a, "not-a-uuid")).toBe(false);
    expect(await deleteCareerPoint(t.db, a, target.id)).toBe(true);
    expect(await deleteCareerPoint(t.db, a, target.id)).toBe(false);
    expect((await getGraph(t.db, a)).points).toHaveLength(points.length - 1);
    const left = await t.db.select().from(careerPointEmbeddings).where(eq(careerPointEmbeddings.careerPointId, target.id));
    expect(left).toHaveLength(0);
  });
});
