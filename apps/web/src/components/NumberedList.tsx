import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./cx";

export type NumberedItem = {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
  aside?: ReactNode;
  /** A leading marker (a dot, an icon). */
  marker?: ReactNode;
  href?: string;
};

/** A plain list of rows with faint separators. The old 01, 02 numbering is gone; `start` is kept for callers. */
export function NumberedList({ items, dense, className, empty }: {
  items: NumberedItem[]; start?: number; dense?: boolean; className?: string; empty?: ReactNode;
}) {
  if (items.length === 0 && empty) return <p className="py-6 text-body-sm text-muted">{empty}</p>;
  return (
    <ul className={cx("divide-y divide-line", className)}>
      {items.map((it) => (
        <li key={it.id} className={cx("flex items-start gap-3", dense ? "py-2.5" : "py-3.5")}>
          {it.marker && <span className="mt-1 shrink-0">{it.marker}</span>}
          <div className="min-w-0 flex-1">
            {it.href ? (
              <Link href={it.href} className="text-body-sm font-medium text-ink underline-offset-4 hover:underline">{it.title}</Link>
            ) : (
              <div className={cx("text-ink", dense ? "text-meta" : "text-body-sm font-medium")}>{it.title}</div>
            )}
            {it.meta && <div className="mt-0.5 text-meta text-muted">{it.meta}</div>}
          </div>
          {it.aside && <div className="shrink-0 self-center text-right">{it.aside}</div>}
        </li>
      ))}
    </ul>
  );
}
