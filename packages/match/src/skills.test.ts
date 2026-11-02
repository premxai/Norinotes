import { describe, expect, it } from "vitest";
import { buildSkillMap, canonicalSkill, canonicalSkills, findSkillsInText, parseSkillTable, skillRelation } from "./skills.js";

describe("canonical skills", () => {
  it("maps synonyms to one lower-case key and keeps unknown skills as written", () => {
    expect(canonicalSkill("k8s")).toBe("kubernetes");
    expect(canonicalSkill("Postgres")).toBe("postgresql");
    expect(canonicalSkill("Node JS")).toBe("node.js");
    expect(canonicalSkill("Brand New Tool")).toBe("brand new tool");
    expect(canonicalSkills(["JS", "javascript", "  ", "k8s", "Kubernetes"])).toEqual(["javascript", "kubernetes"]);
  });

  it("finds skills in prose without firing on ordinary words", () => {
    expect(findSkillsInText("We use Python, Postgres and k8s on AWS. Go to market fast and excel at teamwork.")).toEqual(["python", "postgresql", "kubernetes", "aws"]);
    expect(findSkillsInText("5+ years of Node.js and C++ experience")).toEqual(["node.js", "c++"]);
  });

  it("accepts a caller's own map", () => {
    const map = buildSkillMap(parseSkillTable("Zig | Programming Languages | ziglang\nOdin | Programming Languages |"));
    expect(canonicalSkill("ziglang", map)).toBe("zig");
    expect(findSkillsInText("We write ziglang", map)).toEqual(["zig"]);
    expect(skillRelation("zig", "odin", map)).toBe(0.25);
  });
});

describe("skillRelation", () => {
  it("scores the same skill, a specific kind, a sibling, and the broader field", () => {
    expect(skillRelation("sql", "sql")).toBe(1);
    expect(skillRelation("sql", "postgresql")).toBe(0.75);
    expect(skillRelation("postgresql", "mysql")).toBe(0.5);
    expect(skillRelation("react", "javascript")).toBe(0.4);
    expect(skillRelation("python", "java")).toBe(0.25);
    expect(skillRelation("python", "figma")).toBe(0);
  });
});
