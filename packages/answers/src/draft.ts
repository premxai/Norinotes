import { z } from "zod";
import { complete } from "@norinote/ai";
import type { Db } from "@norinote/db";
import type { CareerPoint, JobSpec, PendingQuestion } from "@norinote/shared";

/** Questions that are facts only the person can give, or that are never ours to answer. */
const NEVER_DRAFT = /\b(ssn|social security|social insurance|passport|date of birth|birth ?date|national (id|insurance)|driver'?s licen[cs]e|tax (id|identification)|itin|aadhaar)\b|\breferences?\b|\breferee|referr|\bsalary history\b|current (salary|compensation)|previous (salary|compensation)/;
/** A text box that asks for prose, as opposed to a short fact. */
const PROSE = /\b(why|describe|tell us|tell me|explain|what (excites|interests|motivates|draws|attracts)|how (do|would|did|have) you|share|walk us through|in your own words|proud|challenge|accomplish|passion|interested in|about yourself)\b/;

/** True for a question the model may draft: free text, no options, and not something only the person can answer. */
export function isOpenEnded(q: PendingQuestion): boolean {
  if ((q.type !== "text" && q.type !== "textarea") || q.options.length > 0) return false;
  const label = q.text.toLowerCase();
  if (NEVER_DRAFT.test(label)) return false;
  return q.type === "textarea" || PROSE.test(label);
}

const Draft = z.object({ answerable: z.boolean(), answer: z.string() });

const SYSTEM = `You answer one question on a job application, as the candidate, in the first person.

Rules:
- Use only the facts you are given about the candidate and the job posting. Never invent an employer, title, skill, number, date or outcome.
- If the facts do not support an honest answer, reply {"answerable": false, "answer": ""}.
- Be specific and plain: name a real project or result from the facts when one fits. No filler ("passionate", "excited to leverage"), no flattery, no mention of being an AI.
- Length: a textarea gets 2 to 4 sentences (at most 90 words); a one-line text box gets one sentence (at most 25 words).
- For "why this company or role", use only what the posting says about the company and the work, linked to the candidate's real experience.
- Reply as JSON: {"answerable": boolean, "answer": string}.`;

const pointLine = (p: CareerPoint): string => {
  const when = [p.startDate, p.endDate ?? (p.startDate ? "present" : null)].filter(Boolean).join(" to ");
  const metrics = Object.keys(p.metrics).length ? ` Metrics: ${JSON.stringify(p.metrics)}.` : "";
  return `- [${p.kind}] ${p.title}${p.org ? ` at ${p.org}` : ""}${when ? ` (${when})` : ""}: ${p.text}${p.skills.length ? ` Skills: ${p.skills.join(", ")}.` : ""}${metrics}`;
};

/** Stable facts about the candidate. Identical across questions, so the vendor's prompt cache applies after the first. */
export function candidatePrefix(points: CareerPoint[]): string {
  return `Facts about the candidate (their resume, nothing else is known):\n${points.map(pointLine).join("\n")}`;
}

export type DraftJob = { title: string; company: string; description: string; spec: JobSpec | null };

const numbersIn = (s: string): string[] => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ""));
const words = (s: string): number => (s.trim() ? s.trim().split(/\s+/).length : 0);

/**
 * One small-model call for one open-ended question. The reply is kept only if the model says it is answerable, the
 * length fits the box, and every number in it appears in the candidate's facts or the posting.
 */
export async function draftAnswer(
  db: Db, userId: string, q: PendingQuestion, points: CareerPoint[], job: DraftJob,
): Promise<{ answer: string; model: string } | null> {
  if (points.length === 0) return null;
  const long = q.type === "textarea";
  const input = JSON.stringify({
    question: q.text, box: long ? "textarea" : "one-line text",
    job: {
      title: job.title, company: job.company,
      mustHaves: job.spec?.mustHaves.slice(0, 8) ?? [], responsibilities: job.spec?.responsibilities.slice(0, 6) ?? [],
      posting: job.description.slice(0, 1500),
    },
  });
  const res = await complete({ tier: "small", system: SYSTEM, prefix: candidatePrefix(points), input, schema: Draft, schemaName: "answer_draft", strict: true, userId, db });
  const answer = res.output.answer.trim();
  if (!res.output.answerable || !answer) return null;
  if (words(answer) > (long ? 130 : 40)) return null;
  const known = new Set([...numbersIn(points.map((p) => `${p.text} ${p.title} ${JSON.stringify(p.metrics)} ${JSON.stringify(p.scope)} ${p.startDate ?? ""} ${p.endDate ?? ""}`).join(" ")), ...numbersIn(`${job.title} ${job.description}`)]);
  if (numbersIn(answer).some((n) => !known.has(n))) return null;
  return { answer, model: res.model };
}
