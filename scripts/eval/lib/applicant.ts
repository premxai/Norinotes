/** The clearly fictional applicant every apply eval and live dry run uses. Never a real person, never a real inbox. */
import { existsSync, mkdirSync, statSync } from "node:fs";
import { chromium } from "playwright";
import os from "node:os";
import path from "node:path";
import { careerPoints, eq, profiles, users, type Db } from "@norinote/db";
import type { ApplicantProfile } from "@norinote/apply";

export const APPLICANT_EMAIL = "test.applicant@norinote.test";

export const APPLICANT_PROFILE: ApplicantProfile = {
  fullName: "Test Applicant", firstName: "Test", lastName: "Applicant", email: APPLICANT_EMAIL, phone: "+1 415 555 0134",
  linkedin: "https://www.linkedin.com/in/test-applicant-norinote", github: "https://github.com/norinote-test", website: "https://norinote.test/test-applicant",
  location: "San Francisco, CA", country: "US", workAuth: { authorizedUS: true, needsSponsorship: false }, eeo: {},
};

const POINTS = [
  { kind: "role", title: "Senior Software Engineer", org: "Acme Analytics", startDate: "2022-03", endDate: null, skills: ["TypeScript", "Go", "PostgreSQL", "Kubernetes", "AWS"],
    text: "Led the rebuild of the event ingestion pipeline in Go on AWS, cutting p95 latency from 900 ms to 120 ms for 40 enterprise customers; mentored 3 engineers." },
  { kind: "role", title: "Software Engineer", org: "Globex Labs", startDate: "2019-07", endDate: "2022-02", skills: ["Python", "React", "PostgreSQL", "Docker"],
    text: "Built the customer-facing reporting dashboard in React and Python used by 12000 weekly users; owned the billing export service." },
  { kind: "project", title: "Open-source rate limiter", org: null, startDate: "2021", endDate: null, skills: ["Rust"],
    text: "Wrote a token-bucket rate limiter library in Rust with 300 GitHub stars." },
  { kind: "achievement", title: "Reduced cloud spend", org: "Acme Analytics", startDate: "2023", endDate: null, skills: ["AWS"],
    text: "Cut the AWS bill by 28% by moving batch jobs to spot instances and right-sizing databases." },
  { kind: "education", title: "B.S. Computer Science", org: "State University", startDate: "2015", endDate: "2019", skills: [], text: "B.S. in Computer Science." },
] as const;

/** A real one-page PDF for the fictional applicant (job systems reject an empty or invalid file). */
async function renderResume(file: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const items = POINTS.map((p) => `<li><b>${p.title}${p.org ? ` at ${p.org}` : ""}</b> (${p.startDate}${p.endDate ? ` to ${p.endDate}` : ""}): ${p.text}</li>`).join("");
    await page.setContent(`<html><body style="font-family:Arial;padding:40px"><h1>Test Applicant</h1><p>${APPLICANT_EMAIL} | San Francisco, CA | fictional test profile</p><ul>${items}</ul></body></html>`);
    await page.pdf({ path: file, format: "Letter" });
  } finally {
    await browser.close();
  }
}

/** Create (or find) the fictional user with profile and career points, and a one-page resume PDF on disk. */
export async function seedApplicant(db: Db): Promise<{ userId: string; resumePath: string }> {
  const dir = path.join(os.tmpdir(), "norinote-apply-eval-files");
  mkdirSync(dir, { recursive: true });
  const resumePath = path.join(dir, "Test_Applicant_Resume.pdf");
  if (!existsSync(resumePath) || statSync(resumePath).size < 2000) await renderResume(resumePath);
  const [existing] = await db.select().from(users).where(eq(users.email, APPLICANT_EMAIL)).limit(1);
  if (existing) return { userId: existing.id, resumePath };
  const [user] = await db.insert(users).values({ email: APPLICANT_EMAIL, passwordHash: "x" }).returning();
  const userId = user!.id;
  await db.insert(profiles).values({
    userId,
    contact: { name: "Test Applicant", firstName: "Test", lastName: "Applicant", email: APPLICANT_EMAIL, phone: "+1 415 555 0134",
      linkedin: APPLICANT_PROFILE.linkedin!, github: APPLICANT_PROFILE.github!, website: APPLICANT_PROFILE.website!, city: "San Francisco", state: "California", country: "United States", zip: "94105" },
    location: "San Francisco, CA",
    workAuth: { US: { authorized: true, needsSponsorship: false } },
    salaryExpectation: { amount: 165000, currency: "USD", period: "year" },
    startDate: "Two weeks after an offer",
    eeo: {},
    preferences: { willingToRelocate: false },
  });
  await db.insert(careerPoints).values(POINTS.map((p) => ({ userId, kind: p.kind, title: p.title, org: p.org, startDate: p.startDate, endDate: p.endDate, text: p.text, skills: [...p.skills] })));
  return { userId, resumePath };
}
