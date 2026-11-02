import { useId } from "react";
import { cx } from "./cx";

const BODY = "M32 12C27 12 22.5 15.5 17 27C12 37 7 43 7 50C7 57.5 13 60.5 20 60.5H44C51 60.5 57 57.5 57 50C57 43 52 37 47 27C41.5 15.5 37 12 32 12Z";

/** Norinote: a rice ball in a seaweed wrap with a sprout on top. The same character as the mascot. */
export function NorinoteMark({ size = 32, className, title }: { size?: number; className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={cx("shrink-0", className)} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fffefa" /><stop offset="1" stopColor="#f0e7d0" /></linearGradient>
        <linearGradient id={`${id}n`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#17896a" /><stop offset="1" stopColor="#07372b" /></linearGradient>
        <linearGradient id={`${id}l`} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#22c58b" /><stop offset="1" stopColor="#c4f26a" /></linearGradient>
        <clipPath id={`${id}c`}><path d={BODY} /></clipPath>
      </defs>
      <path d={BODY} fill={`url(#${id}r)`} />
      <g clipPath={`url(#${id}c)`}>
        <path d="M0 45C20 39.5 44 39.5 64 45V64H0Z" fill={`url(#${id}n)`} />
        <path d="M0 45C20 39.5 44 39.5 64 45" fill="none" stroke="#5be8b0" strokeOpacity=".55" strokeWidth="1.2" />
        <ellipse cx="22" cy="22" rx="5" ry="9" transform="rotate(24 22 22)" fill="#fff" opacity=".55" />
      </g>
      <path d={BODY} fill="none" stroke="#0a1b15" strokeOpacity=".16" />
      <path d="M32 12V7" stroke="#18a874" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M32 7C27 1 20 2 18.5 5.5C23 9.5 29.5 9.5 32 7Z" fill={`url(#${id}l)`} />
      <path d="M32 7C37 0 44 1 45.5 4.5C41 8.5 34.5 9 32 7Z" fill={`url(#${id}l)`} />
      <circle cx="26" cy="31" r="2.5" fill="#10100f" /><circle cx="38" cy="31" r="2.5" fill="#10100f" />
      <circle cx="26.9" cy="30" r=".8" fill="#fff" /><circle cx="38.9" cy="30" r=".8" fill="#fff" />
      <ellipse cx="20.5" cy="35.5" rx="3.2" ry="2.1" fill="#ff7f9f" opacity=".6" /><ellipse cx="43.5" cy="35.5" rx="3.2" ry="2.1" fill="#ff7f9f" opacity=".6" />
      <path d="M29.6 35.2Q32 37.8 34.4 35.2" fill="none" stroke="#3b1f1c" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** The wordmark, set in the app font so it needs no image. Takes its colour from the text colour. */
export function NorinoteWordmark({ height = 20, className }: { height?: number; className?: string }) {
  return (
    <span aria-hidden="true" style={{ fontSize: Math.round(height * 1.15), lineHeight: 1 }} className={cx("shrink-0 font-semibold tracking-[-0.02em]", className)}>
      Norinote
    </span>
  );
}

/** Mark plus wordmark. `tone="light"` is for dark backgrounds. */
export function NorinoteLogo({ size = 32, tone = "dark", className }: { size?: number; tone?: "dark" | "light"; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2", tone === "light" ? "text-white" : "text-ink", className)}>
      <NorinoteMark size={size} />
      <NorinoteWordmark height={Math.round(size * 0.56)} />
      <span className="sr-only">Norinote</span>
    </span>
  );
}
