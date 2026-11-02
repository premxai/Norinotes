import Link from "next/link";
import type { ReactNode } from "react";
import { NorinoteLogo } from "@/components/Logo";
import { btnPrimary } from "@/components/home/styles";
import { cx } from "@/components/cx";

/**
 * The public source repository, or null. Links to it are shown only when NEXT_PUBLIC_REPO_URL is set: while the repo is
 * private every visitor got "page not found". Set it once it is public.
 */
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL?.trim() || null;
export const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null;

export function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className="inline-flex items-center rounded-control" aria-label="Norinote home">
      <NorinoteLogo size={30} tone={light ? "light" : "dark"} />
    </Link>
  );
}

/** The signed-out chrome for the legal pages. */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-ink focus:px-3 focus:py-2 focus:text-on-ink">Skip to content</a>
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 w-full max-w-[1120px] items-center justify-between px-4 sm:px-8">
          <Wordmark />
          <nav aria-label="Account" className="flex items-center gap-1 text-[14px] font-medium">
            <Link href="/login" className="rounded-control px-3 py-2 text-ink-2 hover:bg-sunken hover:text-ink">Sign in</Link>
            <Link href="/signup" className={cx(btnPrimary, "h-10 px-4 text-[14px]")}>Create account</Link>
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}

export function PublicFooter({ dark = false }: { dark?: boolean }) {
  const link = dark ? "text-on-ink/80 hover:text-on-ink" : "text-muted hover:text-ink";
  return (
    <footer className="mx-auto w-full max-w-[1120px] px-4 py-8 text-[13px] text-muted sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line pt-6">
        <p>Norinote, a personal job agent.</p>
        <nav aria-label="Legal and project" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/privacy" className={`underline-offset-4 hover:underline ${link}`}>Privacy</Link>
          <Link href="/terms" className={`underline-offset-4 hover:underline ${link}`}>Terms</Link>
          {REPO_URL && <a href={REPO_URL} target="_blank" rel="noreferrer" className={`underline-offset-4 hover:underline ${link}`}>Source code</a>}
        </nav>
      </div>
    </footer>
  );
}

/** A long-form page: title, last-updated line, then sections with headings, at a readable measure. */
export function Prose({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <article className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-10 sm:px-8">
      <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.02em] sm:text-[2.5rem]">{title}</h1>
      <p className="mt-2 text-[13px] text-muted">Last updated {updated}</p>
      <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink-2 [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mb-3 [&_h2]:text-[1.25rem] [&_h2]:font-semibold [&_h2]:tracking-[-0.01em] [&_h2]:text-ink [&_li]:mt-1.5 [&_p+p]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </article>
  );
}
