import { Reveal } from "@/components/Reveal";
import { SampleTag, SectionHead } from "@/components/SectionHead";
import { TODAY } from "@/lib/sample";

const STATUS: Record<string, string> = { "Product analyst": "Sent", "Data analyst": "Reply", "Operations analyst": "Needs you" };

/** 08 · Wherever you are: the dashboard (its one appearance on the page), Telegram, and Nori's own inbox. */
export function Wherever() {
  return (
    <section aria-labelledby="wherever-title" className="py-section">
      <div className="wrap">
        {/* The extra room on desktop is Nori's, which stands on the inbox tile (spec section 3). */}
        <SectionHead id="wherever-title" eyebrow="Anywhere" title="Approve from wherever you are." className="mb-12 laptop:mb-28" />
        <Reveal className="grid gap-5 tablet:grid-cols-2 laptop:grid-cols-3">
          <article className="flex flex-col gap-4 rounded-card border-[1.5px] border-line bg-surface p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-h3 font-semibold">Dashboard</h3>
              <SampleTag />
            </div>
            <ul className="flex flex-col gap-2 text-small">
              {TODAY.map((j) => (
                <li key={j.title} className="flex items-center justify-between gap-2 rounded-row border-[1.5px] border-line px-3 py-2">
                  <span className="truncate">
                    {j.company} · {j.title}
                  </span>
                  <span className={`shrink-0 font-semibold ${STATUS[j.title] === "Needs you" ? "text-warning" : "text-accent"}`}>{STATUS[j.title]}</span>
                </li>
              ))}
            </ul>
            <p className="mt-auto text-ink-2">Your shortlist, runs and replies in one place.</p>
          </article>
          <article className="flex flex-col gap-4 rounded-card border-[1.5px] border-line bg-surface p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-h3 font-semibold">Telegram</h3>
              <SampleTag />
            </div>
            <div className="flex flex-col gap-2">
              <p className="rounded-[14px_14px_14px_4px] border-[1.5px] border-line bg-surface-2 px-3.5 py-2.5 text-small">Fernway · Product analyst is ready. Send it?</p>
              <div className="flex gap-2" aria-hidden="true">
                <span className="rounded-full bg-accent px-4 py-1.5 text-small font-semibold text-on-accent">Send</span>
                <span className="rounded-full border-[1.5px] border-ink px-4 py-1.5 text-small font-semibold">Skip</span>
              </div>
            </div>
            <p className="mt-auto text-ink-2">Approve or skip from a message.</p>
          </article>
          <article data-nori-seat="wherever" className="flex flex-col gap-4 rounded-card border-[1.5px] border-line bg-surface p-6 tablet:col-span-2 laptop:col-span-1">
            <div className="flex items-center justify-between">
              <h3 className="text-h3 font-semibold">Nori&rsquo;s own inbox</h3>
              <SampleTag />
            </div>
            <ul className="flex flex-col gap-2 text-small">
              <li className="flex justify-between gap-2 rounded-row border-[1.5px] border-line px-3 py-2">
                <span>Fernway · Your code</span>
                <span className="font-mono">482 913</span>
              </li>
              <li className="flex justify-between gap-2 rounded-row border-[1.5px] border-line px-3 py-2">
                <span>Halden Labs · Next steps</span>
                <span className="font-semibold text-accent">Reply</span>
              </li>
            </ul>
            <p className="mt-auto text-ink-2">Codes and replies land here, not in your personal email.</p>
          </article>
        </Reveal>
      </div>
    </section>
  );
}
