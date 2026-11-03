import { afterAll, describe, expect, it } from "vitest";
import { closeSharedBrowser, chromiumInstalled } from "./browser.js";
import { countPdfPages, dropOrder, fitToPages, renderResumePdf, withoutBullets, type Measure } from "./pdf.js";
import { renderResumeHtml } from "./template.js";
import type { Density, ResumeBullet, ResumeContent } from "./types.js";

const bullet = (id: string, weight: number, text = `Built the ${id} service and shipped it to production for the team`): ResumeBullet => ({ id, text, careerPointIds: [id], weight });
function content(): ResumeContent {
  return {
    name: "Ada Lovelace", contact: { email: "ada@example.test", phone: "+1 555 0100" },
    summary: "Backend engineer with five years of experience building TypeScript services.",
    experience: [
      { careerPointId: "r1", title: "Backend Engineer", company: "Acme", start: "2021-03", bullets: [bullet("a1", 3), bullet("a2", 2), bullet("a3", 1), bullet("a4", 0.5)] },
      { careerPointId: "r2", title: "Intern", company: "Globex", start: "2020-06", end: "2020-09", bullets: [bullet("g1", 1), bullet("g2", 0.2)] },
    ],
    education: [{ careerPointId: "e", school: "State University", degree: "BS Computer Science", start: "2017", end: "2021" }],
    skills: [{ group: "Core", items: ["TypeScript", "PostgreSQL"] }],
    projects: [{ careerPointId: "p1", name: "Pocket Router", bullets: [bullet("p1a", 0.1), bullet("p1b", 0.1)] }],
  };
}
const ids = (c: ResumeContent) => [...c.experience.flatMap((r) => r.bullets), ...c.projects.flatMap((p) => p.bullets)].map((b) => b.id);

/** Pages = ceil(bullets / capacity), capacity grows slightly as the type tightens. Records every call. */
function fakeMeasure(capacity: number) {
  const calls: { density: Density; bullets: number }[] = [];
  const measure: Measure = async (c, density) => {
    const bullets = ids(c).length;
    calls.push({ density, bullets });
    const cap = capacity * (density === "normal" ? 1 : density === "compact" ? 1.2 : 1.5);
    return { pages: Math.max(1, Math.ceil(bullets / cap)), pdf: Buffer.from(`pdf:${density}:${bullets}`) };
  };
  return { measure, calls };
}

describe("dropOrder", () => {
  it("lists the lowest-weight bullets first, keeps each role's best bullet, and lets projects go entirely", () => {
    const order = dropOrder(content()).map((b) => b.id);
    expect(order).not.toContain("a1");
    expect(order).not.toContain("g1");
    expect(order.slice(0, 3).sort()).toEqual(["p1a", "p1b", "g2"].sort());
    expect(order.indexOf("a4")).toBeLessThan(order.indexOf("a3"));
    expect(order.indexOf("a3")).toBeLessThan(order.indexOf("a2"));
  });

  it("removes a project once all its bullets are cut", () => {
    const c = withoutBullets(content(), new Set(["p1a", "p1b"]));
    expect(c.projects).toEqual([]);
    expect(ids(c)).toEqual(["a1", "a2", "a3", "a4", "g1", "g2"]);
  });
});

describe("fitToPages", () => {
  it("renders once when the resume already fits", async () => {
    const { measure, calls } = fakeMeasure(20);
    const fit = await fitToPages(content(), measure);
    expect(fit.density).toBe("normal");
    expect(fit.dropped).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("tightens the type before cutting anything", async () => {
    const { measure } = fakeMeasure(7); // 8 bullets: 2 pages normal (7), 1 page compact (8.4)
    const fit = await fitToPages(content(), measure);
    expect(fit.density).toBe("compact");
    expect(fit.dropped).toEqual([]);
    expect(fit.pages).toBe(1);
  });

  it("cuts the fewest lowest-weight bullets that reach one page, with a logarithmic number of renders", async () => {
    const { measure } = fakeMeasure(5); // compact capacity 6: 8 bullets need two cut
    const fit = await fitToPages(content(), measure);
    expect(fit.pages).toBe(1);
    expect(fit.dropped).toHaveLength(2);
    expect(fit.dropped.map((b) => b.id).sort()).toEqual(["p1a", "p1b"]);
    expect(ids(fit.content)).toEqual(["a1", "a2", "a3", "a4", "g1", "g2"]);
    expect(fit.renders).toBeLessThanOrEqual(7);
    expect(fit.pdf.toString()).toBe("pdf:compact:6");
  });

  it("never cuts a role's best bullet and reports the truth when it still does not fit", async () => {
    const { measure } = fakeMeasure(1); // absurdly small page: even the floor (a1, g1) is 2 bullets at capacity 1.5
    const fit = await fitToPages(content(), measure);
    expect(ids(fit.content)).toEqual(["a1", "g1"]);
    expect(fit.pages).toBe(2);
    expect(fit.density).toBe("tight");
  });

  it("falls back to tighter type with the cuts when compact is not enough", async () => {
    const { measure } = fakeMeasure(1.5); // the floor of two bullets needs 1.8 at compact (too small) but fits in 2.25 at tight
    const fit = await fitToPages(content(), measure);
    expect(fit.pages).toBe(1);
    expect(fit.density).toBe("tight");
    expect(ids(fit.content)).toEqual(["a1", "g1"]);
  });
});

describe("countPdfPages", () => {
  it("counts page objects, not the page tree", () => {
    expect(countPdfPages(Buffer.from("<< /Type /Page >> << /Type /Page >> << /Type /Pages /Count 2 >>"))).toBe(2);
    expect(countPdfPages(Buffer.from("<< /Type /Pages /Count 3 >>"))).toBe(3);
  });
});

describe("renderResumeHtml", () => {
  it("is a single-column document with standard headings, no tables or images, and escaped text", () => {
    const c = content();
    c.experience[0]!.bullets[0]!.text = "Cut <script> costs & shipped";
    const html = renderResumeHtml(c);
    expect([...html.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1])).toEqual(["Summary", "Skills", "Experience", "Education", "Projects"]);
    expect(html).not.toMatch(/<table|<img|<svg/i);
    expect(html).toContain("Cut &lt;script&gt; costs &amp; shipped");
    expect(html).toContain("Mar 2021 – Present");
  });
});

describe("renderResumePdf with a real browser", () => {
  afterAll(() => closeSharedBrowser());

  it.skipIf(!chromiumInstalled())("renders a one-page PDF and trims a long resume down to one page", async () => {
    const long = content();
    long.experience[0]!.bullets = Array.from({ length: 26 }, (_, i) => bullet(`x${i}`, 20 - i, `Built service number ${i} for the platform team and shipped it to production with tests and monitoring in place`));
    long.experience[1]!.bullets = Array.from({ length: 26 }, (_, i) => bullet(`y${i}`, 10 - i * 0.1, `Maintained component ${i} for the support dashboards and fixed the long tail of reported defects over time`));
    const out = await renderResumePdf(long, { template: "ats", font: "tinos", size: "letter" });
    expect(out.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(out.pages).toBe(1);
    expect(countPdfPages(out.pdf)).toBe(1);
    expect(out.dropped.length).toBeGreaterThan(0);
    // The best bullet of each role survived.
    expect(ids(out.content)).toContain("x0");
    expect(ids(out.content)).toContain("y0");
    const small = await renderResumePdf(content(), { size: "a4", font: "inter" });
    expect(small.pages).toBe(1);
    expect(small.dropped).toEqual([]);
  }, 90_000);
});

describe("fitToPages tight type before cuts", () => {
  it("uses tight type rather than cutting a bullet when tight is enough", async () => {
    const { measure } = fakeMeasure(6); // 8 bullets: 2 pages normal (6), 2 compact (7.2), 1 tight (9)
    const fit = await fitToPages(content(), measure);
    expect(fit.density).toBe("tight");
    expect(fit.dropped).toEqual([]);
    expect(fit.pages).toBe(1);
  });
});
