/** Helpers for Telegram's HTML parse mode: only `&`, `<` and `>` need escaping. */
export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One line, at most `max` characters, with an ellipsis when cut. */
export function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`;
}

/** Fit bands from ARCHITECTURE.md: 0.8+ strong, 0.6 to 0.8 plausible, 0.45 to 0.6 stretch. */
export function fitBand(fit: number): string {
  if (fit >= 0.8) return "Strong fit";
  if (fit >= 0.6) return "Good fit";
  if (fit >= 0.45) return "Stretch";
  return "Long shot";
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Telegram refuses messages over 4096 characters. */
export const MAX_TEXT = 4000;
