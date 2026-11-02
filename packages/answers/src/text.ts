/** Text and vector helpers for matching form questions. Pure, no I/O. */

/** Lowercase letters and digits only, single spaces. Two questions that differ in punctuation or case are the same. */
export function normalizeQuestion(s: string): string {
  return s.toLowerCase().replace(/[’`']/g, "").replace(/[^\p{L}\p{N}+#]+/gu, " ").trim();
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

const STOP = new Set(("a an and the of to in on for with by at as or from is are be do does did you your we our will would can could this that these those it its i me my " +
  "please if any all have has had than then so such not no what which who how when where why").split(/\s+/));

/** Content words of a text, lowercased, lightly stemmed (plural s). */
export function contentTokens(s: string): string[] {
  return normalizeQuestion(s).split(" ").filter(Boolean).filter((t) => !STOP.has(t)).map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
}

const COUNTRY_CANON: [RegExp, string][] = [
  [/\b(?:the )?(?:united states(?: of america)?|u\.s\.a?\.?|usa)\b/gi, "US"],
  [/\b(?:the )?(?:united kingdom|u\.k\.|great britain)\b/gi, "UK"],
];

/**
 * What makes a question specific: numbers, acronyms, and names or tools that appear mid-sentence. Two questions that
 * embed close together but differ here ("experience with Kubernetes" and "experience with Docker", "3 years" and "5
 * years") are different questions, so a bank answer must not be reused across them whatever the vectors say.
 */
export function distinctiveTokens(text: string): Set<string> {
  let t = text;
  for (const [re, code] of COUNTRY_CANON) t = t.replace(re, code);
  const out = new Set<string>();
  for (const m of t.matchAll(/\d+(?:[.,]\d+)*/g)) out.add(`#${m[0].replace(/,/g, "")}`);
  const words = [...t.matchAll(/[A-Za-z][A-Za-z0-9+#.]*/g)].map((m) => ({ w: m[0].replace(/\.+$/, ""), i: m.index ?? 0 }));
  const alpha = words.filter((x) => x.w.length > 1);
  // A form that capitalises Every Word tells us nothing from capitals.
  const titleCased = alpha.length >= 4 && alpha.filter((x) => /^[A-Z]/.test(x.w)).length / alpha.length >= 0.6;
  for (const { w, i } of words) {
    const acronym = /^[A-Z][A-Z0-9+#]+$/.test(w) && w !== "EEO";
    const techy = /[a-z][A-Z]|[0-9+#]/.test(w.slice(1)) || /^[A-Z][a-z]+[A-Z]/.test(w);
    const capitalMid = !titleCased && i > 0 && /^[A-Z][a-z]/.test(w) && !/[.!?]\s*$/.test(t.slice(0, i)) && w !== "I";
    if (acronym || techy || capitalMid) out.add(w.toLowerCase());
  }
  return out;
}

/** True when two questions carry the same specifics (see distinctiveTokens). */
export function sameSpecifics(a: string, b: string): boolean {
  const x = distinctiveTokens(a), y = distinctiveTokens(b);
  if (x.size !== y.size) return false;
  for (const t of x) if (!y.has(t)) return false;
  return true;
}

const YES = /^\s*(yes|y|true)\b/i;
const NO = /^\s*(no|n|false)\b/i;
export const isYes = (s: string): boolean => YES.test(s);
export const isNo = (s: string): boolean => NO.test(s);

/**
 * The option that `value` means, or null. Never invents one: exact (ignoring case and punctuation), then yes/no by
 * leading word, then one text containing the other, then word overlap of at least 60%.
 */
export function matchOption(value: string, options: readonly string[]): string | null {
  const v = normalizeQuestion(value);
  if (!v || options.length === 0) return null;
  const norm = options.map((o) => ({ o, n: normalizeQuestion(o) }));
  const exact = norm.find((x) => x.n === v);
  if (exact) return exact.o;

  const yes = isYes(value), no = isNo(value);
  if (yes !== no) {
    const hits = options.filter((o) => (yes ? isYes(o) : isNo(o)));
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) return hits.find((o) => normalizeQuestion(o).split(" ").length <= 2) ?? hits[0]!;
  }

  const contains = norm.filter((x) => x.n.length >= 3 && (x.n.includes(v) || v.includes(x.n)) && Math.min(x.n.length, v.length) >= 3);
  if (contains.length === 1) return contains[0]!.o;
  if (contains.length > 1) return contains.sort((a, b) => Math.abs(a.n.length - v.length) - Math.abs(b.n.length - v.length))[0]!.o;

  const vt = new Set(contentTokens(value));
  if (vt.size === 0) return null;
  let best: { o: string; score: number } | null = null;
  for (const x of norm) {
    const ot = new Set(contentTokens(x.o));
    if (ot.size === 0) continue;
    let shared = 0;
    for (const t of vt) if (ot.has(t)) shared++;
    const score = shared / (vt.size + ot.size - shared);
    if (score >= 0.6 && (!best || score > best.score)) best = { o: x.o, score };
  }
  return best?.o ?? null;
}

/** Multiselect answers travel as one string of option labels joined by "; ". */
export const MULTI_SEPARATOR = "; ";
