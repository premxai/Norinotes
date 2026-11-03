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
  "speciali[sz](?:e|ed|es|ing)", "demonstrated (?:strong |deep )?(?:proficiency|expertise|ability|knowledge)", "proficiency in", "proficient in",
  "strong knowledge of", "hands[- ]on experience", "expertise in", "expert in", "deep expertise", "mastery of", "honed", "harness\\w*", "champion\\w*", "empower\\w*", "streamlin\\w*", "revolutioniz\\w*", "next[- ]generation",
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
