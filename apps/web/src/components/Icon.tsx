import type { LucideIcon, LucideProps } from "lucide-react";
import { cx } from "./cx";

/**
 * The one way to draw an icon: lucide at 16px, 1.5 stroke, currentColor (ink unless the parent says otherwise).
 * Decorative by default; pass `aria-label` + `aria-hidden={false}` when the icon carries meaning on its own.
 */
export function Icon({ icon: I, size = 16, strokeWidth = 1.5, className, ...rest }: { icon: LucideIcon } & Omit<LucideProps, "ref">) {
  return <I size={size} strokeWidth={strokeWidth} aria-hidden="true" className={cx("shrink-0", className)} {...rest} />;
}
