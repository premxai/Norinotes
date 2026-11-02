/**
 * Canonical skill map for matching: lower-cased keys, aliases, parent groups and skill relations. The skill table itself
 * (names, synonyms, parents) lives in @norinote/shared and is the same one graph uses, so skills the graph writes into
 * `career_points.skills` resolve to the same keys here. Callers may also pass their own `SkillMap`.
 */
import { SKILL_ENTRIES, SPECIFIC_PARENTS, parseSkillTable, type SkillEntry } from "@norinote/shared";

export { SPECIFIC_PARENTS, parseSkillTable };
export type { SkillEntry };

/** Lower-cased canonical keys. Unknown skills are their own key. */
export type SkillMap = {
  /** alias (lower-cased, whitespace collapsed) -> canonical key */
  aliases: Map<string, string>;
  /** canonical key -> display name */
  display: Map<string, string>;
  /** canonical key -> parent keys (broader groups), nearest first */
  parents: Map<string, string[]>;
  /** One regex over every alias that is safe to find inside prose. */
  scan: RegExp | null;
  scanLookup: Map<string, string>;
};

const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Canonical names that are ordinary English words or single letters: never found inside prose, only by exact name. */
const PROSE_UNSAFE = new Set(["go", "c", "r", "express", "spark", "swift", "rust", "ruby", "flask", "excel", "looker", "testing", "security", "leadership"]);

/** Groups so broad that sharing one says little (two programming languages, two cloud platforms). */
const BROAD_GROUPS = new Set(["programming languages", "web development", "devops", "software engineering", "management", "databases", "cloud platforms", "data analysis", "data engineering", "mobile development", "artificial intelligence", "design", "marketing", "finance", "communication"]);

export function buildSkillMap(entries: readonly SkillEntry[], specific: Record<string, string[]> = {}): SkillMap {
  const aliases = new Map<string, string>();
  const display = new Map<string, string>();
  const parents = new Map<string, string[]>();
  for (const e of entries) {
    const k = key(e.name);
    display.set(k, e.name);
    aliases.set(k, k);
    parents.set(k, [...(specific[k] ?? []), ...e.parents.map(key)]);
  }
  for (const e of entries) {
    const k = key(e.name);
    for (const s of e.synonyms) if (!aliases.has(key(s))) aliases.set(key(s), k);
  }
  const scanLookup = new Map<string, string>();
  for (const e of entries) {
    const k = key(e.name);
    for (const f of [e.name, ...e.synonyms]) {
      if (f.length >= 2 && !PROSE_UNSAFE.has(key(f))) scanLookup.set(key(f), k);
    }
  }
  const alternation = [...scanLookup.keys()].sort((a, b) => b.length - a.length).map((s) => escapeRe(s).replace(/ /g, "\\s+")).join("|");
  const scan = alternation ? new RegExp(`(?<![a-z0-9+#])(?:${alternation})(?![a-z0-9+#]|\\.[a-z0-9])`, "gi") : null;
  return { aliases, display, parents, scan, scanLookup };
}

export const DEFAULT_SKILL_MAP: SkillMap = buildSkillMap(SKILL_ENTRIES, SPECIFIC_PARENTS);

/** Canonical key for a skill as written ("k8s" -> "kubernetes"). Unknown skills keep their own lower-cased name. */
export function canonicalSkill(raw: string, map: SkillMap = DEFAULT_SKILL_MAP): string {
  const k = key(raw);
  return map.aliases.get(k) ?? k;
}

/** Canonical keys, de-duplicated, order kept, blanks and absurdly long strings dropped. */
export function canonicalSkills(list: readonly string[], map: SkillMap = DEFAULT_SKILL_MAP): string[] {
  const out: string[] = [];
  for (const raw of list) {
    if (!raw || raw.length > 60) continue;
    const k = canonicalSkill(raw, map);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

export function skillDisplayName(k: string, map: SkillMap = DEFAULT_SKILL_MAP): string {
  return map.display.get(k) ?? k;
}

/** Canonical skills mentioned in free text, in order of first mention. */
export function findSkillsInText(text: string, map: SkillMap = DEFAULT_SKILL_MAP): string[] {
  if (!map.scan || !text) return [];
  const found: string[] = [];
  for (const m of text.matchAll(map.scan)) {
    const k = map.scanLookup.get(m[0].toLowerCase().replace(/\s+/g, " "));
    if (k && !found.includes(k)) found.push(k);
  }
  return found;
}

function ancestors(k: string, map: SkillMap): string[] {
  const out: string[] = [];
  const visit = (n: string) => {
    for (const p of map.parents.get(n) ?? []) if (!out.includes(p)) { out.push(p); visit(p); }
  };
  visit(k);
  return out;
}

/**
 * How well does having skill `have` cover a requirement for `want`? 1 same skill; 0.75 `have` is a specific kind of
 * `want` (PostgreSQL for SQL); 0.5 siblings under one specific group (MySQL for PostgreSQL), 0.25 under a very broad one (Python for Java); 0.4 `have` is the broader group of
 * `want` (JavaScript for React); otherwise 0.
 */
export function skillRelation(want: string, have: string, map: SkillMap = DEFAULT_SKILL_MAP): number {
  if (want === have) return 1;
  const wantUp = ancestors(want, map);
  const haveUp = ancestors(have, map);
  if (haveUp.includes(want)) return 0.75;
  if (wantUp.includes(have)) return 0.4;
  const wantDirect = map.parents.get(want) ?? [];
  const haveDirect = map.parents.get(have) ?? [];
  const shared = wantDirect.filter((p) => haveDirect.includes(p));
  if (shared.some((p) => !BROAD_GROUPS.has(p))) return 0.5;
  if (shared.length > 0) return 0.25;
  return 0;
}

/** Best relation between one wanted skill and any of the skills a career point lists. */
export function bestRelation(want: string, haves: readonly string[], map: SkillMap = DEFAULT_SKILL_MAP): number {
  let best = 0;
  for (const h of haves) {
    const r = skillRelation(want, h, map);
    if (r > best) best = r;
    if (best === 1) break;
  }
  return best;
}
