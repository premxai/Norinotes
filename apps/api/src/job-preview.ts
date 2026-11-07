/**
 * The Review tab: what Nori would send for a job before the person presses Apply. The form's questions (Greenhouse's
 * public form API), which ones Nori already has answers for (profile, answer bank, the person's facts) and which ones it
 * would ask. Read only: no model call, nothing saved, no application made. The tailored resume is made at Apply.
 */
import { planForm, type Slot } from "@norinote/answers";
import { companies, eq, jobs, type Db } from "@norinote/db";
import { detectDriver, fetchGreenhouseSchema, formFingerprint, labelKey, loadRecipe, parseJobUrl } from "@norinote/apply";

export type PreviewQuestion = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  /** ready: Nori has the answer; ask: Nori would ask the person; skip: optional, left empty. */
  status: "ready" | "ask" | "skip";
  /** What Nori would put in (ready only). The resume shows as "Your tailored resume". */
  answer: string | null;
  /** Where the answer comes from: profile, answer bank, the person's facts... */
  source: string | null;
};

export type JobPreview =
  | { available: true; ats: string; questions: PreviewQuestion[]; counts: { total: number; ready: number; ask: number; skip: number } }
  | { available: false; ats: string | null; reason: string };

export async function jobPreview(db: Db, userId: string, jobId: string, opts: { fetch?: typeof fetch } = {}): Promise<JobPreview | null> {
  const [job] = await db.select({ applyUrl: jobs.applyUrl, atsType: jobs.atsType, company: companies.name }).from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId)).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return null;
  const driver = detectDriver(job.applyUrl);
  if (!driver) return { available: false, ats: job.atsType, reason: "Nori can't fill this kind of form yet: open the posting and apply yourself." };
  const parsed = parseJobUrl(job.applyUrl);
  if (parsed?.ats !== "greenhouse" || !parsed.token) {
    return { available: false, ats: job.atsType, reason: "Nori reads this form when you press Apply and asks you anything it can't answer before sending." };
  }
  const schema = await fetchGreenhouseSchema(parsed.token, parsed.jobId, opts.fetch ? { fetch: opts.fetch } : {}).catch(() => null);
  if (!schema || schema.fields.length === 0) {
    return { available: false, ats: job.atsType, reason: "The form couldn't be read ahead of time. Nori reads it when you press Apply." };
  }
  const recipe = await loadRecipe(db, formFingerprint(schema.ats, schema.companyToken, schema.fields));
  const hints = new Map<string, Slot>((recipe?.fields ?? []).map((f) => [`${f.labelKey}|${f.type}`, f.slot]));
  const plan = await planForm(db, {
    userId, jobId, explicit: {}, noModel: true,
    fields: schema.fields.map((f) => ({ ...f, slotHint: hints.get(`${labelKey(f.label)}|${f.type}`) ?? null })),
  });
  const questions: PreviewQuestion[] = plan.entries.map((e) => ({
    key: e.key, label: e.label, type: e.type, required: e.required,
    status: e.status === "ready" ? "ready" : e.status === "pending" ? "ask" : "skip",
    answer: e.status === "ready" ? (e.value === "@resume" ? "Your tailored resume" : e.value ?? null) : null,
    source: e.source ?? null,
  }));
  return {
    available: true, ats: schema.ats, questions,
    counts: { total: questions.length, ready: questions.filter((q) => q.status === "ready").length, ask: questions.filter((q) => q.status === "ask").length, skip: questions.filter((q) => q.status === "skip").length },
  };
}
