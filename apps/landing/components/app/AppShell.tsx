"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api, type ShortlistEntry } from "@/lib/api";
import { setTheme, useTheme } from "@/lib/theme";
import { usePolling } from "@/lib/use-polling";
import { LivePanel } from "./LivePanel";

/* The dashboard's shell (4a spec sections 2 and 6): the rail, icon rail or tabs, the cap meter, the account menu with
   the theme switch, the email banner, Nori's rail seat and the live panel. */

export type Panel = { kind: "job"; entry: ShortlistEntry } | { kind: "apps"; ids: string[]; index: number };
type PanelApi = {
  panel: Panel | null;
  open: (p: Panel) => void;
  close: () => void;
  opener: React.RefObject<HTMLElement | null>;
  /** Today tells the shell when something waits on you, for the dot on Today. */
  setNeedsYou: (v: boolean) => void;
};
const PanelContext = createContext<PanelApi | null>(null);
export const usePanel = () => {
  const p = useContext(PanelContext);
  if (!p) throw new Error("usePanel outside AppShell");
  return p;
};

const SECTIONS = [
  { href: "/today", label: "Today", icon: "M10 6a4 4 0 1 1 0 8a4 4 0 0 1 0-8zM10 1.5v2.5M10 16v2.5M1.5 10H4M16 10h2.5M4 4l1.8 1.8M14.2 14.2L16 16M4 16l1.8-1.8M14.2 5.8L16 4" },
  { href: "/applications", label: "Applications", icon: "M5 3h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM6.5 8h7M6.5 12h4.5" },
  { href: "/inbox", label: "Inbox", icon: "M3 5h14v10H3zM3 5l7 6 7-6" },
  { href: "/you", label: "You", icon: "M10 3.8a3.2 3.2 0 1 1 0 6.4a3.2 3.2 0 0 1 0-6.4zM3.5 17c1.2-3 3.6-4.5 6.5-4.5s5.3 1.5 6.5 4.5" },
] as const;

/** The "needs you" dot on Today; it has words for screen readers. */
const NeedsDot = ({ className = "" }: { className?: string }) => (
  <span className={`size-2 rounded-full bg-warning ${className}`}>
    <span className="sr-only">, needs you</span>
  </span>
);

const Icon = ({ d }: { d: string }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="flex-none">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function AccountMenu({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  const theme = useTheme();
  // Two menus are on the page (rail and top bar): each needs its own radio group, or one always shows nothing chosen.
  const group = useId();
  return (
    <details className="group relative">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-row px-2 text-[0.9375rem] font-semibold text-ink hover:bg-tint [&::-webkit-details-marker]:hidden">
        <span className="truncate">{name || "Your account"}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="flex-none transition-transform group-open:rotate-180">
          <path d="M2.5 7.5L6 4l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </summary>
      {/* Opens beside the rail (desktop) or below the top bar (phones), never upward over Nori's seat. */}
      <div className="absolute z-[75] flex w-64 flex-col gap-3 rounded-card border-[1.5px] border-line bg-surface p-3.5 shadow-e2 max-tablet:top-full max-tablet:right-0 max-tablet:mt-2 tablet:bottom-0 tablet:left-full tablet:ml-3">

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-small font-semibold text-ink">Theme</legend>
          {(["system", "light", "dark"] as const).map((t) => (
            <label key={t} className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-row px-1.5 text-small text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink">
              <input type="radio" name={group} checked={theme === t} onChange={() => setTheme(t)} className="size-4 accent-accent" />
              {t === "system" ? "System" : t === "light" ? "Light" : "Dark"}
              {t === "system" && <span className="text-ink-2">· follows your device</span>}
            </label>
          ))}
        </fieldset>
        <button type="button" onClick={onSignOut} className="min-h-10 rounded-row border-t-[1.5px] border-line pt-2 text-left text-small font-semibold text-ink underline underline-offset-[3px]">
          Sign out
        </button>
      </div>
    </details>
  );
}

// ---- the shell --------------------------------------------------------------------------------------------------------

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [gate, setGate] = useState<"checking" | "in">("checking");
  const [panel, setPanel] = useState<Panel | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [resent, setResent] = useState<string | null>(null);
  const [needsYou, setNeedsYou] = useState(false);

  // Signed in and onboarded, or off to sign-in or onboarding (4a spec section 9).
  useEffect(() => {
    let live = true;
    void api.session().then(async (r) => {
      if (!live) return;
      if (!r.ok) {
        // With the query, so a Telegram link (/today?job=…) still opens its job after signing in.
        if (r.status === 401) router.replace(`/signin?next=${encodeURIComponent(path + location.search)}`);
        else setGate("in"); // offline: Today shows its own error state
        return;
      }
      const step = await api.onboardingStep();
      if (!live) return;
      if (step && step !== "done") router.replace("/onboarding");
      else setGate("in");
    });
    return () => {
      live = false;
    };
    // Checked once per visit to the dashboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const me = usePolling(gate === "in" ? "me" : null, api.me, 300_000);
  const agent = usePolling(gate === "in" ? "agent" : null, api.agentStatus, 30_000);
  // You's daily limit asks for a fresh read when it changes (4c spec section 5.1).
  const refreshAgent = agent.refresh;
  useEffect(() => {
    const on = () => void refreshAgent();
    addEventListener("norinote:agent", on);
    return () => removeEventListener("norinote:agent", on);
  }, [refreshAgent]);
  const shortlist = usePolling(gate === "in" ? "shortlist-count" : null, api.shortlist, 30_000);
  const name = me.data?.profile.fullName ?? me.data?.user.name ?? "";
  const unverified = !!me.data && !me.data.user.emailVerifiedAt;
  const today = shortlist.data?.filter((e) => e.status === "new").length ?? null;
  const cap = agent.data?.dailyCap ?? 0;
  const used = agent.data?.usedToday ?? 0;

  async function signOut() {
    await api.logout();
    router.push("/");
  }

  const ctx: PanelApi = {
    panel,
    opener,
    setNeedsYou,
    open: (p) => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPanel(p);
    },
    close: () => {
      setPanel(null);
      opener.current?.focus();
    },
  };

  const count = (href: string) => (href === "/today" && today !== null ? today : null);
  // The sections' pages load when you point at or focus their link, not all at once: prefetching every section on
  // every page put each one's code (You's is about 35 KB) into the first screen's budget (4c spec section 11).
  const intent = (href: string) => ({ prefetch: false, onMouseEnter: () => router.prefetch(href), onFocus: () => router.prefetch(href), onTouchStart: () => router.prefetch(href) });

  return (
    <PanelContext.Provider value={ctx}>
      <div className={`app-theme min-h-svh bg-bg text-ink tablet:grid ${panel ? "laptop:grid-cols-[248px_minmax(0,1fr)_420px]" : "laptop:grid-cols-[248px_minmax(0,1fr)]"} tablet:grid-cols-[72px_minmax(0,1fr)]`}>
        {/* Rail (768+): icons only up to 1024, then labels, counts, the cap meter, Nori and the account. */}
        <nav aria-label="Dashboard" className="sticky top-0 flex h-svh flex-col gap-1.5 border-r-[1.5px] border-line bg-surface-2 px-3 py-5 max-tablet:hidden laptop:px-4">
          <Link href="/today" className="mb-4 flex min-h-11 items-center gap-2 px-2 no-underline" aria-label="Norinote, Today">
            {/* eslint-disable-next-line @next/next/no-img-element -- a 32 px static icon; next/image adds nothing here */}
            <img src="/icon-32.png" alt="" width={28} height={28} className="size-7" />
            <span className="text-[1.0625rem] font-bold text-ink max-laptop:sr-only">Norinote</span>
          </Link>
          {SECTIONS.map((s) => {
            const current = path === s.href || path.startsWith(`${s.href}/`);
            const n = count(s.href);
            return (
              <Link
                key={s.href}
                href={s.href}
                {...intent(s.href)}
                aria-current={current ? "page" : undefined}
                className={`group relative flex min-h-11 items-center gap-3 rounded-row px-3 text-[0.9375rem] text-ink no-underline hover:bg-tint max-laptop:justify-center ${current ? "bg-tint font-semibold" : "font-medium"}`}
              >
                <Icon d={s.icon} />
                <span className="max-laptop:sr-only">{s.label}</span>
                {s.href === "/today" && needsYou && <NeedsDot className="max-laptop:absolute max-laptop:top-2 max-laptop:left-2" />}
                {n !== null && <span className="ml-auto text-label font-medium text-ink-2 tabular-nums max-laptop:absolute max-laptop:top-1 max-laptop:right-1 max-laptop:ml-0">{n}</span>}
              </Link>
            );
          })}

          <div className="mt-5 flex flex-col gap-2 rounded-card border-[1.5px] border-line bg-surface p-3 max-laptop:hidden">
            <p className="text-small text-ink-2">Sent today</p>
            <p className="text-[0.9375rem] font-semibold text-ink tabular-nums">{cap > 0 ? `${used} of ${cap}` : used}</p>
            {cap > 0 && (
              <div role="meter" aria-label="Daily limit" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={used} className="h-1.5 overflow-hidden rounded-full bg-line">
                <div className="h-full bg-accent" style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} />
              </div>
            )}
            {/* True for every limit: nothing sends on its own (4c spec section 7). */}
            <p className="text-[0.75rem] leading-[1.4] text-ink-2">Nori asks before every send.</p>
          </div>

          <div className="relative mt-auto flex flex-col gap-1 max-laptop:hidden">
            {/* Nori's seat at the rail's foot (4a spec section 10). */}
            <div className="relative h-[120px]">
              <div data-nori-seat="rail" className="absolute bottom-1 left-16 size-px" />
            </div>
            <AccountMenu name={name} onSignOut={signOut} />
          </div>
        </nav>

        {/* Phones: a top bar and bottom tabs. */}
        <header className="sticky top-0 z-[20] flex h-14 items-center justify-between border-b-[1.5px] border-line bg-bg px-4 tablet:hidden">
          <Link href="/today" className="flex min-h-11 items-center gap-2 no-underline" aria-label="Norinote, Today">
            {/* eslint-disable-next-line @next/next/no-img-element -- a 32 px static icon; next/image adds nothing here */}
            <img src="/icon-32.png" alt="" width={26} height={26} className="size-[26px]" />
            <span className="text-base font-bold text-ink">Norinote</span>
          </Link>
          <AccountMenu name={name} onSignOut={signOut} />
        </header>

        <div className="min-w-0">
          {unverified && gate === "in" && (
            <div role="status" className="mx-auto mt-4 flex max-w-[960px] flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[14px] bg-tint px-4 py-3 text-small text-ink max-tablet:mx-4 tablet:mx-8 laptop:mx-auto laptop:mt-7 laptop:w-[calc(100%-80px)]">
              <span>
                <b>Confirm your email</b> so employers&rsquo; replies reach you. We sent a link to {me.data?.user.email}.
              </span>
              <button
                type="button"
                className="min-h-10 font-semibold underline underline-offset-[3px]"
                onClick={async () => {
                  const r = await api.resendVerification();
                  setResent(r.ok ? "Sent. Check your inbox." : r.error);
                }}
              >
                {resent ?? "Send it again"}
              </button>
            </div>
          )}
          {gate === "in" ? children : <p className="p-8 text-ink-2">Opening your dashboard…</p>}
        </div>

        {panel && <LivePanel />}

        <nav aria-label="Dashboard" className="fixed inset-x-0 bottom-0 z-[20] grid h-16 grid-cols-4 border-t-[1.5px] border-line bg-surface-2 pb-[env(safe-area-inset-bottom)] tablet:hidden">
          {SECTIONS.map((s) => {
            const current = path === s.href || path.startsWith(`${s.href}/`);
            return (
              <Link
                key={s.href}
                href={s.href}
                {...intent(s.href)}
                aria-current={current ? "page" : undefined}
                className={`relative flex flex-col items-center justify-center gap-0.5 text-[0.75rem] no-underline ${current ? "font-semibold text-ink" : "font-medium text-ink-2"}`}
              >
                <Icon d={s.icon} />
                {s.label}
                {s.href === "/today" && needsYou && <NeedsDot className="absolute top-2.5 right-[30%]" />}
              </Link>
            );
          })}
        </nav>
      </div>
    </PanelContext.Provider>
  );
}
