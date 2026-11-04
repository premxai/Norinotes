"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { buttonClass } from "@/components/Button";
import { SampleTag } from "@/components/SectionHead";
import { TODAY } from "@/lib/sample";

const PEEKED = "norinote-note-peeked";

/**
 * Nori's note in the hero (spec sections 7 and 9). Closed it's a small "3 for today" note beside Nori. On desktop it
 * unfolds in place (a disclosure; Esc folds it) and peeks open by itself once per visit. On phones it opens as a modal
 * bottom sheet, and the closed note wiggles once instead. Nori itself opens it too: the seat controller sends
 * `norinote:note`.
 */
export function NoriNote({ variant }: { variant: "desktop" | "phone" }) {
  const [open, setOpen] = useState(false);
  const [wiggle, setWiggle] = useState(false);
  const sheet = useRef<HTMLDialogElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const touched = useRef(false);
  const cardId = useId();

  // Only the variant for the current screen size acts; the other one is hidden with CSS.
  const active = useCallback(() => matchMedia(variant === "phone" ? "(max-width: 767px)" : "(min-width: 768px)").matches, [variant]);

  const toggle = useCallback(() => {
    touched.current = true;
    if (variant === "phone") sheet.current?.showModal();
    else setOpen((o) => !o);
  }, [variant]);

  useEffect(() => {
    const onNori = () => active() && toggle();
    addEventListener("norinote:note", onNori);
    if (!active()) return () => removeEventListener("norinote:note", onNori);
    let seen = false;
    try {
      seen = sessionStorage.getItem(PEEKED) === "1";
      sessionStorage.setItem(PEEKED, "1");
    } catch {
      // Storage can be blocked; then it peeks every visit, which is harmless.
    }
    const timers: number[] = [];
    if (!seen) {
      timers.push(
        window.setTimeout(() => {
          if (touched.current) return;
          if (variant === "phone") {
            if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
            setWiggle(true);
            timers.push(window.setTimeout(() => setWiggle(false), 700));
          } else {
            setOpen(true);
            timers.push(window.setTimeout(() => !touched.current && setOpen(false), 6000));
          }
        }, 3000),
      );
    }
    return () => {
      removeEventListener("norinote:note", onNori);
      timers.forEach(clearTimeout);
    };
  }, [active, toggle, variant]);

  const fold = () => {
    touched.current = true;
    if (variant === "phone") sheet.current?.close();
    else setOpen(false);
    pill.current?.focus();
  };

  const card = (
    <div className="flex flex-col gap-2.5 rounded-card border-[1.5px] border-ink bg-surface p-[18px] text-left shadow-e1">
      <div className="flex items-center justify-between">
        <span className="font-serif text-[1.75rem] leading-none">Today</span>
        <SampleTag />
      </div>
      <ul className="flex flex-col gap-2.5">
        {TODAY.map((j) => (
          <li key={j.title} className="flex items-center gap-3 rounded-row border-[1.5px] border-line bg-surface px-3.5 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[0.9375rem] font-semibold">{j.title}</p>
              <p className="text-small text-ink-2">
                {j.meta}
                {j.note ? ` · ${j.note}` : ""}
              </p>
            </div>
            {/* Not aria-label: that's not allowed on a plain span, so screen readers may skip it. */}
            <span className="font-mono text-small">
              <span className="sr-only">fit </span>
              {j.fit}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Link href="/signup" className={buttonClass("primary", "min-h-11 flex-1")}>
          Send all 3
        </Link>
        <button type="button" onClick={fold} className={buttonClass("outline", "min-h-11")}>
          Fold
        </button>
      </div>
    </div>
  );

  return (
    <div onKeyDown={(e) => e.key === "Escape" && open && fold()}>
      <button
        ref={pill}
        type="button"
        onClick={toggle}
        aria-expanded={variant === "desktop" ? open : undefined}
        aria-controls={variant === "desktop" ? cardId : undefined}
        aria-haspopup={variant === "phone" ? "dialog" : undefined}
        className={`flex min-h-11 items-center gap-2 whitespace-nowrap border-[1.5px] border-ink bg-surface px-4 text-[0.9375rem] font-semibold text-ink shadow-e1 transition-[scale] duration-[var(--dur-fast)] ease-out active:scale-[0.98] ${
          variant === "desktop" ? "absolute right-[84px] bottom-10 rounded-[14px_14px_4px_14px]" : "rounded-[14px]"
        } ${open ? "invisible" : ""}`}
        style={wiggle ? { animation: "wiggle 350ms var(--ease-in-out) 2" } : undefined}
      >
        <span className="tabular-nums">3</span> for today <span aria-hidden="true">→</span>
      </button>

      {variant === "desktop" && open && (
        <div id={cardId} role="region" aria-label="Today's shortlist, sample" className="absolute right-[84px] bottom-0 w-[400px] max-w-[calc(100vw-2rem)]">
          {card}
        </div>
      )}

      {variant === "phone" && (
        <dialog ref={sheet} className="sheet" aria-label="Today's shortlist, sample" onClick={(e) => e.target === sheet.current && fold()}>
          <div className="rounded-t-sheet bg-surface px-4 pt-3 pb-6 shadow-e2">
            <span aria-hidden="true" className="mx-auto mb-3 block h-1 w-10 rounded-full bg-line" />
            {card}
          </div>
        </dialog>
      )}
    </div>
  );
}
