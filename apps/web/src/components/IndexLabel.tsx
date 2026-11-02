import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * Marker tones, by meaning:
 *   ink     = done or a good outcome (accent blue)
 *   accent  = waiting on you (orange)
 *   hollow  = Norinote is working on it (muted ring)
 *   outline = failed (brick)
 *   muted   = parked, skipped, closed
 */
export type MarkTone = "ink" | "accent" | "muted" | "hollow" | "outline";

/** Small round marker. Never the only signal: always sits next to a word. */
export function Square({ tone = "ink", size = 7, pulse, className }: { tone?: MarkTone; size?: number; pulse?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cx(
        "inline-block shrink-0 rounded-full",
        tone === "ink" && "bg-accent",
        tone === "accent" && "bg-attn",
        tone === "muted" && "bg-control",
        tone === "hollow" && "border-[1.5px] border-muted",
        tone === "outline" && "bg-danger",
        pulse && "animate-pulse",
        className,
      )}
    />
  );
}

/**
 * Small section label in sentence case. The old "01" index numbers are gone: `index` is accepted and ignored
 * so older callers still compile. `marker` adds a dot before the label.
 */
export function IndexLabel({ index, marker, children, className, tone = "muted" }: {
  index?: string | number;
  marker?: boolean | MarkTone;
  children?: ReactNode;
  className?: string;
  tone?: "muted" | "ink";
}) {
  void index;
  return (
    <span className={cx("inline-flex items-center gap-2 text-meta font-medium", tone === "ink" ? "text-ink" : "text-muted", className)}>
      {marker && marker !== true && marker !== "ink" && <Square tone={marker} />}
      {children}
    </span>
  );
}
