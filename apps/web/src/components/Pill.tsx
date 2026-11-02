import type { ReactNode } from "react";
import type { Tone } from "@/lib/format";
import { cx } from "./cx";
import { Square, type MarkTone } from "./IndexLabel";

/** Older tone names, mapped onto the four meanings. */
export const TONE_MARK: Record<Tone, MarkTone> = {
  amber: "accent",
  orange: "accent",
  green: "ink",
  teal: "ink",
  blue: "hollow",
  red: "outline",
  slate: "muted",
};

/**
 * Pill fill per meaning. Waiting on you is the only pill with an edge; a good outcome is a blue tint;
 * in progress and parked stay neutral; failed is brick.
 */
export const PILL_TONE: Record<MarkTone | "none", string> = {
  ink: "bg-accent-tint text-accent-fg",
  accent: "bg-attn-tint text-attn-fg ring-1 ring-inset ring-attn",
  hollow: "bg-sunken text-ink",
  outline: "bg-danger-tint text-danger-fg",
  muted: "bg-sunken text-muted",
  none: "bg-sunken text-ink",
};

/** Status pill: a word first, an optional dot, the tint carries the meaning. */
export function Pill({ children, mark = "muted", pulse, className, title }: {
  children: ReactNode; mark?: MarkTone | "none"; pulse?: boolean; className?: string; title?: string;
}) {
  return (
    <span title={title} className={cx("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium", PILL_TONE[mark], className)}>
      {mark === "hollow" && <Square tone="hollow" size={6} pulse={pulse} />}
      {children}
    </span>
  );
}

/** Outlined tag for provenance, skills and metadata. Optional `kind` prefix in muted text. */
export function Tag({ children, kind, mark, className, interactive }: {
  children: ReactNode; kind?: ReactNode; mark?: MarkTone; className?: string; interactive?: boolean;
}) {
  return (
    <span
      className={cx(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-[2px] text-[12px] leading-[1.4] text-ink-2",
        interactive && "transition-colors duration-150 hover:border-control hover:text-ink",
        className,
      )}
    >
      {mark && <Square tone={mark} size={6} />}
      {kind && <span className="text-muted">{kind}</span>}
      <span className="truncate">{children}</span>
    </span>
  );
}
