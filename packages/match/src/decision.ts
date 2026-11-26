/**
 * The apply decision: whether Nori sends an application for a job on its own, asks the person first, or leaves the job
 * alone. It replaces the plain fit threshold for anything that sends (autopilot and "Apply for me" batches). Every input is
 * stored (shortlist row, job spec, career points, applications), so it costs no model call.
 *
 * 1. Hard no's (`skip`): the gates (location and remote scope, authorisation and sponsorship, citizenship and clearance,
 *    a large years gap), a seniority gap of two or more levels either way, a central must-have the person clearly lacks,
 *    a company they skip, and a company they applied to in the last 60 days.
 * 2. Three groups for the rest:
 *    - `strong`: every must-have evidenced, the job inside their level band, their own function, a posting the model read;
 *    - `worth_a_shot`: most must-haves evidenced (by weight), a title in or next to their function, posted under 48 hours ago;
 *    - `stretch`: everything else that passed the hard no's.
 * 3. The person's aggressiveness (cautious, balanced or wide) says which groups are sent without asking and the weekly pace;
 *    a group that is not sent on its own is `ask` (a one-tap Apply/Skip prompt).
 * 4. Sends stay within the week's remaining pace, one per company, spread across kinds of jobs; sendable jobs left over
 *    are `later`.
 */
import { and, applications, asc, companies, eq, gte, inArray, jobSpecs, jobs, profiles, shortlist, sql, type Db } from "@norinote/db";
import { companyKey, isSkippedCompany, readSkipCompanies } from "@norinote/shared";
import { jobLevelBand, levelFromYears, matchTargetOf, titleAlignment } from "./alignment.js";
import { coverageOf, relevantYears, type FitMapItem } from "./fit.js";
import { checkGates } from "./gates.js";
import { loadMatchProfile, type MatchProfile } from "./profile.js";
import { roleFamilyOf } from "./roles.js";
import type { StoredJobSpec } from "./understand.js";

export const AGGRESSIVENESS = ["cautious", "balanced", "wide"] as const;
export type Aggressiveness = (typeof AGGRESSIVENESS)[number];
export const DEFAULT_AGGRESSIVENESS: Aggressiveness = "balanced";

export const APPLY_GROUPS = ["strong", "worth_a_shot", "stretch"] as const;
export type ApplyGroup = (typeof APPLY_GROUPS)[number];

export type ApplyPolicy = {
  /** Groups sent without asking. */
  autoSend: readonly ApplyGroup[];
  /** Share of the must-have weight that must be evidenced for "worth a shot". */
  worthAShotMustShare: number;
  /** Applications Nori sends on its own per rolling 7 days. */
  weeklyPace: number;
};

/**
 * Cautious sends only strong fits; balanced adds worth-a-shot; wide asks less evidence of worth-a-shot. The paces sit where
 * per-application reply rates hold up (Huntr Q3 2026: about 8% at 11 to 20 a week, falling past that).
 */
export const APPLY_POLICIES: Record<Aggressiveness, ApplyPolicy> = {
  cautious: { autoSend: ["strong"], worthAShotMustShare: 0.75, weeklyPace: 10 },
  balanced: { autoSend: ["strong", "worth_a_shot"], worthAShotMustShare: 0.6, weeklyPace: 20 },
  wide: { autoSend: ["strong", "worth_a_shot"], worthAShotMustShare: 0.5, weeklyPace: 30 },
};

/** A must-have counts as evidenced at this coverage, and as clearly lacking below `LACKING_COVERAGE`. */
export const EVIDENCED_COVERAGE = 0.6;
export const LACKING_COVERAGE = 0.35;
/** A must-have this central or more that the person clearly lacks is a hard no. */
export const CENTRAL_MUST_HAVE = 0.5;
/** Levels between the job's band and the person's level that make it a hard no. */
export const HARD_LEVEL_GAP = 2;
/** Worth-a-shot jobs must be younger than this. */
export const WORTH_A_SHOT_MAX_AGE_HOURS = 48;
/** Alignment at or above this is the person's own function (the same family and specialty; see alignment.ts). */
export const OWN_FUNCTION = 0.85;
/** Alignment at or above this is a reasonable title: their function or a neighbouring one. */
export const REASONABLE_TITLE = 0.5;
/** A company the person applied to within this many days gets no other application. */
export const RECENT_COMPANY_DAYS = 60;

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** `preferences.nori.aggressiveness`, else balanced. */
export function readAggressiveness(preferences: unknown): Aggressiveness {
  const v = rec(rec(preferences).nori).aggressiveness;
  return (AGGRESSIVENESS as readonly unknown[]).includes(v) ? (v as Aggressiveness) : DEFAULT_AGGRESSIVENESS;
}

// ---- one job --------------------------------------------------------------------------------------------------------

export type JobForDecision = {
  jobId: string;
  title: string;
  location: string | null;
  remote: boolean;
  companyId: string;
  companyName: string | null;
  /** Posted, else first seen. */
  postedAt: Date | null;
  fit: number;
  fitMap: ReadonlyArray<Pick<FitMapItem, "requirement" | "mustHave" | "score"> & { weight?: number }>;
  spec: StoredJobSpec;
  /** True when no model read the posting (heuristic spec). */
  heuristicSpec: boolean;
};

export type JobAssessment = {
  /** Why the job is a hard no, or null. */
  hardNo: string | null;
  group: ApplyGroup | null;
  /** Plain reasons for the group, best first. */
  reasons: string[];
};

/** Groups one job for one person (no counters: pace, company history and aggressiveness come in `decideApplies`). */
export function assessJob(job: JobForDecision, profile: MatchProfile, policy: ApplyPolicy, now: Date): JobAssessment {
  const gate = checkGates(job.spec, profile, { title: job.title, location: job.location, remote: job.remote }, { now });
  if (!gate.ok) return { hardNo: gate.reasons[0]!, group: null, reasons: gate.reasons };

  const years = relevantYears(profile.points, job.title, now, profile.experienceYears);
  const band = jobLevelBand(job.title, job.spec);
  const level = years == null ? null : levelFromYears(years);
  if (level != null && band[0] - level >= HARD_LEVEL_GAP) return { hardNo: "Two or more levels above your experience", group: null, reasons: ["Two or more levels above your experience"] };
  if (level != null && level - band[1] >= HARD_LEVEL_GAP) return { hardNo: "Two or more levels below your experience", group: null, reasons: ["Two or more levels below your experience"] };

  const musts = job.fitMap.filter((e) => e.mustHave).map((e) => ({ text: e.requirement, weight: e.weight ?? 1, cov: coverageOf(e.score) }));
  const central = musts.filter((m) => m.weight >= CENTRAL_MUST_HAVE && m.cov < LACKING_COVERAGE).sort((a, b) => b.weight - a.weight)[0];
  if (central) return { hardNo: `Missing a must-have: ${central.text}`, group: null, reasons: [`Missing a must-have: ${central.text}`] };

  const mustWeight = musts.reduce((n, m) => n + m.weight, 0);
  const evidencedShare = mustWeight > 0 ? musts.filter((m) => m.cov >= EVIDENCED_COVERAGE).reduce((n, m) => n + m.weight, 0) / mustWeight : null;
  const alignment = titleAlignment(job.title, matchTargetOf(profile, now));
  const inBand = level == null || (level >= band[0] - 0.25 && level <= band[1] + 0.5);
  const ownFunction = alignment == null || alignment >= OWN_FUNCTION;
  const ageHours = job.postedAt ? (now.getTime() - job.postedAt.getTime()) / 3_600_000 : Infinity;

  if (!job.heuristicSpec && evidencedShare === 1 && inBand && ownFunction) {
    return { hardNo: null, group: "strong", reasons: ["Every must-have shows in your history", "At your level, in your kind of role"] };
  }
  const reasonable = alignment == null || alignment >= REASONABLE_TITLE;
  const enough = evidencedShare == null ? job.heuristicSpec : evidencedShare >= policy.worthAShotMustShare;
  if (enough && reasonable && ageHours < WORTH_A_SHOT_MAX_AGE_HOURS) {
    return {
      hardNo: null, group: "worth_a_shot",
      reasons: [evidencedShare == null ? "The posting lists no must-haves Nori could check" : `${Math.round(evidencedShare * 100)}% of the must-haves show in your history`, "Posted in the last 2 days"],
    };
  }
  const why = !reasonable ? "A different kind of role from yours"
    : !enough ? "Several must-haves don't show in your history"
    : !inBand ? "A level away from your experience"
    : ageHours >= WORTH_A_SHOT_MAX_AGE_HOURS ? "Posted more than 2 days ago"
    : "Nori isn't sure about this one";
  return { hardNo: null, group: "stretch", reasons: [why] };
}

// ---- one person -----------------------------------------------------------------------------------------------------

export type ApplyAction = "send" | "later" | "ask" | "skip";

export type ApplyDecision = {
  jobId: string;
  group: ApplyGroup | null;
  /**
   * send: Nori may apply now without asking. later: Nori would send it, but this week's pace or today's variety holds it.
   * ask: show the person a one-tap Apply/Skip. skip: a hard no; never sent, never asked.
   */
  action: ApplyAction;
  reasons: string[];
  fit: number;
};

export type ApplyDecisions = {
  aggressiveness: Aggressiveness;
  policy: ApplyPolicy;
  /** Applications sent (approved) in the last 7 days, and how many more Nori may send on its own this week. */
  weekUsed: number;
  weekLeft: number;
  /** Sends first (in the order to send them), then later, ask, skip. */
  decisions: ApplyDecision[];
};

export type DecideOptions = {
  now: Date;
  /** Only these jobs (each must be on the person's shortlist). Default: every `new` row on it. */
  jobIds?: readonly string[];
  /** At most this many sends (for example what is left of today's cap). Default: the week's remaining pace. */
  maxSends?: number;
};

/**
 * The single decision autopilot and batches call: for each job on the person's shortlist (or `jobIds`), whether Nori
 * sends it now, holds it for later, asks the person, or skips it. Sends respect the weekly pace (counted from approved
 * applications in the last 7 days), `maxSends`, one per company, and are spread across kinds of jobs (round robin over role
 * families, best fit first in each). The caller still applies the daily cap and creates the applications.
 */
export async function decideApplies(db: Db, userId: string, opts: DecideOptions): Promise<ApplyDecisions> {
  const { now } = opts;
  const [prefs] = await db.select({ preferences: profiles.preferences }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const aggressiveness = readAggressiveness(prefs?.preferences);
  const policy = APPLY_POLICIES[aggressiveness];
  const skip = new Set(readSkipCompanies(prefs?.preferences).map(companyKey));

  const weekSince = new Date(now.getTime() - 7 * 86_400_000);
  const [week] = await db.select({ n: sql<number>`count(*)::int` }).from(applications)
    .where(and(eq(applications.userId, userId), gte(applications.approvedAt, weekSince)));
  const weekUsed = week?.n ?? 0;
  const weekLeft = Math.max(0, policy.weeklyPace - weekUsed);

  const rows = await db
    .select({
      jobId: jobs.id, title: jobs.title, location: jobs.location, remote: jobs.remote, companyId: jobs.companyId, companyName: companies.name,
      postedAt: sql<string | null>`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt})`.mapWith((v) => (v == null ? null : new Date(v as string))),
      fit: shortlist.fit, fitMap: shortlist.fitMap,
    })
    .from(shortlist)
    .innerJoin(jobs, eq(jobs.id, shortlist.jobId))
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(eq(shortlist.userId, userId), eq(shortlist.status, "new"), opts.jobIds ? inArray(shortlist.jobId, [...opts.jobIds]) : undefined));
  if (rows.length === 0) return { aggressiveness, policy, weekUsed, weekLeft, decisions: [] };

  const specRows = await db.select({ jobId: jobSpecs.jobId, spec: jobSpecs.spec, model: jobSpecs.model }).from(jobSpecs)
    .where(inArray(jobSpecs.jobId, rows.map((r) => r.jobId))).orderBy(asc(jobSpecs.version));
  const specs = new Map(specRows.map((s) => [s.jobId, { spec: s.spec as StoredJobSpec, heuristic: s.model === "heuristic" }]));

  const recentSince = new Date(now.getTime() - RECENT_COMPANY_DAYS * 86_400_000);
  const recent = await db.select({ companyId: jobs.companyId, jobId: jobs.id }).from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.userId, userId), gte(applications.createdAt, recentSince), sql`${applications.status} <> 'failed'`));
  const recentCompanies = new Set(recent.map((r) => r.companyId));

  const profile = await loadMatchProfile(db, userId, now);
  const sendable: Array<ApplyDecision & { companyId: string; family: string }> = [];
  const rest: ApplyDecision[] = [];
  for (const r of rows) {
    const s = specs.get(r.jobId);
    if (!s) { rest.push({ jobId: r.jobId, group: null, action: "ask", reasons: ["Nori hasn't read this posting yet"], fit: r.fit }); continue; }
    if (isSkippedCompany(skip, r.companyName)) { rest.push({ jobId: r.jobId, group: null, action: "skip", reasons: ["A company you skip"], fit: r.fit }); continue; }
    if (recentCompanies.has(r.companyId)) { rest.push({ jobId: r.jobId, group: null, action: "skip", reasons: [`You applied to this company in the last ${RECENT_COMPANY_DAYS} days`], fit: r.fit }); continue; }
    const a = assessJob({ ...r, fitMap: r.fitMap as JobForDecision["fitMap"], spec: s.spec, heuristicSpec: s.heuristic }, profile, policy, now);
    if (!a.group) { rest.push({ jobId: r.jobId, group: null, action: "skip", reasons: a.reasons, fit: r.fit }); continue; }
    if (policy.autoSend.includes(a.group)) sendable.push({ jobId: r.jobId, group: a.group, action: "send", reasons: a.reasons, fit: r.fit, companyId: r.companyId, family: kindOf(r.title) });
    else rest.push({ jobId: r.jobId, group: a.group, action: "ask", reasons: a.reasons, fit: r.fit });
  }

  const sends = spreadSends(sendable, Math.min(weekLeft, opts.maxSends ?? weekLeft));
  const chosen = new Set(sends.map((d) => d.jobId));
  const held = sendable.filter((d) => !chosen.has(d.jobId)).map(({ companyId: _c, family: _f, ...d }) => ({ ...d, action: "later" as const }));
  const order: Record<ApplyAction, number> = { send: 0, later: 1, ask: 2, skip: 3 };
  const byFit = (a: ApplyDecision, b: ApplyDecision) => order[a.action] - order[b.action] || b.fit - a.fit;
  return {
    aggressiveness, policy, weekUsed, weekLeft,
    decisions: [...sends.map(({ companyId: _c, family: _f, ...d }) => d), ...[...held, ...rest].sort(byFit)],
  };
}

/** The kind of job for variety: role family plus its subfamily or specialty (backend and frontend are different kinds). */
function kindOf(title: string): string {
  const c = roleFamilyOf(title);
  return `${c.family}:${c.subfamily ?? c.specialty ?? ""}`;
}

/** Strong before worth-a-shot; within that, a round robin over role families (best fit first in each), one job per company. */
function spreadSends<T extends ApplyDecision & { companyId: string; family: string }>(items: readonly T[], max: number): T[] {
  if (max <= 0) return [];
  const out: T[] = [];
  const companiesTaken = new Set<string>();
  for (const group of ["strong", "worth_a_shot"] as const) {
    const families = new Map<string, T[]>();
    for (const d of [...items].filter((d) => d.group === group).sort((a, b) => b.fit - a.fit)) families.set(d.family, [...(families.get(d.family) ?? []), d]);
    const queues = [...families.values()];
    while (out.length < max && queues.some((q) => q.length > 0)) {
      for (const q of queues) {
        if (out.length >= max) break;
        let next = q.shift();
        while (next && companiesTaken.has(next.companyId)) next = q.shift();
        if (!next) continue;
        companiesTaken.add(next.companyId);
        out.push(next);
      }
    }
  }
  return out;
}
