import { embed } from "@norinote/ai";
import { applications, companies, eq, jobs, and, type Db } from "@norinote/db";
import { PendingQuestion, TERMINAL_APPLICATION_STATUSES } from "@norinote/shared";
import { DEFAULT_MATCH_THRESHOLD } from "./bank.js";
import { cosine, normalizeQuestion, sameSpecifics } from "./text.js";

export type PendingGroup = {
  /** The wording asked most often in the group; the one to show the user. */
  question: string;
  type: PendingQuestion["type"];
  options: string[];
  required: boolean;
  /** Other wordings of the same question. */
  variants: string[];
  /** Applications this question blocks. */
  applicationIds: string[];
  /** Where to write the answer back: one entry per application's question. */
  questions: { applicationId: string; questionId: string }[];
  /** A few "Company: Title" for the message. */
  examples: string[];
};

export type PendingDigest = {
  /** Most blocking first. */
  groups: PendingGroup[];
  /** Distinct applications waiting on at least one question. */
  blockedApplications: number;
  /** "4 questions block 12 applications". */
  summary: string;
};

type Item = { applicationId: string; example: string; q: PendingQuestion; key: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The user's unanswered questions across all of their open applications, grouped by meaning so that one message can
 * ask "these 4 questions block 12 applications". Identical wording groups first; the rest group when their embeddings
 * are close and they carry the same specifics (numbers, tools, names).
 */
export async function pendingDigest(db: Db, userId: string, opts: { threshold?: number } = {}): Promise<PendingDigest> {
  const threshold = opts.threshold ?? DEFAULT_MATCH_THRESHOLD;
  const rows = await db.select({ id: applications.id, status: applications.status, pending: applications.pendingQuestions, title: jobs.title, company: companies.name })
    .from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId)).innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(eq(applications.userId, userId)));

  const items: Item[] = [];
  for (const r of rows) {
    if (TERMINAL_APPLICATION_STATUSES.includes(r.status)) continue;
    for (const raw of r.pending) {
      const q = PendingQuestion.safeParse(raw);
      if (q.success) items.push({ applicationId: r.id, example: `${r.company}: ${r.title}`, q: q.data, key: normalizeQuestion(q.data.text) });
    }
  }

  // Identical wording first.
  type Bucket = { key: string; text: string; items: Item[] };
  const buckets = new Map<string, Bucket>();
  for (const it of items) {
    const b = buckets.get(it.key) ?? { key: it.key, text: it.q.text, items: [] };
    b.items.push(it);
    buckets.set(it.key, b);
  }
  const list = [...buckets.values()].sort((a, b) => b.items.length - a.items.length);

  // Then by meaning: the biggest bucket seeds a cluster; a smaller one joins the first cluster it is close to.
  let vectors: number[][] = [];
  if (list.length > 1) {
    try { vectors = await embed(list.map((b) => b.text), { userId, db }); } catch { vectors = []; }
  }
  const clusters: { seed: number; members: number[] }[] = [];
  list.forEach((b, i) => {
    const vec = vectors[i];
    const home = vec ? clusters.find((c) => {
      const seedVec = vectors[c.seed];
      return seedVec ? cosine(vec, seedVec) >= threshold && sameSpecifics(b.text, list[c.seed]!.text) : false;
    }) : undefined;
    if (home) home.members.push(i); else clusters.push({ seed: i, members: [i] });
  });

  const groups: PendingGroup[] = clusters.map((c) => {
    const members = c.members.map((i) => list[i]!);
    const all = members.flatMap((m) => m.items);
    const seed = list[c.seed]!;
    const first = seed.items[0]!.q;
    const apps = [...new Set(all.map((x) => x.applicationId))];
    return {
      question: seed.text, type: first.type, options: first.options, required: all.some((x) => x.q.required),
      variants: members.filter((m) => m !== seed).map((m) => m.text),
      applicationIds: apps,
      questions: all.map((x) => ({ applicationId: x.applicationId, questionId: x.q.id })),
      examples: [...new Set(all.map((x) => x.example))].slice(0, 3),
    };
  }).sort((a, b) => b.applicationIds.length - a.applicationIds.length || Number(b.required) - Number(a.required) || a.question.localeCompare(b.question));

  const blocked = new Set(groups.flatMap((g) => g.applicationIds)).size;
  return {
    groups, blockedApplications: blocked,
    summary: groups.length === 0 ? "No questions are waiting on you" : `${plural(groups.length, "question")} ${groups.length === 1 ? "blocks" : "block"} ${plural(blocked, "application")}`,
  };
}
