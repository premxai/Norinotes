"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Briefcase, Ellipsis, Inbox, Network, Send, Settings, Sun, UserRound, X, type LucideIcon } from "lucide-react";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { NorinoteLogo } from "./Logo";
import { LogoutButton } from "./LogoutButton";
import { DryRunBand } from "./DryRunBand";

export type ShellData = {
  needsYouCount: number;
  unreadCount: number;
  userName: string;
  mock: boolean;
  /** False: this server never sends; forms are filled and stop. Shown as a band on every page. */
  liveSubmit: boolean;
};

type NavItem = { href: string; label: string; icon: LucideIcon; count?: (d: ShellData) => number; attn?: boolean };
type NavGroup = { label: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    label: "Work",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: Sun, count: (d) => d.needsYouCount, attn: true },
      { href: "/applications", label: "Applications", icon: Send },
      { href: "/jobs", label: "Jobs", icon: Briefcase },
    ],
  },
  {
    label: "Evidence",
    items: [
      { href: "/graph", label: "Career graph", icon: Network },
      { href: "/inbox", label: "Inbox", icon: Inbox, count: (d) => d.unreadCount },
    ],
  },
];

const FOOT: NavItem[] = [
  { href: "/profile", label: "Profile", icon: UserRound },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Phone tab bar. Everything else lives behind "More". */
const TABS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: Sun, count: (d) => d.needsYouCount, attn: true },
  { href: "/applications", label: "Applications", icon: Send },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/inbox", label: "Inbox", icon: Inbox, count: (d) => d.unreadCount },
];
const MORE: NavItem[] = [...NAV.flatMap((g) => g.items).filter((i) => !TABS.some((t) => t.href === i.href)), ...FOOT];

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function Count({ n, attn }: { n: number; attn?: boolean }) {
  if (n <= 0) return null;
  return (
    <span className={cx("min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5 tnum", attn ? "bg-attn-tint text-attn-fg ring-1 ring-inset ring-attn" : "bg-sunken text-ink-2")}>
      {n}
      <span className="sr-only">{attn ? " waiting on you" : " new"}</span>
    </span>
  );
}

function RailLink({ item, data, pathname, onNavigate }: { item: NavItem; data: ShellData; pathname: string; onNavigate?: () => void }) {
  const active = isActive(pathname, item.href);
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cx(
          "flex min-h-9 items-center gap-3 rounded-control px-3 text-[13.5px] transition-colors duration-150",
          active ? "bg-sunken font-semibold text-ink" : "font-medium text-ink-2 hover:bg-sunken/70 hover:text-ink",
        )}
      >
        <Icon icon={item.icon} size={17} className={active ? "text-ink" : "text-muted"} />
        <span className="flex-1">{item.label}</span>
        <Count n={item.count?.(data) ?? 0} attn={item.attn} />
      </Link>
    </li>
  );
}

function Rail({ data, pathname }: { data: ShellData; pathname: string }) {
  return (
    <aside className="sticky top-0 hidden h-[100dvh] w-[var(--rail-w)] shrink-0 flex-col border-r border-line px-3 py-5 lg:flex">
      <Link href="/dashboard" aria-label="Norinote, Dashboard" className="mb-6 inline-flex px-3"><NorinoteLogo size={28} /></Link>
      <nav aria-label="Main" className="flex flex-col gap-5">
        {NAV.map((g) => (
          <div key={g.label}>
            <p className="mb-1 px-3 text-[12px] font-medium text-muted">{g.label}</p>
            <ul className="flex flex-col gap-0.5">{g.items.map((i) => <RailLink key={i.href} item={i} data={data} pathname={pathname} />)}</ul>
          </div>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-3">
        <ul className="flex flex-col gap-0.5">{FOOT.map((i) => <RailLink key={i.href} item={i} data={data} pathname={pathname} />)}</ul>
        <div className="flex items-center justify-between gap-2 border-t border-line px-3 pt-3">
          <span className="min-w-0 truncate text-meta text-ink-2">{data.userName}</span>
          <LogoutButton />
        </div>
        {data.mock && <p className="px-3 text-[12px] text-muted">Demo data, nothing is real.</p>}
      </div>
    </aside>
  );
}

export function Shell({ data, children }: { data: ShellData; children: ReactNode }) {
  const pathname = usePathname();
  // The More sheet belongs to the page it was opened on, so moving to another page closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const moreActive = !TABS.some((t) => isActive(pathname, t.href));
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-control focus:bg-ink focus:px-3 focus:py-2 focus:text-on-ink">Skip to content</a>
      {!data.liveSubmit && <DryRunBand />}
      <div className="flex min-h-0 flex-1">
        <Rail data={data} pathname={pathname} />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* phone top bar */}
          <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-bg px-4 lg:hidden">
            <Link href="/dashboard" aria-label="Norinote, Dashboard"><NorinoteLogo size={26} /></Link>
            {data.needsYouCount > 0 && (
              <Link href="/dashboard" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-attn-tint px-3 text-[12px] font-semibold text-attn-fg ring-1 ring-inset ring-attn">
                {data.needsYouCount} waiting on you
              </Link>
            )}
          </header>

          <main id="main" className="mx-auto w-full max-w-[var(--content-max)] flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-8">{children}</main>
        </div>
      </div>

      {/* phone: More sheet */}
      {open && (
        <div id="more-sheet" className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] top-14 z-40 flex flex-col overflow-y-auto border-t border-line bg-bg px-4 py-4 lg:hidden">
          <ul className="flex flex-col gap-0.5">{MORE.map((i) => <RailLink key={i.href} item={i} data={data} pathname={pathname} onNavigate={() => setOpenOn(null)} />)}</ul>
          <div className="mt-auto flex items-center justify-between gap-2 border-t border-line px-3 pt-3">
            <span className="min-w-0 truncate text-meta text-ink-2">{data.userName}</span>
            <LogoutButton />
          </div>
        </div>
      )}

      {/* phone: tab bar */}
      <nav aria-label="Tabs" className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-bg pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="grid h-[3.75rem] grid-cols-5">
          {TABS.map((t) => {
            const active = !open && isActive(pathname, t.href);
            const count = t.count?.(data) ?? 0;
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={cx("relative flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium", active ? "text-ink" : "text-muted")}
                >
                  <span className="relative">
                    <Icon icon={t.icon} size={20} strokeWidth={active ? 2 : 1.5} />
                    {count > 0 && (
                      <span className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-attn px-1 text-center text-[10px] font-semibold leading-4 text-on-ink tnum">{count}</span>
                    )}
                  </span>
                  {t.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setOpenOn(open ? null : pathname)}
              aria-expanded={open}
              aria-controls="more-sheet"
              className={cx("flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] font-medium", open || moreActive ? "text-ink" : "text-muted")}
            >
              <Icon icon={open ? X : Ellipsis} size={20} />
              More
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
