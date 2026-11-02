import { Calendar, Ban, Check, FileCheck, Gauge, HelpCircle, ListPlus, Reply, Search, Send, type LucideIcon } from "lucide-react";
import type { AgentActivity, AgentActivityKind } from "@/lib/types";

export const KIND_ICON: Record<AgentActivityKind, LucideIcon> = {
  discovered: Search,
  scored: Gauge,
  queued: ListPlus,
  skipped: Ban,
  prepared: FileCheck,
  approved: Check,
  submitted: Send,
  needs_user: HelpCircle,
  reply: Reply,
  interview: Calendar,
};

export const KIND_LABEL: Record<AgentActivityKind, string> = {
  discovered: "Discovered",
  scored: "Scored",
  queued: "Queued",
  skipped: "Skipped",
  prepared: "Ready",
  approved: "Approved",
  submitted: "Submitted",
  needs_user: "Needs you",
  reply: "Reply",
  interview: "Interview",
};

/** "20 min ago" style, one unit, for the agent feed. */
export function ago(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "never";
  const m = Math.round(Math.max(0, now - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function inMin(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "-";
  const m = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (m <= 0) return "now";
  if (m < 60) return `${m} min`;
  return `${Math.round(m / 60)} h`;
}

/** One line per entry. */
export function headline(a: AgentActivity): string {
  return a.message.split(/\r?\n/)[0];
}
