export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/** 1 -> "01" */
export const idx = (n: number) => String(n).padStart(2, "0");
