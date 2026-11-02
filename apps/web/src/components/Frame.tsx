import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";

type FrameTag = "div" | "section" | "article" | "aside" | "li" | "figure" | "header";

/** Retired decoration. Kept as a no-op so older callers still compile. */
export function Ticks(props: { className?: string }) {
  void props;
  return null;
}

/**
 * The base surface: a flat warm card with a faint edge, no shadow.
 * `surface="paper"` (default) is the card colour, `"stone"` a sunken tone, `"none"` a dashed outline on the page.
 * `tone="attn"` draws the orange edge that means "you must act before Norinote continues".
 */
export function Frame({ as: Tag = "div", children, className, ticks, surface = "paper", tone, pad, id, style }: {
  as?: FrameTag;
  children?: ReactNode;
  className?: string;
  /** Ignored; kept for older callers. */
  ticks?: boolean;
  surface?: "paper" | "none" | "stone";
  tone?: "attn";
  /** Shorthand padding: "sm" 16px, "md" 20px, "lg" 28px. Omit to pad yourself. */
  pad?: "sm" | "md" | "lg";
  id?: string;
  style?: CSSProperties;
}) {
  void ticks;
  return (
    <Tag
      id={id}
      style={style}
      className={cx(
        "relative rounded-card",
        surface === "paper" && "border border-line bg-surface",
        surface === "stone" && "bg-sunken",
        surface === "none" && "border border-dashed border-line",
        tone === "attn" && "border-2 border-attn",
        pad === "sm" && "p-4",
        pad === "md" && "p-5",
        pad === "lg" && "p-6 sm:p-7",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
