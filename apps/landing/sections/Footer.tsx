import Link from "next/link";
import { Scene } from "@/components/Scene";
import { Seat } from "@/components/Seat";

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

/** 12 · Footer: a low strip of the same hills, where Nori falls asleep if you linger, then the links. */
export function Footer() {
  return (
    <footer className="bg-bg">
      {/* overflow-hidden: on narrow screens the cropped scene puts the hill seat past the edge (Nori docks there anyway). */}
      <div className="relative aspect-[4/1] max-h-[22rem] min-h-40 w-full overflow-hidden [container-type:size]">
        <Scene id="footer" sizes="100vw" />
        <Seat name="footer" scene="footer" />
      </div>
      <div className="wrap flex flex-col gap-8 border-t-[1.5px] border-line py-10 tablet:flex-row tablet:items-center tablet:justify-between">
        <Link href="/" className="flex items-center gap-2.5 text-ink no-underline">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 32 px static icon */}
          <img src="/icon-32.png" alt="" width={32} height={32} className="size-8" />
          <span className="font-bold">Norinote</span>
        </Link>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-3 text-[0.9375rem] tablet:flex tablet:flex-wrap tablet:gap-7">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="inline-block py-1.5 text-ink underline-offset-[3px] hover:underline hover:decoration-accent">
              {l.label}
            </Link>
          ))}
        </nav>
        <p className="text-small text-ink-2">Open source, MIT license.</p>
      </div>
    </footer>
  );
}
