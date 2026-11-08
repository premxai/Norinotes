"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { PageHead } from "../PageHead";

/* Settings (dashboard v2 plan section 8): Account, Profile, Job search, Connections. From 1024 px the tabs are a list
   with a hint each, beside the open tab; below that they are a row of pills above it. Roles, the daily cap, the
   threshold and the schedule are not here: they are set by talking to Nori. */

export const SETTINGS_TABS = [
  { href: "/settings", label: "Account", hint: "Email, password, devices, theme" },
  { href: "/settings/profile", label: "Profile", hint: "Contact and what forms ask" },
  { href: "/settings/search", label: "Job search", hint: "Places, salary, companies to skip" },
  { href: "/settings/connections", label: "Connections", hint: "Gmail and Telegram" },
] as const;

export function SettingsFrame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const current = SETTINGS_TABS.find((t) => t.href === path) ?? SETTINGS_TABS[0];
  const nav = useRef<HTMLElement>(null);
  // Below 1024 px the tabs are a row that scrolls sideways: keep the current one in view (Connections is past the edge).
  useEffect(() => {
    const row = nav.current;
    const on = row?.querySelector<HTMLElement>("[aria-current=page]");
    if (!row || !on || row.scrollWidth <= row.clientWidth) return;
    const left = on.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft;
    const right = left + on.offsetWidth + 16 - row.clientWidth;
    row.scrollLeft = Math.max(0, Math.min(left - 16, right));
  }, [path]);
  return (
    <main id="main" className="mx-auto flex max-w-[1160px] flex-col gap-4 px-4 pb-24 tablet:gap-5 tablet:px-8 tablet:pb-12 laptop:px-10 laptop:pt-7">
      <PageHead>
        <h1 className="font-serif text-[2rem] leading-[1.05] text-ink laptop:text-[2.5rem]">Settings</h1>
      </PageHead>
      <div className="flex flex-col gap-4 tablet:gap-5 laptop:grid laptop:grid-cols-[260px_minmax(0,1fr)] laptop:items-start laptop:gap-6">
        <nav ref={nav} aria-label="Settings" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] tablet:mx-0 tablet:px-0 laptop:sticky laptop:top-6 laptop:overflow-visible [&::-webkit-scrollbar]:hidden">
          <ul className="flex gap-2 laptop:flex-col laptop:gap-1.5">
            {SETTINGS_TABS.map((t) => {
              const on = t === current;
              return (
                <li key={t.href} className="flex-none">
                  <Link
                    href={t.href}
                    aria-current={on ? "page" : undefined}
                    className={`flex min-h-10 flex-col justify-center rounded-full border-[1.5px] px-4 text-small font-medium no-underline laptop:min-h-[60px] laptop:rounded-[14px] laptop:px-4 laptop:py-2.5 ${
                      on ? "border-ink bg-ink text-bg laptop:border-accent laptop:bg-accent-tint laptop:text-ink" : "border-line-strong text-ink hover:bg-tint laptop:border-transparent"
                    }`}
                  >
                    <span className="laptop:text-[0.9375rem] laptop:font-semibold">{t.label}</span>
                    <span className="hidden text-[0.8125rem] font-normal text-ink-2 laptop:block">{t.hint}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-col gap-4 tablet:gap-5">
          {children}
        </div>
      </div>
    </main>
  );
}
