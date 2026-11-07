"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/Button";
import { FormError } from "@/components/auth/fields";
import { api, type AppStatus, type Application, type ApplicationDetail, type Question } from "@/lib/api";
import { CANCELLABLE, isCancelled } from "@/lib/app-state";
import { noriReact } from "@/lib/auth-flow";
import { usePolling } from "@/lib/use-polling";
import { usePanel } from "./AppShell";

/* The live panel (4a spec section 7): a job, or an application playing its real status and run log. A side panel from
   1024 px, an overlay from 768, a modal sheet below that. */

export const STATUS_LABEL: Record<AppStatus, string> = {
  queued: "Getting it ready",
  preparing: "Getting it ready",
  prepared: "Ready for your OK",
  applying: "Applying",
  awaiting_code: "Waiting for a code",
  needs_user: "Needs you",
  submitted: "Sent",
  failed: "Didn't go through",
};
/** The status chip's words; a cancelled application isn't a failure. */
export const statusLabel = (a: Application) => (isCancelled(a) ? "Cancelled" : STATUS_LABEL[a.status]);
const MOVING: AppStatus[] = ["queued", "preparing", "applying", "awaiting_code"];
/** Nori's event for each status (section 10); needs_user without questions is a wall. */
const NORI: Record<AppStatus, string> = {
  queued: "preparing",
  preparing: "preparing",
  prepared: "prepared",
  applying: "applying",
  awaiting_code: "awaiting-code",
  needs_user: "needs-user",
  submitted: "submitted",
  failed: "failed",
};

const seconds = (from: string | null, to: string | null, now: number) => (from ? Math.max(0, Math.round(((to ? Date.parse(to) : now) - Date.parse(from)) / 1000)) : 0);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const box = "rounded-[14px] p-3.5 text-small leading-[1.55]";

function Answers({ questions, onSend, busy }: { questions: Question[]; onSend: (a: Record<string, string>) => void; busy: boolean }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]);
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const gap = questions.filter((q) => q.required && !values[q.id]?.trim()).map((q) => q.id);
        setMissing(gap);
        if (gap.length) return document.getElementById(`answer-${gap[0]}`)?.focus();
        onSend(values);
      }}
      className={`${box} flex flex-col gap-3 border-2 border-warning`}
    >
      <p className="font-semibold text-ink">
        Nori needs {questions.length} {questions.length === 1 ? "answer" : "answers"} to finish this one.
      </p>
      {questions.map((q) => {
        const choices = q.options.length ? q.options : q.type === "boolean" || q.type === "yesno" ? ["Yes", "No"] : [];
        const err = missing.includes(q.id) ? "Answer this one to carry on" : null;
        return choices.length ? (
          <fieldset key={q.id} className="flex flex-col gap-2">
            <legend className="mb-2 font-semibold text-ink">{q.text}</legend>
            <div className="flex flex-wrap gap-2">
              {choices.map((c, i) => (
                <label key={c} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-[1.5px] border-line-strong bg-surface px-3.5 text-small has-[:checked]:border-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink">
                  <input id={i === 0 ? `answer-${q.id}` : undefined} type="radio" name={`q-${q.id}`} checked={values[q.id] === c} onChange={() => setValues((v) => ({ ...v, [q.id]: c }))} className="size-4 accent-accent" />
                  {c}
                </label>
              ))}
            </div>
            {err && <p className="text-small text-danger">{err}</p>}
          </fieldset>
        ) : (
          <div key={q.id} className="flex flex-col gap-1.5">
            <label htmlFor={`answer-${q.id}`} className="font-semibold text-ink">
              {q.text}
            </label>
            <input
              id={`answer-${q.id}`}
              value={values[q.id] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [q.id]: e.target.value }))}
              aria-invalid={err ? true : undefined}
              className="h-11 rounded-input border-[1.5px] border-line-strong bg-bg px-3 text-body text-ink aria-invalid:border-danger"
            />
            {err && <p className="text-small text-danger">{err}</p>}
          </div>
        );
      })}
      <p className="text-[0.75rem] text-ink-2">Saved to your answer bank, so Nori won&rsquo;t ask again.</p>
      <button type="submit" aria-disabled={busy || undefined} className={buttonClass("primary", "min-h-11 self-start")}>
        {busy ? "Sending…" : "Send answers"}
      </button>
    </form>
  );
}

/** What the API takes as a typed code (routes/applications.ts `TypedCode`). */
const CODE = /^[A-Za-z0-9 -]{3,20}$/;

/**
 * The verification code the employer emailed to the person's own address, which Nori can't read: the run waits on the
 * employer's page (status awaiting_code, about 8 minutes) for the person to type it here. `onGone`: the API said the
 * application isn't waiting any more (409); the page refreshes and shows where it is now.
 */
function CodeBox({ id, refresh, onGone }: { id: string; refresh: () => Promise<void>; onGone: (why: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function send() {
    if (busy) return;
    const code = value.trim();
    const why = !code ? "Type the code from the email" : CODE.test(code) ? null : "A code is 3 to 20 letters or digits, as it appears in the email";
    setError(why);
    if (why) return input.current?.focus();
    setBusy(true);
    const r = await api.code(id, code);
    setBusy(false);
    if (r.ok) {
      setSent(true);
      return void refresh();
    }
    if (r.status === 409) {
      onGone(r.error);
      return void refresh();
    }
    setError(r.error);
    input.current?.focus();
  }

  return sent ? (
    <div className={`${box} flex flex-col items-start gap-1.5 border-2 border-accent`}>
      <p role="status" className="font-semibold text-ink">
        Got it, finishing your application…
      </p>
      <button type="button" onClick={() => (setSent(false), setValue(""))} className="min-h-10 text-small font-semibold text-ink underline underline-offset-[3px]">
        Type a different code
      </button>
    </div>
  ) : (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className={`${box} flex flex-col gap-2.5 border-2 border-warning`}
    >
      <label htmlFor={`code-${id}`} className="font-semibold text-ink">
        The employer just emailed you a verification code. Type it here and Nori will finish the application.
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          id={`code-${id}`}
          // The one thing to do while the run waits, and the box appears only then.
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="one-time-code"
          inputMode="text"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          aria-invalid={error ? true : undefined}
          aria-describedby={`code-${id}-hint${error ? ` code-${id}-error` : ""}`}
          className="h-11 w-full max-w-[14rem] rounded-input border-[1.5px] border-line-strong bg-bg px-3 font-mono text-body tracking-[0.08em] text-ink aria-invalid:border-danger"
        />
        <button type="submit" aria-disabled={busy || undefined} className={buttonClass("primary", "min-h-11")}>
          {busy ? "Sending…" : "Send code"}
        </button>
      </div>
      {error && (
        <p id={`code-${id}-error`} className="text-small text-danger">
          {error}
        </p>
      )}
      <p id={`code-${id}-hint`} className="text-[0.75rem] text-ink-2">
        Nori keeps the employer&rsquo;s page open for about 8 minutes. After that, Try again sends a new code.
      </p>
    </form>
  );
}

/** A quiet way to drop an application before Nori is on the employer's page, confirmed in place. */
function CancelAction({ busy, onCancel }: { busy: boolean; onCancel: () => void }) {
  const [asking, setAsking] = useState(false);
  const stop = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (asking) stop.current?.focus();
  }, [asking]);
  return asking ? (
    <div role="group" aria-labelledby="cancel-ask" className={`${box} flex flex-col items-start gap-2.5 border-[1.5px] border-line`}>
      <p id="cancel-ask" className="text-ink">
        Stop this application? Nori won&rsquo;t send it. You can try again later.
      </p>
      <div className="flex flex-wrap gap-2">
        <button ref={stop} type="button" onClick={onCancel} aria-disabled={busy || undefined} className={buttonClass("outline", "min-h-11")}>
          {busy ? "Stopping…" : "Stop it"}
        </button>
        <button type="button" onClick={() => setAsking(false)} className="min-h-11 px-2 text-small font-semibold text-ink underline underline-offset-[3px]">
          Keep it
        </button>
      </div>
    </div>
  ) : (
    <button type="button" onClick={() => setAsking(true)} className="min-h-10 self-start text-small font-medium text-ink-2 underline underline-offset-[3px] hover:text-ink">
      Cancel application
    </button>
  );
}

/** Every 2 s while the application moves, every 30 s once it waits on you or is done. */
export const useApplication = (id: string | null) =>
  usePolling(id ? `app:${id}` : null, () => api.application(id ?? ""), (d: ApplicationDetail | null) => (!d || MOVING.includes(d.application.status) ? 2000 : 30_000));

function ApplicationView({ id }: { id: string }) {
  const poll = useApplication(id);
  if (!poll.data) return <p className="text-small text-ink-2">{poll.error ?? "Loading…"}</p>;
  return <ApplicationBody detail={poll.data} refresh={poll.refresh} />;
}

/**
 * An application's live content: its status, the run log and what it needs (Send it, answers, a wall, Try again).
 * The panel polls for it; the application's own page (4b spec section 4) passes its own detail in and skips the
 * receipt, which it shows itself.
 */
export function ApplicationBody({ detail, refresh, onPage = false }: { detail: ApplicationDetail; refresh: () => Promise<void>; onPage?: boolean }) {
  const id = detail.application.id;
  const status = detail.application.status;
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const said = useRef<string | null>(null);

  // Nori plays each status once (section 10).
  useEffect(() => {
    const s = detail.application.status;
    const key = `${id}:${s}`;
    if (said.current === key) return;
    said.current = key;
    // A cancelled application was the person's choice: Nori doesn't react as if it failed.
    if (isCancelled(detail.application)) return;
    const wall = s === "needs_user" && detail.application.pendingQuestions.length === 0 && detail.application.receipt?.codeMissing !== true;
    void noriReact({ event: wall ? "captcha" : NORI[s] });
  }, [detail, id]);

  // The timer ticks while it's applying.
  useEffect(() => {
    if (status !== "applying" && status !== "awaiting_code") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);

  async function act(fn: () => Promise<{ ok: boolean; status: number; error?: string; detail?: string }>) {
    setBusy(true);
    setFailure(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) {
      // Over the daily limit the application stays ready; the API's detail says what the limit is (4c spec section 7).
      setFailure([r.error ?? "That didn't work.", r.detail].filter(Boolean).join(" "));
      if (r.status === 429 && r.detail) void noriReact({ event: "cap-reached" });
    }
    void refresh();
  }

  const a = detail.application;
  const wall = a.status === "needs_user" && a.pendingQuestions.length === 0;
  // The wait for a typed code ran out (the receipt says codeMissing): unlike a captcha, Try again can get past it.
  const codeLate = wall && a.receipt?.codeMissing === true;
  const cancelled = isCancelled(a);
  const lines = detail.events
    .filter((e) => e.level !== "debug" && e.message)
    .filter((e, i, all) => i === 0 || all[i - 1]?.message !== e.message)
    .slice(-8);
  const took = seconds(a.approvedAt, a.submittedAt, now);
  return (
    <div className="flex flex-col gap-4">
      {a.status === "awaiting_code" && <CodeBox key={a.id} id={a.id} refresh={refresh} onGone={setFailure} />}
      <div className="flex items-center justify-between">
        <span role="status" className="rounded-full bg-tint px-2.5 py-1 text-[0.75rem] font-medium text-ink">
          {statusLabel(a)}
        </span>
        {a.approvedAt && <span className="font-mono text-[1.125rem] text-ink laptop:text-[1.25rem]">{clock(took)}</span>}
      </div>
      {lines.length > 0 && (
        <ol aria-label="What Nori has done" className="flex flex-col gap-2.5">
          {lines.map((e, i) => {
            const last = i === lines.length - 1 && MOVING.includes(a.status);
            return (
              <li key={e.id} className="flex items-start gap-2.5 text-small leading-[1.45]">
                <span aria-hidden="true" className={`w-[18px] flex-none text-center ${e.level === "warn" ? "text-warning" : last ? "text-ink" : "text-accent"}`}>
                  {e.level === "warn" ? "!" : last ? "•" : "✓"}
                </span>
                <span className="text-ink">{e.message}</span>
              </li>
            );
          })}
        </ol>
      )}

      {a.status === "prepared" && (
        <>
          <div className={`${box} bg-surface-2`}>
            <p className="mb-1.5 font-semibold text-ink">Ready to send</p>
            <p className="text-ink-2">Check the resume and answers, then send it. Nothing goes out until you do.</p>
          </div>
          {detail.resume && detail.resume.changes.length > 0 && (
            <div className={`${box} flex flex-col gap-2.5 border-[1.5px] border-line`}>
              <p className="font-semibold text-ink">
                Your tailored resume · {detail.resume.changes.length} {detail.resume.changes.length === 1 ? "line" : "lines"} changed
              </p>
              {detail.resume.changes.slice(0, 4).map((c, i) => (
                <div key={i} className="flex flex-col gap-0.5">
                  <p className="text-ink">
                    <mark className="rounded-[4px] bg-tint px-0.5 text-ink">{c.after}</mark>
                  </p>
                  {c.reason && <p className="text-[0.75rem] text-ink-2">{c.reason}</p>}
                </div>
              ))}
            </div>
          )}
          <button type="button" onClick={() => void act(() => api.approve(a.id))} aria-disabled={busy || undefined} className={buttonClass("primary", "min-h-11 self-start")}>
            {busy ? "Sending…" : "Send it"}
          </button>
        </>
      )}

      {a.status === "needs_user" && !wall && <Answers questions={a.pendingQuestions} busy={busy} onSend={(answers) => void act(() => api.answer(a.id, answers))} />}

      {codeLate && (
        <div className={`${box} flex flex-col items-start gap-2 border-2 border-warning text-ink`}>
          <p>No code reached Nori in time, so the application isn&rsquo;t finished. Try again and Nori fills the form once more; the employer emails a new code, and you type it here.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void act(() => api.retry(a.id))} aria-disabled={busy || undefined} className={buttonClass("primary", "min-h-11")}>
              {busy ? "Trying…" : "Try again"}
            </button>
            <a href={detail.job.applyUrl} target="_blank" rel="noreferrer" className={buttonClass("outline", "min-h-11")}>
              Finish on the employer&rsquo;s page
            </a>
          </div>
        </div>
      )}

      {wall && !codeLate && (
        <div className={`${box} border-2 border-warning text-ink`}>
          <p className="mb-2">{a.error ?? "This site asked for something only you can do."} Nori never gets around those; finish it yourself and Nori will pick up the reply.</p>
          <a href={detail.job.applyUrl} target="_blank" rel="noreferrer" className={buttonClass("outline", "min-h-11")}>
            Open the application page
          </a>
        </div>
      )}

      {cancelled && (
        <div className={`${box} flex flex-col items-start gap-2 bg-surface-2 text-ink`}>
          <p>You cancelled this application, so Nori won&rsquo;t send it.</p>
          <button type="button" onClick={() => void act(() => api.retry(a.id))} aria-disabled={busy || undefined} className={buttonClass("outline", "min-h-11")}>
            {busy ? "Trying…" : "Try again"}
          </button>
        </div>
      )}

      {a.status === "failed" && !cancelled && (
        <div className={`${box} border-2 border-danger text-ink`}>
          <p className="mb-2">
            {a.error ?? "Something went wrong."} {a.submittedAt ? "" : "Nothing was sent."}
          </p>
          <button type="button" onClick={() => void act(() => api.retry(a.id))} aria-disabled={busy || undefined} className={buttonClass("primary", "min-h-11")}>
            {busy ? "Trying…" : "Try again"}
          </button>
        </div>
      )}

      {a.status === "submitted" && !onPage && (
        <>
          <div className={`${box} bg-surface-2`}>
            <p className="mb-1 font-serif text-[1.5rem] leading-[1.1] text-ink">Sent in {took} seconds</p>
            {typeof a.receipt?.confirmation === "string" && <p className="font-mono text-label text-ink-2">Confirmation {a.receipt.confirmation}</p>}
            {a.receipt?.dryRun === true && <p className="text-[0.75rem] text-ink-2">A practice run: nothing reached the employer.</p>}
          </div>
          <Link href={`/applications/${a.id}`} className={buttonClass("outline", "min-h-11 self-start")}>
            View the application
          </Link>
        </>
      )}
      {failure && <FormError>{failure}</FormError>}
      {CANCELLABLE.includes(a.status) && <CancelAction busy={busy} onCancel={() => void act(() => api.cancel(a.id))} />}
    </div>
  );
}

function JobView({ jobId, reasons, onApply }: { jobId: string; reasons: string[]; onApply: () => void }) {
  const job = usePolling(`job:${jobId}`, () => api.job(jobId), 300_000);
  const [more, setMore] = useState(false);
  const text = job.data?.descriptionText ?? "";
  return (
    <div className="flex flex-col gap-3.5">
      {reasons.map((r) => (
        <p key={r} className="flex gap-2 text-small leading-[1.45] text-ink-2">
          <span aria-hidden="true" className="text-accent">
            ●
          </span>
          {r}
        </p>
      ))}
      {job.data ? (
        <div className="text-small leading-[1.6] whitespace-pre-line text-ink">
          {more || text.length <= 1200 ? text : `${text.slice(0, 1200)}…`}
          {text.length > 1200 && (
            <button type="button" onClick={() => setMore((m) => !m)} className="ml-1 font-semibold underline underline-offset-[3px]">
              {more ? "Show less" : "Read more"}
            </button>
          )}
        </div>
      ) : (
        <p className="text-small text-ink-2">{job.error ?? "Loading the job…"}</p>
      )}
      <button type="button" onClick={onApply} className={buttonClass("primary", "min-h-11 self-start")}>
        Apply
      </button>
    </div>
  );
}

export function LivePanel() {
  const { panel, close, open } = usePanel();
  const title = useRef<HTMLHeadingElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [apps, setApps] = useState<{ id: string; title: string; meta: string }[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    title.current?.focus();
  }, [panel]);

  // Esc closes; on phones (a modal sheet) Tab stays inside.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close();
      if (e.key !== "Tab" || matchMedia("(min-width: 1024px)").matches || !sheet.current) return;
      const f = [...sheet.current.querySelectorAll<HTMLElement>("a[href], button, input, [tabindex='0']")].filter((el) => !el.hasAttribute("disabled"));
      const first = f[0];
      const last = f[f.length - 1];
      const to = e.shiftKey && document.activeElement === first ? last : !e.shiftKey && document.activeElement === last ? first : null;
      if (!to) return;
      e.preventDefault();
      to.focus();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [close]);

  // Titles for the stacked applications (Send all), from the list the API keeps.
  const ids = panel?.kind === "apps" ? panel.ids.join(",") : "";
  useEffect(() => {
    if (!ids) return;
    void api.applications().then((r) => {
      if (!r.ok) return;
      setApps(ids.split(",").map((id) => {
        const row = r.data.find((x) => x.application.id === id);
        return { id, title: row?.job.title ?? "Application", meta: row ? `${row.job.companyName}${row.job.location ? ` · ${row.job.location}` : ""}` : "" };
      }));
    });
  }, [ids]);

  if (!panel) return null;
  const current = panel.kind === "apps" ? apps[panel.index] : null;
  const heading = panel.kind === "job" ? panel.entry.job.title : (current?.title ?? "Application");
  const meta = panel.kind === "job" ? `${panel.entry.job.companyName}${panel.entry.job.location ? ` · ${panel.entry.job.location}` : ""} · fit ${panel.entry.fit.toFixed(2)}` : (current?.meta ?? "");

  async function applyFromJob() {
    if (panel?.kind !== "job") return;
    const r = await api.apply(panel.entry.jobId);
    if (!r.ok) return setFailure(r.error);
    open({ kind: "apps", ids: [r.data.id], index: 0 });
  }

  return (
    <>
      <div aria-hidden="true" onClick={close} className="fixed inset-0 z-[65] bg-[rgb(0_0_0/0.35)] laptop:hidden" />
      <div
        ref={sheet}
        aria-labelledby="panel-title"
        role="dialog"
        aria-modal="true"
        data-live-panel
        className="fixed z-[70] flex flex-col overflow-y-auto bg-surface max-tablet:inset-x-0 max-tablet:top-8 max-tablet:bottom-0 max-tablet:rounded-t-[22px] tablet:inset-y-0 tablet:right-0 tablet:w-[420px] tablet:border-l-[1.5px] tablet:border-line laptop:sticky laptop:top-0 laptop:z-auto laptop:h-svh"
      >
        <span aria-hidden="true" className="mx-auto mt-2.5 block h-1 w-10 rounded-full bg-line tablet:hidden" />
        <div className="flex items-center justify-between gap-3 border-b-[1.5px] border-line px-4 py-3 laptop:px-5 laptop:py-4">
          <p className="text-small text-ink-2">{panel.kind === "job" ? "Job" : "Application"}</p>
          <div className="flex items-center gap-2">
            {panel.kind === "apps" && panel.ids.length > 1 && (
              <p className="flex items-center gap-1 text-small text-ink-2">
                <button type="button" aria-label="Previous application" disabled={panel.index === 0} onClick={() => open({ ...panel, index: panel.index - 1 })} className="grid size-11 place-items-center rounded-full hover:bg-tint disabled:opacity-40">
                  ‹
                </button>
                <span className="font-mono">
                  {panel.index + 1} of {panel.ids.length}
                </span>
                <button type="button" aria-label="Next application" disabled={panel.index === panel.ids.length - 1} onClick={() => open({ ...panel, index: panel.index + 1 })} className="grid size-11 place-items-center rounded-full hover:bg-tint disabled:opacity-40">
                  ›
                </button>
              </p>
            )}
            <button type="button" aria-label="Close the panel" onClick={close} className="grid size-11 place-items-center rounded-full bg-tint text-ink">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-4 p-4 laptop:p-5">
          <div>
            <h2 id="panel-title" ref={title} tabIndex={-1} className="text-[1.3125rem] leading-[1.25] font-semibold text-ink outline-none laptop:text-[1.375rem]">
              {heading}
            </h2>
            <p className="mt-1.5 text-small text-ink-2">{meta}</p>
          </div>
          {panel.kind === "job" ? <JobView jobId={panel.entry.jobId} reasons={panel.entry.reasons} onApply={() => void applyFromJob()} /> : <ApplicationView key={panel.ids[panel.index]} id={panel.ids[panel.index] ?? ""} />}
          {failure && <FormError>{failure}</FormError>}
        </div>
      </div>
    </>
  );
}
