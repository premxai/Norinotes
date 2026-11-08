"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClass } from "@/components/Button";
import { FormError } from "@/components/auth/fields";
import { api, type Batch, type BatchSkip, type Needs, type NeedsItem, type NoriSettings, type ShortlistEntry } from "@/lib/api";
import { shortDate } from "@/lib/app-state";
import { usePolling } from "@/lib/use-polling";
import { CompanyLogo } from "./CompanyLogo";
import { Answers, ApplicationBody, STATUS_LABEL, useApplication } from "./LivePanel";
import { PageHead } from "./PageHead";

/*
 * /nori, "Apply for me" (api-contract.md, Nori page): the person picks jobs and approves them at once; Nori sends them one
 * at a time, a few minutes apart and within the daily limit, and parks anything only the person can answer. The page
 * shows what's running (with Watch Nori apply), what needs them, how Nori works for them, what's connected, and past
 * batches.
 */

const card = "flex flex-col gap-4 rounded-card border-[1.5px] border-line bg-surface p-4 tablet:p-6";
const h2 = "text-[1.125rem] font-semibold text-ink tablet:text-[1.25rem]";
const MAX_BATCH = 50;
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const when = (iso: string) => `${shortDate(iso)}, ${time(iso)}`;

const SKIPPED: Record<string, string> = {
  not_found: "isn’t available any more",
  skipped_company: "is at a company you skip",
  same_company: "is at a company already in this batch",
  already_applied: "was already sent",
  duplicate_recent: "was applied to recently",
  not_supported: "isn’t on Greenhouse yet",
};
/** "Apply for me" sends Greenhouse applications for now (the API's BATCH_ATS). A shortlist without `atsType` filters nothing. */
const batchable = (e: ShortlistEntry) => e.job.atsType === undefined || e.job.atsType === "greenhouse";

/** "4 of 10 sent · 1 needs you · 5 waiting", from a batch's counts. */
function progress(b: Batch) {
  const c = b.counts;
  const waiting = c.working + c.preparing + c.ready;
  return [`${c.sent} of ${c.total} sent`, c.needsYou ? `${c.needsYou} needs you` : null, waiting ? `${waiting} waiting` : null, c.cancelled ? `${c.cancelled} cancelled` : null, c.failed ? `${c.failed} didn’t go through` : null].filter(Boolean).join(" · ");
}

function waitingLine(b: Batch) {
  if (b.waitingFor === "spacing") return b.nextAt ? `Next one at ${time(b.nextAt)}` : "Next one in a few minutes";
  if (b.waitingFor === "daily_limit") return "Today’s limit reached, continues tomorrow";
  if (b.waitingFor === "preparing") return "Preparing resumes";
  if (b.waitingFor === "you") return "Waiting on you";
  return b.counts.working ? "Applying now" : null;
}

// ---- Now working --------------------------------------------------------------------------------------------------------

/** The application of the batch that's on the employer's page: Watch Nori apply, its run log, and its code box. */
function ActiveRun({ id, title, company }: { id: string; title: string; company: string }) {
  const poll = useApplication(id);
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border-[1.5px] border-line p-4">
      <p className="text-small text-ink-2">
        Now: <b className="text-ink">{title}</b> at {company}
      </p>
      {poll.data ? <ApplicationBody detail={poll.data} refresh={poll.refresh} onPage /> : <p className="text-small text-ink-2">{poll.error ?? "Loading…"}</p>}
    </div>
  );
}

function NowWorking({ batch, onChange }: { batch: Batch; onChange: () => void }) {
  const detail = usePolling(`nori-batch:${batch.id}`, () => api.batch(batch.id), 5000);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const active = detail.data?.applications?.find((a) => a.status === "applying" || a.status === "awaiting_code");
  const b = detail.data?.batch ?? batch;
  const line = waitingLine(b);
  async function stop() {
    setBusy(true);
    setFailure(null);
    const r = await api.stopBatch(b.id);
    setBusy(false);
    setAsking(false);
    if (!r.ok) setFailure(r.error);
    onChange();
    void detail.refresh();
  }
  return (
    <section aria-labelledby="now-title" className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="now-title" className={h2}>
          Now working
        </h2>
        <p className="text-small text-ink-2">Started {when(b.createdAt)}</p>
      </div>
      <div className="flex flex-col gap-2">
        <p role="status" className="text-body font-semibold text-ink">
          {progress(b)}
        </p>
        <div role="meter" aria-label="Sent so far" aria-valuemin={0} aria-valuemax={b.counts.total} aria-valuenow={b.counts.sent} className="h-2 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-accent" style={{ width: `${b.counts.total ? (b.counts.sent / b.counts.total) * 100 : 0}%` }} />
        </div>
        {line && <p className="text-small text-ink-2">{line}</p>}
      </div>
      {active && <ActiveRun key={active.id} id={active.id} title={active.title} company={active.company} />}
      {asking ? (
        <div role="group" aria-labelledby="stop-ask" className="flex flex-col items-start gap-2.5 rounded-[14px] border-[1.5px] border-line p-3.5">
          <p id="stop-ask" className="text-small text-ink">
            Stop the rest? What hasn&rsquo;t started is cancelled; anything already sent stays sent.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void stop()} aria-disabled={busy || undefined} className={buttonClass("outline", "min-h-11")}>
              {busy ? "Stopping…" : "Stop the rest"}
            </button>
            <button type="button" onClick={() => setAsking(false)} className="min-h-11 px-2 text-small font-semibold text-ink underline underline-offset-[3px]">
              Keep going
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAsking(true)} className="min-h-10 self-start text-small font-medium text-ink-2 underline underline-offset-[3px] hover:text-ink">
          Stop the rest
        </button>
      )}
      {failure && <FormError>{failure}</FormError>}
    </section>
  );
}

// ---- Needs you ----------------------------------------------------------------------------------------------------------

const NEEDS: [Needs, string][] = [
  ["questions", "Questions only you can answer"],
  ["code", "A code that didn’t arrive in time"],
  ["captcha", "A captcha"],
  ["account", "An account to sign in to"],
  ["other", "Something else"],
];

/** The parked application's questions, answered here; it resumes by itself. */
function QuestionsItem({ item, onDone }: { item: NeedsItem; onDone: () => void }) {
  const poll = useApplication(item.applicationId);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const questions = poll.data?.application.pendingQuestions ?? [];
  if (!poll.data) return <p className="text-small text-ink-2">{poll.error ?? "Loading the questions…"}</p>;
  return (
    <>
      <Answers
        questions={questions}
        busy={busy}
        idPrefix={`q-${item.applicationId}`}
        onSend={async (answers) => {
          setBusy(true);
          setFailure(null);
          const r = await api.answer(item.applicationId, answers);
          setBusy(false);
          if (!r.ok) return setFailure(r.error);
          onDone();
        }}
      />
      {failure && <FormError>{failure}</FormError>}
    </>
  );
}

function NeedsItemRow({ item, onDone }: { item: NeedsItem; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  async function retry() {
    setBusy(true);
    const r = await api.retry(item.applicationId);
    setBusy(false);
    if (!r.ok) return setFailure(r.error);
    onDone();
  }
  return (
    <li className="flex flex-col gap-3 rounded-[14px] border-2 border-warning p-4">
      <p className="text-body text-ink">
        <Link href={`/applications/${item.applicationId}`} className="font-semibold text-ink underline decoration-accent underline-offset-[3px]">
          {item.title}
        </Link>{" "}
        at {item.company}
      </p>
      {item.needs === "questions" ? (
        <QuestionsItem item={item} onDone={onDone} />
      ) : (
        <>
          {item.reason && <p className="text-small text-ink-2">{item.reason}</p>}
          <div className="flex flex-wrap gap-2">
            {item.needs === "code" && (
              <button type="button" onClick={() => void retry()} aria-disabled={busy || undefined} className={buttonClass("primary", "min-h-11")}>
                {busy ? "Trying…" : "Try again"}
              </button>
            )}
            {(item.needs === "captcha" || item.needs === "account" || item.needs === "code") && (
              <a href={item.applyUrl} target="_blank" rel="noreferrer" className={buttonClass("outline", "min-h-11")}>
                Finish on the employer&rsquo;s page<span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
            {item.needs === "other" && (
              <Link href={`/applications/${item.applicationId}`} className={buttonClass("outline", "min-h-11")}>
                Open the application
              </Link>
            )}
          </div>
          {failure && <FormError>{failure}</FormError>}
        </>
      )}
    </li>
  );
}

function NeedsYou({ items, onDone }: { items: NeedsItem[]; onDone: () => void }) {
  return (
    <section aria-labelledby="needs-title" className={card}>
      <h2 id="needs-title" className={h2}>
        Needs you <span className="text-ink-2">· {items.length}</span>
      </h2>
      <p className="-mt-2 text-small text-ink-2">Nori parks these rather than guess. Answer them and they carry on by themselves.</p>
      {NEEDS.map(([kind, title]) => {
        const group = items.filter((i) => i.needs === kind);
        if (!group.length) return null;
        return (
          <div key={kind} className="flex flex-col gap-2.5">
            <h3 className="text-small font-semibold text-ink-2">{title}</h3>
            <ul className="flex flex-col gap-2.5">
              {group.map((i) => (
                <NeedsItemRow key={i.applicationId} item={i} onDone={onDone} />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

// ---- Apply for me -------------------------------------------------------------------------------------------------------

function ApplyForMe({ settings, pick, onStarted }: { settings: NoriSettings | null; pick: string[]; onStarted: () => void }) {
  const list = usePolling("nori-shortlist", api.shortlist, 120_000);
  const [chosen, setChosen] = useState<string[]>(pick);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<{ added: number; skipped: { title: string; reason: string }[] } | null>(null);
  const all = [...(list.data ?? [])].sort((a, b) => b.fit - a.fit);
  const entries = all.filter(batchable);
  const hidden = all.length - entries.length;
  const minFit = settings?.minFit ?? 0.7;
  // A pick from Today that isn't on Greenhouse isn't listed, so it isn't sent either.
  const picked = chosen.filter((id) => entries.some((e) => e.jobId === id));
  const n = picked.length;
  const over = n > MAX_BATCH;
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const title = (id: string) => entries.find((e) => e.jobId === id)?.job.title ?? "A job";
  async function start() {
    setBusy(true);
    setFailure(null);
    const r = await api.startBatch(picked);
    setBusy(false);
    setConfirming(false);
    if (!r.ok) return setFailure(r.error);
    setDone({ added: r.data.added, skipped: r.data.skipped.map((s: BatchSkip) => ({ title: title(s.jobId), reason: SKIPPED[s.reason] ?? "couldn’t be added" })) });
    setChosen([]);
    onStarted();
  }
  return (
    <section aria-labelledby="apply-title" className={card}>
      <div>
        <h2 id="apply-title" className={h2}>
          Apply for me
        </h2>
        <p className="mt-1 text-small text-ink-2">Pick jobs, press once, close the laptop. Nori sends them one at a time and stops to ask when it can&rsquo;t answer something truthfully.</p>
      </div>
      {done && (
        <div role="status" className="rounded-[14px] bg-accent-tint p-3.5 text-small text-ink">
          <p className="font-semibold">
            Nori is on it: {done.added} {done.added === 1 ? "application" : "applications"}, one at a time.
          </p>
          {done.skipped.length > 0 && (
            <ul className="mt-1.5 list-disc pl-5 text-ink-2">
              {done.skipped.map((s, i) => (
                <li key={i}>
                  {s.title} {s.reason}, so it was left out.
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!list.data ? (
        <p className="text-small text-ink-2">{list.error ?? "Loading your matches…"}</p>
      ) : entries.length === 0 ? (
        <p className="text-small text-ink-2">No matches to pick from yet. Nori finds new ones every morning.</p>
      ) : (
        <>
          {hidden > 0 && (
            <p className="text-small text-ink-2">
              Nori sends Greenhouse applications for now, so {hidden} other {hidden === 1 ? "match isn’t" : "matches aren’t"} listed here.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setChosen(entries.filter((e) => e.fit >= minFit).map((e) => e.jobId))} className={buttonClass("outline", "min-h-10 px-4 text-small")}>
              All strong matches ({entries.filter((e) => e.fit >= minFit).length})
            </button>
            <button type="button" onClick={() => setChosen(entries.slice(0, 10).map((e) => e.jobId))} className={buttonClass("outline", "min-h-10 px-4 text-small")}>
              Top 10
            </button>
            {n > 0 && (
              <button type="button" onClick={() => setChosen([])} className="min-h-10 px-2 text-small font-semibold text-ink underline underline-offset-[3px]">
                Clear
              </button>
            )}
          </div>
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="sr-only">Your matches</legend>
            <ul className="flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1">
              {entries.map((e: ShortlistEntry) => (
                <li key={e.jobId}>
                  <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-row border-[1.5px] border-line px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent-tint has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink">
                    <input type="checkbox" checked={chosen.includes(e.jobId)} onChange={() => toggle(e.jobId)} className="size-5 flex-none accent-accent" />
                    <CompanyLogo name={e.job.companyName} url={e.job.companyLogoUrl} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.9375rem] font-semibold text-ink">{e.job.title}</span>
                      <span className="block truncate text-small text-ink-2">{[e.job.companyName, e.job.remote && !e.job.location ? "Remote" : e.job.location].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="flex-none rounded-full bg-tint px-2.5 py-1 text-[0.8125rem] font-medium text-ink tabular-nums">{e.fit.toFixed(2)} match</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          {over && <p className="text-small text-warning">A batch takes up to {MAX_BATCH}. Untick a few.</p>}
          {confirming ? (
            <div role="group" aria-labelledby="apply-ask" className="flex flex-col items-start gap-3 rounded-[14px] border-2 border-accent p-4">
              <p id="apply-ask" className="text-body text-ink">
                Nori will send these {n} {n === 1 ? "application" : "applications"} in your name, one at a time, and only stops to ask when it can&rsquo;t answer something truthfully.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void start()} aria-disabled={busy || undefined} className={buttonClass("primary", "min-h-11")}>
                  {busy ? "Starting…" : "Yes, apply for me"}
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="min-h-11 px-2 text-small font-semibold text-ink underline underline-offset-[3px]">
                  Not yet
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => n && !over && setConfirming(true)} aria-disabled={!n || over || undefined} className={buttonClass("primary", "min-h-11 self-start aria-disabled:opacity-50")}>
              Apply for me ({n})
            </button>
          )}
          {failure && <FormError>{failure}</FormError>}
        </>
      )}
    </section>
  );
}

// ---- How Nori works for you ---------------------------------------------------------------------------------------------

function HowNoriWorks({ settings, onSaved }: { settings: NoriSettings; onSaved: () => void }) {
  const [form, setForm] = useState(settings);
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const num = (k: "dailyLimit" | "spacingMinutes" | "minFit") => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: Number(e.target.value) }));
  function add() {
    const name = company.trim();
    if (name && !form.skipCompanies.some((c) => c.toLowerCase() === name.toLowerCase())) setForm((f) => ({ ...f, skipCompanies: [...f.skipCompanies, name] }));
    setCompany("");
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaid(null);
    setFailure(null);
    const r = await api.saveNoriSettings(form);
    setBusy(false);
    if (!r.ok) return setFailure([r.error, r.detail].filter(Boolean).join(" "));
    setForm(r.data.settings);
    setSaid("Saved.");
    onSaved();
  }
  const field = "h-11 w-28 rounded-input border-[1.5px] border-line-strong bg-bg px-3 text-body text-ink tabular-nums";
  return (
    <section aria-labelledby="how-title" className={card}>
      <h2 id="how-title" className={h2}>
        How Nori works for you
      </h2>
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
        <div className="grid gap-4 tablet:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-small font-semibold text-ink">
            Daily limit
            <input type="number" min={1} max={100} value={form.dailyLimit} onChange={num("dailyLimit")} className={field} />
            <span className="font-normal text-ink-2">Most it sends in a day.</span>
          </label>
          <label className="flex flex-col gap-1.5 text-small font-semibold text-ink">
            Minutes between applications
            <input type="number" min={1} max={60} value={form.spacingMinutes} onChange={num("spacingMinutes")} className={field} />
            <span className="font-normal text-ink-2">So it applies at a person&rsquo;s pace.</span>
          </label>
          <label className="flex flex-col gap-1.5 text-small font-semibold text-ink">
            Strong match from
            <input type="number" min={0} max={1} step={0.05} value={form.minFit} onChange={num("minFit")} className={field} />
            <span className="font-normal text-ink-2">For &ldquo;All strong matches&rdquo;.</span>
          </label>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="skip-company" className="text-small font-semibold text-ink">
            Companies to skip
          </label>
          {form.skipCompanies.length > 0 && (
            <ul aria-label="Companies Nori skips" className="flex flex-wrap gap-2">
              {form.skipCompanies.map((c) => (
                <li key={c} className="flex items-center gap-1 rounded-full bg-tint py-1 pr-1 pl-3 text-small text-ink">
                  {c}
                  <button type="button" aria-label={`Stop skipping ${c}`} onClick={() => setForm((f) => ({ ...f, skipCompanies: f.skipCompanies.filter((x) => x !== c) }))} className="grid size-8 place-items-center rounded-full hover:bg-line">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              id="skip-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="A company name"
              className="h-11 min-w-0 flex-1 rounded-input border-[1.5px] border-line-strong bg-bg px-3 text-body text-ink tablet:max-w-[320px]"
            />
            <button type="button" onClick={add} className={buttonClass("outline", "min-h-11")}>
              Add
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" aria-disabled={busy || undefined} className={buttonClass("primary", "min-h-11")}>
            {busy ? "Saving…" : "Save"}
          </button>
          <p role="status" className="text-small text-ink-2">
            {said}
          </p>
        </div>
        {failure && <FormError>{failure}</FormError>}
      </form>
    </section>
  );
}

// ---- Connections --------------------------------------------------------------------------------------------------------

function Connections() {
  const gmail = usePolling("nori-gmail", api.gmail, 60_000);
  const telegram = usePolling("nori-telegram", api.telegram, 300_000);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const g = gmail.data;
  async function connect() {
    setBusy(true);
    setFailure(null);
    const r = await api.connectGmail();
    setBusy(false);
    if (!r.ok) return setFailure(r.error);
    location.assign(r.data.url);
  }
  async function disconnect() {
    setBusy(true);
    const r = await api.disconnectGmail();
    setBusy(false);
    setAsking(false);
    if (!r.ok) return setFailure(r.error);
    void gmail.refresh();
  }
  const row = "flex flex-col gap-2 rounded-[14px] border-[1.5px] border-line p-4 tablet:flex-row tablet:items-center tablet:justify-between";
  return (
    <section aria-labelledby="connect-title" className={card}>
      <div>
        <h2 id="connect-title" className={h2}>
          Connections
        </h2>
        <p className="mt-1 text-small text-ink-2">What keeps working while you&rsquo;re away.</p>
      </div>
      <div className={row}>
        <div>
          <p className="font-semibold text-ink">Gmail, for emailed codes</p>
          <p className="text-small text-ink-2">
            {!g
              ? (gmail.error ?? "Checking…")
              : !g.available
                ? "Not available here yet. You can still type a code when one is asked for."
                : g.connected
                  ? "Connected. Nori reads the code an employer emails you, and nothing else."
                  : g.status === "EXPIRED"
                    ? "The connection expired. Connect it again so codes keep arriving."
                    : "Not connected. Without it, you type each code yourself."}
          </p>
        </div>
        {g?.available &&
          (g.connected ? (
            asking ? (
              <div className="flex gap-2">
                <button type="button" onClick={() => void disconnect()} aria-disabled={busy || undefined} className={buttonClass("outline", "min-h-11")}>
                  {busy ? "Disconnecting…" : "Yes, disconnect"}
                </button>
                <button type="button" onClick={() => setAsking(false)} className="min-h-11 px-2 text-small font-semibold text-ink underline underline-offset-[3px]">
                  Keep it
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setAsking(true)} className={buttonClass("outline", "min-h-11 self-start")}>
                Disconnect
              </button>
            )
          ) : (
            <button type="button" onClick={() => void connect()} aria-disabled={busy || undefined} className={buttonClass("primary", "min-h-11 self-start")}>
              {busy ? "Opening Google…" : "Connect Gmail"}
            </button>
          ))}
      </div>
      <div className={row}>
        <div>
          <p className="font-semibold text-ink">Telegram, for questions and news</p>
          <p className="text-small text-ink-2">{!telegram.data ? (telegram.error ?? "Checking…") : telegram.data.linked ? "Connected. Nori messages you when it needs you, and when something is sent." : "Not connected. You’ll see what needs you here and in your email."}</p>
        </div>
        <Link href="/settings/connections" className={buttonClass("outline", "min-h-11 self-start")}>
          {telegram.data?.linked ? "Telegram settings" : "Set up Telegram"}
        </Link>
      </div>
      {failure && <FormError>{failure}</FormError>}
    </section>
  );
}

// ---- History --------------------------------------------------------------------------------------------------------------

const BATCH_STATUS: Record<Batch["status"], string> = { running: "Running", stopped: "Stopped", done: "Done" };

function BatchApplications({ id }: { id: string }) {
  const detail = usePolling(`nori-batch-history:${id}`, () => api.batch(id), 300_000);
  if (!detail.data) return <p className="text-small text-ink-2">{detail.error ?? "Loading…"}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {(detail.data.applications ?? []).map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-3 text-small">
          <Link href={`/applications/${a.id}`} className="min-w-0 truncate text-ink underline decoration-accent underline-offset-[3px]">
            {a.title} <span className="text-ink-2">at {a.company}</span>
          </Link>
          <span className="flex-none rounded-full bg-tint px-2.5 py-0.5 text-[0.75rem] font-medium text-ink">{a.status === "failed" && a.error === "Cancelled by you" ? "Cancelled" : STATUS_LABEL[a.status]}</span>
        </li>
      ))}
    </ul>
  );
}

function History({ batches }: { batches: Batch[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section aria-labelledby="history-title" className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="history-title" className={h2}>
          History
        </h2>
        <Link href="/tracker" className="text-small font-semibold text-ink underline decoration-accent underline-offset-[3px]">
          Where they went, in Tracker
        </Link>
      </div>
      {batches.length === 0 ? (
        <p className="text-small text-ink-2">Your batches will show here.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {batches.map((b) => (
            <li key={b.id} className="rounded-[14px] border-[1.5px] border-line">
              <button type="button" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left">
                <span>
                  <span className="block font-semibold text-ink">{when(b.createdAt)}</span>
                  <span className="block text-small text-ink-2">{progress(b)}</span>
                </span>
                <span className="flex-none rounded-full bg-tint px-2.5 py-1 text-[0.75rem] font-medium text-ink">{BATCH_STATUS[b.status]}</span>
              </button>
              {open === b.id && (
                <div className="border-t-[1.5px] border-line px-4 py-3">
                  <BatchApplications id={b.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- The page -----------------------------------------------------------------------------------------------------------

export function NoriPage() {
  const batches = usePolling("nori-batches", api.batches, (d) => (d?.batches.some((b) => b.status === "running") ? 5000 : 60_000));
  const needs = usePolling("nori-needs", api.needsYou, 15_000);
  const settings = usePolling("nori-settings", api.noriSettings, 600_000);
  // Today's "Let Nori send these" arrives with ?pick=<jobId>,<jobId>. Read once; the list renders only after it loads.
  const [pick] = useState(() => (typeof window === "undefined" ? [] : (new URLSearchParams(location.search).get("pick") ?? "").split(",").filter(Boolean)));
  const running = batches.data?.batches.find((b) => b.status === "running") ?? null;
  const offline = !batches.data && !!batches.error && batches.status !== 401;
  const refresh = () => {
    void batches.refresh();
    void needs.refresh();
  };
  return (
    <main id="main" className="mx-auto flex max-w-[960px] flex-col gap-4 px-4 pb-24 tablet:gap-5 tablet:px-8 tablet:pb-12 laptop:px-10 laptop:pt-7">
      <PageHead>
        <h1 className="font-serif text-[2rem] leading-[1.05] text-ink laptop:text-[2.5rem]">Nori</h1>
        <p className="mt-1 text-small text-ink-2 tablet:text-body">Pick jobs, press Apply for me, and Nori sends them one at a time.</p>
      </PageHead>
      {offline ? (
        <div className={card}>
          <p className="font-serif text-[1.5rem] text-ink">Couldn&rsquo;t reach Norinote</p>
          <p className="text-ink-2">Check your connection; this page tries again by itself.</p>
        </div>
      ) : (
        <>
          {!!needs.data?.items.length && <NeedsYou items={needs.data.items} onDone={refresh} />}
          {running && <NowWorking key={running.id} batch={running} onChange={refresh} />}
          <ApplyForMe settings={settings.data?.settings ?? null} pick={pick} onStarted={refresh} />
          {settings.data && <HowNoriWorks settings={settings.data.settings} onSaved={() => void settings.refresh()} />}
          <Connections />
          {batches.data && <History batches={batches.data.batches} />}
        </>
      )}
    </main>
  );
}
