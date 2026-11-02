import type { JobSpec } from "@norinote/shared";
import { detectRestrictions } from "./clearance.js";
import { DEFAULT_SKILL_MAP, findSkillsInText, skillDisplayName, type SkillMap } from "./skills.js";
import { detectSponsorship } from "./sponsorship.js";
import type { StoredJobSpec } from "./understand.js";

/**
 * A job spec without a model: what can be read from a posting with the shared detectors and word lists. It is stored with
 * `model: "heuristic"` under a spec version below the current one, so understanding upgrades it once the model is
 * available. It is coarser than the model's (no requirement sentences, no per-skill levels), but it is deterministic, it
 * never invents a requirement, and it is enough to gate, rank by skill overlap and show a shortlist.
 */

export type HeuristicJob = { title: string; descriptionText: string; location: string | null; remote: boolean };

const MAX_SKILLS = 30;
const MAX_TEXT = 12_000;

// ---- seniority and years ----------------------------------------------------------------------------------------------

/** Managers of a product, project or account are individual contributors, not people managers. */
const NOT_PEOPLE_MANAGER =
  /\b(?:product|project|program|programme|account|customer success|customer support|community|social media|content|marketing|brand|partnership|campaign|office|property|store|release|delivery)\s+manager\b/i;

type Seniority = JobSpec["seniority"];

/** Seniority from the title alone; null when the title says nothing. */
export function seniorityFromTitle(title: string): Seniority | null {
  const t = title.toLowerCase();
  if (/\b(?:intern|internship|co-?op|apprentice(?:ship)?|working student)\b/.test(t)) return "intern";
  if (/\bvp\b|\bvice president\b/.test(t)) return "director";
  if (/\b(?:chief|cto|ceo|cfo|coo|cio|ciso|cpo|evp|svp|president)\b/.test(t)) return "executive";
  if (/\b(?:director|head of)\b/.test(t)) return "director";
  if (/\bmanager\b/.test(t) && !NOT_PEOPLE_MANAGER.test(t)) return "manager";
  if (/\bprincipal\b|\bdistinguished\b|\bfellow\b/.test(t)) return "principal";
  if (/\bstaff\b/.test(t)) return "staff";
  if (/\b(?:senior|sr\.?|lead|iii|iv)\b/.test(t)) return "senior";
  if (/\b(?:junior|jr\.?|entry[- ]level|new grad(?:uate)?|graduate|early career|associate|trainee)\b/.test(t) || /\b(?:engineer|developer|analyst|designer|scientist)\s+i\b/.test(t)) return "entry";
  if (/\b(?:engineer|developer|analyst|designer|scientist)\s+ii\b/.test(t)) return "mid";
  return null;
}

/** "5+ years of experience", "at least 3 years", "experience: 4 years". The smallest number wins: it is the floor. */
export function yearsFromText(text: string): number | null {
  const found: number[] = [];
  const add = (s: string | undefined) => {
    const n = Number(s);
    if (Number.isFinite(n) && n >= 1 && n <= 25) found.push(n);
  };
  for (const m of text.matchAll(/\b(\d{1,2})\s*(?:\+|plus)?\s*(?:-\s*\d{1,2}\s*)?(?:years?|yrs?)\b(?:\s+of)?[^.\n]{0,50}?\bexperience\b/gi)) add(m[1]);
  for (const m of text.matchAll(/\bexperience\b[^.\n]{0,40}?\b(\d{1,2})\s*(?:\+|plus)?\s*(?:years?|yrs?)\b/gi)) add(m[1]);
  for (const m of text.matchAll(/\b(?:at least|minimum(?: of)?|min\.?)\s+(\d{1,2})\s*(?:years?|yrs?)\b/gi)) add(m[1]);
  return found.length > 0 ? Math.min(...found) : null;
}

function seniorityFromYears(years: number | null): Seniority {
  if (years == null) return "unknown";
  if (years <= 1) return "entry";
  if (years <= 4) return "mid";
  return "senior";
}

// ---- role family -------------------------------------------------------------------------------------------------------

/** First match wins, so the specific families come before the general ones. */
const ROLE_FAMILIES: Array<[RegExp, string]> = [
  [/\b(?:machine learning|ml|ai|nlp|computer vision|deep learning|llm)\b.*\b(?:engineer|scientist|researcher|developer)\b|\b(?:engineer|scientist|researcher)\b.*\b(?:machine learning|ml|nlp|computer vision|deep learning|llm)\b/, "machine learning"],
  [/\bdata scien/, "data science"],
  [/\bdata (?:engineer|platform|infrastructure)|\banalytics engineer|\betl\b/, "data engineering"],
  [/\bdata analy|\bbusiness intelligence\b|\bbi (?:analyst|developer)\b/, "data analysis"],
  [/\b(?:devops|sre|site reliability|platform engineer|infrastructure engineer|cloud engineer|systems? engineer)\b/, "infrastructure engineering"],
  [/\b(?:security|appsec|infosec|cyber)\b/, "security engineering"],
  [/\b(?:ios|android|mobile|react native|flutter)\b/, "mobile engineering"],
  [/\b(?:front[- ]?end|ui engineer|web developer)\b/, "frontend engineering"],
  [/\bfull[- ]?stack\b/, "full-stack engineering"],
  [/\b(?:back[- ]?end|api|server[- ]side|distributed systems)\b/, "backend engineering"],
  [/\b(?:qa|quality assurance|test engineer|sdet|test automation)\b/, "quality engineering"],
  [/\b(?:embedded|firmware|hardware|fpga|robotics)\b/, "embedded engineering"],
  [/\b(?:software|application|applications|platform|web|cloud)\s+(?:engineer|developer)\b|\bprogrammer\b|\bswe\b/, "software engineering"],
  [/\bproduct design|\bux\b|\bui\b|\bdesigner\b|\buser experience\b/, "product design"],
  [/\bproduct manage|\bproduct owner\b/, "product management"],
  [/\bproject manage|\bprogram manage|\bscrum master\b/, "program management"],
  [/\b(?:marketing|growth|seo|content|brand|social media)\b/, "marketing"],
  [/\b(?:sales|account executive|business development|sdr|bdr|account manager)\b/, "sales"],
  [/\b(?:customer success|customer support|support engineer|solutions? (?:engineer|architect))\b/, "customer success"],
  [/\b(?:recruit|talent|people operations|human resources|hr)\b/, "people operations"],
  [/\b(?:finance|accountant|accounting|controller|fp&a)\b/, "finance"],
  [/\b(?:operations|logistics|supply chain)\b/, "operations"],
  [/\bengineer(?:ing)?\b/, "engineering"],
];

export function roleFamilyFromTitle(title: string): string {
  const t = title.toLowerCase();
  for (const [re, family] of ROLE_FAMILIES) if (re.test(t)) return family;
  return "";
}

// ---- skills ------------------------------------------------------------------------------------------------------------

const REQUIRED_HEADING = /\b(?:requirements?|qualifications?|must[- ]haves?|what you.ll need|what we.re looking for|you have|you bring|about you|who you are)\b/i;
const PREFERRED_HEADING = /\b(?:nice[- ]to[- ]haves?|preferred|bonus(?: points)?|a plus|pluses|good to have|desired)\b/i;

/** Text of the posting that sits under a requirements-style heading and before any "preferred" heading. */
function requiredSection(text: string): string {
  const start = text.search(REQUIRED_HEADING);
  if (start < 0) return "";
  const rest = text.slice(start);
  const preferred = rest.slice(1).search(PREFERRED_HEADING);
  return preferred >= 0 ? rest.slice(0, preferred + 1) : rest;
}

// ---- the spec ----------------------------------------------------------------------------------------------------------

export function heuristicSpec(job: HeuristicJob, skills: SkillMap = DEFAULT_SKILL_MAP): StoredJobSpec {
  const description = (job.descriptionText ?? "").slice(0, MAX_TEXT);
  const restrictions = detectRestrictions({ title: job.title, descriptionText: description });
  const sponsorship = detectSponsorship(description) ?? "unknown";

  const inTitle = new Set(findSkillsInText(job.title, skills));
  const inRequired = new Set(findSkillsInText(requiredSection(description), skills));
  const keys = [...new Set([...inTitle, ...findSkillsInText(description, skills)])].slice(0, MAX_SKILLS);
  const specSkills = keys.map((k) => ({
    name: skillDisplayName(k, skills),
    level: "working" as const,
    years: null,
    required: inTitle.has(k) || inRequired.has(k),
  }));

  const yearsMin = yearsFromText(description);
  const seniority = seniorityFromTitle(job.title) ?? seniorityFromYears(yearsMin);

  const where = `${job.location ?? ""} ${job.title}`.toLowerCase();
  const remote: JobSpec["location"]["remote"] = job.remote || /\bremote\b|\bwork from home\b|\banywhere\b/.test(where)
    ? "remote"
    : /\bhybrid\b/.test(where) || /\bhybrid\b/i.test(description.slice(0, 1500)) ? "hybrid"
    : /\bon-?site\b|\bin[- ]office\b/.test(where) ? "onsite" : "unknown";
  const countries = /\b(?:united states|usa|u\.s\.a?\.?|us)\b/i.test(job.location ?? "") ? ["United States"] : [];

  return {
    mustHaves: [],
    niceToHaves: [],
    skills: specSkills,
    seniority,
    roleFamily: roleFamilyFromTitle(job.title),
    yearsMin,
    location: { remote, countries, cities: [] },
    citizenshipRequired: restrictions.citizenship,
    clearanceRequired: restrictions.clearance,
    sponsorship,
    responsibilities: [],
    requirementWeights: {},
  };
}
