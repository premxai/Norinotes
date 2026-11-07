import type { CareerPoint } from "@norinote/shared";
import type { SkillSummary } from "@norinote/graph";

/** The web's graph node and edge (apps/web/src/lib/types.ts). */
export type GraphNode = {
  id: string;
  type: string;
  label: string;
  props: Record<string, unknown>;
  startDate: string | null;
  endDate: string | null;
  /** Readable: "your resume", "a fact you added", "GitHub", "your website". Null for skills. */
  source: string | null;
  sourceQuote: string | null;
  /** Where the fact came from, structured: the resume line, the repo, the page. Null for skills. */
  origin: { kind: "resume" | "user" | "github" | "site"; ref: string | null; label: string | null } | null;
};
export type GraphEdge = { id: string; src: string; dst: string; type: string };

const NODE_TYPE: Record<string, string | null> = { role: "role", project: "project", achievement: "metric", education: "education", certification: "certification", skill: null };

const SOURCE_TEXT: Record<string, string> = { resume: "your resume", user: "a fact you added", github: "GitHub", site: "your website" };

const hostOf = (url: string | null | undefined) => {
  try { return url ? new URL(url).hostname.replace(/^www\./, "") : null; } catch { return null; }
};

/** Where a fact came from: the resume line it quotes, the GitHub repo, the page on the person's site. */
export function originOf(p: Pick<CareerPoint, "source" | "sourceRef" | "sourceQuote" | "title">): NonNullable<GraphNode["origin"]> {
  const kind = p.source ?? "resume";
  const ref = p.sourceRef ?? null;
  if (kind === "github") return { kind, ref, label: ref ? ref.replace(/^https?:\/\/github\.com\//, "") : p.title };
  if (kind === "site") return { kind, ref, label: hostOf(ref) };
  if (kind === "user") return { kind, ref: null, label: null };
  const quote = p.sourceQuote?.trim() ?? "";
  return { kind: "resume", ref: null, label: quote ? (quote.length > 120 ? `${quote.slice(0, 117).trimEnd()}...` : quote) : null };
}

/** Skill nodes are keyed by the lower-cased skill name, base64url-encoded so the id is safe in a URL path. */
export const skillNodeId = (name: string) => `skill_${Buffer.from(name.trim().toLowerCase()).toString("base64url")}`;
export function skillFromNodeId(id: string): string | null {
  if (!id.startsWith("skill_")) return null;
  const name = Buffer.from(id.slice(6), "base64url").toString("utf8");
  return name || null;
}

/**
 * Career points become nodes (a role, project, achievement as `metric`, education, certification), every distinct skill becomes a skill
 * node, and each point links to the skills it names. Skill-list points (the resume's "Skills" section) add no node of their
 * own: their skills are the skill nodes.
 */
export function buildGraphView(points: CareerPoint[], skills: SkillSummary[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const skillByKey = new Map(skills.map((s) => [s.skill.toLowerCase(), s]));
  const used = new Set<string>();

  for (const p of points) {
    const type = NODE_TYPE[p.kind];
    for (const s of p.skills) used.add(s.toLowerCase());
    if (!type) continue;
    nodes.push({
      id: p.id,
      type,
      label: p.org && p.kind === "role" ? `${p.title} at ${p.org}` : p.title,
      props: {
        title: p.title, ...(p.org ? { org: p.org } : {}), ...(p.text ? { statement: p.text } : {}), skills: p.skills,
        ...(Object.keys(p.scope).length ? { scope: p.scope } : {}),
      },
      startDate: p.startDate,
      endDate: p.endDate,
      source: SOURCE_TEXT[p.source ?? "resume"] ?? "your resume",
      sourceQuote: p.sourceQuote,
      origin: originOf(p),
    });
    for (const s of p.skills) edges.push({ id: `${p.id}>${skillNodeId(s)}`, src: p.id, dst: skillNodeId(s), type: "used" });
  }

  for (const key of used) {
    const s = skillByKey.get(key);
    const name = s?.skill ?? key;
    nodes.push({
      id: skillNodeId(name),
      type: "skill",
      label: name,
      props: { ...(s ? { years: s.years, current: s.current, ...(s.lastUsed ? { lastUsed: s.lastUsed } : {}), ...(s.parents.length ? { group: s.parents[0] } : {}) } : {}) },
      startDate: null,
      endDate: null,
      source: null,
      sourceQuote: null,
      origin: null,
    });
  }
  return { nodes, edges };
}
