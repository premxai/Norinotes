// Parses one cron field (star, star-slash-n, a, a-b, a-b-slash-n, comma lists) into the set of values it allows.
function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [range = "", stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step in "${field}"`);
    let lo: number, hi: number;
    if (range === "*") { lo = min; hi = max; }
    else if (range.includes("-")) { const [a, b] = range.split("-").map(Number); lo = a!; hi = b!; }
    else { lo = Number(range); hi = stepText === undefined ? lo : max; }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) throw new Error(`Invalid cron field "${field}"`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export type ParsedCron = { minute: Set<number>; hour: Set<number>; dayOfMonth: Set<number>; month: Set<number>; dayOfWeek: Set<number> };

/** Parses a 5-field cron expression (minute hour day-of-month month day-of-week). Throws on bad input. */
export function parseCron(expr: string): ParsedCron {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`Cron needs 5 fields, got ${f.length}: "${expr}"`);
  const dow = parseField(f[4]!.replace(/7/g, "0"), 0, 6);
  return {
    minute: parseField(f[0]!, 0, 59), hour: parseField(f[1]!, 0, 23), dayOfMonth: parseField(f[2]!, 1, 31),
    month: parseField(f[3]!, 1, 12), dayOfWeek: dow,
  };
}

/** True when `date` (in UTC) falls on a minute the expression fires. */
export function cronMatches(expr: string | ParsedCron, date: Date): boolean {
  const c = typeof expr === "string" ? parseCron(expr) : expr;
  return c.minute.has(date.getUTCMinutes()) && c.hour.has(date.getUTCHours()) && c.dayOfMonth.has(date.getUTCDate())
    && c.month.has(date.getUTCMonth() + 1) && c.dayOfWeek.has(date.getUTCDay());
}
