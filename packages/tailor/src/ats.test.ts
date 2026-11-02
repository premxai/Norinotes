import { describe, expect, it } from "vitest";
import { atsChecks, postingKeywords } from "./ats.js";
import { renderResumeHtml } from "./template.js";
import { SPEC } from "./test-fixtures.js";
import type { ResumeBullet, ResumeContent } from "./types.js";

const b = (id: string, text: string): ResumeBullet => ({ id, text, careerPointIds: [id], weight: 1 });
function good(): ResumeContent {
  return {
    name: "Ada Lovelace", contact: { email: "ada@example.test", phone: "+1 555 0100" },
    summary: "Backend engineer building TypeScript services on PostgreSQL for five years.",
    experience: [{ careerPointId: "r", title: "Backend Engineer", company: "Acme", start: "2021-03", bullets: [
      b("1", "Built REST APIs in TypeScript serving 2M requests per day for the billing team"),
      b("2", "Migrated the billing service to PostgreSQL, cutting query time by 40% overall"),
    ] }],
    education: [{ careerPointId: "e", school: "State University", degree: "BS Computer Science", start: "2017", end: "2021" }],
    skills: [{ group: "Core", items: ["TypeScript", "PostgreSQL"] }],
    projects: [],
  };
}
const run = (c: ResumeContent, pages = 1) => atsChecks(c, renderResumeHtml(c), SPEC, pages);
const failed = (c: ResumeContent, pages = 1) => run(c, pages).checks.filter((x) => !x.pass).map((x) => x.id);

describe("atsChecks", () => {
  it("passes a clean one-page resume and reports keyword coverage of the required skills", () => {
    const r = run(good());
    expect(failed(good())).toEqual([]);
    expect(r.score).toBe(100);
    expect(r.keywordCoverage).toBe(100);
    expect(r.checks.find((x) => x.id === "keywords")!.detail).toMatch(/2\/2 \(100%\)/);
  });

  it("flags low keyword coverage with the missing terms", () => {
    const c = good();
    c.skills = [];
    c.summary = undefined;
    c.experience[0]!.bullets = [b("1", "Maintained the billing dashboards and answered support tickets from customers daily")];
    const r = run(c);
    expect(r.keywordCoverage).toBe(0);
    const k = r.checks.find((x) => x.id === "keywords")!;
    expect(k.pass).toBe(false);
    expect(k.detail).toMatch(/missing TypeScript, PostgreSQL/);
  });

  it("checks the one-page rule against the real page count", () => {
    expect(failed(good(), 2)).toEqual(["one_page"]);
  });

  it("flags unparseable or missing dates, short bullets, pronouns and odd characters", () => {
    const c = good();
    c.experience[0]!.start = "sometime in spring";
    expect(failed(c)).toContain("dates");
    const d = good();
    d.experience[0]!.bullets[0]!.text = "Built things";
    expect(failed(d)).toContain("bullet_length");
    const p = good();
    p.summary = "I build backend services in TypeScript with PostgreSQL daily.";
    expect(failed(p)).toContain("pronouns");
    const u = good();
    u.experience[0]!.bullets[0]!.text = "Built REST APIs \u{1F680} in TypeScript serving 2M requests per day for billing";
    expect(failed(u)).toContain("characters");
  });

  it("flags tables, images and non-standard headings in the document", () => {
    const c = good();
    const html = renderResumeHtml(c).replace("<h2>Skills</h2>", "<h2>My Superpowers</h2><table><tr><td>x</td></tr></table><img src=\"x.png\">");
    const r = atsChecks(c, html, SPEC, 1);
    const ids = r.checks.filter((x) => !x.pass).map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(["headings", "layout"]));
    expect(r.checks.find((x) => x.id === "layout")!.detail).toMatch(/table.*image/);
  });

  it("flags missing contact details", () => {
    const c = good();
    c.contact = {};
    expect(failed(c)).toContain("contact");
  });

  it("derives keywords from required skills, else all skills, else short must-haves", () => {
    expect(postingKeywords(SPEC)).toEqual(["TypeScript", "PostgreSQL"]);
    expect(postingKeywords({ ...SPEC, skills: SPEC.skills.map((s) => ({ ...s, required: false })) })).toHaveLength(5);
    expect(postingKeywords({ ...SPEC, skills: [], mustHaves: ["Python", "a very long phrase about many things"] })).toEqual(["Python"]);
    expect(postingKeywords(null)).toEqual([]);
  });
});
