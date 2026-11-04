import { Reveal } from "@/components/Reveal";
import { SampleTag, SectionHead } from "@/components/SectionHead";

const BEFORE = ["Built dashboards for the sales and product teams.", "Worked on the data pipeline for checkout.", "Ran experiments on pricing.", "Helped prepare quarterly reports."];

const AFTER: { text: string; why?: string }[] = [
  { text: "Wrote the SQL and Looker dashboards product and sales used weekly, over three years at Halden Labs.", why: "The job asks for SQL and 3+ years. From: Halden Labs, 2021 to 2024." },
  { text: "Worked on the data pipeline for checkout." },
  { text: "Ran the pricing A/B test that lifted checkout conversion 4%.", why: "Matches “experimentation”. From: your note on the pricing test." },
  { text: "Helped prepare quarterly reports." },
];

/** 05 · Tailored, never invented: the same resume before and after, every change with its reason and its source. */
export function Tailored() {
  return (
    <section aria-labelledby="tailored-title" className="bg-surface-2 py-section">
      <div className="wrap">
        <SectionHead
          id="tailored-title"
          eyebrow="Your resume"
          title="Tailored to the job. Never invented."
          lead="Each change says why it was made and which line of your history it came from."
          className="mb-12 laptop:mb-28"
        />
        <Reveal className="grid gap-6 laptop:grid-cols-2">
          <div className="flex flex-col gap-4 rounded-card border-[1.5px] border-line bg-surface p-6">
            <div className="flex items-center justify-between">
              <p className="font-mono text-label text-ink-2">Before</p>
              <SampleTag />
            </div>
            <p className="font-semibold">Sam Rivera · Data analyst, Halden Labs</p>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-ink-2">
              {BEFORE.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
          <div data-nori-seat="tailored" className="flex flex-col gap-4 rounded-card border-[1.5px] border-line bg-surface p-6">
            <div className="flex items-center justify-between">
              <p className="font-mono text-label text-ink-2">After, for Fernway · Product analyst</p>
              <SampleTag />
            </div>
            <p className="font-semibold">Sam Rivera · Data analyst, Halden Labs</p>
            <ul className="flex flex-col gap-2">
              {AFTER.map((a) =>
                a.why ? (
                  <li key={a.text} className="rounded-row border-2 border-accent p-3">
                    <p>{a.text}</p>
                    <p className="mt-1.5 text-small text-ink-2">
                      <span className="font-semibold text-accent">Why:</span> {a.why}
                    </p>
                  </li>
                ) : (
                  <li key={a.text} className="list-disc pl-0 text-ink-2 marker:text-ink-2 [margin-left:1.25rem]">
                    {a.text}
                  </li>
                ),
              )}
            </ul>
            <p className="mt-auto pt-2 text-small font-semibold">
              <span className="font-mono">8</span> of <span className="font-mono">9</span> must-haves shown · 1 page
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
