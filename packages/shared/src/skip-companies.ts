/**
 * The one list of companies a person never wants: `profile.preferences.excludeCompanies`. Matching leaves them out of
 * the shortlist and "Apply for me" never adds them. An older copy lived in `preferences.nori.skipCompanies`; it is read
 * too, until the next save moves it.
 */
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim().slice(0, 200)) : []);

/** Lower case, legal suffixes and punctuation dropped: "Acme, Inc." and "acme" are the same company. */
export const companyKey = (name: string | null | undefined): string =>
  (name ?? "").toLowerCase().replace(/\b(inc|llc|ltd|corp|corporation|co|gmbh)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** The person's companies to skip, in the order they added them, without repeats. */
export function readSkipCompanies(preferences: unknown): string[] {
  const p = rec(preferences);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of [...names(p.excludeCompanies), ...names(rec(p.nori).skipCompanies)]) {
    const k = companyKey(n);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out.slice(0, 1000);
}

/** Does this company name fall on the skip list (given as keys from `companyKey`)? */
export const isSkippedCompany = (keys: ReadonlySet<string>, name: string | null | undefined): boolean => keys.size > 0 && keys.has(companyKey(name));
