/**
 * Skill normalisation and finding skills in free text. The canonical skill table (names, synonyms, parents) lives in
 * @norinote/shared so graph and match use one copy; this module builds the lookups graph needs on top of it.
 */
import { SKILL_ENTRIES, type SkillEntry } from "@norinote/shared";

export { SKILL_ENTRIES };
export type { SkillEntry };


/** Canonical names that are ordinary English words or single letters: in prose they only match with this exact capitalisation. */
const AMBIGUOUS = new Set(["Go", "C", "R", "Express", "Spark", "Swift", "Rust", "Ruby", "Flask", "Excel", "Looker", "Testing", "Security", "Leadership"]);
const LIST_ONLY_NAMES = new Set(["Go", "C", "R"]);

const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "");

const BY_KEY = new Map<string, string>();
const BY_NAME = new Map<string, SkillEntry>();
for (const e of SKILL_ENTRIES) {
  BY_NAME.set(e.name, e);
  BY_KEY.set(key(e.name), e.name);
  for (const s of [...e.synonyms, ...e.listOnly]) if (!BY_KEY.has(key(s))) BY_KEY.set(key(s), e.name);
}
/** Parent groups are skills of their own where they are also canonical (LLMs, Machine Learning, Docker...). */
const PARENT_NAMES = new Set(SKILL_ENTRIES.flatMap((e) => e.parents));

/** The canonical name for a skill as written ("k8s" -> "Kubernetes", "JS" -> "JavaScript"), or null when unknown. */
export function canonicalSkill(raw: string): string | null {
  const k = key(raw);
  if (!k) return null;
  return BY_KEY.get(k) ?? null;
}

/**
 * Normalise a list of skills: known ones become canonical names, unknown ones are kept as written (trimmed), duplicates
 * are dropped case-insensitively, order is preserved.
 */
export function normalizeSkills(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const trimmed = raw.replace(/\s+/g, " ").trim();
    if (!trimmed || trimmed.length > 60) continue;
    const name = canonicalSkill(trimmed) ?? trimmed;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(name);
  }
  return out;
}

/** Broader groups a skill belongs to, nearest first and transitive: Kubernetes -> Container Orchestration, DevOps. */
export function skillParents(name: string): string[] {
  const out: string[] = [];
  const visit = (n: string) => {
    for (const p of BY_NAME.get(canonicalSkill(n) ?? n)?.parents ?? []) {
      if (!out.includes(p)) { out.push(p); visit(p); }
    }
  };
  visit(name);
  return out;
}

/** True when `skill` is `ancestor` or sits somewhere under it ("Kubernetes" under "DevOps"). */
export function isUnder(skill: string, ancestor: string): boolean {
  const a = canonicalSkill(ancestor) ?? ancestor;
  const s = canonicalSkill(skill) ?? skill;
  return s === a || skillParents(s).includes(a);
}

export function isKnownGroup(name: string): boolean {
  return PARENT_NAMES.has(name);
}

// ---- finding skills in free text ------------------------------------------------------------------------------------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const BOUNDARY_BEFORE = "(?<![A-Za-z0-9+#])";
const BOUNDARY_AFTER = "(?![A-Za-z0-9+#]|\\.[A-Za-z0-9])";

type Matcher = { re: RegExp; map: Map<string, string> };

function buildMatcher(caseSensitive: boolean): Matcher {
  const map = new Map<string, string>();
  for (const e of SKILL_ENTRIES) {
    const forms: string[] = [];
    if (!LIST_ONLY_NAMES.has(e.name)) forms.push(e.name);
    // Synonyms of ambiguous words stay case-sensitive too, except multi-word phrases which are safe.
    forms.push(...e.synonyms);
    for (const f of forms) {
      const ambiguousForm = AMBIGUOUS.has(e.name) && f === e.name;
      if (ambiguousForm !== caseSensitive) continue;
      if (f.length < 2) continue;
      map.set(caseSensitive ? f : f.toLowerCase(), e.name);
    }
  }
  const alternation = [...map.keys()].sort((a, b) => b.length - a.length).map((s) => escapeRe(s).replace(/ /g, "\\s+")).join("|");
  return { re: new RegExp(`${BOUNDARY_BEFORE}(?:${alternation})${BOUNDARY_AFTER}`, caseSensitive ? "g" : "gi"), map };
}

let insensitive: Matcher | null = null;
let sensitive: Matcher | null = null;
let listOnlyRe: { re: RegExp; map: Map<string, string> } | null = null;

function listOnlyMatcher() {
  if (listOnlyRe) return listOnlyRe;
  const map = new Map<string, string>();
  for (const e of SKILL_ENTRIES) {
    for (const s of e.listOnly) map.set(s, e.name);
    if (LIST_ONLY_NAMES.has(e.name)) map.set(e.name, e.name);
  }
  const alternation = [...map.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
  listOnlyRe = { re: new RegExp(`${BOUNDARY_BEFORE}(?:${alternation})${BOUNDARY_AFTER}`, "g"), map };
  return listOnlyRe;
}

/**
 * Skills mentioned in a piece of text, canonical, in order of first mention. Set `list: true` for a skills list
 * ("Python, Go, JS"), where short ambiguous tokens are accepted.
 */
export function findSkills(text: string, opts: { list?: boolean } = {}): string[] {
  const found: { name: string; at: number }[] = [];
  const scan = (m: Matcher, lookup: (hit: string) => string | undefined) => {
    m.re.lastIndex = 0;
    for (const hit of text.matchAll(m.re)) {
      const name = lookup(hit[0]);
      if (name) found.push({ name, at: hit.index ?? 0 });
    }
  };
  insensitive ??= buildMatcher(false);
  sensitive ??= buildMatcher(true);
  const ci = insensitive;
  const cs = sensitive;
  scan(ci, (h) => ci.map.get(h.toLowerCase().replace(/\s+/g, " ")));
  scan(cs, (h) => cs.map.get(h));
  if (opts.list) {
    const lo = listOnlyMatcher();
    scan(lo, (h) => lo.map.get(h));
  }
  found.sort((a, b) => a.at - b.at);
  return normalizeSkills(found.map((f) => f.name));
}
