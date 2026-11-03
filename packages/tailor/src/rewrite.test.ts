import { afterEach, describe, expect, it } from "vitest";
import { createFakeProvider, setProvider, type ChatRequest } from "@norinote/ai";
import type { CareerPoint, FitMapEntry, JobSpec } from "@norinote/shared";
import { pointCorpus } from "./evidence.js";
import { MAX_REWRITES, gateSummary, nextRound, optimise, pickRewrites, styleStats } from "./rewrite.js";
import { selectContent } from "./select.js";
import { SPEC } from "./test-fixtures.js";
import { buildVocab, gateBullet, supportOf } from "./validate.js";

afterEach(() => setProvider(null));

const NOW = new Date("2026-06-01");
const pt = (id: string, p: Partial<CareerPoint> & Pick<CareerPoint, "kind" | "title">): CareerPoint => ({
  id, org: null, startDate: null, endDate: null, text: "", skills: [], scope: {}, metrics: {}, sourceQuote: null, ...p,
});
const points: CareerPoint[] = [
  pt("acme", { kind: "role", title: "Backend Engineer", org: "Acme", startDate: "2021-03", skills: ["TypeScript", "PostgreSQL"],
    text: "Built REST APIs in TypeScript serving 2M requests per day\nMigrated the billing service to Postgres, cutting query time by 40%\nWrote onboarding docs for new engineers" }),
  pt("globex", { kind: "role", title: "Software Engineer", org: "Globex", startDate: "2018-01", endDate: "2020-12", text: "Built internal dashboards in React for the support team" }),
];
const spec: JobSpec = { ...SPEC, mustHaves: ["Build REST APIs in TypeScript", "PostgreSQL experience", "Experience with high-volume transaction systems"], niceToHaves: ["Kubernetes"], skills: [] };
const fitMap: FitMapEntry[] = [{ requirement: "Experience with high-volume transaction systems", mustHave: true, score: 0.6, careerPointIds: ["acme"] }];

function setup() {
  const selection = selectContent({ points, fitMap, spec, contact: { name: "Ada" }, now: NOW });
  const vocab = buildVocab({ userSkills: ["TypeScript", "PostgreSQL", "React"], specSkills: [], orgs: ["Acme", "Globex"], titles: ["Backend Engineer", "Software Engineer"] });
  const input = { selection, points, job: { title: "Backend Engineer", company: "Initech" }, vocab, corpus: supportOf(points.map(pointCorpus)), now: NOW };
  return { selection, input, content: selection.content };
}

const GOOD: Record<string, string> = {
  "acme#0": "Engineered REST APIs in TypeScript that served 2M requests per day for the billing and account services at Acme",
  "acme#1": "Migrated the billing service onto PostgreSQL and cut its query time by 40%, keeping billing records in one relational store",
  "acme#2": "Wrote onboarding docs for new engineers that cover their first week, the team's conventions and where to ask for help",
  "globex#0": "Delivered internal dashboards in React that gave the support team one place to follow customer tickets and requests",
};
const SUMMARY = "Backend Engineer with 8 years of experience building REST APIs in TypeScript and PostgreSQL services for billing systems. Built REST APIs serving 2M requests per day and cut billing query time by 40%.";
type Req = { mode?: string; bullets: { id: string; sourceId: string; failures?: string[]; instructions?: string[] }[]; requirements?: { id: string; candidates: string[] }[] };
const body = (req: ChatRequest) => JSON.parse(req.messages.at(-1)!.content) as Req;
const reply = (bs: Req["bullets"], text: (id: string) => string, summary = "") => ({ summary, bullets: bs.map((b) => ({ id: b.id, sourceId: b.sourceId, text: text(b.id) })) });

function script(handlers: Partial<Record<"rewrite" | "retry" | "critique" | "revise", (r: Req) => unknown>>) {
  const provider = createFakeProvider({
    chat: (req) => {
      const purpose = req.jsonSchema!.name.replace("resume_", "") as keyof typeof handlers;
      const h = handlers[purpose];
      if (!h) throw new Error(`unexpected ${purpose} call`);
      return h(body(req));
    },
  });
  setProvider(provider);
  return provider;
}
const noGaps = () => ({ gaps: [], fixes: [] });

describe("optimise", () => {
  it("rewrites the top role's bullets in one large-model call, each citing its source, and keeps the summary", async () => {
    const { input, content } = setup();
    const p = script({ rewrite: (r) => reply(r.bullets, (id) => GOOD[id]!, SUMMARY), critique: noGaps });
    const r = await optimise(input, content);
    expect(p.calls[0]!.model).toBe("gpt-4.1");
    expect(p.calls[0]!.temperature).toBe(0.2);
    const acme = content.experience[0]!.bullets.map((b) => b.text);
    expect(acme).toContain(GOOD["acme#0"]);
    expect(acme).toContain(GOOD["acme#1"]);
    expect(r.summary.text).toBe(SUMMARY);
    const change = r.changes.find((c) => c.bulletId === "acme#0")!;
    expect(change).toMatchObject({ before: "Built REST APIs in TypeScript serving 2M requests per day", careerPointIds: ["acme"], attempts: 1, gate: { ok: true } });
    expect(r.bullets.every((b) => b.sourceIds.length > 0)).toBe(true);
    expect(r.calls.map((c) => c.purpose)).toEqual(["rewrite", "critique"]);
  });

  it("only sends the chosen bullets, their sources, and the requirements each source truly supports", async () => {
    const { input, content } = setup();
    let sent: Req | null = null;
    script({ rewrite: (r) => { sent = r; return reply(r.bullets, (id) => GOOD[id]!, SUMMARY); }, critique: noGaps });
    await optimise(input, content);
    const s = sent as unknown as { avoidTerms: string[]; bullets: { id: string; supports: string[]; useTerms: string[]; source: string }[] };
    expect(s.avoidTerms).toEqual(["Kubernetes"]);
    const b1 = s.bullets.find((b) => b.id === "acme#1")!;
    expect(b1.supports).toEqual(["PostgreSQL experience", "Experience with high-volume transaction systems"]);
    expect((b1 as unknown as { mirror: string[] }).mirror).toEqual(["high-volume transaction systems"]);
    expect(b1.useTerms).toEqual(["PostgreSQL"]);
    // A line's source is its own words plus the role header, not the other lines of the role.
    expect(b1.source).not.toContain("onboarding");
  });

  it("retries a failing bullet once with the reasons, then accepts the fix", async () => {
    const { input, content } = setup();
    let retried: Req | null = null;
    script({
      rewrite: (r) => reply(r.bullets, (id) => (id === "acme#1" ? "Moved the billing service onto PostgreSQL on Kubernetes and cut query time by 40% for every billing report we run" : GOOD[id]!), SUMMARY),
      retry: (r) => { retried = r; return reply(r.bullets, (id) => GOOD[id]!); },
      critique: noGaps,
    });
    const r = await optimise(input, content);
    const rr = retried as unknown as Req;
    expect(rr.mode).toBe("retry");
    expect(rr.bullets.map((b) => b.id)).toEqual(["acme#1"]);
    expect(rr.bullets[0]!.failures!.join(" ")).toMatch(/Kubernetes/);
    expect(content.experience[0]!.bullets.find((b) => b.id === "acme#1")!.text).toBe(GOOD["acme#1"]);
    expect(r.bullets.find((b) => b.bulletId === "acme#1")).toMatchObject({ rewritten: true, attempts: 2, reverted: false });
  });

  it("reverts a bullet that fails twice to the user's own words and reports why", async () => {
    const { input, content } = setup();
    const bad = "Moved the billing service onto PostgreSQL and cut query time by 75% for every billing report the finance team runs daily";
    script({ rewrite: (r) => reply(r.bullets, (id) => (id === "acme#1" ? bad : GOOD[id]!), SUMMARY), retry: (r) => reply(r.bullets, () => bad), critique: noGaps });
    const r = await optimise(input, content);
    expect(content.experience[0]!.bullets.find((b) => b.id === "acme#1")!.text).toBe("Migrated the billing service to Postgres, cutting query time by 40%");
    expect(r.bullets.find((b) => b.bulletId === "acme#1")).toMatchObject({ rewritten: false, reverted: true, attempts: 2 });
    expect(r.rejected.find((x) => x.bulletId === "acme#1")!.reason).toMatch(/75/);
    expect(r.changes.some((c) => c.bulletId === "acme#1")).toBe(false);
  });

  it("critique finds a supported gap, the revision shows it, then the loop stops", async () => {
    const { input, content } = setup();
    let revised: Req | null = null;
    const p = script({
      rewrite: (r) => reply(r.bullets, (id) => GOOD[id]!, SUMMARY),
      critique: (r) => ({ gaps: [{ requirementId: r.requirements![0]!.id, bulletId: "acme#0" }, { requirementId: "r99", bulletId: "acme#0" }], fixes: [{ bulletId: "globex#9", problem: "x" }] }),
      revise: (r) => { revised = r; return reply(r.bullets, () => "Engineered REST APIs in TypeScript for high-volume transaction systems, serving 2M requests per day for billing at Acme"); },
    });
    const r = await optimise(input, content);
    const rv = revised as unknown as Req;
    expect(rv.bullets.map((b) => b.id)).toEqual(["acme#0"]);
    expect(rv.bullets[0]!.instructions!.join(" ")).toMatch(/exact phrase "high-volume transaction systems"/);
    // Round coverage is the sum of the alias-aware and verbatim key-phrase scores: both 100 after the revision.
    expect(r.rounds).toEqual([{ round: 1, gaps: 1, fixes: 0, accepted: 1, coverage: 200, stop: null }]);
    expect(r.stopReason).toMatch(/no open gaps/);
    expect(p.calls.map((c) => c.jsonSchema!.name)).toEqual(["resume_rewrite", "resume_critique", "resume_revise"]);
    expect(p.calls[1]!.model).toBe("gpt-4.1-mini");
  });

  it("stops after the critique when it returns nothing it is allowed to return", async () => {
    const { input, content } = setup();
    script({ rewrite: (r) => reply(r.bullets, (id) => GOOD[id]!, SUMMARY), critique: () => ({ gaps: [{ requirementId: "nope", bulletId: "acme#0" }], fixes: [] }) });
    const r = await optimise(input, content);
    expect(r.stopReason).toBe("critique found nothing to change");
    expect(r.rounds[0]).toMatchObject({ round: 1, accepted: 0, stop: "critique found nothing to change" });
  });

  it("reverts a rewrite the critique calls unfaithful when the revision cannot fix it", async () => {
    const { input, content } = setup();
    script({
      rewrite: (r) => reply(r.bullets, (id) => GOOD[id]!, SUMMARY),
      critique: () => ({ gaps: [], fixes: [{ bulletId: "acme#2", problem: "The source does not mention REST APIs or local setup." }] }),
      revise: (r) => reply(r.bullets, () => "Write"),
    });
    const r = await optimise(input, content);
    expect(content.experience[0]!.bullets.find((b) => b.id === "acme#2")?.text ?? "Wrote onboarding docs for new engineers").toBe("Wrote onboarding docs for new engineers");
    expect(r.changes.some((c) => c.bulletId === "acme#2")).toBe(false);
  });

  it("without the AI service: no rewrites, the selection stands, and the report says why", async () => {
    const { input, content } = setup();
    const before = JSON.stringify(content);
    setProvider(createFakeProvider({ chat: () => { throw Object.assign(new Error("upstream down"), { status: 503 }); } }));
    const r = await optimise(input, content);
    expect(r.aiUnavailable).toBe(true);
    expect(r.changes).toEqual([]);
    expect(r.summary.text).toBeNull();
    expect(JSON.stringify(content)).toBe(before);
    expect(r.stopReason).toBe("model unavailable");
  });
});

describe("nextRound", () => {
  it("stops at round two", () => {
    expect(nextRound({ round: 2, coverage: [50, 75], openGaps: 3, gateFailures: 1 })).toEqual({ go: false, reason: "round limit (2)" });
  });
  it("stops when nothing is open: no gaps, no gate failures, nothing unreviewed", () => {
    expect(nextRound({ round: 0, coverage: [80], openGaps: 0, gateFailures: 0, unreviewed: 0 }).go).toBe(false);
    expect(nextRound({ round: 0, coverage: [80], openGaps: 0, gateFailures: 0, unreviewed: 3 }).go).toBe(true);
    expect(nextRound({ round: 1, coverage: [80, 90], openGaps: 0, gateFailures: 1 }).go).toBe(true);
  });
  it("stops when coverage stops improving", () => {
    expect(nextRound({ round: 1, coverage: [60, 60], openGaps: 2, gateFailures: 0 })).toEqual({ go: false, reason: "coverage stopped improving" });
    expect(nextRound({ round: 1, coverage: [60, 80], openGaps: 2, gateFailures: 0 }).go).toBe(true);
  });
  it("stops when the critique has nothing allowed to say", () => {
    expect(nextRound({ round: 0, coverage: [60], openGaps: 2, gateFailures: 0, critiqueItems: 0 })).toEqual({ go: false, reason: "critique found nothing to change" });
  });
});

describe("helpers", () => {
  it("pickRewrites offers every shown bullet of the top role first, then the heaviest others, in display order", () => {
    const { content } = setup();
    const ids = pickRewrites(content).map((b) => b.id);
    expect(ids.slice(0, 3)).toEqual(["acme#0", "acme#1", "acme#2"]);
    expect(ids.length).toBeLessThanOrEqual(MAX_REWRITES);
    expect(pickRewrites(content, 2).map((b) => b.id)).toEqual(["acme#0", "acme#1"]);
  });

  it("gateSummary rejects banned phrases, an untrue title and invented years", () => {
    const { input } = setup();
    const g = (s: string) => gateSummary(s, { corpus: input.corpus, vocab: input.vocab, years: 5, jobTitle: "Staff Data Scientist", personTitles: ["Backend Engineer"] }).failures.map((f) => f.rule);
    expect(g(SUMMARY.replace("8 years", "5 years"))).toEqual([]);
    expect(g("Results-driven Backend Engineer building REST APIs in TypeScript on PostgreSQL for billing.")).toContain("banned_phrase");
    expect(g("Backend Engineer who leveraged REST APIs in TypeScript on PostgreSQL for billing teams.")).toEqual(["banned_phrase"]);
    expect(g("Data Scientist building REST APIs in TypeScript on PostgreSQL for billing teams.")).toContain("title");
    expect(g("Backend Engineer with 9 years building REST APIs in TypeScript on PostgreSQL.")).toEqual(["source"]);
    // A term the career points never mention fails, as it does in a bullet.
    expect(g("Backend Engineer building REST APIs in TypeScript and PostgreSQL with data analysis for billing.")).toEqual(["tool"]);
    expect(g("Backend Engineer specializing in REST APIs in TypeScript and PostgreSQL for billing teams.")).toEqual(["banned_phrase"]);
    // Years go with the role, never with a skill.
    expect(g("Backend Engineer with 5 years of experience in TypeScript and PostgreSQL, building REST APIs for billing.")).toEqual(["source"]);
    expect(g("Backend Engineer with 5 years of experience. Builds REST APIs in TypeScript and PostgreSQL for billing.")).toEqual([]);
    expect(g("Backend Engineer with 5 years of TypeScript, building REST APIs on PostgreSQL for billing teams.")).toEqual(["source"]);
    expect(g("Backend Engineer with 5 years of experience in billing roles, building REST APIs in TypeScript.")).toEqual(["source"]);
    expect(g("Backend Engineer with 5 years of experience building REST APIs in TypeScript on PostgreSQL.")).toEqual([]);
  });

  it("styleStats counts words, verb diversity and banned phrases", () => {
    const { content } = setup();
    const s = styleStats(content);
    expect(s.bullets).toBeGreaterThan(0);
    expect(s.verbDiversity).toBeGreaterThan(0);
    expect(s.banned).toBe(0);
  });
});

describe("no-op rewrites and summary shape", () => {
  it("keeps the original when the rewrite adds no supported term or phrase and fixes nothing", async () => {
    const pts: CareerPoint[] = [pt("r", { kind: "role", title: "Backend Engineer", org: "Acme", startDate: "2020-01",
      text: "Built REST APIs in TypeScript and PostgreSQL that serve 2M requests per day for the billing team at Acme\nWrote onboarding docs for new engineers joining the billing team and the platform group at Acme" })];
    const selection = selectContent({ points: pts, fitMap: [], spec, contact: { name: "Ada" }, now: NOW });
    const vocab = buildVocab({ userSkills: ["TypeScript", "PostgreSQL"], specSkills: [], orgs: ["Acme"], titles: ["Backend Engineer"] });
    const input = { selection, points: pts, job: { title: "Backend Engineer", company: "Initech" }, vocab, corpus: supportOf(pts.map(pointCorpus)), now: NOW };
    script({
      rewrite: (r) => reply(r.bullets, (id) => (id === "r#0" ? "Built REST APIs with TypeScript and PostgreSQL that served 2M requests per day for the billing team at Acme" : "Produced onboarding docs for new engineers who joined the billing team and the platform group at Acme"), SUMMARY),
      critique: noGaps,
    });
    const r = await optimise(input, selection.content);
    // The latest role's first bullet is always rewritten; the other one added nothing, so the original stays ("kept").
    expect(r.changes.filter((c) => c.kind === "bullet").map((c) => c.bulletId)).toEqual(["r#0"]);
    expect(r.bullets.find((b) => b.bulletId === "r#1")).toMatchObject({ kept: true, reverted: false });
  });

  it("rejects a summary that opens with a raw title, has the wrong shape, or names no skills", () => {
    const { input } = setup();
    const shape = { supportedTerms: ["REST APIs", "TypeScript", "PostgreSQL"], strengthHasNumber: true };
    const g = (s: string) => gateSummary(s, { corpus: input.corpus, vocab: input.vocab, years: 8, jobTitle: "Backend Engineer", personTitles: ["Backend Engineer"], shape }).failures.map((f) => f.rule);
    expect(g(SUMMARY)).toEqual([]);
    expect(g("Teaching Assistant, Data Structures (CS 112), working with REST APIs, TypeScript and PostgreSQL.")).toEqual(expect.arrayContaining(["length", "title"]));
    expect(g("Backend engineer in the backend engineer field, building REST APIs in TypeScript and PostgreSQL services for billing. Built REST APIs serving 2M requests per day and cut query time by 40%.")).toContain("title");
    expect(g("Backend Engineer with 8 years of experience on billing systems for payments and invoices. Built services serving 2M requests per day and cut billing query time by 40% for reports.")).toContain("source");
  });
});

describe("unchanged returns", () => {
  it("does not accept an unchanged bullet that still needs a fix, and tells the retry what to fix", async () => {
    const pts: CareerPoint[] = [pt("r", { kind: "role", title: "Backend Engineer", org: "Acme", startDate: "2020-01",
      text: "Own the TypeScript billing service and its PostgreSQL schema, serving 2M requests per day for the finance team at Acme" })];
    const selection = selectContent({ points: pts, fitMap: [], spec, contact: { name: "Ada" }, now: NOW });
    const vocab = buildVocab({ userSkills: ["TypeScript", "PostgreSQL"], specSkills: [], orgs: ["Acme"], titles: ["Backend Engineer"] });
    const input = { selection, points: pts, job: { title: "Backend Engineer", company: "Initech" }, vocab, corpus: supportOf(pts.map(pointCorpus)), now: NOW };
    let retried: Req | null = null;
    script({
      rewrite: (r) => reply(r.bullets, () => "Own the TypeScript billing service and its PostgreSQL schema, serving 2M requests per day for the finance team at Acme", SUMMARY),
      retry: (r) => { retried = r; return reply(r.bullets, () => "Owned the TypeScript billing service and its PostgreSQL schema, serving 2M requests per day for the finance team at Acme"); },
      critique: noGaps,
    });
    const r = await optimise(input, selection.content);
    expect((retried as unknown as Req).bullets[0]!.failures!.join(" ")).toMatch(/past tense/);
    expect(selection.content.experience[0]!.bullets[0]!.text).toMatch(/^Owned the TypeScript billing service/);
    expect(r.bullets[0]).toMatchObject({ rewritten: true, kept: false, attempts: 2 });
  });
});

describe("round 4 rewrite rules", () => {
  it("rejects a rewrite that repeats a fact another bullet shows", () => {
    const original = "Precepted new graduate nurses on the cardiac telemetry unit during night shifts and weekends";
    const v = buildVocab({ userSkills: [], specSkills: [], orgs: [], titles: [] });
    const g = gateBullet("Precepted new graduate nurses on the telemetry unit and led a project that reduced falls by 28% with hourly rounding",
      { source: supportOf([original, "led a unit project that reduced falls by 28%"]), original, vocab: v, otherBullets: ["Led a unit project that reduced patient falls by 28%"] });
    expect(g.failures.map((f) => f.rule)).toContain("duplicate_fact");
  });

  it("tells the model the lead bullet and missing must-have phrases need work", async () => {
    const { input, content } = setup();
    let sent: Req | null = null;
    script({ rewrite: (r) => { sent = r; return reply(r.bullets, (id) => GOOD[id]!, SUMMARY); }, critique: noGaps });
    await optimise(input, content);
    const bullets = (sent as unknown as { bullets: { id: string; fix: string[] }[] }).bullets;
    expect(bullets[0]!.fix.join(" ")).toMatch(/lead bullet of the latest role/);
    expect(bullets.some((b) => b.fix.join(" ").includes("high-volume transaction systems"))).toBe(true);
  });
});
