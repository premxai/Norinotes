import path from "node:path";
import type { applications, jobs, resumes, runEvents } from "@norinote/db";
import type { JobSpec } from "@norinote/shared";
import { iso } from "./http.js";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// ---- jobs -------------------------------------------------------------------------------------------------------------

export type JobRow = Omit<typeof jobs.$inferSelect, "descriptionText"> & { descriptionText: string };

export function toJob(j: JobRow, companyName: string | null, spec?: JobSpec | null) {
  return {
    id: j.id,
    companyId: j.companyId,
    companyName: companyName ?? "",
    atsType: j.atsType,
    externalId: j.externalId,
    title: j.title,
    location: j.location,
    remote: j.remote,
    descriptionText: j.descriptionText,
    applyUrl: j.applyUrl,
    postedAt: iso(j.postedAt),
    firstSeenAt: j.firstSeenAt.toISOString(),
    lastSeenAt: j.lastSeenAt.toISOString(),
    closedAt: iso(j.closedAt),
    ...(spec !== undefined ? { requirements: spec ? toRequirements(spec) : null } : {}),
  };
}

/** What a job asks for, in the web's shape. */
export function toRequirements(spec: JobSpec) {
  const disqualifiers: string[] = [];
  if (spec.citizenshipRequired) disqualifiers.push("Requires US citizenship");
  if (spec.clearanceRequired) disqualifiers.push("Requires a security clearance");
  if (spec.sponsorship === "no") disqualifiers.push("No visa sponsorship");
  return {
    skills: spec.skills.map((s) => ({ name: s.name, required: s.required })),
    seniority: spec.seniority,
    roleFamily: spec.roleFamily,
    yearsMin: spec.yearsMin,
    mustHaves: spec.mustHaves,
    niceToHaves: spec.niceToHaves,
    disqualifiers,
    ...(spec.responsibilities[0] ? { summary: spec.responsibilities.slice(0, 2).join(" ") } : {}),
  };
}

type FitMapLike = { requirement?: unknown; mustHave?: unknown; score?: unknown; careerPointIds?: unknown; note?: unknown; evidence?: unknown };

/** The user's fit for a job (a shortlist row) in the web's `Match` shape. */
export function toMatch(jobId: string, row: { fit: number; fitMap: unknown[]; reasons: string[]; createdAt: Date }) {
  const matched: { requirement: string; nodeId: string; label: string; required: boolean }[] = [];
  const missing: { requirement: string; required: boolean }[] = [];
  for (const raw of row.fitMap) {
    const e = rec(raw) as FitMapLike;
    const requirement = str(e.requirement);
    if (!requirement) continue;
    const required = e.mustHave === true;
    const score = typeof e.score === "number" ? e.score : 0;
    if (score >= 0.5 && e.evidence !== "none") {
      matched.push({ requirement, nodeId: strs(e.careerPointIds)[0] ?? "", label: str(e.note) || requirement, required });
    } else missing.push({ requirement, required });
  }
  return { jobId, score: row.fit, explanation: { matched, missing, reasons: row.reasons }, computedAt: row.createdAt.toISOString() };
}

// ---- applications -----------------------------------------------------------------------------------------------------

export type AppRow = typeof applications.$inferSelect;

function pendingQuestions(raw: unknown[]) {
  return raw.flatMap((q) => {
    const o = rec(q);
    const id = str(o.id);
    const text = str(o.text);
    if (!id || !text) return [];
    return [{ id, text, type: str(o.type) ?? "text", options: strs(o.options), required: o.required !== false }];
  });
}

/** Absolute artifact paths become `artifacts/<relative>` so the web can build `/api/artifacts/<relative>`. */
export function publicArtifactPath(p: string, artifactsDir: string): string {
  const abs = path.resolve(p);
  const rel = path.relative(artifactsDir, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return p;
  return `artifacts/${rel.split(path.sep).join("/")}`;
}

export function toApplication(a: AppRow, artifactsDir: string) {
  let receipt: Rec | null = a.receipt;
  if (receipt) {
    receipt = { ...receipt };
    for (const k of ["screenshotPath", "tracePath"]) {
      const v = str(receipt[k]);
      if (v) receipt[k] = publicArtifactPath(v, artifactsDir);
    }
  }
  return {
    id: a.id,
    jobId: a.jobId,
    status: a.status,
    resumeId: a.resumeId,
    answers: a.answers,
    pendingQuestions: pendingQuestions(a.pendingQuestions),
    receipt,
    error: a.error,
    attempts: a.attempts,
    preparedAt: iso(a.preparedAt),
    approvedAt: iso(a.approvedAt),
    submittedAt: iso(a.submittedAt),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export type RunEventRow = typeof runEvents.$inferSelect;

export function toRunEvent(e: RunEventRow) {
  return { id: String(e.id), applicationId: e.applicationId, ts: e.ts.toISOString(), level: e.level, step: e.step, message: e.message, data: e.data };
}

// ---- resumes ----------------------------------------------------------------------------------------------------------

export type ResumeRow = typeof resumes.$inferSelect;

const bullet = (b: unknown) => {
  const o = rec(b);
  return { id: str(o.id) ?? "", text: str(o.text) ?? "", nodeIds: strs(o.careerPointIds ?? o.nodeIds) };
};

/** The tailor package's stored resume in the web's `Resume` shape (career point ids become node ids). */
export function toResume(r: ResumeRow) {
  const c = rec(r.content);
  const bullets = (v: unknown) => (Array.isArray(v) ? v.map(bullet) : []);
  const content = {
    name: str(c.name) ?? "",
    contact: rec(c.contact),
    ...(str(c.summary) ? { summary: str(c.summary) } : {}),
    experience: (Array.isArray(c.experience) ? c.experience : []).map((e) => {
      const o = rec(e);
      return { title: str(o.title) ?? "", company: str(o.company) ?? "", location: str(o.location), start: str(o.start), end: str(o.end), bullets: bullets(o.bullets) };
    }),
    education: (Array.isArray(c.education) ? c.education : []).map((e) => {
      const o = rec(e);
      return { school: str(o.school) ?? "", degree: str(o.degree), field: str(o.field), start: str(o.start), end: str(o.end) };
    }),
    skills: (Array.isArray(c.skills) ? c.skills : []).map((s) => ({ group: str(rec(s).group) ?? "", items: strs(rec(s).items) })),
    projects: (Array.isArray(c.projects) ? c.projects : []).map((p) => ({ name: str(rec(p).name) ?? "", bullets: bullets(rec(p).bullets) })),
  };
  const allBullets = [...content.experience.flatMap((e) => e.bullets), ...content.projects.flatMap((p) => p.bullets)];
  const changes = r.changes.map((raw, i) => {
    const o = rec(raw);
    const after = str(o.after) ?? "";
    const target = allBullets.find((b) => b.text === after);
    return {
      bulletId: target?.id ?? str(o.bulletId) ?? `${str(o.kind) ?? "change"}-${i}`,
      kind: str(o.kind),
      before: str(o.before) ?? "",
      after,
      reason: str(o.reason) ?? "",
      nodeIds: strs(o.careerPointIds ?? o.nodeIds),
    };
  });
  const report = rec(r.atsChecks);
  const checks = Array.isArray(report.checks) ? report.checks : [];
  return {
    id: r.id,
    applicationId: r.applicationId,
    content,
    changes,
    pages: r.pages,
    atsChecks: checks.map((raw) => {
      const o = rec(raw);
      return { id: str(o.id) ?? "", label: str(o.label) ?? "", pass: o.pass === true, ...(str(o.detail) ? { detail: str(o.detail) } : {}), ...(typeof o.weight === "number" ? { weight: o.weight } : {}) };
    }),
    createdAt: r.createdAt.toISOString(),
  };
}
