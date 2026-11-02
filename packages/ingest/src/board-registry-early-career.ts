// Early-career and sponsorship-friendly employers, hand-curated and kept separate from the generated list in
// board-registry.ts so regenerating that file never drops them. Each entry was verified against its public job feed on
// 2026-10-28 and kept only if its CURRENT board had at least 3 postings with early-career titles (new grad, graduate,
// university, campus, early career, entry level, junior, intern, co-op, apprentice, "Engineer I", 2026/2027 grads) or at
// least 2 postings that state visa sponsorship positively. The comment on each entry records the counts it was kept on
// ("in US" is a rough count of those early-career postings with a US location). Hourly retail pools (Carvana) and boards
// whose early-career postings are all outside the US (Tripadvisor) were left out; defense and clearance-heavy firms
// were not considered.
import type { BoardEntry } from "./board-registry.js";

export const EARLY_CAREER_VERIFIED_AT = "2026-10-28";

export const EARLY_CAREER_BOARDS: BoardEntry[] = [
  // 11 early-career titles of 88 open (11 in US) e.g. "Developer Intern, Data Security - Winter 2027"
  { atsType: "ashby", token: "1password", name: "1Password" },
  // 3 early-career titles of 89 open (2 in US) e.g. "Machine Learning Engineer 1"
  { atsType: "greenhouse", token: "abnormalsecurity", name: "Abnormal Security" },
  // 13 early-career titles of 34 open (11 in US) e.g. "Accounting Intern (Term-Time, Part-Time)"
  { atsType: "greenhouse", token: "akunacapital", name: "Akuna Capital" },
  // 23 of 23 postings state visa sponsorship: "Visa sponsorship: We provide visa sponsorship support and assess each circumstance on a"
  { atsType: "ashby", token: "cartesia", name: "Cartesia" },
  // 4 early-career titles of 119 open (2 in US) e.g. "Software Engineer - New Grad 2026"
  { atsType: "ashby", token: "cerebras", name: "Cerebras" },
  // 10 early-career titles of 442 open (10 in US) e.g. "Electrical Engineer, Intern - Labs (Summer 2027)"
  { atsType: "greenhouse", token: "doordashusa", name: "DoorDash" },
  // 3 early-career titles of 24 open (3 in US) e.g. "AI Consulting Associate Program (AI CAP) Brokerage Intern - Summer 2027"
  { atsType: "greenhouse", token: "drivewealth", name: "DriveWealth" },
  // 14 early-career titles of 162 open (4 in US) e.g. "AI/ML Research Intern"
  { atsType: "greenhouse", token: "drweng", name: "DRW" },
  // 31 early-career titles of 75 open (18 in US) e.g. "2027 Quantitative Researcher Graduate (DV QES)"
  { atsType: "greenhouse", token: "dvtrading", name: "DV Trading" },
  // 7 early-career titles of 39 open (2 in US) e.g. "Hardware Support & Test Intern"
  { atsType: "ashby", token: "eightsleep", name: "Eight Sleep" },
  // 13 early-career titles of 117 open (0 in US) e.g. "Growth Ops Intern"
  { atsType: "ashby", token: "etched", name: "Etched" },
  // 36 of 54 postings state visa sponsorship: "We are open to sponsoring international candidates (e.g., STEM OPT, OPT, H1B, O1, E3)."
  { atsType: "ashby", token: "exa", name: "Exa" },
  // 3 early-career titles of 92 open (1 in US) e.g. "Canada Commercial Co-Op - Winter/Summer 2027"
  { atsType: "greenhouse", token: "fanduel", name: "FanDuel" },
  // 7 early-career titles of 47 open (3 in US) e.g. "Graduate Quantitative Trader"
  { atsType: "greenhouse", token: "flowtraders", name: "Flow Traders" },
  // 32 early-career titles of 239 open (29 in US) e.g. "3D Print Optimization Engineer - June 2027 New Grads"
  { atsType: "greenhouse", token: "formlabs", name: "Formlabs" },
  // 4 early-career titles of 19 open (2 in US) e.g. "Automation Scientist Graduate Intern, RAC Operations"
  { atsType: "greenhouse", token: "ginkgobioworks", name: "Ginkgo Bioworks" },
  // 14 early-career titles of 86 open (12 in US) e.g. "Algorithm Developer (Quant Research & Trading)  2027 Grads"
  { atsType: "greenhouse", token: "wehrtyou", name: "Hudson River Trading" },
  // 32 early-career titles of 169 open (13 in US) e.g. "2027 EU Campus Programme Talent Community"
  { atsType: "greenhouse", token: "imc", name: "IMC Trading" },
  // 40 early-career titles of 96 open (14 in US) e.g. "Campus AI/ML Researcher (Intern)"; 2 of 96 postings state visa sponsorship: "We sponsor work visas for full-time positions."
  { atsType: "greenhouse", token: "jumptrading", name: "Jump Trading" },
  // 3 early-career titles of 11 open (3 in US) e.g. "Summer 2027 Quantitative Research Intern - PhD/Postdoctoral"
  { atsType: "greenhouse", token: "pdtpartners", name: "PDT Partners" },
  // 11 early-career titles of 66 open (6 in US) e.g. "2027 AI Forward Deployed Engineer Intern"
  { atsType: "greenhouse", token: "schonfeld", name: "Schonfeld" },
  // 90 early-career titles of 266 open (48 in US) e.g. "A.I. Engineering Intern"
  { atsType: "greenhouse", token: "sezzle", name: "Sezzle" },
  // 7 early-career titles of 76 open (7 in US) e.g. "AI/ML PhD Intern (Summer 2027)"
  { atsType: "greenhouse", token: "sigmacomputing", name: "Sigma Computing" },
  // 8 early-career titles of 362 open (2 in US) e.g. "Software Engineer Intern - Berlin (2026)"
  { atsType: "ashby", token: "snowflake", name: "Snowflake" },
  // 6 early-career titles of 70 open (6 in US) e.g. "Cloud Security Intern"
  { atsType: "greenhouse", token: "tanium", name: "Tanium" },
  // 51 of 51 postings state visa sponsorship: "- Visa sponsorship: We sponsor visas."
  { atsType: "ashby", token: "thinkingmachines", name: "Thinking Machines Lab" },
  // 19 early-career titles of 100 open (4 in US) e.g. "Dveloppeur de logiciels C++ nouvellement diplm / New Grad C++ Software Developer"
  { atsType: "greenhouse", token: "towerresearchcapital", name: "Tower Research Capital" },
  // 15 early-career titles of 46 open (5 in US) e.g. "2027 Internship  Core Operations Engineer"
  { atsType: "greenhouse", token: "virtu", name: "Virtu Financial" },
  // 76 early-career titles of 347 open (75 in US) e.g. "Accounting Intern (Spring 2027)"; 3 of 347 postings state visa sponsorship: "Must be able to work in the country of the listed facility; Zipline can sponsor visas wher"
  { atsType: "greenhouse", token: "flyzipline", name: "Zipline" },
];
