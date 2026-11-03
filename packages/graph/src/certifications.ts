/**
 * Licences, professional certifications and clinical cards found in resume text, as career points of kind
 * "certification". Deterministic: it reads only what the text states (name, state, issuer, issued and expiry dates) and
 * keeps the line it came from. Used by the heuristic parser and to back up the model's output.
 *
 * Patterns come in tiers so ordinary words do not become credentials:
 * - strong: unambiguous names and acronyms (BLS, ACLS, PMP, CKA, "Certified Public Accountant"), matched anywhere;
 * - weak: acronyms that mean something else in prose (RN, CPA, CPR, CSM), matched only in a licences section, on a line
 *   that speaks of a licence or certification, or as a credential after the name in the resume header;
 * - role: job-title-like phrases ("Registered Nurse"), matched only in a licences section or next to the word "licence".
 */
import { findSkills, normalizeSkills } from "./skills.js";
import type { DraftPoint } from "./heuristic.js";
import { DATE_RANGE, DATE_SOURCE, isPresent, normalizeDate } from "./text.js";

// ---- catalog --------------------------------------------------------------------------------------------------------

const NB = "(?<![A-Za-z0-9])";
const NA = "(?![A-Za-z0-9])";
/** Case-sensitive acronym with word boundaries ("ACL" or "CPAP" never match "ACLS" or "CPA"). */
const acr = (s: string) => new RegExp(`${NB}(?:${s})${NA}`, "g");
/** Case-insensitive phrase with word boundaries; single spaces match any run of whitespace. */
const phr = (s: string) => new RegExp(`${NB}(?:${s.replace(/ /g, "\\s+")})${NA}`, "gi");

type Variant = { id?: string; title?: string; skills?: string[] };
type Cat = {
  id: string;
  title: string;
  /** Licences issued per state: the state, when the text names it, goes into the title. */
  state?: boolean;
  /** Skills besides the id and any acronym matched. */
  skills?: string[];
  strong?: RegExp[];
  weak?: RegExp[];
  role?: RegExp[];
  /** The weak acronym may also stand as a credential after the name in the header ("Jane Doe, BSN, RN"). */
  cred?: boolean;
  /** Text that rules out the weak and role tiers (CPA as cost per acquisition). */
  veto?: RegExp;
  /** Text that rules out every tier (BLS the Bureau of Labor Statistics). */
  vetoAll?: RegExp;
  /** Refines one match (level, variant); null drops it. */
  variant?: (matched: string) => Variant | null;
};

const ROMAN: Record<string, string> = { "1": "I", "2": "II", "3": "III" };
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());

const AWS_ROLES = "Solutions Architect|Developer|SysOps Administrator|DevOps Engineer|Cloud Practitioner|Machine Learning|Data Engineer|Security|Database|Data Analytics|Advanced Networking";
const AWS_LEVELS = "Associate|Professional|Specialty|Foundational";
const AWS_PARSE = new RegExp(`AWS\\s+(?:Certified\\s+)?(${AWS_ROLES.replace(/ /g, "\\s+")})(?:\\s*[-–—,:]?\\s*\\(?(${AWS_LEVELS})\\)?)?`, "i");
const awsVariant = (m: string): Variant => {
  const p = AWS_PARSE.exec(m);
  const role = (p?.[1] ?? "").replace(/\s+/g, " ").toLowerCase();
  const proper = AWS_ROLES.split("|").find((r) => r.toLowerCase() === role) ?? titleCase(role);
  const level = p?.[2] ? titleCase(p[2]) : "";
  const title = `AWS Certified ${proper}${level ? ` - ${level}` : ""}`;
  return { id: `AWS|${proper}|${level}`, title, skills: [title, "AWS"] };
};

const GCP_ROLES = "Cloud Architect|Cloud Engineer|Cloud Developer|Cloud Network Engineer|Cloud Security Engineer|Cloud DevOps Engineer|Data Engineer|Machine Learning Engineer|Database Engineer|Digital Leader";
const gcpVariant = (m: string): Variant | null => {
  const role = new RegExp(`(${GCP_ROLES.replace(/ /g, "\\s+")})`, "i").exec(m)?.[1]?.replace(/\s+/g, " ");
  if (!role) return null;
  const proper = GCP_ROLES.split("|").find((r) => r.toLowerCase() === role.toLowerCase()) ?? role;
  const level = proper === "Digital Leader" ? "" : /associate/i.test(m) || (proper === "Cloud Engineer" && !/professional/i.test(m)) ? "Associate " : "Professional ";
  const title = `Google Cloud ${level}${proper}`;
  return { id: `GCP|${level}${proper}`, title, skills: [title, "Google Cloud"] };
};

const AZ_ROLES = "Fundamentals|Administrator|Developer|Solutions Architect|DevOps Engineer|Data Engineer|Security Engineer|AI Engineer|Data Scientist|Network Engineer";
const azVariant = (m: string): Variant => {
  const code = /\b(?:AZ|DP|SC|AI|MS)-\d{3}\b/.exec(m)?.[0];
  if (code) return { id: `Azure|${code}`, title: `Microsoft Azure certification ${code}`, skills: [code, "Azure"] };
  const role = new RegExp(`Azure\\s+(${AZ_ROLES.replace(/ /g, "\\s+")})(?:\\s+(Associate|Expert|Fundamentals))?`, "i").exec(m);
  const r = (role?.[1] ?? "").replace(/\s+/g, " ").toLowerCase();
  const proper = AZ_ROLES.split("|").find((x) => x.toLowerCase() === r) ?? titleCase(r);
  const level = role?.[2] && role[2].toLowerCase() !== proper.toLowerCase() ? ` ${titleCase(role[2])}` : "";
  const title = `Microsoft Certified: Azure ${proper}${level}`;
  return { id: `Azure|${proper}${level}`, title, skills: [title, "Azure"] };
};

const cat = (id: string, title: string, rest: Omit<Cat, "id" | "title"> = {}): Cat => ({ id, title, ...rest });

const CATALOG: Cat[] = [
  // Clinical cards and nursing licences
  cat("BLS", "Basic Life Support (BLS)", { strong: [acr("BLS"), phr("Basic Life Support")], vetoAll: /\b(?:bureau\s+of\s+labou?r|labou?r\s+statistics|census|unemployment|payrolls?|jolts)\b|\bBLS\s+(?:data|statistics|series|jobs|cpi|reports?)\b/i }),
  cat("ACLS", "Advanced Cardiac Life Support (ACLS)", { strong: [acr("ACLS"), phr("Advanced Cardiac Life Support")] }),
  cat("PALS", "Pediatric Advanced Life Support (PALS)", { strong: [acr("PALS"), phr("Pediatric Advanced Life Support")] }),
  cat("TNCC", "Trauma Nursing Core Course (TNCC)", { strong: [acr("TNCC"), phr("Trauma Nursing Core Course")] }),
  cat("NRP", "Neonatal Resuscitation Program (NRP)", { strong: [phr("Neonatal Resuscitation Program")], weak: [acr("NRP")] }),
  cat("CPR", "Cardiopulmonary Resuscitation (CPR)", { strong: [phr("Cardiopulmonary Resuscitation")], weak: [acr("CPR(?:\\s*/\\s*AED)?")] }),
  cat("NIHSS", "NIH Stroke Scale (NIHSS)", { strong: [acr("NIHSS"), phr("NIH Stroke Scale")] }),
  cat("CCRN", "Critical Care Registered Nurse (CCRN)", { strong: [acr("CCRN"), phr("Critical Care Registered Nurse")] }),
  cat("CEN", "Certified Emergency Nurse (CEN)", { strong: [phr("Certified Emergency Nurse")], weak: [acr("CEN")] }),
  cat("CNOR", "Certified Perioperative Nurse (CNOR)", { strong: [acr("CNOR")] }),
  cat("CMSRN", "Certified Medical-Surgical Registered Nurse (CMSRN)", { strong: [acr("CMSRN")] }),
  cat("PCCN", "Progressive Care Certified Nurse (PCCN)", { strong: [acr("PCCN")] }),
  cat("TCRN", "Trauma Certified Registered Nurse (TCRN)", { strong: [acr("TCRN")] }),
  cat("RN", "Registered Nurse (RN)", { state: true, cred: true, weak: [acr("RN(?!-to-)")], role: [phr("Registered Nurse")] }),
  cat("LPN", "Licensed Practical Nurse (LPN)", { state: true, cred: true, strong: [phr("Licensed Practical Nurse")], weak: [acr("LPN")] }),
  cat("LVN", "Licensed Vocational Nurse (LVN)", { state: true, cred: true, strong: [phr("Licensed Vocational Nurse")], weak: [acr("LVN")] }),
  cat("NP", "Nurse Practitioner (NP)", {
    state: true, cred: true,
    strong: [acr("(?:FNP|AGNP|AGACNP|PMHNP|ANP|ACNP|PNP|WHNP|NNP)(?:-(?:BC|C))?"), acr("NP-(?:BC|C)")],
    weak: [acr("NP(?!-(?:hard|complete))")], role: [phr("Nurse Practitioner")],
  }),
  cat("APRN", "Advanced Practice Registered Nurse (APRN)", { state: true, cred: true, strong: [phr("Advanced Practice Registered Nurse")], weak: [acr("APRN")] }),
  cat("CRNA", "Certified Registered Nurse Anesthetist (CRNA)", { cred: true, strong: [phr("Certified Registered Nurse Anesthetist")], weak: [acr("CRNA")] }),
  cat("CNA", "Certified Nursing Assistant (CNA)", { state: true, cred: true, strong: [phr("Certified Nursing Assistant")], weak: [acr("CNA")] }),
  cat("LCSW", "Licensed Clinical Social Worker (LCSW)", { state: true, strong: [phr("Licensed Clinical Social Worker")], weak: [acr("LCSW")] }),
  // Finance and accounting
  cat("CPA", "Certified Public Accountant (CPA)", {
    state: true, cred: true, strong: [phr("Certified Public Accountant")], weak: [acr("CPA")],
    veto: /\b(?:cost[- ]per[- ]acquisition|per[- ]acquisition|campaigns?|roas|cpc|cpm|paid\s+(?:media|social|search)|ad\s+spend)\b/i,
  }),
  cat("CFA", "Chartered Financial Analyst (CFA)", {
    strong: [acr("CFA(?:\\s+Level\\s+(?:III|II|I|[123]))?"), phr("Chartered Financial Analyst(?:\\s*\\(CFA\\))?(?:\\s+Level\\s+(?:III|II|I|[123]))?")],
    vetoAll: /\bCFA\s+franc/i,
    variant: (m) => {
      const level = /Level\s+(III|II|I|[123])$/i.exec(m)?.[1];
      const roman = level ? ROMAN[level] ?? level.toUpperCase() : null;
      return roman ? { id: `CFA|${roman}`, title: `Chartered Financial Analyst (CFA) Level ${roman}`, skills: ["CFA"] } : {};
    },
  }),
  cat("CFP", "Certified Financial Planner (CFP)", { strong: [acr("CFP"), phr("Certified Financial Planner")] }),
  cat("FRM", "Financial Risk Manager (FRM)", { strong: [phr("Financial Risk Manager")], weak: [acr("FRM")] }),
  // Cloud and IT
  cat("AWS", "AWS certification", {
    strong: [new RegExp(`${NB}AWS\\s+Certified\\s+(?:${AWS_ROLES.replace(/ /g, "\\s+")})(?:\\s*[-–—,:]?\\s*\\(?(?:${AWS_LEVELS})\\)?)?${NA}`, "gi"),
      new RegExp(`${NB}AWS\\s+(?:${AWS_ROLES.replace(/ /g, "\\s+")})\\s*[-–—,:]?\\s*\\(?(?:${AWS_LEVELS})\\)?${NA}`, "gi")],
    weak: [new RegExp(`${NB}AWS\\s+(?:${AWS_ROLES.replace(/ /g, "\\s+")})${NA}`, "gi")],
    variant: awsVariant,
  }),
  cat("GCP", "Google Cloud certification", {
    strong: [new RegExp(`${NB}(?:Google\\s+Cloud|GCP)\\s+Certified\\s*[-:]?\\s*(?:Professional\\s+)?(?:${GCP_ROLES.replace(/ /g, "\\s+")})${NA}`, "gi"),
      new RegExp(`${NB}Professional\\s+(?:Cloud\\s+Architect|Data\\s+Engineer|Cloud\\s+Developer|Cloud\\s+Network\\s+Engineer|Cloud\\s+Security\\s+Engineer|Cloud\\s+DevOps\\s+Engineer|Machine\\s+Learning\\s+Engineer|Database\\s+Engineer)${NA}`, "gi"),
      phr("Associate Cloud Engineer")],
    weak: [new RegExp(`${NB}(?:Google\\s+Cloud|GCP)\\s+(?:Professional\\s+|Associate\\s+)?(?:${GCP_ROLES.replace(/ /g, "\\s+")})${NA}`, "gi")],
    variant: gcpVariant,
  }),
  cat("Azure", "Microsoft Azure certification", {
    strong: [
      new RegExp(`${NB}Microsoft\\s+Certified\\s*[:\\-–]?\\s*Azure\\s+(?:${AZ_ROLES.replace(/ /g, "\\s+")})(?:\\s+(?:Associate|Expert))?${NA}`, "gi"),
      new RegExp(`${NB}Azure\\s+(?:Administrator|Developer|Solutions\\s+Architect|DevOps\\s+Engineer|Data\\s+Engineer|Security\\s+Engineer|AI\\s+Engineer|Data\\s+Scientist|Network\\s+Engineer)\\s+(?:Associate|Expert)${NA}`, "gi"),
      phr("Azure Fundamentals"), acr("(?:AZ|DP|SC|AI|MS)-\\d{3}"),
    ],
    weak: [new RegExp(`${NB}Azure\\s+(?:${AZ_ROLES.replace(/ /g, "\\s+")})${NA}`, "gi")],
    variant: azVariant,
  }),
  cat("CKA", "Certified Kubernetes Administrator (CKA)", { skills: ["Kubernetes"], strong: [acr("CKA"), phr("Certified Kubernetes Administrator")] }),
  cat("CKAD", "Certified Kubernetes Application Developer (CKAD)", { skills: ["Kubernetes"], strong: [acr("CKAD"), phr("Certified Kubernetes Application Developer")] }),
  cat("CKS", "Certified Kubernetes Security Specialist (CKS)", { skills: ["Kubernetes"], strong: [acr("CKS"), phr("Certified Kubernetes Security Specialist")] }),
  cat("Terraform Associate", "HashiCorp Certified: Terraform Associate", { skills: ["Terraform"], strong: [phr("(?:HashiCorp Certified:? )?Terraform Associate")] }),
  cat("Security+", "CompTIA Security+", { strong: [new RegExp(`${NB}(?:CompTIA\\s+)?Security\\+`, "gi")] }),
  cat("Network+", "CompTIA Network+", { strong: [new RegExp(`${NB}(?:CompTIA\\s+)?Network\\+`, "gi")] }),
  cat("Cloud+", "CompTIA Cloud+", { strong: [new RegExp(`${NB}CompTIA\\s+Cloud\\+`, "gi")], weak: [new RegExp(`${NB}Cloud\\+`, "g")] }),
  cat("CISSP", "Certified Information Systems Security Professional (CISSP)", { strong: [acr("CISSP"), phr("Certified Information Systems Security Professional")] }),
  cat("CISM", "Certified Information Security Manager (CISM)", { strong: [acr("CISM"), phr("Certified Information Security Manager")] }),
  cat("CISA", "Certified Information Systems Auditor (CISA)", { strong: [acr("CISA"), phr("Certified Information Systems Auditor")] }),
  cat("CEH", "Certified Ethical Hacker (CEH)", { strong: [acr("CEH"), phr("Certified Ethical Hacker")] }),
  cat("OSCP", "Offensive Security Certified Professional (OSCP)", { strong: [acr("OSCP"), phr("Offensive Security Certified Professional")] }),
  cat("Cisco", "Cisco certification", {
    strong: [acr("CCNA|CCNP|CCIE")],
    variant: (m) => ({ id: m, title: `Cisco ${m}`, skills: [m] }),
  }),
  cat("ITIL", "ITIL Foundation", { strong: [phr("ITIL(?:\\s*v?4|\\s*v3|\\s+4th Edition)? Foundations?")], weak: [acr("ITIL")] }),
  cat("Salesforce", "Salesforce certification", {
    skills: ["Salesforce"],
    strong: [/(?<![A-Za-z0-9])Salesforce\s+Certified\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}(?![A-Za-z0-9])/g],
    variant: (m) => { const t = m.replace(/\s+/g, " "); return { id: t, title: t, skills: ["Salesforce"] }; },
  }),
  // Project, agile, HR and quality
  cat("PMP", "Project Management Professional (PMP)", { skills: ["Project Management"], strong: [acr("PMP"), phr("Project Management Professional")] }),
  cat("CAPM", "Certified Associate in Project Management (CAPM)", { skills: ["Project Management"], strong: [acr("CAPM"), phr("Certified Associate in Project Management")] }),
  cat("PMI-ACP", "PMI Agile Certified Practitioner (PMI-ACP)", { skills: ["Agile"], strong: [acr("PMI-ACP"), phr("PMI Agile Certified Practitioner")] }),
  cat("PRINCE2", "PRINCE2", {
    skills: ["Project Management"], strong: [phr("PRINCE2(?: Foundation| Practitioner| Agile)?")],
    variant: (m) => ({ title: m.replace(/\s+/g, " ").replace(/^prince2/i, "PRINCE2").replace(/\b(foundation|practitioner|agile)\b/i, (w) => titleCase(w)) }),
  }),
  cat("CSM", "Certified ScrumMaster (CSM)", {
    skills: ["Agile"], strong: [phr("Certified Scrum\\s*Master")], weak: [acr("CSM")],
    veto: /customer\s+success|account\s+manag|\bcsm\s+(?:team|role)\b/i,
  }),
  cat("PSM", "Professional Scrum Master (PSM)", {
    skills: ["Agile"], strong: [phr("Professional Scrum Master(?: (?:III|II|I|1|2|3))?"), acr("PSM(?: (?:III|II|I))?")],
    variant: (m) => { const lvl = /(?:\s|^)(III|II|I|1|2|3)$/.exec(m)?.[1]; return lvl ? { id: `PSM ${lvl}`, title: `Professional Scrum Master (PSM ${lvl})` } : {}; },
  }),
  cat("CSPO", "Certified Scrum Product Owner (CSPO)", { skills: ["Agile"], strong: [acr("CSPO"), phr("Certified Scrum Product Owner")] }),
  cat("SAFe", "SAFe certification", {
    skills: ["Agile"], strong: [phr("SAFe(?: [56](?:\\.\\d)?)? (?:Agilist|Scrum Master|Product Owner(?:/Product Manager)?|Release Train Engineer|Practitioner)")],
    variant: (m) => { const t = m.replace(/\s+/g, " ").replace(/^safe/i, "SAFe"); return { id: `SAFe|${t.toLowerCase()}`, title: t, skills: [t, "Agile"] }; },
  }),
  cat("SHRM", "SHRM Certified Professional (SHRM-CP)", {
    strong: [acr("SHRM-?(?:CP|SCP)"), phr("SHRM (?:Senior )?Certified Professional")],
    variant: (m) => {
      const senior = /scp|senior/i.test(m);
      return senior
        ? { id: "SHRM-SCP", title: "SHRM Senior Certified Professional (SHRM-SCP)", skills: ["SHRM-SCP"] }
        : { id: "SHRM-CP", title: "SHRM Certified Professional (SHRM-CP)", skills: ["SHRM-CP"] };
    },
  }),
  cat("SPHR", "Senior Professional in Human Resources (SPHR)", { strong: [acr("SPHR"), phr("Senior Professional in Human Resources")] }),
  cat("PHR", "Professional in Human Resources (PHR)", { strong: [phr("Professional in Human Resources")], weak: [acr("PHR"), acr("aPHR")] }),
  cat("Six Sigma", "Six Sigma", {
    skills: ["Six Sigma"],
    strong: [phr("(?:Lean )?Six Sigma (?:Yellow|Green|Black|Master Black) Belt"), phr("(?:Yellow|Green|Black) Belt (?:in |-)?(?:Lean )?Six Sigma")],
    weak: [phr("Lean Six Sigma"), phr("Six Sigma")],
    variant: (m) => {
      const belt = /master black|yellow|green|black/i.exec(m)?.[0];
      const lean = /lean/i.test(m) ? "Lean " : "";
      if (!belt) return { id: `Six Sigma|${lean}`, title: `${lean}Six Sigma` };
      const b = titleCase(belt);
      return { id: `Six Sigma|${lean}${b}`, title: `${lean}Six Sigma ${b} Belt` };
    },
  }),
  cat("PE", "Professional Engineer (PE)", { state: true, role: [phr("Professional Engineer")] }),
  cat("OSHA", "OSHA certification", {
    strong: [phr("OSHA[-\\s]?(?:10|30)(?:[-\\s]hour)?")],
    variant: (m) => { const n = /(10|30)/.exec(m)?.[1] ?? ""; return { id: `OSHA ${n}`, title: `OSHA ${n}-Hour`, skills: [`OSHA ${n}`] }; },
  }),
];

// ---- states and issuers ---------------------------------------------------------------------------------------------

const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
const STATE_NAMES = Object.values(STATES).sort((a, b) => b.length - a.length);
const STATE_RE = new RegExp(`${NB}(${STATE_NAMES.map((s) => s.replace(/ /g, "\\s+")).join("|")})${NA}`, "i");
const LICENCE_ACR = "RN|LPN|LVN|NP|FNP|APRN|CNA|CRNA|CPA|PE|LCSW";
const STATE_ABBR_AFTER = new RegExp(`${NB}(?:${LICENCE_ACR})(?:-[A-Z]{1,2})?\\s*[,(\\-–:/]\\s*\\(?([A-Z]{2})\\)?${NA}`);
const STATE_ABBR_BEFORE = new RegExp(`${NB}([A-Z]{2})\\s+(?:${LICENCE_ACR})${NA}`);

function stateOf(entry: string): string | null {
  const full = STATE_RE.exec(entry)?.[1];
  if (full) return STATE_NAMES.find((s) => s.toLowerCase() === full.replace(/\s+/g, " ").toLowerCase()) ?? null;
  const abbr = STATE_ABBR_AFTER.exec(entry)?.[1] ?? STATE_ABBR_BEFORE.exec(entry)?.[1];
  return abbr ? STATES[abbr] ?? null : null;
}

const ISSUERS: [RegExp, string][] = [
  [new RegExp(`${NB}AHA${NA}|American\\s+Heart\\s+Association`, "g"), "American Heart Association"],
  [/American\s+Red\s+Cross|(?<![A-Za-z])Red\s+Cross/gi, "American Red Cross"],
  [new RegExp(`Project\\s+Management\\s+Institute|${NB}PMI${NA}(?!-)`, "gi"), "Project Management Institute"],
  [new RegExp(`Cloud\\s+Native\\s+Computing\\s+Foundation|${NB}CNCF${NA}`, "gi"), "Cloud Native Computing Foundation"],
  [/Linux\s+Foundation/gi, "Linux Foundation"],
  [new RegExp(`${NB}CompTIA${NA}`, "gi"), "CompTIA"],
  [/\(ISC\)\s?2|(?<![A-Za-z0-9])ISC2(?![A-Za-z0-9])/gi, "ISC2"],
  [/Scrum\s+Alliance/gi, "Scrum Alliance"],
  [/Scrum\.org/gi, "Scrum.org"],
  [new RegExp(`HR\\s+Certification\\s+Institute|${NB}HRCI${NA}`, "gi"), "HR Certification Institute"],
  [new RegExp(`American\\s+Society\\s+for\\s+Quality|${NB}ASQ${NA}`, "gi"), "American Society for Quality"],
  [new RegExp(`${NB}AICPA${NA}`, "g"), "AICPA"],
  [/CFA\s+Institute/gi, "CFA Institute"],
  [/Amazon\s+Web\s+Services/gi, "Amazon Web Services"],
  [/Google\s+Cloud/gi, "Google Cloud"],
  [new RegExp(`${NB}Microsoft${NA}`, "gi"), "Microsoft"],
  [new RegExp(`${NB}HashiCorp${NA}`, "gi"), "HashiCorp"],
  [new RegExp(`${NB}Cisco${NA}`, "gi"), "Cisco"],
  [new RegExp(`American\\s+Nurses\\s+Credentialing\\s+Center|${NB}ANCC${NA}`, "g"), "American Nurses Credentialing Center"],
  [new RegExp(`American\\s+Association\\s+of\\s+Critical[- ]Care\\s+Nurses|${NB}AACN${NA}`, "g"), "American Association of Critical-Care Nurses"],
  [/Emergency\s+Nurses\s+Association/gi, "Emergency Nurses Association"],
  [new RegExp(`${NB}NCSBN${NA}`, "g"), "NCSBN"],
];
const BOARD_RE = /(?<![A-Za-z])(?:[A-Z][A-Za-z.]+\s+){1,3}Board\s+of\s+(?:Nursing|Accountancy|Registration|Professional\s+Engineers|Social\s+Work)(?![A-Za-z])/;
const ISSUED_BY = /\bissued\s+by\s+([A-Z][A-Za-z&.'’ -]{2,60}?)(?=\s*(?:[,;|()]|$|\d))/;

/** Issuers the text names, as written once in canonical form ("AHA" -> "American Heart Association"). */
export function issuersIn(text: string): string[] {
  const out: string[] = [];
  for (const [re, name] of ISSUERS) { re.lastIndex = 0; if (re.test(text) && !out.includes(name)) out.push(name); }
  const board = BOARD_RE.exec(text)?.[0];
  if (board) out.push(board.replace(/\s+/g, " "));
  const by = ISSUED_BY.exec(text)?.[1];
  if (by) out.push(by.trim());
  return out;
}

// ---- dates ----------------------------------------------------------------------------------------------------------

const D = `(${DATE_SOURCE})`;
const EXPIRES = new RegExp(`(?<![A-Za-z])(?:expir(?:es|ed|ation|y)|exp\\.?|valid\\s+(?:through|until|thru|till|to)|active\\s+(?:through|until|thru|till)|renew(?:al|s|ed)?(?:\\s+(?:due|by|date))?|through|until)(?![A-Za-z])\\s*(?:date)?\\s*[:\\-]?\\s*(?:on\\s+)?${D}(?!\\w)`, "i");
const ISSUED = new RegExp(`(?<![A-Za-z])(?:issued|obtained|earned|awarded|completed|passed|acquired|received|since)(?![A-Za-z])\\s*(?:on|in|:)?\\s*${D}(?!\\w)`, "i");
const ANY_DATE = new RegExp(`(?<![\\w#])${D}(?![\\w])`, "gi");

type Dates = { start: string | null; end: string | null };

/**
 * Issued and expiry dates an entry states. "Expires 03/2026", "valid through 2027" and "active through 2027" give the
 * end, "issued 2023" the start; inside a licences section a date range and a bare date count too (a bare date is the
 * issue date). Dates in the past stay: an expired item keeps its end.
 */
function datesOf(entry: string, loose: boolean): Dates {
  let start: string | null = null, end: string | null = null;
  const used: [number, number][] = [];
  const range = loose ? DATE_RANGE.exec(entry) : null;
  if (range) {
    start = normalizeDate(range[1]);
    end = isPresent(range[2]) ? null : normalizeDate(range[2]);
    used.push([range.index, range.index + range[0].length]);
  }
  const exp = EXPIRES.exec(entry);
  if (exp) { end = normalizeDate(exp[1]); used.push([exp.index, exp.index + exp[0].length]); }
  const iss = ISSUED.exec(entry);
  if (iss) { start = normalizeDate(iss[1]); used.push([iss.index, iss.index + iss[0].length]); }
  if (loose && start === null && !range) {
    for (const m of entry.matchAll(ANY_DATE)) {
      const at = m.index ?? 0;
      if (used.some(([a, b]) => at >= a && at < b)) continue;
      start = normalizeDate(m[1]);
      break;
    }
  }
  return { start, end };
}

// ---- finding certifications -----------------------------------------------------------------------------------------

type Hit = { cat: Cat; id: string; title: string; skills: string[]; matched: string; index: number };
type Allow = { weak: boolean; role: boolean; credOnly: boolean };

const SECTION_ALLOW: Allow = { weak: true, role: true, credOnly: false };
const PLAIN_ALLOW: Allow = { weak: false, role: false, credOnly: false };
const LICENCE_WORD = /licen[sc]|licensure|NCLEX|board\s+of\s+nursing|credential/i;
const CERT_WORD = /certif|credential|accredit|\bexam\b/i;
/** A header line that is a name followed by credentials: "Tasha Williams, BSN, RN". */
const CRED_LINE = /^[^,|@\d]{2,40}(?:,\s*[A-Za-z.]{2,8}){1,4}\s*$/;

/** What a line outside a licences section permits: a line that speaks of a licence or certification allows the weak tiers. */
function allowFor(line: string, head: boolean): Allow {
  if (LICENCE_WORD.test(line)) return SECTION_ALLOW;
  if (CERT_WORD.test(line)) return { weak: true, role: false, credOnly: false };
  if (head && CRED_LINE.test(line)) return { weak: false, role: false, credOnly: true };
  return PLAIN_ALLOW;
}

const ACRONYM = /^[A-Z][A-Z0-9+-]{1,9}$/;

function findHits(entry: string, allow: Allow): Hit[] {
  const hits: Hit[] = [];
  const collect = (c: Cat, re: RegExp) => {
    for (const m of entry.matchAll(new RegExp(re.source, re.flags))) {
      const matched = m[0];
      const v = c.variant ? c.variant(matched) : {};
      if (!v) continue;
      hits.push({
        cat: c,
        id: v.id ?? c.id,
        title: v.title ?? c.title,
        skills: [...(v.skills ?? [c.id]), ...(c.skills ?? []), ...(ACRONYM.test(matched) ? [matched] : [])],
        matched,
        index: m.index ?? 0,
      });
    }
  };
  for (const c of CATALOG) {
    if (c.vetoAll?.test(entry)) continue;
    for (const re of c.strong ?? []) collect(c, re);
    const soft = !c.veto?.test(entry);
    if (soft && (allow.weak || (allow.credOnly && c.cred))) for (const re of c.weak ?? []) collect(c, re);
    if (soft && allow.role) for (const re of c.role ?? []) collect(c, re);
  }
  // One hit per credential and none inside another's text: the longest match wins. Reading order.
  hits.sort((a, b) => b.matched.length - a.matched.length);
  const seen = new Set<string>();
  const kept: Hit[] = [];
  for (const h of hits) {
    if (seen.has(h.id) || kept.some((k) => h.index < k.index + k.matched.length && k.index < h.index + h.matched.length)) continue;
    seen.add(h.id);
    kept.push(h);
  }
  return kept.sort((a, b) => a.index - b.index);
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const stripEdges = (s: string) => s.replace(/^[\s,;:|•·–—-]+|[\s,;:|•·–—-]+$/g, "");
const BULLET = /^\s*(?:[•·●▪■◦‣▸►○∙]\s*|[-–—*]\s+)/;
const LABEL = /^(?:licen[sc]es?|certifications?|certificates?|credentials?|licensure)\s*(?:(?:&|and|\/)\s*(?:certifications?|licen[sc]es?)\s*)?:\s*/i;
const NOT_ISSUER = /^(?:active|expired|current|pending|valid|lifetime|multi-?state|compact|renewed?|passed|in progress)$|\b(?:expir|valid|issued|level|exam|candidate|licen[sc]|number|credential|certif)|[#\d]/i;

/** Splits on commas, ampersands, slashes and "and" outside parentheses. */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    const rest = s.slice(i);
    if (depth === 0 && (ch === "," || ch === "&" || /^\s\/\s/.test(rest) || /^\sand\s/i.test(rest))) {
      parts.push(cur);
      cur = "";
      if (/^\sand\s/i.test(rest)) i += 4;
      else if (/^\s\/\s/.test(rest)) i += 2;
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Splits a line at semicolons outside parentheses. */
function splitSemicolons(s: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** The issuer an entry states: a known issuer, else a plain name in a "Credential | Issuer | date" segment. */
function orgOf(entry: string, anchor: string): string | null {
  const known = issuersIn(entry);
  if (known.length) return known[0]!;
  const parts = entry.split(/\s+[|–—-]\s+|\s*\|\s*|\s·\s/).map((p) => stripEdges(clean(p))).filter(Boolean);
  if (parts.length < 2) return null;
  for (const part of parts) {
    if (part.includes(anchor) || anchor.includes(part)) continue;
    if (!/^[A-Z][A-Za-z&.'’ ,-]{2,60}$/.test(part) || part.split(" ").length > 6 || NOT_ISSUER.test(part)) continue;
    if (STATE_RE.test(part) && part.split(" ").length <= 2) continue;
    if (findHits(part, SECTION_ALLOW).length) continue;
    return part;
  }
  return null;
}

type Found = { id: string; state: string | null; draft: DraftPoint };

const IN_PROGRESS = /\b(?:candidate|in progress|pursuing|enrolled|studying|expected|working toward)\b/i;

function pointFrom(hit: Hit, entry: string, line: string, loose: boolean): Found {
  const state = hit.cat.state ? stateOf(entry) : null;
  // A CFA with a level named and no "charterholder" is a candidate who has passed exams, not a charterholder.
  const pending = IN_PROGRESS.exec(entry)?.[0] ?? (hit.cat.id === "CFA" && /\bLevel\b/i.test(entry) && !/charter/i.test(entry) ? "candidate" : undefined);
  let title = hit.title + (state ? `, ${state}` : "");
  if (pending) title += /candidate/i.test(pending) ? " (candidate)" : " (in progress)";
  const dates = datesOf(entry, loose);
  // Someone still working toward a credential has no issue or expiry date for it.
  if (pending) { dates.start = null; dates.end = null; }
  return {
    id: hit.id,
    state,
    draft: {
      kind: "certification", title, org: orgOf(entry, hit.matched), startDate: dates.start, endDate: dates.end,
      text: clean(entry).slice(0, 400),
      // A candidate or someone still studying does not hold the credential yet.
      // Inside a licences section the entry's own words add skills ("HashiCorp Terraform Associate" names Terraform); in a skills list or a bullet they would add the neighbours.
      skills: pending ? [] : normalizeSkills([...hit.skills, ...(loose ? findSkills(entry) : [])]),
      scope: {}, metrics: [], sourceQuote: line.trim(),
    },
  };
}

/** An entry in a licences section that is not in the catalog: kept as written (title without dates), skills from the text. */
function unknownPoint(entry: string, line: string): Found | null {
  const first = entry.split(/\s+[|–—-]\s+|\s*\|\s*/)[0] ?? entry;
  const dates = datesOf(entry, true);
  const stripped = clean(first.replace(DATE_RANGE, " ").replace(EXPIRES, " ").replace(ISSUED, " ")).replace(/(?:[,;:\s]|\(?\b(?:19|20)\d{2}\)?)+[.]?$/g, "");
  const title = stripEdges(stripped).replace(/[.]+$/, "");
  if (!/[A-Za-z]/.test(title) || title.length < 3 || title.length > 120 || title.split(/\s+/).length > 14) return null;
  return {
    id: `other|${title.toLowerCase()}`,
    state: null,
    draft: {
      kind: "certification", title, org: orgOf(entry, title), startDate: dates.start, endDate: dates.end,
      text: clean(entry).slice(0, 400), skills: normalizeSkills(findSkills(entry)), scope: {}, metrics: [], sourceQuote: line.trim(),
    },
  };
}

function merge(into: Found, from: Found): void {
  const a = into.draft, b = from.draft;
  a.org ??= b.org;
  a.startDate ??= b.startDate;
  a.endDate ??= b.endDate;
  if (!into.state && from.state) { into.state = from.state; a.title = b.title; }
  a.skills = normalizeSkills([...a.skills, ...b.skills]);
}

const baseId = (id: string) => (id.startsWith("CFA") ? "CFA" : id);

function addFound(found: Found[], f: Found): void {
  // The same credential at different levels of detail ("CFA" and "CFA Level II") is one point; the one with the level wins.
  const same = found.find((x) => baseId(x.id) === baseId(f.id) && (x.state === f.state || !x.state || !f.state));
  if (!same) { found.push(f); return; }
  if (f.id.includes("|") && !same.id.includes("|")) { same.id = f.id; same.draft.title = f.draft.title; }
  merge(same, f);
}

/** A licences section: entries split at semicolons and line ends; an entry naming several credentials is split further. */
function sectionEntries(lines: string[]): Found[] {
  const found: Found[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const body = clean(line.replace(BULLET, "").replace(LABEL, ""));
    if (!body) continue;
    for (const entry of splitSemicolons(body)) {
      const hits = findHits(entry, SECTION_ALLOW);
      if (hits.length > 1) {
        // "BLS, ACLS (AHA), exp 06/2026": one point each. A piece naming no credential belongs to the one before it
        // (or, at the start, the one after it): "Minnesota, RN" is one licence.
        const pieces: string[] = [];
        let lead = "";
        for (const p of splitTopLevel(entry)) {
          if (findHits(p, SECTION_ALLOW).length) { pieces.push(lead ? `${lead}, ${p}` : p); lead = ""; }
          else if (pieces.length) pieces[pieces.length - 1] += `, ${p}`;
          else lead = lead ? `${lead}, ${p}` : p;
        }
        for (const piece of pieces) for (const h of findHits(piece, SECTION_ALLOW)) addFound(found, pointFrom(h, piece, line, true));
      } else if (hits.length === 1) {
        addFound(found, pointFrom(hits[0]!, entry, line, true));
      } else if (entry.length <= 140) {
        const u = unknownPoint(entry, line);
        if (u) addFound(found, u);
      }
    }
  }
  return found;
}

/** Lines outside a licences section: only named credentials, and only explicit "issued" and "expires" dates. */
function elsewhere(lines: string[], head: boolean): Found[] {
  const found: Found[] = [];
  let seen = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const isHead = head && seen++ < 3;
    // Semicolons separate entries ("CFA Program: Level I passed 2023; Level II candidate 2026"); the line decides what is allowed.
    const body = clean(line.replace(BULLET, ""));
    const allow = allowFor(body, isHead);
    for (const entry of splitSemicolons(body)) {
      for (const h of findHits(entry, allow)) addFound(found, pointFrom(h, entry, line, false));
    }
  }
  return found;
}

/** A resume split into sections: the lines of its licences section, and the lines of every other section (the head is the part before the first heading). */
export type CertSections = { certifications: string[]; others: { lines: string[]; head: boolean }[] };

function collect(s: CertSections): Found[] {
  const found = sectionEntries(s.certifications);
  for (const o of s.others) for (const f of elsewhere(o.lines, o.head)) addFound(found, f);
  return found;
}

/** Certification drafts: the licences section first (named credentials and any other entry), then credentials named elsewhere. */
export function certificationsFromSections(s: CertSections): DraftPoint[] {
  return collect(s).map((f) => f.draft);
}

/** Only the credentials the catalog knows, each with its id (used to back up the model's output). */
export function catalogCertifications(s: CertSections): { id: string; draft: DraftPoint }[] {
  return collect(s).filter((f) => !f.id.startsWith("other|")).map((f) => ({ id: f.id, draft: f.draft }));
}

/** The catalog ids of the credentials a piece of text names; weak tiers are allowed because the text already is a certification point. */
export function certificationIds(text: string): string[] {
  return findHits(clean(text), SECTION_ALLOW).map((h) => h.id);
}
