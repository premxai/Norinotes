/** Small text helpers shared by selection, validation and ATS checks. Pure, no I/O. */
import { ALIAS_GROUPS, aliasGroupOf, scrubFalseFriends, type AliasGroup } from "./aliases.js";

export const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every name a skill goes by (lower-cased), including itself. The groups live in aliases.ts. */
export function aliasesOf(skill: string): string[] {
  const g = aliasGroupOf(skill);
  return g ? g.names.map(norm) : [norm(skill)];
}

const reCache = new Map<string, RegExp>();

/** Whole-term, case-insensitive match that understands C++, C#, Node.js, .NET and trailing punctuation. */
export function containsTerm(text: string, term: string): boolean {
  const t = norm(term);
  if (!t) return false;
  let re = reCache.get(t);
  if (!re) {
    const body = escapeRe(t).replace(/\s+/g, "[\\s-]+");
    re = new RegExp(`(?<![a-z0-9+#.])${body}(?![a-z0-9+#]|\\.[a-z0-9])`, "i");
    reCache.set(t, re);
  }
  return re.test(text);
}

const exactCache = new Map<string, RegExp>();

/** Whole-term, case-sensitive match for short names that are also words or letters (Go, R, ED, Epic). */
export function containsExact(text: string, term: string): boolean {
  let re = exactCache.get(term);
  if (!re) {
    re = new RegExp(`(?<![A-Za-z0-9+#.&/])${escapeRe(term.trim())}(?![A-Za-z0-9+#&/]|\\.[A-Za-z0-9])`);
    exactCache.set(term, re);
  }
  return re.test(text);
}

/** True when the text names this exact spelling, honouring the table's case-sensitive names. */
export function mentionsName(text: string, name: string): boolean {
  const g = aliasGroupOf(name);
  const exact = g?.exact.find((e) => norm(e) === norm(name));
  return exact ? containsExact(text, exact) : containsTerm(text, name);
}

/** True when the text mentions the skill or any alias of it. */
export function mentionsSkill(raw: string, skill: string): boolean {
  if (!raw) return false;
  const text = scrubFalseFriends(raw);
  const g = aliasGroupOf(skill);
  if (!g) return containsTerm(text, skill);
  return g.names.some((n) => (g.exact.includes(n) ? containsExact(text, n) : containsTerm(text, n)));
}

let scanners: { ci: RegExp; cs: RegExp | null; lookup: Map<string, AliasGroup> } | null = null;

function buildScanners() {
  const lookup = new Map<string, AliasGroup>();
  const ci: string[] = [];
  const cs: string[] = [];
  for (const g of ALIAS_GROUPS) {
    for (const n of g.names) {
      if (g.exact.includes(n)) { cs.push(n); lookup.set(n, g); } else { ci.push(norm(n)); lookup.set(norm(n), g); }
    }
  }
  const alt = (xs: string[]) => [...new Set(xs)].sort((a, b) => b.length - a.length).map((x) => escapeRe(x).replace(/\s+/g, "[\\s-]+")).join("|");
  return {
    ci: new RegExp(`(?<![a-z0-9+#.])(?:${alt(ci)})(?![a-z0-9+#]|\\.[a-z0-9])`, "gi"),
    cs: cs.length ? new RegExp(`(?<![A-Za-z0-9+#.&/])(?:${alt(cs)})(?![A-Za-z0-9+#&/]|\\.[A-Za-z0-9])`, "g") : null,
    lookup,
  };
}

export type FoundTerm = { key: string; display: string; as: string; index: number };

/** Every alias-table term in a text, first mention of each, in order of appearance. */
export function findTerms(raw: string): FoundTerm[] {
  if (!raw) return [];
  const text = scrubFalseFriends(raw);
  scanners ??= buildScanners();
  const hits: FoundTerm[] = [];
  for (const m of text.matchAll(scanners.ci)) {
    const g = scanners.lookup.get(norm(m[0]).replace(/[\s-]+/g, " ")) ?? scanners.lookup.get(norm(m[0]));
    if (g) hits.push({ key: g.key, display: g.display, as: m[0], index: m.index ?? 0 });
  }
  if (scanners.cs) for (const m of text.matchAll(scanners.cs)) {
    const g = scanners.lookup.get(m[0]);
    if (g) hits.push({ key: g.key, display: g.display, as: m[0], index: m.index ?? 0 });
  }
  hits.sort((a, b) => a.index - b.index || b.as.length - a.as.length);
  const seen = new Set<string>();
  return hits.filter((h) => (seen.has(h.key) ? false : (seen.add(h.key), true)));
}

/** How many times a term (any of its names) appears in a text; overlapping names ("REST APIs" and "REST") count once. */
export function countTerm(text: string, term: string): number {
  const g = aliasGroupOf(term);
  const names = g ? g.names : [term];
  const spans: [number, number][] = [];
  for (const name of names) {
    const cs = g?.exact.includes(name);
    const body = escapeRe(cs ? name : norm(name)).replace(/\s+/g, "[\\s-]+");
    const re = cs
      ? new RegExp(`(?<![A-Za-z0-9+#.&/])${body}(?![A-Za-z0-9+#&/]|\\.[A-Za-z0-9])`, "g")
      : new RegExp(`(?<![a-z0-9+#.])${body}(?![a-z0-9+#]|\\.[a-z0-9])`, "gi");
    for (const m of text.matchAll(re)) spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let n = 0, end = -1;
  for (const [s, e] of spans) if (s >= end) { n++; end = e; }
  return n;
}

export const sameSkill = (a: string, b: string): boolean => {
  const na = norm(a);
  return na === norm(b) || aliasesOf(a).includes(norm(b));
};

export const wordCount = (s: string): number => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** All digit runs in a string ("2.5M", "40%" -> "2.5", "40"; "2,000" -> "2000"). */
export function numbersIn(s: string): string[] {
  return (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ""));
}

/** Lowercased word-like tokens (keeps C++, C#, Node.js style names whole). */
export function tokensOf(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.&'-]*/gu) ?? []).map((t) => t.replace(/[.'-]+$/, ""));
}

/** Join ["a","b","c"] as "a, b and c". */
export function joinList(items: string[], conj = "and"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${conj} ${items[items.length - 1]}`;
}

/** Unique values by normalised text, first spelling wins. */
export function uniq(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of items) {
    const k = norm(i);
    if (k && !seen.has(k)) { seen.add(k); out.push(i.trim()); }
  }
  return out;
}

/** Terms a rewrite must never introduce unless the source already uses them. Common tools, languages and platforms. */
export const COMMON_TECH_TERMS: string[] = [
  "typescript", "javascript", "python", "java", "kotlin", "swift", "rust", "golang", "c++", "c#", "ruby", "php", "scala", "elixir",
  "react", "vue", "angular", "svelte", "next.js", "node.js", "express", "django", "flask", "fastapi", "rails", "spring", ".net",
  "postgresql", "mysql", "mongodb", "redis", "kafka", "rabbitmq", "elasticsearch", "graphql", "grpc", "dynamodb", "cassandra", "sqlite",
  "docker", "kubernetes", "terraform", "ansible", "helm", "aws", "gcp", "azure", "lambda", "snowflake", "bigquery", "spark", "hadoop",
  "airflow", "dbt", "tableau", "looker", "power bi", "pandas", "numpy", "pytorch", "tensorflow", "scikit-learn", "langchain", "llm", "llms",
  "jenkins", "github actions", "circleci", "gitlab", "datadog", "grafana", "prometheus", "sentry", "linux", "bash", "figma", "sql", "nosql",
  "salesforce", "react native", "flutter", "android", "ios", "unity", "microservices", "ci/cd", "machine learning", "deep learning",
  "kubeflow", "mlflow", "openai", "nginx", "webpack", "jest", "cypress", "playwright", "selenium", "oauth", "websockets", "tailwind",
];

/** Title and seniority words. A rewrite may not claim one the source does not. */
export const TITLE_WORDS = /\b(senior|sr|junior|jr|lead|principal|staff|director|vp|vice president|head of|manager|cto|ceo|coo|chief|founder|co-founder|architect|intern)\b/i;
