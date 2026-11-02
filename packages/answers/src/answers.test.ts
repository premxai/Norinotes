import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createFakeProvider, fakeEmbedding, setProvider } from "@norinote/ai";
import { answerBank, eq } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { answerQuestions, pickBankAnswer, saveAnswer, pendingDigest, DEFAULT_MATCH_THRESHOLD, loadBank } from "./index.js";
import { addApplication, q, seedJob, seedUser } from "./test-fixtures.js";
import { cosine } from "./text.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());
afterEach(() => setProvider(null));

const run = (userId: string, jobId: string, questions: ReturnType<typeof q>[]) => answerQuestions(t.db, { userId, jobId, questions });
const bankFor = async (userId: string) => (await loadBank(t.db, userId)).sort((a, b) => a.questionText.localeCompare(b.questionText));

describe("answerQuestions: defaults first, never the model for facts", () => {
  it("answers profile facts without touching the bank or the model", async () => {
    const { userId } = await seedUser(t.db, "defaults");
    const { jobId } = await seedJob(t.db, "defaults");
    const provider = createFakeProvider();
    setProvider(provider);
    const r = await run(userId, jobId, [
      q("auth", "Are you legally authorized to work in the United States?", "boolean"),
      q("spons", "Will you now or in the future require sponsorship?", "select", ["Yes", "No"]),
      q("sal", "What are your salary expectations?"),
      q("hear", "How did you hear about us?", "select", ["Recruiter", "Referral", "Job Board", "Other"]),
      q("gender", "Gender", "select", ["Male", "Female", "Decline to self-identify"]),
      q("resume", "Resume", "file"),
    ]);
    expect(r.answers).toEqual({ auth: "Yes", spons: "No", sal: "150,000 USD per year", hear: "Job Board", gender: "Decline to self-identify" });
    expect(r.sources).toEqual({ auth: "default", spons: "default", sal: "default", hear: "default", gender: "default" });
    expect(r.pending).toEqual([]);
    expect(r.skipped.map((s) => s.id)).toEqual(["resume"]);
    expect(provider.calls).toHaveLength(0);
    expect(await bankFor(userId)).toEqual([]);
  });

  it("leaves unanswerable required questions pending and optional ones skipped", async () => {
    const { userId } = await seedUser(t.db, "pending");
    const { jobId } = await seedJob(t.db, "pending");
    const r = await run(userId, jobId, [
      q("canada", "Are you legally authorized to work in Canada?", "boolean"),
      q("opt", "Anything else you would like to add?", "text", [], false),
      q("addr2", "Address line 2", "text", [], false),
      q("fav", "What is your favourite colour?"),
    ]);
    expect(r.answers).toEqual({});
    expect(r.pending.map((p) => p.id)).toEqual(["canada", "fav"]);
    expect(r.skipped.map((p) => p.id)).toEqual(["opt", "addr2"]);
  });

  it("fails clearly for an unknown job", async () => {
    const { userId } = await seedUser(t.db, "nojob");
    await expect(run(userId, "00000000-0000-0000-0000-000000000000", [q("a", "x")])).rejects.toThrow(/Job .* not found/);
  });
});

describe("answerQuestions: the answer bank", () => {
  const K = "Do you have experience with Kubernetes in production?";

  it("documents how the fake embedding and the threshold behave for the pairs used here", () => {
    const sim = (a: string, b: string) => cosine(fakeEmbedding(a), fakeEmbedding(b));
    expect(sim(K, "Do you have experience with Kubernetes in production environments?")).toBeGreaterThan(DEFAULT_MATCH_THRESHOLD);
    // Close enough to pass the threshold on vectors alone: only the specifics guard keeps these apart.
    expect(sim(K, "Do you have experience with Docker in production?")).toBeGreaterThan(DEFAULT_MATCH_THRESHOLD);
    expect(sim(K, "What is your favourite colour?")).toBeLessThan(0.3);
    expect(sim("How did you hear about us?", "What are your thoughts on remote work?")).toBeLessThan(DEFAULT_MATCH_THRESHOLD);
  });

  it("reuses an answer by exact text, ignoring case and punctuation", async () => {
    const { userId } = await seedUser(t.db, "exact");
    const { jobId } = await seedJob(t.db, "exact");
    await saveAnswer(t.db, userId, K, "Yes, two years running clusters at Acme", "user");
    const r = await run(userId, jobId, [q("k", "do you have experience with kubernetes in production")]);
    expect(r.answers.k).toBe("Yes, two years running clusters at Acme");
    expect(r.sources.k).toBe("bank");
  });

  it("reuses an answer by meaning, but not for a different tool, number or topic", async () => {
    const { userId } = await seedUser(t.db, "meaning");
    const { jobId } = await seedJob(t.db, "meaning");
    await saveAnswer(t.db, userId, K, "Yes, two years", "user");
    const r = await run(userId, jobId, [
      q("same", "Do you have experience with Kubernetes in production environments?"),
      q("docker", "Do you have experience with Docker in production?"),
      q("years", "Do you have 5 years of experience with Kubernetes in production?"),
      q("other", "What is your favourite colour?"),
    ]);
    expect(r.answers).toEqual({ same: "Yes, two years" });
    expect(r.sources.same).toBe("bank");
    expect(r.pending.map((p) => p.id)).toEqual(["docker", "years", "other"]);
    const [row] = await bankFor(userId);
    expect(row!.lastUsedAt).not.toBeNull();
  });

  it("maps a reused answer onto the new question's options, or does not reuse it", async () => {
    const { userId } = await seedUser(t.db, "options");
    const { jobId } = await seedJob(t.db, "options");
    await saveAnswer(t.db, userId, "Have you ever been employed by a government agency?", "No", "user");
    const r = await run(userId, jobId, [
      q("fits", "Have you ever been employed by a government agency before?", "select", ["Yes", "No"]),
      q("nofit", "Have you ever been employed by a government agency, ever?", "select", ["Maybe", "Never"]),
    ]);
    expect(r.answers).toEqual({ fits: "No" });
    expect(r.pending.map((p) => p.id)).toEqual(["nofit"]);
  });

  it("is per user: another user's bank is never read", async () => {
    const a = await seedUser(t.db, "iso-a");
    const b = await seedUser(t.db, "iso-b");
    const { jobId } = await seedJob(t.db, "iso");
    await saveAnswer(t.db, a.userId, K, "Yes, two years", "user");
    const r = await run(b.userId, jobId, [q("k", K)]);
    expect(r.answers).toEqual({});
    expect(r.pending).toHaveLength(1);
  });

  it("prefers what the user typed over a default over a model draft when matches are near ties", () => {
    const row = (id: string, source: "user" | "default" | "model", answer: string) => ({ id, questionText: K, answer, source, lastUsedAt: null });
    const picked = pickBankAnswer(q("k", K), [
      { row: row("m", "model", "model answer"), similarity: 0.95 },
      { row: row("u", "user", "user answer"), similarity: 0.94 },
      { row: row("d", "default", "default answer"), similarity: 0.95 },
    ], DEFAULT_MATCH_THRESHOLD);
    expect(picked!.answer).toBe("user answer");
    // A clearly better match still wins over a better-trusted worse one.
    expect(pickBankAnswer(q("k", K), [{ row: row("m", "model", "model answer"), similarity: 0.99 }, { row: row("u", "user", "user answer"), similarity: 0.85 }], DEFAULT_MATCH_THRESHOLD)!.answer).toBe("model answer");
    expect(pickBankAnswer(q("k", K), [{ row: row("u", "user", "x"), similarity: 0.5 }], DEFAULT_MATCH_THRESHOLD)).toBeNull();
  });
});

describe("saveAnswer", () => {
  it("updates the same question in place, stores a vector, and never lets a model draft overwrite the user", async () => {
    const { userId } = await seedUser(t.db, "save");
    const first = await saveAnswer(t.db, userId, "Why do you want to work here?", "Because payments.", "model");
    expect(first.source).toBe("model");
    const typed = await saveAnswer(t.db, userId, "why do you want to work here", "Because I like the product.", "user");
    expect(typed.id).toBe(first.id);
    expect(typed.answer).toBe("Because I like the product.");
    const again = await saveAnswer(t.db, userId, "Why do you want to work here?", "A fresh model draft.", "model");
    expect(again.answer).toBe("Because I like the product.");
    expect(again.source).toBe("user");
    const rows = await t.db.select().from(answerBank).where(eq(answerBank.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.questionEmbedding).toHaveLength(1536);
    await expect(saveAnswer(t.db, userId, "   ", "x", "user")).rejects.toThrow(/empty question/);
  });
});

describe("answerQuestions: open-ended drafting", () => {
  type Req = { messages: { content: string }[]; model: string };
  const scripted = (reply: (input: { question: string }) => { answerable: boolean; answer: string }) => {
    const provider = createFakeProvider({ chat: (req) => reply(JSON.parse((req as Req).messages.at(-1)!.content)) });
    setProvider(provider);
    return provider;
  };

  it("drafts one grounded answer with the small model and saves it as a model answer", async () => {
    const { userId } = await seedUser(t.db, "draft");
    const { jobId } = await seedJob(t.db, "draft", "Initech");
    const provider = scripted(() => ({ answerable: true, answer: "At Acme I built payment APIs in TypeScript and cut p95 latency by 60%, which is the kind of work this role is about." }));
    const r = await run(userId, jobId, [q("why", "Tell us about a project you are proud of", "textarea")]);
    expect(r.answers.why).toMatch(/cut p95 latency by 60%/);
    expect(r.sources.why).toBe("model");
    expect(provider.calls).toHaveLength(1);
    const call = provider.calls[0]! as unknown as Req;
    expect(call.model).toBe("gpt-4.1-mini");
    // Grounded: the candidate's facts are in the prefix, the job and question in the input.
    expect(call.messages.map((m) => m.content).join("\n")).toContain("Built payment APIs in TypeScript serving 2 million requests per day");
    expect(call.messages.at(-1)!.content).toContain("Tell us about a project you are proud of");
    const [row] = await bankFor(userId);
    expect(row!.source).toBe("model");
    expect(row!.questionText).toBe("Tell us about a project you are proud of");

    // The next application with the same question reuses it: no second call.
    const { jobId: job2 } = await seedJob(t.db, "draft", "Globex");
    const again = await run(userId, job2, [q("p", "Tell us about a project you are proud of!", "textarea")]);
    expect(again.sources.p).toBe("bank");
    expect(provider.calls).toHaveLength(1);
  });

  it("keys an answer that names the company to that company, so another company's question is drafted afresh", async () => {
    const { userId } = await seedUser(t.db, "company");
    const initech = await seedJob(t.db, "company", "Initech");
    const globex = await seedJob(t.db, "company", "Globex");
    const provider = scripted(({ question }) => ({ answerable: true, answer: question.length > 0 ? "Initech builds payment tools for small businesses, and I have built payment APIs in TypeScript at Acme." : "" }));
    const WHY = "Why do you want to work here?";
    const first = await run(userId, initech.jobId, [q("why", WHY, "textarea")]);
    expect(first.sources.why).toBe("model");
    expect((await bankFor(userId))[0]!.questionText).toBe(`${WHY} [Initech]`);
    // Same company again: found by its company key, no new call.
    const sameCo = await run(userId, initech.jobId, [q("why", WHY, "textarea")]);
    expect(sameCo.sources.why).toBe("bank");
    expect(provider.calls).toHaveLength(1);
    // Another company: drafted again from that job.
    const other = await run(userId, globex.jobId, [q("why", WHY, "textarea")]);
    expect(other.sources.why).toBe("model");
    expect(provider.calls).toHaveLength(2);
  });

  it("rejects a draft that invents a number, or that the model says it cannot support", async () => {
    const { userId } = await seedUser(t.db, "ungrounded");
    const { jobId } = await seedJob(t.db, "ungrounded");
    scripted(() => ({ answerable: true, answer: "I managed 400 engineers across three continents while shipping payment APIs at Acme." }));
    const bad = await run(userId, jobId, [q("a", "Describe your leadership experience", "textarea")]);
    expect(bad.answers).toEqual({});
    expect(bad.pending.map((p) => p.id)).toEqual(["a"]);
    scripted(() => ({ answerable: false, answer: "" }));
    const none = await run(userId, jobId, [q("b", "Describe your experience with quantum computing", "textarea")]);
    expect(none.pending.map((p) => p.id)).toEqual(["b"]);
    expect(await bankFor(userId)).toEqual([]);
  });

  it("only drafts open-ended text, never short facts, people's details or choices", async () => {
    const { userId } = await seedUser(t.db, "notopen");
    const { jobId } = await seedJob(t.db, "notopen");
    const provider = scripted(() => ({ answerable: true, answer: "Something confident and made up." }));
    const r = await run(userId, jobId, [
      q("employer", "Current employer"),
      q("refs", "Please describe your references", "textarea"),
      q("ssn", "Social security number"),
      q("choice", "Why did you apply?", "select", ["Pay", "Location"]),
      q("referrer", "Who referred you?"),
    ]);
    expect(provider.calls).toHaveLength(0);
    expect(r.pending.map((p) => p.id)).toEqual(["employer", "refs", "ssn", "choice", "referrer"]);
  });

  it("caps the drafts per call and leaves the rest pending", async () => {
    const { userId } = await seedUser(t.db, "cap");
    const { jobId } = await seedJob(t.db, "cap");
    const provider = scripted(() => ({ answerable: true, answer: "I built payment APIs in TypeScript at Acme." }));
    const questions = Array.from({ length: 4 }, (_, i) => q(`q${i}`, `Describe the part of project number ${i} that mattered most`, "textarea"));
    const r = await answerQuestions(t.db, { userId, jobId, questions, maxDrafts: 2 });
    expect(provider.calls).toHaveLength(2);
    expect(Object.keys(r.answers)).toEqual(["q0", "q1"]);
    expect(r.pending.map((p) => p.id)).toEqual(["q2", "q3"]);
  });

  it("survives the model failing: the question stays pending", async () => {
    const { userId } = await seedUser(t.db, "fail");
    const { jobId } = await seedJob(t.db, "fail");
    setProvider(createFakeProvider({ chat: () => { throw new Error("model down"); } }));
    const r = await run(userId, jobId, [q("a", "Why do you want this job?", "textarea")]);
    expect(r.pending.map((p) => p.id)).toEqual(["a"]);
  });
});

describe("pendingDigest", () => {
  it("groups the same question across applications by meaning, so one message can block-count them", async () => {
    const { userId } = await seedUser(t.db, "digest");
    const K = "Do you have experience with Kubernetes in production?";
    const jobs = await Promise.all(["A", "B", "C", "D", "E", "F"].map((c) => seedJob(t.db, "digest", `Co${c}`)));
    const a1 = await addApplication(t.db, userId, jobs[0]!.jobId, [q("1", K), q("2", "Are you willing to relocate?")]);
    const a2 = await addApplication(t.db, userId, jobs[1]!.jobId, [q("9", K)]);
    const a3 = await addApplication(t.db, userId, jobs[2]!.jobId, [q("x", "Do you have experience with Kubernetes in production environments?")]);
    const a4 = await addApplication(t.db, userId, jobs[3]!.jobId, [q("y", "Do you have experience with Docker in production?"), q("z", "Are you willing to relocate?")]);
    await addApplication(t.db, userId, jobs[4]!.jobId, [q("done", K)], "submitted");
    await addApplication(t.db, userId, jobs[5]!.jobId, []);

    const d = await pendingDigest(t.db, userId);
    expect(d.groups.map((g) => [g.question, g.applicationIds.length])).toEqual([
      [K, 3],
      ["Are you willing to relocate?", 2],
      ["Do you have experience with Docker in production?", 1],
    ]);
    const k = d.groups[0]!;
    expect(k.variants).toEqual(["Do you have experience with Kubernetes in production environments?"]);
    expect([...k.applicationIds].sort()).toEqual([a1, a2, a3].sort());
    expect(k.questions).toHaveLength(3);
    expect(k.questions.find((x) => x.applicationId === a3)!.questionId).toBe("x");
    expect(k.examples.length).toBeGreaterThan(0);
    expect(d.blockedApplications).toBe(4);
    expect([a1, a2, a3, a4].every((id) => d.groups.some((g) => g.applicationIds.includes(id)))).toBe(true);
    expect(d.summary).toBe("3 questions block 4 applications");
  });

  it("is empty when nothing waits, and scoped to the user", async () => {
    const lonely = await seedUser(t.db, "digest-empty");
    const other = await seedUser(t.db, "digest-other");
    const { jobId } = await seedJob(t.db, "digest-empty");
    await addApplication(t.db, other.userId, jobId, [q("1", "Are you willing to relocate?")]);
    const d = await pendingDigest(t.db, lonely.userId);
    expect(d).toEqual({ groups: [], blockedApplications: 0, summary: "No questions are waiting on you" });
  });
});
