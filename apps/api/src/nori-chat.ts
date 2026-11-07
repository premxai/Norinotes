/**
 * The Nori chat (dashboard v2, the Nori page). The person talks to Nori; Nori answers about their matches and
 * applications and can change how it works for them: the threshold, the daily limit, roles, companies to skip, and
 * "apply now" (a batch of Recommended jobs). One small-model call per message, charged to the person's daily AI budget.
 * Every change comes back as an action with an undo id; nothing is changed silently. Schedules (autopilot) are not here.
 */
import { z } from "zod";
import { AiUnavailableError, BudgetExceededError, complete } from "@norinote/ai";
import { and, applications, asc, companies, desc, eq, gte, jobs, lanes, lt, noriChatMessages, noriChatUndo, shortlist, sql, type Db } from "@norinote/db";
import { getNoriSettings, getSchedule, nextRunOn, recommendedJobIds, saveNoriSettings, saveSchedule, startBatch, stopBatch, type NoriSchedule } from "@norinote/apply";

export type ChatAction = { kind: string; summary: string; undoId: string | null };
export type ChatMessageView = { id: string; role: "user" | "nori"; text: string; actions: ChatAction[]; createdAt: string };

const Intent = z.object({
  reply: z.string(),
  actions: z.array(z.object({
    kind: z.enum(["set_threshold", "set_daily_limit", "add_role", "remove_role", "skip_company", "unskip_company", "apply_now", "schedule_on", "schedule_off"]),
    /** set_threshold: a percent 0-100; set_daily_limit: 1-100; apply_now: how many (1-50); roles/companies: the name. */
    value: z.string(),
  })),
});

const SYSTEM = `You are Nori, a friendly job-application agent inside Norinote. You talk with one person about their job search.
You can answer questions from the CONTEXT (their roles, threshold, daily limit, skipped companies, matches, applications).
You can change things only through actions; list each change the person clearly asked for, nothing they did not ask for:
- set_threshold: value = the minimum match percent 0-100 for "Recommended" and Apply for me.
- set_daily_limit: value = how many applications a day (1-100).
- add_role: value = a job title to look for (adds a role).
- remove_role: value = the role name exactly as listed in CONTEXT.
- skip_company / unskip_company: value = the company name.
- apply_now: value = how many Recommended jobs to send now (1-50, default 10). Only when they ask to apply or send now.
- schedule_on: value = the time "HH:MM" (24-hour) to apply every chosen day, or "" to keep the current time. Turns the schedule on.
- schedule_off: value = "". Pauses the schedule.
Never invent facts, jobs, numbers or applications that are not in CONTEXT.
Keep "reply" short (1-3 sentences), plain words, no markdown. Don't claim a change happened; the app lists the changes.`;

const view = (m: typeof noriChatMessages.$inferSelect): ChatMessageView => ({ id: m.id, role: m.role, text: m.text, actions: m.actions, createdAt: m.createdAt.toISOString() });

export async function chatHistory(db: Db, userId: string, opts: { before?: Date; limit?: number } = {}): Promise<ChatMessageView[]> {
  const rows = await db.select().from(noriChatMessages)
    .where(and(eq(noriChatMessages.userId, userId), opts.before ? lt(noriChatMessages.createdAt, opts.before) : undefined))
    .orderBy(desc(noriChatMessages.createdAt), desc(noriChatMessages.id)).limit(Math.min(opts.limit ?? 50, 200));
  return rows.reverse().map(view);
}

/** What Nori knows when it answers: settings, roles, counts and the latest applications. No secrets, no other people. */
async function contextFor(db: Db, userId: string, now: Date): Promise<string> {
  const settings = await getNoriSettings(db, userId);
  const roles = await db.select({ name: lanes.name, titles: lanes.titles, enabled: lanes.enabled }).from(lanes).where(eq(lanes.userId, userId)).orderBy(asc(lanes.createdAt));
  const [counts] = await db.select({
    matches: sql<number>`count(*) filter (where ${shortlist.status} = 'new')::int`,
    recommended: sql<number>`count(*) filter (where ${shortlist.status} = 'new' and ${shortlist.fit} >= ${settings.minFit})::int`,
  }).from(shortlist).where(eq(shortlist.userId, userId));
  const recent = await db.select({ title: jobs.title, company: companies.name, status: applications.status, at: applications.updatedAt })
    .from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId)).innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(eq(applications.userId, userId)).orderBy(desc(applications.updatedAt)).limit(8);
  const sentToday = await db.select({ n: sql<number>`count(*)::int` }).from(applications)
    .where(and(eq(applications.userId, userId), gte(applications.submittedAt, new Date(now.getTime() - 86_400_000))));
  return [
    `Threshold: ${Math.round(settings.minFit * 100)}%. Daily limit: ${settings.dailyLimit}. Minutes between applications: ${settings.spacingMinutes}.`,
    `Roles: ${roles.length ? roles.map((r) => `${r.name} (${r.titles.join(", ")})${r.enabled ? "" : " [off]"}`).join("; ") : "none"}.`,
    `Companies skipped: ${settings.skipCompanies.length ? settings.skipCompanies.join(", ") : "none"}.`,
    `Matches waiting: ${counts?.matches ?? 0}, of which Recommended (at or above the threshold): ${counts?.recommended ?? 0}. Sent in the last 24 hours: ${sentToday[0]?.n ?? 0}.`,
    `Latest applications: ${recent.length ? recent.map((a) => `${a.title} at ${a.company}: ${a.status}`).join("; ") : "none"}.`,
    `Apply for me sends Greenhouse jobs only for now.`,
    await scheduleLine(db, userId, now),
  ].join("\n");
}

async function scheduleLine(db: Db, userId: string, now: Date): Promise<string> {
  const s = await getSchedule(db, userId);
  if (!s.enabled) return "Schedule: off.";
  return `Schedule: ${s.paused ? "paused" : "on"}, ${s.days.join(" ")} at ${s.time} (${s.timezone}); next run ${nextRunOn(s, now) ?? "none"}.`;
}

async function remember(db: Db, userId: string, kind: string, before: Record<string, unknown>): Promise<string> {
  const [row] = await db.insert(noriChatUndo).values({ userId, kind, before }).returning({ id: noriChatUndo.id });
  return row!.id;
}

type Deps = { now: Date; atsTypes: readonly string[] | null; enqueuePrepare: (applicationId: string) => Promise<unknown>; enqueueMatch: () => Promise<unknown> };

/** Carries out one action; returns what it did (with its undo id), or null when there was nothing to do. */
async function act(db: Db, userId: string, a: z.infer<typeof Intent>["actions"][number], deps: Deps): Promise<ChatAction | null> {
  const settings = await getNoriSettings(db, userId);
  const value = a.value.trim();
  switch (a.kind) {
    case "set_threshold": {
      const pct = Number.parseFloat(value.replace("%", ""));
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
      const undoId = await remember(db, userId, a.kind, { minFit: settings.minFit });
      await saveNoriSettings(db, userId, { minFit: Math.round(pct) / 100 });
      await deps.enqueueMatch();
      return { kind: a.kind, summary: `Threshold set to ${Math.round(pct)}% (was ${Math.round(settings.minFit * 100)}%)`, undoId };
    }
    case "set_daily_limit": {
      const n = Number.parseInt(value, 10);
      if (!Number.isInteger(n) || n < 1 || n > 100) return null;
      const undoId = await remember(db, userId, a.kind, { dailyLimit: settings.dailyLimit });
      await saveNoriSettings(db, userId, { dailyLimit: n });
      return { kind: a.kind, summary: `Daily limit set to ${n} (was ${settings.dailyLimit})`, undoId };
    }
    case "add_role": {
      const title = value.slice(0, 100);
      if (!title) return null;
      const [row] = await db.insert(lanes).values({ userId, name: title, titles: [title], locations: [], remote: true, minFit: settings.minFit, enabled: true, createdAt: deps.now }).returning({ id: lanes.id });
      const undoId = await remember(db, userId, a.kind, { laneId: row!.id });
      await deps.enqueueMatch();
      return { kind: a.kind, summary: `Added the role "${title}"`, undoId };
    }
    case "remove_role": {
      const [lane] = await db.select().from(lanes).where(and(eq(lanes.userId, userId), sql`lower(${lanes.name}) = lower(${value})`)).limit(1);
      if (!lane) return null;
      const undoId = await remember(db, userId, a.kind, { lane: { ...lane, createdAt: lane.createdAt.toISOString() } });
      await db.delete(lanes).where(eq(lanes.id, lane.id));
      await deps.enqueueMatch();
      return { kind: a.kind, summary: `Removed the role "${lane.name}"`, undoId };
    }
    case "skip_company":
    case "unskip_company": {
      if (!value) return null;
      const has = settings.skipCompanies.some((c) => c.toLowerCase() === value.toLowerCase());
      const next = a.kind === "skip_company" ? (has ? null : [...settings.skipCompanies, value]) : (has ? settings.skipCompanies.filter((c) => c.toLowerCase() !== value.toLowerCase()) : null);
      if (!next) return null;
      const undoId = await remember(db, userId, "skip_list", { skipCompanies: settings.skipCompanies });
      await saveNoriSettings(db, userId, { skipCompanies: next });
      await deps.enqueueMatch();
      return { kind: a.kind, summary: a.kind === "skip_company" ? `Skipping ${value} from now on` : `No longer skipping ${value}`, undoId };
    }
    case "apply_now": {
      const n = Math.min(Math.max(Number.parseInt(value, 10) || 10, 1), 50);
      const ids = await recommendedJobIds(db, userId, { now: deps.now, limit: n, atsTypes: deps.atsTypes });
      if (!ids.length) return { kind: a.kind, summary: "No Recommended jobs to send right now", undoId: null };
      const res = await startBatch(db, userId, ids, { now: deps.now, atsTypes: deps.atsTypes });
      if (!res.batchId) return { kind: a.kind, summary: "None of the Recommended jobs could be sent", undoId: null };
      for (const x of res.added) if (x.created) await deps.enqueuePrepare(x.applicationId);
      const undoId = await remember(db, userId, a.kind, { batchId: res.batchId });
      return { kind: a.kind, summary: `Started Apply for me with ${res.added.length} Recommended job${res.added.length === 1 ? "" : "s"}`, undoId };
    }
    case "schedule_on":
    case "schedule_off": {
      const before = await getSchedule(db, userId);
      const time = a.kind === "schedule_on" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : before.time;
      const next: Partial<NoriSchedule> = a.kind === "schedule_on" ? { enabled: true, paused: false, time } : { paused: true };
      if (a.kind === "schedule_off" && (!before.enabled || before.paused)) return null;
      const undoId = await remember(db, userId, "schedule", { enabled: before.enabled, paused: before.paused, time: before.time });
      const saved = await saveSchedule(db, userId, next);
      return {
        kind: a.kind, undoId,
        summary: a.kind === "schedule_on" ? `Schedule on: ${saved.days.join(" ")} at ${saved.time} (${saved.timezone})` : "Schedule paused",
      };
    }
  }
}

/** One turn: store the person's message, ask the model, carry out the actions, store Nori's reply. */
export async function chatTurn(db: Db, userId: string, message: string, deps: Deps): Promise<{ message: ChatMessageView; reply: ChatMessageView }> {
  const [mine] = await db.insert(noriChatMessages).values({ userId, role: "user", text: message, createdAt: deps.now }).returning();
  const history = (await chatHistory(db, userId, { limit: 9 })).slice(0, -1);
  let text: string;
  const actions: ChatAction[] = [];
  try {
    const res = await complete({
      tier: "small", system: SYSTEM, prefix: `CONTEXT\n${await contextFor(db, userId, deps.now)}`,
      input: `${history.map((m) => `${m.role === "user" ? "Person" : "Nori"}: ${m.text}`).join("\n")}\nPerson: ${message}`.trim(),
      schema: Intent, schemaName: "nori_chat", strict: true, userId, db, maxOutputTokens: 600,
    });
    text = res.output.reply.trim() || "Done.";
    for (const a of res.output.actions.slice(0, 5)) {
      const done = await act(db, userId, a, deps);
      if (done) actions.push(done);
    }
  } catch (err) {
    if (err instanceof BudgetExceededError) text = "I've used today's AI budget for chatting. Everything else keeps working; we can talk again tomorrow.";
    else if (err instanceof AiUnavailableError) text = "I can't think right now (the AI service is unavailable). Try again in a few minutes.";
    else throw err;
  }
  const [reply] = await db.insert(noriChatMessages).values({ userId, role: "nori", text, actions, createdAt: new Date(deps.now.getTime() + 1) }).returning();
  return { message: view(mine!), reply: view(reply!) };
}

/** Puts back what one chat change replaced. Each undo works once. */
export async function undoChatAction(db: Db, userId: string, undoId: string, deps: Pick<Deps, "now" | "enqueueMatch">): Promise<{ ok: boolean; summary: string }> {
  const [u] = await db.select().from(noriChatUndo).where(and(eq(noriChatUndo.id, undoId), eq(noriChatUndo.userId, userId))).limit(1);
  if (!u) return { ok: false, summary: "Nothing to undo" };
  if (u.undoneAt) return { ok: false, summary: "Already undone" };
  const b = u.before;
  let summary = "Undone";
  switch (u.kind) {
    case "set_threshold":
      await saveNoriSettings(db, userId, { minFit: Number(b.minFit) });
      await deps.enqueueMatch();
      summary = `Threshold back to ${Math.round(Number(b.minFit) * 100)}%`;
      break;
    case "set_daily_limit":
      await saveNoriSettings(db, userId, { dailyLimit: Number(b.dailyLimit) });
      summary = `Daily limit back to ${b.dailyLimit}`;
      break;
    case "add_role":
      await db.delete(lanes).where(and(eq(lanes.id, String(b.laneId)), eq(lanes.userId, userId)));
      await deps.enqueueMatch();
      summary = "Removed the role again";
      break;
    case "remove_role": {
      const lane = b.lane as typeof lanes.$inferSelect & { createdAt: string };
      await db.insert(lanes).values({ ...lane, createdAt: new Date(lane.createdAt) }).onConflictDoNothing();
      await deps.enqueueMatch();
      summary = `Put the role "${lane.name}" back`;
      break;
    }
    case "skip_list":
      await saveNoriSettings(db, userId, { skipCompanies: b.skipCompanies as string[] });
      await deps.enqueueMatch();
      summary = "Companies to skip put back as they were";
      break;
    case "schedule":
      await saveSchedule(db, userId, { enabled: b.enabled === true, paused: b.paused === true, time: String(b.time) });
      summary = "Schedule put back as it was";
      break;
    case "apply_now": {
      const res = await stopBatch(db, userId, String(b.batchId), { now: deps.now });
      summary = res.ok ? `Stopped that batch (${res.cancelled} not sent)` : "That batch was already gone";
      break;
    }
    default:
      return { ok: false, summary: "Nothing to undo" };
  }
  await db.update(noriChatUndo).set({ undoneAt: deps.now }).where(eq(noriChatUndo.id, u.id));
  return { ok: true, summary };
}
