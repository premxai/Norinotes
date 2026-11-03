/**
 * Content checks that keep a resume from saying the same thing twice or showing lines with nothing in them: repeated
 * facts (a number with the words around it), generated filler lines, skill strings that are really category headings,
 * and degrees listed as skills. Pure functions, no I/O.
 */

import { aliasGroupOf } from "./aliases.js";

const STOP = new Set(("a an the and or of for to in on at by with from into over per via as is are was were be been this that these those " +
  "its their his her our my your than then also more most less up down out about across within while after before during").split(" "));

const words = (s: string): string[] => (s.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []).map((w) => w.replace(/'s$/, ""));
const stem = (w: string) => w.replace(/(ies|es|s|ed|ing)$/, "");

export type Fact = { num: string; near: Set<string> };

/**
 * The numbers in a text that state a result or a size, each with the content words within 3 words around it ("reduced
 * falls by 28%" -> 28 + {reduc, fall}). Years and bare single digits ("Angular 1", "Level II", "2 PMs") are not facts.
 */
export function factsIn(text: string): Fact[] {
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  const out: Fact[] = [];
  tokens.forEach((t, i) => {
    const m = /\d+(?:[.,]\d+)*/.exec(t);
    if (!m) return;
    const value = m[0].replace(/,/g, "");
    const unit = /[%$kmx+]|ms\b/i.test(t);
    if (/^(19|20)\d{2}$/.test(value) && !unit) return;
    if (Number(value) < 10 && !unit) return;
    const near = new Set<string>();
    for (let j = Math.max(0, i - 3); j <= Math.min(tokens.length - 1, i + 3); j++) {
      if (j === i) continue;
      for (const w of words(tokens[j]!)) if (w.length >= 3 && !STOP.has(w)) near.add(stem(w));
    }
    out.push({ num: m[0].replace(/,/g, ""), near });
  });
  return out;
}

/** True when two texts state the same fact: the same number with at least one shared content word next to it. */
export function sharesFact(a: string, b: string): boolean {
  const fb = factsIn(b);
  return factsIn(a).some((x) => fb.some((y) => y.num === x.num && [...x.near].some((w) => y.near.has(w))));
}

const GENERIC = new Set(("provided provide providing support supported supporting worked work working served serve assisted assist helped help " +
  "responsible duties role position performed various tasks general team member staff employee job").split(" "));

/**
 * A line that says nothing beyond the role's own title and organisation ("Provided nursing assistant support at
 * Lakeshore Regional Hospital"): fewer than two content words once the title, organisation and generic verbs are removed.
 * Typically written by a parser for a role the resume listed without bullets.
 */
export function isFillerLine(line: string, title: string, org: string | null): boolean {
  const known = new Set([...words(title), ...words(org ?? "")].map(stem));
  const content = words(line).filter((w) => w.length >= 3 && !STOP.has(w) && !GENERIC.has(w) && !known.has(stem(w)));
  return content.length < 2 && !/\d/.test(line);
}

const CATEGORY_NOUN = /\b(tools|technologies|technology|frameworks|libraries|skills|systems|languages|platforms|methods|methodologies|practices|concepts|other|stack|software|competencies|areas)\b/i;

/** A category heading parsed as a skill ("Build and Test Tools", "Frontend Frameworks and Libraries", "Patient Care Skills"). */
export function isCategoryLabel(s: string): boolean {
  const t = s.trim();
  if (/\bskills$/i.test(t)) return true;
  return /\s(?:and|&)\s/i.test(t) && CATEGORY_NOUN.test(t);
}

const DEGREE = /^(?:bsn|msn|mba|phd|ph\.?d\.?|md|jd|b\.?\s?s\.?c?|b\.?\s?a\.?|m\.?\s?s\.?c?|m\.?\s?a\.?|b\.?eng|m\.?eng|bachelor'?s?(?: degree)?|master'?s?(?: degree)?|associate'?s? degree)$/i;

/** A degree rather than a skill ("BSN", "MBA", "B.S."). */
export const isDegree = (s: string): boolean => DEGREE.test(s.trim());

/** Lower-case names that are spelled that way on purpose. */
const LOWER_BRANDS = new Set(["pandas", "dbt", "scikit-learn", "pytest", "npm", "yarn", "numpy", "matplotlib", "seaborn"]);

/**
 * How a skill is shown: as written, except an all-lower-case name takes the alias table's spelling ("ios" -> "iOS") or a
 * capital ("nursing" -> "Nursing").
 */
export function displaySkill(s: string): string {
  const t = s.trim();
  if (t !== t.toLowerCase() || LOWER_BRANDS.has(t) || !/^[a-z]/.test(t)) return t;
  const g = aliasGroupOf(t);
  if (g && g.display !== g.display.toLowerCase() && g.names.some((n) => n.toLowerCase() === t)) {
    const same = g.names.find((n) => n.toLowerCase() === t && n !== t);
    return same ?? (g.display.toLowerCase() === t ? g.display : t.charAt(0).toUpperCase() + t.slice(1));
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}
