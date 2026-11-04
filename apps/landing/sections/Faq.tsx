import { SectionHead } from "@/components/SectionHead";

// Every answer is checked against the product (ARCHITECTURE.md, docs/applying.md, docs/inbox.md). Keep them that way.
const FAQ = [
  {
    q: "Does Nori apply without asking me?",
    a: "Only if you turn on autopilot, and only up to the daily cap you set. Otherwise every application waits for your click.",
  },
  {
    q: "Will it make things up on my resume?",
    a: "No. Every change comes from your own history, and each one shows the line it came from. Legal and eligibility questions are answered only from your profile.",
  },
  {
    q: "Which job sites does it work with?",
    a: "It applies on Greenhouse, Lever and Ashby today. Workday needs an account with each employer, which Norinote never creates, so those jobs come to you. More systems are on the way.",
  },
  {
    q: "What happens with captchas and account walls?",
    a: "Nori stops and tells you. It never solves or gets around a captcha.",
  },
  {
    q: "What happens to my email?",
    a: "Nori uses its own inbox address for codes and replies, so your personal email stays out of it. It keeps the text of those messages for 90 days by default (you can shorten that) and never keeps attachments. Deleting your account deletes them.",
  },
  {
    q: "How much does it cost?",
    a: "It's free to start. Pro is $9 a month and adds autopilot.",
  },
  {
    q: "Is it open source?",
    a: "Yes, under the MIT license.",
  },
];

/** 10 · FAQ: native <details>, short honest answers. */
export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-16 py-section">
      <div className="wrap">
        <div className="mx-auto max-w-faq">
        <div data-nori-seat="faq">
          <SectionHead id="faq-title" eyebrow="Questions" title="Questions, answered." className="mb-8" />
        </div>
        <div className="border-t-[1.5px] border-line">
          {FAQ.map((f, i) => (
            <details key={f.q} open={i === 0} className="group border-b-[1.5px] border-line">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[1.125rem] font-semibold [&::-webkit-details-marker]:hidden">
                {f.q}
                <span aria-hidden="true" className="text-[1.5rem] leading-none text-ink-2 transition-[rotate] duration-[var(--dur-base)] ease-out group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="max-w-[68ch] pb-5 text-ink-2">{f.a}</p>
            </details>
          ))}
        </div>
        </div>
      </div>
    </section>
  );
}
