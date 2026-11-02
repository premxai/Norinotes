import { pct } from "@/lib/format";
import { cx } from "./cx";

/** Compact "84% match" badge for rows and lists. Blue at 70% and above, neutral below. `size` is kept for callers. */
export function MatchBadge({ score, className }: { score: number | null | undefined; size?: "sm" | "md" | "lg"; className?: string }) {
  if (score == null) return <span className={cx("text-meta text-muted", className)}>Not scored</span>;
  const p = pct(score);
  return (
    <span title={`${p}% match with your career graph`} className={cx("inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[12px] font-semibold tnum", p >= 70 ? "bg-accent-tint text-accent-fg" : "bg-sunken text-ink-2", className)}>
      {p}% match
    </span>
  );
}
