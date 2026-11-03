/** The LLM judge: one large-model call per (profile, job), a fixed rubric, results cached on disk by (profile, job, job text). */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { complete } from "@norinote/ai";
import { REASON_CODES, type ReasonCode } from "./metrics.js";

/** Bump when the rubric or the prompt changes; it is part of the cache key. */
export const JUDGE_VERSION = "v1";
export const MAX_JOB_CHARS = 3500;

export const JUDGE_SYSTEM = `You are a strict, experienced recruiter judging whether ONE job is a sensible suggestion for ONE candidate. You get the candidate's resume, their job-search profile (target titles, locations, work authorization, seniority) and one job posting. Judge only from what is written.

Question: would this person reasonably apply to this job and have a realistic chance of getting an interview?

Score from 1 to 5:
5 = Excellent. Same function, right level, right place, meets the must-haves; a clear apply.
4 = Good. Would reasonably apply and has a realistic chance; at most a small gap (a missing nice-to-have, slightly different domain, a year or so short).
3 = Stretch. Adjacent function or a level off by one step or a notable missing requirement; only a hopeful application.
2 = Poor. A clearly different function, a level off by two or more steps, or a hard requirement the candidate lacks.
1 = No. Wrong profession, blocked by work authorization or clearance, unreachable location, or no way to tell what the job is.

Rules:
- Function matters most. A different profession or discipline is at most a 2, however well keywords overlap.
- Seniority: compare the candidate's real experience with the level the job asks for (title, years, scope such as "lead", "principal", "director", or "entry level / new grad"). Too far above or below the candidate is a miss.
- Location: the job must be in a place the candidate listed (or remote if they accept remote). A job in another country or another metro the candidate did not list is a location miss. "United States" or a remote US job fits a candidate who accepts remote.
- Work authorization: a job that requires US citizenship, a security clearance, or states it does not sponsor visas is blocked for a candidate who is not a citizen, has no clearance, or needs sponsorship.
- If the posting text is empty or too thin to tell what the job is, use reason unclear_job and a score of at most 2.
- Do not reward a company's brand or the candidate's keywords alone. Do not invent facts about the candidate or the job.

reason is the single main reason for your score, one of:
good_fit (score 4 or 5), wrong_function, wrong_seniority_too_senior, wrong_seniority_too_junior, location_mismatch, missing_must_have, visa_or_clearance_blocked, unclear_job, duplicate (use only if the posting says it repeats another opening; normally never).
For a score of 3, name the main gap with the matching code, never good_fit.

sentence is one plain sentence (at most 30 words) saying why.`;

export const JudgeOutput = z.object({
  score: z.number(),
  reason: z.enum(REASON_CODES),
  sentence: z.string(),
});

export type Judgment = { score: number; reason: ReasonCode; sentence: string; model: string };

export type JudgeProfile = {
  id: string;
  resumeText: string;
  label: string;
  seniority: string;
  location: string;
  lanes: Array<{ titles: string[]; locations: string[]; remote: boolean }>;
  workAuthText: string;
};

export type JudgeJob = { id: string; title: string; company: string | null; location: string | null; remote: boolean; description: string; postedAt: string | null };

export function profileBlock(p: JudgeProfile): string {
  const lanes = p.lanes.map((l) => `- titles: ${l.titles.join(", ")}; locations: ${l.locations.length ? l.locations.join(", ") : "anywhere"}; remote jobs accepted: ${l.remote ? "yes" : "no"}`).join("\n");
  return [
    "CANDIDATE", `Seniority: ${p.seniority}`, `Lives in: ${p.location}`, `Work authorization: ${p.workAuthText}`,
    "Search lanes:", lanes, "", "RESUME", p.resumeText.trim(),
  ].join("\n");
}

export function jobBlock(j: JudgeJob): string {
  const desc = j.description.replace(/\s+/g, " ").trim().slice(0, MAX_JOB_CHARS);
  return [
    "JOB", `Title: ${j.title}`, `Company: ${j.company ?? "unknown"}`, `Location: ${j.location ?? "not stated"}${j.remote ? " (remote)" : ""}`,
    j.postedAt ? `Posted: ${j.postedAt.slice(0, 10)}` : "", `Description: ${desc || "(no description text)"}`,
  ].filter(Boolean).join("\n");
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
/** Cache key: the profile, the job, the judge version and the text the judge saw, so a changed description is judged again. */
export const judgmentKey = (profile: JudgeProfile, job: JudgeJob): string => `${JUDGE_VERSION}|${profile.id}|${job.id}|${sha(jobBlock(job) + profileBlock(profile))}`;

export class JudgmentCache {
  private data: Record<string, Judgment> = {};
  constructor(private readonly file: string | null) {
    if (file && existsSync(file)) {
      try { this.data = JSON.parse(readFileSync(file, "utf8")) as Record<string, Judgment>; } catch { this.data = {}; }
    }
  }
  get(key: string): Judgment | undefined { return this.data[key]; }
  set(key: string, j: Judgment): void { this.data[key] = j; }
  get size(): number { return Object.keys(this.data).length; }
  save(): void {
    if (!this.file) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data, null, 1));
  }
}

/** A score the model could return as 4.5 or 7 is rounded and kept in 1 to 5. */
export const clampScore = (n: number): number => Math.min(5, Math.max(1, Math.round(Number.isFinite(n) ? n : 1)));

/** Consistency between score and reason: a hit is good_fit, a miss never is. The model's sentence is kept. */
export function normaliseReason(score: number, reason: ReasonCode): ReasonCode {
  if (score >= 4) return "good_fit";
  if (reason === "good_fit") return "missing_must_have";
  return reason;
}

/** Judge one job (or return the cached judgment). The profile block is the shared prefix, so the vendor's prompt cache applies across a user's 20 calls. */
export async function judgeJob(profile: JudgeProfile, job: JudgeJob, cache: JudgmentCache): Promise<{ judgment: Judgment; cached: boolean }> {
  const key = judgmentKey(profile, job);
  const hit = cache.get(key);
  if (hit) return { judgment: hit, cached: true };
  const res = await complete({
    tier: "large", system: JUDGE_SYSTEM, prefix: profileBlock(profile), input: jobBlock(job),
    schema: JudgeOutput, schemaName: "match_judgment", strict: true, temperature: 0, maxOutputTokens: 200,
  });
  const score = clampScore(res.output.score);
  const judgment: Judgment = { score, reason: normaliseReason(score, res.output.reason), sentence: res.output.sentence.replace(/\s+/g, " ").trim(), model: res.model };
  cache.set(key, judgment);
  return { judgment, cached: false };
}
