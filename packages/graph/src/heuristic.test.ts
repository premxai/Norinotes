import { describe, expect, it } from "vitest";
import { heuristicPoints } from "./heuristic.js";
import { SAMPLE_RESUME } from "./testkit.js";
import { extractMetrics, extractScope, normalizeDate, sectionOf } from "./text.js";

describe("heuristicPoints", () => {
  const points = heuristicPoints(SAMPLE_RESUME);
  const find = (kind: string, title: string) => points.find((p) => p.kind === kind && p.title.startsWith(title));

  it("finds roles with organisation, dates, skills, scope and metrics", () => {
    const role = find("role", "Senior Software Engineer")!;
    expect(role).toMatchObject({ org: "Acme Cloud", startDate: "2021-01", endDate: null, sourceQuote: "Senior Software Engineer | Acme Cloud | Jan 2021 - Present" });
    expect(role.skills).toEqual(expect.arrayContaining(["Kubernetes", "Kafka", "Microservices"]));
    expect(role.scope).toMatchObject({ teamSize: 5, users: 2_000_000 });
    expect(role.metrics.map((m) => m.unit)).toContain("%");
    expect(find("role", "Software Engineer")).toMatchObject({ org: "Beta Labs", startDate: "2018-06", endDate: "2020-12" });
  });

  it("makes an achievement of each bullet that carries a number, quoting the bullet", () => {
    const a = points.filter((p) => p.kind === "achievement");
    expect(a.map((p) => p.sourceQuote)).toEqual(expect.arrayContaining(["• Reduced cloud spend by $120K per year"]));
    expect(a.find((p) => p.text.startsWith("Reduced"))!.metrics[0]).toMatchObject({ value: 120_000, unit: "USD" });
  });

  it("reads projects, education and skill lists", () => {
    expect(find("project", "Resume Graph")).toMatchObject({ startDate: "2023", skills: ["TypeScript", "PostgreSQL"] });
    expect(find("education", "B.S. Computer Science")).toMatchObject({ org: "State University", startDate: "2014", endDate: "2018" });
    expect(find("skill", "Languages")!.skills).toEqual(["Python", "TypeScript", "Go", "JavaScript"]);
    expect(find("skill", "Infrastructure")!.skills).toEqual(["Kubernetes", "Docker", "Terraform", "AWS"]);
  });

  it("recovers points from a resume with prose descriptions and a different header style", () => {
    const p = heuristicPoints(`Work History\nData Analyst at Globex Corporation (March 2019 to August 2021)\nBuilt weekly dashboards in Tableau and SQL that executives used to track revenue across 14 regions every Monday morning.\n\nTechnical Skills\nSQL, Tableau, Excel`);
    expect(p[0]).toMatchObject({ kind: "role", title: "Data Analyst", org: "Globex Corporation", startDate: "2019-03", endDate: "2021-08" });
    expect(p[0]!.skills).toEqual(expect.arrayContaining(["Tableau", "SQL"]));
    expect(p.at(-1)).toMatchObject({ kind: "skill", skills: ["SQL", "Tableau", "Excel"] });
  });

  it("returns nothing for text with no structure at all", () => {
    expect(heuristicPoints("hello world")).toEqual([]);
  });
});

describe("text helpers", () => {
  it("normalises dates", () => {
    expect(normalizeDate("Jan 2022")).toBe("2022-01");
    expect(normalizeDate("September, 2019")).toBe("2019-09");
    expect(normalizeDate("03/2020")).toBe("2020-03");
    expect(normalizeDate("2021-7")).toBe("2021-07");
    expect(normalizeDate("2018")).toBe("2018");
    expect(normalizeDate("Present")).toBeNull();
    expect(normalizeDate("sometime")).toBeNull();
  });

  it("recognises section headings, including spaced-out ones", () => {
    expect(sectionOf("PROFESSIONAL EXPERIENCE")).toBe("experience");
    expect(sectionOf("S K I L L S")).toBe("skills");
    expect(sectionOf("Education:")).toBe("education");
    expect(sectionOf("Led a team of 5 engineers")).toBeNull();
  });

  it("extracts metrics and scope from a line", () => {
    expect(extractMetrics("Grew ARR 3x to $4.5M and cut churn 12%").map((m) => [m.value, m.unit])).toEqual([[12, "%"], [4_500_000, "USD"], [3, "x"]]);
    expect(extractScope("Managed a team of 8 designers with a $2M budget for 50K users")).toEqual({ teamSize: 8, users: 50_000, budget: "$2M" });
  });
});
