import { describe, expect, it } from "vitest";
import type { CareerPoint } from "@norinote/shared";
import { buildGraphView, skillNodeId } from "./graph-view.js";

const point = (o: Partial<CareerPoint> & Pick<CareerPoint, "id" | "kind" | "title">): CareerPoint => ({
  org: null, startDate: null, endDate: null, text: "", skills: [], scope: {}, metrics: {}, sourceQuote: null, source: "resume", ...o,
});

describe("buildGraphView", () => {
  it("shows certification points as their own nodes, linked to their skills", () => {
    const rn = point({
      id: "c1", kind: "certification", title: "Registered Nurse (RN), Minnesota", org: "Minnesota Board of Nursing",
      startDate: "2020-06", endDate: "2027-06", skills: ["RN"], sourceQuote: "Registered Nurse, Minnesota, exp. 06/2027",
    });
    const role = point({ id: "r1", kind: "role", title: "Staff Nurse", org: "General Hospital", startDate: "2020-01", skills: ["patient care"] });
    const { nodes, edges } = buildGraphView([role, rn], []);

    const node = nodes.find((n) => n.id === "c1")!;
    expect(node.type).toBe("certification");
    expect(node.label).toBe("Registered Nurse (RN), Minnesota");
    expect(node.props).toMatchObject({ title: "Registered Nurse (RN), Minnesota", org: "Minnesota Board of Nursing", skills: ["RN"] });
    expect(node).toMatchObject({ startDate: "2020-06", endDate: "2027-06", source: "your resume", sourceQuote: "Registered Nurse, Minnesota, exp. 06/2027" });
    expect(edges).toContainEqual({ id: `c1>${skillNodeId("RN")}`, src: "c1", dst: skillNodeId("RN"), type: "used" });
    expect(nodes.some((n) => n.type === "skill" && n.label === "rn")).toBe(true);
    expect(nodes.find((n) => n.id === "r1")!.type).toBe("role");
  });
});
