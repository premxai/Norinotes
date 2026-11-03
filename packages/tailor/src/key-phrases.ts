/**
 * The posting's own key phrase for a descriptive requirement ("Experience building and operating production services" ->
 * "production services"), and soft requirements (ownership, end-to-end, startup pace, stakeholder work...) with the
 * behaviour a career point must show before the requirement counts as supported. Pure functions, no I/O.
 */

export type SoftBehaviour = {
  key: string;
  /** The requirement is about this behaviour. */
  req: RegExp;
  /** The words to mirror, taken from the requirement as written; null means use the extracted noun phrase. */
  phrase: RegExp | null;
  /** What a career point must say to show the behaviour. */
  evidence: RegExp;
};

export const SOFT_BEHAVIOURS: readonly SoftBehaviour[] = [
  {
    key: "end-to-end", req: /\bend[- ]to[- ]end\b/i, phrase: /\bend[- ]to[- ]end\b/i,
    evidence: /\bend[- ]to[- ]end\b|\bfrom\s+(?:design|discovery|idea|concept|scoping|research|prototype|intake|requirements)\b.{0,50}\b(?:through|to|until)\b|\bdesign\s+through\b/i,
  },
  {
    key: "ownership", req: /\bownership\b|\bowning\b|\baccountab\w*/i, phrase: /\bownership\b|\baccountability\b/i,
    evidence: /\bown(?:ed|s|ing|ership)?\b|\bowner\b|\baccountable\b/i,
  },
  {
    key: "startup", req: /\bstart-?ups?\b|\bhigh[- ]growth\b|\bearly[- ]stage\b|\bfast[- ]paced\b|\bscrappy\b/i, phrase: null,
    evidence: /\bstart-?ups?\b|\bseed[- ]stage\b|\bseries [a-d]\b|\bearly[- ]stage\b|\bfounding\b|\bhigh[- ]growth\b|\bfirst (?:engineer|hire|designer|product manager|pm)\b|\bfast[- ]paced\b/i,
  },
  {
    key: "stakeholders", req: /\bstakeholders?\b|\bcross[- ]functional\b|\bpartner(?:ing)? with\b|\bcollaborat\w*/i,
    phrase: /\bcross[- ]functional\b|\b(?:[a-z]+\s+)?stakeholders?\b/i,
    evidence: /\bstakeholders?\b|\bcross[- ]functional\b|\bpartner(?:ed|s)? with\b|\bwork(?:ed|s)? closely with\b|\bcoordinat\w* with\b|\bcollaborat\w* with\b|\bpresent(?:ed|s)? to\b|\bwith (?:engineering|design|product|sales|finance|marketing|legal|operations|cardiology|physicians|supply chain)\b/i,
  },
  {
    key: "self-driven", req: /\bself[- ](?:driven|directed|motivated|starter)\b|\bautonom\w*|\bagency\b|\btake initiative\b/i,
    phrase: /\bself[- ](?:driven|directed|motivated)\b|\bautonomously\b|\bindependently\b/i,
    evidence: /\bindependently\b|\bon (?:my|her|his|their) own\b|\bself[- ]taught\b|\binitiated\b|\bproposed\b|\bfrom scratch\b|\bfounded\b|\bvolunteer\w*/i,
  },
  {
    key: "ambiguity", req: /\bambigu\w*/i, phrase: /\bambigu\w*/i,
    evidence: /\bambigu\w*|\bgreenfield\b|\b0 to 1\b|\bzero to one\b|\bfrom scratch\b|\bnew product\b/i,
  },
  {
    key: "mentoring", req: /\bmentor\w*|\bcoach\w*/i, phrase: /\bmentor\w*|\bcoach\w*/i,
    evidence: /\bmentor\w*|\bcoach\w*|\bprecept\w*|\btrain(?:ed|s|ing) (?:new|junior)\b|\bonboard\w*/i,
  },
  {
    key: "people-leadership", req: /\blead(?:ing)? (?:a |the )?(?:team|squad|group)\b|\bpeople management\b|\bmanag\w* (?:a |the )?team\b|\bdirect reports\b/i, phrase: null,
    evidence: /\bled (?:a |the )?(?:team|squad)\b|\bmanag\w* (?:a |the )?(?:team|squad)\b|\bteam of \d+\b|\bdirect reports\b|\bcharge nurse\b|\btech lead\b/i,
  },
];

/** The soft behaviour a requirement is about, or null. */
export function softOf(text: string): SoftBehaviour | null {
  return SOFT_BEHAVIOURS.find((s) => s.req.test(text)) ?? null;
}

const LEAD = /^(?:\d+\s*\+?\s*(?:years?|yrs?)\s+(?:of\s+)?)?(?:(?:proven|demonstrated|strong|solid|excellent|deep|hands-on|professional|prior|direct|extensive|some|working)\s+)*(?:experience|ability|track record|proficiency|knowledge|familiarity|comfort|background|understanding|expertise|skills?)\b\s*(?:(?:with|in|of|to|at|on|for|as|across)\s+)?/i;
const LEAD_VERB = /^(?:building|operating|working|owning|leading|managing|developing|delivering|designing|creating|running|driving|supporting|shipping|scaling|maintaining|writing|using|partnering|collaborating|manage|build|lead|own|drive|work|deliver|design|develop|operate|ship|scale|partner|collaborate|communicate|translate|analyze|analyse|apply|use)\b(?:\s+(?:and|&|or)\s+[a-z]+)?\s*(?:(?:with|in|on|across|alongside|for)\s+)?/i;

/**
 * The posting's own key phrase for a descriptive requirement, as written (lead-ins such as "Experience building" and
 * "Ability to" removed, cut at the first "and"/"or" that is not part of a list, at most 6 words); null when nothing
 * distinctive is left. A soft requirement with a phrase pattern ("end-to-end", "stakeholders") uses the matched words.
 */
export function keyPhraseOf(text: string, soft: SoftBehaviour | null = softOf(text)): string | null {
  if (soft?.phrase) {
    const m = soft.phrase.exec(text);
    if (m) return m[0].trim();
  }
  let s = text.trim().replace(/^[-•*\s]+/, "");
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(LEAD, "").replace(LEAD_VERB, "").replace(/^(?:a|an|the)\s+/i, "");
    if (s === before) break;
  }
  // Cut at an "and"/"or" that joins clauses, not one that ends a comma list ("product, engineering, and business").
  const cut = /\s+(?:and|or)\s+|;|\(|\s+such as\s+|\s+including\s+|\s+e\.g\.|\s+preferably\s+|\s+ideally\s+/gi;
  for (const m of s.matchAll(cut)) {
    const idx = m.index ?? 0;
    if (/^\s+(?:and|or)\s+$/i.test(m[0]) && /,\s*$/.test(s.slice(0, idx + 1))) continue;
    s = s.slice(0, idx);
    break;
  }
  s = s.replace(/[\s,.;:]+$/, "").replace(/\s+etc$/i, "").trim();
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length === 0 || s.length < 4) return null;
  return words.slice(0, 6).join(" ");
}

/** Lower case, punctuation and hyphens as spaces: "Large, heterogeneous datasets" ~ "large heterogeneous datasets". */
export const normPhrase = (s: string): string => s.toLowerCase().replace(/[^a-z0-9+#&/]+/g, " ").trim();

/** True when the text carries the phrase word for word (case, hyphens and commas aside). */
export function containsPhrase(text: string, phrase: string): boolean {
  const p = normPhrase(phrase);
  if (!p) return false;
  return ` ${normPhrase(text)} `.includes(` ${p} `);
}
