import type { Metadata } from "next";
import { CareerGraphPage } from "@/components/app/you/Graph";
import { GraphFrame } from "@/components/app/you/YouTabs";

export const metadata: Metadata = { title: "Career graph", robots: { index: false, follow: false } };

/** The career graph, its own section in v2 (dashboard v2 plan, section 7): only the graph and Add a fact. */
export default function Page() {
  return (
    <GraphFrame>
      <CareerGraphPage />
    </GraphFrame>
  );
}
