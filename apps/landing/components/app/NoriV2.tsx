"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { buttonClass } from "@/components/Button";
import { FormError } from "@/components/auth/fields";
import {
  api,
  type Batch,
  type NoriAction,
  type NoriMessage,
  type NoriSchedule,
} from "@/lib/api";
import { shortDate } from "@/lib/app-state";
import { usePolling } from "@/lib/use-polling";
import { PageHead } from "./PageHead";

/*
 * /nori, dashboard v2 (docs/dashboard-v2-plan.md section 6): talk with your agent. The chat (GET/POST /api/nori/chat)
 * lists every change Nori made under its reply, each with Undo (Stop for Apply now). Beside it, the setup card shows what
 * the chat edits: roles, the daily cap with what went out today, the threshold with how many jobs are Recommended, the
 * schedule, and Apply now (POST /api/nori/batches { recommended: true }). Every number on it is the API's.
 */

const PAGE = 50;
const MAX_BATCH = 50;
const card = "flex flex-col rounded-card border-[1.5px] border-line bg-surface";
const link =
  "font-semibold text-ink underline decoration-accent underline-offset-[3px]";
const quiet =
  "min-h-10 px-1 text-small font-semibold text-ink underline decoration-accent underline-offset-[3px] hover:decoration-ink";

const clockOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
const stamp = (iso: string) =>
  new Date(iso).toDateString() === new Date().toDateString()
    ? clockOf(iso)
    : `${shortDate(iso)}, ${clockOf(iso)}`;

const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_NAME: Record<string, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};
function daysOf(days: string[]) {
  const s = new Set(days);
  if (s.size === 7) return "Every day";
  if (s.size === 5 && WEEK.slice(0, 5).every((d) => s.has(d)))
    return "Weekdays";
  if (s.size === 2 && s.has("sat") && s.has("sun")) return "Weekends";
  return WEEK.filter((d) => s.has(d))
    .map((d) => DAY_NAME[d])
    .join(", ");
}
function clock24(hhmm: string) {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
const zoneOf = (tz: string) =>
  typeof Intl !== "undefined" &&
  Intl.DateTimeFormat().resolvedOptions().timeZone === tz
    ? "your time"
    : tz.replace(/_/g, " ");
const scheduleOn = (s: NoriSchedule | null | undefined) =>
  !!s?.enabled && !s.paused;
const scheduleLine = (s: NoriSchedule) =>
  `${daysOf(s.days)} at ${clock24(s.time)}, ${zoneOf(s.timezone)}`;
const runDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

// ---- The setup card -------------------------------------------------------------------------------------------------------

type Setup = {
  roles: string[] | null;
  cap: number | null;
  sentToday: number | null;
  threshold: number | null;
  recommended: { count: number; more: boolean } | null;
  schedule: NoriSchedule | null;
  running: Batch | null;
  offline: boolean;
};

function Row({
  title,
  onChange,
  changeLabel,
  children,
}: {
  title: React.ReactNode;
  onChange?: () => void;
  changeLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-t-[1.5px] border-line pt-3.5 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-small font-semibold text-ink-2">{title}</h3>
        {onChange && (
          <button
            type="button"
            onClick={onChange}
            aria-label={changeLabel}
            className={quiet}
          >
            Change
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function ApplyNow({
  setup,
  onChanged,
}: {
  setup: Setup;
  onChanged: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const run = setup.running;
  const upTo =
    setup.recommended && setup.cap
      ? Math.max(1, Math.min(setup.recommended.count, setup.cap, MAX_BATCH))
      : undefined;

  async function start() {
    setBusy(true);
    setFailure(null);
    setSaid(null);
    const r = await api.applyRecommended(upTo);
    setBusy(false);
    setAsking(false);
    if (r.ok)
      setSaid(
        `Started: ${r.data.added} ${r.data.added === 1 ? "application" : "applications"}, one at a time.`,
      );
    else if (r.status === 409)
      setSaid(
        r.error === "No Recommended jobs to send right now"
          ? "No Recommended jobs to send right now. Nori sends new matches at or above your threshold that you haven’t applied to."
          : r.error,
      );
    else setFailure(r.error);
    onChanged();
  }
  async function stop(id: string) {
    setBusy(true);
    setFailure(null);
    const r = await api.stopBatch(id);
    setBusy(false);
    if (!r.ok) return setFailure(r.error);
    setSaid(
      "Stopped. What hadn’t started is cancelled; anything sent stays sent.",
    );
    onChanged();
  }

  return (
    <div className="flex flex-col gap-2.5 border-t-[1.5px] border-line pt-3.5">
      {run ? (
        <>
          <p role="status" className="text-body font-semibold text-ink">
            Applying now: {run.counts.sent} of {run.counts.total} sent
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link href="/applications" className={`${link} text-small`}>
              Watch them in Applications
            </Link>
            <button
              type="button"
              onClick={() => void stop(run.id)}
              aria-disabled={busy || undefined}
              className={quiet}
            >
              {busy ? "Stopping…" : "Stop"}
            </button>
          </div>
        </>
      ) : asking ? (
        <div
          role="group"
          aria-labelledby="apply-ask"
          className="flex flex-col items-start gap-2.5 rounded-row border-2 border-accent p-3.5"
        >
          <p id="apply-ask" className="text-small text-ink">
            Nori sends {upTo ? `up to ${upTo}` : "your"} Recommended{" "}
            {upTo === 1 ? "job" : "jobs"} in your name, one at a time, within
            your daily cap.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void start()}
              aria-disabled={busy || undefined}
              className={buttonClass("primary", "min-h-11")}
            >
              {busy ? "Starting…" : "Yes, apply now"}
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              className={quiet}
            >
              Not yet
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className={buttonClass("primary", "min-h-11 w-full")}
        >
          Apply now
        </button>
      )}
      {said && (
        <p role="status" className="text-small text-ink">
          {said}
        </p>
      )}
      {failure && <FormError>{failure}</FormError>}
      <p className="text-small text-ink-2">
        Only Recommended jobs, never all of them.
      </p>
    </div>
  );
}

function SetupCard({
  setup,
  prefill,
  onChanged,
}: {
  setup: Setup;
  prefill: (text: string) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { roles, cap, sentToday, threshold, recommended, schedule } = setup;
  const summary = [
    roles ? `${roles.length} ${roles.length === 1 ? "role" : "roles"}` : null,
    cap !== null ? `${cap} a day` : null,
    threshold !== null ? `${threshold}+` : null,
    schedule
      ? scheduleOn(schedule)
        ? daysOf(schedule.days)
        : "No schedule"
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <aside
      aria-labelledby="setup-title"
      className={`${card} laptop:sticky laptop:top-6 laptop:order-2`}
    >
      <h2
        id="setup-title"
        className="sr-only laptop:not-sr-only laptop:px-5 laptop:pt-5 laptop:text-[1.25rem] laptop:font-semibold laptop:text-ink"
      >
        Nori&rsquo;s setup
      </h2>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="setup-body"
        onClick={() => setOpen(!open)}
        className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-left laptop:hidden"
      >
        <span className="min-w-0">
          <span className="block font-semibold text-ink">Setup</span>
          {summary && (
            <span className="block truncate text-small text-ink-2">
              {summary}
            </span>
          )}
        </span>
        <span
          aria-hidden="true"
          className={`flex-none text-ink-2 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      <div
        id="setup-body"
        className={`${open ? "flex" : "hidden"} flex-col gap-3.5 border-t-[1.5px] border-line p-4 laptop:flex laptop:border-t-0 laptop:p-5 laptop:pt-3`}
      >
        {setup.offline && (
          <p className="text-small text-ink-2">
            Couldn&rsquo;t reach Norinote. This card tries again by itself.
          </p>
        )}
        <Row
          title={
            <>
              Roles
              {roles ? (
                <span className="font-normal"> · {roles.length}</span>
              ) : null}
            </>
          }
        >
          {roles === null ? (
            <p className="text-small text-ink-2">Loading…</p>
          ) : roles.length === 0 ? (
            <p className="text-small text-ink-2">
              No roles yet. Tell Nori one to look for.
            </p>
          ) : (
            <ul aria-label="Your roles" className="flex flex-wrap gap-1.5">
              {roles.map((r) => (
                <li
                  key={r}
                  className="rounded-full bg-tint px-3 py-1 text-small text-ink"
                >
                  {r}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => prefill("Add a role: ")}
            className={`${quiet} self-start`}
          >
            Add a role
          </button>
        </Row>
        <Row
          title="Daily cap"
          onChange={() => prefill("Set my daily cap to ")}
          changeLabel="Change the daily cap"
        >
          <p className="text-body text-ink">
            {cap === null ? (
              "…"
            ) : (
              <>
                <b className="text-[1.25rem] tabular-nums">{cap}</b> a day
                {sentToday !== null && (
                  <span className="text-ink-2"> · {sentToday} sent today</span>
                )}
              </>
            )}
          </p>
        </Row>
        <Row
          title="Threshold score"
          onChange={() => prefill("Only send ones at ")}
          changeLabel="Change the threshold score"
        >
          <p className="text-body text-ink">
            {threshold === null ? (
              "…"
            ) : (
              <>
                <b className="text-[1.25rem] tabular-nums">{threshold}</b> or
                above
              </>
            )}
          </p>
          {recommended && (
            <p className="text-small text-ink-2">
              <Link href="/jobs" className={link}>
                {recommended.count}
                {recommended.more ? "+" : ""} Recommended now
              </Link>
              : your matches in your roles at this score or above.
            </p>
          )}
        </Row>
        {schedule && (
          <Row
            title="Schedule"
            onChange={() =>
              prefill(
                scheduleOn(schedule)
                  ? "Pause the schedule"
                  : "Apply every weekday at 9:00",
              )
            }
            changeLabel="Change the schedule"
          >
            {scheduleOn(schedule) ? (
              <>
                <p className="text-body font-semibold text-ink">
                  {scheduleLine(schedule)}
                </p>
                <p className="text-small text-ink-2">
                  New Recommended jobs go out on their own, within your cap.
                  {schedule.nextRunOn
                    ? ` Next: ${runDate(schedule.nextRunOn)}.`
                    : ""}
                </p>
              </>
            ) : (
              <p className="text-small text-ink-2">
                {schedule.enabled && schedule.paused
                  ? "Paused. Nothing goes out on its own until you turn it back on."
                  : "Off. Nori only applies when you say so."}
              </p>
            )}
          </Row>
        )}
        <ApplyNow setup={setup} onChanged={onChanged} />
      </div>
    </aside>
  );
}

// ---- The chat -------------------------------------------------------------------------------------------------------------

type UndoState = { busy?: boolean; done?: string; error?: string };

function Actions({
  actions,
  undo,
  undos,
}: {
  actions: NoriAction[];
  undo: (a: NoriAction) => void;
  undos: Record<string, UndoState>;
}) {
  return (
    <ul aria-label="What Nori changed" className="mt-2 flex flex-col gap-1.5">
      {actions.map((a, i) => {
        const u = a.undoId ? undos[a.undoId] : undefined;
        const label = a.kind === "apply_now" ? "Stop" : "Undo";
        return (
          <li
            key={a.undoId ?? i}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-row border-[1.5px] border-line bg-surface px-3 py-1.5"
          >
            <span
              className={`text-small font-semibold ${u?.done ? "text-ink-2 line-through" : "text-ink"}`}
            >
              {a.summary}
            </span>
            {a.undoId &&
              (u?.done ? (
                <span className="text-small text-ink-2">{u.done}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => undo(a)}
                  aria-disabled={u?.busy || undefined}
                  aria-label={`${label}: ${a.summary}`}
                  className={quiet}
                >
                  {u?.busy
                    ? label === "Stop"
                      ? "Stopping…"
                      : "Undoing…"
                    : label}
                </button>
              ))}
            {u?.error && (
              <span className="w-full text-small text-danger">{u.error}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Bubble({
  m,
  undo,
  undos,
}: {
  m: NoriMessage;
  undo: (a: NoriAction) => void;
  undos: Record<string, UndoState>;
}) {
  const nori = m.role === "nori";
  return (
    <li
      className={`flex max-w-[88%] flex-col gap-1 ${nori ? "self-start" : "items-end self-end"}`}
    >
      <div
        className={`rounded-bubble px-4 py-2.5 text-body whitespace-pre-wrap ${nori ? "rounded-bl-md bg-tint text-ink" : "rounded-br-md bg-accent text-on-accent"}`}
      >
        <span className="sr-only">{nori ? "Nori: " : "You: "}</span>
        {m.text}
        {nori && m.actions.length > 0 && (
          <Actions actions={m.actions} undo={undo} undos={undos} />
        )}
      </div>
      {m.createdAt && (
        <span className="px-1 text-[0.75rem] text-ink-2">
          {stamp(m.createdAt)}
        </span>
      )}
    </li>
  );
}

const usedUp = (m: NoriMessage) =>
  m.role === "nori" && /AI budget/i.test(m.text);

export function NoriV2() {
  const settings = usePolling("nori-settings", api.noriSettings, 600_000);
  const lanes = usePolling("nori-lanes", api.lanes, 600_000);
  const schedule = usePolling("nori-schedule", api.noriSchedule, 600_000);
  const status = usePolling("nori-status", api.agentStatus, 60_000);
  const batches = usePolling("nori-batches", api.batches, (d) =>
    d?.batches.some((b) => b.status === "running") ? 10_000 : 60_000,
  );
  const minFit = settings.data?.settings.minFit;
  const rec = usePolling(
    minFit === undefined ? null : `nori-rec:${minFit}`,
    () => api.recommended(minFit ?? 0),
    300_000,
  );

  const [messages, setMessages] = useState<NoriMessage[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [budgetOut, setBudgetOut] = useState(false);
  const [undos, setUndos] = useState<Record<string, UndoState>>({});
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stick = useRef(true);

  // After every change Nori makes (or undoes), the card reads everything again.
  const refreshSetup = () => {
    for (const p of [settings, lanes, schedule, status, batches, rec])
      void p.refresh();
  };

  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    const r = await api.noriChat();
    if (!r.ok) return setHistoryError(r.error);
    stick.current = true;
    setMessages(r.data.messages);
    setMore(r.data.messages.length >= PAGE);
  }, []);
  useEffect(() => {
    // Loads the conversation once when the page opens; the request's answer sets the state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadHistory();
  }, [loadHistory]);

  // New messages scroll the log to its end; earlier ones, loaded at the top, keep the reader where they were.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  async function earlier() {
    const first = messages?.[0];
    if (!first) return;
    setLoadingEarlier(true);
    const r = await api.noriChat(first.createdAt);
    setLoadingEarlier(false);
    if (!r.ok) return setFailure(r.error);
    const el = logRef.current;
    const from = el ? el.scrollHeight - el.scrollTop : 0;
    stick.current = false;
    setMessages((m) => [...r.data.messages, ...(m ?? [])]);
    setMore(r.data.messages.length >= PAGE);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - from;
    });
  }

  async function send(text: string) {
    const t = text.trim().slice(0, 2000);
    if (!t || pending) return;
    setFailure(null);
    setPending(t);
    setDraft("");
    stick.current = true;
    const r = await api.sendNori(t);
    setPending(null);
    if (!r.ok) {
      setDraft(t);
      return setFailure(r.error);
    }
    setMessages((m) => [...(m ?? []), r.data.message, r.data.reply]);
    setBudgetOut(usedUp(r.data.reply));
    if (r.data.reply.actions.length) refreshSetup();
  }

  async function undo(a: NoriAction) {
    const id = a.undoId;
    if (!id || undos[id]?.busy) return;
    setUndos((u) => ({ ...u, [id]: { busy: true } }));
    const r = await api.undoNori(id);
    if (!r.ok) {
      setUndos((u) => ({
        ...u,
        [id]: {
          error: r.status === 404 ? "This can’t be undone any more." : r.error,
        },
      }));
      return;
    }
    setUndos((u) => ({
      ...u,
      [id]: {
        done: r.data.ok
          ? r.data.summary || "Undone"
          : r.data.summary || "Already undone",
      },
    }));
    refreshSetup();
  }

  function prefill(text: string) {
    setDraft(text);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
    });
  }

  const sched = schedule.data?.schedule ?? null;
  const items = rec.data ?? null;
  const setup: Setup = {
    roles: lanes.data
      ? lanes.data.filter((l) => l.enabled).map((l) => l.name)
      : null,
    cap: settings.data?.settings.dailyLimit ?? null,
    sentToday: status.data?.usedToday ?? null,
    threshold: minFit === undefined ? null : Math.round(minFit * 100),
    recommended: items
      ? {
          count: items.filter((i) => !i.applicationStatus).length,
          more: items.length >= 200,
        }
      : null,
    schedule: sched,
    running: batches.data?.batches.find((b) => b.status === "running") ?? null,
    offline: !settings.data && !!settings.error && settings.status !== 401,
  };

  // A chip either sends its words at once (Apply now, Pause) or puts them in the box to finish (a number, a role, a time).
  const chips: { label: string; text: string; now: boolean }[] = [
    { label: "Apply now", text: "Apply now", now: true },
    { label: "Set a daily cap", text: "Set my daily cap to ", now: false },
    { label: "Add a role", text: "Add a role: ", now: false },
    ...(sched
      ? [
          scheduleOn(sched)
            ? {
                label: "Pause the schedule",
                text: "Pause the schedule",
                now: true,
              }
            : {
                label: "Schedule it",
                text: "Apply every weekday at 9:00",
                now: false,
              },
        ]
      : []),
  ];

  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 pb-24 tablet:gap-5 tablet:px-8 tablet:pb-12 laptop:px-10 laptop:pt-7"
    >
      <PageHead>
        <h1 className="font-serif text-[2rem] leading-[1.05] text-ink laptop:text-[2.5rem]">
          Nori
        </h1>
        <p className="mt-1 text-small text-ink-2 tablet:text-body">
          Talk with your agent. Anything it changes shows up here and in its
          setup, and can be undone.
        </p>
      </PageHead>
      <div className="flex flex-col gap-4 laptop:grid laptop:grid-cols-[minmax(0,1fr)_340px] laptop:items-start laptop:gap-6">
        <SetupCard setup={setup} prefill={prefill} onChanged={refreshSetup} />
        <section
          aria-labelledby="chat-title"
          className={`${card} min-w-0 laptop:order-1`}
        >
          <h2 id="chat-title" className="sr-only">
            Chat with Nori
          </h2>
          <div
            ref={logRef}
            className="flex max-h-[62dvh] min-h-[280px] flex-col overflow-y-auto p-4 tablet:p-5 laptop:h-[calc(100dvh-330px)] laptop:max-h-none laptop:min-h-[380px]"
          >
            {more && (
              <button
                type="button"
                onClick={() => void earlier()}
                aria-disabled={loadingEarlier || undefined}
                className={`${quiet} mb-3 self-center`}
              >
                {loadingEarlier ? "Loading…" : "Show earlier messages"}
              </button>
            )}
            {messages === null ? (
              historyError ? (
                <div className="flex flex-col items-start gap-2">
                  <p className="text-small text-ink-2">{historyError}</p>
                  <button
                    type="button"
                    onClick={() => void loadHistory()}
                    className={quiet}
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <p className="text-small text-ink-2">
                  Loading your conversation…
                </p>
              )
            ) : (
              <div
                role="log"
                aria-label="Your conversation with Nori"
                aria-live="polite"
                className="mt-auto"
              >
                <ol className="flex flex-col gap-3">
                  {messages.length === 0 && !pending && (
                    <li className="max-w-[88%] self-start rounded-bubble rounded-bl-md bg-tint px-4 py-2.5 text-body text-ink">
                      <span className="sr-only">Nori: </span>
                      Ask me which roles I look for, or tell me what to change:
                      add a role, set your daily cap or the threshold score, or
                      apply now.
                    </li>
                  )}
                  {messages.map((m) => (
                    <Bubble
                      key={m.id}
                      m={m}
                      undo={(a) => void undo(a)}
                      undos={undos}
                    />
                  ))}
                  {pending && (
                    <>
                      <li className="flex max-w-[88%] flex-col items-end self-end">
                        <div className="rounded-bubble rounded-br-md bg-accent px-4 py-2.5 text-body whitespace-pre-wrap text-on-accent">
                          <span className="sr-only">You: </span>
                          {pending}
                        </div>
                      </li>
                      <li className="self-start text-small text-ink-2">
                        Nori is thinking…
                      </li>
                    </>
                  )}
                </ol>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2.5 border-t-[1.5px] border-line p-3 tablet:p-4">
            <ul aria-label="Quick asks" className="flex flex-wrap gap-2">
              {chips.map((c) => (
                <li key={c.label}>
                  <button
                    type="button"
                    onClick={() =>
                      c.now ? void send(c.text) : prefill(c.text)
                    }
                    aria-disabled={!!pending || undefined}
                    className="min-h-11 rounded-row bg-accent-tint px-4 text-[0.9375rem] font-semibold text-accent hover:bg-tint aria-disabled:opacity-60"
                  >
                    {c.label}
                  </button>
                </li>
              ))}
            </ul>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
              className="flex gap-2"
            >
              <label htmlFor="nori-message" className="sr-only">
                Message Nori
              </label>
              <input
                id="nori-message"
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={2000}
                autoComplete="off"
                placeholder="Message Nori"
                className="h-12 min-w-0 flex-1 rounded-input border-[1.5px] border-line-strong bg-bg px-3.5 text-body text-ink"
              />
              <button
                type="submit"
                aria-disabled={!draft.trim() || !!pending || undefined}
                className={buttonClass(
                  "primary",
                  "min-h-12 aria-disabled:opacity-60",
                )}
              >
                Send
              </button>
            </form>
            {budgetOut && (
              <p
                role="status"
                className="rounded-row bg-warning-tint px-3.5 py-2.5 text-small text-ink"
              >
                Today&rsquo;s AI budget for chatting is used up, so Nori
                can&rsquo;t change anything from here until tomorrow. The setup
                card and Apply now still work.
              </p>
            )}
            {failure && <FormError>{failure}</FormError>}
          </div>
        </section>
      </div>
    </main>
  );
}
