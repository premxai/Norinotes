/**
 * Does this posting restrict who can apply to US citizens or people who can hold a government clearance?
 * Visa holders (a core audience) cannot take these roles, so the shortlist hides them.
 *
 * Ported from Nori (`packages/core/src/match/clearance.ts`). Works sentence by sentence: a sentence counts when it
 * states a restriction and does not negate it ("we do not require a clearance", "citizens of any country") or make it
 * optional ("TS/SCI preferred", "a plus"). Deliberately conservative: a bare mention of "clearance" or "citizen" is not
 * enough.
 */
export type ClearanceJob = {
  title: string;
  descriptionText?: string | null;
  /** Extra text to scan, for example the extracted must-haves. */
  extraText?: string[];
};

const US = String.raw`(?:us|u\s?s\s?a|united\s+states(?:\s+of\s+america)?|american)`;
// Words that turn a mention of US citizenship into a requirement.
const CUE = String.raw`(?:must|required?|requires?|requiring|requirement|necessary|mandatory|only|eligib\w+|able\s+to|ability\s+to|need|needs|needed|restricted|limited|obtain|maintain|hold|holds|possess|proof\s+of|verif\w+|prove|to\s+be\s+(?:an?\s+)?${US})`;

const CITIZEN_RE = new RegExp(String.raw`(?<!non[-\s])\b(?:${US}\s+citizen(?:s|ship)?|citizens?\s+of\s+the\s+${US})\b`, "i");
const US_PERSON_RE = new RegExp(String.raw`\b${US}\s+persons?\b`, "i");

type Pattern = { re: RegExp; kind: "citizenship" | "clearance"; needsCue?: boolean };

const POSITIVE: Pattern[] = [
  // US citizenship / "citizen of the United States", with a requirement cue in the same sentence.
  { re: CITIZEN_RE, kind: "citizenship", needsCue: true },
  // Clearances: named levels and qualified "clearance".
  { re: /\b(?:ts\s*\/\s*sci|ts-sci|tssci|top[\s-]secret)\b/i, kind: "clearance" },
  { re: /\b(?:secret|dod|doe|department\s+of\s+defense|security|government|federal|national\s+security|nato|public\s+trust|q|l)\s+(?:level\s+)?(?:security\s+)?clearances?\b/i, kind: "clearance" },
  { re: /\b(?:active|current|interim|valid)\s+(?:us\s+)?(?:clearance|secret|ts)\b/i, kind: "clearance" },
  { re: /\beligib\w+\s+(?:for|to\s+obtain|to\s+hold|to\s+get)\s+(?:an?\s+)?(?:\w+\s+){0,2}clearance\b/i, kind: "clearance" },
  { re: /\b(?:obtain|maintain|hold|possess)\s+(?:and\s+(?:maintain|hold)\s+)?(?:an?\s+)?(?:active\s+)?(?:us\s+)?(?:government\s+)?clearance\b/i, kind: "clearance" },
  { re: /\bpolygraph\b|\b(?:full[\s-]scope|ci|lifestyle)\s+poly\b/i, kind: "clearance" },
  // Export control / ITAR restrict the job to US persons.
  { re: /\bitar\b/i, kind: "citizenship" },
  { re: /\b22\s*c\.?f\.?r\.?\s*(?:§\s*)?120\b/i, kind: "citizenship" },
  { re: US_PERSON_RE, kind: "citizenship", needsCue: true },
];

const CUE_RE = new RegExp(String.raw`\b${CUE}\b`, "i");
// "US person" is only restrictive in an export-control sense.
const EXPORT_CONTEXT = /\b(?:export|itar|ear\b|22\s*cfr|defined\s+(?:by|in|under)|must|required|only|eligib\w+)/i;

const TRIGGER = String.raw`(?:citizen\w*|clearances?|polygraph|itar|us\s+persons?)`;
const NEGATIONS: RegExp[] = [
  // "we do not require a clearance", "does not necessarily need US citizenship"
  new RegExp(String.raw`\b(?:do|does|did|will|would|can|could)\s*(?:not|n'?t)\s+(?:\w+\s+){0,3}?(?:require|need|necessitate|demand)\b(?:\W+\w+){0,6}?\W+${TRIGGER}`, "i"),
  // "no clearance required", "without a security clearance", "no US citizenship needed"
  new RegExp(String.raw`\b(?:no|without)\W+(?:\w+\W+){0,3}?(?:clearances?|citizenship|polygraph)\b`, "i"),
  // "clearance is not required", "citizenship isn't needed"
  new RegExp(String.raw`\b(?:clearances?|citizenship|polygraph)\b(?:\W+\w+){0,3}?\W+(?:is|are)?\s*(?:not|n'?t)\s*(?:required|needed|necessary|mandatory)`, "i"),
  // "citizens of any country", "regardless of citizenship", "non-US citizens welcome"
  /\b(?:any|all)\s+(?:country|countries|nationality|nationalities)\b|\bregardless\s+of\s+(?:your\s+)?(?:citizenship|nationality|national\s+origin|immigration)\b|\bnon[-\s](?:us|u\s?s|american)\s+citizens?\b/i,
];

const OPTIONAL = /\b(?:preferred|a\s+plus|nice\s+to\s+have|desirable|bonus|beneficial|helpful|an?\s+asset|not\s+required\s+but|would\s+be\s+great)\b/i;

// Title-only signals ("Cleared Systems Engineer", "Software Engineer (TS/SCI)").
const TITLE_RE = /\b(?:ts\s*\/\s*sci|ts-sci|top[\s-]secret|cleared|polygraph|(?:secret|ts)\s+clearance|clearance\s+required)\b/i;

/** "U.S." -> "US", "D.o.D." -> "DoD", so the periods do not split sentences. */
function normalise(text: string): string {
  return text
    .replace(/\bu\.\s?s\.(?:\s?a\.)?/gi, "US")
    .replace(/\bd\.\s?o\.\s?d\.?/gi, "DoD")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, (m) => (m.includes("\n") ? "\n" : " "));
}

function sentences(text: string): string[] {
  return normalise(text).split(/(?<=[.!?])\s+|[\n\r•·;|]+/).map((s) => s.trim()).filter(Boolean);
}

/** Which kinds of restriction a single sentence states ("citizenship", "clearance"); empty when it states none. */
function sentenceKinds(s: string): Set<"citizenship" | "clearance"> {
  const kinds = new Set<"citizenship" | "clearance">();
  for (const p of POSITIVE) {
    if (!p.re.test(s)) continue;
    if (p.needsCue) {
      if (!CUE_RE.test(s)) continue;
      // "US person" outside an export-control sentence is just English ("US persons in the audience").
      if (p.re === US_PERSON_RE && !EXPORT_CONTEXT.test(s)) continue;
    }
    kinds.add(p.kind);
  }
  if (kinds.size === 0) return kinds;
  if (NEGATIONS.some((n) => n.test(s))) return new Set();
  if (OPTIONAL.test(s)) return new Set();
  return kinds;
}

export type Restrictions = {
  /** A sentence requires US citizenship or US-person status (export control). */
  citizenship: boolean;
  /** A sentence requires, or requires being able to obtain, a government clearance. */
  clearance: boolean;
  /** A sentence says outright that citizenship is not needed ("citizens of any country", "regardless of citizenship"), and none requires it. */
  citizenshipNegated: boolean;
  /** A sentence says outright that no clearance is needed, and none requires one. */
  clearanceNegated: boolean;
};

const CLEARANCE_WORDS = /clearances?|polygraph/i;
const CITIZEN_WORDS = /citizen|nationalit|nationals+origin|itar|uss+persons?/i;

/** Both kinds of restriction found in a posting, plus which of them the posting explicitly says do not apply. */
export function detectRestrictions(job: ClearanceJob): Restrictions {
  const found = { citizenship: false, clearance: false };
  const negated = { citizenship: false, clearance: false };
  if (TITLE_RE.test(job.title)) found.clearance = true;
  const parts = [job.descriptionText ?? "", ...(job.extraText ?? [])];
  for (const part of parts) {
    if (!part) continue;
    for (const s of sentences(part)) {
      for (const k of sentenceKinds(s)) found[k] = true;
      if (!NEGATIONS.some((n) => n.test(s))) continue;
      if (CLEARANCE_WORDS.test(s)) negated.clearance = true;
      if (CITIZEN_WORDS.test(s)) negated.citizenship = true;
    }
  }
  return { ...found, citizenshipNegated: negated.citizenship && !found.citizenship, clearanceNegated: negated.clearance && !found.clearance };
}

export function needsUsCitizenshipOrClearance(job: ClearanceJob): boolean {
  const r = detectRestrictions(job);
  return r.citizenship || r.clearance;
}
