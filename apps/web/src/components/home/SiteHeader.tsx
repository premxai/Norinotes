import Link from "next/link";
import { NorinoteLogo } from "@/components/Logo";
import { cx } from "@/components/cx";
import { btnPrimary, container } from "./styles";

const SECTIONS = [["#loop", "How it works"], ["#honest", "Why trust it"]] as const;
const navLink = "rounded-control px-3 py-2 text-[14px] font-medium text-ink-2 hover:bg-sunken hover:text-ink";

/** Top bar of the public pages: logo, section links on wide screens, sign in, create account. */
export function SiteHeader() {
  return (
    <header className="border-b border-line bg-bg">
      <div className={cx(container, "flex h-16 items-center justify-between gap-3")}>
        <Link href="/" aria-label="Norinote home" className="shrink-0 rounded-control">
          <NorinoteLogo size={30} />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          {SECTIONS.map(([href, label]) => (
            <a key={href} href={href} className={cx(navLink, "hidden md:inline-flex")}>{label}</a>
          ))}
          <Link href="/login" className={navLink}>Sign in</Link>
          <Link href="/signup" className={cx(btnPrimary, "ml-1 h-10 px-4 text-[14px]")}>Create account</Link>
        </nav>
      </div>
    </header>
  );
}
