import { and, companies, eq, freshJobSql, isNull, jobSpecs, jobs, sql, type Db } from "@norinote/db";
import { seniorityFromTitle } from "./heuristic-spec.js";
import { SPEC_VERSION } from "./understand.js";

/**
 * Role families and pools.
 *
 * `roleFamilyOf` sorts a job title into a coarse family (software engineering, product, design, ...) with a subfamily for
 * software engineering and a seniority. It is deterministic and uses the title only, so it works on every job in the
 * shared index, including jobs nobody has read yet. `rolePool` is the "never empty" safety net: the freshest open jobs of one
 * family in one place, cached in memory for an hour.
 */

export const ROLE_FAMILIES = [
  "software_engineering", "product", "design", "data_analysis", "sales", "marketing", "customer_success", "operations",
  "finance", "people", "legal", "healthcare", "education",
  /** A known kind of job outside these families (mechanical, civil, electrical engineering...). */
  "other",
  /** The title says nothing we can classify. Matching then compares title words instead of families. */
  "unknown",
] as const;
export type RoleFamily = (typeof ROLE_FAMILIES)[number];

export const SOFTWARE_SUBFAMILIES = ["frontend", "backend", "full_stack", "mobile", "infrastructure", "data_ml", "security", "quality", "enterprise", "general"] as const;
export type SoftwareSubfamily = (typeof SOFTWARE_SUBFAMILIES)[number];

export type RoleSeniority = NonNullable<ReturnType<typeof seniorityFromTitle>> | "unknown";

export const DESIGN_SPECIALTIES = ["ux", "visual", "graphic", "instructional", "general"] as const;
export type DesignSpecialty = (typeof DESIGN_SPECIALTIES)[number];
export const DATA_SPECIALTIES = ["science", "analyst", "general"] as const;
export type DataSpecialty = (typeof DATA_SPECIALTIES)[number];
export const HEALTHCARE_SPECIALTIES = ["nursing", "physician", "therapy", "pharmacy", "technologist", "care_support", "dental", "behavioral", "general"] as const;
export type HealthcareSpecialty = (typeof HEALTHCARE_SPECIALTIES)[number];

export type RoleClass = {
  family: RoleFamily;
  /** Only for software engineering. */
  subfamily: SoftwareSubfamily | null;
  /**
   * Only for design, data analysis and healthcare: product/UX design is a different job from graphic or instructional
   * design, a data scientist is not a business analyst, a nurse is not a pharmacist. Null for every other family.
   */
  specialty: DesignSpecialty | DataSpecialty | HealthcareSpecialty | null;
  seniority: RoleSeniority;
};

/** Lower-case, one space between words, "front-end" and "full-stack" written as one word, "/" and "," as spaces. */
function normalize(title: string): string {
  return title
    .toLowerCase()
    .replace(/\bfront[\s-]?end\b/g, "frontend")
    .replace(/\bback[\s-]?end\b/g, "backend")
    .replace(/\bfull[\s-]?stack\b/g, "fullstack")
    .replace(/\bsite reliability\b/g, "sre")
    .replace(/\bdev[\s-]?ops\b/g, "devops")
    .replace(/[/,|()\-–—:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The word right before "engineer" that makes a title a software engineering role. */
const SW_KEYWORD = "software|swe|backend|frontend|fullstack|mobile|ios|android|devops|sre|reliability|machine learning|ml|ai|nlp|llm|security|appsec|data|analytics|platform|infrastructure|cloud|web|embedded|firmware|systems|application|applications|network|qa|test|quality|game|graphics|compiler|kernel|database|growth|release|build|tools|api|react|python|java|golang|rust|node|\\.net|c\\+\\+";
const SW_ENGINEER = new RegExp(`(?:^|\\s)(?:${SW_KEYWORD})\\s+(?:engineer|engineers|developer|developers|programmer|architect)\\b`);
const ML_RESEARCH = /\b(?:machine learning|ml|nlp|computer vision|deep learning|llm|ai)\b.*\b(?:scientist|researcher|research)\b|\b(?:research|applied) scientist\b/;
const UI_ENGINEER = /\b(?:ui|ux|design)\s+(?:engineer|developer)\b/;
const NON_SOFTWARE_ENGINEER = /\b(?:mechanical|electrical|civil|chemical|manufacturing|industrial|hardware|process|structural|biomedical|field service|facilities|mechatronics?)\s+(?:\w+\s+)?engineer/;

type Rule = [RegExp, RoleFamily];
/** First match wins. Customer-facing engineers come before the bare "engineer" fallback so "Sales Engineer" is sales. */
const RULES: Rule[] = [
  [/\bsales\b|account executive|business development|\bsdr\b|\bbdr\b|account manager|\bgtm\b|partnerships?\b|revenue/, "sales"],
  [/customer success|customer support|customer experience|customer service|client success|support engineer|support specialist|technical support|solutions? (?:engineer|architect|consultant)|customer engineer|technical account|implementation|onboarding specialist|support (?:agent|representative|associate)/, "customer_success"],
  [/\blegal\b|\battorney\b|\bcounsel\b|paralegal|lawyer|\bcompliance\b|privacy officer/, "legal"],
  [/recruit|talent|\bpeople\b|human resources|\bhr\b|\bhrbp\b|compensation|sourcer|\bculture\b|employee experience|learning and development/, "people"],
  [/financ|accountant|accounting|controller|fp&a|\bfpa\b|treasury|\btax\b|payroll|auditor|\baudit\b|bookkeep|procurement analyst/, "finance"],
  [/data analy|data scien|business analy|analytics|business intelligence|\bbi analyst|insights|research analyst|statistician|quantitative|\bbi developer|reporting analyst|product analyst/, "data_analysis"],
  [/\bnurse\b|\bnurses\b|\bnursing\b|\brn\b|\blpn\b|\blvn\b|\bcna\b|clinical|clinician|physician|\bdoctor\b|surgeon|hospitalist|psychiatr|therapist|\btherapy\b|pharmac|dental|dentist|hygienist|medical assistant|\bpatient\b|radiolog|sonograph|phlebotom|paramedic|\bemt\b|caregiver|surgical tech|respiratory|social worker|psycholog|dietitian|midwife|optometr|veterinar|medical technologist|lab technician|healthcare|health aide|home health|\bmedical\b/, "healthcare"],
  [/\bteacher\b|\bteachers\b|\bteaching\b|\btutor\b|instructor|professor|lecturer|educator|paraprofessional|\bschool\b|curriculum|\bfaculty\b/, "education"],
  [/designer|\bux\b|\bui\b|product design|visual design|graphic|creative director|user experience|illustrat|interaction design|design lead|design manager|head of design|design director|brand design|motion/, "design"],
  [/marketing|\bgrowth\b|\bseo\b|content (?:writer|strategist|manager|lead|creator|editor)|\bbrand\b|social media|copywriter|communications|public relations|\bpr\b|community manager|demand gen|lifecycle|campaign|\beditor\b|\bevents?\b/, "marketing"],
  [/product (?:manager|owner|management|lead|director)|(?:head|director|vp|chief) of product|chief product|\bapm\b|group product|technical product|\bproduct\b.*\bmanager\b/, "product"],
  [/operations|\bops\b|program manager|project manager|programme manager|scrum|logistics|supply chain|office manager|administrat|chief of staff|strategy|facilities|workplace|coordinator|executive assistant|business manager|general manager|\bproduct ops\b/, "operations"],
];

const SOFTWARE_FALLBACK = /\b(?:engineer|engineers|engineering|developer|developers|programmer|swe|technical staff|software|architect|sre|devops|tech lead|technical lead|sdet|qa engineer)\b/;

export function roleFamilyOf(title: string): RoleClass {
  const t = normalize(title);
  const seniority: RoleSeniority = seniorityFromTitle(title) ?? "unknown";
  const software = (): RoleClass => ({ family: "software_engineering", subfamily: softwareSubfamily(t), specialty: null, seniority });
  const of = (family: RoleFamily): RoleClass => ({
    family, subfamily: null, seniority,
    specialty: family === "design" ? designSpecialty(t) : family === "data_analysis" ? dataSpecialty(t) : family === "healthcare" ? healthcareSpecialty(t) : null,
  });
  if (NON_SOFTWARE_ENGINEER.test(t)) return of("other");
  if (ML_RESEARCH.test(t)) return { ...software(), subfamily: softwareSubfamily(t) === "general" ? "data_ml" : softwareSubfamily(t) };
  if (SW_ENGINEER.test(t) || UI_ENGINEER.test(t)) return software();
  for (const [re, family] of RULES) if (re.test(t)) return of(family);
  if (SOFTWARE_FALLBACK.test(t)) return software();
  return of("unknown");
}

/** Nursing, physicians, therapists, pharmacy, technologists, care support, dental and behavioural health are different jobs. */
function healthcareSpecialty(t: string): HealthcareSpecialty {
  if (/\b(?:cna|nursing assistant|medical assistant|caregiver|aide|patient care tech\w*|care partner|patient care associate)\b/.test(t)) return "care_support";
  if (/\b(?:nurse|nurses|nursing|rn|lpn|lvn|nurse practitioner)\b/.test(t)) return "nursing";
  if (/\b(?:physician|doctor|md|surgeon|hospitalist|psychiatrist)\b/.test(t)) return "physician";
  if (/\b(?:therapist|therapy|rehab\w*)\b/.test(t)) return "therapy";
  if (/pharmac/.test(t)) return "pharmacy";
  if (/\b(?:dental|dentist|hygienist)\b/.test(t)) return "dental";
  if (/\b(?:counselor|social worker|psycholog\w*|behavioral)\b/.test(t)) return "behavioral";
  if (/radiolog|sonograph|phlebotom|technologist|lab tech|surgical tech|paramedic|\bemt\b/.test(t)) return "technologist";
  return "general";
}

/** Product and UX design, visual and brand design, graphic, motion and video design, and instructional design are different jobs. */
function designSpecialty(t: string): DesignSpecialty {
  if (/\b(?:instructional|learning|curriculum|e ?learning|training)\b/.test(t)) return "instructional";
  if (/\b(?:graphic|motion|video|illustrat\w*|animat\w*|packaging|print|production artist|3d|presentation)\b/.test(t)) return "graphic";
  if (/\b(?:product design\w*|ux|ui|user experience|interaction|service design\w*|design systems?|user research\w*|usability|experience designer)\b/.test(t)) return "ux";
  if (/\b(?:visual|brand|creative|web designer|art director|marketing designer|communication designer|digital designer)\b/.test(t)) return "visual";
  return "general";
}

/** Data science and research versus analyst work (business, data, BI, reporting). */
function dataSpecialty(t: string): DataSpecialty {
  if (/\bdata scien|\bstatistician\b|\bquantitative (?:researcher|scientist)\b|\bresearch scientist\b|\bapplied scientist\b|\bdecision scientist\b/.test(t)) return "science";
  if (/\banaly|\bbusiness intelligence\b|\bbi\b|\binsights\b|\breporting\b/.test(t)) return "analyst";
  return "general";
}

/** Subfamily of a software engineering title, from keywords anywhere in it. "general" when none says more. */
function softwareSubfamily(t: string): SoftwareSubfamily {
  // Enterprise platforms (RPA, Salesforce, SAP, ServiceNow, mainframe) are their own trade.
  if (/\b(?:rpa|uipath|automation anywhere|blue prism|salesforce|sap|abap|servicenow|dynamics 365|mulesoft|mainframe|cobol|peoplesoft)\b/.test(t)) return "enterprise";
  if (/\b(?:qa|quality assurance|quality engineer\w*|test engineer\w*|engineer in test|sdet|tester|testing|test automation)\b/.test(t)) return "quality";
  if (/\bfullstack\b/.test(t)) return "full_stack";
  if (/\b(?:mobile|ios|android|react native|flutter|swift|kotlin)\b/.test(t)) return "mobile";
  if (/\b(?:frontend|ui|ux|web|react|angular|vue|design engineer|css)\b/.test(t) && !/\bwebscale\b/.test(t)) return "frontend";
  if (/\b(?:security|appsec|infosec|cyber|cryptograph\w*)\b/.test(t)) return "security";
  if (/\b(?:machine learning|ml|ai|nlp|llm|computer vision|deep learning|data|analytics|etl|mlops)\b/.test(t)) return "data_ml";
  if (/\b(?:devops|sre|reliability|infrastructure|platform|cloud|kubernetes|network|systems|release|build|observability)\b/.test(t)) return "infrastructure";
  if (/\b(?:backend|api|server|distributed|database|java|golang|python|node|rust|services?)\b/.test(t)) return "backend";
  return "general";
}

// ---- adjacent titles --------------------------------------------------------------------------------------------------

const SOFTWARE_ADJACENT: Record<SoftwareSubfamily, string[]> = {
  general: ["Software Engineer", "Software Developer", "Full Stack Engineer", "Backend Engineer"],
  frontend: ["Software Engineer", "UI Engineer", "Frontend Engineer", "Web Developer", "Full Stack Engineer"],
  backend: ["Software Engineer", "Backend Engineer", "Full Stack Engineer", "Platform Engineer"],
  full_stack: ["Software Engineer", "Full Stack Engineer", "Frontend Engineer", "Backend Engineer"],
  mobile: ["Software Engineer", "Mobile Engineer", "iOS Engineer", "Android Engineer"],
  infrastructure: ["Software Engineer", "DevOps Engineer", "Site Reliability Engineer", "Platform Engineer", "Infrastructure Engineer"],
  data_ml: ["Software Engineer", "Data Engineer", "Machine Learning Engineer", "Analytics Engineer"],
  security: ["Software Engineer", "Security Engineer", "Application Security Engineer"],
  enterprise: ["Software Engineer", "Salesforce Developer", "RPA Developer"],
  quality: ["QA Engineer", "Software Engineer in Test", "Test Automation Engineer"],
};

const FAMILY_ADJACENT: Partial<Record<RoleFamily, string[]>> = {
  product: ["Product Manager", "Associate Product Manager", "Technical Product Manager", "Product Owner"],
  design: ["Product Designer", "UX Designer", "UI Designer", "Visual Designer", "Interaction Designer"],
  data_analysis: ["Data Analyst", "Business Analyst", "Data Scientist", "Analytics Analyst", "Business Intelligence Analyst"],
  sales: ["Account Executive", "Sales Development Representative", "Business Development Representative", "Account Manager"],
  marketing: ["Marketing Manager", "Content Marketing Manager", "Growth Marketing Manager", "Product Marketing Manager", "Brand Manager"],
  customer_success: ["Customer Success Manager", "Support Engineer", "Solutions Engineer", "Customer Support Specialist"],
  operations: ["Operations Manager", "Program Manager", "Project Manager", "Business Operations Manager"],
  finance: ["Financial Analyst", "Accountant", "Finance Manager", "FP&A Analyst"],
  people: ["Recruiter", "Talent Acquisition Partner", "People Operations Specialist", "HR Business Partner"],
  legal: ["Counsel", "Attorney", "Paralegal", "Legal Counsel"],
};

/** Titles next to `title` in the same family (a Frontend Engineer is next to a Software Engineer and a UI Engineer). */
export function adjacentTitles(title: string): string[] {
  const c = roleFamilyOf(title);
  if (c.family === "software_engineering") return [...SOFTWARE_ADJACENT[c.subfamily ?? "general"]];
  return [...(FAMILY_ADJACENT[c.family] ?? [])];
}

/** The family most of `titles` belong to (the first one wins a tie); "other" when none can be classified. */
export function mainFamilyOf(titles: readonly string[]): RoleFamily {
  const counts = new Map<RoleFamily, number>();
  for (const t of titles) {
    const f = roleFamilyOf(t).family;
    if (f !== "other" && f !== "unknown") counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  let best: RoleFamily = "other";
  let bestN = 0;
  for (const [f, n] of counts) if (n > bestN) { best = f; bestN = n; }
  return best;
}

// ---- pools ------------------------------------------------------------------------------------------------------------

export const POOL_TTL_MS = 3_600_000;
export const POOL_DEFAULT_LIMIT = 300;
const POOL_PAGE = 400;
const POOL_MAX_SCAN = 2400;

/** Lower-case words a title of the family can contain: a cheap SQL prefilter, confirmed in memory by `roleFamilyOf`. */
const FAMILY_PREFILTER: Record<RoleFamily, string[]> = {
  software_engineering: ["engineer", "developer", "programmer", "software", "swe", "architect", "technical staff", "devops", "sre", "dev ops"],
  product: ["product", "apm"],
  design: ["design", "ux", "ui ", "creative", "graphic", "illustrat", "motion", "user experience"],
  data_analysis: ["data", "analy", "insight", "statistic", "quantitative", "intelligence"],
  sales: ["sales", "account", "business development", "sdr", "bdr", "gtm", "partner", "revenue"],
  marketing: ["market", "growth", "seo", "content", "brand", "social", "copy", "communications", "public relations", "pr ", "community", "demand", "lifecycle", "campaign", "editor", "event"],
  customer_success: ["customer", "client success", "support", "solution", "technical account", "implementation", "onboarding"],
  operations: ["operation", "ops", "program", "project", "scrum", "logistic", "supply", "office", "administrat", "chief of staff", "strategy", "facilit", "workplace", "coordinator", "assistant", "manager"],
  finance: ["financ", "account", "controller", "fp&a", "fpa", "treasury", "tax", "payroll", "audit", "bookkeep", "procurement"],
  people: ["recruit", "talent", "people", "human resources", "hr", "compensation", "sourcer", "culture", "employee", "learning"],
  legal: ["legal", "attorney", "counsel", "paralegal", "lawyer", "compliance", "privacy"],
  healthcare: ["nurs", "rn", "clinic", "physician", "doctor", "therap", "pharmac", "dental", "medical", "patient", "health", "radiolog", "care"],
  education: ["teach", "tutor", "instructor", "professor", "lecturer", "educat", "school", "curriculum", "faculty"],
  other: [],
  unknown: [],
};

export type PoolJob = {
  jobId: string;
  title: string;
  location: string | null;
  remote: boolean;
  companyName: string;
  /** Posted date, else first seen. */
  recency: Date;
  /** 0 nothing read yet, 1 heuristic spec, 2 spec read by the model. */
  quality: number;
};

export type RolePoolOptions = {
  family: RoleFamily;
  /** City or area ("San Francisco, CA" and "San Francisco" are the same). */
  metro?: string | null;
  /** Include remote jobs. With no metro, only remote jobs. With neither, jobs anywhere. */
  remote?: boolean;
  limit?: number;
  /** Clock for freshness and the cache (tests). Default: now. */
  now?: Date;
};

type CacheEntry = { at: number; size: number; rows: PoolJob[] };
const poolCache = new Map<string, CacheEntry>();

/** Forget cached pools (tests). */
export function clearRolePoolCache(): void {
  poolCache.clear();
}

const metroNeedle = (metro: string) => (metro.split(",")[0] ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The freshest open jobs of one role family in one place, from the shared index: open, company not blocked, posted (else
 * posted within 72 hours (see `freshJobSql`), newest day first, then jobs a model has read before jobs it has not. Pools are cached per
 * process for an hour, keyed by family, metro and remote; a call that asks for more rows than the cached pool holds refreshes it.
 */
export async function rolePool(db: Db, opts: RolePoolOptions): Promise<PoolJob[]> {
  const limit = opts.limit ?? POOL_DEFAULT_LIMIT;
  const now = opts.now ?? new Date();
  const metro = opts.metro ? metroNeedle(opts.metro) : "";
  const key = `${opts.family}|${metro}|${opts.remote ? "remote" : "onsite"}`;
  const hit = poolCache.get(key);
  if (hit && now.getTime() - hit.at < POOL_TTL_MS && now.getTime() >= hit.at && (hit.rows.length < hit.size || hit.rows.length >= limit)) {
    return hit.rows.slice(0, limit);
  }

  const size = Math.max(limit, POOL_DEFAULT_LIMIT);
  const rows = await queryPool(db, opts.family, metro, !!opts.remote, size, now);
  poolCache.set(key, { at: now.getTime(), size, rows });
  return rows.slice(0, limit);
}

async function queryPool(db: Db, family: RoleFamily, metro: string, remote: boolean, size: number, now: Date): Promise<PoolJob[]> {
  const words = FAMILY_PREFILTER[family];
  if (words.length === 0) return [];
  const recency = sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt})`;
  const prefilter = sql`lower(${jobs.title}) ~ ${`(${words.map(escapeRegex).join("|")})`}`;
  const place = metro
    ? remote
      ? sql`(${jobs.remote} OR (${jobs.location} IS NOT NULL AND lower(${jobs.location}) ~ ${`\\m${escapeRegex(metro)}\\M`}))`
      : sql`(${jobs.location} IS NOT NULL AND lower(${jobs.location}) ~ ${`\\m${escapeRegex(metro)}\\M`})`
    : remote ? sql`${jobs.remote}` : undefined;
  const quality = sql<number>`(CASE
    WHEN EXISTS (SELECT 1 FROM ${jobSpecs} WHERE ${jobSpecs.jobId} = ${jobs.id} AND ${jobSpecs.version} >= ${SPEC_VERSION}) THEN 2
    WHEN EXISTS (SELECT 1 FROM ${jobSpecs} WHERE ${jobSpecs.jobId} = ${jobs.id}) THEN 1 ELSE 0 END)::int`;

  const out: PoolJob[] = [];
  for (let offset = 0; offset < POOL_MAX_SCAN && out.length < size; offset += POOL_PAGE) {
    const page = await db
      .select({ jobId: jobs.id, title: jobs.title, location: jobs.location, remote: jobs.remote, companyName: companies.name, recency: sql<Date>`${recency}`.mapWith((v) => new Date(v as string)), quality })
      .from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(and(isNull(jobs.closedAt), eq(companies.blocked, false), freshJobSql(now), prefilter, place))
      .orderBy(sql`date_trunc('day', ${recency}) desc`, sql`${quality} desc`, sql`${recency} desc`, jobs.id)
      .limit(POOL_PAGE).offset(offset);
    for (const r of page) {
      if (out.length >= size) break;
      if (roleFamilyOf(r.title).family === family) out.push({ ...r, quality: Number(r.quality) });
    }
    if (page.length < POOL_PAGE) break;
  }
  return out;
}
