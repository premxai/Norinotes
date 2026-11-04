"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/Button";
import { FormError } from "@/components/auth/fields";
import { api, type InboxKind, type InboxMessage, type InboxSettings } from "@/lib/api";
import { fullTime, shortDate } from "@/lib/app-state";
import { noriReact } from "@/lib/auth-flow";
import { usePolling } from "@/lib/use-polling";
import { PageHead } from "./PageHead";

/* /inbox and /inbox/:id (4b spec section 5): the address and settings, the list, and the open message (a pane beside
   the list from 1024 px, its own page below that). It's the layout of both routes, so the list stays put as messages
   open. */

const KIND: Record<InboxKind, string> = {
  verification_code: "Code",
  confirmation: "Confirmation",
  recruiter_reply: "Reply",
  interview: "Interview",
  rejection: "Rejection",
  offer: "Offer",
  other: "Other",
};
const KIND_CHIP: Partial<Record<InboxKind, string>> = { interview: "bg-peach-tint text-ink", offer: "bg-accent-tint text-accent", recruiter_reply: "bg-accent-tint text-accent", rejection: "bg-danger-tint text-ink" };
const REPLIES: InboxKind[] = ["recruiter_reply", "interview", "rejection", "offer"];
const FILTERS = [
  { id: "all", label: "All" },
  { id: "codes", label: "Codes" },
  { id: "replies", label: "Replies" },
] as const;
// The API keeps 1 to 365 days; no choice (null) is its default, 90.
const RETENTION = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "365 days" },
];
const SEEN_KEY = "norinote-inbox-seen-at";
const wide = () => matchMedia("(min-width: 1024px)").matches;
const safeLink = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);

function listTime(iso: string, now: number) {
  const d = new Date(iso);
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return shortDate(iso);
}

/** Copies, then says "Copied" for 2 s, out loud too. */
function CopyButton({ text, label, className = "" }: { text: string; label: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setDone(true);
            setTimeout(() => setDone(false), 2000);
          } catch {
            // No clipboard access (an insecure page, or refused): the text is on screen to copy by hand.
          }
        }}
        className={`min-h-11 rounded-full border-[1.5px] border-ink px-4 text-small font-semibold text-ink hover:bg-tint ${className}`}
      >
        {done ? "Copied" : label}
      </button>
      <span role="status" className="sr-only">
        {done ? "Copied" : ""}
      </span>
    </>
  );
}

function Settings({ initial, onSaved }: { initial: InboxSettings; onSaved: (s: InboxSettings) => void }) {
  const [forward, setForward] = useState(initial.forwardEnabled);
  const [to, setTo] = useState(initial.forwardTo ?? "");
  const [keep, setKeep] = useState(String(initial.retentionDays ?? 90));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const days = initial.retentionDays;
  const summary = `${initial.forwardEnabled && initial.forwardTo ? `Forwarding to ${initial.forwardTo}` : "Not forwarding"} · ${days === null ? "kept 90 days" : `kept ${days === 365 ? "a year" : `${days} days`}`}`;
  return (
    <details className="group rounded-[14px] border-[1.5px] border-line bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="font-semibold text-ink">Settings</span> <span className="text-small text-ink-2">· {summary}</span>
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="flex-none transition-transform group-open:rotate-180">
          <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </summary>
      <form
        noValidate
        className="flex flex-col gap-4 border-t-[1.5px] border-line px-4 pt-4 pb-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setFailure(null);
          setSaved(false);
          // The API quietly turns forwarding off without an address, so say so here instead.
          if (forward && !to.trim()) return setFailure("Add the email to forward to.");
          setBusy(true);
          const r = await api.inboxSettings({ forwardEnabled: forward, forwardTo: to.trim() || null, retentionDays: Number(keep) });
          setBusy(false);
          if (!r.ok) return setFailure(r.error);
          setSaved(true);
          onSaved(r.data.settings);
        }}
      >
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-ink">
          <input type="checkbox" checked={forward} onChange={(e) => setForward(e.target.checked)} className="size-5 accent-accent" />
          Forward a copy to my email
        </label>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="forward-to" className="font-semibold text-ink">
            My email
          </label>
          <input
            id="forward-to"
            type="email"
            autoComplete="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-11 max-w-[360px] rounded-input border-[1.5px] border-line-strong bg-bg px-3 text-body text-ink"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="keep-for" className="font-semibold text-ink">
            Keep messages for
          </label>
          <select id="keep-for" value={keep} onChange={(e) => setKeep(e.target.value)} className="h-11 max-w-[200px] rounded-input border-[1.5px] border-line-strong bg-bg px-3 text-body text-ink">
            {RETENTION.map((r) => (
              <option key={r.label} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" aria-disabled={busy || undefined} className={buttonClass("primary", "min-h-11")}>
            {busy ? "Saving…" : "Save"}
          </button>
          <span role="status" className="text-small text-ink-2">
            {saved ? "Saved." : ""}
          </span>
        </div>
        {failure && <FormError>{failure}</FormError>}
      </form>
    </details>
  );
}

function MessageView({ m, onPhone }: { m: InboxMessage; onPhone: boolean }) {
  const title = useRef<HTMLHeadingElement>(null);
  const link = safeLink(m.verificationLink);
  const entered = m.kind === "verification_code" && !!m.application && m.application.status !== "awaiting_code";

  // On phones the message is a new page, so focus goes to its subject (section 8).
  useEffect(() => {
    if (onPhone && !wide()) title.current?.focus();
  }, [m.id, onPhone]);

  return (
    <article aria-labelledby="message-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 id="message-title" ref={title} tabIndex={-1} className="text-[1.375rem] leading-[1.25] font-semibold text-ink outline-none">
          {m.subject || "(no subject)"}
        </h2>
        <p className="text-small text-ink-2">
          {m.fromName ? `${m.fromName} · ` : ""}
          <span className="break-all">{m.fromAddress}</span>
        </p>
        <p className="text-small text-ink-2">{fullTime(m.receivedAt)}</p>
      </div>

      {m.spam && <p className="rounded-[14px] border-2 border-warning px-4 py-3 text-small text-ink">Marked as spam. Nori doesn&rsquo;t use codes or links from it.</p>}

      {m.code && (
        <div className="flex flex-col gap-2.5 rounded-[14px] bg-surface-2 p-4">
          <p className="text-small text-ink-2">The code</p>
          {/* Geist with tabular figures, not Mono: the mono font (70 KB) would load with the Inbox's first message. */}
          <p className="text-[2rem] leading-none font-semibold tracking-[0.12em] text-ink tabular-nums">{m.code}</p>
          <div className="flex flex-wrap items-center gap-3">
            <CopyButton text={m.code} label="Copy the code" />
            {entered && <span className="text-small text-ink-2">Nori already entered it.</span>}
          </div>
        </div>
      )}

      {link && !m.spam && (
        <a href={link} target="_blank" rel="noreferrer noopener" className={buttonClass("outline", "min-h-11 self-start")}>
          Confirm with the employer<span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}

      <div className="text-small leading-[1.65] break-words whitespace-pre-line text-ink tablet:text-body">{m.bodyText || "This message has no text."}</div>

      {m.attachments.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-small font-semibold text-ink">Attachments</p>
          <ul className="flex flex-col gap-1 text-small text-ink-2">
            {m.attachments.map((f, i) => (
              <li key={i}>
                {f.filename} · {Math.max(1, Math.round(f.size / 1024))} KB
              </li>
            ))}
          </ul>
        </div>
      )}

      {m.application && (
        <Link href={`/applications/${m.application.id}`} className={buttonClass("outline", "min-h-11 self-start")}>
          Open the application
        </Link>
      )}
    </article>
  );
}

export function Inbox() {
  const params = useParams<{ id?: string }>();
  const id = params.id ?? null;
  const router = useRouter();
  const address = usePolling("inbox-address", api.inboxAddress, 600_000);
  const list = usePolling("inbox", api.inbox, 30_000);
  const inList = list.data?.find((m) => m.id === id);
  // A message older than the list's 200, opened from a link.
  const single = usePolling(id && list.data && !inList ? `message:${id}` : null, () => api.message(id ?? ""), 600_000);
  const open = inList ?? single.data;
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [settings, setSettings] = useState<InboxSettings | null>(null);
  const [now] = useState(() => Date.now());
  // "New" is anything received after the last visit (the API keeps no read flag), and stays new until opened.
  const [seenAt] = useState(() => {
    try {
      return typeof window === "undefined" ? null : localStorage.getItem(SEEN_KEY);
    } catch {
      return null;
    }
  });
  const [opened, setOpened] = useState<string[]>([]);

  const newest = list.data?.[0]?.receivedAt;
  useEffect(() => {
    if (!newest) return;
    try {
      const seen = localStorage.getItem(SEEN_KEY);
      if (!seen || newest > seen) localStorage.setItem(SEEN_KEY, newest);
    } catch {
      // Storage blocked: nothing shows as new.
    }
  }, [newest]);

  // From 1024 px the newest message is open on arrival, and the URL follows so Back works.
  const first = list.data?.[0]?.id;
  const autoOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!id && first && wide()) {
      autoOpened.current = first;
      router.replace(`/inbox/${first}`);
    }
  }, [id, first, router]);

  // Nori checks the mail while a message is open, and catches a code (section 7); back to idle on leaving.
  const openId = open?.id;
  const hasCode = !!open?.code;
  useEffect(() => {
    if (!openId) return;
    // The message opened for you on arrival waits until the page has settled, as a first screen's reaction does: the
    // move to /inbox/:id counts as arriving from another page, so Nori would play it, and load its strip, at once.
    const since = performance.now();
    const wait = openId === autoOpened.current ? Math.max(0, 1500 - since) : 0;
    const t = window.setTimeout(() => void noriReact({ event: hasCode ? "code" : "email-sent" }), wait);
    return () => clearTimeout(t);
  }, [openId, hasCode]);
  useEffect(() => () => void noriReact({ event: "idle" }), []);

  if (openId && !opened.includes(openId)) setOpened((o) => [...o, openId]);

  const configured = address.data?.configured;
  const shown = (list.data ?? []).filter((m) => (filter === "codes" ? m.kind === "verification_code" : filter === "replies" ? REPLIES.includes(m.kind) : true));
  const isNew = (m: InboxMessage) => !!seenAt && m.receivedAt > seenAt && !opened.includes(m.id);
  const current = settings ?? address.data?.settings ?? null;

  return (
    <main id="main" className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 pb-24 tablet:gap-5 tablet:px-8 tablet:pb-12 laptop:px-10 laptop:pt-7">
      {/* On phones a message is its own page: the heading stays for screen readers, the rest of the band goes. */}
      <PageHead>
        <h1 className={`font-serif text-[2rem] leading-[1.05] text-ink laptop:text-[2.5rem] ${id ? "max-laptop:sr-only" : ""}`}>Inbox</h1>
      </PageHead>
      <div className={`flex flex-col gap-3 empty:hidden ${id ? "max-laptop:hidden" : ""}`}>
        {address.data && configured && address.data.address && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-small text-ink-2 tablet:text-body">
              Your Nori inbox: <span className="font-semibold break-all text-ink">{address.data.address}</span>
            </p>
            <CopyButton text={address.data.address} label="Copy" />
          </div>
        )}
        {address.data && configured && current && <Settings initial={current} onSaved={setSettings} />}
      </div>

      {address.data && !configured ? (
        <div className="flex flex-col gap-2 rounded-card border-[1.5px] border-line bg-surface p-6">
          <p className="font-serif text-[1.5rem] text-ink">Nori&rsquo;s inbox isn&rsquo;t switched on yet</p>
          <p className="text-ink-2">Codes and replies go to your own email for now.</p>
        </div>
      ) : !list.data ? (
        list.error && list.status !== 401 ? (
          <div className="flex flex-col items-start gap-2 rounded-card border-[1.5px] border-line bg-surface p-6">
            <p className="font-serif text-[1.5rem] text-ink">Couldn&rsquo;t reach Norinote</p>
            <p className="text-ink-2">Check your connection; this page tries again by itself.</p>
            <button type="button" onClick={() => void list.refresh()} className={buttonClass("outline", "mt-2 min-h-11")}>
              Try again
            </button>
          </div>
        ) : (
          <ul aria-label="Loading your messages" className="flex flex-col gap-2 laptop:w-[380px]">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} aria-hidden="true" className="h-[92px] animate-pulse rounded-card border-[1.5px] border-line bg-surface" />
            ))}
          </ul>
        )
      ) : list.data.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-card border-[1.5px] border-line bg-surface p-6">
          <p className="font-serif text-[1.5rem] text-ink">Nothing here yet</p>
          <p className="text-ink-2">Codes and replies from employers land here, and Nori uses them to finish applications.</p>
        </div>
      ) : (
        <div className="laptop:grid laptop:grid-cols-[380px_minmax(0,1fr)] laptop:items-start laptop:gap-5">
          <div className={`flex flex-col gap-3 ${id ? "max-laptop:hidden" : ""}`}>
            <div role="group" aria-label="Show" className="flex gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={`h-10 rounded-full border-[1.5px] px-3.5 text-small font-medium ${filter === f.id ? "border-ink bg-ink text-bg" : "border-line-strong text-ink hover:bg-tint"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {shown.length ? (
              <ul aria-label="Messages" className="flex flex-col gap-2 laptop:max-h-[calc(100svh-260px)] laptop:overflow-y-auto laptop:pr-1">
                {shown.map((m) => {
                  const fresh = isNew(m);
                  const on = m.id === id;
                  return (
                    <li key={m.id}>
                      <Link
                        href={`/inbox/${m.id}`}
                        aria-current={on ? "true" : undefined}
                        className={`flex flex-col gap-1 rounded-card border-[1.5px] px-4 py-3 no-underline ${on ? "border-ink bg-tint" : "border-line bg-surface hover:border-line-strong"}`}
                      >
                        <span className="flex items-baseline justify-between gap-3">
                          <span className={`flex min-w-0 items-center gap-2 truncate text-[0.9375rem] text-ink ${fresh ? "font-bold" : "font-medium"}`}>
                            {fresh && <span aria-hidden="true" className="size-2 flex-none rounded-full bg-accent" />}
                            <span className="truncate">{m.fromName ?? m.fromAddress}</span>
                            {fresh && <span className="sr-only">, new</span>}
                          </span>
                          <span className="flex-none text-[0.8125rem] text-ink-2 tabular-nums">{listTime(m.receivedAt, now)}</span>
                        </span>
                        <span className={`truncate text-small text-ink ${fresh ? "font-bold" : ""}`}>{m.subject || "(no subject)"}</span>
                        <span className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-ink-2">
                          <span className={`rounded-full px-2 py-0.5 text-[0.75rem] font-medium ${m.spam ? "border border-line text-ink-2" : (KIND_CHIP[m.kind] ?? "bg-tint text-ink")}`}>{m.spam ? "Spam" : KIND[m.kind]}</span>
                          {m.application && (
                            <span className="truncate">
                              {m.application.jobTitle} · {m.application.companyName}
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="rounded-card border-[1.5px] border-dashed border-line px-4 py-6 text-center text-ink-2">{filter === "codes" ? "No codes yet." : "No replies yet."}</p>
            )}
          </div>

          <section
            aria-label={open ? `Message: ${open.subject || "no subject"}` : "Message"}
            className={`rounded-card border-[1.5px] border-line bg-surface p-4 tablet:p-6 ${id ? "" : "max-laptop:hidden"} laptop:sticky laptop:top-6`}
          >
            {id && (
              <Link href="/inbox" className="-ml-1 mb-3 inline-flex min-h-10 items-center px-1 text-small font-semibold text-ink no-underline laptop:hidden">
                ‹ Inbox
              </Link>
            )}
            {open ? (
              <MessageView m={open} onPhone={!!id} />
            ) : id && (single.status === 404 || single.status === 400) ? (
              <p className="text-ink-2">That message isn&rsquo;t here any more. It may have been removed after its keep time.</p>
            ) : (
              <p className="text-ink-2">{id ? "Loading the message…" : "Choose a message to read it."}</p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
