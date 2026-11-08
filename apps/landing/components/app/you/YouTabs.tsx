"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PageHead } from "../PageHead";

/* The frames of the pages that came from You (4c spec section 2, dashboard v2 plan sections 7 and 8): Career graph is
   one page; Settings has a row of sub-tabs. Same title row and width as before. */

const SETTINGS_TABS = [
  { href: "/settings", label: "Account" },
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/search", label: "Job search" },
] as const;

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main id="main" className="mx-auto flex max-w-[960px] flex-col gap-4 px-4 pb-24 tablet:gap-5 tablet:px-8 tablet:pb-12 laptop:px-10 laptop:pt-7">
      <PageHead>
        <h1 className="font-serif text-[2rem] leading-[1.05] text-ink laptop:text-[2.5rem]">{title}</h1>
      </PageHead>
      {children}
    </main>
  );
}

export function GraphFrame({ children }: { children: ReactNode }) {
  return <Frame title="Career graph">{children}</Frame>;
}

export function SettingsFrame({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <Frame title="Settings">
      <nav aria-label="Settings" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] tablet:mx-0 tablet:px-0 [&::-webkit-scrollbar]:hidden">
        {SETTINGS_TABS.map((t) => {
          const current = path === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={current ? "page" : undefined}
              className={`flex h-10 flex-none items-center rounded-full border-[1.5px] px-4 text-small font-medium no-underline ${current ? "border-ink bg-ink text-bg" : "border-line-strong text-ink hover:bg-tint"}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </Frame>
  );
}

/** A polite status line for what the last action did ("Saved.", "Added 3 to your graph."). */
export function Status({ children, tone = "ok" }: { children: ReactNode; tone?: "ok" | "error" }) {
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`text-small font-medium ${tone === "error" ? "text-danger" : "text-accent"}`}>
      {children}
    </p>
  );
}

/** A labelled on/off switch (4c spec section 8). */
export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 flex-none rounded-full border-[1.5px] transition-colors ${on ? "border-accent bg-accent" : "border-line-strong bg-line"}`}
    >
      <span className={`absolute top-[3px] left-[3px] size-[19px] rounded-full bg-surface transition-transform duration-150 ${on ? "translate-x-5" : ""}`} />
    </button>
  );
}

/** A section card, as on the other dashboard pages. */
export const CARD = "flex flex-col gap-3.5 rounded-card border-[1.5px] border-line bg-surface p-4 tablet:p-5";
export const H2 = "text-[1.25rem] font-semibold text-ink";
export const HINT = "text-small text-ink-2";
export const TEXT_BUTTON = "min-h-11 text-small font-semibold text-ink underline underline-offset-[3px]";
export const DANGER_BUTTON = "min-h-11 text-small font-semibold text-danger underline underline-offset-[3px]";
/** The confirming button of a destructive action (Remove, Delete). */
export const DANGER_FILL = "inline-flex min-h-11 items-center justify-center rounded-full bg-danger px-6 text-ui font-semibold text-on-accent active:scale-[0.98]";
