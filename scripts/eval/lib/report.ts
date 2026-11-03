/** Markdown report from the eval results object (also what baseline.json holds). */
import { REASON_CODES, type ReasonCode } from "./metrics.js";

type Shares = Record<ReasonCode, number>;
type Step = { count: number; meanScore: number | null };
type ProfileMetricsView = {
  size: number; p10: number; p20: number; p10Dedup: number; p20Dedup: number; meanScore: number | null; ndcg20: number | null; duplicates: number;
  reasonShares: Shares; failureShares: Shares;
  widened: { count: number; meanScore: number | null; hitRate: number | null; byStep: Record<string, Step> };
  lane: { count: number; meanScore: number | null; hitRate: number | null };
};
type ItemView = {
  rank: number; title: string; company: string | null; location: string | null; applyUrl: string; fit: number; widenedBy: string | null;
  score: number; reason: ReasonCode; sentence: string; duplicate: boolean;
};
export type EvalResults = {
  generatedAt: string;
  config: { db: string; cap: number; top: number; judgeModel: string; smallModel: string; embeddingModel: string; now: string; judgeVersion: string };
  overall: {
    profiles: number; shortlistSizeMean: number | null; p10: number | null; p20: number | null; p10Dedup: number | null; p20Dedup: number | null; ndcg20: number | null;
    meanScoreMacro: number | null; meanScorePooled: number | null; judged: number; reasonShares: Shares; failureShares: Shares;
    widened: { count: number; meanScore: number | null; hitRate: number | null }; lane: { count: number; meanScore: number | null; hitRate: number | null }; duplicates: number;
  };
  profiles: Array<{
    id: string; label: string; seniority: string; workAuth: string;
    resume: { points: number; source: string };
    index: {
      laneFiltered: number; laneFilteredWithText: number; selected: number; understood: number; embedded: number; selectedUnderstood: number; selectedEmbedded: number;
      descriptionReads: Record<string, number>; understandFailed: number; fellBackToHeuristic: number;
    };
    shortlist: {
      ms: number; considered: number; withoutSpec: number; lexical: number; scored: number; gated: number; gatedReasons: Record<string, number>; belowMinFit: number;
      laneMatches: number; widenedCount: number; widenedByStep: Record<string, number>; poolUsed: boolean; temporaryLane: boolean;
    };
    metrics: ProfileMetricsView;
    usd: Record<string, number>;
    items: ItemView[];
  }>;
  spend: { totalUsd: number; capUsd: number; byPhaseModel: Array<{ phase: string; model: string; calls: number; promptTokens: number; cachedTokens: number; completionTokens: number; usd: number }> };
};

const f2 = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : n.toFixed(2));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : `${Math.round(n * 100)}%`);
const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 2)}`;
const esc = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

function topReasons(shares: Shares, n: number): string {
  return REASON_CODES.filter((r) => r !== "good_fit" && shares[r] > 0).sort((a, b) => shares[b] - shares[a]).slice(0, n).map((r) => `${r} ${pct(shares[r])}`).join(", ") || "none";
}

export function renderReport(r: EvalResults): string {
  const o = r.overall;
  const L: string[] = [];
  L.push("# Matching quality baseline", "");
  L.push(`Generated ${r.generatedAt.slice(0, 16).replace("T", " ")} UTC. ${o.profiles} fictional profiles, top ${r.config.top} of each shortlist judged by ${r.config.judgeModel} (rubric ${r.config.judgeVersion}).`);
  L.push(`Jobs: a copy of the live collection (\`${r.config.db}\`), as of ${r.config.now.slice(0, 10)}. Per user the newest ${r.config.cap} lane-fitting jobs were understood with ${r.config.smallModel} (embeddings: ${r.config.embeddingModel}). Reproduce with \`npx tsx scripts/eval/run.mts\`.`, "");

  L.push("## Overall", "");
  L.push("| Metric | Value |", "|---|---|");
  L.push(`| P@10 (judge score >= 4, averaged over profiles) | ${f2(o.p10)} |`);
  L.push(`| P@20 | ${f2(o.p20)} |`);
  L.push(`| P@10 / P@20 if duplicate listings count as misses | ${f2(o.p10Dedup)} / ${f2(o.p20Dedup)} |`);
  L.push(`| nDCG@20 (gain = score - 1, ideal = same items re-sorted) | ${f2(o.ndcg20)} |`);
  L.push(`| Mean judge score (per profile average / all ${o.judged} jobs) | ${f2(o.meanScoreMacro)} / ${f2(o.meanScorePooled)} |`);
  L.push(`| Mean shortlist size | ${f2(o.shortlistSizeMean)} |`);
  L.push(`| Duplicates (same company and title as a higher row) | ${o.duplicates} of ${o.judged} |`);
  L.push(`| Lane matches: count, mean score, hit rate | ${o.lane.count}, ${f2(o.lane.meanScore)}, ${pct(o.lane.hitRate)} |`);
  L.push(`| Widened rows: count, mean score, hit rate | ${o.widened.count}, ${f2(o.widened.meanScore)}, ${pct(o.widened.hitRate)} |`);
  L.push(`| OpenAI spend for the whole eval (cap ${usd(r.spend.capUsd)}) | ${usd(r.spend.totalUsd)} |`, "");

  L.push("## Per profile", "");
  L.push("| Profile | Lane-fit jobs | Understood | Embedded | Size | P@10 | P@20 | nDCG@20 | Mean | Widened (n, mean) | Build ms | Spend |", "|---|--:|--:|--:|--:|--:|--:|--:|--:|--|--:|--:|");
  for (const p of r.profiles) {
    const m = p.metrics;
    L.push(`| ${esc(p.label)} | ${p.index.laneFiltered} | ${p.index.understood} | ${p.index.embedded} | ${m.size} | ${f2(m.p10)} | ${f2(m.p20)} | ${f2(m.ndcg20)} | ${f2(m.meanScore)} | ${m.widened.count} (${f2(m.widened.meanScore)}) | ${p.shortlist.ms} | ${usd(p.usd.total ?? 0)} |`);
  }
  L.push("", "Lane-fit jobs = open, posted within 60 days, fit a lane by title and place. Understood and Embedded count those with a spec and an embedding after the run, so a gap between them is an index gap; a low P@10 with both full is a ranking problem.", "");

  L.push("## Index coverage per profile", "");
  L.push("| Profile | Lane-fit | With text | Selected (newest) | Selected understood | Selected embedded | Description reads (filled / gone / failed) | Understand failures |", "|---|--:|--:|--:|--:|--:|--|--:|");
  for (const p of r.profiles) {
    const d = p.index.descriptionReads;
    L.push(`| ${esc(p.label)} | ${p.index.laneFiltered} | ${p.index.laneFilteredWithText} | ${p.index.selected} | ${p.index.selectedUnderstood} | ${p.index.selectedEmbedded} | ${d.filled ?? 0} / ${d.gone ?? 0} / ${(d.error ?? 0) + (d.unsupported ?? 0)} | ${p.index.understandFailed} |`);
  }
  L.push("");

  L.push("## Where the shortlist came from", "");
  L.push("| Profile | Considered | Without spec | Gated out | Below min fit | Lane matches | Widened by step | Pool used |", "|---|--:|--:|--:|--:|--:|--|--|");
  for (const p of r.profiles) {
    const s = p.shortlist;
    const steps = Object.entries(s.widenedByStep).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
    L.push(`| ${esc(p.label)} | ${s.considered} | ${s.withoutSpec} | ${s.gated} | ${s.belowMinFit} | ${s.laneMatches} | ${steps} | ${s.poolUsed ? "yes" : "no"} |`);
  }
  L.push("");

  L.push("## Why rows missed", "");
  L.push("Share of every judged row by the judge's main reason (duplicates are reassigned to `duplicate`).", "");
  L.push(`| Reason | All profiles | ${r.profiles.map((p) => esc(p.id)).join(" | ")} |`, `|---|--:|${r.profiles.map(() => "--:").join("|")}|`);
  for (const code of REASON_CODES) {
    L.push(`| ${code} | ${pct(o.reasonShares[code])} | ${r.profiles.map((p) => pct(p.metrics.reasonShares[code])).join(" | ")} |`);
  }
  L.push("", `Misses only (score below 4 or duplicate): ${topReasons(o.failureShares, 5)}.`, "");

  L.push("## Widening", "");
  L.push(`Widened rows: ${o.widened.count} of ${o.judged}; mean score ${f2(o.widened.meanScore)}, hit rate ${pct(o.widened.hitRate)} (lane matches: mean ${f2(o.lane.meanScore)}, hit rate ${pct(o.lane.hitRate)}).`, "");
  const stepRows = new Map<string, { n: number; sum: number }>();
  for (const p of r.profiles) for (const [k, v] of Object.entries(p.metrics.widened.byStep)) {
    const e = stepRows.get(k) ?? { n: 0, sum: 0 };
    e.n += v.count; e.sum += (v.meanScore ?? 0) * v.count; stepRows.set(k, e);
  }
  if (stepRows.size > 0) {
    L.push("| Step | Rows | Mean score |", "|---|--:|--:|");
    for (const [k, v] of stepRows) L.push(`| ${k} | ${v.n} | ${f2(v.sum / v.n)} |`);
    L.push("");
  }

  L.push("## Ten worst rows", "");
  const worst = r.profiles.flatMap((p) => p.items.map((i) => ({ p, i }))).sort((a, b) => a.i.score - b.i.score || a.i.rank - b.i.rank || a.p.id.localeCompare(b.p.id)).slice(0, 10);
  L.push("| # | Profile | Rank | Job | Score | Reason | Judge |", "|--:|---|--:|---|--:|---|---|");
  worst.forEach(({ p, i }, n) => {
    L.push(`| ${n + 1} | ${esc(p.id)} | ${i.rank}${i.widenedBy ? ` (widened: ${i.widenedBy})` : ""} | ${esc(i.title)} at ${esc(i.company ?? "?")} (${esc(i.location ?? "no location")}) | ${i.score} | ${i.reason} | ${esc(i.sentence)} |`);
  });
  L.push("");

  L.push("## Spend", "");
  L.push("| Phase | Model | Calls | Prompt tokens (cached) | Completion tokens | USD |", "|---|---|--:|--:|--:|--:|");
  for (const e of r.spend.byPhaseModel) L.push(`| ${e.phase} | ${e.model} | ${e.calls} | ${e.promptTokens} (${e.cachedTokens}) | ${e.completionTokens} | ${usd(e.usd)} |`);
  if (r.spend.byPhaseModel.some((e) => e.phase.startsWith("unrecorded"))) L.push("", "The `unrecorded` row is a deliberate over-estimate for calls made by an aborted attempt whose ledger writes were lost (three runs overlapped by mistake); real usage of that attempt was well below it.");
  L.push("", `Total ${usd(r.spend.totalUsd)} against a cap of ${usd(r.spend.capUsd)}. Prices come from the table in packages/ai/src/config.ts and must be checked against the vendor before the dollars are relied on.`, "");

  L.push("## Method notes", "");
  L.push("- Users, lanes, work authorisation and resumes are in `scripts/eval/profiles.json` and `scripts/eval/resumes/`; all people and employers in the resumes are fictional.");
  L.push("- The shortlist is `buildShortlist` with widening on, read back in the order the API serves it (lane matches first, then widened rows, each best fit first), top 20 rows. Rows are raw: the API additionally collapses the same company and title into one entry, which is why duplicates are reported on their own.");
  L.push("- The judge sees the resume, the profile (lanes, work authorisation, seniority) and the job title, company, location and the first 3,500 characters of the description; one call per (profile, job), cached in `scripts/eval/cache/judgments.json`.");
  L.push("- P@k divides by k even when fewer rows came back, so a short shortlist is penalised. nDCG@20 only ranks the rows that were returned; it does not see good jobs that were never retrieved.");
  L.push("- Reason codes describe the candidate against the job: `wrong_seniority_too_junior` means the candidate is too junior for the job, `wrong_seniority_too_senior` means the candidate is overqualified (the judge applied them this way consistently).");
  L.push("- A single LLM judge is not ground truth: expect a few points of noise and a bias towards keyword overlap. Treat differences of a few points between runs as noise.", "");
  return L.join("\n");
}
