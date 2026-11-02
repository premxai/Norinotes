import { CircleAlert, CircleCheck, CircleX, ClipboardCheck, Clock, KeyRound, PenLine, Send, type LucideIcon } from "lucide-react";
import { STATUS_LABEL } from "@/lib/format";
import type { ApplicationStatus } from "@/lib/types";
import { cx } from "./cx";
import { Icon } from "./Icon";
import type { MarkTone } from "./IndexLabel";

/**
 * Status -> meaning. accent = waiting on you (orange edge); ink = sent (blue tint); hollow = Norinote is working;
 * outline = failed (brick).
 */
export const STATUS_MARK: Record<ApplicationStatus, MarkTone> = {
  queued: "hollow",
  preparing: "hollow",
  applying: "hollow",
  awaiting_code: "hollow",
  prepared: "accent",
  needs_user: "accent",
  submitted: "ink",
  failed: "outline",
};

export const STATUS_ICON: Record<ApplicationStatus, LucideIcon> = {
  queued: Clock,
  preparing: PenLine,
  prepared: ClipboardCheck,
  applying: Send,
  awaiting_code: KeyRound,
  submitted: CircleCheck,
  needs_user: CircleAlert,
  failed: CircleX,
};

const STYLE: Record<MarkTone, string> = {
  accent: "bg-attn-tint text-attn-fg ring-1 ring-inset ring-attn",
  ink: "bg-accent-tint text-accent-fg",
  hollow: "bg-sunken text-ink",
  outline: "bg-danger-tint text-danger-fg",
  muted: "bg-sunken text-muted",
};

/**
 * Stage pill: icon plus word. Working stages show an icon that breathes.
 */
export function StatusPill({ status, className }: { status: ApplicationStatus | string; className?: string }) {
  const s = status as ApplicationStatus;
  const mark = STATUS_MARK[s] ?? "muted";
  const working = s === "preparing" || s === "applying";
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full pl-2 pr-2.5 text-[12px] font-medium",
        STYLE[mark],
        className,
      )}
    >
      <Icon icon={STATUS_ICON[s] ?? Clock} size={14} className={cx(working && "animate-pulse")} />
      {STATUS_LABEL[s] ?? status}
    </span>
  );
}
