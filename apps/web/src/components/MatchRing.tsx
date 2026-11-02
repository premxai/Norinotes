import { pct } from "@/lib/format";
import { cx } from "./cx";

/**
 * Match score as a thin arc: ink below 70%, accent blue at 70% and above. A score is a reason to look, never a
 * verdict, so it carries no warning colour.
 */
export function MatchRing({ score, size = 44, className }: { score: number | null | undefined; size?: number; className?: string }) {
  if (score == null) {
    return (
      <span className={cx("inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-control text-[11px] text-muted", className)} style={{ width: size, height: size }}>
        n/a
      </span>
    );
  }
  const p = pct(score);
  const stroke = 3;
  const r = (size - stroke) / 2 - 1;
  const c = 2 * Math.PI * r;
  return (
    <span className={cx("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }} title={`${p}% match with your career graph`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p >= 70 ? "var(--accent)" : "var(--ink)"} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(c * p) / 100} ${c}`} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[12px] font-semibold leading-none text-ink tnum">{p}<span className="text-[0.75em] font-normal text-muted">%</span></span>
    </span>
  );
}
