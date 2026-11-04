"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { preload } from "react-dom";
import { Scene } from "@/components/Scene";
import { Seat } from "@/components/Seat";
import { scenes, srcSet } from "@/lib/scenes";

export type FrameScene = "gate" | "nook" | "workshop";

/** Where each scene is anchored when the column isn't exactly 2:3; the seats use the same values (auth spec section 7). */
const POSITION: Record<FrameScene, { px: number; py: number }> = {
  gate: { px: 0.9, py: 0.62 },
  nook: { px: 0.78, py: 0.62 },
  workshop: { px: 0.84, py: 0.62 },
};

function SceneBox({ scene, band, seat }: { scene: FrameScene; band: boolean; seat: string }) {
  const id = band ? (`${scene}-band` as const) : scene;
  const { px, py } = band ? { px: 0.5, py: 0.5 } : POSITION[scene];
  const sizes = band ? "100vw" : "42vw";
  // The column and the band are both in the page, one hidden by CSS; both images are lazy, so the hidden one is never
  // fetched, and the visible one is preloaded for its own screen widths, so it still comes first.
  const s = scenes[id];
  preload(s.sources.at(-1)?.avif ?? "", { as: "image", type: "image/avif", imageSrcSet: srcSet(s, "avif"), imageSizes: sizes, fetchPriority: "high", media: band ? "(max-width: 1023px)" : "(min-width: 1024px)" });
  return (
    <>
      {/* Keyed on the scene, so moving between pages with different scenes fades the new one in. */}
      <Scene key={id} id={id} position={`${px * 100}% ${py * 100}%`} sizes={sizes} className="scene-in" />
      <div className="pointer-events-none absolute inset-0 [container-type:size]">
        <Seat name={seat} scene={id} px={px} py={py} />
      </div>
    </>
  );
}

type Props = {
  scene: FrameScene;
  /** The `data-nori-seat` name the page's Nori controller looks for. */
  seat: string;
  /** On the top bar's right, from 768 px (auth: the switch link; onboarding: "Saved as you go"). */
  aside?: ReactNode;
  /** "centred" (auth: a short form in the middle of its column) or "top" (onboarding: taller steps, 560 px wide). */
  layout?: "centred" | "top";
  children: ReactNode;
};

/**
 * The split shell the auth and onboarding pages share (auth spec sections 2 and 6, onboarding spec section 2): from
 * 1024 px the scene fills the left 5/12 and stays put while the form column scrolls; narrower, a logo bar, then the
 * scene as a band, then the form. Only the content changes between pages, so Nori and the scene stay where they are.
 */
export function SceneFrame({ scene, seat, aside, layout = "centred", children }: Props) {
  const top = layout === "top";
  return (
    <div className="min-h-svh bg-bg laptop:grid laptop:grid-cols-[5fr_7fr]">
      <div className="relative max-laptop:hidden">
        <div className="sticky top-0 h-svh min-h-[640px] overflow-hidden">
          <SceneBox scene={scene} band={false} seat={seat} />
        </div>
      </div>

      <div className="flex min-h-svh flex-col">
        <header className="flex h-14 flex-none items-center justify-between px-[var(--page-x)] tablet:h-[72px] laptop:px-12">
          {/* No prefetch: the home page's payload carries the hero's image preloads, which this page doesn't need. */}
          <Link href="/" prefetch={false} className="flex min-h-11 items-center gap-2 no-underline" aria-label="Norinote, home">
            {/* eslint-disable-next-line @next/next/no-img-element -- a 32 px static icon; next/image adds nothing here */}
            <img src="/icon-32.png" alt="" width={28} height={28} className="size-7" />
            <span className="text-[1.0625rem] font-bold text-ink">Norinote</span>
          </Link>
          {aside}
        </header>

        <div className="relative h-[clamp(200px,30svh,260px)] flex-none overflow-hidden tablet:h-[clamp(220px,34svh,320px)] laptop:hidden">
          <SceneBox scene={scene} band seat={seat} />
        </div>

        <main
          id="main"
          className={
            top
              ? "flex flex-1 justify-center px-[var(--page-x)] pt-6 pb-[100px] tablet:pb-12 laptop:px-12"
              : "flex flex-1 justify-center px-[var(--page-x)] pt-7 pb-12 tablet:pt-10 laptop:items-center laptop:px-12 laptop:pt-0 laptop:pb-[72px] laptop:[@media(height<700px)]:items-start laptop:[@media(height<700px)]:pt-6"
          }
        >
          <div className={`w-full ${top ? "max-w-step" : "max-w-note"}`}>{children}</div>
        </main>
      </div>
    </div>
  );
}
