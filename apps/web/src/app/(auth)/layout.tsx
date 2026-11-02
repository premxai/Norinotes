import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NorinoteLogo } from "@/components/Logo";
import { BrandPanel } from "@/components/auth/BrandPanel";

const quiet = "rounded-md text-muted underline-offset-4 transition-colors hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

/**
 * Signed-out chrome for sign in, sign up, forgot, reset and verify: the form on solid cream on the left, the brand
 * panel on the right on wide screens. On phones the form is the whole page.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-ink lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-h-screen flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-bg">Skip to content</a>
        <header className="flex h-16 items-center justify-between gap-3 px-4 sm:px-8">
          <Link href="/" aria-label="Norinote home" className="rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"><NorinoteLogo size={32} /></Link>
          <Link href="/" className={`${quiet} inline-flex items-center gap-1.5 text-[14px] font-medium`}><ArrowLeft size={16} aria-hidden="true" />Home</Link>
        </header>
        <main id="main" className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-[420px]">{children}</div>
        </main>
        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 pb-6 text-[13px] sm:px-8">
          <Link href="/privacy" className={quiet}>Privacy</Link>
          <Link href="/terms" className={quiet}>Terms</Link>
          <span className="text-muted">Norinote, a personal job agent.</span>
        </footer>
      </div>
      <BrandPanel />
    </div>
  );
}
