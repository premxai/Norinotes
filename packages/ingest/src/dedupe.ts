/** Company name endings that differ between boards for the same employer ("Acme", "Acme, Inc.", "Acme Ltd"). */
const LEGAL_SUFFIX = /\s(incorporated|inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|ag|sa|bv|pty)$/;

/** Lower case, accents removed, punctuation turned into single spaces: "Sr. Engineer (Platform)" to "sr engineer platform". */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Normalise a company name for deduplication, also dropping a trailing legal suffix. */
export function normalizeCompany(name: string | null | undefined): string {
  let n = normalizeText(name);
  for (let i = 0; i < 2 && LEGAL_SUFFIX.test(` ${n}`); i++) {
    const stripped = ` ${n}`.replace(LEGAL_SUFFIX, "").trim();
    if (!stripped) break; // a company literally called "Inc" keeps its name
    n = stripped;
  }
  return n;
}

/**
 * The key that makes the same job on two boards (or re-posted under a new id) one job: normalised company, title and
 * location joined by `|`. Stable across case, accents, punctuation and legal suffixes; it does not use the job's id or
 * URL, so it survives a re-post.
 */
export function dedupeKey(job: { companyName: string; title: string; location: string | null | undefined }): string {
  return [normalizeCompany(job.companyName), normalizeText(job.title), normalizeText(job.location)].join("|");
}
