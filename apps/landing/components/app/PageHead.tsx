import type { ReactNode } from "react";

/**
 * A 4b page's title row (4b spec section 2). Below 1024 px these pages have no strip for Nori, so the row is tall
 * enough for Nori to stand at its right end, beside the title, and the title keeps clear of it. From 1024 px Nori is on
 * the rail and the row is just the title.
 */
export function PageHead({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-[84px] flex-col justify-end pr-28 tablet:min-h-[120px] tablet:pr-36 laptop:min-h-0 laptop:pr-0">
      {children}
      <div aria-hidden="true" data-nori-seat="head" className="pointer-events-none absolute right-12 bottom-0 size-px tablet:right-16 laptop:hidden" />
    </div>
  );
}
