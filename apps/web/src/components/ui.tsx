import Link from "next/link";
import { ArrowRight, ArrowUpRight, CircleAlert, CircleCheck, Info, type LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Tone } from "@/lib/format";
import { cx } from "./cx";
import { Frame } from "./Frame";
import { Icon } from "./Icon";
import { NorinoteMark } from "./Logo";
import { Pill, TONE_MARK } from "./Pill";
import { SectionHeader } from "./SectionHeader";

export { cx, idx } from "./cx";
export { Frame, Ticks } from "./Frame";
export { IndexLabel, Square, type MarkTone } from "./IndexLabel";
export { Pill, Tag, TONE_MARK } from "./Pill";
export { SectionHeader } from "./SectionHeader";
export { NumberedList, type NumberedItem } from "./NumberedList";
export { Accordion, SquareToggle } from "./Accordion";
export { Icon } from "./Icon";

/** A status-style pill keyed by an older tone name. Prefer <Pill mark> or <StatusPill>. */
export function Chip({ children, tone = "slate", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <Pill mark={TONE_MARK[tone]} className={className}>{children}</Pill>;
}

/** Page header: one title, one line of context, actions on the right. `label` and `index` are kept for older callers. */
export function PageHeader({ label, title, subtitle, actions }: {
  label?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; index?: string;
}) {
  return <SectionHeader as="h1" size="xl" label={label} title={title} description={subtitle} actions={actions} className="mb-6 sm:mb-8" />;
}

/** Card with an optional header row: a title on the left, actions on the right. */
export function Card({ children, className, title, actions, pad = true, id, tone }: {
  children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; pad?: boolean; index?: string; id?: string; ticks?: boolean; tone?: "attn";
}) {
  return (
    <Frame as="section" className={className} id={id} tone={tone}>
      {(title || actions) && (
        <header className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-2.5 sm:px-5">
          <h2 className="text-body-sm font-semibold text-ink">{title}</h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? "p-4 sm:p-5" : ""}>{children}</div>
    </Frame>
  );
}

const btnBase =
  "group inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control text-[13px] font-semibold transition-[background-color,border-color,color,opacity] duration-150 ease-[var(--ease)] disabled:pointer-events-none disabled:opacity-45";
const btnVariants = {
  primary: "bg-ink px-4 text-on-ink hover:bg-ink-2",
  secondary: "border border-control bg-surface px-4 text-ink hover:bg-sunken",
  ghost: "px-2 text-ink hover:bg-sunken",
  danger: "border border-danger bg-surface px-4 text-danger hover:bg-danger-tint",
} as const;
const btnSizes = { sm: "h-8", md: "h-10", lg: "h-12 text-[14px]" } as const;

export type ButtonStyle = { variant?: keyof typeof btnVariants; size?: keyof typeof btnSizes; arrow?: boolean; icon?: LucideIcon };

export function buttonClass({ variant = "secondary", size = "md" }: Omit<ButtonStyle, "arrow" | "icon"> = {}, extra?: string) {
  return cx(btnBase, btnVariants[variant], btnSizes[size], extra);
}

function Arrow({ external }: { external?: boolean }) {
  return <Icon icon={external ? ArrowUpRight : ArrowRight} className="transition-transform duration-150 ease-[var(--ease)] group-hover:translate-x-0.5" />;
}

/** Button. Primary = warm ink, secondary = outlined, ghost = text, danger = brick outline. Label says what it does. */
export function Button({ variant, size, arrow, icon, className, children, ...rest }: ButtonStyle & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={buttonClass({ variant, size }, className)} {...rest}>
      {icon && <Icon icon={icon} />}
      {children}
      {arrow && <Arrow />}
    </button>
  );
}

export function LinkButton({ href, variant, size, arrow, icon, className, children, external }: ButtonStyle & {
  href: string; className?: string; children: ReactNode; external?: boolean;
}) {
  const content = <>{icon && <Icon icon={icon} />}{children}{arrow && <Arrow external={external} />}</>;
  if (external) {
    return <a href={href} target="_blank" rel="noreferrer" className={buttonClass({ variant, size }, className)}>{content}</a>;
  }
  return <Link href={href} className={buttonClass({ variant, size }, className)}>{content}</Link>;
}

/** Quiet inline link in the accent colour, with an arrow. */
export function TextLink({ href, children, external, className }: { href: string; children: ReactNode; external?: boolean; className?: string }) {
  const cls = cx("group inline-flex items-center gap-1 text-meta font-medium text-accent underline-offset-4 hover:underline", className);
  const content = <>{children}<Icon icon={external ? ArrowUpRight : ArrowRight} size={14} className="transition-transform duration-150 group-hover:translate-x-0.5" /></>;
  return external
    ? <a href={href} target="_blank" rel="noreferrer" className={cls}>{content}</a>
    : <Link href={href} className={cls}>{content}</Link>;
}

export const inputClass =
  "w-full min-h-10 rounded-control border border-control bg-surface px-3 py-2 text-body-sm text-ink placeholder:text-muted transition-[border-color,box-shadow] duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:border-line disabled:bg-sunken disabled:text-ink-2";

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-meta font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

/** A labelled switch. The label says what "on" means. */
export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-body-sm font-medium text-ink">{label}</div>
        {hint && <div className="mt-0.5 max-w-prose text-meta text-muted">{hint}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative mt-0.5 h-6 w-10 shrink-0 rounded-full border transition-colors duration-150 disabled:opacity-45",
        checked ? "border-ink bg-ink" : "border-control bg-sunken",
      )}
    >
      <span className={cx("absolute top-[3px] h-4 w-4 rounded-full transition-[left,background-color] duration-150 ease-[var(--ease)]", checked ? "left-[19px] bg-on-ink" : "left-[3px] bg-control")} />
    </button>
  );
}

/** Empty state: what is missing, why it matters, the one action that fixes it. The mark appears here and nowhere decorative. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; icon?: LucideIcon; action?: ReactNode }) {
  return (
    <Frame surface="none" className="flex flex-col items-start gap-3 px-6 py-8">
      <NorinoteMark size={40} />
      <p className="text-title font-semibold text-ink">{title}</p>
      {children && <div className="max-w-prose text-body-sm text-muted">{children}</div>}
      {action}
    </Frame>
  );
}

const NOTICE_STYLE: Record<"danger" | "attn" | "good" | "neutral", string> = {
  danger: "bg-danger-tint text-danger-fg",
  attn: "bg-attn-tint text-attn-fg",
  good: "bg-accent-tint text-accent-fg",
  neutral: "bg-sunken text-ink",
};

/** One-line notice. Red: something broke. Amber/orange: you must act. Green: done. Slate: information. */
export function Notice({ tone = "slate", children, label }: { tone?: Tone; children: ReactNode; label?: string }) {
  const kind = tone === "red" ? "danger" : tone === "amber" || tone === "orange" ? "attn" : tone === "green" || tone === "teal" ? "good" : "neutral";
  const icon = kind === "danger" || kind === "attn" ? CircleAlert : kind === "good" ? CircleCheck : Info;
  return (
    <div role={kind === "danger" ? "alert" : "status"} className={cx("flex items-start gap-3 rounded-card px-4 py-3 text-body-sm", NOTICE_STYLE[kind])}>
      <Icon icon={icon} className="mt-[2px]" />
      <div className="min-w-0">
        {label && <span className="mr-1.5 font-semibold">{label}.</span>}
        {children}
      </div>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string; index?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-meta font-medium text-muted">{label}</div>
      <div className="mt-1 text-display-lg font-semibold text-ink tnum">{value}</div>
      {hint && <div className="mt-1 text-meta text-muted">{hint}</div>}
    </div>
  );
}
