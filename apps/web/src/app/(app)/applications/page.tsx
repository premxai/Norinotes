import type { Metadata } from "next";
import { api } from "@/lib/api";
import { ApplicationsView } from "@/components/ApplicationsView";
import { Notice, PageHeader } from "@/components/ui";
import { NEEDS_YOU } from "@/lib/format";

export const metadata: Metadata = { title: "Applications" };

export default async function ApplicationsPage() {
  const items = await api.listApplications().catch(() => null);
  const needs = items?.filter((i) => NEEDS_YOU.includes(i.application.status)).length ?? 0;
  return (
    <div>
      <PageHeader
        title="Applications"
        subtitle={items === null ? undefined : needs > 0 ? `${needs} waiting on you. Everything else is in progress or settled.` : "Everything in flight and everything settled, in one place."}
      />
      {items === null ? <Notice tone="red">Cannot load applications right now. Try again in a moment.</Notice> : <ApplicationsView items={items} />}
    </div>
  );
}
