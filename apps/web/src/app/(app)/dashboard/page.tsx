import type { Metadata } from "next";
import Link from "next/link";
import { api } from "@/lib/api";
import { INBOX_LABEL, NEEDS_YOU, appUpdatedAt } from "@/lib/format";
import type { AgentStatus, InboxMessage } from "@/lib/types";
import { Card, EmptyState, Notice, PageHeader, TextLink, cx } from "@/components/ui";
import { TimeAgo } from "@/components/TimeAgo";
import { ShortlistView } from "@/components/shortlist/ShortlistView";
import { WaitingList } from "@/components/today/WaitingList";
import { ActivityFeed } from "@/components/today/Activity";
import { ago, inMin } from "@/components/agent/kinds";

export const metadata: Metadata = { title: "Dashboard" };

const SECTIONS = [
  { id: "shortlist", label: "Shortlist" },
  { id: "activity", label: "Activity" },
] as const;
type Section = (typeof SECTIONS)[number]["id"];

const REPLY_KINDS: InboxMessage["kind"][] = ["interview", "offer", "recruiter_reply", "rejection", "confirmation"];

function StatusLine({ status }: { status: AgentStatus | null }) {
  if (!status) return null;
  const items = [
    status.lastTickAt ? `Last run ${ago(status.lastTickAt)}` : null,
    status.nextTickAt ? `next in ${inMin(status.nextTickAt)}` : null,
    `${status.usedToday} of ${status.dailyCap} sent on its own today`,
  ].filter(Boolean);
  return <span suppressHydrationWarning>{items.join(" · ")}</span>;
}

async function ShortlistSection() {
  const items = await api.shortlist().catch(() => null);
  if (items === null) return <Notice tone="red">Cannot load your shortlist right now. Try again in a moment.</Notice>;
  return <ShortlistView initial={items} />;
}

async function ActivitySection() {
  const [apps, activity, inbox] = await Promise.all([
    api.listApplications().catch(() => null),
    api.agentActivity(40).catch(() => []),
    api.listInbox().catch(() => [] as InboxMessage[]),
  ]);
  const waiting = (apps ?? [])
    .filter((a) => NEEDS_YOU.includes(a.application.status))
    .sort((a, b) => +new Date(appUpdatedAt(b.application) ?? 0) - +new Date(appUpdatedAt(a.application) ?? 0));
  const replies = inbox.filter((m) => REPLY_KINDS.includes(m.kind)).sort((a, b) => +new Date(b.receivedAt) - +new Date(a.receivedAt)).slice(0, 4);
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      {apps === null && <div className="lg:col-span-3"><Notice tone="red">Cannot load your applications right now. Try again in a moment.</Notice></div>}
      <section className="flex flex-col gap-3 lg:col-span-2" aria-labelledby="waiting-h">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="waiting-h" className="flex items-center gap-2 text-title font-semibold text-ink">
            Waiting on you
            {waiting.length > 0 && <span className="rounded-full bg-attn-tint px-2 text-[12px] font-semibold leading-5 text-attn-fg ring-1 ring-inset ring-attn tnum">{waiting.length}</span>}
          </h2>
          <TextLink href="/applications">All applications</TextLink>
        </div>
        {waiting.length > 0 ? (
          <WaitingList items={waiting} />
        ) : (
          <EmptyState title="Nothing is waiting on you">All caught up. Nothing was sent without you.</EmptyState>
        )}
      </section>

      <Card title="Recent replies" actions={<TextLink href="/inbox">Inbox</TextLink>}>
        {replies.length === 0 ? (
          <p className="text-body-sm text-muted">No replies yet. They show up here when employers write back.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {replies.map((m) => (
              <li key={m.id}>
                <Link href={m.applicationId ? `/applications/${m.applicationId}` : "/inbox"} className="block rounded-control hover:bg-sunken/60">
                  <span className={cx("inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold", m.kind === "interview" || m.kind === "offer" ? "bg-accent-tint text-accent-fg" : "bg-sunken text-ink-2")}>{INBOX_LABEL[m.kind]}</span>
                  <span className="mt-1 block truncate text-body-sm text-ink">{m.subject}</span>
                  <TimeAgo iso={m.receivedAt} className="text-[12px] text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="lg:col-span-3" title="Activity">
        <ActivityFeed items={activity} />
      </Card>
    </div>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.section) ? sp.section[0] : sp.section;
  const section: Section = SECTIONS.some((s) => s.id === raw) ? (raw as Section) : "shortlist";
  const status = await api.agentStatus().catch(() => null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" subtitle={<StatusLine status={status} />} />
      <nav aria-label="Dashboard sections" className="-mt-2">
        <ul className="flex gap-1 rounded-control border border-line bg-surface p-1 sm:inline-flex">
          {SECTIONS.map((s) => {
            const on = s.id === section;
            return (
              <li key={s.id} className="flex-1 sm:flex-none">
                <Link
                  href={s.id === "shortlist" ? "/dashboard" : `/dashboard?section=${s.id}`}
                  aria-current={on ? "page" : undefined}
                  className={cx(
                    "inline-flex min-h-11 w-full items-center justify-center rounded-[6px] px-5 text-body-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent",
                    on ? "bg-ink text-on-ink" : "text-ink-2 hover:bg-sunken",
                  )}
                >
                  {s.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {section === "shortlist" ? <ShortlistSection /> : <ActivitySection />}
    </div>
  );
}
