import { AiUnavailableError, BudgetExceededError } from "@norinote/ai";
import { and, careerPoints, eq, profiles, sql } from "@norinote/db";
import { buildCareerPoints, getGraph, type Contact } from "@norinote/graph";
import { JOBS } from "@norinote/queue";
import { ensureProfile } from "./auth/session.js";
import { buildGraphView } from "./graph-view.js";
import { HttpError } from "./http.js";
import { enqueueSoft, type Ctx } from "./types.js";

export type IngestResult = {
  nodesCreated: number;
  edgesCreated: number;
  usedLLM: boolean;
  /** Set when the AI service could not be used and the result is the basic version (see AI_NOTES); null otherwise. */
  note: string | null;
  profilePatch: Partial<{ fullName: string; email: string; phone: string; linkedin: string; github: string; location: string; website: string }>;
  nodes: ReturnType<typeof buildGraphView>["nodes"];
};

/** What we tell the user when the AI service was unavailable. The data was saved either way. */
export const AI_NOTES = {
  basicParsing: "Read with basic parsing; detailed reading will run when the AI service is available.",
  unembedded: "Saved; matching will be refined when the AI service is available.",
  fact: "Saved as you wrote it; detailed reading will run when the AI service is available.",
} as const;

/** Contact details found in the resume that the profile does not have yet. */
function missingContact(current: Record<string, string>, found: Contact) {
  const fields = { name: found.fullName, email: found.email, phone: found.phone, linkedin: found.linkedin, github: found.github, website: found.website, city: found.city, state: found.state, country: found.country };
  return Object.fromEntries(Object.entries(fields).filter((e): e is [string, string] => !!e[1] && !current[e[0]]));
}

/**
 * Resume text to career points: builds and embeds the graph, keeps the text, fills contact details the profile lacks, and
 * queues a shortlist rebuild. Returns what the onboarding wizard shows ("found 12 things"). A failing AI service never fails
 * this: the points are read with the basic parser, saved without embeddings, and `note` says so.
 */
export async function ingestResume(ctx: Ctx, userId: string, text: string, contact: Contact): Promise<IngestResult> {
  const { db } = ctx;
  let built;
  try {
    built = await buildCareerPoints(db, userId, text);
  } catch (err) {
    if (err instanceof BudgetExceededError) throw new HttpError(429, "Today's AI allowance is used up. Try again tomorrow.");
    // buildCareerPoints already falls back; this is the last line of defence against a provider error escaping it.
    if (err instanceof AiUnavailableError) throw new HttpError(503, "The AI service is unavailable right now. Try again in a few minutes.");
    throw err;
  }
  if (built.source === "none" || built.points.length === 0) {
    throw new HttpError(422, "We could not find any experience in that resume. Check that it has your roles and dates, or paste the text instead.");
  }

  const profile = await ensureProfile(db, userId);
  const stored = profile.contact as Record<string, string>;
  const fill = missingContact(stored, contact);
  await db.update(profiles).set({
    resumeText: text.slice(0, 200_000),
    contact: { ...stored, ...fill },
    ...(!profile.location && contact.location ? { location: contact.location } : {}),
    updatedAt: ctx.now(),
  }).where(eq(profiles.userId, userId));

  await enqueueSoft(ctx, JOBS.matchUser, { userId, reason: "profile" });

  const graph = await getGraph(db, userId, ctx.now());
  const view = buildGraphView(graph.points, graph.skills);
  const newIds = new Set(built.points.map((p) => p.id));
  const newSkills = new Set(built.points.flatMap((p) => p.skills.map((s) => s.toLowerCase())));
  const nodes = view.nodes.filter((n) => newIds.has(n.id) || (n.type === "skill" && newSkills.has(n.label.toLowerCase())));
  const patch: IngestResult["profilePatch"] = {};
  for (const [k, v] of Object.entries({
    fullName: contact.fullName, email: contact.email, phone: contact.phone, linkedin: contact.linkedin, github: contact.github, location: contact.location, website: contact.website,
  })) if (v) (patch as Record<string, string>)[k] = v;
  return {
    nodesCreated: nodes.length,
    edgesCreated: view.edges.filter((e) => newIds.has(e.src)).length,
    usedLLM: built.source === "model",
    note: built.source === "heuristic" && built.aiUnavailable ? AI_NOTES.basicParsing : built.aiUnavailable ? AI_NOTES.unembedded : null,
    profilePatch: patch,
    nodes,
  };
}

/** True when the user has at least one career point. */
export async function hasCareerPoints(ctx: Ctx, userId: string): Promise<boolean> {
  const [row] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(careerPoints).where(and(eq(careerPoints.userId, userId)));
  return (row?.n ?? 0) > 0;
}
