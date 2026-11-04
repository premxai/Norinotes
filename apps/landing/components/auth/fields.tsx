"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode, type Ref } from "react";
import { buttonClass } from "@/components/Button";

/* The auth pages' form parts (auth-design-spec.md section 6). */

const ICON_ALERT = (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="mt-0.5 flex-none">
    <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 4.5v4.5M8 11v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const INPUT =
  "h-12 w-full rounded-input border-[1.5px] border-line-strong bg-surface px-3.5 text-body text-ink aria-invalid:border-danger";

/** The headline and lead at the top of every auth page. */
export function AuthHeading({ title, lead, headingRef }: { title: string; lead: ReactNode; headingRef?: Ref<HTMLHeadingElement> }) {
  return (
    <div className="flex flex-col gap-2 laptop:gap-3">
      <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="font-serif text-auth text-ink outline-none">
        {title}
      </h1>
      <p className="text-lead text-ink-2">{lead}</p>
    </div>
  );
}

type FieldProps = Omit<ComponentProps<"input">, "id" | "ref"> & {
  id: string;
  label: string;
  error?: string | null;
  hint?: string;
  /** Beside the label on the right, such as "Forgot password?". */
  aside?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
  /** Inside the field on the right, such as the Show button. */
  trailing?: ReactNode;
};

/** A labelled input; the hint gives way to the error, and both are read with the field. */
export function Field({ id, label, error, hint, aside, inputRef, trailing, className = "", ...input }: FieldProps) {
  const note = error || hint ? `${id}-note` : undefined;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-ui font-semibold leading-[1.3] text-ink">
          {label}
        </label>
        {aside}
      </div>
      <div className="relative">
        <input id={id} ref={inputRef} aria-invalid={error ? true : undefined} aria-describedby={note} className={`${INPUT} ${className}`} {...input} />
        {trailing}
      </div>
      {error ? (
        <p id={note} className="flex gap-1.5 text-small text-danger">
          {ICON_ALERT}
          {error}
        </p>
      ) : hint ? (
        <p id={note} className="text-small text-ink-2">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A password field with Show / Hide. The button keeps focus in the field when pressed with a pointer (so a phone
 * keyboard stays open); Nori peeks while the password is shown (`data-nori-watch="reveal"`).
 */
export function PasswordField(props: Omit<FieldProps, "type" | "trailing">) {
  const [shown, setShown] = useState(false);
  // Switching an input's type moves the caret to the start in Chrome, so typing after Show would land in front.
  const caret = useRef<[number | null, number | null] | null>(null);
  useLayoutEffect(() => {
    const input = document.getElementById(props.id);
    const at = caret.current;
    if (!(input instanceof HTMLInputElement) || !at) return;
    caret.current = null;
    input.setSelectionRange(at[0], at[1]);
    // After a real (trusted) click Chrome moves the caret again once the event is over, so put it back once more.
    const t = window.setTimeout(() => document.activeElement === input && input.setSelectionRange(at[0], at[1]), 0);
    return () => clearTimeout(t);
  }, [shown, props.id]);
  const toggle = () => {
    const input = document.getElementById(props.id);
    if (input instanceof HTMLInputElement) caret.current = [input.selectionStart, input.selectionEnd];
    setShown((s) => !s);
  };
  return (
    <Field
      {...props}
      type={shown ? "text" : "password"}
      data-nori-watch="password"
      className="pr-[72px]"
      trailing={
        <button
          type="button"
          data-nori-watch="reveal"
          aria-pressed={shown}
          aria-controls={props.id}
          aria-label={shown ? "Hide password" : "Show password"}
          onPointerDown={(e) => e.preventDefault()}
          onClick={toggle}
          className="absolute top-0.5 right-1 h-11 min-w-14 rounded-[8px] px-2.5 text-small font-semibold text-ink"
        >
          {shown ? "Hide" : "Show"}
        </button>
      }
    />
  );
}

/** The error box above the button: the API's answer in words, sometimes with a way out. */
export function FormError({ children, link }: { children: ReactNode; link?: { href: string; label: string } }) {
  return (
    <div role="alert" className="flex gap-2.5 rounded-row border-[1.5px] border-danger bg-danger-tint px-3.5 py-3 text-[0.9375rem] leading-[1.45] text-ink">
      <span className="text-danger">{ICON_ALERT}</span>
      <p>
        {children}{" "}
        {link && (
          <Link href={link.href} className="font-semibold text-ink underline decoration-1 underline-offset-[3px]">
            {link.label}
          </Link>
        )}
      </p>
    </div>
  );
}

/** The submit button: while busy it shows the busy wording and ignores presses, at the same width. */
export function SubmitButton({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }) {
  return (
    <button type="submit" aria-disabled={busy || undefined} className={buttonClass("primary", `min-h-12 w-full ${busy ? "opacity-80" : ""}`)}>
      {busy ? busyLabel : label}
    </button>
  );
}

/** Under the button: what's happening, read out politely. Its height is reserved so nothing below it jumps. */
export function StatusLine({ text, done = false }: { text: string; done?: boolean }) {
  return (
    <p aria-live="polite" className="flex min-h-[22px] items-center gap-2 text-[0.9375rem] font-semibold leading-[1.45] text-accent">
      {done && (
        <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {text}
    </p>
  );
}

export function PlanChip() {
  return (
    <p className="flex flex-wrap items-center gap-x-2 self-start rounded-[14px] bg-tint px-3 py-1.5 text-small text-ink">
      <span className="font-semibold">Pro selected</span>
      <span className="text-ink-2">· you&rsquo;ll add payment after setup</span>
    </p>
  );
}

/** The panel that replaces a form once it's done (or a link page's answer). Focus moves to its headline. */
export function ResultPanel({ title, body, action }: { title: string; body: ReactNode; action: { label: string; href?: string; onClick?: () => void } }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="flex flex-col gap-6 laptop:gap-8">
      <AuthHeading title={title} lead={body} headingRef={heading} />
      {action.href ? (
        <Link href={action.href} className={buttonClass("primary", "min-h-12 w-full")}>
          {action.label}
        </Link>
      ) : (
        <button type="button" onClick={action.onClick} className={buttonClass("primary", "min-h-12 w-full")}>
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Focuses a field on laptops and up only: on a phone the keyboard would cover the scene and Nori. */
export function useDesktopAutofocus(ref: { current: HTMLInputElement | null }) {
  useEffect(() => {
    if (matchMedia("(min-width: 1024px)").matches) ref.current?.focus();
  }, [ref]);
}
