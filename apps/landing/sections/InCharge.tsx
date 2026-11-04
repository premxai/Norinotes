import { AskDemo } from "@/components/AskDemo";
import { Scene } from "@/components/Scene";
import { SectionHead } from "@/components/SectionHead";
import { Seat } from "@/components/Seat";

const POINTS = [
  { title: "You approve every send", body: "Or turn on autopilot, and Nori sends only up to the daily cap you set." },
  { title: "Asked once, remembered", body: "Questions only you can answer come to you in one batch. Nori reuses your answer next time." },
  { title: "Stops where you should step in", body: "Captchas and account walls come to you. Nori never gets around them." },
];

/** 06 · You stay in charge: three promises beside Nori's desk, where Nori asks the visitor a real question. */
export function InCharge() {
  return (
    <section aria-labelledby="incharge-title" className="py-section">
      <div className="wrap grid items-center gap-12 laptop:grid-cols-12">
        <div className="flex flex-col gap-8 laptop:col-span-5">
          <SectionHead id="incharge-title" eyebrow="You decide" title="You stay in charge." lead="Nori asks before it acts, remembers what you tell it, and stops where a person should." />
          <ol className="flex flex-col gap-5">
            {POINTS.map((p, i) => (
              <li key={p.title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2">
                <span className="font-mono text-small leading-[1.55] text-accent">{String(i + 1).padStart(2, "0")}</span>
                <span>
                  <span className="font-semibold">{p.title}.</span> <span className="text-ink-2">{p.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="laptop:col-span-7">
          <AskDemo>
            <Scene id="desk" sizes="(min-width: 1024px) 680px, 100vw" position="50% 50%" />
            <Seat name="incharge" scene="desk" />
          </AskDemo>
        </div>
      </div>
    </section>
  );
}
