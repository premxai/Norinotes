import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createFakeProvider, setProvider, type ChatRequest } from "@norinote/ai";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { inboxAddresses } from "@norinote/db";
import { classifySlot, planForm, saveAnswer, slotValue, careerFacts, factsFrom, ungroundedTokens, unsupportedSentences, type PlanField, type SlotField } from "./index.js";
import { seedJob, seedUser } from "./test-fixtures.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());
afterEach(() => setProvider(null));

const f = (key: string, label: string, type: SlotField["type"] = "text", options: string[] = [], required = true, extra: Partial<SlotField> = {}): PlanField =>
  ({ key, label, type, options, required, ...extra });

describe("classifySlot: deterministic, from name, id, autocomplete and label", () => {
  it("knows the stable keys of Greenhouse, Lever and Ashby", () => {
    expect(classifySlot(f("first_name", "First Name"))).toBe("first_name");
    expect(classifySlot(f("question_1", "LinkedIn Profile"))).toBe("linkedin");
    expect(classifySlot(f("urls[GitHub]", "Github URL"))).toBe("github");
    expect(classifySlot(f("org", "Current company"))).toBe("current_company");
    expect(classifySlot(f("eeo[veteran]", "Veteran status", "select", ["I am a veteran", "Decline to self-identify"]))).toBe("eeo_veteran");
    expect(classifySlot(f("_systemfield_name", "Legal Name"))).toBe("full_name");
    expect(classifySlot(f("x1", "Your answer", "text", [], true, { autocomplete: "family-name" }))).toBe("last_name");
    expect(classifySlot(f("gdpr_demographic_data_consent_given", "By checking this box ...", "checkbox"))).toBe("consent");
  });

  it("separates legal, EEO and look-alike questions", () => {
    expect(classifySlot(f("q", "Will you now or in the future require sponorship to work here?", "select", ["Yes", "No"]))).toBe("sponsorship");
    expect(classifySlot(f("q", "If yes, what type of sponsorship?"))).toBe("custom");
    expect(classifySlot(f("q", "Have you previously worked at or consulted for GitLab?", "select", ["Yes", "No"]))).toBe("custom");
    expect(classifySlot(f("q", "How are you using AI today in your current role?", "textarea"))).toBe("custom");
    expect(classifySlot(f("q", "Are you currently based in or willing to relocate to the Bay Area?", "select", ["Yes", "No"]))).toBe("relocation");
    expect(classifySlot(f("q", "If not, tell us a bit more about your location or relocation plans", "textarea"))).toBe("custom");
    expect(classifySlot(f("q", "Gender identity (optional)", "select", ["Man", "Woman"]))).toBe("eeo_gender");
    expect(classifySlot(f("q", "Are you a Singapore citizen?", "select", ["Yes", "No"]))).toBe("work_auth");
    expect(classifySlot(f("q", "Please indicate whether you are a citizen or resident of any of the following countries", "select", ["Yes", "No"]))).toBe("custom");
  });
});

describe("slotValue: profile only, never a guess", () => {
  const facts = factsFrom({ contact: { name: "Ada Lovelace", phone: "+1 555 0100", country: "United States" }, location: "Austin, TX", workAuth: { US: { authorized: true, needsSponsorship: false } }, eeo: {}, preferences: {} }, "ada@example.test");
  const career = careerFacts([{ id: "1", kind: "role", title: "Backend Engineer", org: "Acme", startDate: "2021-03", endDate: null, text: "", skills: [], scope: {}, metrics: {}, sourceQuote: null }]);
  const ctx = { jobCountry: "US" };

  it("values contact, career and legal slots from the profile and maps choices to offered options", () => {
    expect(slotValue("full_name", f("name", "Full name"), facts, career, ctx)).toMatchObject({ status: "ready", value: "Ada Lovelace" });
    expect(slotValue("current_company", f("org", "Current company"), facts, career, ctx)).toMatchObject({ status: "ready", value: "Acme" });
    expect(slotValue("work_auth", f("q", "Are you legally authorized to work in the United States?", "select", ["Yes", "No"]), facts, career, ctx)).toMatchObject({ status: "ready", value: "Yes" });
    expect(slotValue("sponsorship", f("q", "Do you require visa sponsorship?", "select", ["Yes", "No"]), facts, career, ctx)).toMatchObject({ status: "ready", value: "No" });
  });

  it("makes legal questions the profile cannot answer pending, and declines EEO when the profile has no choice", () => {
    expect(slotValue("salary", f("q", "What are your compensation expectations?"), facts, career, ctx)).toMatchObject({ status: "pending" });
    expect(slotValue("relocation", f("q", "Are you open to relocation?", "select", ["Yes", "No"]), facts, career, ctx)).toMatchObject({ status: "pending" });
    const willing = { ...facts, preferences: { ...facts.preferences, willingToRelocate: false } };
    expect(slotValue("relocation", f("q", "Do you require relocation to work in a hybrid schedule in our SF office?", "select", ["Yes", "No"]), willing, career, ctx)).toMatchObject({ status: "pending" });
    expect(slotValue("consent", f("gdpr", "I consent to the processing of my data", "checkbox"), facts, career, ctx)).toMatchObject({ status: "pending" });
    expect(slotValue("criminal", f("q", "Have you been convicted of a felony?", "select", ["Yes", "No"], false), facts, career, ctx)).toMatchObject({ status: "skip" });
    expect(slotValue("eeo_gender", f("q", "Gender", "select", ["Male", "Female", "I don't wish to answer"]), facts, career, ctx))
      .toEqual({ status: "ready", value: "I don't wish to answer", source: "decline" });
  });
});

describe("grounding checks", () => {
  it("flags numbers, names and tools the facts do not contain", () => {
    const corpus = "Built payment APIs in TypeScript serving 2 million requests per day at Acme";
    expect(ungroundedTokens("I built payment APIs in TypeScript at Acme.", corpus)).toEqual([]);
    expect(ungroundedTokens("I built APIs in Kotlin serving 5 million requests.", corpus)).toEqual(expect.arrayContaining(["kotlin", "5"]));
  });

  it("rejects a sentence whose quote is not in the facts or whose story details are new", () => {
    const corpus = "Led the rebuild of the event ingestion pipeline in Go on AWS, cutting p95 latency from 900 ms to 120 ms.";
    expect(unsupportedSentences([{ text: "I led the rebuild of our event ingestion pipeline in Go on AWS.", support: "Led the rebuild of the event ingestion pipeline in Go on AWS" }], corpus, "Walk us through a project")).toEqual([]);
    expect(unsupportedSentences([{ text: "I found unindexed database queries causing intermittent slowdowns and fixed them.", support: "Led the rebuild of the event ingestion pipeline" }], corpus, "Tell us about a time")).toHaveLength(1);
    expect(unsupportedSentences([{ text: "I led the rebuild.", support: "a quote that is nowhere in the facts" }], corpus, "q")).toHaveLength(1);
  });
});

describe("planForm", () => {
  it("fills profile slots without a model, and leaves unknown required questions pending with field ids", async () => {
    const { userId } = await seedUser(t.db, "plan-nomodel");
    const { jobId } = await seedJob(t.db, "plan-nomodel");
    const provider = createFakeProvider();
    setProvider(provider);
    const plan = await planForm(t.db, { userId, jobId, noModel: true, fields: [
      f("first_name", "First Name"), f("email", "Email"), f("resume", "Resume/CV", "file"),
      f("question_1", "Are you legally authorized to work in the United States?", "select", ["Yes", "No"]),
      f("question_2", "Why do you want to work here?", "textarea"),
      f("question_3", "Favourite colour?", "text", [], false),
      f("4033064002", "Gender", "select", ["Male", "Female", "I don't wish to answer"], true, { section: "eeo" }),
    ] });
    expect(plan.answers).toEqual({
      "field:first_name": "Ada", "field:email": "plan-nomodel@example.test", "field:resume": "@resume",
      "field:question_1": "Yes", "field:4033064002": "I don't wish to answer",
    });
    expect(plan.pending.map((p) => p.id)).toEqual(["field:question_2"]);
    expect(plan.entries.find((e) => e.key === "question_3")).toMatchObject({ status: "skip" });
    expect(provider.calls).toHaveLength(0);
    expect(plan.usage).toMatchObject({ smallCalls: 0, largeCalls: 0 });
  });

  it("puts the owned inbox address in the email field once one is assigned (e2e run 1)", async () => {
    const { userId } = await seedUser(t.db, "plan-inbox", { contact: { name: "Ada Lovelace", email: "ada@own-mail.test" } });
    const { jobId } = await seedJob(t.db, "plan-inbox");
    const before = await planForm(t.db, { userId, jobId, noModel: true, fields: [f("email", "Email")] });
    expect(before.answers["field:email"]).toBe("ada@own-mail.test");
    await t.db.insert(inboxAddresses).values({ userId, address: "nori-k3x9q2mhd4@in.norinote.test" });
    const after = await planForm(t.db, { userId, jobId, noModel: true, fields: [f("email", "Email")] });
    expect(after.answers["field:email"]).toBe("nori-k3x9q2mhd4@in.norinote.test");
  });

  it("uses the person's earlier answers and the bank before any model", async () => {
    const { userId } = await seedUser(t.db, "plan-bank");
    const { jobId } = await seedJob(t.db, "plan-bank");
    await saveAnswer(t.db, userId, "How many years of TypeScript do you have?", "3", "user");
    const provider = createFakeProvider();
    setProvider(provider);
    const plan = await planForm(t.db, { userId, jobId, explicit: { "field:q2": "Blue" }, fields: [
      f("q1", "How many years of TypeScript do you have?"), f("q2", "Favourite colour?"),
    ] });
    expect(plan.entries.map((e) => [e.key, e.source, e.value])).toEqual([["q1", "bank", "3"], ["q2", "answers", "Blue"]]);
    expect(provider.calls).toHaveLength(0);
  });

  it("makes at most one small and one large call; unsure and ungrounded answers become pending; legal slots stay with the profile", async () => {
    const { userId } = await seedUser(t.db, "plan-model");
    const { jobId } = await seedJob(t.db, "plan-model");
    const requests: ChatRequest[] = [];
    setProvider(createFakeProvider({
      chat: (req) => {
        requests.push(req);
        if (req.jsonSchema?.name === "form_fields") {
          return { fields: [
            { key: "q1", slot: "custom", decision: "answer", options: ["Yes"], text: null, evidence: "Austin, TX" },
            { key: "q2", slot: "custom", decision: "unsure", options: [], text: null, evidence: null },
            { key: "q3", slot: "custom", decision: "answer", options: [], text: "I wrote Kubernetes operators at Initech", evidence: "made up" },
            { key: "q4", slot: "salary", decision: "answer", options: [], text: "200000", evidence: null },
          ] };
        }
        return { answers: [
          { key: "q5", answerable: true, sentences: [{ text: "I built payment APIs in TypeScript serving 2 million requests per day.", support: "Built payment APIs in TypeScript serving 2 million requests per day" }] },
          { key: "q6", answerable: true, sentences: [{ text: "I led a team of 40 at Google.", support: "Built payment APIs in TypeScript" }] },
        ] };
      },
    }));
    const plan = await planForm(t.db, { userId, jobId, fields: [
      f("q1", "Are you currently located in the US?", "select", ["Yes", "No"]),
      f("q2", "Have you ever interviewed with us before?", "select", ["Yes", "No"]),
      f("q3", "Which orchestration tools have you used?"),
      f("q4", "Pay you would accept"),
      f("q5", "Describe a project you are proud of.", "textarea"),
      f("q6", "Tell us about your leadership.", "textarea"),
    ] });
    expect(requests.filter((r) => r.jsonSchema?.name === "form_fields")).toHaveLength(1);
    expect(requests.filter((r) => r.jsonSchema?.name === "long_answers")).toHaveLength(1);
    const by = Object.fromEntries(plan.entries.map((e) => [e.key, e]));
    expect(by.q1).toMatchObject({ status: "ready", value: "Yes", source: "model" });
    expect(by.q2).toMatchObject({ status: "pending" });
    expect(by.q3).toMatchObject({ status: "pending" }); // Kubernetes and Initech are not in the facts
    expect(by.q4).toMatchObject({ status: "ready", slot: "salary", source: "profile", value: "150,000 USD per year" }); // never the model's number
    expect(by.q5).toMatchObject({ status: "ready", source: "large" });
    expect(by.q6).toMatchObject({ status: "pending" });
    expect(plan.learned["pay you would accept"]).toBe("salary");
    expect(plan.pending.map((p) => p.id).sort()).toEqual(["field:q2", "field:q3", "field:q6"]);
  });
});

describe("compound relocation questions", () => {
  it("never answers No to 'based in X or willing to relocate' from the relocation preference alone", () => {
    const facts = factsFrom({ contact: { name: "Ada Lovelace" }, location: "San Francisco, CA", workAuth: {}, eeo: {}, preferences: { willingToRelocate: false } }, "ada@example.test");
    const career = careerFacts([]);
    const q = f("q", "Are you currently based in or willing to relocate to the Bay Area for this position?", "select", ["Yes", "No"]);
    expect(slotValue("relocation", q, facts, career, { jobCountry: "US" })).toMatchObject({ status: "pending" });
    expect(slotValue("relocation", f("q", "Are you open to relocation?", "select", ["Yes", "No"]), facts, career, { jobCountry: "US" })).toMatchObject({ status: "ready", value: "No" });
  });
});
