import Link from "next/link";
import { preload } from "react-dom";
import { buttonClass } from "@/components/Button";
import { scenes, srcSet } from "@/lib/scenes";
import { NoriNote } from "@/components/NoriNote";
import { Scene } from "@/components/Scene";
import { Seat } from "@/components/Seat";

/**
 * 01 · Poster hero (ui-plan.md, spec sections 2 and 11): the Dawn scene full bleed, the headline in its calm sky, and
 * Nori on the hilltop with its note. The scene's box is a size container so the seats track the hill at any size.
 */
export function Hero() {
  // The scene is the page's largest paint: tell the browser about it before it reaches the <picture>.
  for (const [id, media] of [["hero-phone", "(max-width: 767px)"], ["hero", "(min-width: 768px)"]] as const) {
    const s = scenes[id];
    preload(s.sources.at(-1)?.avif ?? "", { as: "image", type: "image/avif", imageSrcSet: srcSet(s, "avif"), imageSizes: "100vw", fetchPriority: "high", media });
  }
  return (
    <section id="hero" aria-labelledby="hero-title" className="relative flex h-svh max-h-[1080px] min-h-[640px] flex-col overflow-hidden bg-sky">
      {/*
        Anchored 30% from the top, not the bottom: on wide, short screens (1280 × 720) the drawn image is taller than the
        box, and a bottom anchor lifts the hill (and Nori) into the buttons. Tall screens cover by height, so it's moot there.
      */}
      <Scene id="hero" phone="hero-phone" priority position="50% 30%" />
      {/* The seats get their own layer above the words, so Nori's open note covers the text rather than sitting under it. */}
      <div className="pointer-events-none absolute inset-0 z-[2] [container-type:size] [&_button]:pointer-events-auto [&_[role=region]]:pointer-events-auto">
        <Seat name="hero" scene="hero" py={0.3} className="max-tablet:hidden">
          <NoriNote variant="desktop" />
        </Seat>
        <Seat name="hero" scene="hero-phone" py={0.3} className="tablet:hidden" />
        {/* On phones the note sits at the hero's bottom left, always below the words: beside Nori it ran into the
            subhead on short screens (360 × 640). */}
        <div className="absolute bottom-6 left-4 tablet:hidden">
          <NoriNote variant="phone" />
        </div>
      </div>

      <div className="wrap relative flex flex-col items-center gap-6 pt-[clamp(6.5rem,15svh,9rem)] text-center">
        <h1 id="hero-title" className="max-w-headline font-serif text-display text-ink">
          A few jobs you&rsquo;re likely to get, every morning.
        </h1>
        {/* On the scene, text is always ink (spec section 5): ink-2 falls below 4.5:1 low in the sky. */}
        <p className="hero-lead max-w-lead text-lead text-ink">
          Nori finds them, tailors your resume and applies when you say so, in about <span className="tabular-nums">20</span> seconds each.
        </p>
        <div className="flex w-full flex-col justify-center gap-3 tablet:w-auto tablet:flex-row">
          {/* Internal links use next/link so Nori stays mounted across pages. */}
          <Link href="/signup" className={buttonClass("primary", "w-full tablet:w-auto")}>
            Get started
          </Link>
          <a href="#replay" className={buttonClass("outline", "max-tablet:hidden hover:bg-surface/60")}>
            Watch Nori apply
          </a>
        </div>
      </div>
    </section>
  );
}
