import { Reveal } from "@/components/Reveal";
import { SectionHead } from "@/components/SectionHead";
import { TODAY } from "@/lib/sample";

/** 02 · No board to scroll: a wall of listings fades back and three that fit stay sharp. */
export function NoBoard() {
  return (
    <section aria-labelledby="noboard-title" className="py-section">
      <div className="wrap grid items-center gap-12 laptop:grid-cols-12">
        <SectionHead
          id="noboard-title"
          eyebrow="No job board"
          title="No job board to scroll."
          lead="Every job is collected once and understood once, then matched to your history. You see the few that fit, not the hundreds that don't."
          className="laptop:col-span-5"
        />
        {/* Side by side from 768 px; on phones the wall sits above the three that fit (side by side was 13 px too wide at 360). */}
        <Reveal className="grid grid-cols-1 items-center gap-4 tablet:grid-cols-[minmax(0,1.4fr)_2.5rem_minmax(0,1fr)] laptop:col-span-7">
          <p className="sr-only">A wall of listings, narrowed to the 3 that fit you.</p>
          <div aria-hidden="true" className="grid grid-cols-4 gap-2 rounded-card border-[1.5px] border-line bg-surface p-4">
            {Array.from({ length: 24 }, (_, i) => (
              <span
                key={i}
                className={`block h-[22px] rounded-[6px] bg-tint transition-[opacity,filter] duration-[1200ms] ease-out group-data-[reveal=shown]:opacity-35 group-data-[reveal=shown]:blur-[1.5px] ${i >= 12 ? "max-tablet:hidden" : ""}`}
                style={{ transitionDelay: `${300 + i * 25}ms` }}
              />
            ))}
          </div>
          <span aria-hidden="true" className="rotate-90 text-center text-[1.75rem] text-ink-2 tablet:rotate-0">
            →
          </span>
          <ul data-nori-seat="noboard" className="flex flex-col gap-2.5">
            {TODAY.map((j) => (
              <li key={j.title} className="flex min-w-0 items-center justify-between gap-2 rounded-row border-[1.5px] border-line bg-surface px-3.5 py-3">
                <span className="min-w-0 text-[0.9375rem] font-semibold">{j.title}</span>
                <span className="font-mono text-small text-ink-2">{j.fit}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
