import type { Metadata } from "next";
import { api } from "@/lib/api";
import { InboxView } from "@/components/InboxView";
import { Notice, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  const [messages, apps] = await Promise.all([api.listInbox().catch(() => null), api.listApplications().catch(() => [])]);
  const appTitles = Object.fromEntries(apps.map((a) => [a.application.id, `${a.job.title} at ${a.job.companyName}`]));
  const sorted = (messages ?? []).slice().sort((a, b) => +new Date(b.receivedAt) - +new Date(a.receivedAt));
  return (
    <div>
      <PageHeader title="Inbox" subtitle="Mail sent to your Norinote address: codes, confirmations and replies, each linked to its application." />
      {messages === null ? <Notice tone="red">Cannot load your inbox right now. Try again in a moment.</Notice> : <InboxView initial={sorted} appTitles={appTitles} />}
    </div>
  );
}
