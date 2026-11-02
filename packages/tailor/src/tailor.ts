import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser } from "playwright";
import { z } from "zod";
import { complete } from "@norinote/ai";
import { and, applications, careerPoints, companies, desc, eq, jobSpecs, jobs, profiles, resumes, shortlist, users, type Db } from "@norinote/db";
import { CareerPoint, FitMapEntry, JobSpec, type CareerPoint as CareerPointT } from "@norinote/shared";
import { atsChecks } from "./ats.js";
import { renderResumePdf, type PdfRenderer } from "./pdf.js";
import { selectContent, type RankedRequirement, type Selection } from "./select.js";
import { joinList, mentionsSkill } from "./text.js";
import type { AtsReport, FontId, PageSize, ResumeBullet, ResumeChange, ResumeContact, ResumeContent, ResumeTemplate } from "./types.js";
import { buildVocab, supportOf, validateBullet, validateSummary, type Support, type Vocab } from "./validate.js";

/** Bullets the model may rewrite per resume. */
export const MAX_REWRITES = 5;

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
};

export type RejectedRewrite = { bulletId: string; text: string; reason: string };

export type TailorResult = {
  resumeId: string;
  applicationId: string;
  content: ResumeContent;
  changes: ResumeChange[];
  rejected: RejectedRewrite[];
  atsChecks: AtsReport;
  pages: number;
  pdfPath: string;
  /** Model used for the rewrite, or null when it was not called or failed. */
  model: string | null;
  /** Why the model step was skipped or failed; the resume is then built from the career points alone. */
  modelError: string | null;
};

const RewriteOutput = z.object({
  summary: z.string(),
  rewrites: z.array(z.object({ id: z.string(), text: z.string(), reason: z.string() })),
});

const SYSTEM = `You tailor a one-page resume to one job posting. You reword; you never add facts.

Rules:
- Rewrite only the bullets you are given, at most ${MAX_REWRITES} of them, and only where a rewrite makes the match to the posting clearer. Skip a bullet that already reads well.
- Use the posting's own vocabulary only when the bullet's "facts" already support it. Never add a skill, tool, employer, job title, team size or number that is not in the bullet or its facts. Keep every number exactly as written.
- Do not raise ownership or scope: "contributed to" must not become "led", "a team" must not become "company-wide".
- Start each bullet with a past-tense action verb, 12 to 24 words, no first person, no filler such as "passionate" or "robust".
- Write a 2 to 3 sentence summary for the top requirements. Use only facts from the bullets, the facts and the years given. Do not name the company you are applying to.
- Reply as JSON: {"summary": string, "rewrites": [{"id": string, "text": string, "reason": string}]}. "reason" is one short sentence for the person reviewing the change.`;

// ---------------------------------------------------------------------------------------------------------------------

const pointText = (p: CareerPointT): string => [
  p.title, p.org ?? "", p.text, p.skills.join(", "), p.sourceQuote ?? "",
  ...Object.entries(p.metrics).map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`),
  ...Object.entries(p.scope).map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`),
].filter(Boolean).join("\n");

function allBullets(c: ResumeContent): ResumeBullet[] {
  return [...c.experience.flatMap((r) => r.bullets), ...c.projects.flatMap((p) => p.bullets)];
}

/** Career point `kind` is a string union in the schema; parse rows into the shared contract. */
function toCareerPoints(rows: (typeof careerPoints.$inferSelect)[]): CareerPointT[] {
  return rows.map((r) => CareerPoint.parse({
    id: r.id, kind: r.kind, title: r.title, org: r.org, startDate: r.startDate, endDate: r.endDate, text: r.text,
    skills: r.skills, scope: r.scope, metrics: r.metrics, sourceQuote: r.sourceQuote,
  }));
}

/** A summary built from facts only, used when the model's is missing or rejected. */
export function factsSummary(points: CareerPointT[], selection: Selection, spec: JobSpec | null): string | undefined {
  const latest = selection.content.experience[0];
  // Skills the posting names that the user's relevant work (the points the fit map cites) really mentions.
  const cited = new Set(selection.topRequirements.flatMap((r) => r.careerPointIds));
  const corpus = points.filter((p) => cited.size === 0 || cited.has(p.id)).map(pointText).join("\n");
  const skills = (spec?.skills ?? []).map((s) => s.name).filter((n) => mentionsSkill(corpus, n)).slice(0, 3);
  const title = latest?.title;
  const years = selection.years;
  if (!title && skills.length === 0) return undefined;
  const lead = title ? `${title}${years && years > 0 ? ` with ${years} year${years === 1 ? "" : "s"} of experience` : ""}` : "Candidate";
  return `${lead}${skills.length ? `, working with ${joinList(skills)}` : ""}.`;
}

type ModelPlan = { summary: string | null; rewrites: { id: string; text: string; reason: string }[]; model: string | null; error: string | null };

async function askModel(db: Db, userId: string, job: { title: string; company: string }, selection: Selection, offered: ResumeBullet[], points: CareerPointT[], spec: JobSpec | null): Promise<ModelPlan> {
  const byId = new Map(points.map((p) => [p.id, p]));
  const top = selection.topRequirements.filter((r) => r.weight > 0).slice(0, 4);
  const input = JSON.stringify({
    job: { title: job.title, company: job.company },
    topRequirements: top.map((r: RankedRequirement) => r.requirement),
    skillsInPostingOrder: (spec?.skills ?? []).map((s) => s.name),
    yearsOfExperience: selection.years,
    latestTitle: selection.content.experience[0]?.title ?? null,
    bullets: offered.map((b) => ({
      id: b.id, text: b.text,
      supports: selection.covers.get(b.id) ?? [],
      facts: b.careerPointIds.flatMap((id) => { const p = byId.get(id); return p ? [{ title: p.title, org: p.org, skills: p.skills }] : []; }),
    })),
  });
  try {
    const res = await complete({ tier: "large", system: SYSTEM, input, schema: RewriteOutput, schemaName: "resume_tailoring", strict: true, userId, db });
    return { summary: res.output.summary, rewrites: res.output.rewrites, model: res.model, error: null };
  } catch (err) {
    // A resume without rewrites is still a good resume; the budget or a malformed reply must not stop an application.
    return { summary: null, rewrites: [], model: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Apply the model's rewrites that pass the provenance validator; every other bullet keeps its original text.
 * Exported for tests.
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
    changes.push({ kind: "bullet", before: bullet.text, after: rw.text.trim(), reason: rw.reason.trim() || "Reworded in the posting's vocabulary", careerPointIds: bullet.careerPointIds });
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

/**
 * Build, check and render the resume for one job.
 *
 * 1. Select from the user's career points by the fit map (roles, bullets, projects, skills order). No text is written.
 * 2. One large-model call rewrites at most five of the best bullets in the posting's vocabulary and writes a summary.
 * 3. Every rewrite must pass the provenance validator (no new skill, employer, title or number); a failed one falls
 *    back to the original bullet. A rejected summary falls back to one built from facts.
 * 4. Render to PDF, trimming the lowest-weight bullets until it is one page; record every change and the ATS checks.
 */
export async function tailorResume(db: Db, input: TailorInput): Promise<TailorResult> {
  const { userId, jobId } = input;
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

  const selection = selectContent({ points, fitMap, spec, contact: contactFrom(profile, user?.email ?? ""), now: input.now });
  const content = selection.content;
  const changes: ResumeChange[] = [];
  let rejected: RejectedRewrite[] = [];

  const pointTexts = new Map(points.map((p) => [p.id, pointText(p)]));
  const corpus = supportOf(points.map(pointText));
  const vocab = buildVocab({
    userSkills: points.flatMap((p) => [...p.skills, ...(p.kind === "skill" ? [p.title] : [])]),
    specSkills: (spec?.skills ?? []).map((s) => s.name),
    orgs: points.flatMap((p) => (p.org ? [p.org] : [])),
    titles: points.filter((p) => p.kind === "role").map((p) => p.title),
  });

  // The best bullets, by what they cover, are the ones worth rewording.
  const offered = allBullets(content).filter((b) => b.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, MAX_REWRITES);
  let model: string | null = null;
  let modelError: string | null = null;
  let modelSummary: string | null = null;
  if (offered.length === 0 && selection.topRequirements.length === 0) {
    modelError = "nothing in the career points covers this job's requirements";
  } else {
    const plan = await askModel(db, userId, { title: jobRow.title, company: jobRow.company }, selection, offered, points, spec);
    model = plan.model;
    modelError = plan.error;
    modelSummary = plan.summary;
    const applied = applyRewrites(content, new Set(offered.map((b) => b.id)), plan.rewrites, pointTexts, vocab);
    changes.push(...applied.changes);
    rejected = applied.rejected;
  }

  // Summary: the model's if it passes, else facts only.
  const topIds = [...new Set(selection.topRequirements.slice(0, 4).flatMap((r) => r.careerPointIds))].slice(0, 6);
  const summaryVerdict = modelSummary !== null ? validateSummary(modelSummary, corpus, vocab, { years: selection.years }) : null;
  if (modelSummary !== null && summaryVerdict?.ok) {
    content.summary = modelSummary.trim();
    changes.push({ kind: "summary", before: null, after: content.summary, reason: "Written around the top requirements of the posting", careerPointIds: topIds });
  } else {
    const fallback = factsSummary(points, selection, spec);
    if (fallback) {
      content.summary = fallback;
      const why = summaryVerdict && !summaryVerdict.ok ? `model summary rejected (${summaryVerdict.reason})` : modelError ? "model unavailable" : "no model summary";
      changes.push({ kind: "summary", before: null, after: fallback, reason: `Built from your career points only: ${why}`, careerPointIds: topIds });
    }
  }

  // Render, trimming to one page.
  const rendered = await renderResumePdf(content, { template: input.template, font: input.font, size: input.size, browser: input.browser, renderer: input.renderer });
  for (const b of rendered.dropped) {
    changes.push({ kind: "trim", before: b.text, after: null, reason: "Dropped to keep the resume on one page (it covered the least of the posting)", careerPointIds: b.careerPointIds });
  }
  const finalContent = rendered.content;
  const report = atsChecks(finalContent, rendered.html, spec, rendered.pages);

  const resumeId = randomUUID();
  const dir = path.resolve(input.artifactsDir ?? process.env.ARTIFACTS_DIR ?? path.join("data", "artifacts"), "resumes", userId);
  await mkdir(dir, { recursive: true });
  const pdfPath = path.join(dir, `${resumeId}.pdf`);
  await writeFile(pdfPath, rendered.pdf);

  await db.insert(resumes).values({
    id: resumeId, applicationId, content: finalContent as unknown as Record<string, unknown>, changes, pdfPath,
    pages: rendered.pages, atsChecks: report as unknown as Record<string, unknown>,
  });
  await db.update(applications).set({ resumeId, updatedAt: new Date() }).where(eq(applications.id, applicationId));

  return { resumeId, applicationId, content: finalContent, changes, rejected, atsChecks: report, pages: rendered.pages, pdfPath, model, modelError };
}
