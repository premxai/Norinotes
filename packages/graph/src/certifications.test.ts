import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { careerPoints, eq, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { createFakeProvider, setAiLogger, setProvider } from "@norinote/ai";
import { CAREER_POINT_KINDS } from "@norinote/shared";
import { buildCareerPoints, draftsFromModel, heuristicPoints, summarizeSkills, type DraftPoint } from "./index.js";
import type { CareerPoint } from "@norinote/shared";

const certs = (text: string) => heuristicPoints(text).filter((p) => p.kind === "certification");
const titles = (text: string) => certs(text).map((p) => p.title);
const byTitle = (list: DraftPoint[], start: string) => list.find((p) => p.title.startsWith(start));

const EVAL_DIR = fileURLToPath(new URL("../../../scripts/eval/resumes/", import.meta.url));
const evalResume = (prefix: string) => readFileSync(`${EVAL_DIR}${readdirSync(EVAL_DIR).find((f) => f.startsWith(prefix))!}`, "utf8");

// ---- fixtures -------------------------------------------------------------------------------------------------------

const NURSE = `Jordan Lee, BSN, RN
Minneapolis, MN | jordan.lee@example.com | (612) 555-0101
Minnesota RN license, active through 2027.

SUMMARY
Registered nurse with 5 years in acute care.

EXPERIENCE
Registered Nurse, Telemetry Unit | Northside Hospital | March 2021 - Present
- Provide care for 5 patients per shift on a 30-bed cardiac unit.
- Precept new graduates; RN-to-BSN mentoring for 3 colleagues.

EDUCATION
B.S. in Nursing | State University | 2020

LICENSES & CERTIFICATIONS
- Registered Nurse (RN), Minnesota Board of Nursing, issued 2020, expires 08/2027
- BLS (AHA), exp. 05/2026
- ACLS, American Heart Association, 2023 - 2025
- Telemetry certification, 2024

SKILLS
Patient assessment, Epic, Pyxis`;

const CLOUD = `Alex Kim
Cloud Engineer | alex@example.com

EXPERIENCE
Cloud Engineer | Fabrikam | 2020 - Present
- Built EKS clusters with Terraform; ran incident response.

CERTIFICATIONS
AWS Certified Solutions Architect - Associate (Amazon Web Services), issued Mar 2023, expires Mar 2026
Certified Kubernetes Administrator (CKA), Cloud Native Computing Foundation, 2022

SKILLS
AWS, Kubernetes, Terraform`;

const ACCOUNTANT = `Dana Ruiz, CPA
Dallas, TX | dana@example.com

SUMMARY
Certified Public Accountant with 8 years in audit and tax.

EXPERIENCE
Senior Auditor | Ledger & Co | 2016 - Present
- Led audits of 12 mid-market clients.

LICENSES
CPA, Texas, 2018
CFA Level II candidate`;

const PM = `Priya Nair
Program Manager

EXPERIENCE
Program Manager | Acme Corp | 2018 - Present
- Ran a PMO for 12 teams using Scrum; cut cycle time by 30%.

CERTIFICATIONS
Project Management Professional (PMP), Project Management Institute, 2019
Certified ScrumMaster (CSM); Six Sigma Green Belt`;

const NONE = `Sam Lee
sam@example.com

SUMMARY
Analyst who reads BLS data and CPI series, writes ACL rules, reviews CPAP device reports, and works with CPAs.
Customer Success Manager (CSM) at a software company; solved NP-hard routing problems; finished an RN-to-BSN reading list.
Reduced CPA by 20% on paid campaigns (cost per acquisition). Performed CPR in a first-aid drill.

EXPERIENCE
Analyst | Acme | 2019 - 2022
- Analyzed BLS data for a Bureau of Labor Statistics project and cut cost by 15%.

EDUCATION
B.S. Economics | State U | 2018`;

// ---- heuristic parse ------------------------------------------------------------------------------------------------

describe("certifications in the heuristic parser", () => {
  it("reads a nurse's licence, BLS, ACLS and other cards with state, issuer and dates", () => {
    const list = certs(NURSE);
    expect(list.map((p) => p.title)).toEqual([
      "Registered Nurse (RN), Minnesota",
      "Basic Life Support (BLS)",
      "Advanced Cardiac Life Support (ACLS)",
      "Telemetry certification",
    ]);
    expect(list.every((p) => p.kind === "certification" && p.scope && Object.keys(p.scope).length === 0 && p.metrics.length === 0)).toBe(true);

    const rn = byTitle(list, "Registered Nurse")!;
    expect(rn).toMatchObject({ org: "Minnesota Board of Nursing", startDate: "2020", endDate: "2027-08", skills: ["RN"] });
    expect(rn.sourceQuote).toBe("- Registered Nurse (RN), Minnesota Board of Nursing, issued 2020, expires 08/2027");
    expect(byTitle(list, "Basic Life Support")).toMatchObject({ org: "American Heart Association", startDate: null, endDate: "2026-05", skills: ["BLS"], sourceQuote: "- BLS (AHA), exp. 05/2026" });
    // A range gives both dates, and a date in the past stays as the end.
    expect(byTitle(list, "Advanced Cardiac")).toMatchObject({ org: "American Heart Association", startDate: "2023", endDate: "2025", skills: ["ACLS"] });
    expect(byTitle(list, "Telemetry")).toMatchObject({ org: null, startDate: "2024", endDate: null });
  });

  it("makes one point per credential when a licence line lists several, like the eval nurse", () => {
    const list = certs(evalResume("11-"));
    expect(list.map((p) => p.title)).toEqual([
      "Registered Nurse (RN), Minnesota",
      "Basic Life Support (BLS)",
      "Advanced Cardiac Life Support (ACLS)",
      "Pediatric Advanced Life Support (PALS)",
      "Telemetry certification (Cardiac Medical Certification, CMC)",
    ]);
    // "Minnesota RN license, active through 2027" and the header "BSN, RN" are the same licence as the section's entry.
    expect(byTitle(list, "Registered Nurse")).toMatchObject({ endDate: "2027", org: null, skills: ["RN"] });
    expect(byTitle(list, "Telemetry")).toMatchObject({ startDate: "2024" });
    expect(list.map((p) => p.skills[0]).slice(0, 4)).toEqual(["RN", "BLS", "ACLS", "PALS"]);
  });

  it("recognises licences outside a licences section only when the line speaks of a licence", () => {
    const list = certs("Maria Ortiz\nLPN (WI) active license; RN, MN exp. 11/2025\nCPR/AED certified");
    expect(list.map((p) => p.title)).toEqual(["Licensed Practical Nurse (LPN), Wisconsin", "Registered Nurse (RN), Minnesota", "Cardiopulmonary Resuscitation (CPR)"]);
    expect(byTitle(list, "Registered Nurse")).toMatchObject({ endDate: "2025-11" });
  });

  it("reads cloud certifications, keeps the platform as a skill, and finds Kubernetes cards", () => {
    const list = certs(CLOUD);
    expect(list.map((p) => p.title)).toEqual(["AWS Certified Solutions Architect - Associate", "Certified Kubernetes Administrator (CKA)"]);
    expect(list[0]).toMatchObject({ org: "Amazon Web Services", startDate: "2023-03", endDate: "2026-03" });
    expect(list[0]!.skills).toEqual(["AWS Certified Solutions Architect - Associate", "AWS"]);
    expect(list[1]).toMatchObject({ org: "Cloud Native Computing Foundation", startDate: "2022", skills: ["CKA", "Kubernetes"] });
  });

  it("reads the eval devops engineer's certifications from one line", () => {
    const list = certs(evalResume("07-"));
    expect(list.map((p) => p.title)).toEqual(["AWS Certified Solutions Architect - Professional", "Certified Kubernetes Administrator (CKA)", "HashiCorp Certified: Terraform Associate"]);
    expect(list[2]!.skills).toEqual(["Terraform Associate", "Terraform"]);
  });

  it("reads a CPA with state and issued year, and keeps a CFA candidate honest", () => {
    const list = certs(ACCOUNTANT);
    expect(list.map((p) => p.title)).toEqual(["Certified Public Accountant (CPA), Texas", "Chartered Financial Analyst (CFA) Level II (candidate)"]);
    expect(list[0]).toMatchObject({ startDate: "2018", skills: ["CPA"] });
    // Not a charterholder yet: the point is recorded as it is stated and claims no skill.
    expect(list[1]).toMatchObject({ skills: [], startDate: null, endDate: null });
    // The eval analyst's "CFA Level II candidate" and "Level I passed 2023" are one candidacy.
    expect(certs(evalResume("10-")).map((p) => p.title)).toEqual(["Chartered Financial Analyst (CFA) Level II (candidate)"]);
  });

  it("reads a project manager's PMP, Scrum and Six Sigma", () => {
    const list = certs(PM);
    expect(list.map((p) => p.title)).toEqual(["Project Management Professional (PMP)", "Certified ScrumMaster (CSM)", "Six Sigma Green Belt"]);
    expect(list[0]).toMatchObject({ org: "Project Management Institute", startDate: "2019", skills: ["PMP", "Project Management"] });
  });

  it("covers the other families by name: Security+, CISSP, SHRM, Azure, GCP, PRINCE2, OSHA", () => {
    const t = titles(`CERTIFICATIONS\nCompTIA Security+; CISSP; SHRM-CP; Microsoft Certified: Azure Administrator Associate; Google Cloud Professional Cloud Architect; PRINCE2 Practitioner; OSHA 30`);
    expect(t).toEqual([
      "CompTIA Security+", "Certified Information Systems Security Professional (CISSP)", "SHRM Certified Professional (SHRM-CP)",
      "Microsoft Certified: Azure Administrator Associate", "Google Cloud Professional Cloud Architect", "PRINCE2 Practitioner", "OSHA 30-Hour",
    ]);
  });

  it("finds well-known acronyms outside a licences section, keeping only what the line states", () => {
    const list = certs("Pat\nSKILLS\nEpic, BLS, ACLS, Pyxis\n\nEXPERIENCE\nStaff Nurse | Clinic | 2020 - 2023\n• Kept PMP certified status.");
    expect(list.map((p) => p.title)).toEqual(["Basic Life Support (BLS)", "Advanced Cardiac Life Support (ACLS)", "Project Management Professional (PMP)"]);
    expect(list[0]).toMatchObject({ org: null, startDate: null, endDate: null });
  });

  it("does not invent a credential, issuer or date, and has no hits on a resume without any", () => {
    expect(certs(NONE)).toEqual([]);
    for (const f of readdirSync(EVAL_DIR).filter((n) => /^(0[1-6]|08|09|12)-/.test(n))) {
      expect(certs(readFileSync(`${EVAL_DIR}${f}`, "utf8")), f).toEqual([]);
    }
    // Words that contain an acronym are not the acronym.
    expect(certs("SKILLS\nACL, CPAP, CPAs, ACLSX, XBLS, PMPs, PALSY")).toEqual([]);
    // "RN" the title of a job is not a licence, and "Registered Nurse" next to no licence word stays a job title.
    expect(certs("EXPERIENCE\nRegistered Nurse | Hospital | 2020 - 2023\n• Worked as RN on a ward.")).toEqual([]);
    // A line without an issuer or a date leaves both empty.
    expect(certs("CERTIFICATIONS\nBLS")[0]).toMatchObject({ org: null, startDate: null, endDate: null });
  });
});

// ---- model path -----------------------------------------------------------------------------------------------------

const noScope = { team_size: null, users: null, budget: null, ownership: null };
const mp = (over: Record<string, unknown>) => ({ title: "", org: null, start: null, end: null, text: "", skills: [], scope: noScope, metrics: [], source_quote: "", ...over });
const empty = { roles: [], projects: [], achievements: [], education: [], certifications: [], skills: [] };

describe("certifications from the model", () => {
  const roleOnly = [mp({ title: "Registered Nurse, Telemetry Unit", org: "Northside Hospital", start: "2021-03", text: "Provided care", source_quote: "Registered Nurse, Telemetry Unit | Northside Hospital | March 2021 - Present" })];

  it("keeps the model's certification points with issuer, issued date and expiry", () => {
    const out = {
      ...empty,
      certifications: [
        mp({ title: "Registered Nurse (RN), Minnesota", org: "Minnesota Board of Nursing", start: "2020", end: "2027-08", text: "- Registered Nurse (RN), Minnesota Board of Nursing, issued 2020, expires 08/2027", skills: ["RN"], source_quote: "- Registered Nurse (RN), Minnesota Board of Nursing, issued 2020, expires 08/2027" }),
        mp({ title: "Basic Life Support (BLS)", org: "American Heart Association", end: "2026-05", text: "BLS (AHA), exp. 05/2026", skills: ["BLS"], source_quote: "- BLS (AHA), exp. 05/2026" }),
        mp({ title: "Advanced Cardiac Life Support (ACLS)", org: "American Heart Association", start: "2023", end: "2025", text: "ACLS", skills: ["ACLS"], source_quote: "- ACLS, American Heart Association, 2023 - 2025" }),
      ],
    };
    const d = draftsFromModel({ ...out, roles: roleOnly }, NURSE).filter((p) => p.kind === "certification");
    expect(d.map((p) => p.title)).toEqual(["Registered Nurse (RN), Minnesota", "Basic Life Support (BLS)", "Advanced Cardiac Life Support (ACLS)"]);
    expect(d[0]).toMatchObject({ org: "Minnesota Board of Nursing", startDate: "2020", endDate: "2027-08", skills: ["RN"] });
    expect(d[1]).toMatchObject({ org: "American Heart Association", endDate: "2026-05" });
    expect(d[2]).toMatchObject({ startDate: "2023", endDate: "2025" });
  });

  it("drops an issuer or a date the resume does not state, and a quote that is not in the resume", () => {
    const out = {
      ...empty,
      roles: roleOnly,
      certifications: [
        mp({ title: "Basic Life Support (BLS)", org: "Red Cross", start: "2019", end: "2031", text: "BLS", skills: ["BLS"], source_quote: "- BLS (AHA), exp. 05/2026" }),
        mp({ title: "PMP", org: "PMI", text: "PMP", skills: ["PMP"], source_quote: "Project Management Professional, 2022" }),
      ],
    };
    const d = draftsFromModel(out, NURSE).filter((p) => p.kind === "certification");
    const bls = byTitle(d, "Basic Life Support")!;
    expect(bls).toMatchObject({ org: null, startDate: null, endDate: null });
    expect(d.some((p) => p.title === "PMP")).toBe(false);
  });

  it("adds a credential the model skipped, from what the text states, and nothing for a model reply that was empty", () => {
    const out = {
      ...empty,
      roles: roleOnly,
      certifications: [mp({ title: "Basic Life Support (BLS)", text: "BLS", skills: ["BLS"], source_quote: "- BLS (AHA), exp. 05/2026" })],
      skills: [mp({ title: "Skills", text: "Epic", skills: ["Epic"], source_quote: "Patient assessment, Epic, Pyxis" })],
    };
    const d = draftsFromModel(out, NURSE);
    const kinds = d.map((p) => p.kind);
    // Backfilled points sit before the skills points.
    expect(kinds.lastIndexOf("certification")).toBeLessThan(kinds.indexOf("skill"));
    const t = d.filter((p) => p.kind === "certification").map((p) => p.title);
    expect(t).toContain("Registered Nurse (RN), Minnesota");
    expect(t).toContain("Advanced Cardiac Life Support (ACLS)");
    // BLS from the model is not doubled by the heuristic one.
    expect(t.filter((x) => x.startsWith("Basic Life Support"))).toHaveLength(1);
    expect(draftsFromModel(empty, NURSE)).toEqual([]);
  });
});

// ---- end to end -----------------------------------------------------------------------------------------------------

describe("buildCareerPoints with certifications", () => {
  let t: TestDb;
  let n = 0;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeAll(() => setAiLogger(() => undefined));
  afterEach(() => setProvider(null));

  async function newUser(): Promise<string> {
    const [u] = await t.db.insert(users).values({ email: `cert${n++}@example.test`, passwordHash: "x" }).returning();
    return u!.id;
  }

  it("stores certification points from the model's output and from the fallback parser", async () => {
    setProvider(createFakeProvider({
      chat: (req) => req.jsonSchema?.name === "career_graph"
        ? { ...empty, roles: [mp({ title: "Registered Nurse, Telemetry Unit", org: "Northside Hospital", start: "2021-03", text: "Care", source_quote: "Registered Nurse, Telemetry Unit | Northside Hospital | March 2021 - Present" })],
            certifications: [mp({ title: "Registered Nurse (RN), Minnesota", skills: ["RN"], text: "Minnesota RN license, active through 2027.", end: "2027", source_quote: "Minnesota RN license, active through 2027." })] }
        : undefined,
    }));
    const userId = await newUser();
    const model = await buildCareerPoints(t.db, userId, NURSE);
    expect(model.source).toBe("model");
    const rn = model.points.find((p) => p.kind === "certification" && p.title.startsWith("Registered Nurse (RN)"))!;
    expect(rn).toMatchObject({ endDate: "2027", skills: ["RN"], source: "resume" });
    expect(model.points.filter((p) => p.kind === "certification").map((p) => p.skills[0])).toEqual(expect.arrayContaining(["RN", "BLS", "ACLS"]));
    const stored = await t.db.select().from(careerPoints).where(eq(careerPoints.userId, userId));
    expect(stored.some((p) => p.kind === "certification")).toBe(true);

    setProvider(null); // the default fake reply is not a career graph: the fallback parser reads the text
    const fallback = await buildCareerPoints(t.db, await newUser(), NURSE);
    expect(fallback.source).toBe("heuristic");
    expect(fallback.points.filter((p) => p.kind === "certification").map((p) => p.title)).toEqual([
      "Registered Nurse (RN), Minnesota", "Basic Life Support (BLS)", "Advanced Cardiac Life Support (ACLS)", "Telemetry certification",
    ]);
    expect(fallback.embedded).toBe(true);
  });
});

// ---- graph summary and contracts ------------------------------------------------------------------------------------

describe("certification points in the graph", () => {
  it("is a career point kind", () => {
    expect(CAREER_POINT_KINDS).toContain("certification");
  });

  it("does not turn an issue date into years of using the skill", () => {
    const base = { org: null, endDate: null, text: "", scope: {}, metrics: {}, sourceQuote: null } as const;
    const points: CareerPoint[] = [
      { ...base, id: "c1", kind: "certification", title: "AWS Certified Solutions Architect - Associate", startDate: "2015", skills: ["AWS"] },
      { ...base, id: "r1", kind: "role", title: "Engineer", startDate: "2023-01", skills: ["AWS"] },
    ];
    const aws = summarizeSkills(points, new Date("2025-01-15")).find((s) => s.skill === "AWS")!;
    expect(aws.years).toBeLessThan(3);
    expect(aws.points).toEqual(["c1", "r1"]);
  });
});
