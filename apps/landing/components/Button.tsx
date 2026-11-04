import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "outline";

const BASE =
  "inline-flex min-h-[50px] items-center justify-center gap-2 rounded-full px-6 text-ui font-semibold no-underline " +
  "transition-[background-color,color,scale] duration-[var(--dur-fast)] ease-out active:scale-[0.98]";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  outline: "border-[1.5px] border-ink text-ink hover:bg-tint",
};

/** Spec section 7: one primary button per view; the outline button for everything else. */
export function buttonClass(variant: Variant = "primary", extra = "") {
  return `${BASE} ${VARIANTS[variant]} ${extra}`.trim();
}

export function ButtonLink({ href, variant = "primary", className = "", children }: { href: string; variant?: Variant; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={buttonClass(variant, className)}>
      {children}
    </Link>
  );
}

export function Button({ variant = "primary", className = "", type = "button", ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}
