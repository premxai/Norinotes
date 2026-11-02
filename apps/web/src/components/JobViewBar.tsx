"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { cx } from "./cx";
import { CLEARANCE_STORAGE_KEY, JOB_VIEWS, type ViewState } from "./jobMeta";

const read = () => {
  try { return window.localStorage.getItem(CLEARANCE_STORAGE_KEY); } catch { return null; }
};
const write = (hide: boolean) => {
  try { window.localStorage.setItem(CLEARANCE_STORAGE_KEY, hide ? "hide" : "show"); } catch { /* private mode or blocked storage: the toggle still works for this visit */ }
};

const toggle = () =>
  cx("inline-flex min-h-11 items-center gap-2.5 rounded-control px-2 text-body-sm text-ink hover:bg-sunken focus-visible:outline-2 focus-visible:outline-accent");
const box = (on: boolean) =>
  cx("relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150", on ? "border-ink bg-ink" : "border-control bg-sunken");
const knob = (on: boolean) =>
  cx("absolute top-[2px] h-3.5 w-3.5 rounded-full transition-[left,background-color] duration-150", on ? "left-[18px] bg-on-ink" : "left-[2px] bg-control");

/**
 * The three job views (links, so the back button and a shared URL work) and the two switches that change what the
 * server fetches. Everything lives in the URL; the clearance choice is also remembered in localStorage and put back
 * on the next visit.
 */
export function JobViewBar({ state }: { state: ViewState }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();

  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    p.delete("job");
    for (const [k, v] of Object.entries(patch)) { if (v === null) p.delete(k); else p.set(k, v); }
    const qs = p.toString();
    return `${path}${qs ? `?${qs}` : ""}`;
  };

  // A remembered "hide" applies when the link itself says nothing about it.
  const urlSaysNothing = sp.get("clearance") === null;
  useEffect(() => {
    if (urlSaysNothing && read() === "hide") router.replace(href({ clearance: "hide" }), { scroll: false });
    // Only on arrival: later changes go through the switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setClearance = (hide: boolean) => {
    write(hide);
    router.push(href({ clearance: hide ? "hide" : null }), { scroll: false });
  };
  const setOlder = (on: boolean) => router.push(href({ older: on ? "1" : null }), { scroll: false });

  return (
    <div className="flex flex-col gap-2">
      <nav aria-label="Job views">
        <ul className="flex flex-wrap gap-1 rounded-control border border-line bg-surface p-1 sm:inline-flex">
          {JOB_VIEWS.map((v) => {
            const on = state.view === v.id;
            return (
              <li key={v.id} className="flex-1 sm:flex-none">
                <Link
                  href={href({ view: v.id === "best" ? null : v.id, ...(v.id === "today" ? { older: null } : {}) })}
                  scroll={false}
                  aria-current={on ? "page" : undefined}
                  className={cx(
                    "inline-flex min-h-11 w-full items-center justify-center rounded-[6px] px-4 text-body-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent",
                    on ? "bg-ink text-on-ink" : "text-ink-2 hover:bg-sunken",
                  )}
                >
                  {v.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button type="button" role="switch" aria-checked={state.hideClearance} onClick={() => setClearance(!state.hideClearance)} className={toggle()}>
          <span className={box(state.hideClearance)} aria-hidden="true"><span className={knob(state.hideClearance)} /></span>
          Hide roles that need US citizenship or clearance
        </button>
        {state.view !== "today" && (
          <button type="button" role="switch" aria-checked={state.older} onClick={() => setOlder(!state.older)} className={cx(toggle(), "text-ink-2")}>
            <span className={box(state.older)} aria-hidden="true"><span className={knob(state.older)} /></span>
            Include older postings
          </button>
        )}
      </div>
    </div>
  );
}
