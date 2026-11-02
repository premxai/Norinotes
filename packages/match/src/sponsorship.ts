/** Sponsorship wording in a posting. Deterministic, so it can override the model when it is sure. */

/** Ported from Nori's match/score.ts. */
export const NO_SPONSOR = /(no|not|unable to|cannot|can't|won't|will not)\s+(provide\s+|offer\s+)?(visa\s+)?sponsor|without\s+(visa\s+)?sponsorship|sponsorship\s+(is\s+)?not\s+(available|offered|provided)/i;

/** "We sponsor visas", "visa sponsorship available". Only trusted when no negative wording is present. */
const YES_SPONSOR = /\b(?:we|will|can|able\s+to|happy\s+to)\s+(?:also\s+)?(?:provide\s+|offer\s+)?(?:visa\s+|h-?1b\s+)?sponsor(?:ship)?\b|\b(?:visa|h-?1b|immigration)\s+sponsorship\s+(?:is\s+)?(?:available|offered|provided)\b|\bsponsorship\s+(?:is\s+)?available\b/i;

/**
 * "no" when the posting says it does not sponsor, "yes" when it says it does and never says otherwise, null when it is
 * silent or contradicts itself.
 */
export function detectSponsorship(text: string): "yes" | "no" | null {
  if (!text) return null;
  const no = NO_SPONSOR.test(text);
  const yes = YES_SPONSOR.test(text);
  if (no && !yes) return "no";
  if (yes && !no) return "yes";
  return null;
}
