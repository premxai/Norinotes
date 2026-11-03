import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser } from "playwright";
import { z } from "zod";
import { embed } from "@norinote/ai";
import {
  and, applications, careerPointEmbeddings, careerPoints, companies, desc, eq, jobSpecs, jobs, profiles, resumes, shortlist, users, type Db,
} from "@norinote/db";
import { CareerPoint, FitMapEntry, JobSpec, type CareerPoint as CareerPointT } from "@norinote/shared";
import { aliasGroupOf } from "./aliases.js";
import { atsChecks } from "./ats.js";
import { buildEvidence, buildRequirements, coverageScore, pointCorpus, type EvidenceIndex, type SimilarityFn } from "./evidence.js";
import { renderResumePdf, type PdfRenderer } from "./pdf.js";
import { MAX_REWRITES, optimise, type OptimiseResult, type RejectedRewrite } from "./rewrite.js";
import { baselineContent, selectContent, type Selection } from "./select.js";
import { joinList, numbersIn, wordCount } from "./text.js";
import { cleanStrength, roleFamily, roleHead, roleNoun, summarySkills } from "./summary.js";
import { openerTense } from "./phrases.js";
import type { AtsReport, FontId, PageSize, ResumeBullet, ResumeChange, ResumeContact, ResumeContent, ResumeTemplate, TailoringReport } from "./types.js";
import { buildVocab, supportOf, validateBullet, type Support, type Vocab } from "./validate.js";

export { MAX_REWRITES };
export type { RejectedRewrite };

export type TailorInput = {
  userId: string;
  jobId: string;
  /** The application this resume is for. Default: the user's application for the job (created queued if missing). */
  applicationId?: string;
  /** Where PDFs are written (`<dir>/resumes/<userId>/<resumeId>.pdf`). Default: $ARTIFACTS_DIR or ./data/artifacts. */
  artifactsDir?: string;
  template?: ResumeTemplate;
  font?: FontId;
  size?: PageSize;
  /** A Playwright browser to render with. Default: a shared one launched on first use. */
  browser?: Browser;
  /** Replace the PDF renderer (tests). */
  renderer?: PdfRenderer;
  now?: Date;
  /** Use embedding similarity as the fallback evidence for descriptive requirements. Default true. */
  embeddings?: boolean;
};

export type TailorResult = {
  resumeId: string;
  applicationId: string;
  content: ResumeContent;
  changes: ResumeChange[];
  rejected: RejectedRewrite[];
  atsChecks: AtsReport;
  report: TailoringReport;
  pages: number;
  pdfPath: string;
  /** Model used for the rewrite, or null when it was not called or failed. */
  model: string | null;
  /** Why the model step was skipped or failed; the resume is then built from the career points alone. */
  modelError: string | null;
};

// ---------------------------------------------------------------------------------------------------------------------

const allBullets = (c: ResumeContent): ResumeBullet[] => [...c.experience.flatMap((r) => r.bullets), ...c.projects.flatMap((p) => p.bullets)];

/** Career point `kind` is a string union in the schema; parse rows into the shared contract. */
function toCareerPoints(rows: (typeof careerPoints.$inferSelect)[]): CareerPointT[] {
  return rows.map((r) => CareerPoint.parse({
    id: r.id, kind: r.kind, title: r.title, org: r.org, startDate: r.startDate, endDate: r.endDate, text: r.text,
    skills: r.skills, scope: r.scope, metrics: r.metrics, sourceQuote: r.sourceQuote,
  }));
}

const TITLE_LIKE = new Set(["registered nurse", "account executive", "charge nurse", "api"]);

/** A summary built from facts only, used when the model's is missing or rejected. */
export function factsSummary(points: CareerPointT[], selection: Selection, spec: JobSpec | null, jobTitle: string | null = null): string | undefined {
  void spec;
  if (points.length === 0) return undefined;
  const fromEvidence = selection.evidence.supportedJobTerms.filter((t) => !TITLE_LIKE.has(aliasGroupOf(t.jobString)?.key ?? "")).map((t) => t.jobString);
  // A role noun the person truthfully is (never a raw title with course codes), the target role family when it differs.
  const noun = roleNoun(points, jobTitle);
  // Only skills the career points really show; never the posting's list when the person has none of it.
  const skills = summarySkills(fromEvidence, noun);
  const family = jobTitle ? roleFamily(jobTitle) : null;
  const head = jobTitle ? roleHead(jobTitle) : null;
  const years = selection.years;
  const targeting = family && head && !noun.toLowerCase().includes(head) ? ` targeting ${family} roles` : "";
  const first = `${noun}${years !== null && years >= 2 ? ` with ${years} years of experience` : ""}${targeting}${skills.length ? `, working with ${joinList(skills)}` : ""}.`;
  // One concrete strength: the heaviest shown bullet with a number that keeps the summary within 45 words.
  const bullets = selection.content.experience.flatMap((r) => r.bullets).filter((b) => b.weight > 0)
    .sort((a, b) => Number(numbersIn(b.text).length > 0) - Number(numbersIn(a.text).length > 0) || b.weight - a.weight);
  for (const b of bullets) {
    const clean = cleanStrength(b.text);
    // A finished result reads as one past-tense sentence; skip present-tense lines ("Carry a quota...") and fragments.
    if (wordCount(clean) < 6 || openerTense(clean) === "present") continue;
    const second = `${clean}.`;
    if (wordCount(first) + wordCount(second) <= 45) return `${first} ${second}`;
  }
  return first;
}

/**
 * Apply rewrites that pass the provenance validator; every other bullet keeps its original text. The simple, single-step
 * path (no retries or critique); kept for callers and tests that apply a list of rewrites directly.
 */
export function applyRewrites(
  content: ResumeContent, offeredIds: ReadonlySet<string>, rewrites: { id: string; text: string; reason: string }[],
  pointTexts: Map<string, string>, vocab: Vocab,
): { changes: ResumeChange[]; rejected: RejectedRewrite[] } {
  const changes: ResumeChange[] = [];
  const rejected: RejectedRewrite[] = [];
  const bullets = new Map(allBullets(content).map((b) => [b.id, b]));
  const seen = new Set<string>();
  for (const rw of rewrites) {
    const bullet = bullets.get(rw.id);
    if (!bullet || !offeredIds.has(rw.id)) { rejected.push({ bulletId: rw.id, text: rw.text, reason: "not one of the bullets offered for rewriting" }); continue; }
    if (seen.has(rw.id)) { rejected.push({ bulletId: rw.id, text: rw.text, reason: "duplicate rewrite" }); continue; }
    if (seen.size >= MAX_REWRITES) { rejected.push({ bulletId: rw.id, text: rw.text, reason: `more than ${MAX_REWRITES} rewrites` }); continue; }
    seen.add(rw.id);
    const support: Support = supportOf([bullet.text, ...bullet.careerPointIds.map((id) => pointTexts.get(id) ?? "")]);
    const verdict = validateBullet(bullet.text, rw.text, support, vocab);
    if (!verdict.ok) { rejected.push({ bulletId: rw.id, text: rw.text, reason: verdict.reason }); continue; }
    changes.push({ kind: "bullet", before: bullet.text, after: rw.text.trim(), reason: rw.reason.trim() || "Reworded in the posting's vocabulary", careerPointIds: bullet.careerPointIds, bulletId: rw.id });
    bullet.text = rw.text.trim();
  }
  return { changes, rejected };
}

async function resolveApplication(db: Db, input: TailorInput): Promise<string> {
  if (input.applicationId) {
    const [row] = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.id, input.applicationId), eq(applications.userId, input.userId))).limit(1);
    if (!row) throw new Error(`Application ${input.applicationId} not found for user ${input.userId}`);
    return row.id;
  }
  const [existing] = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.userId, input.userId), eq(applications.jobId, input.jobId))).limit(1);
  if (existing) return existing.id;
  // resumes.application_id is required, so a resume prepared before the click needs an application to hang on.
  const [created] = await db.insert(applications).values({ userId: input.userId, jobId: input.jobId, status: "queued" }).onConflictDoNothing().returning({ id: applications.id });
  if (created) return created.id;
  const [raced] = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.userId, input.userId), eq(applications.jobId, input.jobId))).limit(1);
  return raced!.id;
}

function contactFrom(profile: typeof profiles.$inferSelect | undefined, email: string): ResumeContact & { name: string } {
  const c = profile?.contact ?? {};
  const pick = (...keys: string[]) => keys.map((k) => c[k]?.trim()).find(Boolean);
  const name = pick("name", "fullName", "full_name") ?? [pick("firstName", "first_name"), pick("lastName", "last_name")].filter(Boolean).join(" ");
  const out: ResumeContact & { name: string } = { name };
  const set = (k: keyof ResumeContact, v: string | undefined | null) => { if (v?.trim()) out[k] = v.trim(); };
  set("email", pick("email") ?? email);
  set("phone", pick("phone", "mobile"));
  set("location", profile?.location ?? pick("location"));
  set("linkedin", pick("linkedin"));
  set("github", pick("github"));
  set("website", pick("website", "portfolio"));
  return out;
}

const cosine = (a: readonly number[], b: readonly number[]): number => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] ?? 0, y = b[i] ?? 0; dot += x * y; na += x * x; nb += y * y; }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
};

/**
 * Embedding similarity for the descriptive requirements (those that name no term), against the user's stored point
 * embeddings. One small embedding call; null when nothing needs it or the AI service is unavailable.
 */
async function loadSimilarity(db: Db, userId: string, texts: string[]): Promise<SimilarityFn | null> {
  if (texts.length === 0) return null;
  try {
    const rows = await db.select({ id: careerPointEmbeddings.careerPointId, embedding: careerPointEmbeddings.embedding })
      .from(careerPointEmbeddings).where(eq(careerPointEmbeddings.userId, userId));
    if (rows.length === 0) return null;
    const vectors = await embed(texts, { userId, db });
    const reqVec = new Map(texts.map((t, i) => [t, vectors[i]!]));
    const pointVec = new Map(rows.map((r) => [r.id, r.embedding as number[]]));
    return (text, pointId) => {
      const a = reqVec.get(text), b = pointVec.get(pointId);
      return a && b ? cosine(a, b) : null;
    };
  } catch {
    // Exact and alias evidence still work; embeddings are only the fallback.
    return null;
  }
}

/** The report stored with the resume. */
function buildReport(evidence: EvidenceIndex, before: ResumeContent, selected: ResumeContent, after: ResumeContent, opt: OptimiseResult, summarySource: TailoringReport["summary"]["source"]): TailoringReport {
  const display = (k: string, e: EvidenceIndex["entries"][number]) => e.terms.find((t) => t.key === k)?.jobString ?? k;
  return {
    version: 1,
    coverage: {
      before: coverageScore(evidence, before), selected: coverageScore(evidence, selected), after: coverageScore(evidence, after),
      exactBefore: coverageScore(evidence, before, "exact"), exactAfter: coverageScore(evidence, after, "exact"),
      phraseBefore: coverageScore(evidence, before, "phrase"), phraseAfter: coverageScore(evidence, after, "phrase"),
    },
    gaps: evidence.entries.filter((e) => !e.supported || e.lackedTerms.length > 0).map((e) => ({
      requirement: e.text, mustHave: e.mustHave, lacking: e.lackedTerms.map((k) => display(k, e)), related: e.related,
    })),
    keyPhrases: [...new Set(evidence.entries.filter((e) => e.supported && e.mirror && e.keyPhrase).map((e) => e.keyPhrase!))],
    bullets: opt.bullets,
    summary: { source: summarySource, failures: opt.summary.failures },
    rounds: opt.rounds,
    stopReason: opt.stopReason,
    model: opt.model,
    calls: opt.calls,
    costMicros: opt.calls.reduce((n, c) => n + c.costMicros, 0),
    aiUnavailable: opt.aiUnavailable,
    error: opt.error,
  };
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/**
 * Build, check and render the resume for one job.
 *
 * 1. Evidence: each requirement of the job against the career points (exact or alias match first, the fit map and
 *    embedding similarity for descriptive requirements). Unsupported requirements are gaps.
 * 2. Selection, deterministic: roles, bullets heaviest-first by supported must-haves, skills in the job's spelling.
 * 3. Model: one large-model rewrite of the top bullets and the summary, the gate on every bullet, one retry, then up to
 *    two critique-and-revise rounds (see rewrite.ts). Without the AI service the selection stands as written.
 * 4. Render to PDF, trimming the lowest-weight bullets until it is one page; store changes, ATS checks and the report.
 */
export async function tailorResume(db: Db, input: TailorInput): Promise<TailorResult> {
  const { userId, jobId } = input;
  const now = input.now ?? new Date();
  const [jobRow] = await db.select({ title: jobs.title, descriptionText: jobs.descriptionText, company: companies.name })
    .from(jobs).innerJoin(companies, eq(companies.id, jobs.companyId)).where(eq(jobs.id, jobId)).limit(1);
  if (!jobRow) throw new Error(`Job ${jobId} not found`);

  const [specRow] = await db.select({ spec: jobSpecs.spec }).from(jobSpecs).where(eq(jobSpecs.jobId, jobId)).orderBy(desc(jobSpecs.version)).limit(1);
  const specParsed = specRow ? JobSpec.safeParse(specRow.spec) : null;
  const spec = specParsed?.success ? specParsed.data : null;

  const [fitRow] = await db.select({ fitMap: shortlist.fitMap }).from(shortlist).where(and(eq(shortlist.userId, userId), eq(shortlist.jobId, jobId))).limit(1);
  const fitMap = z.array(FitMapEntry).catch([]).parse(fitRow?.fitMap ?? []);

  const points = toCareerPoints(await db.select().from(careerPoints).where(eq(careerPoints.userId, userId)));
  if (points.length === 0) throw new Error(`User ${userId} has no career points to build a resume from`);
  const applicationId = await resolveApplication(db, input);
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  const contact = contactFrom(profile, user?.email ?? "");

  // 1. Evidence.
  const descriptive = buildRequirements(spec, fitMap).filter((r) => r.terms.length === 0).map((r) => r.text);
  const similarity = input.embeddings === false ? null : await loadSimilarity(db, userId, descriptive);
  const evidence = buildEvidence({ spec, fitMap, points, similarity });

  // 2. Selection.
  const selection = selectContent({ points, fitMap, spec, contact, now, evidence, jobTitle: jobRow.title });
  const content = selection.content;
  const selected = clone(content);
  const changes: ResumeChange[] = [];

  const corpus = supportOf(points.map(pointCorpus));
  const vocab = buildVocab({
    userSkills: points.flatMap((p) => [...p.skills, ...(p.kind === "skill" ? [p.title] : [])]),
    specSkills: (spec?.skills ?? []).map((s) => s.name),
    orgs: points.flatMap((p) => (p.org ? [p.org] : [])),
    titles: points.filter((p) => p.kind === "role").map((p) => p.title),
  });

  // 3. Model steps and the gate.
  const opt = await optimise({ selection, points, job: { title: jobRow.title, company: jobRow.company }, vocab, corpus, userId, db, now }, content);
  changes.push(...opt.changes);

  // Summary: the model's if it passed the gate, else facts only.
  const topIds = [...new Set(selection.topRequirements.slice(0, 4).flatMap((r) => r.careerPointIds))].slice(0, 6);
  let summarySource: TailoringReport["summary"]["source"] = "none";
  if (opt.summary.text) {
    content.summary = opt.summary.text;
    summarySource = "model";
    changes.push({ kind: "summary", before: null, after: content.summary, reason: "Written around the top supported requirements of the posting", careerPointIds: topIds });
  } else {
    const fallback = factsSummary(points, selection, spec, jobRow.title);
    if (fallback) {
      content.summary = fallback;
      summarySource = "facts";
      const why = opt.summary.failures.length ? `model summary rejected (${opt.summary.failures.map((f) => f.detail).join("; ")})` : opt.error ? "model unavailable" : "no model summary";
      changes.push({ kind: "summary", before: null, after: fallback, reason: `Built from your career points only: ${why}`, careerPointIds: topIds });
    }
  }

  // 4. Render, trimming to one page.
  const rendered = await renderResumePdf(content, { template: input.template, font: input.font, size: input.size, browser: input.browser, renderer: input.renderer });
  for (const b of rendered.dropped) {
    changes.push({ kind: "trim", before: b.text, after: null, reason: "Dropped to keep the resume on one page (it covered the least of the posting)", careerPointIds: b.careerPointIds, bulletId: b.id });
  }
  const finalContent = rendered.content;
  const report = buildReport(evidence, baselineContent(points, contact), selected, finalContent, opt, summarySource);
  const ats: AtsReport = { ...atsChecks(finalContent, rendered.html, spec, rendered.pages), tailoring: report };

  const resumeId = randomUUID();
  const dir = path.resolve(input.artifactsDir ?? process.env.ARTIFACTS_DIR ?? path.join("data", "artifacts"), "resumes", userId);
  await mkdir(dir, { recursive: true });
  const pdfPath = path.join(dir, `${resumeId}.pdf`);
  await writeFile(pdfPath, rendered.pdf);

  await db.insert(resumes).values({
    id: resumeId, applicationId, content: finalContent as unknown as Record<string, unknown>, changes, pdfPath,
    pages: rendered.pages, atsChecks: ats as unknown as Record<string, unknown>,
  });
  await db.update(applications).set({ resumeId, updatedAt: new Date() }).where(eq(applications.id, applicationId));

  return { resumeId, applicationId, content: finalContent, changes, rejected: opt.rejected, atsChecks: ats, report, pages: rendered.pages, pdfPath, model: opt.model, modelError: opt.error };
}
