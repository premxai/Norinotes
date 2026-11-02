/**
 * How career points are stored.
 *
 * - `career_points.source` is "resume" or "user" (a fact the user added). Resume points are replaced on every resume upload;
 *   user facts are never touched. Older rows kept the marker in `scope.source`, and rows from before any marker count as
 *   resume points when they carry a source quote; both forms are still read.
 * - `metrics.items` is the list of `{ value, unit, measures }` found in the point.
 * - Dates are `YYYY` or `YYYY-MM`; a missing end date on a dated point means it is current.
 */
import { and, careerPoints, eq, sql, type Db } from "@norinote/db";
import type { CareerPoint } from "@norinote/shared";
import type { DraftPoint } from "./heuristic.js";
import type { Metric } from "./text.js";

export type PointSource = "resume" | "user";
type Row = typeof careerPoints.$inferSelect;

export function pointSource(p: { source?: string | null; scope: Record<string, unknown>; sourceQuote: string | null }): PointSource {
  // A user marker in either place wins, so a user fact is never mistaken for a resume point.
  if (p.source === "user" || p.scope.source === "user") return "user";
  if (p.source === "resume" || p.scope.source === "resume") return "resume";
  return p.sourceQuote ? "resume" : "user";
}

export function metricsOf(p: { metrics: Record<string, unknown> }): Metric[] {
  const items = p.metrics.items;
  return Array.isArray(items) ? (items as Metric[]).filter((m) => m && typeof m.value === "number") : [];
}

export function toCareerPoint(r: Row): CareerPoint {
  return {
    id: r.id, kind: r.kind, title: r.title, org: r.org, startDate: r.startDate, endDate: r.endDate,
    text: r.text, skills: r.skills, scope: r.scope, metrics: r.metrics, sourceQuote: r.sourceQuote, source: r.source,
  };
}

export function toInsert(userId: string, d: DraftPoint, source: PointSource): typeof careerPoints.$inferInsert {
  return {
    userId, kind: d.kind, title: d.title, org: d.org, startDate: d.startDate, endDate: d.endDate, text: d.text,
    skills: d.skills, scope: d.scope, metrics: { items: d.metrics }, sourceQuote: d.sourceQuote, source,
  };
}

/**
 * SQL for "this row came from the resume", matching `pointSource`: the column says resume and no legacy `scope.source`
 * marker says user (so a user fact written the old way is never deleted by a resume upload).
 */
export const isResumeSourced = sql`(${careerPoints.source} = 'resume' and coalesce(${careerPoints.scope}->>'source', 'resume') <> 'user')`;

/** Replace the user's resume-sourced points with `drafts` in one transaction. User-added facts stay. */
export async function replaceResumePoints(db: Db, userId: string, drafts: DraftPoint[]): Promise<CareerPoint[]> {
  return db.transaction(async (tx) => {
    await tx.delete(careerPoints).where(and(eq(careerPoints.userId, userId), isResumeSourced));
    if (!drafts.length) return [];
    const rows = await tx.insert(careerPoints).values(drafts.map((d) => toInsert(userId, d, "resume"))).returning();
    return rows.map(toCareerPoint);
  });
}

export async function insertUserPoints(db: Db, userId: string, drafts: DraftPoint[]): Promise<CareerPoint[]> {
  if (!drafts.length) return [];
  const rows = await db.insert(careerPoints).values(drafts.map((d) => toInsert(userId, d, "user"))).returning();
  return rows.map(toCareerPoint);
}
