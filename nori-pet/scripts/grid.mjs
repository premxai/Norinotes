/** The grid a row's poses are drawn in on one 1536x1024 sheet. */
export function grid(n) {
  if (n <= 4) return { cols: 2, rows: 2 };
  if (n <= 6) return { cols: 3, rows: 2 };
  return { cols: 4, rows: 2 };
}
