"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { buttonClass } from "@/components/Button";
import { FormError } from "@/components/auth/fields";
import { API_URL, api, type ApplicationDetail, type InboxMessage, type Outcome, type OutcomeKind, type Outcomes } from "@/lib/api";
import { isSent, rowState, shortDate } from "@/lib/app-state";
import { noriReact } from "@/lib/auth-flow";
import { usePolling } from "@/lib/use-polling";
import { setOutcomes } from "@/lib/use-outcomes";
import { StateChip } from "./Applications";
import { CompanyLogo } from "./CompanyLogo";
import { ApplicationBody, useApplication } from "./LivePanel";
import { PageHead } from "./PageHead";

/* /applications/:id (4b spec section 4): the header, what it needs while it moves, What happened?, the timeline, the
   resume sent and the receipt. */

const KIND_LABEL: Record<OutcomeKind, string> = { reply: "Reply", interview: "Interview", offer: "Offer", rejection: "Rejection" };
const KIND_DOT: Record<OutcomeKind, string> = { reply: "bg-accent", offer: "bg-accent", interview: "bg-peach", rejection: "bg-danger" };
const SAY: Record<OutcomeKind, string> = { reply: "They replied!", interview: "An interview!", offer: "An offer!", rejection: "On to the next one." };
const SEEN_KEY = "norinote-last-seen-outcomes";
const card = "rounded-card border-[1.5px] border-line bg-surface p-4 tablet:p-5";
const when = (iso: string) => `${shortDate(iso)}, ${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;

type Entry = { key: string; at: string; title: string; sub?: string; href?: string; dot: string; undo?: string; body?: ReactNode };

function Timeline({ entries, onUndo, busy }: { entries: Entry[]; onUndo: (id: string) => void; busy: boolean }) {
  return (
    <ol aria-label="What happened, newest first" className="relative flex flex-col gap-4 pl-6 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-0.5 before:bg-line">
      {entries.map((e) => (
        <li key={e.key} className="relative flex flex-col gap-0.5">
          <span aria-hidden="true" className={`absolute top-[7px] -left-6 size-3 rounded-full ring-[3px] ring-surface ${e.dot}`} />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="font-semibold text-ink">{e.href ? <Link href={e.href} className="underline underline-offset-[3px]">{e.title}</Link> : e.title}</p>
            <p className="text-[0.8125rem] text-ink-2 tabular-nums">{when(e.at)}</p>
          </div>
          {e.sub && <p className="text-small text-ink-2">{e.sub}</p>}
          {e.body}
          {e.undo && (
            <button type="button" onClick={() => onUndo(e.undo!)} aria-disabled={busy || undefined} className="min-h-10 self-start text-small font-semibold text-ink underline underline-offset-[3px]">
              Undo
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

function buildEntries(detail: ApplicationDetail, outcomes: Outcome[], mail: InboxMessage[], marked: string | null): Entry[] {
  const a = detail.application;
  const out: Entry[] = [];
  const byId = new Map(mail.map((m) => [m.id, m]));
  const used = new Set<string>();
  for (const o of outcomes) {
    const m = o.messageId ? byId.get(o.messageId) : undefined;
    if (m) used.add(m.id);
    out.push({
      key: `o-${o.id}`,
      at: o.at,
      title: KIND_LABEL[o.kind],
      sub: o.source === "manual" ? "Marked by you" : m ? `From Nori's inbox · ${m.subject}` : "From Nori's inbox",
      href: m ? `/inbox/${m.id}` : undefined,
      dot: KIND_DOT[o.kind],
      undo: o.id === marked ? o.id : undefined,
    });
  }
  for (const m of mail) {
    if (used.has(m.id)) continue;
    out.push({ key: `m-${m.id}`, at: m.receivedAt, title: m.subject || "(no subject)", sub: `Email from ${m.fromName ?? m.fromAddress}`, href: `/inbox/${m.id}`, dot: "bg-line-strong" });
  }
  const took = a.approvedAt && a.submittedAt ? Math.max(0, Math.round((Date.parse(a.submittedAt) - Date.parse(a.approvedAt)) / 1000)) : null;
  if (a.submittedAt) out.push({ key: "sent", at: a.submittedAt, title: "Sent", sub: took !== null ? `In ${took} seconds after your OK` : undefined, dot: "bg-accent" });
  const lines = detail.events.filter((e) => e.level !== "debug" && e.message).filter((e, i, all) => i === 0 || all[i - 1]?.message !== e.message);
  if (lines.length && (a.approvedAt || a.submittedAt)) {
    out.push({
      key: "run",
      at: a.approvedAt ?? a.submittedAt ?? lines[0]!.ts,
      title: "What Nori did",
      dot: "bg-line-strong",
      body: (
        <>
          <ul className="mt-1 flex flex-col gap-1 text-small text-ink">
            {lines.slice(-5).map((e) => (
              <li key={e.id} className="flex gap-2">
                <span aria-hidden="true" className={e.level === "warn" ? "text-warning" : "text-accent"}>
                  {e.level === "warn" ? "!" : "✓"}
                </span>
                {e.message}
              </li>
            ))}
          </ul>
          {lines.length > 5 && (
            <details className="mt-1 text-small">
              <summary className="min-h-10 cursor-pointer py-2 font-semibold text-ink underline underline-offset-[3px]">Show everything Nori did</summary>
              <ol className="flex flex-col gap-1 text-ink-2">
                {lines.map((e) => (
                  <li key={e.id}>
                    <span className="tabular-nums">{new Date(e.ts).toLocaleTimeString("en-GB")}</span> · {e.message}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      ),
    });
  }
  if (a.preparedAt) out.push({ key: "prepared", at: a.preparedAt, title: "Ready for your OK", dot: "bg-line-strong" });
  out.push({ key: "created", at: a.createdAt, title: "Created from Today", dot: "bg-line-strong" });
  return out.sort((x, y) => y.at.localeCompare(x.at));
}

export function ApplicationPage({ id }: { id: string }) {
  const poll = useApplication(id);
  const detail = poll.data;
  const sent = !!detail && isSent(detail.application);
  const server = usePolling(sent ? `outcomes:${id}` : null, () => api.outcomes(id), 60_000);
  const inbox = usePolling("inbox", api.inbox, 60_000);
  const [local, setLocal] = useState<Outcomes | null>(null);
  const [marked, setMarked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const outcomes = local ?? server.data;

  function settle(o: Outcomes) {
    setLocal(o);
    setOutcomes(id, o);
  }

  async function mark(kind: OutcomeKind) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const r = await api.addOutcome(id, kind);
    setBusy(false);
    if (!r.ok) return setFailure(r.error);
    settle(r.data);
    setMarked(r.data.outcome.id);
    setSaid(`Marked as ${KIND_LABEL[kind].toLowerCase()}. Undo is available.`);
    // Seen here, so the list doesn't play it again.
    try {
      const seen = localStorage.getItem(SEEN_KEY);
      if (!seen || r.data.outcome.at > seen) localStorage.setItem(SEEN_KEY, r.data.outcome.at);
    } catch {
      // Storage blocked: the list has no last visit to compare with, so it stays quiet anyway.
    }
    if (r.data.created) void noriReact({ event: kind, say: SAY[kind] });
  }

  async function undo(outcomeId: string) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const r = await api.removeOutcome(id, outcomeId);
    setBusy(false);
    if (!r.ok) return setFailure(r.error);
    settle(r.data);
    setMarked(null);
    setSaid("Undone.");
  }

  if (!detail) {
    const missing = poll.status === 404 || poll.status === 400;
    return (
      <main id="main" className="mx-auto flex max-w-[960px] flex-col items-start gap-3 px-4 pt-[18px] pb-24 tablet:px-8 tablet:pt-7 laptop:px-10">
        <Link href="/applications" className="min-h-10 py-2 text-small font-semibold text-ink no-underline">
          ‹ All applications
        </Link>
        {missing ? (
          <>
            <h1 className="font-serif text-[1.75rem] leading-[1.1] text-ink laptop:text-[2.25rem]">That application isn&rsquo;t here.</h1>
            <Link href="/applications" className={buttonClass("outline", "min-h-11")}>
              All applications
            </Link>
          </>
        ) : poll.error && poll.status !== 401 ? (
          <>
            <h1 className="font-serif text-[1.75rem] leading-[1.1] text-ink">Couldn&rsquo;t reach Norinote</h1>
            <p className="text-ink-2">Check your connection; this page tries again by itself.</p>
          </>
        ) : (
          <>
            <h1 className="sr-only">Loading the application</h1>
            <div aria-hidden="true" className="h-[120px] w-full animate-pulse rounded-card border-[1.5px] border-line bg-surface" />
            <div aria-hidden="true" className="h-[240px] w-full animate-pulse rounded-card border-[1.5px] border-line bg-surface" />
          </>
        )}
      </main>
    );
  }

  const a = detail.application;
  const job = detail.job;
  const state = rowState(a, outcomes ?? undefined);
  const mail = (inbox.data ?? []).filter((m) => m.applicationId === id);
  const entries = buildEntries(detail, outcomes?.outcomes ?? [], mail, marked);
  const changes = detail.resume?.changes ?? [];
  const receipt = a.receipt;
  const confirmation = typeof receipt?.confirmation === "string" ? receipt.confirmation : null;
  const shot = typeof receipt?.screenshotPath === "string" && receipt.screenshotPath.startsWith("artifacts/") ? `${API_URL}/api/${receipt.screenshotPath}` : null;
  const took = a.approvedAt && a.submittedAt ? Math.max(0, Math.round((Date.parse(a.submittedAt) - Date.parse(a.approvedAt)) / 1000)) : null;
  const place = job.remote && !job.location ? "Remote" : job.location;
  const sentOn = a.submittedAt ?? outcomes?.submittedAt;

  return (
    <main id="main" className="mx-auto flex max-w-[960px] flex-col gap-4 px-4 pb-24 tablet:gap-5 tablet:px-8 tablet:pb-12 laptop:px-10 laptop:pt-7">
      <div className="flex flex-col items-start gap-2">
        <Link href="/applications" className="-ml-1 min-h-10 px-1 py-2 text-small font-semibold text-ink no-underline hover:underline">
          ‹ All applications
        </Link>
        <div className="self-stretch">
          <PageHead>
            <h1 className="font-serif text-[1.75rem] leading-[1.08] text-ink laptop:text-[2.25rem]">{job.title}</h1>
          </PageHead>
        </div>
        <div className="flex items-center gap-3">
          <CompanyLogo name={job.companyName} url={job.companyLogoUrl} />
          <p className="text-small text-ink-2 tablet:text-body">{[job.companyName, place, sentOn ? `sent ${shortDate(sentOn)}` : null].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <StateChip state={state} />
          <a href={job.applyUrl} target="_blank" rel="noreferrer" className={buttonClass("outline", "min-h-11")}>
            Open the job posting
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </div>

      {a.status !== "submitted" && (
        <section aria-label="Where it is now" className={card}>
          <ApplicationBody detail={detail} refresh={poll.refresh} onPage />
        </section>
      )}

      {sent && (
        <section aria-labelledby="mark-title" className={`${card} flex flex-col gap-3`}>
          <h2 id="mark-title" className="text-[1.125rem] font-semibold text-ink">
            What happened?
          </h2>
          <div className="grid grid-cols-2 gap-2 tablet:flex tablet:flex-wrap">
            {(["reply", "interview", "offer", "rejection"] as OutcomeKind[]).map((k) => (
              <button key={k} type="button" onClick={() => void mark(k)} aria-disabled={busy || undefined} className={buttonClass("outline", "min-h-11 px-5")}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <p className="text-small text-ink-2">Replies that go to your own email don&rsquo;t reach Nori&rsquo;s inbox, so you can mark them here.</p>
          {failure && <FormError>{failure}</FormError>}
        </section>
      )}
      <p role="status" className="sr-only">
        {said}
      </p>

      <div className="grid gap-4 tablet:gap-5 laptop:grid-cols-[1.2fr_1fr] laptop:items-start">
        <section aria-labelledby="timeline-title" className={card}>
          <h2 id="timeline-title" className="mb-4 text-[1.125rem] font-semibold text-ink">
            Timeline
          </h2>
          <Timeline entries={entries} onUndo={(o) => void undo(o)} busy={busy} />
        </section>

        <div className="flex flex-col gap-4 tablet:gap-5">
          {changes.length > 0 && (
            <section aria-labelledby="resume-title" className={`${card} flex flex-col gap-2.5`}>
              <h2 id="resume-title" className="text-[1.125rem] font-semibold text-ink">
                {sent ? "The resume sent" : "Your tailored resume"}
              </h2>
              <p className="text-small text-ink-2">
                {changes.length} {changes.length === 1 ? "line" : "lines"} changed for this job
              </p>
              <ul className="flex flex-col gap-2.5">
                {changes.map((c, i) => (
                  <li key={i} className="flex flex-col gap-0.5 text-small">
                    <span className="text-ink">
                      <mark className="rounded-[4px] bg-tint px-0.5 text-ink">{c.after}</mark>
                    </span>
                    {c.reason && <span className="text-[0.8125rem] text-ink-2">{c.reason}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {receipt && (
            <section aria-labelledby="receipt-title" className={`${card} flex flex-col gap-1.5`}>
              <h2 id="receipt-title" className="text-[1.125rem] font-semibold text-ink">
                The receipt
              </h2>
              {(confirmation || took !== null) && (
                <p className="text-small text-ink">
                  {confirmation && (
                    <>
                      Confirmation <span className="font-semibold tabular-nums">{confirmation}</span>
                    </>
                  )}
                  {confirmation && took !== null && " · "}
                  {took !== null && `sent in ${took} s`}
                </p>
              )}
              {receipt.dryRun === true && <p className="text-small text-ink-2">A practice run: nothing reached the employer.</p>}
              {shot && (
                <a href={shot} target="_blank" rel="noreferrer" className="min-h-10 self-start py-2 text-small font-semibold text-ink underline underline-offset-[3px]">
                  See the screenshot<span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
