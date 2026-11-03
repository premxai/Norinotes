import { bannedIn, openerTense, openingWord } from "./phrases.js";
import { releaseYearOf } from "./release-years.js";
import { COMMON_TECH_TERMS, TITLE_WORDS, containsTerm, countTerm, findTerms, mentionsSkill, numbersIn, sameSkill, tokensOf, uniq, wordCount } from "./text.js";

/**
 * The provenance validator. A rewritten bullet or summary may reorder, tighten and use the posting's wording, but it may
 * not add a skill, employer, title or number that the user's career points do not already contain. Anything rejected
 * is replaced by the original text, so the model can only make a resume read better, never claim more.
 */
export type Verdict = { ok: true } | { ok: false; reason: string };

/** Everything the user's career points say that a piece of text may draw from. */
export type Support = { text: string; tokens: Set<string>; numbers: Set<string> };

export function supportOf(texts: string[]): Support {
  const text = texts.filter(Boolean).join("\n");
  return { text, tokens: new Set(tokensOf(text)), numbers: new Set(numbersIn(text)) };
}

/** The names a rewrite is checked against: skills and tools, employers, and titles. */
export type Vocab = { skills: string[]; orgs: string[]; titles: string[] };

export function buildVocab(opts: { userSkills: string[]; specSkills: string[]; orgs: string[]; titles: string[] }): Vocab {
  return {
    skills: uniq([...opts.specSkills, ...opts.userSkills, ...COMMON_TECH_TERMS]),
    orgs: uniq(opts.orgs).filter((o) => o.length >= 3),
    titles: uniq(opts.titles).filter((t) => t.length >= 4),
  };
}

const PRONOUNS = /\b(I|me|my|mine|myself|we|our|ours|us)\b/;

/** Filler a recruiter skims past, or distrusts when nothing backs it up. */
export const FLUFF_RE = new RegExp(
  "\\b(" + [
    "robust", "large[- ]scale", "world[- ]class", "best[- ]in[- ]class", "cutting[- ]edge", "state[- ]of[- ]the[- ]art", "passionate",
    "dynamic", "results[- ]driven", "detail[- ]oriented", "team player", "go[- ]getter", "self[- ]starter", "highly motivated",
    "proven track record", "track record of", "synerg\\w+", "thought leader", "rock ?star", "ninja", "guru", "think outside the box",
    "hard[- ]working", "fast[- ]paced", "seasoned", "visionary", "game[- ]chang\\w+", "mission[- ]critical",
    "extensive experience", "wealth of experience", "strong background", "excellent communication",
  ].join("|") + ")\\b", "i");

/**
 * Ownership and scope words a rewrite may not add. "Contributed to a migration" rewritten as "Led the migration" passes
 * the number and skill checks but tells the employer something untrue.
 */
const INFLATION: { claim: RegExp; justified: RegExp }[] = [
  { claim: /\b(led|lead|leading)\b/i, justified: /\b(led|lead|leading|leader|headed|managed|directed|ran|owned|tech lead|team lead)\b/i },
  { claim: /\b(spearhead(ed|ing)?|architect(ed|ing)?|head(ed|ing)|direct(ed|ing)|found(ed|ing)|pioneer(ed|ing)?)\b/i, justified: /\b(spearhead|architect|head|direct|found|pioneer|led|lead|design(ed)? the|owned)/i },
  { claim: /\b(own(ed|ing)?|ownership)\b/i, justified: /\b(own(ed|ing)?|ownership|led|lead|responsible for|in charge)\b/i },
  { claim: /\b(managed|managing|manager of)\b/i, justified: /\b(manag(ed|ing|er)|led|lead|supervis|direct reports?)\b/i },
  { claim: /\b(mentor(ed|ing)?|coach(ed|ing)?)\b/i, justified: /\b(mentor|coach|train(ed|ing)? (new|junior)|onboard)/i },
  { claim: /\b(company|organi[sz]ation|org|enterprise)[- ]wide\b/i, justified: /\b(company|organi[sz]ation|org|enterprise)[- ]wide\b|\ball (teams|engineers|employees|departments)\b/i },
  { claim: /\b(global(ly)?|worldwide|industry[- ]leading)\b/i, justified: /\b(global|worldwide|international|countries|regions|industry[- ]leading)\b/i },
  { claim: /\b(large|entire|whole) (team|organi[sz]ation|org|department|company)\b/i, justified: /\b(large|entire|whole) (team|organi[sz]ation|org|department|company)\b/i },
  { claim: /\bsingle[- ]handedly|\bsole(ly)?\b|\bindependently\b/i, justified: /\bsingle[- ]handedly|\bsole(ly)?\b|\bindependently\b|\bby myself\b|\balone\b/i },
];

/** The first ownership or scope claim in `text` that `support` does not justify, or null. */
export function inflationIn(text: string, support: string): string | null {
  for (const r of INFLATION) {
    const m = r.claim.exec(text);
    if (m && !r.justified.test(support)) return m[0];
  }
  return null;
}

/** Capitalised words that are fine without evidence. */
const SAFE_CAPS = new Set(["api", "apis", "ui", "ux", "us", "uk", "eu", "kpi", "kpis", "qa", "i", "a", "the", "and", "or", "of", "for", "to", "in", "on", "with"]);

/** Capitalised or all-caps words in the middle of a sentence (names of tools, employers, products) that the support never uses. */
export function unsupportedProperNouns(text: string, support: Support): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[A-Za-z0-9][A-Za-z0-9+#.&'-]*/g)) {
    const w = m[0].replace(/[.'&-]+$/, "");
    if (!/^[A-Z]/.test(w)) continue;
    const before = text.slice(0, m.index).trimEnd();
    const sentenceStart = before === "" || /[.!?:;(]$/.test(before);
    const acronym = /^[A-Z0-9+#&]{2,}$/.test(w);
    const camel = /[a-z][A-Z]/.test(w) || /[0-9+#.]/.test(w.slice(1));
    if (sentenceStart && !acronym && !camel) continue;
    const lw = w.toLowerCase();
    if (SAFE_CAPS.has(lw) || support.tokens.has(lw) || support.tokens.has(lw.replace(/s$/, "")) || mentionsSkill(support.text, w)) continue;
    out.push(w);
  }
  return [...new Set(out)];
}

/** Checks shared by bullets and summaries: new skills, employers, titles, proper nouns, first person, filler, inflation. */
function provenance(text: string, support: Support, vocab: Vocab, original = ""): Verdict {
  const known = support.numbers;
  const origNums = new Set(numbersIn(original));
  const newNums = numbersIn(text).filter((n) => !known.has(n) && !origNums.has(n));
  if (newNums.length > 0) return { ok: false, reason: `introduces number(s) ${newNums.join(", ")} not in the career points` };

  const newSkills = vocab.skills.filter((v) => mentionsSkill(text, v) && !mentionsSkill(support.text, v));
  if (newSkills.length > 0) return { ok: false, reason: `mentions ${newSkills.slice(0, 3).join(", ")}, which the career points do not` };

  const newOrgs = vocab.orgs.filter((o) => containsTerm(text, o) && !containsTerm(support.text, o));
  if (newOrgs.length > 0) return { ok: false, reason: `names employer ${newOrgs[0]} that this does not come from` };

  const otherTitles = vocab.titles.filter((t) => containsTerm(text, t) && !containsTerm(support.text, t));
  if (otherTitles.length > 0) return { ok: false, reason: `claims title "${otherTitles[0]}" that this does not come from` };
  const titleWord = TITLE_WORDS.exec(text)?.[0];
  if (titleWord && !new RegExp(`\\b${titleWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(support.text)) {
    return { ok: false, reason: `claims title word "${titleWord}" the career points do not use` };
  }

  const nouns = unsupportedProperNouns(text, support);
  if (nouns.length > 0) return { ok: false, reason: `names ${nouns.slice(0, 3).join(", ")}, which the career points do not` };

  if (PRONOUNS.test(text.replace(/\bU\.?S\.?\b/g, ""))) return { ok: false, reason: "first-person pronoun" };
  const fluff = FLUFF_RE.exec(text)?.[0];
  if (fluff && !FLUFF_RE.test(original)) return { ok: false, reason: `filler "${fluff}" the source did not use` };
  const inflated = inflationIn(text, `${original}\n${support.text}`);
  if (inflated) return { ok: false, reason: `claims "${inflated}", which the career points do not` };
  return { ok: true };
}

/**
 * Validate a rewritten bullet against the career points it came from (`support`: the points it cites plus the role or
 * project they belong to, and the original bullet itself).
 */
export function validateBullet(original: string, candidate: string, support: Support, vocab: Vocab): Verdict {
  const text = (candidate ?? "").trim();
  if (!text) return { ok: false, reason: "empty text" };
  const wc = wordCount(text);
  if (wc < 6 || wc > 34) return { ok: false, reason: `length ${wc} words` };
  if (text.trim() === original.trim()) return { ok: false, reason: "unchanged" };
  return provenance(text, support, vocab, original);
}

const YEAR_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};

/** Every year count a text states ("5 years", "5+ years", "five years", "a year"). */
export function yearClaims(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\b(\d+|[a-z]+|a|an)\s*\+?\s*(?:-\s*)?(?:years?|yrs?)\b/gi)) {
    const w = m[1]!.toLowerCase();
    const n = /^\d+$/.test(w) ? Number(w) : w === "a" || w === "an" ? 1 : YEAR_WORDS[w];
    if (n !== undefined) out.push(n);
  }
  return out;
}

/**
 * The summary's years rule: a year count is allowed only when it is exactly `years` (whole years in the target function
 * from the person's own role dates, rounded down) and that is at least 2; otherwise the summary gives no years at all.
 */
export function yearsVerdict(summary: string, years: number | null): Verdict {
  for (const n of yearClaims(summary)) {
    if (years === null || years < 2) return { ok: false, reason: `states ${n} year${n === 1 ? "" : "s"}; the role dates in the target function do not support a year count, so leave years out` };
    if (n !== years) return { ok: false, reason: `claims ${n} years, the role dates in the target function show ${years}` };
  }
  return { ok: true };
}

/**
 * Validate a summary against the whole career: every number must exist in the career points (or be the years of
 * experience computed from the dates, never more), no new skill, employer or title, two or three short sentences.
 */
export function validateSummary(summary: string, support: Support, vocab: Vocab, ctx: { years: number | null }): Verdict {
  const s = (summary ?? "").trim();
  if (!s) return { ok: false, reason: "empty" };
  const allowed: Support = { ...support, numbers: new Set(support.numbers) };
  const years = yearsVerdict(s, ctx.years);
  if (!years.ok) return years;
  if (ctx.years !== null) allowed.numbers.add(String(ctx.years));
  if (wordCount(s) < 8) return { ok: false, reason: "too short" };
  const sentences = s.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  if (sentences > 3) return { ok: false, reason: `${sentences} sentences` };
  if (wordCount(s) > 70) return { ok: false, reason: "too long" };
  return provenance(s, allowed, vocab);
}

// ---- the per-bullet gate ------------------------------------------------------------------------------------------------

export type GateRule =
  | "empty" | "unchanged" | "length" | "number" | "tool" | "employer" | "title" | "proper_noun" | "lacked_requirement"
  | "anachronism" | "banned_phrase" | "repeated_verb" | "tense" | "overuse" | "pronoun" | "inflation" | "source";
export type GateFailure = { rule: GateRule; detail: string };
export type GateResult = { ok: boolean; failures: GateFailure[] };

export const BULLET_MIN_WORDS = 16;
export const BULLET_MAX_WORDS = 30;
/** A job term may appear at most this many times across the summary and bullets (the skills list does not count). */
export const MAX_TERM_USES = 3;

export type GateContext = {
  /** The cited source: the bullet's own line (or achievement point) plus its role's title, organisation and dates. */
  source: Support;
  /** The bullet as the user wrote it. */
  original: string;
  vocab: Vocab;
  /** Job terms or key phrases (any spelling) that no career point supports. */
  lackedTerms?: readonly string[];
  /** Soft requirements no career point shows (startup pace, ownership...): the wording must not appear unless the source has it. */
  lackedPatterns?: readonly RegExp[];
  /** The role's years; a tool released after `end` (or after this year when current) is anachronistic. */
  roleYears?: { start: number | null; end: number | null };
  /** Check that the bullet opens in the past tense (every accomplishment, the current role included). Default true. */
  tense?: boolean;
  /** Opening verbs other bullets on the resume already use. */
  usedOpeners?: ReadonlySet<string>;
  /** Uses of each job term (by canonical key) in the rest of the resume, and the terms to count. */
  termUses?: { counts: ReadonlyMap<string, number>; terms: readonly { key: string; jobString: string }[] };
  minWords?: number;
  maxWords?: number;
  now?: Date;
};

const NUMBER_WORDS: Record<string, string> = {
  two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
  fifteen: "15", twenty: "20", thirty: "30", fifty: "50", hundred: "100", hundreds: "100", thousand: "1000", thousands: "1000",
  million: "1000000", millions: "1000000", dozen: "12", dozens: "12", doubled: "2", tripled: "3",
};

/** Numbers a text claims that the source does not have, digits and number words ("five", "dozens", "doubled") alike. */
export function newNumbers(text: string, source: Support, original = ""): string[] {
  const known = new Set([...source.numbers, ...numbersIn(original)]);
  const out = numbersIn(text).filter((n) => !known.has(n));
  const srcLower = `${source.text}\n${original}`.toLowerCase();
  for (const m of text.toLowerCase().matchAll(/\b[a-z]+\b/g)) {
    const digit = NUMBER_WORDS[m[0]];
    if (digit && !known.has(digit) && !new RegExp(`\\b${m[0]}\\b`).test(srcLower)) out.push(m[0]);
  }
  return [...new Set(out)];
}

/**
 * Every check a rewritten bullet must pass. All failures are returned (not only the first), so a retry can be told
 * everything that was wrong.
 */
export function gateBullet(candidate: string, ctx: GateContext): GateResult {
  const text = (candidate ?? "").trim();
  const failures: GateFailure[] = [];
  const fail = (rule: GateRule, detail: string) => failures.push({ rule, detail });
  if (!text) return { ok: false, failures: [{ rule: "empty", detail: "empty text" }] };
  if (text === ctx.original.trim()) fail("unchanged", "same as the original");
  const src = ctx.source.text;
  const wc = wordCount(text);
  const min = ctx.minWords ?? BULLET_MIN_WORDS, max = ctx.maxWords ?? BULLET_MAX_WORDS;
  if (wc < min || wc > max) fail("length", `${wc} words; write ${min} to ${max}`);

  const nums = newNumbers(text, ctx.source, ctx.original);
  if (nums.length) fail("number", `number(s) ${nums.join(", ")} are not in the source`);

  const lacked = (ctx.lackedTerms ?? []).filter((t) => mentionsSkill(text, t) && !mentionsSkill(src, t));
  if (lacked.length) fail("lacked_requirement", `mentions ${uniq(lacked).join(", ")}, which the person does not have`);

  const terms = uniq([...findTerms(text).map((f) => f.as), ...ctx.vocab.skills.filter((v) => mentionsSkill(text, v))]);
  const newTools = terms.filter((t) => !mentionsSkill(src, t) && !lacked.some((l) => sameSkill(l, t)) && !mentionsSkill(ctx.original, t));
  if (newTools.length) fail("tool", `mentions ${newTools.slice(0, 4).join(", ")}, which the source does not`);

  const newOrgs = ctx.vocab.orgs.filter((o) => containsTerm(text, o) && !containsTerm(src, o));
  if (newOrgs.length) fail("employer", `names ${newOrgs[0]}, which this bullet does not come from`);

  const otherTitles = ctx.vocab.titles.filter((t) => containsTerm(text, t) && !containsTerm(src, t));
  const titleWord = TITLE_WORDS.exec(text)?.[0];
  if (otherTitles.length) fail("title", `claims title "${otherTitles[0]}"`);
  else if (titleWord && !new RegExp(`\\b${titleWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(`${src}\n${ctx.original}`)) {
    fail("title", `claims "${titleWord}", which the source does not`);
  }

  const flagged = new Set([...newTools, ...newOrgs, ...lacked].map((x) => x.toLowerCase()));
  const nouns = unsupportedProperNouns(text, ctx.source).filter((n) => !flagged.has(n.toLowerCase()) && !mentionsSkill(ctx.original, n));
  if (nouns.length) fail("proper_noun", `names ${nouns.slice(0, 3).join(", ")}, which the source does not`);

  const end = ctx.roleYears ? (ctx.roleYears.end ?? (ctx.now ?? new Date()).getFullYear()) : null;
  if (end !== null) {
    const late = findTerms(text).filter((f) => { const y = releaseYearOf(f.key); return y !== null && y > end; });
    if (late.length) fail("anachronism", `${late.map((f) => `${f.as} (released ${releaseYearOf(f.key)})`).join(", ")} is newer than the role (ended ${end})`);
  }

  const banned = bannedIn(text);
  if (banned.length) fail("banned_phrase", `generic phrase(s): ${banned.join(", ")}`);

  const opener = openingWord(text);
  if (opener && ctx.usedOpeners?.has(opener)) fail("repeated_verb", `opening verb "${opener}" is already used by another bullet`);

  if (ctx.tense !== false && openerTense(text) === "present") fail("tense", `start with a past-tense verb, not "${opener}"`);

  const lackedHit = (ctx.lackedPatterns ?? []).find((re) => re.test(text) && !re.test(`${src}\n${ctx.original}`));
  if (lackedHit) fail("lacked_requirement", `claims "${text.match(lackedHit)![0]}", a requirement the person's history does not show`);

  if (ctx.termUses) {
    const uses = ctx.termUses;
    const over = uses.terms.filter((t) => {
      const here = countTerm(text, t.jobString);
      return here > countTerm(ctx.original, t.jobString) && here + (uses.counts.get(t.key) ?? 0) > MAX_TERM_USES;
    });
    if (over.length) fail("overuse", `${over.map((t) => t.jobString).join(", ")} already appear ${MAX_TERM_USES} times on the resume`);
  }

  if (PRONOUNS.test(text.replace(/\bU\.?S\.?\b/g, ""))) fail("pronoun", "first-person pronoun");
  const inflated = inflationIn(text, `${ctx.original}\n${src}`);
  if (inflated) fail("inflation", `claims "${inflated}", which the source does not`);
  return { ok: failures.length === 0, failures };
}

/**
 * A summary may name the target job title only when the person has held that title (seniority words aside) or in a
 * clearly targeted phrase ("for Data Scientist roles"). Returns the untruthful claim, or null.
 */
export function untruthfulTitle(summary: string, jobTitle: string, personTitles: readonly string[]): string | null {
  const strip = (t: string) => t.replace(new RegExp(TITLE_WORDS.source, "gi"), " ").replace(/\b(i|ii|iii|iv|1|2|3)\b/gi, " ")
    .replace(/[(),/-]/g, " ").replace(/\s+/g, " ").trim();
  const core = strip(jobTitle);
  if (!core) return null;
  const re = new RegExp(`\\b${core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")}`, "i");
  const m = re.exec(summary);
  if (!m) return null;
  if (personTitles.some((t) => re.test(strip(t)))) return null;
  const before = summary.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
  if (/\b(for|seeking|toward|towards|targeting|pursuing|into|to the|to a)\s+(an?\s+|the\s+)?$/.test(before)) return null;
  return m[0];
}
