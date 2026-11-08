"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api, type ShortlistEntry } from "@/lib/api";
import { setTheme, useTheme } from "@/lib/theme";
import { usePolling } from "@/lib/use-polling";
import { LivePanel } from "./LivePanel";

/* The dashboard's shell (4a spec sections 2 and 6, dashboard v2 plan "The rail"): the rail of eight sections (it folds
   to icons), the phone tabs with More, the account menu with the theme switch, the email banner, Nori's rail seat and
   the live panel. */

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

// Icons are 20 px line drawings on a 20 px grid (the v2 wireframes' rail).
const SECTIONS = [
  { href: "/overview", label: "Overview", icon: "M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z" },
  { href: "/jobs", label: "Jobs", icon: "M2.5 5.5h15v11h-15zM7 5.5V4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 13 4v1.5M2.5 10h15" },
  { href: "/applications", label: "Applications", icon: "M5 2.5h6.5L15 6v11.5H5zM11.5 2.5V6H15M7.5 10h5M7.5 13h5" },
  { href: "/tracker", label: "Tracker", icon: "M3 17.5h14M4 10h2.4v7H4zM8.8 4.5h2.4V17H8.8zM13.6 12H16v5h-2.4z" },
  { href: "/inbox", label: "Inbox", icon: "M2.5 4.5h15v11h-15zM3 5.5l7 5.5 7-5.5" },
  { href: "/nori", label: "Nori", icon: "M8 3l1.4 4.1L13.5 8.5 9.4 9.9 8 14 6.6 9.9 2.5 8.5l4.1-1.4zM15 11.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" },
  { href: "/graph", label: "Career graph", icon: "M7.2 5a2.2 2.2 0 1 1-4.4 0a2.2 2.2 0 0 1 4.4 0zM17.2 7a2.2 2.2 0 1 1-4.4 0a2.2 2.2 0 0 1 4.4 0zM10.2 15a2.2 2.2 0 1 1-4.4 0a2.2 2.2 0 0 1 4.4 0zM7 5.6l5.9 1M6 6.8l1.4 6.2M9.9 14l3.7-5.3" },
  { href: "/settings", label: "Settings", icon: "M12.6 10a2.6 2.6 0 1 1-5.2 0a2.6 2.6 0 0 1 5.2 0zM10 1.8l1.3 2.2 2.5-.6.6 2.5 2.3 1.2-1.1 2.3 1.1 2.3-2.3 1.2-.6 2.5-2.5-.6L10 18.2l-1.3-2.2-2.5.6-.6-2.5-2.3-1.2L4.4 10 3.3 7.7l2.3-1.2.6-2.5 2.5.6z" },
] as const;
/** Phones show four sections as tabs; the rest are under More. */
const TABS: string[] = ["/overview", "/jobs", "/applications", "/nori"];
const MORE = SECTIONS.filter((s) => !TABS.includes(s.href));
const MORE_ICON = "M4.5 10h.01M10 10h.01M15.5 10h.01";
const RAIL_KEY = "norinote-rail";

/** The "needs you" dot on Overview; it has words for screen readers. */
const NeedsDot = ({ className = "" }: { className?: string }) => (
  <span className={`size-2 rounded-full bg-warning ${className}`}>
    <span className="sr-only">, needs you</span>
  </span>
);

const Icon = ({ d, dots = false }: { d: string; dots?: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="flex-none">
    <path d={d} fill="none" stroke="currentColor" strokeWidth={dots ? 3.2 : 1.6} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Phones: More opens the sections that aren't tabs, above the tab bar. */
function MoreMenu({ path, intent }: { path: string; intent: (href: string) => object }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const current = MORE.some((s) => path === s.href || path.startsWith(`${s.href}/`));
  // Closes on a new page, Escape (focus back on More) or a tap outside.
  const [shownFor, setShownFor] = useState(path);
  if (shownFor !== path) {
    setShownFor(path);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const tap = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener("keydown", key);
    addEventListener("pointerdown", tap);
    return () => {
      removeEventListener("keydown", key);
      removeEventListener("pointerdown", tap);
    };
  }, [open]);
  return (
    <div ref={box} className="relative flex">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="more-sections"
        aria-current={current ? "page" : undefined}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full flex-col items-center justify-center gap-0.5 text-[0.75rem] ${current ? "font-semibold text-ink" : "font-medium text-ink-2"}`}
      >
        <Icon d={MORE_ICON} dots />
        More
      </button>
      {open && (
        <ul id="more-sections" aria-label="More sections" className="absolute right-2 bottom-[calc(100%+8px)] flex w-56 flex-col gap-0.5 rounded-card border-[1.5px] border-line bg-surface p-1.5 shadow-e2">
          {MORE.map((s) => {
            const on = path === s.href || path.startsWith(`${s.href}/`);
            return (
              <li key={s.href}>
                <Link href={s.href} {...intent(s.href)} aria-current={on ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-row px-3 text-[0.9375rem] text-ink no-underline hover:bg-tint ${on ? "bg-tint font-semibold" : "font-medium"}`}>
                  <Icon d={s.icon} />
                  {s.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AccountMenu({ name, onSignOut, compact = false }: { name: string; onSignOut: () => void; compact?: boolean }) {
  const theme = useTheme();
  // Two menus are on the page (rail and top bar): each needs its own radio group, or one always shows nothing chosen.
  const group = useId();
  return (
    <details className="group relative">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-row px-2 text-[0.9375rem] font-semibold text-ink hover:bg-tint [&::-webkit-details-marker]:hidden">
        {/* The folded rail shows the first letter; the name stays for screen readers. */}
        {compact ? (
          <span className="mx-auto grid size-9 place-items-center rounded-full bg-accent text-on-accent">
            <span aria-hidden="true">{(name.trim()[0] ?? "?").toUpperCase()}</span>
            <span className="sr-only">{name || "Your account"}</span>
          </span>
        ) : (
          <>
            <span className="truncate">{name || "Your account"}</span>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="flex-none transition-transform group-open:rotate-180">
              <path d="M2.5 7.5L6 4l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </>
        )}
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
  // From 1024 px the rail can fold to icons; the choice is kept on this device.
  const [folded, setFolded] = useState(false);
  useEffect(() => {
    try {
      // Read after the first paint (the server can't know it), so the rail may fold a moment after loading.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(RAIL_KEY) === "icons") setFolded(true);
    } catch {
      // Storage blocked: the rail starts open.
    }
  }, []);
  // Nori chooses its seat when its sprites are ready, which can be before the page is shown (the sign-in check), or the
  // rail can fold: either way, ask it to look for its seat again once the page is on screen.
  useEffect(() => {
    if (gate === "in") dispatchEvent(new Event("norinote:seats"));
  }, [gate, folded]);
  const fold = () => {
    const next = !folded;
    setFolded(next);
    try {
      localStorage.setItem(RAIL_KEY, next ? "icons" : "open");
    } catch {
      // Storage blocked: it folds for this visit only.
    }
  };

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
  // v2 drops the rail's "Sent today" meter: the daily cap lives in Nori's setup (dashboard v2 plan, section 6).
  const shortlist = usePolling(gate === "in" ? "shortlist-count" : null, api.shortlist, 30_000);
  const name = me.data?.profile.fullName ?? me.data?.user.name ?? "";
  const unverified = !!me.data && !me.data.user.emailVerifiedAt;
  const today = shortlist.data?.filter((e) => e.status === "new").length ?? null;

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

  const count = (href: string) => (href === "/overview" && today !== null ? today : null);
  // The sections' pages load when you point at or focus their link, not all at once: prefetching every section on
  // every page put each one's code (You's is about 35 KB) into the first screen's budget (4c spec section 11).
  const intent = (href: string) => ({ prefetch: false, onMouseEnter: () => router.prefetch(href), onFocus: () => router.prefetch(href), onTouchStart: () => router.prefetch(href) });

  return (
    <PanelContext.Provider value={ctx}>
      <div data-rail={folded ? "icons" : "open"} className={`app-theme min-h-svh bg-bg text-ink tablet:grid tablet:grid-cols-[72px_minmax(0,1fr)] ${folded ? (panel ? "laptop:grid-cols-[72px_minmax(0,1fr)_420px]" : "") : panel ? "laptop:grid-cols-[248px_minmax(0,1fr)_420px]" : "laptop:grid-cols-[248px_minmax(0,1fr)]"}`}>
        {/* Rail (768+): icons only up to 1024 (or folded), then labels, counts, Nori's seat and the account. */}
        <nav aria-label="Dashboard" className={`sticky top-0 flex h-svh flex-col gap-1.5 border-r-[1.5px] border-line bg-surface-2 px-3 py-5 max-tablet:hidden ${folded ? "" : "laptop:px-4"}`}>
          <div className={`mb-4 flex items-center justify-between gap-1 ${folded ? "flex-col" : ""}`}>
            <Link href="/overview" className="flex min-h-11 items-center gap-2 px-2 no-underline" aria-label="Norinote, Overview">
              {/* eslint-disable-next-line @next/next/no-img-element -- a 32 px static icon; next/image adds nothing here */}
              <img src="/icon-32.png" alt="" width={28} height={28} className="size-7" />
              <span className={`text-[1.0625rem] font-bold text-ink ${folded ? "sr-only" : "max-laptop:sr-only"}`}>Norinote</span>
            </Link>
            <button type="button" onClick={fold} aria-pressed={folded} aria-label="Fold the menu to icons" className="grid size-9 flex-none place-items-center rounded-[10px] border-[1.5px] border-line bg-surface text-ink hover:bg-tint max-laptop:hidden">
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                <path d={folded ? "M4 3l5 5-5 5M8 3l5 5-5 5" : "M12 3L7 8l5 5M8 3L3 8l5 5"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          {SECTIONS.map((s) => {
            const current = path === s.href || path.startsWith(`${s.href}/`);
            const n = count(s.href);
            return (
              <Link
                key={s.href}
                href={s.href}
                {...intent(s.href)}
                aria-current={current ? "page" : undefined}
                title={folded ? s.label : undefined}
                className={`group relative flex min-h-11 items-center gap-3 rounded-row px-3 text-[0.9375rem] text-ink no-underline hover:bg-tint ${folded ? "justify-center" : "max-laptop:justify-center"} ${current ? "bg-tint font-semibold" : "font-medium"}`}
              >
                <Icon d={s.icon} />
                <span className={folded ? "sr-only" : "max-laptop:sr-only"}>{s.label}</span>
                {s.href === "/overview" && needsYou && <NeedsDot className={folded ? "absolute top-2 left-2" : "max-laptop:absolute max-laptop:top-2 max-laptop:left-2"} />}
                {n !== null && <span className={`text-label font-medium text-ink-2 tabular-nums ${folded ? "absolute top-1 right-1" : "ml-auto max-laptop:absolute max-laptop:top-1 max-laptop:right-1 max-laptop:ml-0"}`}>{n}</span>}
              </Link>
            );
          })}

          <div className="relative mt-auto flex flex-col gap-1 max-laptop:hidden">
            {/* Nori's seat at the rail's foot (4a spec section 10). */}
            <div className={`relative h-[120px] ${folded ? "hidden" : ""}`}>
              <div data-nori-seat="rail" className="absolute bottom-1 left-16 size-px" />
            </div>
            <AccountMenu name={name} onSignOut={signOut} compact={folded} />
          </div>
        </nav>

        {/* Phones: a top bar and bottom tabs. */}
        <header className="sticky top-0 z-[20] flex h-14 items-center justify-between border-b-[1.5px] border-line bg-bg px-4 tablet:hidden">
          <Link href="/overview" className="flex min-h-11 items-center gap-2 no-underline" aria-label="Norinote, Overview">
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

        <nav aria-label="Dashboard" className="fixed inset-x-0 bottom-0 z-[20] grid h-16 grid-cols-5 border-t-[1.5px] border-line bg-surface-2 pb-[env(safe-area-inset-bottom)] tablet:hidden">
          {SECTIONS.filter((s) => TABS.includes(s.href)).map((s) => {
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
                {s.href === "/overview" && needsYou && <NeedsDot className="absolute top-2.5 right-[30%]" />}
              </Link>
            );
          })}
          <MoreMenu path={path} intent={intent} />
        </nav>
      </div>
    </PanelContext.Provider>
  );
}
