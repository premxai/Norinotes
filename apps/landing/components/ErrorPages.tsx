"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/Button";
import { SceneFrame } from "@/components/SceneFrame";
import { PageHead } from "@/components/app/PageHead";
import { noriReact } from "@/lib/auth-flow";

/* Page not found and something broke (error pages spec sections 3 and 4): as full pages on the fork scene, and inside
   the dashboard's shell. The error's details never reach the page. */

export type ErrorKind = "lost" | "broke";

const WORDS: Record<ErrorKind, { title: string; lead: string }> = {
  lost: { title: "This page isn’t here", lead: "The link may be old, or the address may have a typo." },
  broke: { title: "Something went wrong on this page", lead: "It’s not you. Try again; if it keeps happening, come back in a little while." },
};

/**
 * Nori's reaction (section 7): looking around for a missing page; dizzy, then comforting, for a broken one. The page
 * first asks Nori's stage to choose its seat again (it may have replaced another page at the same address), and reacts
 * once Nori is seated, or after a second if no new seat comes.
 */
function useNori(kind: ErrorKind) {
  useEffect(() => {
    let done = false;
    const react = () => {
      if (done) return;
      done = true;
      if (kind === "lost") void noriReact({ row: "look", say: "Hmm, nothing here." });
      // Comfort waits for dizzy to have played: until a first load settles Nori keeps only the latest request, so
      // asking sooner would drop dizzy.
      else void noriReact({ row: "dizzy" }, 5000).then(() => noriReact({ row: "comfort", say: "Sorry about that." }));
    };
    addEventListener("norinote:seated", react, { once: true });
    const t = window.setTimeout(react, 1000);
    dispatchEvent(new Event("norinote:seats"));
    return () => {
      done = true;
      clearTimeout(t);
      removeEventListener("norinote:seated", react);
      // Gone (Try again worked, or the visitor moved on): the page underneath gets its seat back.
      queueMicrotask(() => dispatchEvent(new Event("norinote:seats")));
    };
  }, [kind]);
}

/**
 * Try again: fetches the page's server data afresh and re-renders the broken part (section 4). If it breaks again, the
 * boundary shows again as it was.
 */
function useRetry(reset?: () => void) {
  const router = useRouter();
  const [trying, setTrying] = useState(false);
  const retry = () => {
    if (!reset || trying) return;
    setTrying(true);
    startTransition(() => {
      router.refresh();
      reset();
      setTrying(false);
    });
  };
  return { trying, retry };
}

/** The heading takes focus when an error replaced the page under the visitor; a fresh 404 leaves focus alone. */
function useFocusOnError(kind: ErrorKind) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (kind === "broke") heading.current?.focus();
  }, [kind]);
  return heading;
}

function Buttons({ kind, retry, trying, home }: { kind: ErrorKind; retry: () => void; trying: boolean; home: { href: string; label: string } }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {kind === "broke" ? (
        <>
          <button type="button" onClick={retry} aria-disabled={trying || undefined} className={buttonClass("primary", "min-h-12")}>
            {trying ? "Trying again…" : "Try again"}
          </button>
          <Link href={home.href} prefetch={false} className={buttonClass("outline", "min-h-12")}>
            {home.label}
          </Link>
        </>
      ) : (
        <Link href={home.href} prefetch={false} className={buttonClass("primary", "min-h-12")}>
          {home.label}
        </Link>
      )}
      <p role="status" className="sr-only">
        {trying ? "Trying again…" : ""}
      </p>
    </div>
  );
}

/** A full page (outside the dashboard): the fork scene with Nori on its stone, and the card. */
export function FullError({ kind, reset }: { kind: ErrorKind; reset?: () => void }) {
  useNori(kind);
  const { trying, retry } = useRetry(reset);
  const heading = useFocusOnError(kind);
  const w = WORDS[kind];
  return (
    <SceneFrame scene="fork" seat="error">
      <div className="flex flex-col gap-6 laptop:gap-8">
        <div className="flex flex-col gap-2 laptop:gap-3">
          <h1 ref={heading} tabIndex={-1} className="font-serif text-auth text-ink outline-none">
            {w.title}
          </h1>
          <p className="text-lead text-ink-2">{w.lead}</p>
        </div>
        {kind === "lost" ? (
          <div className="flex flex-wrap items-center gap-2.5">
            <Link href="/" prefetch={false} className={buttonClass("primary", "min-h-12")}>
              Go to the home page
            </Link>
            <Link href="/overview" prefetch={false} className={buttonClass("outline", "min-h-12")}>
              Open your dashboard
            </Link>
          </div>
        ) : (
          <Buttons kind={kind} retry={retry} trying={trying} home={{ href: "/", label: "Go to the home page" }} />
        )}
      </div>
    </SceneFrame>
  );
}

/** Inside the dashboard: the shell stays; the title row and a card in the content area, no scene. */
export function ShellError({ kind, reset }: { kind: ErrorKind; reset?: () => void }) {
  useNori(kind);
  const { trying, retry } = useRetry(reset);
  const heading = useFocusOnError(kind);
  const w = WORDS[kind];
  return (
    <main id="main" className="mx-auto flex max-w-[960px] flex-col gap-4 px-4 pb-24 tablet:gap-5 tablet:px-8 tablet:pb-12 laptop:px-10 laptop:pt-7">
      <PageHead>
        <h1 ref={heading} tabIndex={-1} className="font-serif text-[2rem] leading-[1.05] text-ink outline-none laptop:text-[2.5rem]">
          {w.title}
        </h1>
      </PageHead>
      <div className="flex max-w-[560px] flex-col items-start gap-4 rounded-card border-[1.5px] border-line bg-surface p-5 tablet:p-6">
        <p className="text-[1.0625rem] leading-[1.55] text-ink-2">{w.lead}</p>
        <Buttons kind={kind} retry={retry} trying={trying} home={{ href: "/overview", label: "Go to Overview" }} />
      </div>
    </main>
  );
}
