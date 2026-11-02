import { cx } from "./cx";

/** Company avatar: the initial on a quiet warm tile. No per-company colour, so colour keeps its meaning elsewhere. */
export function Monogram({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      className={cx("inline-flex shrink-0 items-center justify-center rounded-control border border-line bg-sunken font-semibold text-ink-2", className)}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
