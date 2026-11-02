import { describe, expect, it } from "vitest";
import { canonicalSkill, findSkills, isUnder, normalizeSkills, skillParents } from "./skills.js";

describe("canonical skills", () => {
  it.each([
    ["k8s", "Kubernetes"], ["JS", "JavaScript"], ["js", "JavaScript"], ["Postgres", "PostgreSQL"], ["golang", "Go"],
    ["node", null], ["Node.js", "Node.js"], ["react.js", "React"], ["GCP", "Google Cloud"], ["TS", "TypeScript"],
  ])("%s -> %s", (raw, canonical) => {
    expect(canonicalSkill(raw)).toBe(canonical);
  });

  it("normalises a list: canonical names, unknown skills kept, duplicates dropped, order kept", () => {
    expect(normalizeSkills(["k8s", " Kubernetes ", "JS", "Rust", "Obscure Tool", "obscure tool", ""])).toEqual(["Kubernetes", "JavaScript", "Rust", "Obscure Tool"]);
  });

  it("knows the groups a skill sits under", () => {
    expect(skillParents("Kubernetes")).toEqual(["Container Orchestration", "DevOps"]);
    expect(skillParents("k8s")).toEqual(["Container Orchestration", "DevOps"]);
    expect(skillParents("RAG")).toEqual(["LLMs", "Artificial Intelligence"]);
    expect(isUnder("Helm", "Container Orchestration")).toBe(true);
    expect(isUnder("Kubernetes", "Kubernetes")).toBe(true);
    expect(isUnder("Python", "DevOps")).toBe(false);
  });

  it("finds skills in prose without firing on ordinary words", () => {
    expect(findSkills("Migrated 40 services to k8s and wrote Terraform; the team went on a spark of inspiration. Take the express lane.")).toEqual(["Kubernetes", "Terraform"]);
    expect(findSkills("Used C++ and C# with .NET, plus Node.js and React Native")).toEqual(["C++", "C#", ".NET", "Node.js", "React Native"]);
  });

  it("accepts short ambiguous tokens only in a skills list", () => {
    expect(findSkills("Languages: Python, Go, JS, R", { list: true })).toEqual(["Python", "Go", "JavaScript", "R"]);
    expect(findSkills("We need to go and R&D things")).toEqual([]);
  });
});
