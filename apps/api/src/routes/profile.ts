import { Hono } from "hono";
import { z } from "zod";
import { deleteAnswer, listAnswers, updateAnswer } from "@norinote/answers";
import { eq, profiles } from "@norinote/db";
import { extractResumeText } from "@norinote/graph";
import { parseContact } from "@norinote/graph";
import { JOBS } from "@norinote/queue";
import { accountName, ensureProfile, requireUser } from "../auth/session.js";
import { HttpError, notFound, parseBody, uuidParam } from "../http.js";
import { buildUpdate, ProfilePatch, toProfile } from "../profile-model.js";
import { ingestResume } from "../resume-ingest.js";
import { userView } from "./auth.js";
import { enqueueSoft, limitUser, type AppEnv, type Ctx } from "../types.js";

const ResumeText = z.object({ text: z.string().min(20, "Paste the full resume text").max(200_000), replace: z.boolean().optional() });
const HOUR = 3_600_000;
const AnswerEdit = z.object({ answer: z.string().trim().min(1, "Write an answer").max(2000) });

export function profileRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db } = ctx;

  r.get("/me", auth, async (c) => {
    const user = c.get("user");
    const row = await ensureProfile(db, user.id);
    return c.json({ user: userView(user, await accountName(db, user.id)), profile: toProfile(row, user.email) });
  });

  r.put("/profile", auth, async (c) => {
    const user = c.get("user");
    const patch = await parseBody(c, ProfilePatch);
    const current = await ensureProfile(db, user.id);
    const update = buildUpdate(current, patch);
    const [row] = await db.update(profiles).set({ ...update, updatedAt: ctx.now() }).where(eq(profiles.userId, user.id)).returning();
    // Work authorisation and location feed the match gates.
    if (patch.workAuth || patch.securityClearance !== undefined || update.location !== undefined || patch.preferences?.excludeCompanies !== undefined) await enqueueSoft(ctx, JOBS.matchUser, { userId: user.id, reason: "profile" });
    return c.json(toProfile(row ?? current, user.email));
  });

  // The answer bank: answers Nori remembered from applications (and the user's own), reused on later forms.
  r.get("/profile/answers", auth, async (c) => c.json(await listAnswers(db, c.get("user").id)));

  r.patch("/profile/answers/:id", auth, async (c) => {
    const { answer } = await parseBody(c, AnswerEdit);
    const updated = await updateAnswer(db, c.get("user").id, uuidParam(c), answer);
    if (!updated) throw notFound("That answer was not found");
    return c.json(updated);
  });

  r.delete("/profile/answers/:id", auth, async (c) => {
    if (!(await deleteAnswer(db, c.get("user").id, uuidParam(c)))) throw notFound("That answer was not found");
    return c.json({ ok: true });
  });

  r.post("/profile/resume", auth, async (c) => {
    const user = c.get("user");
    limitUser(ctx, "resume", user.id, 20, HOUR, "Too many resume uploads. Try again in an hour.");
    const body = await parseBody(c, ResumeText);
    return c.json(await ingestResume(ctx, user.id, body.text.trim(), parseContact(body.text)));
  });

  r.post("/profile/resume-file", auth, async (c) => {
    const user = c.get("user");
    limitUser(ctx, "resume", user.id, 20, HOUR, "Too many resume uploads. Try again in an hour.");
    let form: Record<string, string | File | (string | File)[]>;
    try {
      form = await c.req.parseBody();
    } catch {
      throw new HttpError(400, "Send the resume as a multipart form with a file field");
    }
    const file = form.file;
    if (!(file instanceof File)) throw new HttpError(400, "Choose a resume file (PDF, DOCX or text)");
    if (file.size === 0) throw new HttpError(400, "That file is empty");
    if (file.size > ctx.config.maxResumeBytes) throw new HttpError(413, "That file is too large. Resumes up to 10 MB are accepted.");
    const extracted = await extractResumeText({ name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }).catch(() => null);
    if (!extracted) throw new HttpError(422, "We could not read that file. Upload a text-based PDF or DOCX, or paste the text.");
    if (extracted.error) throw new HttpError(422, `We could not read that file: ${extracted.error}.`);
    if (extracted.text.trim().length < 20) throw new HttpError(422, "We could not find text in that file. Upload a text-based PDF or DOCX, or paste the text.");
    return c.json(await ingestResume(ctx, user.id, extracted.text.slice(0, 200_000), parseContact(extracted.text, extracted.links)));
  });

  return r;
}
