/**
 * The tracker's flow (GET /api/applications/flow): where a person's applications went, as nodes and links ready for a
 * Sankey diagram. Each application follows one path:
 *
 *   Started -> Sent | Needs you | In progress | Cancelled | Failed
 *   Sent    -> Interview | Replied | Rejected | No reply yet | No reply (silence past SILENCE_DAYS)
 *   Replied -> Interview is not double counted: an interview wins over a reply; a rejection after a reply ends at Rejected
 *   Interview -> Offer | Rejected | Still interviewing
 *
 * Outcomes come from the `outcomes` table (inbox-read or added by hand; removed ones are ignored).
 */
import { and, applications, eq, gte, inArray, isNull, outcomes, type Db } from "@norinote/db";

export const SILENCE_DAYS = 30;
const CANCELLED = "Cancelled by you";

export type FlowNode = { id: string; label: string; count: number; stage: 0 | 1 | 2 | 3 };
export type FlowLink = { source: string; target: string; value: number };
export type ApplicationFlow = { since: string | null; total: number; nodes: FlowNode[]; links: FlowLink[] };

const LABELS: Record<string, [string, FlowNode["stage"]]> = {
  started: ["Started", 0],
  sent: ["Sent", 1], needs_you: ["Needs you", 1], in_progress: ["In progress", 1], cancelled: ["Cancelled", 1], failed: ["Failed", 1],
  interview: ["Interview", 2], replied: ["Replied", 2], rejected: ["Rejected", 2], waiting: ["No reply yet", 2], silent: ["No reply", 2],
  offer: ["Offer", 3], rejected_after_interview: ["Rejected", 3], interviewing: ["Still interviewing", 3],
};

export async function applicationFlow(db: Db, userId: string, opts: { now: Date; days?: number | null }): Promise<ApplicationFlow> {
  const since = opts.days ? new Date(opts.now.getTime() - opts.days * 86_400_000) : null;
  const apps = await db.select({ id: applications.id, status: applications.status, error: applications.error, submittedAt: applications.submittedAt })
    .from(applications)
    .where(and(eq(applications.userId, userId), since ? gte(applications.createdAt, since) : undefined));
  const ids = apps.map((a) => a.id);
  const rows = ids.length
    ? await db.select({ applicationId: outcomes.applicationId, kind: outcomes.kind }).from(outcomes)
      .where(and(inArray(outcomes.applicationId, ids), isNull(outcomes.deletedAt)))
    : [];
  const kinds = new Map<string, Set<string>>();
  for (const r of rows) kinds.set(r.applicationId, (kinds.get(r.applicationId) ?? new Set()).add(r.kind));

  const links = new Map<string, number>();
  const counts = new Map<string, number>();
  const step = (from: string, to: string) => {
    links.set(`${from}>${to}`, (links.get(`${from}>${to}`) ?? 0) + 1);
    counts.set(to, (counts.get(to) ?? 0) + 1);
  };

  for (const a of apps) {
    counts.set("started", (counts.get("started") ?? 0) + 1);
    if (a.status !== "submitted") {
      const first = a.status === "needs_user" ? "needs_you"
        : a.status === "failed" ? (a.error === CANCELLED ? "cancelled" : "failed")
        : "in_progress";
      step("started", first);
      continue;
    }
    step("started", "sent");
    const k = kinds.get(a.id) ?? new Set<string>();
    if (k.has("interview") || k.has("offer")) {
      step("sent", "interview");
      step("interview", k.has("offer") ? "offer" : k.has("rejection") ? "rejected_after_interview" : "interviewing");
    } else if (k.has("rejection")) {
      step("sent", "rejected");
    } else if (k.has("reply")) {
      step("sent", "replied");
    } else {
      const age = a.submittedAt ? (opts.now.getTime() - a.submittedAt.getTime()) / 86_400_000 : 0;
      step("sent", age >= SILENCE_DAYS ? "silent" : "waiting");
    }
  }

  const nodes: FlowNode[] = [...counts.entries()].filter(([, n]) => n > 0)
    .map(([id, count]) => ({ id, label: LABELS[id]![0], count, stage: LABELS[id]![1] }))
    .sort((x, y) => x.stage - y.stage || y.count - x.count);
  return {
    since: since ? since.toISOString() : null,
    total: apps.length,
    nodes,
    links: [...links.entries()].map(([key, value]) => { const [source, target] = key.split(">") as [string, string]; return { source, target, value }; }),
  };
}
