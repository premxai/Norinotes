import { randomUUID } from "node:crypto";
import { and, applications, channelMessages, channels, eq, profiles, type Db } from "@norinote/db";
import { approveAndSubmit } from "@norinote/apply";
import { digestKeyboard, digestText, selectDigest } from "./digest.js";
import { codeNeededEvents, inboxEvents, needsUserEvents, submittedEvents, summaryEvent } from "./events.js";
import { flushOutbox, hasMessage, markSkipped, purgeOldMessages, queueMessage, type TelegramDeps } from "./outbox.js";
import { askedQuestions, buildQuestions, openQuestions, questionsKey, questionsKeyboard, questionsText } from "./questions.js";
import { readTelegramSettings } from "./settings.js";
import { packId } from "./signing.js";
import { localClock, toMinutes } from "./time.js";

export type NotifierDeps = TelegramDeps & {
  /** Queues `apply.run` (trigger `click`) for an application the user approved from Telegram. */
  enqueueApply: (applicationId: string) => Promise<unknown>;
};

/** Events older than this, or older than the link, are never announced (no backlog flood after linking). */
const EVENT_LOOKBACK_MS = 3 * 86_400_000;
/** An Apply tap whose application never got prepared is dropped after a day. */
const INTENT_TTL_MS = 86_400_000;

export type TickStats = { users: number; queued: number; sent: number; failed: number; applied: number };

/**
 * One pass: for every linked user, queue what is due (the daily shortlist at their time, new questions, events, the daily
 * summary), start applications approved from Telegram that are now prepared, then send what is due. Idempotent: every
 * message has a dedupe key, so running it twice sends nothing twice.
 */
export async function runTelegramTick(deps: NotifierDeps): Promise<TickStats> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const stats: TickStats = { users: 0, queued: 0, sent: 0, failed: 0, applied: 0 };

  const linked = await db.select({ userId: channels.userId, linkedAt: channels.createdAt, preferences: profiles.preferences })
    .from(channels).leftJoin(profiles, eq(profiles.userId, channels.userId)).where(eq(channels.kind, "telegram"));

  for (const ch of linked) {
    stats.users++;
    try {
      stats.queued += await queueDue(deps, ch.userId, ch.linkedAt, readTelegramSettings(ch.preferences), now);
    } catch (err) {
      deps.log?.("telegram.collect_failed", { userId: ch.userId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  stats.applied = await processApplyIntents(deps, now);
  const flushed = await flushOutbox({ ...deps, now: () => now });
  stats.sent = flushed.sent;
  stats.failed = flushed.failed;
  await purgeOldMessages(db, now);
  return stats;
}

async function queueDue(deps: NotifierDeps, userId: string, linkedAt: Date, settings: ReturnType<typeof readTelegramSettings>, now: Date): Promise<number> {
  const { db, secret, webUrl } = deps;
  const clock = localClock(now, settings.timezone);
  const since = new Date(Math.max(linkedAt.getTime(), now.getTime() - EVENT_LOOKBACK_MS));
  let queued = 0;
  const put = async (m: Omit<Parameters<typeof queueMessage>[1], "userId" | "settings" | "now">) => {
    if (await queueMessage(db, { ...m, userId, settings, now })) queued++;
  };

  // Daily shortlist: once per local day, from the chosen time on; nothing is sent on a day with nothing new.
  if (settings.events.digest && clock.minutes >= toMinutes(settings.dailyTime)) {
    const key = `digest:${clock.date}`;
    if (!(await hasMessage(db, userId, key))) {
      const items = await selectDigest(db, userId, settings.count, now);
      if (items.length === 0) await markSkipped(db, userId, "digest", key, now, "nothing new");
      else {
        await put({
          kind: "digest", dedupeKey: key,
          payload: { text: digestText(items), keyboard: digestKeyboard(items, [], { secret, userId, webUrl }), items, jobIds: items.map((i) => i.jobId), handled: [] },
        });
      }
    }
  }

  // Questions: one message for the open questions not asked before (the answers package batches them across applications).
  if (settings.events.questions) {
    const asked = await askedQuestions(db, userId, now);
    const open = (await openQuestions(db, userId, since)).filter((o) => !asked.has(`${o.applicationId}:${o.questionId}`));
    if (open.length > 0) {
      const key = `questions:${questionsKey(open)}`;
      if (!(await hasMessage(db, userId, key))) {
        const built = await buildQuestions(db, userId, open);
        if (built) {
          const id = randomUUID();
          await put({
            id, kind: "questions", dedupeKey: key, urgent: built.approved,
            payload: { text: questionsText(built, webUrl), keyboard: questionsKeyboard(built, { secret, userId, webUrl, messageId: packId(id) }), ...built },
          });
        }
      }
    }
  }

  const events = [
    ...(settings.events.submitted ? await submittedEvents(db, userId, since, webUrl) : []),
    ...(settings.events.needsUser ? await needsUserEvents(db, userId, since, webUrl) : []),
    ...(settings.events.needsUser ? await codeNeededEvents(db, userId, since, webUrl) : []),
    ...(settings.events.inbox ? await inboxEvents(db, userId, since, webUrl) : []),
  ];
  for (const e of events) await put(e);

  // Daily summary: at most once a day, from the chosen time on, only when something happened.
  if (settings.events.summary && clock.minutes >= toMinutes(settings.summaryTime)) {
    const key = `summary:${clock.date}`;
    if (!(await hasMessage(db, userId, key))) {
      const dayStart = new Date(now.getTime() - clock.minutes * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds());
      const e = await summaryEvent(db, userId, dayStart, clock.date, webUrl);
      if (e) await put(e); else await markSkipped(db, userId, "summary", key, now, "quiet day");
    }
  }
  return queued;
}

/** Records an Apply tap on an application that is still being prepared; the next tick starts it once it is prepared. */
export async function recordApplyIntent(db: Db, userId: string, applicationId: string, now: Date): Promise<void> {
  await db.insert(channelMessages).values({ userId, kind: "apply_intent", dedupeKey: `apply:${applicationId}`, applicationId, status: "pending", createdAt: now })
    .onConflictDoUpdate({ target: [channelMessages.userId, channelMessages.dedupeKey], set: { status: "pending", createdAt: now } });
}

async function processApplyIntents(deps: NotifierDeps, now: Date): Promise<number> {
  const { db } = deps;
  const intents = await db.select({ id: channelMessages.id, applicationId: channelMessages.applicationId, createdAt: channelMessages.createdAt, status: applications.status })
    .from(channelMessages).innerJoin(applications, eq(applications.id, channelMessages.applicationId))
    .where(and(eq(channelMessages.kind, "apply_intent"), eq(channelMessages.status, "pending"))).limit(200);
  let started = 0;
  for (const it of intents) {
    const done = (error?: string) => db.update(channelMessages).set({ status: "done", sentAt: now, ...(error ? { error } : {}) }).where(eq(channelMessages.id, it.id));
    if (it.status === "queued" || it.status === "preparing") {
      if (now.getTime() - it.createdAt.getTime() > INTENT_TTL_MS) await done("not prepared within a day");
      continue;
    }
    if (it.status === "prepared") {
      const res = await approveAndSubmit(db, it.applicationId!, { now });
      if (res.ok && res.started) { await deps.enqueueApply(it.applicationId!); started++; }
      await done(res.ok ? undefined : res.reason);
      continue;
    }
    // needs_user (the questions message takes over), already applying, submitted or failed: nothing left to start.
    await done();
  }
  return started;
}

/** Runs `runTelegramTick` every `everyMs` (default 30 s), never two at once. Returns a stop function. */
export function startTelegramNotifier(deps: NotifierDeps, opts: { everyMs?: number } = {}): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const s = await runTelegramTick(deps);
      if (s.queued || s.sent || s.failed || s.applied) deps.log?.("telegram.tick", s);
    } catch (err) {
      deps.log?.("telegram.tick_failed", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, opts.everyMs ?? 30_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
