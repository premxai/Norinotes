import { embed } from "@norinote/ai";
import { asc, careerPoints, companies, desc, eq, inboxAddresses, jobSpecs, jobs, profiles, users, type Db } from "@norinote/db";
import { CareerPoint, JobSpec, type PendingQuestion } from "@norinote/shared";
import { DEFAULT_MATCH_THRESHOLD, SOURCE_RANK, findSimilar, loadBank, markUsed, saveAnswer, type BankRow } from "./bank.js";
import { defaultAnswer, factsFrom, jobCountry } from "./defaults.js";
import { draftAnswer, isOpenEnded, type DraftJob } from "./draft.js";
import { MULTI_SEPARATOR, isNo, isYes, matchOption, normalizeQuestion, sameSpecifics } from "./text.js";

export type AnswerSourceKind = "default" | "bank" | "model";

export type AnswerQuestionsInput = {
  userId: string;
  jobId: string;
  questions: PendingQuestion[];
  /** Cosine similarity for a bank match. Default 0.82. */
  threshold?: number;
  /** Most model drafts per call, so one odd form cannot cost more than a few cents. Default 6. */
  maxDrafts?: number;
};

export type AnswerQuestionsResult = {
  /** Question id to the text the form will receive. A select or radio answer is exactly one of its options; a multiselect joins options with "; ". */
  answers: Record<string, string>;
  /** Required questions nobody could answer yet. These block the application until the user answers (then `saveAnswer`). */
  pending: PendingQuestion[];
  /** Where each answer came from. */
  sources: Record<string, AnswerSourceKind>;
  /** Optional questions left blank on purpose (no answer available, not required) and file uploads (the driver attaches those). */
  skipped: PendingQuestion[];
};

/**
 * Make a raw answer fit the question: one of the given options for choices (never an invented one), Yes/No for a
 * boolean, option labels joined with "; " for a multiselect, trimmed text for a text box. Null when it does not fit.
 */
export function fitAnswer(q: PendingQuestion, raw: string): string | null {
  const a = raw.trim();
  if (!a) return null;
  if (q.type === "multiselect") {
    const parts = a.split(/\s*[;|]\s*/).filter(Boolean);
    const mapped = parts.map((p) => matchOption(p, q.options));
    return mapped.length > 0 && mapped.every((m): m is string => m !== null) ? [...new Set(mapped)].join(MULTI_SEPARATOR) : null;
  }
  if (q.options.length > 0) return matchOption(a, q.options);
  if (q.type === "boolean") return isYes(a) ? "Yes" : isNo(a) ? "No" : null;
  return a;
}

export type Ctx = {
  facts: ReturnType<typeof factsFrom>;
  job: DraftJob & { country: string | null };
  points: () => Promise<CareerPoint[]>;
};

export async function loadContext(db: Db, userId: string, jobId: string): Promise<Ctx> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  // The owned inbox address is the email on applications, so codes, confirmations and replies reach Norinote (docs/inbox.md).
  const [inbox] = await db.select({ address: inboxAddresses.address }).from(inboxAddresses).where(eq(inboxAddresses.userId, userId)).orderBy(asc(inboxAddresses.createdAt)).limit(1);
  const [job] = await db.select({ title: jobs.title, location: jobs.location, description: jobs.descriptionText, company: companies.name })
    .from(jobs).innerJoin(companies, eq(companies.id, jobs.companyId)).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error(`Job ${jobId} not found`);
  const [specRow] = await db.select({ spec: jobSpecs.spec }).from(jobSpecs).where(eq(jobSpecs.jobId, jobId)).orderBy(desc(jobSpecs.version)).limit(1);
  const parsed = specRow ? JobSpec.safeParse(specRow.spec) : null;
  const spec = parsed?.success ? parsed.data : null;
  let cached: CareerPoint[] | null = null;
  return {
    facts: { ...factsFrom(profile, user?.email ?? ""), ...(inbox ? { email: inbox.address } : {}) },
    job: { title: job.title, company: job.company, description: job.description, spec, country: jobCountry(spec, job.location) },
    points: async () => (cached ??= (await db.select().from(careerPoints).where(eq(careerPoints.userId, userId))).map((r) => CareerPoint.parse({
      id: r.id, kind: r.kind, title: r.title, org: r.org, startDate: r.startDate, endDate: r.endDate, text: r.text,
      skills: r.skills, scope: r.scope, metrics: r.metrics, sourceQuote: r.sourceQuote,
    }))),
  };
}

/**
 * Best bank answer for a question, or null. Candidates are the user's closest saved questions at or above the
 * threshold that carry the same specifics (numbers, tools, names) and whose answer fits this question's options;
 * the highest similarity wins, and among near ties what the user typed beats a default beats a model draft.
 */
export function pickBankAnswer(q: PendingQuestion, candidates: { row: BankRow; similarity: number; exact?: boolean }[], threshold: number): { row: BankRow; answer: string } | null {
  const ok = candidates
    .filter((c) => c.similarity >= threshold && (c.exact || sameSpecifics(q.text, c.row.questionText)))
    .map((c) => ({ ...c, answer: fitAnswer(q, c.row.answer) }))
    .filter((c): c is typeof c & { answer: string } => c.answer !== null);
  if (ok.length === 0) return null;
  const top = Math.max(...ok.map((c) => c.similarity));
  const near = ok.filter((c) => top - c.similarity <= 0.02);
  near.sort((a, b) => SOURCE_RANK[b.row.source] - SOURCE_RANK[a.row.source] || b.similarity - a.similarity);
  return { row: near[0]!.row, answer: near[0]!.answer };
}

/**
 * Answer a form's questions for one user and job, cheapest source first:
 *   1. profile defaults (facts: work authorisation, sponsorship, salary, start date, relocation, location, links, EEO);
 *   2. the user's answer bank, by exact text and then by meaning (one embedding call for all remaining questions);
 *   3. for open-ended text questions only, one small-model draft grounded in the career points and the posting,
 *      saved to the bank as source "model";
 *   4. otherwise the question is pending (if required).
 * Choices always map to one of the offered options; an answer that cannot is not used.
 */
export async function answerQuestions(db: Db, input: AnswerQuestionsInput): Promise<AnswerQuestionsResult> {
  const { userId, jobId } = input;
  const threshold = input.threshold ?? DEFAULT_MATCH_THRESHOLD;
  const ctx = await loadContext(db, userId, jobId);
  const answers: Record<string, string> = {};
  const sources: Record<string, AnswerSourceKind> = {};
  const pending: PendingQuestion[] = [];
  const skipped: PendingQuestion[] = [];

  // 1. Defaults.
  let rest: PendingQuestion[] = [];
  for (const q of input.questions) {
    if (q.type === "file") { skipped.push(q); continue; }
    const d = defaultAnswer(q, ctx.facts, { jobCountry: ctx.job.country });
    const fitted = d === null ? null : fitAnswer(q, d);
    if (fitted !== null) { answers[q.id] = fitted; sources[q.id] = "default"; } else rest.push(q);
  }

  // 2. The bank: exact normalised text, then meaning.
  const used: string[] = [];
  if (rest.length > 0) {
    const bank = await loadBank(db, userId);
    const byText = new Map<string, BankRow[]>();
    for (const r of bank) byText.set(normalizeQuestion(r.questionText), [...(byText.get(normalizeQuestion(r.questionText)) ?? []), r]);
    const left: PendingQuestion[] = [];
    for (const q of rest) {
      // The same question, or the company-specific copy this job's company saved earlier.
      const keys = [normalizeQuestion(q.text), normalizeQuestion(`${q.text} [${ctx.job.company}]`)];
      const exact = keys.flatMap((k) => byText.get(k) ?? []).map((row) => ({ row, similarity: 1, exact: true }));
      const hit = pickBankAnswer(q, exact, threshold);
      if (hit) { answers[q.id] = hit.answer; sources[q.id] = "bank"; used.push(hit.row.id); } else left.push(q);
    }
    rest = left;
    if (rest.length > 0 && bank.length > 0) {
      let vectors: number[][] = [];
      try { vectors = await embed(rest.map((q) => q.text), { userId, db }); } catch { vectors = []; }
      const left2: PendingQuestion[] = [];
      for (const [i, q] of rest.entries()) {
        const vec = vectors[i];
        const similar = vec ? await findSimilar(db, userId, vec) : [];
        const hit = pickBankAnswer(q, similar.map((s) => ({ row: s, similarity: s.similarity })), threshold);
        if (hit) { answers[q.id] = hit.answer; sources[q.id] = "bank"; used.push(hit.row.id); } else left2.push(q);
      }
      rest = left2;
    }
    await markUsed(db, used);
  }

  // 3. Open-ended text: one grounded draft each, remembered in the bank.
  let drafts = 0;
  const unanswered: PendingQuestion[] = [];
  for (const q of rest) {
    if (!isOpenEnded(q) || drafts >= (input.maxDrafts ?? 6)) { unanswered.push(q); continue; }
    drafts++;
    let result: { answer: string; model: string } | null = null;
    try { result = await draftAnswer(db, userId, q, await ctx.points(), ctx.job); } catch { result = null; }
    const fitted = result ? fitAnswer(q, result.answer) : null;
    if (!result || fitted === null) { unanswered.push(q); continue; }
    answers[q.id] = fitted;
    sources[q.id] = "model";
    // An answer that names this company or role is only true for it: key the bank row by the company so another
    // company's "why do you want to work here?" does not reuse it.
    const specific = new RegExp(`\\b${ctx.job.company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(`${fitted} ${q.text}`);
    await saveAnswer(db, userId, specific ? `${q.text} [${ctx.job.company}]` : q.text, fitted, "model");
  }

  // 4. What is left: pending when it blocks the form, skipped when optional.
  for (const q of unanswered) (q.required ? pending : skipped).push(q);
  return { answers, pending, sources, skipped };
}
