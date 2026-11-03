/**
 * Style lists for rewritten bullets and summaries: generic phrases a recruiter skims past (or reads as machine-written),
 * and the verb forms the tense check needs. Pure data plus two small helpers.
 */

/** Generic or inflated phrases a rewrite may not use. Matched whole-word, case-insensitively; `\w*` allows inflections. */
export const BANNED_PHRASES: readonly string[] = [
  "leverag\\w*", "spearhead\\w*", "passionate", "passion for", "synerg\\w*", "results[- ]driven", "results[- ]oriented", "dynamic",
  "cutting[- ]edge", "responsible for", "worked on", "work on", "helped with", "duties included", "tasked with", "involved in",
  "utiliz\\w*", "utilis\\w*", "in order to", "various", "seamless\\w*", "robust", "world[- ]class", "best[- ]in[- ]class",
  "state[- ]of[- ]the[- ]art", "game[- ]chang\\w*", "innovative", "detail[- ]oriented", "team player", "self[- ]starter",
  "go[- ]getter", "hard[- ]working", "proven track record", "track record of", "think outside the box", "rock ?star", "ninja", "guru",
  "thought leader\\w*", "value[- ]add\\w*", "move the needle", "deep dive\\w*", "successfully", "highly motivated",
  "extensive experience", "wealth of experience", "fast[- ]paced", "mission[- ]critical", "seasoned", "visionary", "transformative",
  "holistic\\w*", "orchestrat\\w*", "delv\\w*", "showcas\\w*", "foster\\w*", "tapestry", "pivotal", "meticulous\\w*", "adept",
  "speciali[sz](?:e|ed|es|ing)", "expert in", "deep expertise", "mastery of", "honed", "harness\\w*", "champion\\w*", "empower\\w*", "streamlin\\w*", "revolutioniz\\w*", "next[- ]generation",
  "industry[- ]leading", "exceptional", "outstanding", "excellent communication", "strong background", "go above and beyond",
  "a wide range of", "a variety of", "plethora", "myriad", "landscape", "ever[- ]evolving", "unparalleled",
];

const BANNED_RE = new RegExp(`\\b(?:${BANNED_PHRASES.join("|")})\\b`, "gi");

/** The banned phrases in readable form, for prompts: regex inflections dropped, "[- ]" shown as a hyphen. */
export function bannedPhraseExamples(): string[] {
  return BANNED_PHRASES.map((p) => p.replace(/\\w\*$/, "").replace(/\[- \]/g, "-").replace(/ \?/g, " ")
    // "(?:strong |deep )?" drops out, "(?:e|ed|ing)" shows its first form, "[sz]" its first letter.
    .replace(/\(\?:([^|)]*)[^)]*\)(\?)?/g, (_m, first: string, optional?: string) => (optional ? "" : first)).replace(/\[([a-z])[a-z]*\]/g, "$1")
    .replace(/\\/g, "").replace(/\s+/g, " ").trim()).filter((p) => p.length > 2);
}

/** Every banned phrase in a text, as written there. */
export function bannedIn(text: string): string[] {
  return [...new Set((text.match(BANNED_RE) ?? []).map((m) => m.toLowerCase()))];
}

/**
 * Requirement-sentence fragments that belong in a job ad, not on a resume line ("Demonstrated strong proficiency in
 * TypeScript", "Experience with Kafka"). A bullet says what the person did; the posting's noun phrase goes into that.
 * Summaries may say "experience" and "skilled in", so `forSummary` leaves those out.
 */
const BOILERPLATE_ALL = [
  "demonstrat\\w*", "proficiency (?:in|with)", "proficient (?:in|with)", "strong (?:understanding|knowledge|grasp|command) of",
  "solid (?:understanding|knowledge|grasp) of", "deep (?:understanding|knowledge) of", "ability to", "able to", "familiarity with",
  "familiar with", "knowledge of", "understanding of", "hands[- ]on experience", "expertise (?:in|with)", "track record",
  "exposure to", "comfortable (?:with|in)",
];
const BOILERPLATE_BULLET_ONLY = ["experience (?:with|in|of)", "skilled (?:in|at|with)", "years of experience"];
const BOILERPLATE_RE = new RegExp(`\\b(?:${[...BOILERPLATE_ALL, ...BOILERPLATE_BULLET_ONLY].join("|")})\\b`, "gi");
const BOILERPLATE_SUMMARY_RE = new RegExp(`\\b(?:${BOILERPLATE_ALL.join("|")})\\b`, "gi");

/** Job-ad fragments in a text, as written there. */
export function boilerplateIn(text: string, opts: { forSummary?: boolean } = {}): string[] {
  const re = opts.forSummary ? BOILERPLATE_SUMMARY_RE : BOILERPLATE_RE;
  return [...new Set((text.match(re) ?? []).map((m) => m.toLowerCase()))];
}

/** Opening verbs worth keeping: a rewrite keeps the original one (in the past tense) rather than trading it in. */
export const STRONG_VERBS: readonly string[] = ("built designed led launched shipped migrated cut reduced grew automated architected owned created scaled " +
  "rebuilt redesigned founded closed negotiated drove increased eliminated deployed refactored optimized established won exceeded mentored " +
  "published invented doubled tripled saved delivered implemented engineered managed").split(" ");
/** Generic verbs a strong verb must never be traded for. */
export const WEAK_VERBS: readonly string[] = "developed worked helped assisted participated utilized utilised supported provided handled aided used performed involved".split(" ");

const IRREGULAR_LEMMA: Record<string, string> = {
  built: "build", rebuilt: "rebuild", led: "lead", ran: "run", wrote: "write", rewrote: "rewrite", drove: "drive", grew: "grow", won: "win",
  made: "make", sold: "sell", took: "take", began: "begin", oversaw: "oversee", taught: "teach", brought: "bring", kept: "keep", held: "hold",
  gave: "give", chose: "choose", spoke: "speak", sought: "seek", met: "meet", spent: "spend", sent: "send", undertook: "undertake",
};

/** A comparable stem for a verb in any form ("built", "builds", "build" -> "build"; "owned", "own" -> "own"). */
export function verbLemma(word: string): string {
  let w = word.toLowerCase();
  if (IRREGULAR_LEMMA[w]) return IRREGULAR_LEMMA[w]!;
  if (/ied$|ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/ing$/.test(w) && w.length > 5) w = w.slice(0, -3);
  else if (/ed$/.test(w) && w.length > 4) w = w.slice(0, -2);
  else if (/es$/.test(w) && w.length > 4 && /(sh|ch|ss|x|z)es$/.test(w)) w = w.slice(0, -2);
  else if (/s$/.test(w) && !/ss$/.test(w) && w.length > 3) w = w.slice(0, -1);
  if (/([bdgmnpt])\1$/.test(w)) w = w.slice(0, -1);
  return w.replace(/e$/, "");
}

const STRONG_LEMMAS = new Set(STRONG_VERBS.map(verbLemma));
const WEAK_LEMMAS = new Set(WEAK_VERBS.map(verbLemma));
export const isStrongVerb = (w: string): boolean => !!w && STRONG_LEMMAS.has(verbLemma(w));
export const isWeakVerb = (w: string): boolean => !!w && WEAK_LEMMAS.has(verbLemma(w));
export const sameVerb = (a: string, b: string): boolean => !!a && !!b && verbLemma(a) === verbLemma(b);

const RESULT_RE = /\d|\b(?:reduc|cut|increas|improv|grew|grow|sav|lift|rais|lower|eliminat|decreas|doubl|tripl|halv|boost|shorten)\w*/i;

/**
 * Key phrases tacked on after the result ("...from 3 days to 2 hours for production services"): a phrase that starts in
 * the last 4 words of the bullet when a number or a result verb comes before it. A phrase must describe the work itself.
 */
export function tackedOnPhrases(text: string, phrases: readonly string[]): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#&/]+/g, " ").trim();
  const words = norm(text).split(" ").filter(Boolean);
  const out: string[] = [];
  for (const p of phrases) {
    const pw = norm(p).split(" ").filter(Boolean);
    if (pw.length === 0) continue;
    for (let i = words.length - pw.length; i >= 0; i--) {
      if (pw.every((w, k) => words[i + k] === w)) {
        if (i >= words.length - 4 - (pw.length - 1) && i > 0 && RESULT_RE.test(words.slice(0, i).join(" "))) out.push(p);
        break;
      }
    }
  }
  return out;
}

/** Common irregular past forms (regular ones end in -ed). */
const IRREGULAR_PAST = new Set(("built rebuilt led ran wrote rewrote drove grew made won took gave sold taught cut set kept held brought began chose " +
  "found oversaw spoke thought understood sought met shot bought fought caught upheld withheld undertook overcame became broke " +
  "spun spent lent sent split shut put hit read stood swore threw woke wound").split(" "));

/** Common action verbs in their base (present) form, to spot a present-tense opener on a past role. */
const BASE_VERBS = new Set(("build design develop lead manage create implement reduce improve deliver launch own run write ship migrate automate " +
  "analyze analyse coordinate provide maintain support drive partner define plan prepare present monitor test train mentor review " +
  "negotiate close sell grow increase cut decrease optimize optimise deploy integrate configure establish execute operate administer " +
  "assess evaluate document resolve troubleshoot collaborate communicate research conduct oversee handle process track report " +
  "forecast model rebuild refactor scale secure care teach precept educate").split(" "));

export type Tense = "past" | "present" | "unknown";

/** The tense of a bullet's opening verb, as far as a word list can tell. */
export function openerTense(text: string): Tense {
  const w = openingWord(text);
  if (!w) return "unknown";
  if (IRREGULAR_PAST.has(w) || (/ed$/.test(w) && w.length > 3)) return "past";
  if (BASE_VERBS.has(w) || (/s$/.test(w) && BASE_VERBS.has(w.replace(/e?s$/, ""))) || (/s$/.test(w) && BASE_VERBS.has(w.slice(0, -1)))) return "present";
  if (/ing$/.test(w)) return "present";
  return "unknown";
}

/** The first word of a bullet, lower-cased, without punctuation. */
export function openingWord(text: string): string {
  return (text.trim().match(/^[A-Za-z][A-Za-z-]*/)?.[0] ?? "").toLowerCase();
}
