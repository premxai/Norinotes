"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { buttonClass } from "@/components/Button";
import { api, type Application, type Handoff, type LiveInput, type LiveKey, type RunEvent } from "@/lib/api";
import { isCancelled } from "@/lib/app-state";

/*
 * "Watch Nori apply": where the run is (a stage bar from the status and run events) and the employer's page as Nori sees
 * it (GET /applications/:id/live, about a frame a second while it applies or waits for a code; the last frame stays
 * about 15 minutes after the run). The frames show the person's own details, so there's nothing to share or download.
 */

const ACTIVE: Application["status"][] = ["applying", "awaiting_code"];

/** Polls the live frame every `everyMs` while `active`; once when it isn't, for the run's last frame. */
function useLiveFrame(id: string, active: boolean, started: boolean, everyMs: number) {
  const [url, setUrl] = useState<string | null>(null);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!started) return;
    let live = true;
    let timer = 0;
    const tick = async () => {
      if (!document.hidden) {
        const blob = await api.liveFrame(id);
        if (!live) return;
        // A 404 or a dropped request keeps the last good frame.
        if (blob) {
          const next = URL.createObjectURL(blob);
          if (shown.current) URL.revokeObjectURL(shown.current);
          shown.current = next;
          setUrl(next);
        }
      }
      if (live && active) timer = window.setTimeout(() => void tick(), everyMs);
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, active, started, everyMs]);
  useEffect(
    () => () => {
      if (shown.current) URL.revokeObjectURL(shown.current);
    },
    [],
  );
  return url;
}

/** Keys the live view passes on by name; printable characters go as typed text. */
const KEYS = new Set<string>(["Enter", "Tab", "Backspace", "Delete", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);
/** The most text one input carries (POST /applications/:id/live/input). */
const CHUNK = 200;
const round = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Sends the person's inputs one at a time, in order. Typed characters wait about 60 ms to go out together and are then
 * dropped: nothing typed stays in the page (it may be a password). A 409 means Nori isn't waiting any more.
 */
function liveSender(id: string, gone: () => void) {
  let queue: Promise<unknown> = Promise.resolve();
  let typed = "";
  let timer = 0;
  const post = (input: LiveInput) =>
    (queue = queue.then(async () => {
      const r = await api.liveInput(id, input);
      if (!r.ok && r.status === 409) gone();
    }));
  const flush = () => {
    clearTimeout(timer);
    timer = 0;
    for (let i = 0; i < typed.length; i += CHUNK) void post({ kind: "type", text: typed.slice(i, i + CHUNK) });
    typed = "";
  };
  return {
    type(text: string) {
      typed += text;
      if (!timer) timer = window.setTimeout(flush, 60);
    },
    send(input: LiveInput) {
      flush();
      return post(input);
    },
  };
}

/**
 * The person's turn in a Finish session (`receipt.handoff`): the frame takes their clicks, keys, pasted text and
 * scrolling and passes them to the employer's page, so they solve the captcha or sign in themselves. On a phone, taps
 * work on the frame and a small box types.
 */
function HandOff({ id, handoff, company, url, onGone }: { id: string; handoff: Handoff; company: string; url: string | null; onGone: () => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const doneButton = useRef<HTMLButtonElement>(null);
  const lastEscape = useRef(-Infinity);
  const [busy, setBusy] = useState<"done" | "cancel" | null>(null);
  const [io] = useState(() => liveSender(id, onGone));

  // Wheel and paste need native listeners: React's wheel listener can't stop the page scrolling, and a focused div
  // doesn't always get the paste event.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    let dy = 0;
    let timer = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      dy += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        const d = Math.round(dy);
        dy = 0;
        if (d) void io.send({ kind: "scroll", dy: d });
      }, 150);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (document.activeElement !== el) return;
      e.preventDefault();
      io.type(e.clipboardData?.getData("text/plain") ?? "");
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("paste", onPaste);
    return () => {
      el.removeEventListener("wheel", onWheel);
      document.removeEventListener("paste", onPaste);
      clearTimeout(timer);
    };
  }, [io]);

  /** Where on the frame, as fractions of the picture itself (it's letterboxed inside the box). */
  function click(e: MouseEvent<HTMLDivElement>) {
    const el = img.current;
    if (!el?.naturalWidth) return;
    const r = el.getBoundingClientRect();
    const s = Math.min(r.width / el.naturalWidth, r.height / el.naturalHeight);
    const w = el.naturalWidth * s;
    const h = el.naturalHeight * s;
    const x = (e.clientX - r.left - (r.width - w) / 2) / w;
    const y = (e.clientY - r.top - (r.height - h) / 2) / h;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    void io.send({ kind: "click", x: round(x), y: round(y) });
  }

  function key(e: KeyboardEvent<HTMLDivElement>) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.nativeEvent.isComposing) return;
    const printable = e.key.length === 1;
    if (!printable && !KEYS.has(e.key)) return;
    // Every key belongs to the employer's page, Tab and Escape included (Escape would close the panel).
    e.preventDefault();
    e.stopPropagation();
    if (printable) return io.type(e.key);
    // Esc twice leaves the frame, so the keyboard never gets stuck in it.
    if (e.key === "Escape" && e.timeStamp - lastEscape.current < 800) {
      lastEscape.current = -Infinity;
      return doneButton.current?.focus();
    }
    if (e.key === "Escape") lastEscape.current = e.timeStamp;
    void io.send({ kind: "key", key: e.key as LiveKey, ...(e.shiftKey ? { shift: true } : {}) });
  }

  async function end(kind: "done" | "cancel") {
    if (busy) return;
    setBusy(kind);
    await io.send({ kind });
    setBusy(null);
    onGone();
  }

  /** The phone's box: what was typed goes out and the box empties again. */
  function typeFrom(el: HTMLInputElement) {
    if (!el.value) return;
    io.type(el.value);
    el.value = "";
  }

  return (
    <section aria-label="Your turn on the employer’s page" className="flex flex-col gap-2.5">
      <div role="status">
        <h3 className="text-body leading-[1.4] font-semibold text-ink">
          {handoff.kind === "captcha" ? "Your turn: solve the captcha in the picture. Click and type right on it." : `Your turn: sign in to ${company} in the picture. Nori never stores your password.`}
        </h3>
      </div>
      <div
        ref={frame}
        tabIndex={0}
        role="application"
        aria-label="The employer’s page. Click it, then type: your clicks and keys go to the page."
        aria-describedby={`handoff-${id}-hint`}
        onClick={click}
        onKeyDown={key}
        className="relative aspect-[16/10] cursor-pointer overflow-hidden rounded-[12px] border-[1.5px] border-accent bg-surface-2 focus:outline-2 focus:outline-offset-[3px] focus:outline-ink focus:shadow-[0_0_0_3px_var(--color-surface)]"
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- an object URL of a fetched frame; next/image has nothing to optimise
          <img ref={img} src={url} alt="" draggable={false} className="absolute inset-0 size-full object-contain select-none" />
        ) : (
          <p className="absolute inset-0 m-0 grid place-items-center text-small text-ink-2">Opening the employer&rsquo;s page…</p>
        )}
      </div>
      <p id={`handoff-${id}-hint`} className="text-[0.75rem] text-ink-2 [@media(pointer:coarse)]:hidden">
        Keys go to the page while the picture is selected. Esc twice leaves it.
      </p>
      <label className="flex flex-col gap-1 text-small font-semibold text-ink [@media(pointer:fine)]:hidden">
        Type on the page
        <input
          type="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          onInput={(e) => !(e.nativeEvent as InputEvent).isComposing && typeFrom(e.currentTarget)}
          onCompositionEnd={(e) => typeFrom(e.currentTarget)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === "Backspace" || e.key === "Tab") && !e.currentTarget.value) {
              e.preventDefault();
              void io.send({ kind: "key", key: e.key });
            }
          }}
          className="h-11 w-full rounded-input border-[1.5px] border-line-strong bg-bg px-3 text-body text-ink"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button ref={doneButton} type="button" onClick={() => void end("done")} aria-disabled={busy !== null || undefined} className={buttonClass("primary", "min-h-11")}>
          {busy === "done" ? "Checking…" : "I’m done"}
        </button>
        <button type="button" onClick={() => void end("cancel")} aria-disabled={busy !== null || undefined} className={buttonClass("outline", "min-h-11")}>
          {busy === "cancel" ? "Stopping…" : "Stop"}
        </button>
      </div>
    </section>
  );
}

type Stage = { label: string; state: "done" | "now" | "next" | "needs" | "failed"; note?: string };

/** Where an emailed code came from, as the run log says it (never the code itself). */
export const codeSource = (message: string) =>
  /^Found the code in your Gmail/i.test(message) ? "Code from your Gmail" : /^Using the code you typed/i.test(message) ? "Code you typed" : /^Code received by email/i.test(message) ? "Code from your inbox" : null;

/** Tailoring resume → Filling the form → Submitting → (Waiting for code, when one was asked) → Sent. */
function stagesOf(a: Application, events: RunEvent[]): Stage[] | null {
  if (a.status === "prepared" || isCancelled(a)) return null;
  const submitting = events.some((e) => e.step === "submit");
  const code = a.status === "awaiting_code" || events.some((e) => e.step === "verification") || a.receipt?.awaitingCode === true || a.receipt?.codeMissing === true;
  const labels = ["Tailoring resume", "Filling the form", "Submitting", ...(code ? ["Waiting for code"] : []), "Sent"];
  const at =
    a.status === "queued" || a.status === "preparing" ? 0
    : a.status === "applying" ? (submitting ? 2 : 1)
    : a.status === "awaiting_code" ? 3
    : a.status === "submitted" ? labels.length
    : a.status === "needs_user" && a.receipt?.codeMissing === true ? 3
    : submitting ? 2
    : a.approvedAt ? 1
    : 0;
  const stop = a.status === "needs_user" || a.status === "ready_to_finish" ? "needs" : a.status === "failed" ? "failed" : null;
  const source = events.map((e) => codeSource(e.message)).filter(Boolean).at(-1) ?? undefined;
  return labels.map((label, i) => ({ label, state: i < at ? "done" : i === at ? (stop ?? "now") : "next", note: label === "Waiting for code" && i < at ? source : undefined }));
}

const MARK: Record<Stage["state"], string> = { done: "✓", now: "•", next: "", needs: "!", failed: "×" };
const TONE: Record<Stage["state"], string> = {
  done: "border-accent bg-accent text-on-accent",
  now: "border-ink bg-surface text-ink",
  next: "border-line bg-surface text-ink-2",
  needs: "border-warning bg-surface text-warning",
  failed: "border-danger bg-surface text-danger",
};
const SUFFIX: Partial<Record<Stage["state"], string>> = { needs: " · needs you", failed: " · stopped" };

/** The stage bar, then the live frame with `children` (the run log) beside it on the application's page, below it in the panel. */
export function WatchNori({ application: a, events, company, refresh, wide = false, children }: { application: Application; events: RunEvent[]; company: string; refresh: () => void; wide?: boolean; children: ReactNode }) {
  const active = ACTIVE.includes(a.status);
  // Finish: the person's turn. Frames come about every half second so their clicks and keys show quickly.
  const handoff = a.status === "applying" ? (a.receipt?.handoff ?? null) : null;
  const url = useLiveFrame(a.id, active, active || !!a.approvedAt, handoff ? 500 : 1000);
  const stages = stagesOf(a, events);
  return (
    <>
      {stages && (
        <ol aria-label="Where the run is" className="grid gap-1" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
          {stages.map((s, i) => (
            <li key={s.label} aria-current={s.state === "now" ? "step" : undefined} className="relative flex flex-col items-center gap-1.5 text-center">
              {i > 0 && <span aria-hidden="true" className={`absolute top-[11px] right-1/2 h-[2px] w-full ${s.state === "next" ? "bg-line" : "bg-accent"}`} />}
              <span aria-hidden="true" className={`relative grid size-6 place-items-center rounded-full border-2 text-[0.75rem] font-bold ${TONE[s.state]}`}>
                {MARK[s.state]}
              </span>
              <span className={`text-[0.75rem] leading-[1.25] ${s.state === "next" ? "text-ink-2" : "font-semibold text-ink"}`}>
                {s.label}
                {SUFFIX[s.state] && <span className={s.state === "needs" ? "text-warning" : "text-danger"}>{SUFFIX[s.state]}</span>}
              </span>
              {s.note && <span className="rounded-full bg-accent-tint px-2 py-0.5 text-[0.6875rem] font-semibold text-accent">{s.note}</span>}
            </li>
          ))}
        </ol>
      )}
      {active || url ? (
        <div className={wide ? "grid gap-4 laptop:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] laptop:items-start" : "flex flex-col gap-4"}>
          {handoff ? (
            <HandOff key={handoff.since} id={a.id} handoff={handoff} company={company} url={url} onGone={refresh} />
          ) : (
          <figure className="m-0 flex flex-col gap-1.5">
            <figcaption className="flex items-center gap-2 text-small font-semibold text-ink">
              {active && <span aria-hidden="true" className="size-2 rounded-full bg-accent shadow-[0_0_0_4px] shadow-accent/20" />}
              {active ? "Watch Nori apply" : "The employer’s page when the run ended"}
            </figcaption>
            {/* 16:10, the frames' shape, so nothing moves when the first one arrives. */}
            <div className="relative aspect-[16/10] overflow-hidden rounded-[12px] border-[1.5px] border-line bg-surface-2">
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element -- an object URL of a fetched frame; next/image has nothing to optimise
                <img src={url} alt="The employer’s application page, as Nori sees it" draggable={false} className="absolute inset-0 size-full object-contain" />
              ) : (
                <p className="absolute inset-0 m-0 grid place-items-center text-small text-ink-2">Opening the employer&rsquo;s page…</p>
              )}
            </div>
          </figure>
          )}
          {children}
        </div>
      ) : (
        children
      )}
    </>
  );
}
