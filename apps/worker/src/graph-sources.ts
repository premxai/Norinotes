/**
 * Reading a source the person named for their career graph (`graph_sources`): their public GitHub repos, or their own
 * website. Only what they named is read: never a search for the person by name, and a LinkedIn URL is only kept, never
 * fetched. Each read replaces that source's earlier facts (`career_points.graph_source_id`).
 */
import { AiUnavailableError, BudgetExceededError } from "@norinote/ai";
import { and, careerPoints, eq, graphSources, type Db } from "@norinote/db";
import { draftsFromText, embedCareerPoints, normalizeSkills, type DraftPoint } from "@norinote/graph";
import { USER_AGENT, htmlToText, safeFetch, type HostLookup } from "@norinote/ingest";

export type SourceReadDeps = { fetch?: typeof fetch; lookup?: HostLookup; now?: () => Date };
export type SourceReadResult = { userId: string; status: "done" | "failed"; factsAdded: number; error?: string };

const GITHUB_API = "https://api.github.com";
const MAX_REPOS = 30;
const MAX_SITE_BYTES = 600_000;
const TIMEOUT_MS = 15_000;

type Repo = {
  name: string; description: string | null; language: string | null; topics?: string[]; html_url: string;
  fork: boolean; archived: boolean; created_at?: string; pushed_at?: string;
};

const month = (iso: string | undefined) => (iso && /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : null);

/** A repo worth a card: the person's own (not a fork), not archived, and saying something (a description, a language or topics). */
export function repoDrafts(repos: Repo[], now: Date): DraftPoint[] {
  const recent = now.getTime() - 180 * 86_400_000;
  return repos
    .filter((r) => !r.fork && !r.archived && (r.description || r.language || r.topics?.length))
    .slice(0, MAX_REPOS)
    .map((r): DraftPoint => {
      const pushed = r.pushed_at ? Date.parse(r.pushed_at) : NaN;
      const text = (r.description ?? "").trim().slice(0, 500);
      return {
        kind: "project", title: r.name.slice(0, 200), org: null,
        startDate: month(r.created_at),
        // Pushed in the last six months: still going. Otherwise it ended at its last push.
        endDate: Number.isFinite(pushed) && pushed >= recent ? null : month(r.pushed_at),
        text, skills: normalizeSkills([r.language ?? "", ...(r.topics ?? [])].filter(Boolean)), scope: {}, metrics: [],
        // The person's own words on GitHub, so the card quotes them.
        sourceQuote: text || null,
      };
    });
}

async function getWithTimeout(doFetch: typeof fetch, url: string, init: RequestInit = {}): Promise<Response> {
  return doFetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": USER_AGENT, ...(init.headers ?? {}) } });
}

async function readGithub(username: string, deps: SourceReadDeps): Promise<{ drafts: DraftPoint[]; refs: string[] }> {
  const doFetch = deps.fetch ?? fetch;
  const res = await getWithTimeout(doFetch, `${GITHUB_API}/users/${encodeURIComponent(username)}/repos?sort=pushed&per_page=${MAX_REPOS}&type=owner`, {
    headers: { accept: "application/vnd.github+json" },
  });
  if (res.status === 404) throw new Error(`There is no GitHub account called ${username}.`);
  if (res.status === 403 || res.status === 429) throw new Error("GitHub is limiting requests right now. Try again in an hour.");
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
  const repos = (await res.json()) as Repo[];
  if (!Array.isArray(repos)) throw new Error("GitHub sent something unexpected.");
  const usable = repos.filter((r) => !r.fork && !r.archived && (r.description || r.language || r.topics?.length)).slice(0, MAX_REPOS);
  return { drafts: repoDrafts(usable, (deps.now ?? (() => new Date()))()), refs: usable.map((r) => r.html_url) };
}

/** robots.txt allows `path` for every agent (a missing or unreadable robots.txt allows it). */
export function robotsAllows(robots: string, path: string): boolean {
  let applies = false;
  const rules: string[] = [];
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, key, value] = m as unknown as [string, string, string];
    if (/^user-agent$/i.test(key)) applies = value.trim() === "*" || /norinote/i.test(value);
    else if (applies && /^disallow$/i.test(key) && value.trim()) rules.push(value.trim());
  }
  return !rules.some((r) => path.startsWith(r));
}

async function readSite(url: string, deps: SourceReadDeps): Promise<string> {
  const doFetch = deps.fetch ?? fetch;
  const u = new URL(url);
  const robots = await safeFetch(`${u.origin}/robots.txt`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": USER_AGENT } }, { fetch: doFetch, lookup: deps.lookup })
    .then(async (r) => (r.ok ? r.text() : ""))
    .catch(() => "");
  if (!robotsAllows(robots, u.pathname || "/")) throw new Error("That site's robots.txt asks not to be read.");
  const res = await safeFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain" } }, { fetch: doFetch, lookup: deps.lookup });
  if (!res.ok) throw new Error(`The site answered ${res.status}.`);
  const type = res.headers.get("content-type") ?? "";
  if (type && !/text\/(html|plain)|application\/xhtml/.test(type)) throw new Error("That link is not a web page.");
  const raw = (await res.text()).slice(0, MAX_SITE_BYTES);
  const text = /html/i.test(type) || /<html|<body|<p[\s>]/i.test(raw) ? htmlToText(raw) : raw;
  if (text.replace(/\s+/g, " ").trim().length < 40) throw new Error("There was too little text on that page to read.");
  return text;
}

/** Replaces the source's facts with `drafts`; github facts point at their repo, site facts at the page. */
async function replaceSourcePoints(db: Db, userId: string, sourceId: string, kind: "github" | "site", drafts: DraftPoint[], refs: (string | null)[]): Promise<string[]> {
  return db.transaction(async (tx) => {
    await tx.delete(careerPoints).where(and(eq(careerPoints.userId, userId), eq(careerPoints.graphSourceId, sourceId)));
    if (!drafts.length) return [];
    const rows = await tx.insert(careerPoints).values(drafts.map((d, i) => ({
      userId, kind: d.kind, title: d.title, org: d.org, startDate: d.startDate, endDate: d.endDate, text: d.text,
      skills: d.skills, scope: d.scope, metrics: { items: d.metrics }, sourceQuote: d.sourceQuote,
      source: kind, sourceRef: refs[i] ?? refs[0] ?? null, graphSourceId: sourceId,
    }))).returning({ id: careerPoints.id });
    return rows.map((r) => r.id);
  });
}

/**
 * Reads one source and stores its facts. Never throws for a source that cannot be read: the source is marked failed with
 * a message the person can act on. Returns null when the source no longer exists.
 */
export async function readGraphSource(db: Db, sourceId: string, deps: SourceReadDeps = {}): Promise<SourceReadResult | null> {
  const now = deps.now ?? (() => new Date());
  const [src] = await db.select().from(graphSources).where(eq(graphSources.id, sourceId)).limit(1);
  if (!src) return null;
  if (src.kind === "linkedin") {
    // Kept so the person's link is on file; LinkedIn is never fetched.
    await db.update(graphSources).set({ status: "done", error: null, lastReadAt: now() }).where(eq(graphSources.id, src.id));
    return { userId: src.userId, status: "done", factsAdded: 0 };
  }
  await db.update(graphSources).set({ status: "reading", error: null }).where(eq(graphSources.id, src.id));
  try {
    let drafts: DraftPoint[];
    let refs: (string | null)[];
    if (src.kind === "github") ({ drafts, refs } = await readGithub(src.value, deps));
    else {
      const text = await readSite(src.value, deps);
      try {
        drafts = await draftsFromText(db, src.userId, text);
      } catch (err) {
        if (err instanceof BudgetExceededError) throw new Error("Today's AI allowance is used up. Nori reads the site again tomorrow, or use Refresh.");
        if (err instanceof AiUnavailableError) throw new Error("The AI service is unavailable, so the site could not be read. Try Refresh in a few minutes.");
        throw err;
      }
      refs = [src.value];
    }
    const ids = await replaceSourcePoints(db, src.userId, src.id, src.kind, drafts, refs);
    // Embedding can wait for the next run when the AI service is down; the facts are saved either way.
    if (ids.length) await embedCareerPoints(db, src.userId, ids).catch(() => undefined);
    await db.update(graphSources).set({ status: "done", error: null, factsAdded: ids.length, lastReadAt: now() }).where(eq(graphSources.id, src.id));
    return { userId: src.userId, status: "done", factsAdded: ids.length };
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    await db.update(graphSources).set({ status: "failed", error, lastReadAt: now() }).where(eq(graphSources.id, src.id));
    return { userId: src.userId, status: "failed", factsAdded: 0, error };
  }
}
