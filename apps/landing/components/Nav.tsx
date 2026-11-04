"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/Button";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

/**
 * Spec section 7: transparent and 80 px tall over the hero; once the hero has scrolled away, a sticky 64 px bar on the
 * page colour. Below 1024 px the links move into a full-height sheet behind a menu button.
 */
export function Nav() {
  const [solid, setSolid] = useState(false);
  const menu = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const hero = document.getElementById("hero");
    if (!hero) return;
    const io = new IntersectionObserver(([entry]) => setSolid(!entry?.isIntersecting), { rootMargin: "-80px 0px 0px 0px" });
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  const close = () => menu.current?.close();

  return (
    <header
      className={`fixed inset-x-0 top-0 z-[var(--z-nav)] transition-[background-color,border-color,height] duration-[var(--dur-base)] ease-out ${
        solid ? "h-16 border-b border-line bg-bg/92 backdrop-saturate-150" : "h-20 border-b border-transparent bg-transparent"
      }`}
    >
      <div className="wrap flex h-full items-center justify-between gap-4">
        {/* No prefetch: on the home page it would fetch the page it's already on (9 KB of the first screen). */}
        <Link href="/" prefetch={false} className="flex items-center gap-2.5 text-ink no-underline" aria-label="Norinote, home">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 32 px static icon; next/image adds nothing here */}
          <img src="/icon-32.png" alt="" width={32} height={32} className="size-8" />
          <span className="text-[1.125rem] font-bold tracking-[-0.01em]">Norinote</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-7 laptop:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="py-1.5 text-[0.9375rem] text-ink no-underline underline-offset-[3px] hover:underline hover:decoration-accent">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2.5">
          {/* max-*:hidden, not hidden + a display utility: the button's own inline-flex would win over plain hidden. */}
          <Link href="/signin" className={buttonClass("outline", "min-h-11 px-5 max-laptop:hidden")}>
            Sign in
          </Link>
          {/* Over the hero the hero's own button is the one primary; the bar's becomes primary once the hero is gone. */}
          <Link href="/signup" className={buttonClass(solid ? "primary" : "outline", "min-h-11 px-5 max-tablet:hidden")}>
            Get started
          </Link>
          <button
            type="button"
            onClick={() => menu.current?.showModal()}
            aria-label="Open menu"
            aria-haspopup="dialog"
            className="grid size-11 place-items-center rounded-input border-[1.5px] border-ink laptop:hidden"
          >
            <span aria-hidden="true" className="flex flex-col gap-1">
              <span className="block h-0.5 w-[18px] bg-ink" />
              <span className="block h-0.5 w-[18px] bg-ink" />
              <span className="block h-0.5 w-[18px] bg-ink" />
            </span>
          </button>
        </div>
      </div>

      <dialog ref={menu} className="sheet h-svh max-h-svh" aria-label="Menu" onClick={(e) => e.target === menu.current && close()}>
        <div className="flex h-full flex-col gap-8 bg-bg px-4 pt-4 pb-8">
          <div className="flex items-center justify-between">
            <span className="text-[1.125rem] font-bold">Norinote</span>
            <button type="button" onClick={close} aria-label="Close menu" className="grid size-11 place-items-center rounded-input border-[1.5px] border-ink text-[1.25rem] leading-none">
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <nav aria-label="Main" className="flex flex-col">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={close} className="border-b border-line py-4 font-serif text-[2rem] text-ink no-underline">
                {l.label}
              </a>
            ))}
          </nav>
          <div className="mt-auto flex flex-col gap-3">
            <Link href="/signup" onClick={close} className={buttonClass("primary", "w-full")}>
              Get started
            </Link>
            <Link href="/signin" onClick={close} className={buttonClass("outline", "w-full")}>
              Sign in
            </Link>
          </div>
        </div>
      </dialog>
    </header>
  );
}
