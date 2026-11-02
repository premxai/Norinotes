import { Check } from "lucide-react";

const POINTS = [
  "Every resume line traces back to something you did",
  "Roles ranked against your history, with the reasons shown",
  "Nothing is sent until you click",
];

/** The right half of the sign-in pages on wide screens: what the account is for, in three lines. Never behind a form. */
export function BrandPanel() {
  return (
    <aside aria-label="About Norinote" className="hidden border-l border-line bg-sunken lg:flex lg:min-h-screen lg:flex-col lg:justify-center">
      <div className="mx-auto w-full max-w-[460px] px-10 py-12">
        <p className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-ink">A daily shortlist of jobs you are likely to get.</p>
        <ul className="mt-6 flex flex-col gap-3">
          {POINTS.map((p) => (
            <li key={p} className="flex items-start gap-3 text-[15px] text-ink-2">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-accent"><Check size={15} aria-hidden="true" /></span>
              {p}
            </li>
          ))}
        </ul>
        <div className="mt-8 rounded-card border border-line bg-surface p-4">
          <p className="text-[12.5px] text-muted">Your shortlist today</p>
          <p className="mt-1 text-[15px] font-semibold text-ink">3 jobs picked for you</p>
          <p className="mt-0.5 text-[13px] text-ink-2">Each one ready to apply to with one click.</p>
        </div>
      </div>
    </aside>
  );
}
