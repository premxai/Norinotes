import type { CareerPoint } from "@norinote/shared";
import { functionWords, recency } from "./select.js";

/**
 * How the summary names the person and the role they target. Never a raw title string with course codes, units or
 * parentheses ("Teaching Assistant, Data Structures (CS 112)"): a role noun the person truthfully is, or the field they
 * graduated in, and the target role family from the job title.
 */

const SENIORITY = /\b(senior|sr\.?|junior|jr\.?|staff|principal|lead|head of|associate|entry[- ]level|mid[- ]level|i{1,3}|iv|ll|\d)\b/gi;
const LOWER_KEEP = /^[A-Z0-9&/+#.-]{2,}$/;

const HEAD_NOUN = /\b(engineer|developer|manager|designer|analyst|scientist|nurse|executive|representative|specialist|director|consultant|administrator|architect|coordinator|technician|associate|accountant|researcher|writer|marketer|recruiter|lead|head|officer|strategist|advisor|planner|programmer|assistant|teacher|instructor|therapist|pharmacist|physician)s?\b/i;
const LEVEL = /\b(i{1,3}|iv|ll|l[1-5])\b/gi;

/** The part of a title that names the role: "OP Labs - Sr. Product Manager, Fintechs" -> "Sr. Product Manager"; "Director, Demand Generation" -> "Demand Generation Director". */
function roleSegment(title: string): string {
  const segs = title.replace(/\([^)]*\)/g, " ").split(/\s*(?:,|\||\s[-\u2013\u2014]\s|:)\s*/).map((x) => x.trim()).filter(Boolean);
  const i = Math.max(0, segs.findIndex((x) => HEAD_NOUN.test(x)));
  const seg = segs[i] ?? "";
  const bare = seg.replace(SENIORITY, " ").trim();
  if (/^(director|head|vp|manager|lead|chief)$/i.test(bare) && segs[i + 1]) return `${segs[i + 1]} ${seg}`;
  return seg;
}

/** "Registered Nurse, Telemetry Unit (Charge Nurse)" -> "Registered nurse"; "Software Engineer II" -> "Software engineer". */
export function cleanTitle(title: string): string {
  const cut = roleSegment(title).replace(LEVEL, " ");
  const words = cut.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  return words.map((w, i) => (LOWER_KEEP.test(w) ? w : i === 0 ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(" ");
}

/** The role family of a job title, without seniority or level: "Senior Frontend Software Engineer, Consumer" -> "frontend software engineer". */
export function roleFamily(jobTitle: string): string {
  const fam = cleanTitle(jobTitle).replace(SENIORITY, " ").replace(/\s+/g, " ").trim();
  return fam.split(" ").filter((w) => /[a-z0-9]/i.test(w)).map((w) => (LOWER_KEEP.test(w) ? w : w.toLowerCase())).join(" ");
}

/** The head noun of the role family ("engineer", "nurse", "analyst"), used to check that a summary names the target role. */
export function roleHead(jobTitle: string): string | null {
  const words = roleFamily(jobTitle).split(" ").filter(Boolean);
  return words.length ? words[words.length - 1]!.toLowerCase() : null;
}

const DEGREE = /^(?:b\.?\s?s\.?c?|b\.?\s?a\.?|b\.?\s?eng\.?|m\.?\s?s\.?c?|m\.?\s?a\.?|m\.?\s?eng\.?|ph\.?\s?d\.?|bachelor(?:'s)?(?: of (?:science|arts|engineering))?|master(?:'s)?(?: of (?:science|arts|engineering))?|associate(?:'s)?(?: degree)?)\s*(?:degree\s*)?(?:in|of)?\s+/i;

/** "B.S. Computer Science" -> "Computer science"; null when no field can be read. */
export function degreeField(title: string): string | null {
  const rest = title.replace(/\([^)]*\)/g, " ").split(",")[0]!.replace(DEGREE, "").trim();
  if (!rest || rest === title.trim() && !/\b(science|engineering|studies|nursing|finance|economics|design|marketing|business|mathematics|statistics|physics)\b/i.test(rest)) return null;
  return rest.charAt(0).toUpperCase() + rest.slice(1).toLowerCase();
}

/**
 * The role noun the summary opens with: the person's latest title in the target function (cleaned) when they have held a
 * non-intern role there; else "<field> graduate" from their degree; else their latest title, cleaned.
 */
export function roleNoun(points: readonly CareerPoint[], jobTitle: string | null): string {
  const roles = points.filter((p) => p.kind === "role").sort(recency);
  const fn = functionWords(jobTitle ?? "");
  const inFunction = roles.filter((r) => [...functionWords(r.title)].some((w) => fn.has(w)) && !/\b(intern|internship|trainee|apprentice)\b/i.test(r.title));
  if (inFunction[0]) return cleanTitle(inFunction[0].title);
  const edu = points.filter((p) => p.kind === "education").sort(recency)[0];
  const field = edu ? degreeField(edu.title) : null;
  if (field) return `${field} graduate`;
  return roles[0] ? cleanTitle(roles[0].title) : "Candidate";
}

/** Fields, degrees and duplicates that read badly as summary "skills" ("working with BSN, nursing and Finance"). */
const SUMMARY_SKILL_SKIP = /^(bsn|mba|phd|nursing|finance|marketing|sales|design|engineering|product management|stakeholder management|project management|program management|human resources|api|rest|cross-functional|registered nurse|account executive|charge nurse)$/i;

/** A field or degree rather than a skill ("Product Management", "BSN"): fine in a skills list, wrong as the object of a bullet. */
export const isGenericField = (term: string): boolean => SUMMARY_SKILL_SKIP.test(term.trim());

/** Up to `max` of the posting's skills for a summary: no fields or degrees, none already in the role noun, none inside another. */
export function summarySkills(terms: readonly string[], noun: string, max = 4): string[] {
  const out: string[] = [];
  const n = noun.toLowerCase();
  for (const t of terms) {
    const k = t.toLowerCase();
    if (SUMMARY_SKILL_SKIP.test(t) || n.includes(k)) continue;
    if (out.some((o) => o.toLowerCase().includes(k) || k.includes(o.toLowerCase()))) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** A bullet as one clean sentence for a summary: no parentheses, the first clause only. */
export function cleanStrength(text: string): string {
  return text.replace(/\s*\([^)]*\)/g, "").split(/;\s*/)[0]!.replace(/[.\s]+$/, "").replace(/\s+/g, " ").trim();
}
