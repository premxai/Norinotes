import type { Application, Outcomes, OutcomeKind } from "@/lib/api";

/*
 * What an application's row says (4b spec section 3): one state from its status and, once it's sent, its outcomes. Kept
 * apart from the components so the list, the application's page and the week strip agree.
 */

export type RowState = "applying" | "needs_you" | "failed" | "cancelled" | "offer" | "interview" | "reply" | "rejected" | "no_response" | "waiting" | "sent";
export type Group = "all" | "in_progress" | "sent" | "replied" | "closed";

const DAY_MS = 86_400_000;
const MOVING: Application["status"][] = ["queued", "preparing", "applying", "awaiting_code"];
export const isMoving = (a: Application) => MOVING.includes(a.status);
/** Dropped by the person (POST /applications/:id/cancel): failed, with exactly this error. Try again brings it back. */
export const isCancelled = (a: Application) => a.status === "failed" && a.error === "Cancelled by you";
/** Statuses that can still be cancelled: before Nori is on the employer's page. */
export const CANCELLABLE: Application["status"][] = ["queued", "preparing", "prepared", "needs_user"];
/** Sent, as the API counts it: submitted, or a submit time on record. */
export const isSent = (a: Application) => a.status === "submitted" || !!a.submittedAt;

/** First match wins; "sent" is a submitted row whose outcomes haven't loaded yet. */
export function rowState(a: Application, o: Outcomes | undefined): RowState {
  if (MOVING.includes(a.status)) return "applying";
  if (a.status === "prepared" || a.status === "needs_user") return "needs_you";
  if (a.status === "failed") return isCancelled(a) ? "cancelled" : "failed";
  if (!o?.state) return "sent";
  return o.state === "pending" ? "waiting" : o.state === "rejection" ? "rejected" : o.state;
}

export const GROUP_OF: Record<RowState, Exclude<Group, "all"> | null> = {
  applying: "in_progress",
  needs_you: "in_progress",
  waiting: "sent",
  sent: null,
  reply: "replied",
  interview: "replied",
  offer: "replied",
  rejected: "closed",
  no_response: "closed",
  failed: "closed",
  cancelled: "closed",
};

export const GROUPS: { id: Group; label: string }[] = [
  { id: "all", label: "All" },
  { id: "in_progress", label: "In progress" },
  { id: "sent", label: "Sent" },
  { id: "replied", label: "Replied" },
  { id: "closed", label: "Closed" },
];

/** The chip: always words; the colours carry no meaning of their own (section 8). */
export const CHIP: Record<RowState, { label: string; className: string }> = {
  applying: { label: "Applying", className: "bg-tint text-ink" },
  needs_you: { label: "Needs you", className: "bg-tint text-warning" },
  failed: { label: "Didn't go through", className: "bg-danger-tint text-danger" },
  cancelled: { label: "Cancelled", className: "border border-line text-ink-2" },
  offer: { label: "Offer", className: "bg-accent-tint text-accent" },
  interview: { label: "Interview", className: "bg-peach-tint text-ink" },
  reply: { label: "Reply", className: "bg-accent-tint text-accent" },
  rejected: { label: "Rejected", className: "bg-danger-tint text-ink" },
  no_response: { label: "No response", className: "border border-line text-ink-2" },
  waiting: { label: "Waiting", className: "bg-tint text-ink" },
  sent: { label: "Sent", className: "bg-tint text-ink" },
};

export const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
export const fullTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** Whole days from sending to the first outcome. */
function firstAfter(a: Application, o: Outcomes | undefined): number | null {
  const sent = a.submittedAt ?? o?.submittedAt;
  if (!sent || !o?.outcomes.length) return null;
  const first = Math.min(...o.outcomes.map((x) => Date.parse(x.at)));
  return Math.max(0, Math.round((first - Date.parse(sent)) / DAY_MS));
}
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** The line under a row's title. */
export function rowLine(a: Application, o: Outcomes | undefined, state: RowState): string {
  const sent = a.submittedAt ?? o?.submittedAt ?? null;
  const n = firstAfter(a, o);
  switch (state) {
    case "applying":
      return a.status === "applying" ? "Applying now" : a.status === "awaiting_code" ? "Waiting for an email code" : "Getting it ready";
    case "needs_you":
      if (a.status === "prepared") return "Ready for your OK";
      return a.pendingQuestions.length ? `Nori needs ${a.pendingQuestions.length} ${a.pendingQuestions.length === 1 ? "answer" : "answers"}` : "Needs you to finish it";
    case "failed":
      return a.submittedAt ? "Something went wrong after sending" : "Nothing was sent";
    case "cancelled":
      return "You cancelled it";
    case "reply":
      return n === null ? "Replied" : n === 0 ? "Replied the same day" : `Replied in ${days(n)}`;
    case "interview":
      return n === null ? "Interview invitation" : n === 0 ? "Interview invitation the same day" : `Interview invitation, ${days(n)} after sending`;
    case "offer":
      return n === null ? "An offer" : n === 0 ? "An offer the same day" : `An offer, ${days(n)} after sending`;
    case "rejected":
      return n === null ? "Rejected" : n === 0 ? "Rejected the same day" : `Rejected after ${days(n)}`;
    case "no_response":
      return sent ? `Sent ${shortDate(sent)} · no answer in 30 days` : "No answer in 30 days";
    default:
      return sent ? `Sent ${shortDate(sent)}` : "Sent";
  }
}

// ---- the week strip ---------------------------------------------------------------------------------------------------

export type Mark = "sent" | "reply" | "interview" | "rejection";
export const markOf = (k: OutcomeKind): Mark => (k === "offer" ? "reply" : k);

/** A local calendar day, "2026-11-04". */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Monday of the week that holds `d`, at midnight. */
export function mondayOf(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** What happened on each day: when each application was sent, and each outcome. Offers count with replies. */
export function marksByDay(rows: { application: Application }[], outcomes: Map<string, Outcomes>) {
  const out = new Map<string, { mark: Mark; appId: string; kind?: OutcomeKind }[]>();
  const add = (iso: string, mark: Mark, appId: string, kind?: OutcomeKind) => {
    const k = dayKey(new Date(iso));
    out.set(k, [...(out.get(k) ?? []), { mark, appId, kind }]);
  };
  for (const { application: a } of rows) {
    if (a.submittedAt) add(a.submittedAt, "sent", a.id);
    for (const x of outcomes.get(a.id)?.outcomes ?? []) add(x.at, markOf(x.kind), a.id, x.kind);
  }
  return out;
}

/** "2 sent, 1 interview" for screen readers. */
export function describeDay(marks: { mark: Mark; kind?: OutcomeKind }[]): string {
  if (!marks.length) return "nothing";
  const n = (f: (m: { mark: Mark; kind?: OutcomeKind }) => boolean) => marks.filter(f).length;
  const parts: [number, string, string][] = [
    [n((m) => m.mark === "sent"), "sent", "sent"],
    [n((m) => m.kind === "reply"), "reply", "replies"],
    [n((m) => m.kind === "offer"), "offer", "offers"],
    [n((m) => m.kind === "interview"), "interview", "interviews"],
    [n((m) => m.kind === "rejection"), "rejection", "rejections"],
  ];
  return parts.filter(([c]) => c > 0).map(([c, one, many]) => `${c} ${c === 1 ? one : many}`).join(", ");
}
