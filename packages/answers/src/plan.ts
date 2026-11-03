/**
 * The answer plan for one application form, built before the click. Cheapest source first, and never an invented answer:
 *
 *   1. what the person already answered for this application (`applications.answers`);
 *   2. a profile slot, decided deterministically (or from the form recipe cache), valued from the profile;
 *   3. the answer bank: the same question by normalised text, then by meaning (one embedding call for the form);
 *   4. at most ONE batched small-model call for the rest: classify the label to a slot, choose options by meaning from
 *      the offered list, write short answers grounded in the profile. It may say "unsure": that is a pending question;
 *   5. required long free text: at most ONE large-model call for the form, every answer checked against the profile and
 *      career points (employers, numbers, names must appear there), else a pending question.
 *
 * Legal slots (work authorisation, sponsorship, criminal history, salary, relocation, start date, age, consent) only ever
 * come from the profile. EEO: the profile's choice, else the form's "decline to self-identify" option.
 */
import { z } from "zod";
import { complete, embed, type Usage } from "@norinote/ai";
import type { Db } from "@norinote/db";
import type { CareerPoint, PendingQuestion } from "@norinote/shared";
import { fitAnswer, loadContext, pickBankAnswer } from "./answers.js";
import { DEFAULT_MATCH_THRESHOLD, findSimilar, loadBank, markUsed, saveAnswer, type BankRow } from "./bank.js";
import { candidatePrefix, NEVER_DRAFT, PROSE } from "./draft.js";
import { careerFacts, classifySlot, EEO_SLOTS, LEGAL_SLOTS, SLOTS, slotValue, type Slot, type SlotField } from "./slots.js";
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
};

export const fieldAnswerKey = (key: string): string => `field:${key}`;

/** Same slug as @norinote/apply's questionId: lower case, dashes, at most 80 characters. */
export function questionSlug(label: string): string {
  const slug = label.toLowerCase().replace(/\*/g, "").replace(/\s+/g, " ").trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (slug || "question").slice(0, 80).replace(/-+$/g, "");
}

const CHOICE_TYPES = new Set<SlotField["type"]>(["select", "multiselect", "radio", "checkbox", "boolean"]);
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

/** Tokens of an answer the facts must contain: numbers, acronyms, names and tools (see distinctiveTokens). */
export function ungroundedTokens(answer: string, corpus: string): string[] {
  const hay = corpus.toLowerCase().replace(/,/g, "");
  const out: string[] = [];
  for (const t of distinctiveTokens(answer)) {
    const word = t.startsWith("#") ? t.slice(1) : t;
    if (!hay.includes(word.toLowerCase())) out.push(word);
  }
  return out;
}

function corpusOf(points: CareerPoint[], facts: { fullName: string; location: string }, job: { title: string; company: string; description: string }): string {
  return [
    facts.fullName, facts.location, job.title, job.company, job.description,
    ...points.map((p) => [p.title, p.org ?? "", p.text, p.skills.join(" "), JSON.stringify(p.metrics), JSON.stringify(p.scope), p.startDate ?? "", p.endDate ?? ""].join(" ")),
  ].join("\n");
}

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

// ---- the large-model call for required long free text -----------------------------------------------------------------

const LargeReply = z.object({
  answers: z.array(z.object({
    key: z.string(),
    answerable: z.boolean(),
    /** One entry per sentence, each with the verbatim fact (or posting line) it restates. */
    sentences: z.array(z.object({ text: z.string(), support: z.string() })),
  })),
});

const LARGE_SYSTEM = `You write the candidate's answers to the long free-text questions of one job application, in the first person.

Rules:
- Every sentence restates something the facts or the posting actually say. Never invent an employer, title, skill, tool, number, date, school, step, finding or outcome, and never stretch a fact (no bigger scope, no new metric, no made-up story details).
- A question about a specific situation ("a time when a metric surprised you", "a time you played PM") is answerable only if a fact describes that situation. Otherwise answerable false.
- "Why this company or role" is answerable only from what the posting text says about the company and the work. A posting with no such text: answerable false.
- If the facts do not support an honest answer, return answerable false and no sentences.
- 2 to 4 sentences, at most 100 words in all. Plain and specific. No filler ("passionate", "leverage", "excited to"), no flattery, no mention of AI.
- For each sentence give "support": a verbatim quote (at least 4 words) copied from the facts or the posting that the sentence restates.
Reply as JSON: {"answers": [{"key", "answerable", "sentences": [{"text", "support"}]}]} with one entry per question.`;

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
    const bank = await loadBank(db, input.userId);
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
      if (rest.length && !input.noModel) {
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

  const corpus = corpusOf(points, ctx.facts, { title: ctx.job.title, company: ctx.job.company, description: ctx.job.description });
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
    if (input.noModel || points.length === 0) {
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
          set(f, slot, { status: "ready", value: isMulti(f) ? [...new Set(picked)].join(MULTI_SEPARATOR) : picked[0]!, source: "model" });
          continue;
        }
        const text = (r.text ?? "").trim();
        const bad = text ? ungroundedTokens(text, corpus) : ["(empty)"];
        if (!text || bad.length || text.split(/\s+/).length > 40) { unresolved(f, slot, bad.length ? `A drafted answer mentioned facts not in your profile (${bad.slice(0, 3).join(", ")})` : "The drafted answer was too long"); continue; }
        set(f, slot, { status: "ready", value: text, source: "model" });
        remember(f, text);
      }
    }
  }
  timings.smallMs = Date.now() - t2;

  // 5: one large-model call for required long free text.
  const t3 = Date.now();
  if (longRequired.length) {
    if (input.noModel || points.length === 0) {
      for (const f of longRequired) unresolved(f, "custom", "This question needs a written answer from you");
    } else {
      let reply: z.infer<typeof LargeReply> | null = null;
      try {
        const res = await complete({
          tier: "large", system: LARGE_SYSTEM, prefix: candidatePrefix(points), schema: LargeReply, schemaName: "long_answers", strict: true, temperature: 0.2,
          input: JSON.stringify({
            job: { title: ctx.job.title, company: ctx.job.company, mustHaves: ctx.job.spec?.mustHaves.slice(0, 8) ?? [], posting: ctx.job.description.slice(0, 2500) },
            questions: longRequired.map((f) => ({ key: f.key, question: f.label.slice(0, 800) })),
          }),
          userId: input.userId, db, maxOutputTokens: 450 * longRequired.length + 200,
        });
        usage.largeCalls++;
        addUsage(usage, res.usage);
        reply = res.output;
      } catch {
        reply = null;
      }
      const byKey = new Map((reply?.answers ?? []).map((r) => [r.key, r]));
      for (const f of longRequired) {
        const r = byKey.get(f.key);
        const sentences = r?.answerable ? r.sentences.filter((x) => x.text.trim()) : [];
        const text = sentences.map((x) => x.text.trim()).join(" ");
        if (!text) { unresolved(f, "custom", "Your profile does not support an honest answer to this question"); continue; }
        const bad = unsupportedSentences(sentences, corpus, f.label);
        if (bad.length || text.split(/\s+/).length > 130) { unresolved(f, "custom", bad.length ? `A drafted answer said things your profile does not (${bad[0]!.slice(0, 80)})` : "The draft was too long"); continue; }
        set(f, "custom", { status: "ready", value: text, source: "large" });
        remember(f, text);
      }
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
 * The grounding check for a long answer: every sentence names its supporting quote, the quote must be in the facts or the
 * posting, every number, name and tool of the sentence must be in its quote (or the question), and most of its content
 * words must come from the quote. A story detail the facts do not contain fails the whole answer.
 */
export function unsupportedSentences(sentences: { text: string; support: string }[], corpus: string, question: string): string[] {
  const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const hay = norm(corpus);
  const bad: string[] = [];
  for (const s of sentences) {
    const quote = norm(s.support);
    if (quote.split(" ").length < 3 || !hay.includes(quote)) { bad.push(s.text); continue; }
    const allowed = `${s.support} ${question}`;
    if (ungroundedTokens(s.text, allowed).length) { bad.push(s.text); continue; }
    const words = contentTokens(s.text).filter((w) => w.length > 3 && !contentTokens(question).includes(w));
    const have = new Set(contentTokens(allowed).map((w) => w.slice(0, 5)));
    const covered = words.filter((w) => have.has(w.slice(0, 5))).length;
    if (words.length >= 4 && covered / words.length < 0.5) bad.push(s.text);
  }
  return bad;
}
