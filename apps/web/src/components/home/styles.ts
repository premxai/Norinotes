/** Class names shared by the public pages (landing, sign-in, account links). Same tokens as the app. */

export const container = "mx-auto w-full max-w-[1120px] px-4 sm:px-6 lg:px-8";

const btn =
  "inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-colors duration-150 " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";

/** Warm ink button: the one primary action on a screen. */
export const btnPrimary = `${btn} h-12 bg-ink px-6 text-[15px] text-on-ink hover:bg-ink-2`;
/** Outlined button beside a primary one. */
export const btnSecondary = `${btn} h-12 border border-control bg-surface px-6 text-[15px] text-ink hover:bg-sunken`;
/** Kept for older callers; same as primary now. */
export const btnSun = btnPrimary;

export const chip = "inline-flex items-center gap-2 rounded-full bg-sunken px-3 py-1 text-[12.5px] font-semibold text-ink-2";

export const textLink =
  "font-semibold text-accent underline-offset-4 transition-colors hover:underline " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-sm";

/** Text inputs with a leading icon (the icon sits at left-4, so the text starts at pl-11). */
export const field =
  "h-12 w-full rounded-control border border-control bg-surface pl-11 pr-4 text-[15px] text-ink placeholder:text-muted " +
  "transition-colors duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25";

export const fieldLabel = "mb-1.5 block text-[13px] font-semibold text-ink-2";
