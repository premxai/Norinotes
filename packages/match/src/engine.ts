/**
 * The engine scope (ENGINE_ATS, e.g. "greenhouse"): the job systems Norinote runs end to end, from collection to the
 * submitted form. While a scope is set, every fresh job of those systems is read and embedded (not only the ones whose
 * title fits someone's role), a person is matched against all of them in their places (ranked by how close the job is to
 * their career graph, then scored on evidence), and the lists show only those jobs. Jobs whose form Nori cannot fill (a
 * Greenhouse job whose posting lives on the company's own site, as an embedded form) are left out.
 */
import { and, inArray, jobs, sql } from "@norinote/db";
import type { SQL } from "drizzle-orm";

/** The engine's job systems from ENGINE_ATS (comma separated). Empty: every system, as before. */
export function readEngineAts(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** A form Nori can fill: for Greenhouse, the posting is on Greenhouse's own job board (not embedded on the company site). */
export function hostedFormSql(): SQL {
  return sql`(${jobs.atsType} <> 'greenhouse' OR ${jobs.applyUrl} ~* '^https?://(job-boards|boards)(\\.eu)?\\.greenhouse\\.io/')`;
}

/** Jobs inside the engine scope, or undefined (no condition) when no scope is set. */
export function engineJobSql(atsTypes: readonly string[] | null | undefined): SQL | undefined {
  if (!atsTypes?.length) return undefined;
  return and(inArray(jobs.atsType, [...atsTypes] as (typeof jobs.atsType._.data)[]), hostedFormSql());
}

export { isHostedForm } from "@norinote/shared";
