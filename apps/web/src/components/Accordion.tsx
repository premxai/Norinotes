import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "./cx";
import { Icon } from "./Icon";

/** Disclosure chevron; rotates when the parent <details> (a `group`) opens. */
export function SquareToggle({ className }: { className?: string }) {
  return <Icon icon={ChevronDown} className={cx("text-muted transition-transform duration-150 ease-[var(--ease)] group-open:rotate-180", className)} />;
}

/** Native <details> disclosure in a card. Works in server components. `index` is ignored (kept for older callers). */
export function Accordion({ title, meta, children, defaultOpen, className }: {
  title: ReactNode; meta?: ReactNode; index?: string; children: ReactNode; defaultOpen?: boolean; className?: string;
}) {
  return (
    <details className={cx("group rounded-card border border-line bg-surface", className)} open={defaultOpen}>
      <summary className="flex min-h-12 cursor-pointer select-none items-center gap-3 rounded-card px-4 py-3 hover:bg-sunken/60">
        <span className="min-w-0 flex-1 text-body-sm font-medium text-ink">{title}</span>
        {meta != null && <span className="text-meta text-muted tnum">{meta}</span>}
        <SquareToggle />
      </summary>
      <div className="border-t border-line px-4 pb-4 pt-3">{children}</div>
    </details>
  );
}
