"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/Button";
import { SampleTag, SectionHead } from "@/components/SectionHead";

/** One sample run, about 19 seconds from opening the form to sent (the apply evals measure 12 to 30). */
const DURATION = 19_400;
const WHY = "I've spent three years turning product data into decisions at Halden Labs, and Fernway's pricing work is exactly the kind I want to do next.";
const CODE = "482 913";

const STEPS = [
  { at: 0, label: "Opened the form" },
  { at: 1_400, label: "Filled 9 fields from your answers" },
  { at: 4_500, label: "Attached the tailored resume" },
  { at: 12_400, label: "Waited for the email code" },
  { at: 15_900, label: "Code arrived: typing it in" },
  { at: DURATION, label: "Sent" },
];

/** The Nori event for each stretch of the run; the seat controller listens for `norinote:replay`. */
function phaseAt(t: number) {
  if (t >= DURATION) return "submitted";
  if (t >= 17_600) return "submitting";
  if (t >= 15_900) return "code";
  if (t >= 12_400) return "awaiting-code";
  return "applying";
}

const typed = (text: string, t: number, from: number, to: number) => text.slice(0, Math.max(0, Math.min(text.length, Math.round(((t - from) / (to - from)) * text.length))));

function Field({ label, value, wide = false, mono = false, phone = true }: { label: string; value: string; wide?: boolean; mono?: boolean; phone?: boolean }) {
  return (
    <label className={`flex flex-col gap-1.5 text-small font-semibold ${wide ? "tablet:col-span-2" : ""} ${phone ? "" : "max-tablet:hidden"}`}>
      {label}
      {wide ? (
        <textarea readOnly tabIndex={-1} value={value} rows={3} className="resize-none rounded-input border-[1.5px] border-line-strong bg-bg px-3 py-2.5 text-[0.9375rem] font-normal leading-snug" />
      ) : (
        <input
          readOnly
          tabIndex={-1}
          value={value}
          className={`min-h-11 rounded-input border-[1.5px] bg-bg px-3 text-[0.9375rem] ${mono ? "border-[2.5px] border-accent font-mono font-medium" : "border-line-strong font-normal"}`}
        />
      )}
    </label>
  );
}

/**
 * 04 · Watch one apply (spec sections 7 and 10). A sample run that starts when the window is half in view, plays once
 * and stops on "Sent". Play / Pause and Run it again are always there (WCAG 2.2.2). With reduced motion it shows the
 * finished run. Each phase is announced to Nori through a `norinote:replay` event.
 */
export function Replay() {
  const [t, setT] = useState(0);
  const [running, setRunning] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const clock = useRef(0);
  const phase = useRef<string>("");

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      clock.current = Math.min(DURATION, clock.current + (last == null ? 0 : now - last));
      last = now;
      setT(clock.current);
      if (clock.current >= DURATION) setRunning(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  // Tell Nori when the run moves into a new phase.
  useEffect(() => {
    const p = t === 0 && !running ? "" : phaseAt(t);
    if (p && p !== phase.current) {
      phase.current = p;
      // Kept on the section too, so Nori can catch up if it arrives mid-run.
      const section = frame.current?.closest("section");
      if (section) section.dataset.phase = p;
      dispatchEvent(new CustomEvent("norinote:replay", { detail: { phase: p, code: CODE } }));
    }
  }, [t, running]);

  const play = useCallback((fromStart = false) => {
    if (fromStart || clock.current >= DURATION) {
      clock.current = 0;
      setT(0);
      phase.current = "";
    }
    setRunning(true);
  }, []);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        // With reduced motion the run is shown finished; Run it again still plays it on request.
        if (reduced) {
          clock.current = DURATION;
          setT(DURATION);
        } else play();
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [play]);

  const done = t >= DURATION;
  const seconds = Math.floor(t / 1000);
  const current = STEPS.findLastIndex((s) => t >= s.at);

  return (
    <section id="replay" aria-labelledby="replay-title" className="scroll-mt-16 py-section">
      <div className="wrap">
        {/* The extra room on desktop is Nori's: it sits on the window's top edge (spec section 3). */}
        <div className="mb-12 flex flex-wrap items-end justify-between gap-6 laptop:mb-28">
          <SectionHead id="replay-title" eyebrow="See it work" title="Watch Nori apply." lead="A sample application, start to sent. The timing comes from real runs." />
          <div className="flex gap-2">
            <button type="button" onClick={() => (running ? setRunning(false) : play())} className={buttonClass("outline", "min-h-11 px-5")}>
              {running ? "Pause" : done ? "Run it again" : "Play"}
            </button>
            {t > 0 && !done && (
              <button type="button" onClick={() => play(true)} className={buttonClass("outline", "min-h-11 px-5")}>
                Start over
              </button>
            )}
          </div>
        </div>

        <div ref={frame} className="relative overflow-hidden rounded-card border-[1.5px] border-line bg-surface">
          <span data-nori-seat="replay" aria-hidden="true" className="absolute top-0 right-[24%] h-px w-px" />
          <div className="flex items-center gap-2 border-b-[1.5px] border-line bg-surface-2 px-4 py-3">
            <span aria-hidden="true" className="flex gap-1.5">
              <span className="size-2.5 rounded-full bg-tint" />
              <span className="size-2.5 rounded-full bg-tint" />
              <span className="size-2.5 rounded-full bg-tint" />
            </span>
            <span className="ml-2 truncate font-mono text-label text-ink-2">jobs.fernway.example/apply</span>
            <SampleTag className="ml-auto" />
          </div>
          <div className="flex flex-col tablet:flex-row">
            <form aria-label="Sample application form" className="grid min-w-0 flex-[999_1_32rem] gap-4 p-5 tablet:grid-cols-2 tablet:p-7" onSubmit={(e) => e.preventDefault()}>
              <Field label="Full name" value={t >= 1_400 ? "Sam Rivera" : ""} phone={false} />
              <Field label="Email" value={t >= 2_600 ? "sam@inbox.norinote.example" : ""} phone={false} />
              <Field label="Resume" value={t >= 4_500 ? "Sam-Rivera-Fernway.pdf (tailored)" : ""} />
              <Field label="Work authorization" value={t >= 6_000 ? "Authorized to work in the US" : ""} phone={false} />
              <Field label="Why this role?" value={typed(WHY, t, 7_600, 12_000)} wide />
              <Field label="Email code" value={typed(CODE, t, 15_900, 17_400)} mono />
            </form>
            <aside aria-label="Run progress" className="order-first flex flex-[1_1_16rem] flex-col gap-4 border-b-[1.5px] border-line bg-surface-2 p-5 tablet:order-none tablet:border-b-0 tablet:border-l-[1.5px] tablet:p-7">
              <div className="flex items-baseline justify-between tablet:block">
                <p className="font-mono text-[clamp(2rem,1.6rem+1.6vw,3rem)] leading-none font-medium" aria-hidden="true">
                  00:{String(seconds).padStart(2, "0")}
                </p>
                <p className="text-small text-ink-2 tablet:mt-2" aria-live="polite">
                  {done ? `Sent in ${seconds} seconds.` : running ? "Running" : "Paused"}
                </p>
              </div>
              <div className="h-2 rounded-full bg-tint" aria-hidden="true">
                <div className="h-2 rounded-full bg-accent" style={{ width: `${(t / DURATION) * 100}%` }} />
              </div>
              <ol className="flex flex-col gap-2 text-small">
                {STEPS.map((s, i) => (
                  <li key={s.label} className={`${i === current && !done ? "font-semibold text-ink" : "text-ink-2"} ${i === current ? "" : "max-tablet:hidden"}`}>
                    {i < current || (done && i <= current) ? "✓ " : ""}
                    {s.label}
                  </li>
                ))}
              </ol>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}
