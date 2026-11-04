import localFont from "next/font/local";

/**
 * Geist Mono, as the `geist` package sets it up (geist/font/mono), but not preloaded: the first screen only uses it for
 * one number, and the 70 KB file would otherwise compete with the hero for the first screen's budget (spec section 13).
 * The file comes from the `geist` package in the repo's node_modules.
 */
export const GeistMono = localFont({
  src: "../../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  adjustFontFallback: false,
  fallback: ["ui-monospace", "SFMono-Regular", "Roboto Mono", "Menlo", "Monaco", "Liberation Mono", "DejaVu Sans Mono", "Courier New", "monospace"],
  weight: "100 900",
  preload: false,
});
