"use client";

import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, Plus, X } from "lucide-react";
import { Icon, buttonClass, cx, inputClass } from "../ui";

/** Card used inside steps. `tint` gives the sunken tone for a side note or summary. */
export function Soft({ children, className, tint = false }: { children: ReactNode; className?: string; tint?: boolean }) {
  return (
    <div className={cx("rounded-card p-4 sm:p-5", tint ? "bg-sunken" : "border border-line bg-surface", className)}>
      {children}
    </div>
  );
}

/** Step button: `primary` warm ink, `soft` outlined, `ghost` text. */
export function ObButton({ variant = "primary", className, children, ...rest }: { variant?: "primary" | "soft" | "ghost" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={buttonClass({ variant: variant === "primary" ? "primary" : variant === "soft" ? "secondary" : "ghost", size: "md" }, cx("group", className))}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Radio group drawn as a segmented control. The chosen option is ink on a sunken track. */
export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T | undefined; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-control bg-sunken p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx("h-8 rounded-[6px] px-4 text-[13px] font-medium", on ? "bg-ink text-on-ink" : "text-ink-2 hover:bg-surface hover:text-ink")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const YES_NO = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] as const;

export function YesNo({ value, onChange, label }: { value: boolean | null | undefined; onChange: (v: boolean) => void; label: string }) {
  return (
    <Segmented
      label={label}
      value={value == null ? undefined : value ? "yes" : "no"}
      onChange={(v) => onChange(v === "yes")}
      options={[...YES_NO]}
    />
  );
}

/** Question row: the question on the left, the control on the right; stacks on phones. */
export function Question({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-2.5 border-b border-line py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="text-[14.5px] font-medium text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-meta text-muted">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Free-text chips: type, press Enter or comma to add; x removes. */
export function ChipInput({ value, onChange, placeholder, label }: {
  value: string[]; onChange: (v: string[]) => void; placeholder?: string; label: string;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const items = raw.split(",").map((s) => s.trim()).filter(Boolean).filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));
    if (items.length) onChange([...value, ...items]);
    setDraft("");
  };
  return (
    <div className={cx(inputClass, "flex flex-wrap items-center gap-1.5 py-[6px] focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25")}>
      {value.map((v) => (
        <span key={v} className="inline-flex h-7 items-center gap-1 rounded-full bg-sunken pl-3 pr-1 text-[13px] font-medium text-ink">
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className="flex h-5 w-5 items-center justify-center rounded-full text-muted hover:bg-line hover:text-ink">
            <Icon icon={X} size={13} />
          </button>
        </span>
      ))}
      <input
        aria-label={label}
        value={draft}
        onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); add(draft); }
          if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add(draft)}
        placeholder={value.length ? "" : placeholder}
        className="min-w-[8rem] flex-1 bg-transparent py-[2px] text-body-sm text-ink placeholder:text-muted focus:outline-none"
      />
    </div>
  );
}

/** Multi-select from fixed options, rendered as toggle pills. */
export function PillSelect({ value, onChange, options }: { value: string[]; onChange: (v: string[]) => void; options: string[] }) {
  const all = [...options, ...value.filter((v) => !options.includes(v))];
  return (
    <div className="flex flex-wrap gap-2">
      {all.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
            className={cx("inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium", on ? "border-ink bg-ink text-on-ink" : "border-line bg-surface text-ink-2 hover:border-control hover:text-ink")}
          >
            <Icon icon={on ? Check : Plus} size={14} />
            {o}
          </button>
        );
      })}
    </div>
  );
}

/** Group heading inside a step. `letter` is kept for callers; groups read by their titles. */
export function Group({ title, children, note }: { letter?: string; title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="border-t border-line pt-6 first:border-t-0 first:pt-0">
      <h3 className="text-title font-semibold text-ink">{title}</h3>
      {note && <p className="mt-1 text-meta text-muted">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Back / Continue row under every step. `status` sits between them (errors, "Saved"). */
export function StepFooter({ busy, onBack, label = "Continue", status, extra, disabled }: {
  busy?: boolean; onBack?: () => void; label?: string; status?: ReactNode; extra?: ReactNode; disabled?: boolean;
}) {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-line pt-5">
      {onBack && <ObButton variant="soft" onClick={onBack} disabled={busy}><Icon icon={ArrowLeft} />Back</ObButton>}
      <div className="min-w-0 flex-1">{status}</div>
      {extra}
      <ObButton type="submit" variant="primary" disabled={busy || disabled}>
        {busy ? <span>Saving<span className="dots" /></span> : <>{label}<Icon icon={ArrowRight} className="transition-transform duration-150 group-hover:translate-x-0.5" /></>}
      </ObButton>
    </div>
  );
}
