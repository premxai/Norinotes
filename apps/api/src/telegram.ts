import { and, applications, companies, eq, gte, isNull, jobs, profiles, sql } from "@norinote/db";
import { logEvent } from "@norinote/apply";
import {
  createBotClient, createUpdateHandler, recordApplyIntent, SendQueue, webhookSecret,
  type BotClient, type TelegramActions, type TgUpdate,
} from "@norinote/telegram";
import { HttpError } from "./http.js";
import { answerApplication, approveApplication, ownedApplication, startApplication } from "./routes/applications.js";
import { dismissShortlistJob } from "./routes/shortlist.js";
import type { Ctx } from "./types.js";

export type TelegramRuntime = {
  client: BotClient;
  queue: SendQueue;
  /** The `secret_token` Telegram must send on every webhook call. */
  webhookSecret: string;
  handle(update: TgUpdate): Promise<void>;
};

/** The bot is usable when a token and a signing secret exist. */
export const telegramConfigured = (ctx: Ctx): boolean => !!ctx.config.telegramBotToken && !!ctx.config.sessionSecret;

const reason = (err: unknown) => (err instanceof HttpError ? err.message : "Something went wrong. Try again in the app.");

/** Today's approvals (UTC day, as GET /api/agent/status counts them) against the daily cap. */
async function capReached(ctx: Ctx, userId: string): Promise<{ cap: number; used: number } | null> {
  const [profile] = await ctx.db.select({ cap: profiles.dailyCap }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const cap = profile?.cap ?? 0;
  if (cap <= 0) return null;
  const now = ctx.now();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [used] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(applications).where(and(eq(applications.userId, userId), gte(applications.approvedAt, dayStart)));
  return (used?.n ?? 0) >= cap ? { cap, used: used?.n ?? 0 } : null;
}

/** Telegram's buttons, through the same functions as the web routes. */
export function telegramActions(ctx: Ctx): TelegramActions {
  return {
    async apply(userId, jobId) {
      try {
        const [job] = await ctx.db.select({ title: jobs.title, company: companies.name }).from(jobs).innerJoin(companies, eq(companies.id, jobs.companyId)).where(eq(jobs.id, jobId)).limit(1);
        const label = job ? `${job.title} at ${job.company}` : "this job";
        const full = await capReached(ctx, userId);
        if (full) return { ok: false, message: `Today's limit of ${full.cap} applications is used up. Raise it in Settings, or apply in the app.` };

        const { application: app } = await startApplication(ctx, userId, jobId);
        switch (app.status) {
          case "queued":
          case "preparing": {
            // The tap is the approval: it counts against today's cap now, and the worker sends it once it is prepared.
            const now = ctx.now();
            const marked = await ctx.db.update(applications).set({ approvedAt: now, updatedAt: now })
              .where(and(eq(applications.id, app.id), isNull(applications.approvedAt))).returning({ id: applications.id });
            if (marked.length) await logEvent(ctx.db, app.id, "approved", "Approved from Telegram; it will be sent once prepared", { data: { approvedBy: "user", via: "telegram" } });
            await recordApplyIntent(ctx.db, userId, app.id, now);
            return { ok: true, message: `Preparing ${label}. It will be sent when ready.` };
          }
          case "prepared":
          case "needs_user": {
            const res = await approveApplication(ctx, app);
            if (res.ok) return { ok: true, message: `Applying to ${label}.` };
            return { ok: true, message: `Approved ${label}. It needs your answers first; they come in a separate message.` };
          }
          case "applying":
          case "awaiting_code":
            return { ok: true, message: `Already applying to ${label}.` };
          case "submitted":
            return { ok: true, message: `Already submitted ${label}.` };
          case "failed":
            return { ok: false, message: `The last try at ${label} failed. Open it in the app to retry.` };
        }
      } catch (err) {
        return { ok: false, message: reason(err) };
      }
    },
    async skip(userId, jobId) {
      try {
        await dismissShortlistJob(ctx, userId, jobId);
        return { ok: true, message: "Skipped." };
      } catch (err) {
        return { ok: false, message: reason(err) };
      }
    },
    async answer(userId, applicationId, answers) {
      try {
        const app = await ownedApplication(ctx.db, userId, applicationId);
        const res = await answerApplication(ctx, userId, app, answers);
        return { ok: true, status: res.status, resumed: res.resumed };
      } catch (err) {
        ctx.log(`[telegram] answer failed: ${reason(err)}`);
        return { ok: false };
      }
    },
  };
}

/** Client, send queue and update handler for this API process. Null when the bot is not configured. */
export function createTelegramRuntime(ctx: Ctx): TelegramRuntime | null {
  if (!telegramConfigured(ctx)) return null;
  const token = ctx.config.telegramBotToken!;
  const secret = ctx.config.sessionSecret!;
  const client = createBotClient({ token, ...(ctx.telegram?.fetch ? { fetch: ctx.telegram.fetch } : {}) });
  const queue = new SendQueue(ctx.telegram?.perChatIntervalMs !== undefined ? { perChatIntervalMs: ctx.telegram.perChatIntervalMs } : {});
  const handle = createUpdateHandler({
    db: ctx.db, client, queue, secret, webUrl: ctx.config.webUrl, now: ctx.now,
    log: (event, fields) => ctx.log(`[telegram] ${event} ${JSON.stringify(fields ?? {})}`),
    actions: telegramActions(ctx),
  });
  return { client, queue, webhookSecret: webhookSecret(secret, token), handle };
}
