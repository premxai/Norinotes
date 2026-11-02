import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { api, ApiError, USE_MOCK } from "@/lib/api";
import { ApplicationReview } from "@/components/ApplicationReview";

export const metadata: Metadata = { title: "Review" };

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, graph, status] = await Promise.all([
    api.getApplication(id).catch((e: unknown) => { if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound(); throw e; }),
    api.graph().catch(() => ({ nodes: [], edges: [] })),
    api.agentStatus().catch(() => null),
  ]);
  const nodes = Object.fromEntries(graph.nodes.map((n) => [n.id, { label: n.label, type: n.type, quote: n.sourceQuote ?? null }]));
  // Demo mode never sends; an API that does not report it is treated as live so the button never under-states.
  const liveSubmit = !USE_MOCK && status?.liveSubmit !== false;
  return <ApplicationReview key={detail.application.id} initial={detail} nodes={nodes} liveSubmit={liveSubmit} />;
}
