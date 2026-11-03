import { z } from "zod";
import { AiUnavailableError, complete } from "@norinote/ai";
import type { Db } from "@norinote/db";
import type { CareerPoint } from "@norinote/shared";
import { bulletSupports, coverageScore, requirementShown, resumeText, type EvidenceEntry } from "./evidence.js";
import { bannedIn, bannedPhraseExamples, openingWord } from "./phrases.js";
import { SOFT_BEHAVIOURS } from "./key-phrases.js";
import { roleYears, type Selection } from "./select.js";
import { countTerm, findTerms, mentionsSkill, wordCount } from "./text.js";
import type { ResumeBullet, ResumeChange, ResumeContent } from "./types.js";
import {
  MAX_TERM_USES, gateBullet, supportOf, untruthfulTitle, validateSummary, type GateFailure, type GateResult, type Support, type Vocab,
} from "./validate.js";

/**
 * The model steps of tailoring, each followed by the deterministic gate:
 * 1. One large-model call (low temperature, JSON) rewrites the chosen bullets, each citing its source point, and writes
 *    the summary. Input is only the chosen bullets, their sources, and the requirements each source truly supports.
 * 2. The gate checks every bullet; failures are retried once in one small-model call with the reasons (a narrow fix,
 *    and it keeps a resume near a cent). Failing twice reverts the bullet to the user's own words.
 * 3. Critique and revise, at most two rounds: a small-model reviewer may only point out a supported requirement that is
 *    not shown yet (and a bullet whose source supports it) or a rewrite that is unfaithful to its source. Revisions go
 *    through the same gate. Stops when nothing is open, when coverage stops improving, or after round two.
 * Any model failure leaves the resume as the deterministic selection built it.
 */

/**
 * Bullets the model may rewrite per resume: every shown bullet of the top role (up to five) plus the best of the rest.
 * Raised from 5 to 6: the one large call for 6 bullets costs about 0.6 cents (docs/eval/tailor-run1.md), and retries and
 * revisions run on the small model, so a resume stays near a cent.
 */
export const MAX_REWRITES = 6;
export const MAX_REVISE_ROUNDS = 2;
/** At most this many bullets are revised in one critique round. */
export const MAX_REVISIONS_PER_ROUND = 3;
export const REWRITE_TEMPERATURE = 0.2;
const MAX_SOURCE_CHARS = 700;

const BulletOut = z.object({ id: z.string(), sourceId: z.string(), text: z.string() });
export const RewriteOutput = z.object({ summary: z.string(), bullets: z.array(BulletOut) });
export const CritiqueOutput = z.object({
  gaps: z.array(z.object({ requirementId: z.string(), bulletId: z.string() })),
  fixes: z.array(z.object({ bulletId: z.string(), problem: z.string() })),
});
type BulletOutT = z.infer<typeof BulletOut>;

export const REWRITE_SYSTEM = `You tailor resume bullets and a short summary to one job posting. You reword real experience; you never add facts.

Input: the target job title; useTerms, the posting's terms that the person really has (in the posting's spelling); avoidTerms, the posting's terms and phrases the person does NOT have; the bullets; and the facts for the summary. Each bullet has an id, a sourceId, its role, its text, its source (the only facts you may use for that bullet), the posting requirements the source truly supports, mirror (the posting's own key phrases for those requirements) and sometimes focus (the must-have this bullet must lead with).

Hard rules (a bullet that breaks one is thrown away):
- Use only facts in that bullet's source. Never add a skill, tool, employer, product, number, date, team size, scope or seniority the source does not state. Keep numbers exactly as written; when the source has no number, write none.
- Never mention an avoidTerms term, not even as "familiar with" or "exposure to".
- Do not raise ownership or scope: "helped", "supported" or "contributed" never become "led", "owned" or "drove"; "a team" never becomes "the company".
- No first person. Never use: ${bannedPhraseExamples().join(", ")}.

Style:
- Shape: strong action verb + what + how (tools named in the source) + result (only when the source states one).
- 18 to 28 words, one sentence.
- Past tense for every bullet, the current role included ("Built", "Led", "Reduced"); never "Build" or "Leads".
- Every bullet opens with a different verb; never reuse an opening verb from another bullet or from usedOpeningVerbs (bullets that stay as written).
- Mirror the posting. Where the source shows a requirement, carry the posting's own words for it verbatim: the exact term from useTerms (source "Postgres", posting "PostgreSQL": write "PostgreSQL") and each phrase in the bullet's mirror list, word for word ("end-to-end", "production services", "large, heterogeneous datasets"), never a near synonym ("full lifecycle", "live systems").
- When a bullet has a focus, open with that requirement in the posting's words; the bullets' focuses differ on purpose.
- Each key term at most 2 to 3 times across the whole resume; do not stuff keywords.
- Keep the source's specifics (system names, domains, numbers); do not generalise them away.

Summary: 2 to 3 sentences, at most 60 words. Open with the person's own title. Mention the target job title only if the person has held it, or in a targeted phrase ("for Data Scientist roles") without seniority words they lack. Years: if yearsOfExperience is a number, you may state exactly that number, only for the role ("Product Manager with 7 years of experience"); if it is null, state no years at all. Never attach years to a skill or tool ("7 years of SQL", "9 years of experience in HubSpot" are not allowed); name the top supported skills separately. No employer names, not the company being applied to, no other numbers.

Reply as JSON: {"summary": string, "bullets": [{"id": string, "sourceId": string, "text": string}]}. Return every bullet you were given with the same id and sourceId.
mode "retry": the bullets failed checks; fix exactly the listed failures. mode "revise": follow each bullet's instructions within the hard rules. In both modes write summary as "" unless the input has a summary to fix.`;

export const CRITIQUE_SYSTEM = `You review a tailored resume against a job's requirements and the person's real experience. You may return only two kinds of items, nothing else:
- gaps: a requirement from the list that is not shown yet and that one of its candidate bullets could show truthfully, because that bullet's source supports it. Give requirementId and one bulletId from that requirement's candidates.
- fixes: a rewritten bullet that states something its source does not support, or changes its meaning (a different result, more ownership, a tool or number the source lacks). Give bulletId and the problem in one short sentence.
Never suggest style, tone or length changes. Reply as JSON {"gaps": [...], "fixes": [...]}; both empty when there is nothing.`;

// ---------------------------------------------------------------------------------------------------------------------

export type CallRecord = { purpose: "rewrite" | "retry" | "critique" | "revise"; model: string; costMicros: number };
export type BulletReport = {
  bulletId: string;
  sourceIds: string[];
  rewritten: boolean;
  attempts: number;
  reverted: boolean;
  gate: GateResult;
};
export type RoundReport = { round: number; gaps: number; fixes: number; accepted: number; coverage: number | null; stop: string | null };
export type RejectedRewrite = { bulletId: string; text: string; reason: string };

export type OptimiseResult = {
  changes: ResumeChange[];
  rejected: RejectedRewrite[];
  bullets: BulletReport[];
  rounds: RoundReport[];
  stopReason: string;
  summary: { text: string | null; failures: GateFailure[] };
  calls: CallRecord[];
  model: string | null;
  error: string | null;
  aiUnavailable: boolean;
};

export type OptimiseInput = {
  selection: Selection;
  points: readonly CareerPoint[];
  job: { title: string; company: string };
  vocab: Vocab;
  /** Everything in the career points, for the summary check. */
  corpus: Support;
  userId?: string;
  db?: Db;
  now?: Date;
  maxRewrites?: number;
};

type Offer = {
  bullet: ResumeBullet;
  original: string;
  sourceId: string;
  source: string;
  roleLabel: string;
  roleYears: { start: number | null; end: number | null } | undefined;
  supports: string[];
  useTerms: string[];
  /** The posting's key phrases for the requirements this bullet's source truly supports. */
  mirror: string[];
  /** The must-have this bullet leads with (the latest role's first bullets each have a different one). */
  focus: string | null;
};

const allBullets = (c: ResumeContent): ResumeBullet[] => [...c.experience.flatMap((r) => r.bullets), ...c.projects.flatMap((p) => p.bullets)];

/** The bullets offered for rewriting: every shown bullet of the top role, then the heaviest of the rest. */
export function pickRewrites(content: ResumeContent, max = MAX_REWRITES): ResumeBullet[] {
  const sum = (bs: ResumeBullet[]) => bs.reduce((n, b) => n + b.weight, 0);
  let top = content.experience[0];
  for (const r of content.experience) if (top && sum(r.bullets) > sum(top.bullets)) top = r;
  const first = (top?.bullets ?? []).slice(0, max);
  const rest = allBullets(content).filter((b) => !first.includes(b) && b.weight > 0).sort((a, b) => b.weight - a.weight);
  const chosen = new Set([...first, ...rest].slice(0, max));
  return allBullets(content).filter((b) => chosen.has(b)); // display order
}

/**
 * Decide whether another critique round runs. Pure, so the stop rules are unit-tested. `gateFailures`: bullets that failed
 * the gate in the last step; `unreviewed`: rewrites the critic has not seen yet (round one reviews them for faithfulness).
 */
export function nextRound(s: {
  round: number; coverage: readonly number[]; openGaps: number; gateFailures: number; unreviewed?: number; critiqueItems?: number;
}): { go: boolean; reason: string } {
  if (s.round >= MAX_REVISE_ROUNDS) return { go: false, reason: `round limit (${MAX_REVISE_ROUNDS})` };
  if (s.openGaps === 0 && s.gateFailures === 0 && !s.unreviewed) return { go: false, reason: "no open gaps, no gate failures, nothing unreviewed" };
  const n = s.coverage.length;
  if (n >= 2 && s.coverage[n - 1]! <= s.coverage[n - 2]!) return { go: false, reason: "coverage stopped improving" };
  if (s.critiqueItems === 0) return { go: false, reason: "critique found nothing to change" };
  return { go: true, reason: "" };
}

/** "N years of experience in X" / "N years with X": the phrase after the years, to check for skills. */
const YEARS_ON_SKILLS = [
  /\b\d+\+?\s+years?(?:\s+of)?(?:\s+[a-z-]+)?\s+experience\s+(?:in|with|using|across)\s+([^.;]+)/i,
  /\b\d+\+?\s+years?\s+(?:of\s+(?!experience\b)|in\s+|with\s+|using\s+)([^.;]+)/i,
];

/** The checks a summary must pass: provenance, length, years, banned phrases, a truthful title, term overuse. */
export function gateSummary(summary: string, ctx: {
  corpus: Support; vocab: Vocab; years: number | null; jobTitle: string; personTitles: readonly string[];
  termUses?: { counts: ReadonlyMap<string, number>; terms: readonly { key: string; jobString: string }[] };
}): GateResult {
  const failures: GateFailure[] = [];
  const v = validateSummary(summary, ctx.corpus, ctx.vocab, { years: ctx.years });
  if (!v.ok) failures.push({ rule: "source", detail: v.reason });
  const banned = bannedIn(summary);
  if (banned.length) failures.push({ rule: "banned_phrase", detail: `generic phrase(s): ${banned.join(", ")}` });
  // Every alias-table term (skills, tools, licences, domains) must be in the career points, as for bullets.
  const terms = findTerms(summary).filter((t) => !mentionsSkill(ctx.corpus.text, t.as) && !mentionsSkill(ctx.corpus.text, t.key));
  if (terms.length) failures.push({ rule: "tool", detail: `mentions ${terms.map((t) => t.as).join(", ")}, which the career points do not` });
  // Years belong to the role, not to a skill: "9 years of experience in SEO" claims more than the dates show.
  // Any "N years ... in/with/of X" fails, skill or domain alike ("4 years of experience in Finance roles").
  const attached = YEARS_ON_SKILLS.map((re) => re.exec(summary)).find((m) => m !== null);
  if (attached) {
    failures.push({ rule: "source", detail: `attaches the years to a skill or field ("${attached[0].trim()}"); write "<title> with N years of experience" and list skills separately` });
  }
  const claim = untruthfulTitle(summary, ctx.jobTitle, ctx.personTitles);
  if (claim) failures.push({ rule: "title", detail: `presents the person as "${claim}", a title they have not held` });
  if (ctx.termUses) {
    const uses = ctx.termUses;
    const over = uses.terms.filter((t) => countTerm(summary, t.jobString) + (uses.counts.get(t.key) ?? 0) > MAX_TERM_USES);
    if (over.length) failures.push({ rule: "overuse", detail: `${over.map((t) => t.jobString).join(", ")} would appear more than ${MAX_TERM_USES} times` });
  }
  return { ok: failures.length === 0, failures };
}

function termCounts(texts: readonly string[], terms: readonly { key: string; jobString: string }[]): Map<string, number> {
  const all = texts.join("\n");
  return new Map(terms.map((t) => [t.key, countTerm(all, t.jobString)]));
}

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function optimise(input: OptimiseInput, content: ResumeContent): Promise<OptimiseResult> {
  const { selection, job, vocab } = input;
  const evidence = selection.evidence;
  const now = input.now ?? new Date();
  const result: OptimiseResult = {
    changes: [], rejected: [], bullets: [], rounds: [], stopReason: "", summary: { text: null, failures: [] }, calls: [], model: null, error: null, aiUnavailable: false,
  };
  const terms = evidence.supportedJobTerms;
  // Terms the person lacks, and the key phrases of requirements nothing supports ("Higher Education vertical sales").
  const gapPhrases = evidence.gaps.filter((e) => !e.soft && e.keyPhrase && e.keyPhrase.split(/\s+/).length >= 2).map((e) => e.keyPhrase!);
  const lackedTerms = [...evidence.lackedJobTerms.flatMap((t) => [t.jobString, t.key]), ...gapPhrases];
  const lackedPatterns = evidence.gaps.filter((e) => e.soft).map((e) => SOFT_BEHAVIOURS.find((b) => b.key === e.soft)!.req);
  const personTitles = input.points.filter((p) => p.kind === "role").map((p) => p.title);

  const offerOf = (b: ResumeBullet): Offer => {
    const container = selection.containers.get(b.id);
    const source = (selection.sources.get(b.id) ?? b.text).slice(0, MAX_SOURCE_CHARS);
    const sup = bulletSupports(evidence, source, b.careerPointIds);
    const supports = sup.map((e) => e.text);
    return {
      bullet: b, original: b.text, sourceId: b.careerPointIds[0] ?? b.id, source,
      roleLabel: container ? [container.title, container.org, [container.startDate, container.endDate ?? (container.kind === "role" ? "present" : "")].filter(Boolean).join(" to ")].filter(Boolean).join(", ") : "",
      roleYears: container?.kind === "role" ? roleYears(container) : undefined,
      supports,
      useTerms: terms.filter((t) => mentionsSkill(source, t.jobString) || mentionsSkill(source, t.key)).map((t) => t.jobString),
      mirror: [...new Set(sup.filter((e) => e.mirror && e.keyPhrase).map((e) => e.keyPhrase!))],
      focus: selection.focus.get(b.id) ?? null,
    };
  };

  const offered = pickRewrites(content, input.maxRewrites ?? MAX_REWRITES).map(offerOf);
  const offerById = new Map(offered.map((o) => [o.bullet.id, o]));
  if (offered.length === 0 && evidence.entries.every((e) => !e.supported)) {
    result.stopReason = "nothing in the career points covers this job";
    result.error = "nothing in the career points covers this job's requirements";
    return result;
  }

  const summaryFacts = {
    personTitles: [...new Set(personTitles)].slice(0, 4),
    latestTitle: content.experience[0]?.title ?? null,
    yearsOfExperience: selection.years,
    topSkills: terms.map((t) => t.jobString).slice(0, 6),
    topRequirements: selection.topRequirements.slice(0, 4).map((r) => r.requirement),
  };
  const bulletPayload = (o: Offer, extra: Record<string, unknown> = {}) => ({
    id: o.bullet.id, sourceId: o.sourceId, role: o.roleLabel, text: o.original, source: o.source, supports: o.supports, useTerms: o.useTerms, mirror: o.mirror,
    ...(o.focus ? { focus: o.focus } : {}), ...extra,
  });
  const base = { job: { title: job.title }, useTerms: terms.map((t) => t.jobString), avoidTerms: [...evidence.lackedJobTerms.map((t) => t.jobString), ...gapPhrases] };

  const call = async <S extends z.ZodType>(purpose: CallRecord["purpose"], system: string, payload: unknown, schema: S, tier: "small" | "large") => {
    const res = await complete({
      tier, system, input: JSON.stringify(payload), schema, schemaName: `resume_${purpose}`, strict: true, temperature: purpose === "critique" ? 0 : REWRITE_TEMPERATURE,
      ...(input.userId && input.db ? { userId: input.userId, db: input.db } : {}),
    });
    result.calls.push({ purpose, model: res.model, costMicros: res.usage.costMicros });
    return res;
  };

  // ---- 1. rewrite -------------------------------------------------------------------------------------------------
  let first: z.infer<typeof RewriteOutput>;
  try {
    const kept = allBullets(content).filter((b) => !offerById.has(b.id));
    const usedOpeningVerbs = [...new Set(kept.map((b) => openingWord(b.text)).filter(Boolean))];
    const res = await call("rewrite", REWRITE_SYSTEM, { mode: "rewrite", ...base, usedOpeningVerbs, bullets: offered.map((o) => bulletPayload(o)), summary: summaryFacts }, RewriteOutput, "large");
    first = res.output;
    result.model = res.model;
  } catch (err) {
    // A resume without rewrites is still a good resume; the budget, an outage or a malformed reply must not stop an application.
    result.error = errMessage(err);
    result.aiUnavailable = err instanceof AiUnavailableError;
    result.stopReason = "model unavailable";
    for (const o of offered) result.bullets.push({ bulletId: o.bullet.id, sourceIds: o.bullet.careerPointIds, rewritten: false, attempts: 0, reverted: false, gate: { ok: true, failures: [] } });
    return result;
  }

  const reports = new Map<string, BulletReport>(offered.map((o) => [o.bullet.id, { bulletId: o.bullet.id, sourceIds: o.bullet.careerPointIds, rewritten: false, attempts: 0, reverted: false, gate: { ok: false, failures: [] } }]));
  const accepted = new Map<string, string>();
  let summaryText: string | null = first.summary.trim() || null;

  /** Gate a batch of candidate texts in display order, against the rest of the resume as it stands. */
  const gateBatch = (cands: Map<string, string>): Map<string, GateResult> => {
    const out = new Map<string, GateResult>();
    for (const b of allBullets(content)) {
      const text = cands.get(b.id);
      const o = offerById.get(b.id) ?? offerOf(b);
      if (text === undefined) continue;
      const others = allBullets(content).filter((x) => x.id !== b.id);
      // Bullets already checked count with their outcome; ones still to check count with their proposed text, since the
      // original is about to be replaced (a rewrite may take the verb the original of a later bullet used).
      const othersText = others.map((x) => {
        if (!cands.has(x.id)) return x.text;
        const done = out.get(x.id);
        return done === undefined || done.ok ? cands.get(x.id)! : x.text;
      });
      out.set(b.id, gateBullet(text, {
        source: supportOf([o.source, o.original]), original: o.original, vocab, lackedTerms, lackedPatterns, roleYears: o.roleYears, now,
        usedOpeners: new Set(othersText.map(openingWord).filter(Boolean)),
        termUses: { counts: termCounts([...othersText, summaryText ?? ""], terms), terms },
      }));
    }
    return out;
  };
  const byId = (bs: BulletOutT[]) => {
    const m = new Map<string, string>();
    for (const b of bs) {
      const o = offerById.get(b.id);
      if (!o) { result.rejected.push({ bulletId: b.id, text: b.text, reason: "not one of the bullets offered for rewriting" }); continue; }
      if (b.sourceId !== o.sourceId && !o.bullet.careerPointIds.includes(b.sourceId)) { result.rejected.push({ bulletId: b.id, text: b.text, reason: `cites ${b.sourceId}, not its source point` }); continue; }
      if (!m.has(b.id)) m.set(b.id, b.text.trim());
    }
    return m;
  };
  const apply = (id: string, text: string, gate: GateResult) => {
    const o = offerById.get(id) ?? offerOf(allBullets(content).find((b) => b.id === id)!);
    const bullet = allBullets(content).find((b) => b.id === id)!;
    bullet.text = text;
    accepted.set(id, text);
    const r = reports.get(id) ?? { bulletId: id, sourceIds: bullet.careerPointIds, rewritten: false, attempts: 0, reverted: false, gate };
    r.rewritten = true; r.reverted = false; r.gate = gate;
    reports.set(id, r);
    const reason = o.supports.length ? `Reworded around "${o.supports[0]}" in the posting's terms` : "Reworded in the posting's vocabulary";
    const existing = result.changes.find((c) => c.kind === "bullet" && c.bulletId === id);
    if (existing) existing.after = text;
    else result.changes.push({ kind: "bullet", before: o.original, after: text, reason, careerPointIds: bullet.careerPointIds, bulletId: id });
  };

  // ---- 2. gate, then one retry with the reasons ---------------------------------------------------------------------
  const firstCands = byId(first.bullets);
  const firstGate = gateBatch(firstCands);
  const failed: { o: Offer; text: string; failures: GateFailure[] }[] = [];
  for (const o of offered) {
    const r = reports.get(o.bullet.id)!;
    const text = firstCands.get(o.bullet.id);
    r.attempts = 1;
    if (text === undefined) { failed.push({ o, text: "", failures: [{ rule: "empty", detail: "no rewrite was returned for this bullet" }] }); continue; }
    // Returned as written: the model chose not to rewrite it, and the user's own words are always allowed.
    if (text === o.original.trim()) { r.gate = { ok: true, failures: [] }; continue; }
    const g = firstGate.get(o.bullet.id)!;
    if (g.ok) apply(o.bullet.id, text, g);
    else failed.push({ o, text, failures: g.failures });
  }
  const summaryGate = () => gateSummary(summaryText ?? "", {
    corpus: input.corpus, vocab, years: selection.years, jobTitle: job.title, personTitles,
    termUses: { counts: termCounts(allBullets(content).map((b) => b.text), terms), terms },
  });
  let sGate = summaryText ? summaryGate() : null;

  if (failed.length > 0 || (sGate && !sGate.ok)) {
    try {
      const res = await call("retry", REWRITE_SYSTEM, {
        mode: "retry", ...base,
        usedOpeningVerbs: [...new Set(allBullets(content).filter((b) => !failed.some((f) => f.o.bullet.id === b.id)).map((b) => openingWord(b.text)).filter(Boolean))],
        bullets: failed.map((f) => bulletPayload(f.o, { previous: f.text, failures: f.failures.map((x) => x.detail) })),
        summary: sGate && !sGate.ok ? { ...summaryFacts, previous: summaryText, failures: sGate.failures.map((x) => x.detail) } : null,
      }, RewriteOutput, "small");
      const second = byId(res.output.bullets);
      const secondGate = gateBatch(new Map([...second].filter(([id]) => failed.some((f) => f.o.bullet.id === id))));
      for (const f of failed) {
        const r = reports.get(f.o.bullet.id)!;
        r.attempts = 2;
        const text = second.get(f.o.bullet.id);
        const g = text !== undefined ? secondGate.get(f.o.bullet.id) : undefined;
        if (text !== undefined && g?.ok) apply(f.o.bullet.id, text, g);
        else revert(f, g ?? { ok: false, failures: f.failures }, text);
      }
      if (sGate && !sGate.ok && res.output.summary.trim()) { summaryText = res.output.summary.trim(); sGate = summaryGate(); }
    } catch (err) {
      result.error = errMessage(err);
      for (const f of failed) revert(f, { ok: false, failures: f.failures });
    }
  }
  /** Back to the user's words; both attempts are recorded as rejected, each with its own reasons. */
  function revert(f: { o: Offer; text: string; failures: GateFailure[] }, gate: GateResult, retryText?: string) {
    const r = reports.get(f.o.bullet.id)!;
    r.reverted = true; r.rewritten = false; r.gate = gate;
    const why = (fs: GateFailure[]) => fs.map((x) => x.detail).join("; ") || "failed the gate";
    if (f.text) result.rejected.push({ bulletId: f.o.bullet.id, text: f.text, reason: why(f.failures) });
    if (retryText) result.rejected.push({ bulletId: f.o.bullet.id, text: retryText, reason: `retry: ${why(gate.failures)}` });
  }
  if (sGate && sGate.ok) result.summary.text = summaryText;
  else if (sGate) result.summary.failures = sGate.failures;
  if (result.summary.text) content.summary = result.summary.text;

  // ---- 3. critique and revise ---------------------------------------------------------------------------------------
  // Progress is supported must-haves shown (any spelling) plus those whose key phrase is on the resume word for word.
  const coverage = () => (coverageScore(evidence, content).pct ?? 0) + (coverageScore(evidence, content, "phrase").pct ?? 0);
  const history = [coverage()];
  const openGaps = (): { entry: EvidenceEntry; candidates: string[] }[] => {
    const text = resumeText(content);
    // Open: a supported requirement not shown, or a supported must-have whose evidence can carry the posting's key
    // phrase but the resume says it in other words.
    const open = (e: EvidenceEntry) => e.supported && (!requirementShown(e, text) || (e.mustHave && e.mirror && !requirementShown(e, text, "phrase")));
    return evidence.entries.filter(open).map((entry) => ({
      entry,
      candidates: allBullets(content).filter((b) => bulletSupports(evidence, selection.sources.get(b.id) ?? b.text, b.careerPointIds).includes(entry)).map((b) => b.id),
    })).filter((g) => g.candidates.length > 0).sort((a, b) => Number(b.entry.mustHave) - Number(a.entry.mustHave) || b.entry.weight - a.entry.weight).slice(0, 6);
  };
  let lastFailures = [...reports.values()].filter((r) => r.reverted).length;
  let unreviewed = accepted.size;

  let round = 0;
  for (;;) {
    const gaps = openGaps();
    const pre = nextRound({ round, coverage: history, openGaps: gaps.length, gateFailures: lastFailures, unreviewed });
    if (!pre.go) { result.stopReason = pre.reason; break; }
    round++;
    const rewritten = [...accepted.keys()];
    const shown = new Set([...rewritten, ...gaps.flatMap((g) => g.candidates)]);
    let items: z.infer<typeof CritiqueOutput>;
    try {
      const res = await call("critique", CRITIQUE_SYSTEM, {
        requirements: gaps.map((g) => ({ id: g.entry.id, text: g.entry.text, mustHave: g.entry.mustHave, candidates: g.candidates })),
        bullets: allBullets(content).filter((b) => shown.has(b.id)).map((b) => {
          const o = offerById.get(b.id) ?? offerOf(b);
          return { id: b.id, text: b.text, original: o.original, rewritten: accepted.has(b.id), source: o.source };
        }),
      }, CritiqueOutput, "small");
      items = res.output;
    } catch (err) {
      result.error = errMessage(err);
      result.stopReason = "critique unavailable";
      break;
    }
    // Only what the reviewer is allowed to say: a listed gap with one of its candidates, or a fix to a rewritten bullet.
    const gapItems = items.gaps.filter((g) => gaps.some((x) => x.entry.id === g.requirementId && x.candidates.includes(g.bulletId)));
    const fixItems = items.fixes.filter((f) => accepted.has(f.bulletId) && f.problem.trim());
    const targets = [...new Set([...fixItems.map((f) => f.bulletId), ...gapItems.map((g) => g.bulletId)])].slice(0, MAX_REVISIONS_PER_ROUND);
    unreviewed = 0;
    const after = nextRound({ round: round - 1, coverage: history, openGaps: gaps.length, gateFailures: lastFailures, unreviewed: 1, critiqueItems: targets.length });
    if (!after.go) { result.rounds.push({ round, gaps: gapItems.length, fixes: fixItems.length, accepted: 0, coverage: history.at(-1) ?? null, stop: after.reason }); result.stopReason = after.reason; break; }

    const instructions = (id: string) => [
      ...fixItems.filter((f) => f.bulletId === id).map((f) => `Faithfulness: ${f.problem.trim()} Rewrite so every claim is in the source.`),
      ...gapItems.filter((g) => g.bulletId === id).map((g) => {
        const e = gaps.find((x) => x.entry.id === g.requirementId)!.entry;
        const use = e.supportedTerms.map((k) => e.terms.find((t) => t.key === k)!.jobString);
        const words = use.length ? `the posting's term${use.length > 1 ? "s" : ""} ${use.join(", ")}` : e.keyPhrase ? `the posting's exact phrase "${e.keyPhrase}"` : "the posting's words";
        return `Coverage: show "${e.text}" using ${words}, only as far as the source supports it.`;
      }),
    ];
    const targetOffers = targets.map((id) => offerById.get(id) ?? offerOf(allBullets(content).find((b) => b.id === id)!));
    for (const o of targetOffers) offerById.set(o.bullet.id, o);
    let revisedCount = 0;
    lastFailures = 0;
    try {
      const res = await call("revise", REWRITE_SYSTEM, {
        mode: "revise", ...base,
        usedOpeningVerbs: [...new Set(allBullets(content).filter((b) => !targets.includes(b.id)).map((b) => openingWord(b.text)).filter(Boolean))],
        bullets: targetOffers.map((o) => bulletPayload(o, { now: allBullets(content).find((b) => b.id === o.bullet.id)!.text, instructions: instructions(o.bullet.id) })),
        summary: null,
      }, RewriteOutput, "small");
      const cands = byId(res.output.bullets);
      const gates = gateBatch(cands);
      const before = new Map(targetOffers.map((o) => [o.bullet.id, allBullets(content).find((b) => b.id === o.bullet.id)!.text]));
      const snapshot = result.changes.map((c) => ({ ...c }));
      const reportSnap = new Map([...reports].map(([k, v]) => [k, { ...v }]));
      const acceptedSnap = new Map(accepted);
      for (const o of targetOffers) {
        const id = o.bullet.id;
        const text = cands.get(id);
        const g = text !== undefined ? gates.get(id) : undefined;
        const r = reports.get(id) ?? { bulletId: id, sourceIds: o.bullet.careerPointIds, rewritten: false, attempts: 0, reverted: false, gate: { ok: false, failures: [] } };
        r.attempts++;
        reports.set(id, r);
        if (text !== undefined && g?.ok) { apply(id, text, g); revisedCount++; continue; }
        lastFailures++;
        // An unfaithful rewrite that cannot be fixed goes back to the user's own words.
        if (fixItems.some((f) => f.bulletId === id)) {
          allBullets(content).find((b) => b.id === id)!.text = o.original;
          accepted.delete(id);
          result.changes = result.changes.filter((c) => !(c.kind === "bullet" && c.bulletId === id));
          r.rewritten = false; r.reverted = true; r.gate = g ?? { ok: false, failures: [{ rule: "source", detail: "critique: unfaithful to the source" }] };
        }
      }
      const cov = coverage();
      if (cov < history.at(-1)! ) {
        // A revision must not lose coverage: undo the round.
        for (const [id, text] of before) allBullets(content).find((b) => b.id === id)!.text = text;
        result.changes = snapshot; reports.clear(); for (const [k, v] of reportSnap) reports.set(k, v);
        accepted.clear(); for (const [k, v] of acceptedSnap) accepted.set(k, v);
        revisedCount = 0;
      }
    } catch (err) {
      result.error = errMessage(err);
      result.rounds.push({ round, gaps: gapItems.length, fixes: fixItems.length, accepted: 0, coverage: history.at(-1) ?? null, stop: "revise unavailable" });
      result.stopReason = "revise unavailable";
      break;
    }
    history.push(coverage());
    result.rounds.push({ round, gaps: gapItems.length, fixes: fixItems.length, accepted: revisedCount, coverage: history.at(-1) ?? null, stop: null });
  }

  for (const c of result.changes) {
    if (c.kind !== "bullet" || !c.bulletId) continue;
    const r = reports.get(c.bulletId);
    if (r) { c.gate = r.gate; c.attempts = r.attempts; }
  }
  result.bullets = [...reports.values()];
  return result;
}

/** Words per bullet and opening-verb variety, for reports and the eval. */
export function styleStats(content: ResumeContent): { bullets: number; meanWords: number; verbDiversity: number; banned: number } {
  const bs = allBullets(content).map((b) => b.text);
  const openers = bs.map(openingWord).filter(Boolean);
  return {
    bullets: bs.length,
    meanWords: bs.length ? Math.round((bs.reduce((n, t) => n + wordCount(t), 0) / bs.length) * 10) / 10 : 0,
    verbDiversity: openers.length ? Math.round((new Set(openers).size / openers.length) * 100) / 100 : 1,
    banned: [...bs, content.summary ?? ""].reduce((n, t) => n + bannedIn(t).length, 0),
  };
}
