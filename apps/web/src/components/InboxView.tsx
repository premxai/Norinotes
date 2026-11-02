"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { INBOX_LABEL } from "@/lib/format";
import type { InboxKind, InboxMessage } from "@/lib/types";
import { TimeAgo } from "./TimeAgo";
import { EmptyState, Frame, Icon, cx } from "./ui";

const NEEDS_REPLY: InboxKind[] = ["interview", "offer", "recruiter_reply"];

const KIND_STYLE: Record<InboxKind, string> = {
  interview: "bg-accent-tint text-accent-fg",
  offer: "bg-accent text-on-ink",
  recruiter_reply: "bg-accent-tint text-accent-fg",
  verification_code: "bg-sunken text-ink",
  confirmation: "bg-sunken text-ink-2",
  rejection: "bg-sunken text-muted",
  other: "bg-sunken text-muted",
};

function KindPill({ kind }: { kind: InboxKind }) {
  return <span className={cx("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-semibold", KIND_STYLE[kind])}>{INBOX_LABEL[kind]}</span>;
}

/**
 * Mail sent to your Norinote address: the newest verification code on top, then replies from employers, then the
 * messages kept for the record. Nothing is sent from here.
 */
export function InboxView({ initial, appTitles }: { initial: InboxMessage[]; appTitles: Record<string, string> }) {
  const [messages, setMessages] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial.find((m) => NEEDS_REPLY.includes(m.kind))?.id ?? initial[0]?.id ?? null);

  const selected = messages.find((m) => m.id === selectedId) ?? null;
  const code = messages.find((m) => m.kind === "verification_code" && m.code);
  const groups: [string, InboxMessage[]][] = [
    ["From employers", messages.filter((m) => NEEDS_REPLY.includes(m.kind))],
    ["For the record", messages.filter((m) => !NEEDS_REPLY.includes(m.kind))],
  ];

  function select(id: string) {
    setSelectedId(id);
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, read: true } : m)));
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-meta text-muted tnum">{messages.length} messages · {messages.filter((m) => m.read === false).length} unread</p>

      {code && (
        <Frame className="flex flex-wrap items-center gap-x-5 gap-y-2 p-4">
          <KindPill kind="verification_code" />
          <span className="font-mono text-[24px] font-semibold tracking-[0.2em] text-ink tnum">{code.code}</span>
          <span className="min-w-0 basis-full text-meta text-muted [overflow-wrap:anywhere] sm:basis-0 sm:flex-1">
            {code.fromAddress} · <TimeAgo iso={code.receivedAt} />
            {code.applicationId && appTitles[code.applicationId] ? <> · for {appTitles[code.applicationId]}</> : null}
          </span>
        </Frame>
      )}

      {messages.length === 0 ? (
        <EmptyState title="No mail yet">Codes, confirmations and replies sent to your Norinote address arrive here, each linked to its application.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            {groups.filter(([, list]) => list.length > 0).map(([label, list]) => (
              <section key={label} aria-label={label}>
                <h2 className="mb-2 text-meta font-medium text-muted">{label}</h2>
                <ul className="divide-y divide-line rounded-card border border-line bg-surface">
                  {list.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => select(m.id)}
                        aria-current={m.id === selectedId ? "true" : undefined}
                        className={cx("flex w-full flex-col gap-1 px-4 py-3 text-left", m.id === selectedId ? "bg-sunken" : "hover:bg-sunken/50")}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2">
                            {m.read === false && <span className="h-2 w-2 rounded-full bg-accent" aria-label="Unread" />}
                            <KindPill kind={m.kind} />
                          </span>
                          <TimeAgo iso={m.receivedAt} className="text-[12px] text-muted" />
                        </span>
                        <span className={cx("truncate text-body-sm", m.read === false ? "font-semibold text-ink" : "text-ink-2")}>{m.subject}</span>
                        <span className="truncate text-meta text-muted">{m.fromAddress}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {selected && (
            <Frame as="article" className="self-start">
              <header className="border-b border-line p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <KindPill kind={selected.kind} />
                  <TimeAgo iso={selected.receivedAt} className="text-meta text-muted" />
                </div>
                <h2 className="mt-3 text-display-md font-semibold text-ink">{selected.subject}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted">
                  <span>From <span className="text-ink-2">{selected.fromAddress}</span></span>
                  {selected.applicationId && (
                    <Link href={`/applications/${selected.applicationId}`} className="inline-flex items-center gap-1 font-medium text-accent underline-offset-4 hover:underline">
                      {appTitles[selected.applicationId] ?? "Open the application"} <Icon icon={ArrowRight} size={13} />
                    </Link>
                  )}
                </div>
              </header>
              <div className="flex flex-col gap-5 p-4 sm:p-5">
                {selected.code && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-sunken px-4 py-3">
                    <span className="text-meta font-medium text-muted">Verification code</span>
                    <span className="font-mono text-[24px] font-semibold tracking-[0.2em] text-ink tnum">{selected.code}</span>
                  </div>
                )}
                <div className="max-w-prose whitespace-pre-wrap text-body text-ink-2">{selected.bodyText}</div>
              </div>
            </Frame>
          )}
        </div>
      )}
    </div>
  );
}
