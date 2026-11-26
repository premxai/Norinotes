/**
 * The answer plan for one application form, built before the click. Cheapest source first, and never an invented answer:
 *
 *   1. what the person already answered for this application (`applications.answers`);
 *   2. a profile slot, decided deterministically (or from the form recipe cache), valued from the profile;
 *   3. the answer bank: the same question by normalised text, then by meaning (one embedding call for the form);
 *   4. at most ONE batched small-model call for the rest: classify the label to a slot, choose options by meaning from
 *      the offered list, write short answers grounded in the profile. It may say "unsure": that is a pending question;
 *   5. required story and motivation questions: at most ONE large-model call for the form, each answer in three parts
 *      (what the role needs, from the posting; one or two real examples, quoting the career points; why this team, from
 *      the posting), else a pending question. Factual questions are never drafted.
 *
 * Legal slots (work authorisation, sponsorship, criminal history, salary, relocation, start date, age, consent) only ever
 * come from the profile. EEO: the profile's choice, else the form's "decline to self-identify" option.
 */
import { z } from "zod";
import { complete, embed, type Usage } from "@norinote/ai";
import { and, applications, companies, eq, gte, jobs, ne, type Db } from "@norinote/db";
import type { CareerPoint, PendingQuestion } from "@norinote/shared";
import { fitAnswer, loadContext, pickBankAnswer } from "./answers.js";
import { DEFAULT_MATCH_THRESHOLD, findSimilar, loadBank, markUsed, saveAnswer, type BankRow } from "./bank.js";
import { candidatePrefix, isAiTrap, NEVER_DRAFT, PROSE } from "./draft.js";
import { careerFacts, classifySlot, EEO_SLOTS, LEGAL_SLOTS, SLOTS, slotValue, type Slot, type SlotField } from "./slots.js";
import { findTerms, mentionsSkill } from "@norinote/tailor/terms";
import { contentTokens, distinctiveTokens, matchOption, MULTI_SEPARATOR, normalizeQuestion } from "./text.js";

export type PlanField = SlotField & {
  /** Slot remembered for this label by the form recipe cache. Skips classification. */
  slotHint?: Slot | null;
};

export type PlanSource = "answers" | "profile" | "eeo" | "decline" | "bank" | "model" | "large";

export type PlanEntry = {
  key: string;
  label: string;
  type: SlotField["type"];
  required: boolean;
  slot: Slot;
  status: "ready" | "pending" | "skip";
  value?: string;
  source?: PlanSource;
  reason?: string;
};

export type PlanUsage = { smallCalls: number; largeCalls: number; embedCalls: number; costMicros: number };

export type FormPlan = {
  entries: PlanEntry[];
  /** `field:<key>` to the value the form receives. A file field holds "@resume". */
  answers: Record<string, string>;
  /** Required questions nobody could answer. Ids are `field:<key>`, so the person's answer lands where the filler looks. */
  pending: PendingQuestion[];
  /** Label (normalised) to slot, for the recipe cache. Only classifications, never values. */
  learned: Record<string, Slot>;
  usage: PlanUsage;
  timings: Record<string, number>;
};

export type PlanFormInput = {
  userId: string;
  jobId: string;
  fields: PlanField[];
  /** Answers already on the application (the person's, or an earlier plan's). Keyed `field:<key>`, question id or text. */
  explicit?: Record<string, string>;
  /** Cosine similarity for a bank match. Default 0.82. */
  threshold?: number;
  /** No model calls at all (tests, an exhausted budget): what would go to a model becomes pending. */
  noModel?: boolean;
  /**
   * Only the person's own data: their answers, profile slots and bank answers they typed or saved. No model calls and
   * no model drafts from the bank. For answers nobody reviews before they are sent (questions raised at the click).
   */
  ownDataOnly?: boolean;
};

export const fieldAnswerKey = (key: string): string => `field:${key}`;

/** Same slug as @norinote/apply's questionId: lower case, dashes, at most 80 characters. */
export function questionSlug(label: string): string {
  const slug = label.toLowerCase().replace(/\*/g, "").replace(/\s+/g, " ").trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (slug || "question").slice(0, 80).replace(/-+$/g, "");
}

const CHOICE_TYPES = new Set<SlotField["type"]>(["select", "multiselect", "radio", "checkbox", "boolean"]);
/** A years or experience question: it answers for one named skill (\"How many years of experience with Kubernetes?\"). */
const SKILL_ASKED = /\b(?:years?|experience|proficien\w*|familiar\w*|knowledge|worked|work with|used to|use|using|know)\b[^?]{0,40}\b(?:with|in|using|of)\s+([^?]{2,60}?)[?.\s]*$/i;

/** The skill a years or experience question names, lowercased, or null when it names none. */
function skillAsked(label: string): string | null {
  const raw = (SKILL_ASKED.exec(label.trim())?.[1] ?? "").trim().replace(/[?.]+$/, "").trim();
  return raw ? raw.toLowerCase() : null;
}

/**
 * Why a model's pick on a choice question cannot be used, or null when it can. A pick has no answer text to check, so
 * the evidence it names must be a real quote from the career points, and a question that asks about one named skill
 * needs that skill in the points. Otherwise the person answers.
 */
export function pickProblem(f: SlotField, evidence: string | null | undefined, facts: string): string | null {
  const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}+#.]+/gu, " ").trim();
  const quote = norm(evidence ?? "");
  if (quote.length < 8 || !norm(facts).includes(quote)) return "Norinote could not point to a fact that answers this";
  const skill = skillAsked(f.label);
  if (skill && !norm(facts).includes(norm(skill))) return `Your profile does not mention ${skill}`;
  return null;
}

const isChoice = (f: SlotField) => f.options.length > 0 || CHOICE_TYPES.has(f.type);
const isMulti = (f: SlotField) => f.type === "multiselect" || (f.type === "checkbox" && f.options.length > 1);
/** Free text that asks for prose, not a short fact. */
export const isLongText = (f: SlotField): boolean =>
  !isChoice(f) && f.type !== "file" && (f.type === "textarea" || PROSE.test(f.label.toLowerCase()));

const toPending = (f: SlotField): PendingQuestion => ({
  id: fieldAnswerKey(f.key), text: f.label, required: f.required, options: f.options,
  type: f.type === "textarea" ? "textarea" : f.type === "file" ? "file" : isMulti(f) ? "multiselect"
    : f.options.length > 0 ? "select" : f.type === "checkbox" || f.type === "boolean" ? "boolean" : "text",
});

/**
 * Tokens of an answer the facts must contain: numbers, acronyms, names (see distinctiveTokens), and every skill or tool
 * the alias table knows, in any case and by any of its names ("kafka", "k8s").
 */
export function ungroundedTokens(answer: string, corpus: string): string[] {
  const hay = corpus.toLowerCase().replace(/,/g, "");
  const terms = findTerms(answer).map((t) => ({ as: t.as.toLowerCase(), grounded: mentionsSkill(corpus, t.as) }));
  const out = terms.filter((t) => !t.grounded).map((t) => t.as);
  for (const t of distinctiveTokens(answer)) {
    const word = (t.startsWith("#") ? t.slice(1) : t).toLowerCase();
    // A grounded alias ("k8s" for Kubernetes) is not new because its spelling differs.
    if (out.includes(word) || terms.some((x) => x.grounded && (x.as === word || (/^\d/.test(word) && x.as.includes(word))))) continue;
    if (!hay.includes(word)) out.push(word);
  }
  return out;
}

/** What the person's own data says: their career points, name and location. The only ground for a claim about them. */
function factsCorpus(points: CareerPoint[], facts: { fullName: string; location: string }): string {
  return [
    facts.fullName, facts.location,
    ...points.map((p) => [p.title, p.org ?? "", p.text, p.skills.join(" "), JSON.stringify(p.metrics), JSON.stringify(p.scope), p.startDate ?? "", p.endDate ?? ""].join(" ")),
  ].join("\n");
}

/** A sentence that says something about the candidate: first person, or a year count ("5 years of Go"). */
const CANDIDATE_CLAIM = /\b(i|i'm|i've|i'd|i'll|me|my|mine|myself)\b|\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|several|many)\s*(\+|-?\s*plus)?\s*(years?|yrs?)\b/i;
export const isCandidateClaim = (sentence: string): boolean => CANDIDATE_CLAIM.test(sentence.replace(/[’`]/g, "'"));

// ---- the batched small-model call -------------------------------------------------------------------------------------

const SMALL_SLOTS = SLOTS.filter((s) => !["resume", "resume_text", "eeo_signature"].includes(s)) as [Slot, ...Slot[]];

const SmallReply = z.object({
  fields: z.array(z.object({
    key: z.string(),
    slot: z.enum(SMALL_SLOTS),
    decision: z.enum(["answer", "unsure"]),
    /** Choice fields: the chosen option(s), copied exactly from the list. */
    options: z.array(z.string()),
    /** Text fields: the answer. */
    text: z.string().nullable(),
    /** Which fact supports it (a career point, the profile location ...). */
    evidence: z.string().nullable(),
  })),
});

const SMALL_SYSTEM = `You prepare answers for a job application form on behalf of the candidate. You get the candidate's facts and a list of form fields that no rule could answer.

For every field return one entry with the same key:
- slot: what the field asks, from the allowed list. Use "custom" when it is none of them. Classify carefully: work authorisation, visa sponsorship, criminal history, salary, relocation, start date, age and consent questions MUST get their slot even if you cannot answer them.
- decision "answer" only when the candidate's facts directly establish the answer. Otherwise "unsure". Never guess, never invent an employer, title, skill, number, date, school or outcome. For the legal slots above always reply "unsure": those are answered from the profile, not by you.
- options: for a field with options, the chosen option text copied exactly from its list (several only when the field allows several). Empty for text fields.
- text: for a text field, a short answer in the first person (at most 25 words), plain and specific. Null for choice fields.
- evidence: the fact you used, quoted briefly. Null when unsure.
Equal-opportunity questions (gender, race, veteran, disability, orientation) are not yours: give the slot and reply "unsure".
Questions about the candidate's past dealings with this company (worked or interviewed here before, applied before, relatives or friends here, referrals) and about agreements or restrictions they are bound by: always "unsure", whatever the resume shows.
Years-of-experience questions: use the computed years per role in the facts (today is given); answer only when the facts clearly cover the area asked about, else "unsure".`;

type SmallItem = { key: string; label: string; type: string; required: boolean; options: string[] };

// ---- the large-model call: story and motivation drafts ---------------------------------------------------------------

/**
 * Story and motivation questions (why this company or role, a project you are proud of, anything else, a cover note):
 * the only free text Nori drafts. Factual questions (years with a skill, have you used X, legal, money, dates, EEO) are
 * never drafted, whatever box they come in. A question that is neither is left to the person.
 */
const FACTUAL_QUESTION = /\b(years?|how (many|much|long)|have you (ever )?(used|worked|held|been|had)|do you (have|hold|know|use)|experience (with|in|using)|proficien|familiar|fluent|certif|licen[cs]|degree|gpa|visa|sponsor|citizen|authori[sz]|salary|compensation|pay|rate|start|notice|availab|relocat|commut|location|located|based|criminal|convict|background check|gender|race|ethnic|veteran|disabilit|orientation|pronoun|referr|refer|relative|worked (here|at|for) .{0,20}before|interviewed|non-?compete|agreement|clearance)\b/;
const STORY_QUESTION = /\b(why|what (excites|interests|motivates|draws|attracts|appeals)|interested in|excited about|passionate about|proud|accomplish|achievement|a (project|time|challenge|problem)|tell us about (yourself|you|a)|about yourself|walk us through|anything else|additional information|else (we|you)|cover (note|letter)|introduce yourself)\b/;

export type QuestionKind = "story" | "factual" | "other";

/** Story or motivation (may be drafted), factual (never drafted), or other (left to the person). */
export function questionKind(label: string): QuestionKind {
  const l = label.toLowerCase().replace(/[’`]/g, "'");
  if (FACTUAL_QUESTION.test(l) || findTerms(label).length > 0) return "factual";
  return STORY_QUESTION.test(l) ? "story" : "other";
}

/** How far back a new draft is compared with the person's earlier ones, and how close counts as a copy. */
export const RECENT_DRAFT_DAYS = 90;
export const NEAR_COPY = { anyCompany: 0.7, sameCompany: 0.45 };

/** Three-word shingles of a text, lowercased, punctuation dropped. */
function shingles(text: string): Set<string> {
  const w = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
}

/** Jaccard similarity of two texts' three-word shingles, 0 to 1. */
export function draftSimilarity(a: string, b: string): number {
  const x = shingles(a), y = shingles(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const s of x) if (y.has(s)) shared++;
  return shared / (x.size + y.size - shared);
}

export type EarlierDraft = { value: string; company: string };

/**
 * The earlier draft a new one copies, or null. Examples quote the same career points every time, so some overlap is
 * expected; a copy is a draft that is mostly the same text (another company), or noticeably the same text for a company
 * that will read both.
 */
export function nearCopyOf(text: string, company: string, earlier: readonly EarlierDraft[]): EarlierDraft | null {
  const same = (c: string) => c.trim().toLowerCase() === company.trim().toLowerCase();
  return earlier.find((d) => draftSimilarity(text, d.value) >= (same(d.company) ? NEAR_COPY.sameCompany : NEAR_COPY.anyCompany)) ?? null;
}

/** The person's drafts on their other applications in the last RECENT_DRAFT_DAYS (`receipt.prepared.drafted`). */
async function earlierDrafts(db: Db, userId: string, jobId: string, now = new Date()): Promise<EarlierDraft[]> {
  const since = new Date(now.getTime() - RECENT_DRAFT_DAYS * 86_400_000);
  const rows = await db.select({ receipt: applications.receipt, company: companies.name }).from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId)).innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(eq(applications.userId, userId), ne(applications.jobId, jobId), gte(applications.updatedAt, since)));
  return rows.flatMap((r) => {
    const drafted = (r.receipt as { prepared?: { drafted?: { value?: unknown }[] } } | null)?.prepared?.drafted ?? [];
    return drafted.flatMap((d) => (typeof d.value === "string" ? [{ value: d.value, company: r.company }] : []));
  });
}

/** At most this many drafts per form, so one large call stays within the budget for a form Nori has not seen. */
export const MAX_DRAFTS_PER_FORM = 4;

const Sentence = z.object({ text: z.string(), support: z.string() });
const LargeReply = z.object({
  answers: z.array(z.object({
    key: z.string(),
    answerable: z.boolean(),
    /** What the role needs, in the posting's words. Support: a posting line. */
    need: Sentence,
    /** One or two real examples from the career points. Support: a career point line. */
    examples: z.array(Sentence),
    /** Why this team or product, from the posting. Support: a posting line. */
    tie: Sentence,
  })),
});

const LARGE_SYSTEM = `You draft the candidate's answers to the story and motivation questions of one job application ("why this company", "a project you are proud of", "anything else", a short cover note).

Every answer has exactly three parts:
1. need: one sentence on what the role needs, in the posting's own words. Do not use "I", "me" or "my" here.
2. examples: one or two sentences, each a real example from the candidate's facts, in the first person, with their actual titles, employers, tools and numbers. Pick the facts that best match what the role needs.
3. tie: one sentence tying that experience to this team or product, using only what the posting says about them. Do not use "I", "me" or "my" here.

Rules:
- Never invent or stretch anything: no employer, title, skill, tool, number, date, school, outcome or story detail that the facts do not state; no claim about the company that the posting does not state.
- For each sentence give "support": a verbatim quote (at least 4 words) copied from the facts (examples) or from the posting (need and tie).
- A question about a specific situation ("a time when a metric surprised you") is answerable only if a fact describes that situation.
- If nothing in the candidate's facts fits the role well, or the posting says nothing about the team or product, return answerable false.
- Plain and specific, at most 100 words per answer. No filler ("passionate", "leverage", "excited to"), no flattery, no mention of AI.
Reply as JSON: {"answers": [{"key", "answerable", "need": {"text", "support"}, "examples": [{"text", "support"}], "tie": {"text", "support"}}]} with one entry per question.`;

/**
 * Why a three-part draft cannot be used, or null when it can. The need and the tie are about the role and the team: they
 * quote the posting and say nothing about the candidate. Each example is about the candidate: it quotes their facts and
 * every number, name and tool in it is in that quote. At least one example must share a term or two content words with
 * the posting, or nothing in the person's career fits well enough.
 */
export function draftProblem(d: z.infer<typeof LargeReply>["answers"][number], facts: string, posting: string, question: string): string | null {
  const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const examples = d.examples.filter((x) => x.text.trim());
  if (!d.answerable || !d.need.text.trim() || !d.tie.text.trim() || examples.length === 0 || examples.length > 2) return "Your profile does not support an honest answer to this question";
  for (const part of [d.need, d.tie]) {
    if (isCandidateClaim(part.text) || !norm(posting).includes(norm(part.support)) || unsupportedSentences([part], "", question, posting).length) {
      return `A drafted answer said things the posting does not (${part.text.slice(0, 80)})`;
    }
  }
  const bad = unsupportedSentences(examples, facts, "");
  if (bad.length) return `A drafted answer said things your profile does not (${bad[0]!.slice(0, 80)})`;
  const postingTerms = new Set(findTerms(posting).map((t) => t.key));
  const postingWords = new Set(contentTokens(posting).filter((w) => w.length > 3));
  const fits = examples.some((x) => findTerms(x.support).some((t) => postingTerms.has(t.key))
    || contentTokens(x.support).filter((w) => w.length > 3 && postingWords.has(w)).length >= 2);
  if (!fits) return "Nothing in your career points fits this role well enough to answer for you";
  return null;
}

const addUsage = (u: PlanUsage, x: Usage) => { u.costMicros += x.costMicros; };

/** Build the answer plan for one form. See the file comment for the order of sources. */
export async function planForm(db: Db, input: PlanFormInput): Promise<FormPlan> {
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const usage: PlanUsage = { smallCalls: 0, largeCalls: 0, embedCalls: 0, costMicros: 0 };
  const ctx = await loadContext(db, input.userId, input.jobId);
  const points = await ctx.points();
  const career = careerFacts(points);
  const explicit = input.explicit ?? {};
  const threshold = input.threshold ?? DEFAULT_MATCH_THRESHOLD;
  const noModel = input.noModel || input.ownDataOnly;
  const entries = new Map<string, PlanEntry>();
  const learned: Record<string, Slot> = {};
  const fields = input.fields;

  const set = (f: PlanField, slot: Slot, e: Omit<PlanEntry, "key" | "label" | "type" | "required" | "slot">) =>
    entries.set(f.key, { key: f.key, label: f.label, type: f.type, required: f.required, slot, ...e });
  const unresolved = (f: PlanField, slot: Slot, reason: string) =>
    set(f, slot, f.required ? { status: "pending", reason } : { status: "skip", reason });

  // 1 + 2: explicit answers and profile slots.
  const custom: PlanField[] = [];
  const slotOf = new Map<string, Slot>();
  for (const f of fields) {
    // Stable keys and label rules first; the recipe's remembered slot only for what they cannot place.
    const own = classifySlot(f);
    const slot = own === "custom" && f.slotHint && f.slotHint !== "custom" ? f.slotHint : own;
    slotOf.set(f.key, slot);
    const given = [fieldAnswerKey(f.key), questionSlug(f.label), f.label, f.key].map((k) => explicit[k]).find((v) => v !== undefined && v.trim() !== "");
    if (given !== undefined) {
      const fitted = f.type === "file" ? given : isChoice(f) && f.options.length ? fitAnswer(toPending(f), given) : given.trim();
      if (fitted) { set(f, slot, { status: "ready", value: fitted, source: "answers" }); continue; }
    }
    // Before any rule, bank or model: a question with instructions aimed at AI tools is the person's alone.
    if (isAiTrap(f.label, f.description, f.placeholder)) { unresolved(f, slot, "This question has instructions aimed at AI tools, so only you should answer it"); continue; }
    if (slot !== "custom") {
      const v = slotValue(slot, f, ctx.facts, career, { jobCountry: ctx.job.country });
      if (v.status === "ready") set(f, slot, { status: "ready", value: v.value, source: v.source });
      else set(f, slot, { status: v.status, reason: v.reason });
      continue;
    }
    if (f.type === "file") { unresolved(f, slot, "The form asks for a file Norinote does not have"); continue; }
    if (NEVER_DRAFT.test(f.label.toLowerCase())) { unresolved(f, slot, "Only you can answer this"); continue; }
    custom.push(f);
  }
  timings.deterministicMs = Date.now() - t0;

  // 3: the answer bank, exact text and then meaning.
  const t1 = Date.now();
  let rest = custom;
  if (rest.length) {
    const bank = (await loadBank(db, input.userId)).filter((r) => !input.ownDataOnly || r.source !== "model");
    if (bank.length) {
      const used: string[] = [];
      const byText = new Map<string, BankRow[]>();
      for (const r of bank) byText.set(normalizeQuestion(r.questionText), [...(byText.get(normalizeQuestion(r.questionText)) ?? []), r]);
      const left: PlanField[] = [];
      for (const f of rest) {
        const keys = [normalizeQuestion(f.label), normalizeQuestion(`${f.label} [${ctx.job.company}]`)];
        const hit = pickBankAnswer(toPending(f), keys.flatMap((k) => byText.get(k) ?? []).map((row) => ({ row, similarity: 1, exact: true })), threshold);
        if (hit) { set(f, "custom", { status: "ready", value: hit.answer, source: "bank" }); used.push(hit.row.id); } else left.push(f);
      }
      rest = left;
      if (rest.length && !noModel) {
        let vectors: number[][] = [];
        try { vectors = await embed(rest.map((f) => f.label), { userId: input.userId, db }); usage.embedCalls++; } catch { vectors = []; }
        const left2: PlanField[] = [];
        for (const [i, f] of rest.entries()) {
          const vec = vectors[i];
          const similar = vec ? await findSimilar(db, input.userId, vec) : [];
          const hit = pickBankAnswer(toPending(f), similar.map((s) => ({ row: s, similarity: s.similarity })), threshold);
          if (hit) { set(f, "custom", { status: "ready", value: hit.answer, source: "bank" }); used.push(hit.row.id); } else left2.push(f);
        }
        rest = left2;
      }
      await markUsed(db, used);
    }
  }
  timings.bankMs = Date.now() - t1;

  // Claims about the candidate are grounded in their own facts only; the posting may support what is said about the
  // company or the role (long answers), and a short answer may name its title and company.
  const facts = factsCorpus(points, ctx.facts);
  const posting = [ctx.job.title, ctx.job.company, ctx.job.description].join("\n");
  const long = rest.filter((f) => isLongText(f));
  // Optional prose is left blank: a wrong essay costs more than an empty optional box.
  for (const f of long.filter((x) => !x.required)) set(f, "custom", { status: "skip", reason: "optional free text" });
  const longRequired = long.filter((f) => f.required);
  const short = rest.filter((f) => !isLongText(f));
  const saves: Promise<unknown>[] = [];
  const remember = (f: PlanField, value: string) => {
    if (isChoice(f)) return;
    const specific = new RegExp(`\\b${ctx.job.company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(`${value} ${f.label}`);
    saves.push(saveAnswer(db, input.userId, specific ? `${f.label} [${ctx.job.company}]` : f.label, value, "model").catch(() => null));
  };

  // 4: one small-model call for the short unknowns.
  const t2 = Date.now();
  if (short.length) {
    if (noModel || points.length === 0) {
      for (const f of short) unresolved(f, "custom", "No rule or saved answer covers this question");
    } else {
      const items: SmallItem[] = short.map((f) => ({ key: f.key, label: f.label.slice(0, 400), type: isMulti(f) ? "multiselect" : isChoice(f) ? "choice" : "text", required: f.required, options: f.options.slice(0, 60) }));
      let reply: z.infer<typeof SmallReply> | null = null;
      try {
        const res = await complete({
          tier: "small", system: SMALL_SYSTEM, prefix: candidateFacts(points, ctx.facts), schema: SmallReply, schemaName: "form_fields", strict: true,
          input: JSON.stringify({ job: { title: ctx.job.title, company: ctx.job.company }, allowedSlots: SMALL_SLOTS, fields: items }),
          userId: input.userId, db, maxOutputTokens: 1600,
        });
        usage.smallCalls++;
        addUsage(usage, res.usage);
        reply = res.output;
      } catch {
        reply = null;
      }
      const byKey = new Map((reply?.fields ?? []).map((r) => [r.key, r]));
      for (const f of short) {
        const r = byKey.get(f.key);
        if (!r) { unresolved(f, "custom", "No rule or saved answer covers this question"); continue; }
        const slot = r.slot as Slot;
        if (slot !== "custom") {
          learned[normalizeQuestion(f.label)] = slot;
          // Classified as a profile, legal or EEO slot: the value still comes from the profile, never from the model.
          const v = slotValue(slot, f, ctx.facts, career, { jobCountry: ctx.job.country });
          if (v.status === "ready") { set(f, slot, { status: "ready", value: v.value, source: v.source }); continue; }
          if (LEGAL_SLOTS.has(slot) || EEO_SLOTS.has(slot)) { set(f, slot, { status: v.status, reason: v.reason }); continue; }
        } else {
          learned[normalizeQuestion(f.label)] = "custom";
        }
        if (r.decision !== "answer") { unresolved(f, slot, "Norinote is not sure how you would answer this"); continue; }
        if (isChoice(f) && f.options.length) {
          const picked = r.options.map((o) => matchOption(o, f.options)).filter((o): o is string => o !== null);
          if (!picked.length || (!isMulti(f) && picked.length > 1)) { unresolved(f, slot, "No offered option fits what Norinote knows"); continue; }
          // A choice is the model's word alone: only a fact it quotes, and the skill the question names, can carry it.
          const why = pickProblem(f, r.evidence, facts);
          if (why) { unresolved(f, slot, why); continue; }
          set(f, slot, { status: "ready", value: isMulti(f) ? [...new Set(picked)].join(MULTI_SEPARATOR) : picked[0]!, source: "model" });
          continue;
        }
        const text = (r.text ?? "").trim();
        const bad = text ? ungroundedTokens(text, `${facts}\n${ctx.job.title}\n${ctx.job.company}`) : ["(empty)"];
        if (!text || bad.length || text.split(/\s+/).length > 40) { unresolved(f, slot, bad.length ? `A drafted answer mentioned facts not in your profile (${bad.slice(0, 3).join(", ")})` : "The drafted answer was too long"); continue; }
        set(f, slot, { status: "ready", value: text, source: "model" });
        remember(f, text);
      }
    }
  }
  timings.smallMs = Date.now() - t2;

  // 5: one large-model call drafts the required story and motivation questions in the three-part format. Factual
  // questions in a text box are never drafted; neither is a question that is neither kind.
  const t3 = Date.now();
  const drafts: PlanField[] = [];
  for (const f of longRequired) {
    const kind = questionKind(f.label);
    if (kind === "factual") unresolved(f, "custom", "Only you can answer this");
    else if (kind === "other" || noModel || points.length === 0 || drafts.length >= MAX_DRAFTS_PER_FORM) unresolved(f, "custom", "This question needs a written answer from you");
    else drafts.push(f);
  }
  if (drafts.length) {
    let reply: z.infer<typeof LargeReply> | null = null;
    try {
      const res = await complete({
        tier: "large", system: LARGE_SYSTEM, prefix: candidatePrefix(points), schema: LargeReply, schemaName: "long_answers", strict: true, temperature: 0.2,
        input: JSON.stringify({
          job: { title: ctx.job.title, company: ctx.job.company, mustHaves: ctx.job.spec?.mustHaves.slice(0, 8) ?? [], posting: ctx.job.description.slice(0, 2500) },
          questions: drafts.map((f) => ({ key: f.key, question: f.label.slice(0, 800) })),
        }),
        userId: input.userId, db, maxOutputTokens: 450 * drafts.length + 200,
      });
      usage.largeCalls++;
      addUsage(usage, res.usage);
      reply = res.output;
    } catch {
      reply = null;
    }
    const byKey = new Map((reply?.answers ?? []).map((r) => [r.key, r]));
    // Drafts on this form count too: two questions must not get the same answer.
    const earlier = reply ? await earlierDrafts(db, input.userId, input.jobId) : [];
    for (const f of drafts) {
      const d = byKey.get(f.key);
      const problem = d ? draftProblem(d, facts, posting, f.label) : "Your profile does not support an honest answer to this question";
      const text = d ? [d.need, ...d.examples, d.tie].map((x) => x.text.trim()).filter(Boolean).join(" ") : "";
      if (problem || text.split(/\s+/).length > 130) { unresolved(f, "custom", problem ?? "The draft was too long"); continue; }
      if (nearCopyOf(text, ctx.job.company, earlier)) { unresolved(f, "custom", "Nori's draft was too close to one it wrote for another application"); continue; }
      earlier.push({ value: text, company: ctx.job.company });
      // Not saved to the answer bank: the need and the tie come from this posting, so the answer is true for this job only.
      set(f, "custom", { status: "ready", value: text, source: "large" });
    }
  }
  timings.largeMs = Date.now() - t3;
  await Promise.all(saves);

  const ordered = fields.map((f) => entries.get(f.key)!).filter(Boolean);
  const answers: Record<string, string> = {};
  for (const e of ordered) if (e.status === "ready" && e.value !== undefined) answers[fieldAnswerKey(e.key)] = e.value;
  for (const f of fields) {
    const s = slotOf.get(f.key);
    if (s && s !== "custom" && !learned[normalizeQuestion(f.label)]) learned[normalizeQuestion(f.label)] = s;
  }
  const pending = ordered.filter((e) => e.status === "pending").map((e) => toPending(fields.find((f) => f.key === e.key)!));
  timings.totalMs = Date.now() - t0;
  return { entries: ordered, answers, pending, learned, usage, timings };
}

/** The candidate facts the small model sees: where they live and their career points. No contact details. */
function candidateFacts(points: CareerPoint[], facts: { location: string; country: string; preferences: Record<string, unknown> }, today = new Date()): string {
  const ym = (d: string | null | undefined) => { const m = /^(\d{4})(?:-(\d{2}))?/.exec(d ?? ""); return m ? Number(m[1]) + (Number(m[2] ?? "1") - 1) / 12 : null; };
  const now = today.getUTCFullYear() + today.getUTCMonth() / 12;
  const years = points.filter((p) => p.kind === "role").map((p) => {
    const a = ym(p.startDate), b = p.endDate ? ym(p.endDate) : now;
    return a !== null && b !== null ? `- ${p.title}${p.org ? ` at ${p.org}` : ""}: ${Math.max(0, b - a).toFixed(1)} years` : null;
  }).filter(Boolean);
  const lines = [`Today: ${today.toISOString().slice(0, 10)}`, `Location: ${facts.location || "unknown"}${facts.country ? ` (${facts.country})` : ""}`];
  if (years.length) lines.push("Years per role (computed):", ...(years as string[]));
  return `${lines.join("\n")}\n${candidatePrefix(points)}`;
}

/**
 * The grounding check for a long answer: every sentence names its supporting quote. A sentence about the candidate
 * (`isCandidateClaim`) must quote the person's facts, and every number, name and tool in it must be in that quote; the
 * question cannot lend it a term. Any other sentence (about the company or the role) may quote the facts or the posting,
 * and may also use the question's terms. Most of a sentence's content words must come from its quote. A story detail the
 * facts do not contain fails the whole answer.
 */
export function unsupportedSentences(sentences: { text: string; support: string }[], facts: string, question: string, posting = ""): string[] {
  const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const own = norm(facts);
  const job = norm(posting);
  const bad: string[] = [];
  for (const s of sentences) {
    const quote = norm(s.support);
    const claim = isCandidateClaim(s.text);
    const found = own.includes(quote) || (!claim && job.includes(quote));
    if (quote.split(" ").length < 3 || !found) { bad.push(s.text); continue; }
    const allowed = claim ? s.support : `${s.support} ${question}`;
    if (ungroundedTokens(s.text, allowed).length) { bad.push(s.text); continue; }
    const words = contentTokens(s.text).filter((w) => w.length > 3 && !contentTokens(question).includes(w));
    const have = new Set(contentTokens(allowed).map((w) => w.slice(0, 5)));
    const covered = words.filter((w) => have.has(w.slice(0, 5))).length;
    if (words.length >= 4 && covered / words.length < 0.5) bad.push(s.text);
  }
  return bad;
}
