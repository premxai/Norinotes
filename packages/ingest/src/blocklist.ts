/**
 * Sources Norinote refuses to poll, seed or ingest because they are not employers: they repost other companies'
 * openings (often scraped, often stale or already filled) under their own name. One reposting service can outweigh a
 * whole real board (Jobgether alone was about 10% of open rows in Nori), and every one of its postings sends the
 * candidate through a second funnel instead of the employer's own form.
 *
 * Matching is exact on the normalised name or board token (lower case, letters and digits only), never a
 * substring, so a real employer that merely contains the word is not caught.
 */
export type BlockedSource = {
  /** Display name as it appears on postings. */
  name: string;
  /** Board tokens (any job system) that belong to it. The normalised name is always matched as well. */
  tokens: string[];
  why: string;
};

export const BLOCKED_SOURCES: BlockedSource[] = [
  {
    name: "Jobgether",
    tokens: ["jobgether"],
    why: "Reposting aggregator (lever:jobgether). Lists thousands of other employers' roles behind an AI-matching funnel and resubmits applications on their behalf; the real employer is rarely named.",
  },
  {
    name: "Lensa",
    tokens: ["lensa"],
    why: "Job-search aggregator that republishes roles scraped from other sites and reroutes applicants through its own pages. Not in the registry today; blocked so it cannot be added or discovered.",
  },
  {
    name: "Talent.com",
    tokens: ["talentcom"],
    why: "Job-search aggregator (formerly Neuvoo) that reposts other employers' listings. Not in the registry today; blocked so it cannot be added or discovered.",
  },
  {
    name: "Jooble",
    tokens: ["jooble"],
    why: "Job-search aggregator that republishes listings from other sites. Not in the registry today; blocked so it cannot be added or discovered.",
  },
  {
    name: "Jobright",
    tokens: ["jobright", "jobrightai"],
    why: "AI job-search aggregator that reposts other employers' roles. Not in the registry today; blocked so it cannot be added or discovered.",
  },
];

/** Lower case, letters and digits only: "Talent.com", "talent-com" and "TalentCom" all become "talentcom". */
export const normalizeSourceKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const BLOCKED_KEYS: ReadonlySet<string> = new Set(
  BLOCKED_SOURCES.flatMap((b) => [b.name, ...b.tokens].map(normalizeSourceKey)),
);

/** True when this company name or board token belongs to a blocked aggregator. */
export function isBlockedCompany(c: { name?: string | null; token?: string | null }): boolean {
  return Boolean((c.name && BLOCKED_KEYS.has(normalizeSourceKey(c.name))) || (c.token && BLOCKED_KEYS.has(normalizeSourceKey(c.token))));
}

/** True when this board (any job system) is a blocked aggregator's. */
export const isBlockedBoard = (_atsType: string, token: string): boolean => isBlockedCompany({ token });

/** Thrown when someone tries to ingest from a blocked source (a pasted link to an aggregator's posting). */
export class BlockedSourceError extends Error {
  constructor(readonly token: string) {
    super(`"${token}" is a job reposting aggregator, not an employer; Norinote does not ingest it.`);
    this.name = "BlockedSourceError";
  }
}
