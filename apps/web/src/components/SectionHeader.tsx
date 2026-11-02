import type { ReactNode } from "react";
import { cx } from "./cx";
import type { MarkTone } from "./IndexLabel";

/**
 * Page or section header: title and one line of description on the left, actions on the right.
 * `size="xl"` + `as="h1"` is a page header; `"lg"` a section; `"md"` a block. `label`, `index`, `rule` and
 * `marker` are kept for older callers: the label shows as a small muted line above the title only when it
 * says something the title does not.
 */
export function SectionHeader({ label, title, description, actions, as: H = "h2", size = "lg", rule, className }: {
  index?: string | number;
  label?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: "h1" | "h2" | "h3";
  size?: "xl" | "lg" | "md";
  rule?: boolean;
  marker?: boolean | MarkTone;
  className?: string;
}) {
  const showLabel = label && typeof title === "string" && typeof label === "string" && label.toLowerCase() !== title.toLowerCase();
  return (
    <header className={cx("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", rule && "border-t border-line pt-5", className)}>
      <div className="min-w-0 max-w-[60ch]">
        {showLabel && <p className="mb-1 text-meta font-medium text-muted">{label}</p>}
        <H
          className={cx(
            "font-semibold text-balance text-ink",
            size === "xl" && "text-[1.75rem] leading-[1.15] tracking-[-0.02em] sm:text-display-xl",
            size === "lg" && "text-display-md sm:text-display-lg",
            size === "md" && "text-title",
          )}
        >
          {title}
        </H>
        {description && <p className="mt-1.5 text-body-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
