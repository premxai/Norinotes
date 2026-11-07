"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, type Flow, type FlowNode } from "@/lib/api";
import { shortDate } from "@/lib/app-state";
import { usePolling } from "@/lib/use-polling";
import { PageHead } from "./PageHead";

/*
 * /tracker: where the person's applications went, as a Sankey (GET /applications/flow). Columns by stage, node height by
 * count, bands by how many went each way. Drawn by hand: a column layout and cubic bands, no chart library.
 */

type Days = 7 | 30 | 90 | null;
const PERIODS: [Days, string][] = [
  [7, "7 days"],
  [30, "30 days"],
  [90, "90 days"],
  [null, "All"],
];

/** Within a column, the hopeful paths first. */
const ORDER = ["started", "sent", "needs_you", "in_progress", "cancelled", "failed", "interview", "replied", "waiting", "silent", "rejected", "offer", "interviewing", "rejected_after_interview"];
const rank = (id: string) => (ORDER.indexOf(id) + 1 || ORDER.length + 1) - 1;
/** Colour by meaning: the way to an offer in the accent, rejections red, waiting neutral, what needs you amber. */
const TONE: Record<string, string> = {
  started: "var(--color-ink)",
  sent: "var(--color-accent)",
  interview: "var(--color-accent)",
  replied: "var(--color-accent)",
  offer: "var(--color-accent)",
  interviewing: "var(--color-accent)",
  rejected: "var(--color-danger)",
  rejected_after_interview: "var(--color-danger)",
  needs_you: "var(--color-warning)",
  failed: "var(--color-warning)",
};
const tone = (id: string) => TONE[id] ?? "var(--color-line-strong)";
/** The Applications tab that holds each node's applications (?show=, app-state's groups). */
const SHOW: Record<string, string> = { sent: "sent", waiting: "sent", needs_you: "in-progress", in_progress: "in-progress", interview: "replied", replied: "replied", offer: "replied", interviewing: "replied", cancelled: "closed", failed: "closed", rejected: "closed", rejected_after_interview: "closed", silent: "closed" };
const TAB: Record<string, string> = { sent: "Sent", "in-progress": "In progress", replied: "Replied", closed: "Closed" };

const W = 960;
const H = 360;
const NODE = 14;
const GAP = 16;

type Placed = FlowNode & { x: number; y: number; h: number };

function layout(flow: Flow) {
  const stages = [...new Set(flow.nodes.map((n) => n.stage))].sort();
  const columns = stages.map((s) => flow.nodes.filter((n) => n.stage === s).sort((a, b) => rank(a.id) - rank(b.id)));
  const most = Math.max(1, ...columns.map((c) => c.length));
  const k = (H - GAP * (most - 1)) / Math.max(1, flow.total);
  const placed = new Map<string, Placed>();
  columns.forEach((col, i) => {
    const x = stages.length === 1 ? 0 : ((W - NODE) * i) / (stages.length - 1);
    let y = 0;
    for (const n of col) {
      const h = Math.max(3, n.count * k);
      placed.set(n.id, { ...n, x, y, h });
      y += h + GAP;
    }
  });
  const out = new Map<string, number>();
  const into = new Map<string, number>();
  const bands = [...flow.links]
    .sort((a, b) => rank(a.source) - rank(b.source) || rank(a.target) - rank(b.target))
    .flatMap((l) => {
      const s = placed.get(l.source);
      const t = placed.get(l.target);
      if (!s || !t) return [];
      // A band keeps its share of each node's height; tiny ones stay visible.
      const ws = Math.max(1.5, (l.value / s.count) * s.h);
      const wt = Math.max(1.5, (l.value / t.count) * t.h);
      const sy = s.y + (out.get(s.id) ?? 0);
      const ty = t.y + (into.get(t.id) ?? 0);
      out.set(s.id, (out.get(s.id) ?? 0) + ws);
      into.set(t.id, (into.get(t.id) ?? 0) + wt);
      const x0 = s.x + NODE;
      const x1 = t.x;
      const mx = (x0 + x1) / 2;
      const d = `M${x0},${sy} C${mx},${sy} ${mx},${ty} ${x1},${ty} L${x1},${ty + wt} C${mx},${ty + wt} ${mx},${sy + ws} ${x0},${sy + ws} Z`;
      return [{ ...l, d, color: tone(l.target) }];
    });
  const height = Math.max(...[...placed.values()].map((n) => n.y + n.h), 40);
  return { nodes: [...placed.values()], bands, last: stages.length - 1, lastX: placed.size ? Math.max(...[...placed.values()].map((n) => n.x)) : 0, height };
}

function Sankey({ flow, label }: { flow: Flow; label: string }) {
  const router = useRouter();
  const [lit, setLit] = useState<string | null>(null);
  const { nodes, bands, lastX, height } = layout(flow);
  const name = Object.fromEntries(flow.nodes.map((n) => [n.id, n.label]));
  return (
    <>
      {/* Phones scroll the chart sideways rather than squeezing its labels. */}
      <div role="region" aria-label="Where your applications went, as a chart" tabIndex={0} className="-mx-1 overflow-x-auto px-1 pb-2">
        <svg viewBox={`-4 -12 ${W + 8} ${height + 24}`} className="block w-full min-w-[640px]" role="group" aria-label={label}>
          <g aria-hidden="true">
            {bands.map((b) => (
              <path key={`${b.source}-${b.target}`} d={b.d} fill={b.color} opacity={lit === null ? 0.32 : lit === b.source || lit === b.target ? 0.6 : 0.12} className="transition-opacity motion-reduce:transition-none" />
            ))}
          </g>
          {nodes.map((n) => {
            const show = SHOW[n.id];
            const href = show ? `/applications?show=${show}` : "/applications";
            const right = n.x < lastX;
            return (
              <a
                key={n.id}
                href={href}
                aria-label={`${n.count} ${n.label}. Show ${n.count === 1 ? "it" : "them"} in Applications${show ? `, ${TAB[show]}` : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  router.push(href);
                }}
                onMouseEnter={() => setLit(n.id)}
                onMouseLeave={() => setLit(null)}
                onFocus={() => setLit(n.id)}
                onBlur={() => setLit(null)}
                className="group cursor-pointer outline-none"
              >
                <rect x={n.x} y={n.y} width={NODE} height={n.h} rx={3} fill={tone(n.id)} className="group-focus-visible:stroke-ink group-focus-visible:[stroke-width:3]" />
                <text x={right ? n.x + NODE + 8 : n.x - 8} y={n.y + n.h / 2} dominantBaseline="middle" textAnchor={right ? "start" : "end"} className="fill-ink text-[15px] [paint-order:stroke] [stroke:var(--color-surface)] [stroke-width:4px] group-hover:underline group-focus-visible:underline">
                  <tspan fontWeight={700}>{n.count}</tspan> {n.label}
                </text>
              </a>
            );
          })}
        </svg>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">From</th>
            <th scope="col">To</th>
            <th scope="col">Applications</th>
          </tr>
        </thead>
        <tbody>
          {flow.links.map((l) => (
            <tr key={`${l.source}-${l.target}`}>
              <td>{name[l.source] ?? l.source}</td>
              <td>{name[l.target] ?? l.target}</td>
              <td>{l.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function Tracker() {
  const [days, setDays] = useState<Days>(null);
  const flow = usePolling(`flow:${days ?? "all"}`, () => api.flow(days), 60_000);
  const f = flow.data;
  const count = (id: string) => f?.nodes.find((n) => n.id === id)?.count ?? 0;
  const sent = count("sent");
  const answered = count("replied") + count("interview");
  const period = days ? `in the last ${days} days` : f?.since ? `since ${shortDate(f.since)}` : "so far";
  const numbers = [
    ["Sent", String(sent)],
    ["Replies", String(count("replied"))],
    ["Interviews", String(count("interview"))],
    ["Offers", String(count("offer"))],
    // A rate from a handful would mislead: counts until five have gone out.
    sent >= 5 ? ["Response rate", `${Math.round((answered / sent) * 100)}%`] : ["Answered", `${answered} of ${sent}`],
  ];
  return (
    <main id="main" className="mx-auto flex max-w-[1040px] flex-col gap-4 px-4 pb-24 tablet:gap-5 tablet:px-8 tablet:pb-12 laptop:px-10 laptop:pt-7">
      <PageHead>
        <h1 className="font-serif text-[2rem] leading-[1.05] text-ink laptop:text-[2.5rem]">Tracker</h1>
        <p className="mt-1 text-small text-ink-2 tablet:text-body">Where your applications went.</p>
      </PageHead>

      <div role="group" aria-label="Period" className="flex flex-wrap gap-2">
        {PERIODS.map(([d, label]) => (
          <button key={label} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={`min-h-11 rounded-full border-[1.5px] px-4 text-small font-semibold ${days === d ? "border-ink bg-ink text-bg" : "border-line-strong bg-surface text-ink hover:bg-tint"}`}>
            {label}
          </button>
        ))}
      </div>

      {!f && flow.error && flow.status !== 401 ? (
        <div className="flex flex-col items-start gap-2 rounded-card border-[1.5px] border-line bg-surface p-6">
          <p className="font-serif text-[1.5rem] text-ink">Couldn&rsquo;t reach Norinote</p>
          <p className="text-ink-2">Check your connection; this page tries again by itself.</p>
        </div>
      ) : !f ? (
        <div aria-hidden="true" className="h-[480px] animate-pulse rounded-card border-[1.5px] border-line bg-surface" />
      ) : f.total === 0 ? (
        <div className="flex flex-col gap-2 rounded-card border-[1.5px] border-line bg-surface p-6">
          <p className="font-serif text-[1.5rem] text-ink tablet:text-[1.75rem]">{days ? `Nothing went out in the last ${days} days` : "Nothing here yet"}</p>
          <p className="text-ink-2">Your applications will flow here once Nori sends a few.</p>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 tablet:grid-cols-5">
            {numbers.map(([k, v]) => (
              <div key={k} className="rounded-card border-[1.5px] border-line bg-surface px-4 py-3">
                <dt className="text-small text-ink-2">{k}</dt>
                <dd className="mt-0.5 text-[1.5rem] font-semibold text-ink tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <section aria-labelledby="flow-title" className="flex flex-col gap-3 rounded-card border-[1.5px] border-line bg-surface p-4 tablet:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="flow-title" className="text-[1.125rem] font-semibold text-ink">
                {f.total} {f.total === 1 ? "application" : "applications"} {period}
              </h2>
              <p className="text-small text-ink-2">Pick a step to see its applications.</p>
            </div>
            {f.total < 5 && <p className="rounded-row bg-tint px-3 py-2 text-small text-ink">Only a few so far. This fills in as more go out.</p>}
            <Sankey flow={f} label={`Where your ${f.total} ${f.total === 1 ? "application" : "applications"} went, ${period}`} />
          </section>
        </>
      )}
    </main>
  );
}
