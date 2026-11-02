import type { Metadata } from "next";
import { api } from "@/lib/api";
import { CareerGraph, GraphInputs } from "@/components/GraphView";
import { Notice, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Career graph" };

export default async function GraphPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const node = Array.isArray(sp.node) ? sp.node[0] : sp.node;
  const graph = await api.graph().catch(() => null);
  const facts = graph?.nodes.filter((n) => n.type !== "person").length ?? 0;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Career graph"
        subtitle={graph ? `${facts} fact${facts === 1 ? "" : "s"}. Every resume line and every answer Norinote writes traces back to one of these.` : undefined}
      />
      <GraphInputs />
      {graph ? <CareerGraph key={node ?? "none"} graph={graph} focus={node} /> : <Notice tone="red">Cannot load your graph right now. Try again in a moment.</Notice>}
    </div>
  );
}
