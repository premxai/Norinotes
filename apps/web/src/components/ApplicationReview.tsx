"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Check, ExternalLink, RotateCcw } from "lucide-react";
import { api, artifactUrl, USE_MOCK } from "@/lib/api";
import { appUpdatedAt, STATUS_LABEL } from "@/lib/format";
import type { Application, ApplicationDetail, ApplicationStatus, Job, Resume, RunEventRow } from "@/lib/types";
import { EventLog } from "./EventLog";
import { ResumePreview } from "./ResumePreview";
import { Stepper } from "./Stepper";
import { StatusPill } from "./StatusPill";
import { TimeAgo } from "./TimeAgo";
import { ChangeCard, type NodeInfo } from "./review/ChangeCard";
import { Accordion, Button, Card, Frame, Icon, Notice, cx, inputClass } from "./ui";

/** States the worker is moving through on its own; the page re-reads the application while it is in one. */
const WORKING: ApplicationStatus[] = ["queued", "preparing", "applying", "awaiting_code"];

const WORKING_COPY: Partial<Record<ApplicationStatus, { title: string; line: string }>> = {
  queued: { title: "Queued", line: "Norinote will start this one shortly. Nothing is needed from you yet." },
  preparing: { title: "Preparing your application", line: "Tailoring the resume from your career graph and drafting answers. It stops for your OK before anything is sent." },
  applying: { title: "Sending", line: "Filling the form and submitting it, then waiting for the employer's confirmation." },
  awaiting_code: { title: "Waiting for a verification code", line: "The site emailed a code to your Norinote address. It is read and entered automatically." },
};

export function ApplicationReview({ initial, nodes, liveSubmit }: { initial: ApplicationDetail; nodes: Record<string, NodeInfo>; liveSubmit: boolean }) {
  const [app, setApp] = useState<Application>(initial.application);
  const [resume, setResume] = useState<Resume | null>(initial.resume);
  const [events, setEvents] = useState<RunEventRow[]>(initial.events);
  const job: Job = initial.job;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>(initial.application.answers);
  const [pending, setPending] = useState<Record<string, string>>({});

  /** Re-read the application from the API (no-op in demo mode, where state is local). */
  const refresh = useCallback(async () => {
    if (USE_MOCK) return;
    try {
      const d = await api.getApplication(initial.application.id);
      setApp(d.application);
      setResume(d.resume);
      setEvents(d.events);
      setAnswers((prev) => (Object.keys(prev).length === 0 ? d.application.answers : { ...d.application.answers, ...prev }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [initial.application.id]);

  const working = WORKING.includes(app.status);
  useEffect(() => {
    if (!working || USE_MOCK) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [working, refresh]);

  // ---- actions
  async function act(name: string, fn: () => Promise<void>, optimistic?: Partial<Application>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
      if (optimistic) setApp((a) => ({ ...a, ...optimistic }));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const now = () => new Date().toISOString();
  const approve = () => act("approve", () => api.approveApplication(app.id, answers), { status: "applying", approvedAt: now() });
  const retry = () => act("retry", () => api.retryApplication(app.id), { status: "queued", error: null });
  const requiredMissing = app.pendingQuestions.filter((q) => q.required && !pending[q.id]?.trim());
  const sendAnswers = () =>
    act("answer", async () => {
      const filled = Object.fromEntries(Object.entries(pending).filter(([, v]) => v.trim()));
      await api.answerQuestions(app.id, filled);
    }, { status: "applying", pendingQuestions: [], answers: { ...answers, ...pending } });

  const lastStep = [...events].reverse().map((e) => e.step).find((s) => ["queued", "preparing", "prepared", "applying", "awaiting_code"].includes(s));
  const editable = app.status === "prepared";

  // ---- stage panels -------------------------------------------------------------------------------------------

  const answerEntries = Object.entries(answers);
  const longAnswers = answerEntries.filter(([, v]) => v.length > 70);
  const shortAnswers = answerEntries.filter(([, v]) => v.length <= 70);

  const answerField = ([label, value]: [string, string], i: number, long: boolean) => (
    <div key={label} className={cx("grid gap-1.5", long ? "" : "sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-center sm:gap-4")}>
      <label htmlFor={`ans-${long ? "l" : "s"}-${i}`} className="text-meta text-ink-2">{label}</label>
      {long ? (
        <textarea id={`ans-l-${i}`} className={inputClass} rows={4} value={value} disabled={!editable} onChange={(e) => setAnswers((a) => ({ ...a, [label]: e.target.value }))} />
      ) : (
        <input id={`ans-s-${i}`} className={inputClass} value={value} disabled={!editable} onChange={(e) => setAnswers((a) => ({ ...a, [label]: e.target.value }))} />
      )}
    </div>
  );

  const resumePanel = resume && (
    <section aria-labelledby="resume-h" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="resume-h" className="text-title font-semibold text-ink">
          {resume.changes.length > 0 ? `Resume: ${resume.changes.length} change${resume.changes.length === 1 ? "" : "s"}, each from your graph` : "Your resume for this job"}
        </h2>
        <p className="flex flex-wrap items-center gap-x-2 text-meta text-muted tnum">
          <span>{resume.pages ?? "?"} page{resume.pages === 1 ? "" : "s"}</span>
          <Link href={`/resume/${resume.id}`} className="font-medium text-accent underline-offset-4 hover:underline">Open resume view</Link>
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {resume.changes.length > 0 ? (
          <ul className="flex flex-col gap-2.5">
            {resume.changes.map((c) => <ChangeCard key={c.bulletId} change={c} nodes={nodes} />)}
          </ul>
        ) : (
          <p className="rounded-card bg-sunken px-4 py-3 text-body-sm text-ink-2">Nothing needed changing: your base resume already fits this posting.</p>
        )}
        <Frame className="overflow-hidden p-1.5">
          <ResumePreview resume={resume} className="h-[520px] rounded-[8px] xl:h-[640px]" />
        </Frame>
      </div>
    </section>
  );

  const answersPanel = answerEntries.length > 0 && (
    <section aria-labelledby="answers-h" className="flex flex-col gap-4">
      <h2 id="answers-h" className="text-title font-semibold text-ink">{answerEntries.length} field{answerEntries.length === 1 ? "" : "s"} filled</h2>
      {longAnswers.length > 0 && (
        <Frame className="p-4 sm:p-5">
          <p className="text-body-sm font-semibold text-ink">Read these first</p>
          <p className="mt-0.5 text-meta text-muted">Longer written answers. Each one should only say what your graph and profile support.</p>
          <div className="mt-3 flex flex-col gap-4">{longAnswers.map((a, i) => answerField(a, i, true))}</div>
        </Frame>
      )}
      {shortAnswers.length > 0 && (
        <Accordion title={`${shortAnswers.length} short field${shortAnswers.length === 1 ? "" : "s"}`} meta="from your profile" defaultOpen={shortAnswers.length <= 8}>
          <div className="flex flex-col gap-3">{shortAnswers.map((a, i) => answerField(a, i, false))}</div>
        </Accordion>
      )}
    </section>
  );

  const questionsPanel = app.status === "needs_user" && app.pendingQuestions.length > 0 && (
    <Frame tone="attn" className="p-4 sm:p-5">
      <h2 className="text-title font-semibold text-ink">
        {app.pendingQuestions.length === 1 ? "One question for you" : `${app.pendingQuestions.length} questions for you`}
      </h2>
      <dl className="mt-3 grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-meta">
        <dt className="text-muted">Why</dt>
        <dd className="text-ink-2">Required on the form, and your profile has no answer. Norinote never guesses legal or personal answers.</dd>
        <dt className="text-muted">Job</dt>
        <dd className="text-ink-2">{job.title}, {job.companyName}</dd>
        <dt className="text-muted">If ignored</dt>
        <dd className="text-ink-2">Nothing is sent. The application waits here until you answer.</dd>
      </dl>
      <div className="mt-4 flex flex-col gap-4">
        {app.pendingQuestions.map((q, i) => (
          <label key={q.id} className="block" htmlFor={`q-${i}`}>
            <span className="mb-1.5 block text-body-sm font-semibold text-ink">
              {q.text}{q.required && <span className="ml-1 text-attn-fg" aria-label="required">*</span>}
            </span>
            {q.options?.length ? (
              <select id={`q-${i}`} className={inputClass} value={pending[q.id] ?? ""} onChange={(e) => setPending((p) => ({ ...p, [q.id]: e.target.value }))}>
                <option value="">Choose an answer</option>
                {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : q.type === "textarea" ? (
              <textarea id={`q-${i}`} className={inputClass} rows={3} value={pending[q.id] ?? ""} onChange={(e) => setPending((p) => ({ ...p, [q.id]: e.target.value }))} />
            ) : (
              <input id={`q-${i}`} className={inputClass} value={pending[q.id] ?? ""} onChange={(e) => setPending((p) => ({ ...p, [q.id]: e.target.value }))} />
            )}
          </label>
        ))}
      </div>
    </Frame>
  );

  const workingCopy = WORKING_COPY[app.status];
  const workingPanel = workingCopy && (
    <section aria-labelledby="stage-h" className="rounded-card bg-sunken p-5">
      <h2 id="stage-h" className="text-title font-semibold text-ink">{workingCopy.title}<span className="dots" /></h2>
      <p className="mt-1 max-w-prose text-body-sm text-ink-2">{workingCopy.line}</p>
      <p className="mt-2 text-meta text-muted">
        You can leave this page. The run log keeps a record, and the dashboard shows it when it needs you.
        {app.status === "awaiting_code" && <> Codes also appear in your <Link href="/inbox" className="font-medium text-accent underline-offset-4 hover:underline">inbox</Link>.</>}
      </p>
    </section>
  );

  const receipt = app.receipt;
  const receiptPanel = app.status === "submitted" && (
    <section aria-labelledby="stage-h" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="stage-h" className="text-title font-semibold text-ink">{receipt?.dryRun ? "Filled, not sent (dry run)" : "Sent"}</h2>
        <p className="text-meta text-muted">
          {app.submittedAt ? <>on <TimeAgo iso={app.submittedAt} /> </> : null}
          {receipt?.submittedVia ? <>via {receipt.submittedVia}</> : null}
        </p>
      </div>
      {receipt?.screenshotPath && (
        <figure>
          <Frame className="overflow-hidden p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={USE_MOCK ? mockScreenshot(job.companyName) : artifactUrl(receipt.screenshotPath)} alt="Screenshot of the confirmation page" className="block w-full rounded-[8px]" />
          </Frame>
          {receipt.confirmationText && <figcaption className="mt-1.5 text-meta text-ink-2">&ldquo;{receipt.confirmationText}&rdquo;</figcaption>}
        </figure>
      )}
      {receipt?.fields && receipt.fields.length > 0 && (
        <Accordion title="What was in the form" meta={receipt.fields.length}>
          <dl className="divide-y divide-line text-body-sm">
            {receipt.fields.map((f) => (
              <div key={f.label} className="grid gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[12rem_1fr]">
                <dt className="text-meta text-muted">{f.label}</dt>
                <dd className="break-words text-ink">{f.value}</dd>
              </div>
            ))}
          </dl>
        </Accordion>
      )}
      {!receipt && <p className="text-body-sm text-muted">No receipt was recorded for this application.</p>}
    </section>
  );

  const failedPanel = app.status === "failed" && (
    <section aria-labelledby="stage-h" className="rounded-card bg-danger-tint p-5">
      <h2 id="stage-h" className="text-title font-semibold text-danger-fg">This run stopped</h2>
      <p className="mt-1 max-w-prose text-body-sm text-danger-fg">{app.error ?? "Nothing was sent."}</p>
      <Button variant="secondary" icon={RotateCcw} className="mt-3" onClick={retry} disabled={busy !== null}>Try again</Button>
    </section>
  );

  const stage: ReactNode =
    working ? workingPanel
    : app.status === "submitted" ? receiptPanel
    : app.status === "failed" ? failedPanel
    : null;

  // ---- the one primary action for the current gate
  const footer =
    app.status === "prepared" ? (
      <ActionBar
        next={liveSubmit ? "Approving sends this application to the employer." : "Dry run: approving records your OK. Nothing is sent."}
        primary={<Button variant="primary" icon={Check} onClick={approve} disabled={busy !== null}>{busy === "approve" ? "Working..." : liveSubmit ? "Approve and send" : "Approve"}</Button>}
      />
    ) : app.status === "needs_user" ? (
      <ActionBar
        next={liveSubmit ? "Your answers go to the form, then it is sent." : "Dry run: your answers are filled in, nothing is sent."}
        warn={requiredMissing.length > 0 ? `Answer ${requiredMissing.length} required question${requiredMissing.length === 1 ? "" : "s"} first.` : undefined}
        primary={<Button variant="primary" icon={Check} onClick={sendAnswers} disabled={busy !== null || requiredMissing.length > 0}>{busy === "answer" ? "Working..." : "Send answers"}</Button>}
      />
    ) : null;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <Link href="/applications" className="inline-flex w-fit items-center gap-1.5 text-meta text-muted hover:text-ink">
          <Icon icon={ArrowLeft} size={14} /> Applications
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-balance text-[1.5rem] font-semibold leading-tight tracking-[-0.015em] text-ink sm:text-display-lg">{job.title}</h1>
            <p className="mt-1 text-body text-ink-2">
              {job.companyName}{job.location && <span className="text-muted"> · {job.location}</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={app.status} />
            <a href={job.applyUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-control px-2 text-[13px] font-medium text-accent hover:bg-accent-tint">
              Posting <Icon icon={ExternalLink} size={14} />
            </a>
          </div>
        </div>
      </header>

      <Frame className="px-4 py-4 sm:px-5">
        <Stepper status={app.status} lastStep={lastStep} />
      </Frame>

      {(error || (app.error && app.status !== "failed")) && (
        <div className="flex flex-col gap-2.5">
          {error && <Notice tone="red">{error}</Notice>}
          {app.error && app.status !== "failed" && <Notice tone="red" label="Last run">{app.error}</Notice>}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          {stage}
          {questionsPanel}
          {(app.status === "prepared" || app.status === "needs_user") && answersPanel}
          {(app.status === "prepared" || app.status === "needs_user") && resumePanel}
          {footer}
          {!(app.status === "prepared" || app.status === "needs_user") && resume && (
            <Accordion title="The resume that was used" meta={`${resume.pages ?? "?"} page${resume.pages === 1 ? "" : "s"}`}>
              <div className="flex flex-col gap-3">
                <Frame className="overflow-hidden p-1.5"><ResumePreview resume={resume} className="h-[520px] rounded-[8px]" /></Frame>
                <Link href={`/resume/${resume.id}`} className="inline-flex w-fit items-center gap-1 text-meta font-medium text-accent underline-offset-4 hover:underline">Open resume view <Icon icon={ArrowUpRight} size={14} /></Link>
              </div>
            </Accordion>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <Card title="Job">
            <dl className="flex flex-col gap-1.5 text-meta">
              <div className="flex justify-between gap-3"><dt className="text-muted">Company</dt><dd className="text-right text-ink">{job.companyName}</dd></div>
              {job.location && <div className="flex justify-between gap-3"><dt className="text-muted">Location</dt><dd className="text-right text-ink">{job.location}{job.remote ? ", remote OK" : ""}</dd></div>}
              {app.createdAt && <div className="flex justify-between gap-3"><dt className="text-muted">Started</dt><dd className="text-ink"><TimeAgo iso={app.createdAt} /></dd></div>}
            </dl>
            <Link href={`/jobs?job=${job.id}`} className="mt-3 inline-flex items-center gap-1 text-meta font-medium text-accent underline-offset-4 hover:underline">Posting and requirements</Link>
          </Card>
          <Card><EventLog events={events} mode={working && !USE_MOCK ? "polling" : "idle"} /></Card>
          <p className="px-1 text-[12px] text-muted">
            {app.attempts} attempt{app.attempts === 1 ? "" : "s"} · {STATUS_LABEL[app.status]}
            {appUpdatedAt(app) && <> <TimeAgo iso={appUpdatedAt(app)} /></>}
          </p>
        </aside>
      </div>
    </div>
  );
}

/**
 * The bottom of a gate: the consequence in one sentence and the primary action. Sticks to the bottom on phones so the
 * decision is always within thumb reach.
 */
function ActionBar({ next, primary, warn }: { next: string; primary: ReactNode; warn?: string }) {
  return (
    <div className="sticky bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-30 -mx-4 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:rounded-card sm:border sm:bg-surface sm:px-4 lg:bottom-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 text-meta text-muted">{warn ? <span className="text-attn-fg">{warn}</span> : next}</p>
        <div className="flex flex-wrap items-center gap-2">{primary}</div>
      </div>
    </div>
  );
}

function mockScreenshot(company: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="#f3f1ed"/><rect x="0" y="0" width="800" height="48" fill="#2b2722"/><text x="24" y="31" font-family="sans-serif" font-size="18" fill="#fffefc">${company}</text><rect x="200" y="120" width="400" height="220" rx="12" fill="#fffefc" stroke="#e9e5df"/><circle cx="400" cy="180" r="22" fill="#2f5a8a"/><path d="M389 181l8 8 15-17" stroke="#fffefc" stroke-width="4" fill="none"/><text x="400" y="250" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#2b2722">Application received</text><text x="400" y="280" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#6b645b">Thank you for applying. We will be in touch.</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
