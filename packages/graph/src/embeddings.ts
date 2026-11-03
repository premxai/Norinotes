import { createHash } from "node:crypto";
import { careerPointEmbeddings, careerPoints, and, eq, inArray, sql, type Db } from "@norinote/db";
import { embed, embeddingModel } from "@norinote/ai";
import { metricsOf } from "./store.js";
import { currentMonthIndex, monthIndex } from "./text.js";

type Row = typeof careerPoints.$inferSelect;

/** The text that is embedded for a point: what a job spec would be compared against. */
export function embeddingText(p: Pick<Row, "title" | "org" | "text" | "skills">): string {
  return [p.title, p.org ?? "", p.text, p.skills.join(", ")].filter(Boolean).join("\n");
}

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** The embedding model plus a hash of the embedded text: the old combined form of `model`, from before `content_hash` existed. */
export const embeddingTag = (p: Pick<Row, "title" | "org" | "text" | "skills">) => `${embeddingModel()}#${hashOf(embeddingText(p))}`;

/** True when the stored embedding still matches the point: same text hash and model (or the old `model#hash` form). */
function isFresh(p: Row, stored: { model: string | null; contentHash: string | null }): boolean {
  if (stored.model === null) return false;
  if (stored.contentHash !== null) return stored.contentHash === hashOf(embeddingText(p)) && stored.model === embeddingModel();
  return stored.model === embeddingTag(p);
}

const BATCH = 64;

/** Embeds a user's career points (all of them, or `ids`), skipping points whose content has not changed. */
export async function embedCareerPoints(db: Db, userId: string, ids?: string[]): Promise<{ embedded: number; skipped: number }> {
  if (ids && ids.length === 0) return { embedded: 0, skipped: 0 };
  const rows = await db
    .select({ point: careerPoints, model: careerPointEmbeddings.model, contentHash: careerPointEmbeddings.contentHash })
    .from(careerPoints)
    .leftJoin(careerPointEmbeddings, eq(careerPointEmbeddings.careerPointId, careerPoints.id))
    .where(and(eq(careerPoints.userId, userId), ids ? inArray(careerPoints.id, ids) : undefined));
  const stale = rows.filter((r) => !isFresh(r.point, r));
  for (let i = 0; i < stale.length; i += BATCH) {
    const batch = stale.slice(i, i + BATCH);
    const vectors = await embed(batch.map((r) => embeddingText(r.point)), { userId, db });
    await db.insert(careerPointEmbeddings)
      .values(batch.map((r, k) => ({ careerPointId: r.point.id, userId, embedding: vectors[k]!, model: embeddingModel(), contentHash: hashOf(embeddingText(r.point)) })))
      .onConflictDoUpdate({
        target: careerPointEmbeddings.careerPointId,
        set: { embedding: sql`excluded.embedding`, model: sql`excluded.model`, contentHash: sql`excluded.content_hash`, createdAt: sql`now()` },
      });
  }
  return { embedded: stale.length, skipped: rows.length - stale.length };
}

// ---- profile embedding ----------------------------------------------------------------------------------------------

const KIND_WEIGHT: Record<Row["kind"], number> = { role: 1, project: 0.9, achievement: 0.9, education: 0.4, certification: 0.4, skill: 0.5 };
/** Only this many of the heaviest points go into the profile vector, so one long career does not wash out the recent work. */
const TOP_POINTS = 12;
const HALF_LIFE_YEARS = 4;

/**
 * How much a point counts toward the profile: kind, recency (half-life of four years, undated points count as middling),
 * substance (length of text, up to a paragraph) and scope (team size, users, budget, ownership, numbers).
 */
export function pointWeight(p: Pick<Row, "kind" | "startDate" | "endDate" | "text" | "scope" | "metrics" | "skills">, now = new Date()): number {
  let recency = 0.5;
  if (p.startDate || p.endDate) {
    const end = p.endDate ? monthIndex(p.endDate, "end") : currentMonthIndex(now);
    const yearsAgo = end === null ? 0 : Math.max(0, (currentMonthIndex(now) - end) / 12);
    recency = Math.max(0.1, 0.5 ** (yearsAgo / HALF_LIFE_YEARS));
  }
  const substance = 0.4 + 0.6 * Math.min(1, p.text.length / 300);
  const scopeKeys = ["teamSize", "users", "budget", "ownership"].filter((k) => p.scope[k] !== undefined && p.scope[k] !== null).length;
  const scope = 1 + 0.12 * scopeKeys + 0.06 * Math.min(3, metricsOf(p).length) + 0.02 * Math.min(5, p.skills.length);
  return KIND_WEIGHT[p.kind] * recency * substance * scope;
}

/**
 * The vector a user is matched with: a weighted mean of the embeddings of their most recent and most substantial points,
 * scaled to unit length. Null when the user has no embedded points.
 */
export async function profileEmbedding(db: Db, userId: string, now = new Date()): Promise<number[] | null> {
  const rows = await db
    .select({ point: careerPoints, vector: careerPointEmbeddings.embedding })
    .from(careerPoints)
    .innerJoin(careerPointEmbeddings, eq(careerPointEmbeddings.careerPointId, careerPoints.id))
    .where(eq(careerPoints.userId, userId));
  const weighted = rows
    .map((r) => ({ w: pointWeight(r.point, now), v: r.vector }))
    .sort((a, b) => b.w - a.w)
    .slice(0, TOP_POINTS);
  const total = weighted.reduce((s, x) => s + x.w, 0);
  if (!weighted.length || total <= 0) return null;
  const dims = weighted[0]!.v.length;
  const mean = new Array<number>(dims).fill(0);
  for (const { w, v } of weighted) for (let i = 0; i < dims; i++) mean[i]! += (v[i] ?? 0) * (w / total);
  const norm = Math.hypot(...mean);
  return norm > 0 ? mean.map((x) => x / norm) : mean;
}
