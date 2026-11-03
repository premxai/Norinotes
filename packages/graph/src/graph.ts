import { and, asc, careerPoints, eq, type Db } from "@norinote/db";
import type { CareerPoint } from "@norinote/shared";
import { skillParents } from "./skills.js";
import { toCareerPoint } from "./store.js";
import { currentMonthIndex, monthIndex } from "./text.js";

export type SkillSummary = {
  skill: string;
  /** Years of dated work using it, overlapping periods counted once. 0 when it only appears in an undated skills list. */
  years: number;
  /** `YYYY-MM` of the most recent use; null when no point that names it has dates. */
  lastUsed: string | null;
  /** True when a current (open-ended) point uses it. */
  current: boolean;
  /** Ids of the points that name it. */
  points: string[];
  /** Broader groups, nearest first: Kubernetes -> Container Orchestration, DevOps. */
  parents: string[];
};

export type Graph = { points: CareerPoint[]; skills: SkillSummary[] };

const ymd = (m: number) => `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`;

/** Total months covered by a set of [start, end] month intervals, overlaps counted once. */
function unionMonths(intervals: [number, number][]): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = -Infinity, curEnd = -Infinity;
  for (const [s, e] of sorted) {
    if (s > curEnd) { if (curEnd > -Infinity) total += curEnd - curStart + 1; curStart = s; curEnd = e; }
    else curEnd = Math.max(curEnd, e);
  }
  if (curEnd > -Infinity) total += curEnd - curStart + 1;
  return total;
}

/** Skills with years, last use and the points behind them, from a set of points. Pure, so it is easy to test. */
export function summarizeSkills(points: CareerPoint[], now = new Date()): SkillSummary[] {
  const nowIdx = currentMonthIndex(now);
  const by = new Map<string, { name: string; intervals: [number, number][]; ids: string[]; last: number | null; current: boolean }>();
  for (const p of points) {
    const start = p.startDate ? monthIndex(p.startDate, "start") : null;
    const end = p.endDate ? monthIndex(p.endDate, "end") : start !== null ? nowIdx : null;
    // A licence's dates are when it was issued and expires, not time spent using its skills (an AWS certificate is not years of AWS).
    const interval: [number, number] | null = p.kind !== "certification" && start !== null && end !== null && end >= start ? [start, Math.min(end, nowIdx)] : null;
    for (const name of p.skills) {
      const k = name.toLowerCase();
      const e = by.get(k) ?? { name, intervals: [], ids: [], last: null, current: false };
      if (!e.ids.includes(p.id)) e.ids.push(p.id);
      if (interval) {
        e.intervals.push(interval);
        e.last = Math.max(e.last ?? -Infinity, interval[1]);
        if (!p.endDate) e.current = true;
      }
      by.set(k, e);
    }
  }
  return [...by.values()]
    .map((e): SkillSummary => ({
      skill: e.name,
      years: Math.round((unionMonths(e.intervals) / 12) * 10) / 10,
      lastUsed: e.last === null ? null : ymd(e.last),
      current: e.current,
      points: e.ids,
      parents: skillParents(e.name),
    }))
    .sort((a, b) => b.years - a.years || b.points.length - a.points.length || a.skill.localeCompare(b.skill));
}

/** The user's career points (newest first) and a skills summary for the graph view. */
export async function getGraph(db: Db, userId: string, now = new Date()): Promise<Graph> {
  const rows = await db.select().from(careerPoints).where(eq(careerPoints.userId, userId)).orderBy(asc(careerPoints.createdAt));
  const points = rows.map(toCareerPoint).sort((a, b) => (b.endDate ?? "9999").localeCompare(a.endDate ?? "9999") || (b.startDate ?? "").localeCompare(a.startDate ?? ""));
  return { points, skills: summarizeSkills(points, now) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deletes one of the user's points (its embedding goes with it). False when it was not theirs or does not exist. */
export async function deleteCareerPoint(db: Db, userId: string, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const gone = await db.delete(careerPoints).where(and(eq(careerPoints.id, id), eq(careerPoints.userId, userId))).returning({ id: careerPoints.id });
  return gone.length > 0;
}
