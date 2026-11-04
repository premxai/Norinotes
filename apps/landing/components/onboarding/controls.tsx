"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { buttonClass } from "@/components/Button";
import { FormError } from "@/components/auth/fields";
import { STEPS, takeFocusNext, useOnboarding } from "@/lib/onboarding";

/* Onboarding's parts (onboarding spec section 6). Text fields reuse the auth pages' Field. */

/** A label with "(optional)" after it, and the "From your resume" tag while the value is the resume's. */
export function Label({ children, optional = false, fromResume = false }: { children: ReactNode; optional?: boolean; fromResume?: boolean }) {
  return (
    <>
      {children}
      {optional && <span className="font-normal text-ink-2"> (optional)</span>}
      {/* Geist, not Mono: the mono font (70 KB) would otherwise load on every step's first screen. */}
      {fromResume && <span className="ml-2 rounded-full bg-accent-tint px-2 py-0.5 align-[2px] text-tag font-semibold text-accent">From your resume</span>}
    </>
  );
}

type Step = { index: number; title: string; lead: string };

/**
 * A step: the progress header, headline and lead, the step's content, the error box and the footer. The headline takes
 * focus after a save moved here. Below 768 px the footer is fixed to the bottom of the screen.
 */
export function StepShell({
  index,
  title,
  lead,
  children,
  failure,
  footer,
}: Step & { children: ReactNode; failure?: { text: string } | null; footer?: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const done = index >= STEPS.length;
  useEffect(() => {
    if (takeFocusNext()) heading.current?.focus();
  }, []);
  return (
    <div className="flex flex-col gap-[22px] tablet:gap-6">
      {!done && (
        <div className="flex flex-col gap-2 tablet:gap-2.5">
          <p className="text-[0.8125rem] font-medium text-ink-2 tabular-nums">
            Step {index + 1} of {STEPS.length} · {STEPS[index]?.name}
          </p>
          <div role="progressbar" aria-label="Onboarding progress" aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={index + 1} className="grid grid-cols-5 gap-1.5">
            {STEPS.map((s, i) => (
              <span key={s.id} className={`h-1.5 rounded-full ${i <= index ? "bg-accent" : "bg-line"}`} />
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2 tablet:gap-2.5">
        <h1 ref={heading} tabIndex={-1} className="font-serif text-auth text-ink outline-none">
          {title}
        </h1>
        <p className="text-lead text-ink-2">{lead}</p>
      </div>
      {children}
      {failure && <FormError>{failure.text}</FormError>}
      {footer}
    </div>
  );
}

/** Back and Continue. Below 768 px they're a bar fixed to the bottom of the screen. */
export function StepFooter({ back, onContinue, label = "Continue", busy = false, extra }: { back?: string; onContinue: () => void; label?: string; busy?: boolean; extra?: ReactNode }) {
  return (
    <div
      data-step-footer
      className="flex items-center justify-between gap-2.5 border-line max-tablet:fixed max-tablet:inset-x-0 max-tablet:bottom-0 max-tablet:z-[40] max-tablet:h-[76px] max-tablet:border-t-[1.5px] max-tablet:bg-bg max-tablet:px-4 tablet:mt-2 tablet:border-t-[1.5px] tablet:pt-6"
    >
      {back ? (
        <Link href={back} className={buttonClass("outline", "min-h-12 max-tablet:flex-1")}>
          Back
        </Link>
      ) : (
        <span className="max-tablet:hidden" />
      )}
      <div className="flex items-center gap-4 max-tablet:flex-[2]">
        {extra}
        <button type="button" onClick={onContinue} aria-disabled={busy || undefined} className={buttonClass("primary", `min-h-12 max-tablet:w-full ${busy ? "opacity-80" : ""}`)}>
          {busy ? "Saving…" : label}
        </button>
      </div>
    </div>
  );
}

/** A question answered with a few choices: real radios, styled as pills, in a fieldset. */
export function ChoiceGroup<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  error,
}: {
  legend: ReactNode;
  name: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  error?: string | null;
}) {
  const note = useId();
  return (
    <fieldset aria-describedby={error ? note : undefined} className="flex flex-col gap-2.5">
      <legend className="mb-2.5 text-ui leading-[1.3] font-semibold text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-[1.5px] bg-surface px-4 text-[0.9375rem] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-ink ${value === o.value ? "border-accent" : error ? "border-danger" : "border-line-strong"}`}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="size-4 accent-accent outline-none" />
            {o.label}
          </label>
        ))}
      </div>
      {error && (
        <p id={note} className="text-small text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** A labelled native select, styled like the text fields. */
export function SelectField({ id, label, value, onChange, options }: { id: string; label: ReactNode; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-ui leading-[1.3] font-semibold text-ink">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-12 w-full rounded-input border-[1.5px] border-line-strong bg-surface px-3 text-body text-ink">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * A list of short values (job titles, locations, companies): chips above a text input. Enter or a comma adds; Backspace
 * in an empty input removes the last. Additions and removals are announced.
 */
export function ChipsInput({
  id,
  label,
  values,
  onChange,
  placeholder,
  error,
  onFocus,
  onBlur,
  after,
}: {
  id: string;
  label: ReactNode;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  error?: string | null;
  onFocus?: () => void;
  onBlur?: () => void;
  after?: ReactNode;
}) {
  const [text, setText] = useState("");
  const [said, setSaid] = useState("");
  const add = (raw: string) => {
    const v = raw.trim().replace(/,$/, "").trim();
    if (!v || values.some((x) => x.toLowerCase() === v.toLowerCase())) return setText("");
    onChange([...values, v]);
    setSaid(`Added ${v}`);
    setText("");
  };
  const remove = (v: string) => {
    onChange(values.filter((x) => x !== v));
    setSaid(`Removed ${v}`);
  };
  const note = `${id}-note`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-ui leading-[1.3] font-semibold text-ink">
        {label}
      </label>
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={typeof label === "string" ? label : undefined}>
          {values.map((v) => (
            <li key={v} className="flex h-[34px] items-center gap-1 rounded-full bg-tint pr-1 pl-3 text-small text-ink">
              {v}
              <button type="button" aria-label={`Remove ${v}`} onClick={() => remove(v)} className="grid size-6 place-items-center rounded-full text-ink-2 hover:bg-surface">
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={id}
        value={text}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? note : undefined}
        onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(text);
          } else if (e.key === "Backspace" && !text && values.length) remove(values[values.length - 1] ?? "");
        }}
        onFocus={onFocus}
        onBlur={() => {
          if (text.trim()) add(text);
          onBlur?.();
        }}
        className="h-12 w-full rounded-input border-[1.5px] border-line-strong bg-surface px-3.5 text-body text-ink aria-invalid:border-danger"
      />
      {error && (
        <p id={note} className="text-small text-danger">
          {error}
        </p>
      )}
      {after}
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </div>
  );
}

/** Shown while the saved profile loads (the steps are prerendered without it). */
export function StepLoading() {
  const s = useOnboarding();
  return (
    <p aria-live="polite" className="text-body text-ink-2">
      {s.status === "failed" ? (s.error ?? "Something went wrong.") : "Loading your details…"}
    </p>
  );
}
