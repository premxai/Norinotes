"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { SectionHead } from "@/components/SectionHead";

function Chip({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return <span className={`rounded-full border-[1.5px] px-3 py-1 text-small ${strong ? "border-accent text-accent" : "border-line bg-surface text-ink"}`}>{children}</span>;
}

function Lines({ widths }: { widths: string[] }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      {widths.map((w, i) => (
        <span key={i} className="block h-2.5 rounded-full bg-tint" style={{ width: w }} />
      ))}
    </div>
  );
}

const STEPS: { title: string; body: string; visual: ReactNode }[] = [
  {
    title: "Upload your resume",
    body: "It becomes a career graph: your roles, skills, depth and impact, each tied to where it came from.",
    visual: (
      <div className="grid gap-5 tablet:grid-cols-2">
        <div className="rounded-row border-[1.5px] border-line bg-surface p-4">
          <p className="mb-3 text-small font-semibold">Sam-Rivera.pdf</p>
          <Lines widths={["70%", "100%", "92%", "80%", "96%", "60%"]} />
        </div>
        <div className="flex flex-wrap content-start gap-2">
          <Chip strong>SQL · 3 years</Chip>
          <Chip>Looker</Chip>
          <Chip>Python</Chip>
          <Chip strong>Halden Labs, 2021–2024</Chip>
          <Chip>Stakeholder reporting</Chip>
          <Chip>A/B tests</Chip>
        </div>
      </div>
    ),
  },
  {
    title: "Nori finds jobs you're likely to get",
    body: "Requirement by requirement, with hard gates for location, work authorization and years.",
    visual: (
      <div className="flex flex-col gap-3">
        {[
          ["SQL, 3+ years", "Halden Labs, 2021–2024", true],
          ["Product sense", "Checkout redesign", true],
          ["A/B testing", "Pricing test, +4% conversion", true],
          ["Tableau", "Looker instead", false],
        ].map(([need, proof, ok]) => (
          <div key={String(need)} className="grid grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)] items-center gap-2 text-small">
            <span className="rounded-row border-[1.5px] border-line bg-surface px-3 py-2">{need}</span>
            <span aria-hidden="true" className={`text-center ${ok ? "text-accent" : "text-ink-2"}`}>
              {ok ? "—" : "·"}
            </span>
            <span className={`rounded-row border-[1.5px] px-3 py-2 ${ok ? "border-accent" : "border-dashed border-line text-ink-2"}`}>{proof}</span>
          </div>
        ))}
        <p className="mt-1 text-small text-ink-2">
          Fit <span className="font-mono text-ink">0.86</span> · Remote, US: passes the gates
        </p>
      </div>
    ),
  },
  {
    title: "Nori tailors and prepares",
    body: "A one-page resume and the answers to the form's questions, ready before you click.",
    visual: (
      <div className="mx-auto flex w-full max-w-[22rem] flex-col gap-3 rounded-row border-[1.5px] border-line bg-surface p-5">
        <Lines widths={["55%", "100%"]} />
        <span className="block h-2.5 w-[94%] rounded-full bg-accent/70" />
        <Lines widths={["88%", "76%"]} />
        <span className="block h-2.5 w-[82%] rounded-full bg-accent/70" />
        <Lines widths={["90%", "64%"]} />
        <div className="mt-2 flex flex-wrap gap-2">
          <Chip>1 page</Chip>
          <Chip strong>8 of 9 must-haves shown</Chip>
        </div>
      </div>
    ),
  },
  {
    title: "You click, it's sent",
    body: "In about 20 seconds. Nori fills the form, types in any emailed code and sends it.",
    visual: (
      <div className="mx-auto flex w-full max-w-[22rem] flex-col gap-4 rounded-row border-[1.5px] border-line bg-surface p-5">
        <div>
          <p className="font-semibold">Product analyst</p>
          <p className="text-small text-ink-2">Fernway · Remote · fit 0.86</p>
        </div>
        <span className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent font-semibold text-on-accent">Send</span>
        <p className="text-small text-ink-2">
          Sent in <span className="font-mono text-ink">00:19</span>
        </p>
      </div>
    ),
  },
];

/**
 * 03 · How it works: four steps on the left; on desktop a sticky panel on the right shows the active step, which
 * advances as each step crosses the middle of the screen (an IntersectionObserver, never scroll-jacking). Below 1024 px
 * each step carries its own visual.
 */
export function HowItWorks() {
  const [active, setActive] = useState(0);
  const items = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    items.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-16 bg-surface-2 py-section">
      <div className="wrap">
        <SectionHead id="how-title" eyebrow="How it works" title="From your resume to sent, in four steps." className="mb-12 tablet:mb-12" />
        <div className="grid items-start gap-10 laptop:grid-cols-12">
          <ol className="flex flex-col gap-3 laptop:col-span-5 laptop:gap-[22vh] laptop:py-[12vh]">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                ref={(el) => {
                  items.current[i] = el;
                }}
                data-step={i}
                data-nori-seat={`how-${i + 1}`}
                data-active={active === i || undefined}
                className={`rounded-card border-[1.5px] bg-surface p-5 transition-[border-color] duration-[var(--dur-slow)] ease-out tablet:p-6 ${
                  active === i ? "border-accent laptop:border-[2.5px]" : "border-line"
                }`}
              >
                <p className="mb-1 font-mono text-label text-ink-2">Step {i + 1}</p>
                <h3 className="text-h3 font-semibold">{s.title}</h3>
                <p className="mt-2 text-ink-2">{s.body}</p>
                <div className="mt-5 laptop:hidden">{s.visual}</div>
              </li>
            ))}
          </ol>
          {/* The panel repeats what the steps say, as pictures, so screen readers skip it. */}
          <div aria-hidden="true" className="sticky top-24 hidden laptop:col-span-7 laptop:block">
            <div className="grid min-h-[26rem] rounded-card border-[1.5px] border-line bg-bg p-8">
              {STEPS.map((s, i) => (
                <div
                  key={s.title}
                  className={`col-start-1 row-start-1 transition-[opacity,translate] duration-[var(--dur-slow)] ease-out ${active === i ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"}`}
                >
                  <p className="mb-6 font-mono text-label text-ink-2">
                    Step {i + 1} · {s.title}
                  </p>
                  {s.visual}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
