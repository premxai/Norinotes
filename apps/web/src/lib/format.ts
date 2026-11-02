import type { Application, ApplicationStatus, InboxKind } from "./types";

export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "-";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "-";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Accepts 0..1 or 0..100 and returns a whole percentage. */
export function pct(score: number | null | undefined): number {
  if (score == null) return 0;
  return Math.round(score <= 1 ? score * 100 : score);
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour12: false });
}

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  queued: "Queued",
  preparing: "Preparing",
  prepared: "Ready to send",
  applying: "Sending",
  awaiting_code: "Awaiting code",
  submitted: "Submitted",
  needs_user: "Needs you",
  failed: "Failed",
};

export type Tone = "slate" | "blue" | "amber" | "green" | "red" | "teal" | "orange";

export const STATUS_TONE: Record<ApplicationStatus, Tone> = {
  queued: "slate",
  preparing: "blue",
  prepared: "amber",
  applying: "blue",
  awaiting_code: "blue",
  submitted: "green",
  needs_user: "orange",
  failed: "red",
};

/** Applications tabs. `prepared` waits for the person's click; `needs_user` waits for an answer. */
export const IN_FLIGHT: ApplicationStatus[] = ["queued", "preparing", "applying", "awaiting_code"];
export const NEEDS_YOU: ApplicationStatus[] = ["prepared", "needs_user"];
export const SUBMITTED: ApplicationStatus[] = ["submitted"];
export const FAILED: ApplicationStatus[] = ["failed"];

/** When an application last changed, for sorting. The API sends updatedAt; older rows fall back to what they have. */
export const appUpdatedAt = (a: Pick<Application, "updatedAt" | "submittedAt" | "approvedAt" | "preparedAt" | "createdAt">): string | undefined =>
  a.updatedAt ?? a.submittedAt ?? a.approvedAt ?? a.preparedAt ?? a.createdAt;

export const INBOX_LABEL: Record<InboxKind, string> = {
  verification_code: "Verification code",
  recruiter_reply: "Recruiter reply",
  interview: "Interview",
  rejection: "Rejection",
  offer: "Offer",
  confirmation: "Confirmation",
  other: "Other",
};

export const INBOX_TONE: Record<InboxKind, Tone> = {
  verification_code: "blue",
  recruiter_reply: "teal",
  interview: "green",
  rejection: "red",
  offer: "green",
  confirmation: "slate",
  other: "slate",
};

export const NODE_GROUPS: { type: string; label: string }[] = [
  { type: "role", label: "Roles" },
  { type: "company", label: "Companies" },
  { type: "project", label: "Projects" },
  { type: "skill", label: "Skills" },
  { type: "tool", label: "Tools" },
  { type: "metric", label: "Metrics" },
  { type: "education", label: "Education" },
  { type: "certification", label: "Certifications" },
  { type: "award", label: "Awards" },
  { type: "publication", label: "Publications" },
  { type: "language", label: "Languages" },
  { type: "person", label: "People" },
];
