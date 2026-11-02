import { applications, careerPoints, companies, jobSpecs, jobs, profiles, users, type Db } from "@norinote/db";
import type { JobSpec, PendingQuestion } from "@norinote/shared";

/** Test-only builders. Not exported from the package. */

export const SPEC: JobSpec = {
  mustHaves: ["Build REST APIs in TypeScript"], niceToHaves: [],
  skills: [{ name: "TypeScript", level: "advanced", years: 3, required: true }],
  seniority: "mid", roleFamily: "software engineering", yearsMin: 3,
  location: { remote: "remote", countries: ["US"], cities: [] },
  citizenshipRequired: false, clearanceRequired: false, sponsorship: "unknown", responsibilities: ["Build and run payment APIs", "Work with the platform team"],
};

export const q = (id: string, text: string, type: PendingQuestion["type"] = "text", options: string[] = [], required = true): PendingQuestion => ({ id, text, type, options, required });

export type Seed = { userId: string; jobId: string; companyId: string };

export async function seedUser(db: Db, tag: string, profile: Partial<typeof profiles.$inferInsert> = {}): Promise<{ userId: string }> {
  const [user] = await db.insert(users).values({ email: `${tag}@example.test`, passwordHash: "x" }).returning();
  const userId = user!.id;
  await db.insert(profiles).values({
    userId,
    contact: { name: "Ada Lovelace", phone: "+1 555 0100", linkedin: "linkedin.com/in/ada", github: "github.com/ada", address1: "12 Main St", city: "Austin", state: "TX", zip: "78701", country: "United States" },
    location: "Austin, TX",
    workAuth: { US: { authorized: true, needsSponsorship: false } },
    salaryExpectation: { amount: 150000, currency: "USD", period: "year" },
    startDate: "2 weeks after an offer",
    eeo: {},
    preferences: { willingToRelocate: true },
    ...profile,
  });
  await db.insert(careerPoints).values([
    { userId, kind: "role", title: "Backend Engineer", org: "Acme", startDate: "2021-03", text: "Built payment APIs in TypeScript serving 2 million requests per day and cut p95 latency by 60%", skills: ["TypeScript"] },
    { userId, kind: "project", title: "Pocket Router", text: "Built a Rust load balancer that handled 10000 connections in benchmarks", skills: ["Rust"] },
  ]);
  return { userId };
}

let jobSeq = 0;
export async function seedJob(db: Db, tag: string, company = "Initech", withSpec = true): Promise<{ jobId: string; companyId: string }> {
  const n = ++jobSeq;
  const [co] = await db.insert(companies).values({ atsType: "greenhouse", atsToken: `co-${tag}-${n}`, name: company }).returning();
  const [job] = await db.insert(jobs).values({
    companyId: co!.id, atsType: "greenhouse", externalId: `job-${tag}-${n}`, title: "Backend Engineer", location: "Remote, US", applyUrl: `https://example.test/${tag}/${n}`,
    descriptionText: `${company} builds payment infrastructure for small businesses. You will build and run APIs with a small platform team.`, dedupeKey: `${tag}|${n}`,
  }).returning();
  if (withSpec) await db.insert(jobSpecs).values({ jobId: job!.id, version: 1, spec: SPEC, model: "test" });
  return { jobId: job!.id, companyId: co!.id };
}

export async function addApplication(db: Db, userId: string, jobId: string, pending: PendingQuestion[], status: "needs_user" | "submitted" | "queued" = "needs_user"): Promise<string> {
  const [app] = await db.insert(applications).values({ userId, jobId, status, pendingQuestions: pending }).returning();
  return app!.id;
}
