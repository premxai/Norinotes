/** Small text helpers shared by selection, validation and ATS checks. Pure, no I/O. */

export const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Groups of names for the same thing. The first entry is the canonical one. */
const ALIASES: string[][] = [
  ["javascript", "js", "ecmascript"],
  ["typescript", "ts"],
  ["kubernetes", "k8s"],
  ["postgresql", "postgres", "psql"],
  ["node.js", "nodejs", "node js"],
  ["react", "react.js", "reactjs"],
  ["vue", "vue.js", "vuejs"],
  ["next.js", "nextjs"],
  ["golang"],
  ["amazon web services", "aws"],
  ["google cloud platform", "gcp", "google cloud"],
  ["machine learning", "ml"],
  ["continuous integration", "ci/cd", "ci"],
  ["rest", "restful", "rest api", "rest apis"],
  ["mongodb", "mongo"],
  ["c++", "cpp"],
  ["c#", "csharp"],
];

const aliasIndex = new Map<string, string[]>();
for (const group of ALIASES) for (const name of group) aliasIndex.set(name, group);

/** Every name a skill goes by, including itself. */
export function aliasesOf(skill: string): string[] {
  const n = norm(skill);
  return aliasIndex.get(n) ?? [n];
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

/** True when the text mentions the skill or any alias of it. */
export function mentionsSkill(text: string, skill: string): boolean {
  if (!text) return false;
  return aliasesOf(skill).some((a) => containsTerm(text, a));
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
