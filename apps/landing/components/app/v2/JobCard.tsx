import type { ReactNode } from "react";
import { CompanyLogo } from "../CompanyLogo";

/* Dashboard v2's square job card (Overview's recommended jobs, docs/dashboard-v2-plan.md section 1): the logo and how
   long ago it was posted, the company, the title (two lines at most), the place, then the match and an action. The
   title is the card's link or button, so the whole card isn't one big control. */

export function JobCard({
  title,
  company,
  logoUrl,
  place,
  posted,
  fit,
  onOpen,
  action,
}: {
  title: string;
  company: string;
  logoUrl?: string | null;
  place: string | null;
  posted: string | null;
  /** 0 to 1, or null when there's no match yet. */
  fit: number | null;
  onOpen: () => void;
  /** Apply, or the application's status chip once it has one. */
  action?: ReactNode;
}) {
  return (
    <article className="flex aspect-square min-w-0 flex-col rounded-[26px] border-[1.5px] border-line bg-surface p-5 shadow-[0_1px_2px_rgb(90_60_30/.04),0_12px_28px_-18px_rgb(90_60_30/.28)]">
      <div className="flex items-center justify-between gap-3">
        <CompanyLogo name={company} url={logoUrl} box="size-12 rounded-[15px] text-[1.25rem]" />
        {posted && <span className="text-[0.8125rem] text-ink-2">{posted}</span>}
      </div>
      <p className="mt-4 truncate text-small text-ink-2">{company}</p>
      <h3 className="mt-1 text-[1.1875rem] leading-[1.25] font-semibold tracking-[-0.01em] text-ink">
        <button type="button" onClick={onOpen} className="line-clamp-2 text-left hover:underline hover:underline-offset-[3px]">
          {title}
        </button>
      </h3>
      {place && (
        <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-small text-ink-2">
          <svg width="13" height="13" viewBox="0 0 20 20" aria-hidden="true" className="flex-none">
            <path d="M10 18s6-5.2 6-10a6 6 0 0 0-12 0c0 4.8 6 10 6 10z" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="10" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
          </svg>
          <span className="truncate">{place}</span>
        </p>
      )}
      <div className="mt-auto flex items-center justify-between gap-2.5 pt-3">
        {fit !== null ? <span className="rounded-full bg-accent-tint px-2.5 py-1 text-[0.8125rem] font-semibold text-accent tabular-nums">{Math.round(fit * 100)}% match</span> : <span />}
        {action}
      </div>
    </article>
  );
}
