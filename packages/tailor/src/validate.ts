import { COMMON_TECH_TERMS, TITLE_WORDS, containsTerm, mentionsSkill, numbersIn, tokensOf, uniq, wordCount } from "./text.js";

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

/**
 * Validate a summary against the whole career: every number must exist in the career points (or be the years of
 * experience computed from the dates, never more), no new skill, employer or title, two or three short sentences.
 */
export function validateSummary(summary: string, support: Support, vocab: Vocab, ctx: { years: number | null }): Verdict {
  const s = (summary ?? "").trim();
  if (!s) return { ok: false, reason: "empty" };
  const allowed: Support = { ...support, numbers: new Set(support.numbers) };
  if (ctx.years !== null) allowed.numbers.add(String(ctx.years));
  const claimed = /\b(\d+)\+?\s+years?\b/i.exec(s);
  if (claimed && ctx.years !== null && Number(claimed[1]) > ctx.years) return { ok: false, reason: `claims ${claimed[1]} years, the dates show ${ctx.years}` };
  if (claimed && ctx.years === null && !support.numbers.has(claimed[1]!)) return { ok: false, reason: "claims years of experience the dates cannot show" };
  if (wordCount(s) < 8) return { ok: false, reason: "too short" };
  const sentences = s.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  if (sentences > 3) return { ok: false, reason: `${sentences} sentences` };
  if (wordCount(s) > 70) return { ok: false, reason: "too long" };
  return provenance(s, allowed, vocab);
}
