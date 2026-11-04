"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/Button";
import { api, type GraphNode } from "@/lib/api";
import { noriReact } from "@/lib/auth-flow";
import { STEPS, saveStep, setIngest, setNodes, useStepGuard } from "@/lib/onboarding";
import { StepFooter, StepLoading, StepShell } from "./controls";

const MAX_BYTES = 10 * 1024 * 1024;
/** Card kinds in the order they're revealed (spec section 7); skills become chips and the count. */
const KINDS = [
  { type: "role", label: "Role", one: "role", many: "roles" },
  { type: "project", label: "Project", one: "project", many: "projects" },
  { type: "metric", label: "Highlight", one: "highlight", many: "highlights" },
  { type: "education", label: "Education", one: "school", many: "schools" },
  { type: "certification", label: "Certification", one: "certification", many: "certifications" },
] as const;
const CAP = 12;
const REVEAL_MS = 350;
const TICKS = ["Finding roles", "Reading dates", "Collecting skills", "Matching projects"];

const never = () => () => {};
const useReducedMotion = () => useSyncExternalStore(never, () => matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);

const year = (d: string | null) => (d ? d.slice(0, 4) : null);
function dates(n: GraphNode) {
  const a = year(n.startDate);
  const b = year(n.endDate);
  if (!a) return b ?? "";
  if (!b) return n.type === "role" ? `${a}–now` : a;
  return a === b ? a : `${a}–${b.slice(2)}`;
}

type Card = { node: GraphNode; kind: (typeof KINDS)[number] };

function cardsOf(nodes: GraphNode[]): Card[] {
  return KINDS.flatMap((kind) => {
    const of = nodes.filter((n) => n.type === kind.type);
    // Roles newest first; the rest in the order the resume gives them.
    if (kind.type === "role") of.sort((x, y) => (y.startDate ?? "").localeCompare(x.startDate ?? ""));
    return of.map((node) => ({ node, kind }));
  });
}

function countText(nodes: GraphNode[]) {
  const parts: string[] = KINDS.map((k) => [k, nodes.filter((n) => n.type === k.type).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${n === 1 ? k.one : k.many}`);
  const skills = nodes.filter((n) => n.type === "skill").length;
  if (skills) parts.push(`${skills} ${skills === 1 ? "skill" : "skills"}`);
  return parts.join(", ");
}

/** Pairs of shown cards that share a skill, at most 8, preferring skills used by the most cards. */
function threadPairs(cards: Card[]) {
  const uses = new Map<string, number[]>();
  cards.forEach((c, i) => (c.node.props.skills ?? []).forEach((s) => uses.set(s.toLowerCase(), [...(uses.get(s.toLowerCase()) ?? []), i])));
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const [, idx] of [...uses].sort((a, b) => b[1].length - a[1].length)) {
    for (let k = 1; k < idx.length && out.length < 8; k++) {
      const a = idx[k - 1] ?? 0;
      const b = idx[k] ?? 0;
      if (seen.has(`${a}-${b}`)) continue;
      seen.add(`${a}-${b}`);
      out.push([a, b]);
    }
  }
  return out;
}

/** The career graph as cards, revealed one at a time when `animate` (just read), with threads from 768 px. */
function GraphBoard({ nodes, animate }: { nodes: GraphNode[]; animate: boolean }) {
  const reduced = useReducedMotion();
  const all = cardsOf(nodes);
  const [more, setMore] = useState(false);
  const cards = more ? all : all.slice(0, CAP);
  const [shown, setShown] = useState(animate ? 0 : cards.length);
  const [open, setOpen] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const board = useRef<HTMLUListElement>(null);
  const [lines, setLines] = useState<{ d: string; a: number; b: number }[]>([]);
  const visible = reduced ? cards.length : Math.max(shown, more ? cards.length : 0);

  // One card every 350 ms; Nori points as each group starts and presents at the end.
  useEffect(() => {
    if (reduced || !animate) return;
    let i = 0;
    const t = window.setInterval(() => {
      i += 1;
      setShown(i);
      const c = cards[i - 1];
      if (c && (i === 1 || cards[i - 2]?.kind !== c.kind)) {
        const n = cards.filter((x) => x.kind === c.kind).length;
        setAnnounce(`${n} ${n === 1 ? c.kind.one : c.kind.many} found`);
        void noriReact({ row: "point-right" });
      }
      if (i >= cards.length) {
        clearInterval(t);
        void noriReact({ row: "present", say: "Here's what I found." });
      }
    }, REVEAL_MS);
    return () => clearInterval(t);
    // Runs once per read: the cards are fixed for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, reduced]);

  // Threads join card centres; measured after layout, and again when the board resizes.
  const pairs = threadPairs(cards);
  useLayoutEffect(() => {
    const el = board.current;
    if (!el) return;
    const measure = () => {
      const base = el.getBoundingClientRect();
      const boxes = [...el.querySelectorAll<HTMLElement>("[data-card]")].map((c) => c.getBoundingClientRect());
      setLines(
        pairs.flatMap(([a, b]) => {
          const A = boxes[a];
          const B = boxes[b];
          if (!A || !B) return [];
          const ax = A.left + A.width / 2 - base.left;
          const ay = A.top + A.height / 2 - base.top;
          const bx = B.left + B.width / 2 - base.left;
          const by = B.top + B.height / 2 - base.top;
          const mx = (ax + bx) / 2;
          return [{ d: `M${ax} ${ay} C${mx + 30} ${ay} ${mx - 30} ${by} ${bx} ${by}`, a, b }];
        }),
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.length]);

  const quote = cards.find((c) => c.node.id === open)?.node.sourceQuote;
  const done = visible >= cards.length;
  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full max-tablet:hidden">
          {lines.map((l, i) => (
            <path key={i} d={l.d} fill="none" stroke={i % 2 ? "var(--color-line-strong)" : "var(--color-accent)"} strokeWidth="2" strokeDasharray="4 4" className="transition-opacity duration-[var(--dur-slow)]" opacity={l.a < visible && l.b < visible ? 0.55 : 0} />
          ))}
        </svg>
        <ul ref={board} className="relative grid grid-cols-1 gap-2.5 tablet:grid-cols-2 tablet:gap-4" aria-label="Your career graph">
          {cards.map((c, i) => (
            <li
              key={c.node.id}
              data-card
              className={`relative flex min-h-[117px] flex-col gap-1.5 rounded-row border-[1.5px] border-line bg-surface px-3.5 py-3 transition-[opacity,translate] duration-[var(--dur-slow)] ease-out ${i < visible ? "opacity-100" : "translate-y-2 opacity-0"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-tint px-2 py-0.5 font-mono text-tag text-ink-2">{c.kind.label}</span>
                <span className="font-mono text-label text-ink-2">{dates(c.node)}</span>
              </div>
              <p className="line-clamp-2 text-[0.9375rem] leading-[1.3] font-semibold text-ink">
                {c.node.props.title ?? c.node.label}
                {c.node.props.org ? ` · ${c.node.props.org}` : ""}
              </p>
              <div className="flex flex-wrap gap-1 pr-16">
                {(c.node.props.skills ?? []).slice(0, 3).map((s) => (
                  <span key={s} className="rounded-full border border-line px-2 py-0.5 text-[0.75rem] text-ink">
                    {s}
                  </span>
                ))}
              </div>
              {c.node.sourceQuote && (
                <button
                  type="button"
                  aria-expanded={open === c.node.id}
                  onClick={() => setOpen(open === c.node.id ? null : c.node.id)}
                  className="absolute right-2 bottom-1 min-h-6 px-1.5 text-[0.75rem] font-medium text-ink underline underline-offset-[3px]"
                >
                  Source
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
      {all.length > CAP && !more && done && (
        <button type="button" onClick={() => setMore(true)} className="self-start py-1.5 text-[0.9375rem] font-semibold text-ink underline underline-offset-[3px]">
          and {all.length - CAP} more
        </button>
      )}
      {quote && (
        <p className="rounded-row bg-surface-2 px-3.5 py-2.5 text-small text-ink">
          <span className="font-mono text-label text-ink-2">From your resume: </span>“{quote}”
        </p>
      )}
      <p aria-live="polite" className="text-ui font-semibold text-ink">
        {done ? countText(nodes) : announce}
      </p>
    </div>
  );
}

/** /onboarding/resume (spec section 7): upload or paste, Nori reads it, the graph is revealed, then Continue. */
export function ResumeStep() {
  const s = useStepGuard(0);
  const router = useRouter();
  const reduced = useReducedMotion();
  const [reading, setReading] = useState<string | null>(null); // the file name while it's read
  const [animate, setAnimate] = useState(false);
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState("");
  const [drag, setDrag] = useState(false);
  const [tick, setTick] = useState(0);
  const [failure, setFailure] = useState<{ text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Coming back to a resume read in an earlier visit: show its graph, without the reveal.
  const needsGraph = s.status === "ready" && !s.nodes && !!s.profile?.rawResumeText;
  useEffect(() => {
    if (needsGraph) void api.graph().then((r) => r.ok && setNodes(r.data.nodes));
  }, [needsGraph]);

  // While reading: the detail cycles, and Nori alternates reading and sorting papers.
  useEffect(() => {
    if (!reading) return;
    void noriReact({ row: "read" });
    const ticker = reduced ? 0 : window.setInterval(() => setTick((n) => n + 1), 700);
    let papers = false;
    const nori = window.setInterval(() => void noriReact({ row: (papers = !papers) ? "papers" : "read" }), 2500);
    return () => {
      clearInterval(ticker);
      clearInterval(nori);
    };
  }, [reading, reduced]);

  async function read(what: { file: File } | { text: string }) {
    setFailure(null);
    if ("file" in what && what.file.size > MAX_BYTES) return setFailure({ text: "That file is too large. Resumes up to 10 MB are accepted." });
    setReading("file" in what ? what.file.name : "Your pasted resume");
    const r = "file" in what ? await api.resumeFile(what.file) : await api.resumeText(what.text);
    setReading(null);
    if (!r.ok) {
      setFailure({ text: r.error });
      void noriReact({ event: "auth-failed", say: "I couldn't read that one." });
      return;
    }
    setAnimate(true);
    setPaste(false);
    setIngest(r.data);
  }

  async function next() {
    if (busy) return;
    setBusy(true);
    const r = await saveStep("resume", {});
    setBusy(false);
    if (!r.ok) return setFailure({ text: r.error });
    router.push(STEPS[1].path);
  }

  const nodes = s.nodes ?? [];
  const phase = reading ? "reading" : nodes.length ? "graph" : "empty";
  return (
    <StepShell
      index={0}
      title="Start with your resume"
      lead="Nori reads it once and turns it into your career graph. That's how it knows which jobs you'll likely get."
      failure={failure}
      footer={
        phase === "graph" ? (
          <StepFooter
            onContinue={next}
            busy={busy}
            extra={
              <button
                type="button"
                onClick={() => {
                  setIngest(null);
                  setAnimate(false);
                }}
                className="py-1.5 text-[0.9375rem] font-semibold text-ink underline underline-offset-[3px] max-tablet:hidden"
              >
                Use a different file
              </button>
            }
          />
        ) : (
          <p data-step-footer className="text-center text-small text-ink-2 tablet:hidden max-tablet:fixed max-tablet:inset-x-0 max-tablet:bottom-0 max-tablet:grid max-tablet:h-[76px] max-tablet:place-items-center max-tablet:border-t-[1.5px] max-tablet:border-line max-tablet:bg-bg">
            Continue appears once your resume is read.
          </p>
        )
      }
    >
      {s.status !== "ready" ? (
        <StepLoading />
      ) : phase === "reading" ? (
        <div className="flex flex-col gap-3.5 rounded-card border-[1.5px] border-line bg-surface p-5">
          <p className="font-semibold text-ink">{reading}</p>
          <p aria-live="polite" className="text-ui leading-[1.5] text-ink">
            Nori is reading your resume… {!reduced && <span className="text-ink-2">{TICKS[tick % TICKS.length]}</span>}
          </p>
          <p className="text-small text-ink-2">This can take up to half a minute. You can stay on this page.</p>
        </div>
      ) : phase === "graph" ? (
        <>
          <GraphBoard key={nodes.length + (animate ? "a" : "")} nodes={nodes} animate={animate} />
          {s.ingest?.note && <p className="text-small text-ink-2">Read with basic parsing for now; the detailed read follows when the AI service is back. Nothing you need to do.</p>}
          <button type="button" onClick={() => setIngest(null)} className="self-start py-1.5 text-[0.9375rem] font-semibold text-ink underline underline-offset-[3px] tablet:hidden">
            Use a different file
          </button>
        </>
      ) : paste ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="resume-text" className="text-ui leading-[1.3] font-semibold text-ink">
              Resume text
            </label>
            <textarea
              id="resume-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste everything, from your name to the last line."
              className="h-[220px] w-full resize-y rounded-input border-[1.5px] border-line-strong bg-surface px-3.5 py-3 text-body text-ink"
            />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" onClick={() => void read({ text })} className={buttonClass("primary", "min-h-12")}>
              Read this
            </button>
            <button type="button" onClick={() => setPaste(false)} className="py-1.5 text-[0.9375rem] font-semibold text-ink underline underline-offset-[3px]">
              Upload a file instead
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) void read({ file: f });
            }}
            className={`flex cursor-pointer flex-col items-center gap-3 rounded-card border-2 border-dashed px-4 py-7 text-center tablet:px-6 tablet:py-9 ${drag ? "border-accent bg-accent-tint" : "border-line-strong bg-surface"} has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-ink`}
          >
            <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
              <path d="M12 6h12l8 8v20H12z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M24 6v8h8M22 30V19M17.5 23.5L22 19l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-[1.0625rem] font-semibold text-ink">
              <span className="max-tablet:hidden">Drop your resume here, or choose a file</span>
              <span className="tablet:hidden">Choose your resume</span>
            </span>
            <span className="text-small text-ink-2">PDF or DOCX, up to 10 MB</span>
            <span className={buttonClass("primary", "min-h-12 max-tablet:w-full")}>Choose a file</span>
            <input
              ref={input}
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void read({ file: f });
              }}
            />
          </label>
          <button type="button" onClick={() => setPaste(true)} className="self-start py-1.5 text-[0.9375rem] font-semibold text-ink underline underline-offset-[3px]">
            Paste the text instead
          </button>
        </div>
      )}
    </StepShell>
  );
}
