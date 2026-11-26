/**
 * Test fixtures for the apply decision (decision.ts), for tests in other packages: a job the model read, with a fit map
 * that puts it in one group for a person with no career points (no level gap, no function to compare).
 */
import { and, eq, jobSpecs, shortlist, type Db } from "@norinote/db";
import { SPEC_VERSION, type StoredJobSpec } from "./understand.js";

const must = (requirement: string, score: number, weight: number) => ({ requirement, mustHave: true, score, weight });

/** Fit maps per group (balanced). worth_a_shot also needs the job posted under 48 hours ago, else it is a stretch. */
export const DECISION_FIT_MAPS = {
  strong: [must("APIs", 0.9, 1)],
  worth_a_shot: [must("APIs", 0.9, 1), must("Go", 0.2, 0.3)],
  stretch: [must("APIs", 0.9, 0.4), must("Go", 0.2, 0.45)],
  hard_no: [must("APIs", 0.9, 1), must("Kubernetes", 0.1, 0.9)],
} as const;

/** Gives the job a model-read spec and sets the person's shortlist row's fit map so the decision groups it as `kind`. */
export async function placeInGroup(db: Db, userId: string, jobId: string, kind: keyof typeof DECISION_FIT_MAPS): Promise<void> {
  const spec: StoredJobSpec = {
    mustHaves: [], niceToHaves: [], skills: [], seniority: "mid", roleFamily: "backend engineering", yearsMin: null,
    location: { remote: "unknown", countries: [], cities: [] },
    citizenshipRequired: false, clearanceRequired: false, sponsorship: "unknown", responsibilities: [], requirementWeights: {},
  };
  await db.insert(jobSpecs).values({ jobId, version: SPEC_VERSION, spec, model: "test" }).onConflictDoNothing();
  await db.update(shortlist).set({ fitMap: [...DECISION_FIT_MAPS[kind]] }).where(and(eq(shortlist.userId, userId), eq(shortlist.jobId, jobId)));
}
