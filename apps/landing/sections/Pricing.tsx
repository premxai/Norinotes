import Link from "next/link";
import { buttonClass } from "@/components/Button";
import { Reveal } from "@/components/Reveal";
import { SectionHead } from "@/components/SectionHead";

const FREE = ["A daily shortlist of jobs you're likely to get", "A tailored resume and answers for each one", "You approve what's sent"];

/** 09 · Pricing: Free and Pro at $9. Free's limits aren't decided and Pro's autopilot isn't built yet; the cards say so. Pro first on phones. */
export function Pricing() {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-16 bg-surface-2 py-section">
      <div className="wrap">
        {/* The extra room on desktop is Nori's, which stands on the Pro card. */}
        <SectionHead id="pricing-title" eyebrow="Pricing" title="Simple pricing." center className="mb-12 laptop:mb-28" />
        <Reveal className="mx-auto grid max-w-pricing gap-6 tablet:grid-cols-2">
          <article className="order-2 flex flex-col gap-4 rounded-card border-[1.5px] border-line bg-surface p-7 tablet:order-1">
            <h3 className="text-h3 font-semibold">Free</h3>
            <p className="font-serif text-[3.5rem] leading-none">$0</p>
            <span className="self-start rounded-full bg-tint px-2.5 py-1 font-mono text-tag text-ink-2">Limits to be decided</span>
            <ul className="flex flex-col gap-2 text-ink-2">
              {FREE.map((f) => (
                <li key={f}>✓ {f}</li>
              ))}
            </ul>
            <Link href="/signup" className={buttonClass("outline", "mt-auto")}>
              Get started
            </Link>
          </article>
          <article data-nori-seat="pricing" className="order-1 flex flex-col gap-4 rounded-card border-[2.5px] border-accent bg-surface p-7 tablet:order-2">
            <h3 className="text-h3 font-semibold">Pro</h3>
            <p className="font-serif text-[3.5rem] leading-none">
              $9<span className="font-sans text-[1.125rem] text-ink-2"> a month</span>
            </p>
            <span className="self-start rounded-full bg-tint px-2.5 py-1 font-mono text-tag text-ink-2">Coming soon · nothing is charged yet</span>
            <p className="font-semibold">Everything in Free, plus autopilot within your daily cap</p>
            <ul className="flex flex-col gap-2 text-ink-2">
              <li>✓ Nori sends the day&rsquo;s best matches for you, up to your cap</li>
              <li>✓ Stop or change the cap any time</li>
            </ul>
            <Link href="/signup?plan=pro" className={buttonClass("primary", "mt-auto")}>
              Start Pro
            </Link>
          </article>
        </Reveal>
      </div>
    </section>
  );
}
