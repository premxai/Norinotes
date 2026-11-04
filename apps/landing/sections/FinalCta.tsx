import Link from "next/link";
import { buttonClass } from "@/components/Button";
import { Scene } from "@/components/Scene";
import { Seat } from "@/components/Seat";

/**
 * 11 · Final call to action on the later-morning horizon. From 1280 px the headline and button sit in the scene's sky,
 * inside the middle half of the width and the top 44%, where ink stays above 9.8:1 (spec section 8). Narrower screens
 * would push the words into the busy hills, so there they sit on plain `bg` above the scene. The button is a drop
 * target: dropping Nori on it plays `welcome` and opens sign-up.
 */
export function FinalCta() {
  return (
    <section id="start" aria-labelledby="final-title" className="scroll-mt-20 px-[var(--page-x)] pb-8">
      <div className="relative mx-auto max-w-[86rem] overflow-hidden rounded-panel">
        <div className="relative z-[1] flex flex-col items-center gap-5 px-4 pt-16 pb-10 text-center desktop:absolute desktop:inset-x-[25%] desktop:top-[6%] desktop:gap-6 desktop:p-0">
          <h2 id="final-title" className="font-serif text-cta text-ink">
            Let Nori take the first shift.
          </h2>
          <p className="text-lead text-ink-2 desktop:hidden">Upload your resume and see your first shortlist.</p>
          <Link href="/signup" data-nori-drop="signup" className={buttonClass("primary", "min-h-14 w-full px-8 text-[1.125rem] tablet:w-auto")}>
            Get started
          </Link>
        </div>
        <div className="relative aspect-[4/3] overflow-hidden rounded-panel [container-type:size] tablet:aspect-[16/9] desktop:aspect-[2/1] desktop:rounded-none">
          <Scene id="horizon" sizes="(min-width: 1440px) 1376px, 100vw" />
          <Seat name="final" scene="horizon" />
        </div>
      </div>
    </section>
  );
}
