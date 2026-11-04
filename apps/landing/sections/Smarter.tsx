import { Reveal } from "@/components/Reveal";
import { SampleTag, SectionHead } from "@/components/SectionHead";

const WEEK = [
  { day: "Mon", what: "3 sent", detail: "Fernway, Halden Labs, Mirro" },
  { day: "Tue", what: "2 sent", detail: "Two more analyst roles" },
  { day: "Wed", what: "A reply", detail: "Halden Labs wants a call" },
  { day: "Thu", what: "Interview", detail: "Fernway, next Tuesday", seat: "smarter-interview", strong: true },
  { day: "Fri", what: "Rejection", detail: "Mirro went another way", seat: "smarter-rejection" },
];

/** 07 · Gets smarter from replies: one sample week; each outcome nudges the next shortlist. */
export function Smarter() {
  return (
    <section aria-labelledby="smarter-title" className="bg-surface-2 py-section">
      <div className="wrap">
        <SectionHead
          id="smarter-title"
          eyebrow="It learns"
          title="Every reply makes tomorrow's list better."
          lead="Nori reads replies in its own inbox and links each one to its job. Interviews and rejections both teach it what fits."
          className="mb-12 laptop:mb-32"
        />
        <Reveal>
          <div className="mb-4 flex justify-end">
            <SampleTag />
          </div>
          <ol className="grid gap-3 laptop:grid-cols-5">
            {WEEK.map((d) => (
              <li
                key={d.day}
                data-nori-seat={d.seat}
                className={`grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 rounded-card bg-surface p-4 laptop:flex laptop:flex-col laptop:gap-1.5 ${d.strong ? "border-[2.5px] border-accent" : "border-[1.5px] border-line"}`}
              >
                <span className="font-mono text-label text-ink-2">{d.day}</span>
                <span>
                  <span className="block font-semibold">{d.what}</span>
                  <span className="block text-small text-ink-2">{d.detail}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-ink-2">Tomorrow&rsquo;s list leans toward roles like Fernway&rsquo;s, and away from roles like Mirro&rsquo;s.</p>
        </Reveal>
      </div>
    </section>
  );
}
