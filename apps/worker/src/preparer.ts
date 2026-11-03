import { applications, eq, type Db } from "@norinote/db";
import { prepareForm, saveAnswers, questionId, type BrowserPool, type PrepareFormDeps, type PrepareResult, type Preparer } from "@norinote/apply";
import { answerQuestions } from "@norinote/answers";
import { tailorResume } from "@norinote/tailor";
import type { PendingQuestion } from "@norinote/shared";

/**
 * Questions nearly every application form asks. They are answered ahead of time from the profile and the answer bank,
 * so the form is mostly filled the moment the user clicks. None is required: a question with no answer yet is simply
 * left out, and the real form's own questions are handled when it is opened (see the worker's apply consumer).
 */
export const STANDARD_QUESTIONS: readonly PendingQuestion[] = [
  { id: "q-work-auth", text: "Are you legally authorized to work in this country?", type: "boolean", options: [], required: false },
  { id: "q-sponsorship", text: "Will you now or in the future require visa sponsorship?", type: "boolean", options: [], required: false },
  { id: "q-salary", text: "What are your salary expectations?", type: "text", options: [], required: false },
  { id: "q-start", text: "When can you start?", type: "text", options: [], required: false },
  { id: "q-relocate", text: "Are you willing to relocate?", type: "boolean", options: [], required: false },
  { id: "q-hear", text: "How did you hear about us?", type: "text", options: [], required: false },
];

/** The two functions of the tailor and answers packages the Preparer uses; tests replace them. */
export type PreparerDeps = {
  tailor?: typeof tailorResume;
  answer?: typeof answerQuestions;
  artifactsDir?: string;
  /** Warm browser pool, to read Lever and Ashby forms ahead of the click. */
  pool?: BrowserPool;
  /** Reads the form and plans its answers (apply package); tests replace it. */
  form?: (db: Db, applicationId: string, deps: PrepareFormDeps) => ReturnType<typeof prepareForm>;
};

/**
 * The real Preparer: tailors the resume for the job (tailor package: one-page PDF, `applications.resume_id`), then answers
 * the standard questions (answers package) and stores the answers on the application. A user with no career points yet
 * is parked as `needs_user` instead of failing; any other error throws so the queue retries with backoff.
 */
export function createPreparer(db: Db, deps: PreparerDeps = {}): Preparer {
  const tailor = deps.tailor ?? tailorResume;
  const answer = deps.answer ?? answerQuestions;
  return {
    async prepare(applicationId): Promise<PrepareResult> {
      const [app] = await db.select({ userId: applications.userId, jobId: applications.jobId, resumeId: applications.resumeId }).from(applications).where(eq(applications.id, applicationId)).limit(1);
      if (!app) return { outcome: "failed", error: "application not found" };

      // Preparing again after the person answered questions: the tailored resume is already there.
      if (!app.resumeId) {
        try {
          await tailor(db, { userId: app.userId, jobId: app.jobId, applicationId, ...(deps.artifactsDir ? { artifactsDir: deps.artifactsDir } : {}) });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (/no career points/i.test(message)) return { outcome: "needs_user", reason: "Upload your resume first: there is nothing to build an application from yet." };
          throw err;
        }
      }

      const res = await answer(db, { userId: app.userId, jobId: app.jobId, questions: [...STANDARD_QUESTIONS] });
      // Keyed the way the form drivers look answers up: by the id derived from the question text.
      const keyed: Record<string, string> = {};
      for (const q of STANDARD_QUESTIONS) {
        const a = res.answers[q.id];
        if (a) keyed[questionId(q.text)] = a;
      }
      if (Object.keys(keyed).length > 0) await saveAnswers(db, applicationId, keyed);

      // The real form: its schema, the recipe cache, the answer plan. Questions only the person can answer park it now,
      // batched with their other pending questions, so the click itself never waits on them.
      const form = await (deps.form ?? prepareForm)(db, applicationId, { ...(deps.pool ? { pool: deps.pool } : {}) });
      if (form.outcome === "needs_user") return { outcome: "needs_user", reason: form.reason ?? "Needs your input", pending: form.pending };
      if (form.outcome === "failed") return { outcome: "failed", error: form.reason ?? "Could not prepare the form" };
      return { outcome: "prepared" };
    },
  };
}
