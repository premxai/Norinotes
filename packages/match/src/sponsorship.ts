/** Sponsorship wording in a posting. Deterministic: its "no" overrides the model, its "yes" only fills in an unknown. */

/**
 * A negation, then optional filler ("be", "able to", "in a position to", "eligible for", "offer", "visa"), then "sponsor",
 * "sponsoring" or "sponsorship"; or "without sponsorship", "sponsorship is not available". Ported from Nori's
 * match/score.ts and extended to the wordings US postings use.
 */
export const NO_SPONSOR = new RegExp(
  [
    String.raw`\b(?:no|not|never|unable\s+to|cannot|can['’]?t|won['’]t)\s+(?:(?:be|currently|presently|able\s+to|in\s+a\s+position\s+to|eligible\s+for|going\s+to|provide|providing|offer|offering|support|supporting|any)\s+)*(?:(?:visa|work\s+visa|employment\s+visa|immigration|h-?1b|work\s+authori[sz]ation)\s+)?sponsor`,
    String.raw`\bwithout\s+(?:(?:visa|immigration|h-?1b)\s+)?sponsorship`,
    String.raw`\bsponsorship\s+(?:is\s+)?(?:not\s+(?:available|offered|provided)|unavailable)`,
  ].join("|"),
  "i",
);
const NO_SPONSOR_ALL = new RegExp(NO_SPONSOR.source, "gi");

/** "We sponsor visas", "visa sponsorship available". Read only outside the negative phrases. */
const YES_SPONSOR = /\b(?:we|will|can|able\s+to|happy\s+to)\s+(?:also\s+)?(?:provide\s+|offer\s+)?(?:visa\s+|h-?1b\s+)?sponsor(?:ship)?\b|\b(?:visa|h-?1b|immigration)\s+sponsorship\s+(?:is\s+)?(?:available|offered|provided)\b|\bsponsorship\s+(?:is\s+)?available\b/i;

/**
 * "no" when the posting says it does not sponsor, "yes" when it says it does and never says otherwise, null when it is
 * silent or contradicts itself. The positive wording is looked for only in what is left after the negative phrases are
 * removed, so "not able to sponsor" is not read as "able to sponsor".
 */
export function detectSponsorship(text: string): "yes" | "no" | null {
  if (!text) return null;
  const no = NO_SPONSOR.test(text);
  const yes = YES_SPONSOR.test(text.replace(NO_SPONSOR_ALL, " "));
  if (no && !yes) return "no";
  if (yes && !no) return "yes";
  return null;
}
