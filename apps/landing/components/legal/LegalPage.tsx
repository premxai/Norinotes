import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Blocks, Inline } from "@/components/legal/Blocks";
import { longDate, type LegalDoc, type LegalName } from "@/lib/legal";
import { Footer } from "@/sections/Footer";

const OTHER: Record<LegalName, { href: string; label: string }> = {
  privacy: { href: "/terms", label: "terms of service" },
  terms: { href: "/privacy", label: "privacy policy" },
};

/**
 * /privacy and /terms (legal pages spec section 3): the landing page's nav and footer around one 680 px column with the
 * title, the summary, the list of sections and the full text. Nori reads beside the title (section 7).
 */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  const other = OTHER[doc.name];
  return (
    <>
      <div className="print:hidden">
        <Nav onHome={false} />
      </div>
      <main id="main" className="legal px-[var(--page-x)] pt-28 pb-section laptop:pt-32 print:p-0">
        <article className="mx-auto flex max-w-[42.5rem] flex-col gap-[22px] text-[1.0625rem] leading-[1.65] text-ink laptop:gap-7">
          <header className="relative flex min-h-[7.5rem] flex-col justify-end gap-2.5 pr-28 laptop:min-h-0 laptop:pr-0">
            <p className="font-mono text-label tracking-[0.06em] text-ink-2 uppercase">Legal</p>
            <h1 className="font-serif text-auth text-ink">{doc.title}</h1>
            <p className="text-small text-ink-2">
              Last updated <time dateTime={doc.updated}>{longDate(doc.updated)}</time>
            </p>
            {/* Nori's seat: at the header's right end on phones and tablets, beside the title in the margin from 1024 px. */}
            <div aria-hidden="true" data-nori-seat="legal" className="pointer-events-none absolute right-12 bottom-0 size-px laptop:-right-24 laptop:bottom-6 print:hidden" />
          </header>

          <section aria-labelledby="in-short" className="rounded-card bg-tint px-6 py-5">
            <h2 id="in-short" className="mb-1.5 text-small font-semibold">
              In short
            </h2>
            <p className="text-lead">
              <Inline text={doc.summary} />
            </p>
          </section>

          <nav aria-labelledby="on-this-page" className="rounded-card border-[1.5px] border-line bg-surface px-6 py-[18px] print:hidden">
            <h2 id="on-this-page" className="mb-2 text-small font-semibold">
              On this page
            </h2>
            <ol className="list-decimal pl-[22px] text-[0.9375rem] leading-[1.5] tablet:columns-2 tablet:gap-8">
              {doc.sections.map((s) => (
                <li key={s.id} className="mb-1.5 break-inside-avoid">
                  <a href={`#${s.id}`} className="text-ink underline decoration-accent underline-offset-[3px] hover:decoration-2">
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {doc.sections.map((s) => (
            <section key={s.id} aria-labelledby={s.id} className="flex flex-col gap-3.5 border-t-[1.5px] border-line pt-6">
              <h2 id={s.id} className="scroll-mt-20 font-serif text-[1.625rem] leading-[1.15] tracking-[-0.015em] laptop:text-[1.875rem]">
                {s.number}. {s.title}
              </h2>
              <Blocks blocks={s.blocks} caption={s.title} />
            </section>
          ))}

          <p className="text-body print:hidden">
            Also read the{" "}
            <Link href={other.href} className="text-ink underline decoration-accent underline-offset-[3px] hover:decoration-2">
              {other.label}
            </Link>
            .
          </p>
        </article>
      </main>
      <div className="print:hidden">
        <Footer />
      </div>
    </>
  );
}
