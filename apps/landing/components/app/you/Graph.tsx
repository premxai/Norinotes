"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buttonClass } from "@/components/Button";
import { Field } from "@/components/auth/fields";
import { StatusChip, type ChipTone } from "@/components/app/v2/StatusChip";
import { api, type GraphEdge, type GraphNode, type GraphSource, type NodePatch } from "@/lib/api";
import { noriReact } from "@/lib/auth-flow";
import { layout, placeLabels, type Point } from "@/lib/graph-layout";
import { CARD, DANGER_BUTTON, DANGER_FILL, HINT, Status, TEXT_BUTTON } from "./YouTabs";

/* /graph: the career graph (dashboard v2 plan, section 7). Only the graph and Add a fact: zoom and search, a key of the
   kinds, a card per dot (where it came from, Fix, Remove), and Add a fact with two tabs (Write it, Add a source). */

type Kind = "role" | "project" | "metric" | "education" | "certification" | "skill";
const KINDS: { kind: Kind; label: string; one: string; fill: string; ring: boolean }[] = [
  { kind: "role", label: "Roles", one: "Role", fill: "var(--color-accent)", ring: false },
  { kind: "project", label: "Projects", one: "Project", fill: "var(--color-graph-project)", ring: false },
  { kind: "metric", label: "Results", one: "Result", fill: "var(--color-graph-result)", ring: false },
  { kind: "education", label: "Education", one: "Education", fill: "var(--color-warning)", ring: true },
  { kind: "certification", label: "Certifications", one: "Certification", fill: "var(--color-graph-cert)", ring: true },
  { kind: "skill", label: "Skills", one: "Skill", fill: "var(--color-line-strong)", ring: false },
];
const KIND = new Map(KINDS.map((k) => [k.kind, k]));
const kindOf = (n: GraphNode): Kind => (KIND.has(n.type as Kind) ? (n.type as Kind) : "project");

const HEIGHT = { wide: 560, narrow: 440 };
const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function useWide() {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const m = matchMedia("(min-width: 1024px)");
    const on = () => setWide(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

/** "2019-03" as "Mar 2019"; a year as it is. */
const month = (d: string) => {
  const [y, m] = d.split("-");
  return m ? `${new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-GB", { month: "short" })} ${y}` : (y ?? d);
};
function dates(n: GraphNode) {
  if (!n.startDate) return n.endDate ? month(n.endDate) : "";
  if (!n.endDate) return `${month(n.startDate)} – now`;
  return n.startDate === n.endDate ? month(n.startDate) : `${month(n.startDate)} – ${month(n.endDate)}`;
}
const titleOf = (n: GraphNode) => n.props.title ?? n.label;
const labelOf = (n: GraphNode) => (kindOf(n) === "role" && n.props.org ? `${titleOf(n)} · ${n.props.org}` : titleOf(n));
function skillMeta(n: GraphNode) {
  const y = n.props.years;
  const years = typeof y === "number" ? (y < 1 ? "Under a year" : plural(Math.round(y), "year", "years")) : null;
  const when = n.props.current ? "used now" : n.props.lastUsed ? `last used ${n.props.lastUsed.slice(0, 4)}` : null;
  return [years, when].filter(Boolean).join(" · ");
}
/** Where a card came from: `origin` when the API sends it, else the older readable `source` and its quote. */
function originOf(n: GraphNode): NonNullable<GraphNode["origin"]> | null {
  if (kindOf(n) === "skill") return null;
  if (n.origin) return n.origin;
  if (n.source === "a fact you added") return { kind: "user", ref: null, label: null };
  return { kind: "resume", ref: null, label: n.sourceQuote ?? null };
}
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

type Msg = { text: string; tone: "ok" | "error" } | null;
type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };

/** Cards fixed in this visit: the API keeps no record of edits, so "You fixed this card." lasts until a reload. */
const fixedThisVisit = new Set<string>();

// ---- the page -----------------------------------------------------------------------------------------------------------

export function CareerGraphPage() {
  const [data, setData] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [pulse, setPulse] = useState<Set<string>>(new Set());
  const known = useRef<Set<string> | null>(null);
  const opener = useRef<HTMLElement | SVGElement | null>(null);

  const apply = useCallback((r: Awaited<ReturnType<typeof api.graph>>) => {
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    setError(null);
    // New dots since the last load pulse once (not on the first load).
    if (known.current) {
      const fresh = new Set(r.data.nodes.map((n) => n.id).filter((id) => !known.current!.has(id)));
      if (fresh.size) {
        setPulse(fresh);
        window.setTimeout(() => setPulse(new Set()), 3300);
      }
    }
    known.current = new Set(r.data.nodes.map((n) => n.id));
    setData(r.data);
    return true;
  }, []);
  const load = useCallback(async () => apply(await api.graph()), [apply]);
  useEffect(() => {
    void api.graph().then(apply);
  }, [apply]);

  const byId = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);
  const open = openId ? (byId.get(openId) ?? null) : null;
  const skills = (data?.nodes ?? []).filter((n) => kindOf(n) === "skill").length;
  const facts = (data?.nodes.length ?? 0) - skills;
  const summary = `${plural(facts, "fact", "facts")} and ${plural(skills, "skill", "skills")}`;

  const query = q.trim().toLowerCase();
  const matches = useMemo(
    () => new Set(query ? (data?.nodes ?? []).filter((n) => `${labelOf(n)} ${n.props.statement ?? ""}`.toLowerCase().includes(query)).map((n) => n.id) : []),
    [data, query],
  );

  function openCard(id: string) {
    const el = document.activeElement;
    opener.current = (el instanceof HTMLElement || el instanceof SVGElement) && el !== document.body ? el : null;
    setOpenId(id);
  }
  function closeCard() {
    setOpenId(null);
    opener.current?.focus();
  }
  function startAdding() {
    setOpenId(null);
    setMsg(null);
    setAdding(true);
  }

  const empty = !!data && data.nodes.length === 0;

  return (
    <>
      <div className="-mt-2 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.9375rem] text-ink-2">What Nori knows about your work. Your resumes are written from it.</p>
          <p className={`${HINT} mt-1 min-h-5 tabular-nums`}>{data ? (empty ? "Nothing yet" : summary) : ""}</p>
        </div>
        <button type="button" onClick={startAdding} className={buttonClass("primary", "min-h-11")}>
          + Add a fact
        </button>
      </div>
      {msg && <Status tone={msg.tone}>{msg.text}</Status>}

      {error && !data ? (
        <div className={`${CARD} items-start`}>
          <p className="font-semibold text-ink">Couldn&rsquo;t load your graph.</p>
          <p className={HINT}>Check your connection and try again.</p>
          <button type="button" onClick={() => void load()} className={buttonClass("outline", "min-h-11")}>
            Try again
          </button>
        </div>
      ) : !data ? (
        <>
          <div aria-hidden="true" className="h-12" />
          <div aria-hidden="true" className="h-[440px] animate-pulse rounded-card border-[1.5px] border-line bg-surface laptop:h-[560px]" />
        </>
      ) : empty ? (
        <div className={`${CARD} items-start`}>
          <p className="text-[1.0625rem] font-semibold text-ink">Your graph is empty.</p>
          <p className={HINT}>Add a fact or a source and Nori builds it from there.</p>
          <button type="button" onClick={startAdding} className={buttonClass("primary", "min-h-11")}>
            + Add a fact
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <label htmlFor="graph-find" className="sr-only">
              Search your graph
            </label>
            <input
              id="graph-find"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                // Enter opens the first match: the keyboard's quick way to a card.
                const first = data.nodes.find((n) => matches.has(n.id));
                if (e.key !== "Enter" || !first) return;
                e.preventDefault();
                openCard(first.id);
              }}
              placeholder="Search your graph"
              className="h-12 min-w-0 flex-1 rounded-input border-[1.5px] border-line-strong bg-surface px-3.5 text-body text-ink"
            />
            <p aria-live="polite" className={`${HINT} min-w-[4.5rem] text-right tabular-nums`}>
              {query ? `${matches.size} found` : ""}
            </p>
          </div>

          <CareerGraph
            all={data}
            matches={query ? matches : null}
            open={openId}
            lit={openId ?? hover}
            pulse={pulse}
            onHover={setHover}
            onOpen={openCard}
            summary={`Your career graph: ${summary}. Each dot is a button that opens its card.`}
          />

          <ul aria-label="Key" className="-mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
            {KINDS.map((k) => {
              const n = data.nodes.filter((x) => kindOf(x) === k.kind).length;
              return n ? (
                <li key={k.kind} className="flex items-center gap-2 text-small text-ink-2">
                  <KindDot kind={k.kind} />
                  {k.label} <span className="tabular-nums">{n}</span>
                </li>
              ) : null;
            })}
          </ul>
        </>
      )}

      {open && data && (
        <NodeCard
          key={open.id}
          node={open}
          data={data}
          onClose={closeCard}
          onOpen={(id) => setOpenId(id)}
          onChanged={async (text, closed) => {
            if (closed) setOpenId(null);
            await load();
            setMsg(text ? { text, tone: "ok" } : null);
          }}
        />
      )}

      {adding && (
        <AddDialog
          onClose={() => setAdding(false)}
          onGraphChanged={load}
          onDone={async (text) => {
            setAdding(false);
            await load();
            setMsg({ text, tone: "ok" });
          }}
        />
      )}
    </>
  );
}

function KindDot({ kind }: { kind: Kind }) {
  const k = KIND.get(kind)!;
  return <span aria-hidden="true" className="size-2.5 flex-none rounded-full" style={k.ring ? { boxShadow: `inset 0 0 0 2px ${k.fill}` } : { background: k.fill }} />;
}

// ---- the drawn graph ------------------------------------------------------------------------------------------------------

type View = { k: number; tx: number; ty: number };

function CareerGraph({ all, matches, open, lit, pulse, onHover, onOpen, summary }: {
  all: Graph;
  matches: Set<string> | null;
  open: string | null;
  lit: string | null;
  pulse: Set<string>;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
  summary: string;
}) {
  const nodes = all.nodes;
  const wide = useWide();
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const height = wide ? HEIGHT.wide : HEIGHT.narrow;
  const [width, setWidth] = useState(0);
  const [pos, setPos] = useState<Map<string, Point>>(new Map());
  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  const [panning, setPanning] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const anim = useRef(0);
  const shine = lit ?? focused;

  // The layout's width is the box's when it's first laid out; later resizes scale the drawing (viewBox).
  useEffect(() => {
    if (box.current && !width) setWidth(Math.round(box.current.clientWidth));
  }, [width]);

  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of all.edges) {
      d.set(e.src, (d.get(e.src) ?? 0) + 1);
      d.set(e.dst, (d.get(e.dst) ?? 0) + 1);
    }
    return d;
  }, [all.edges]);
  const radius = useCallback((n: GraphNode) => {
    const d = degree.get(n.id) ?? 0;
    return kindOf(n) === "skill" ? Math.min(4 + d * 1.6, 13) : Math.min(8 + d * 1.1, 15);
  }, [degree]);

  const ids = all.nodes.map((n) => n.id).join(",");
  const posRef = useRef(pos);
  useEffect(() => {
    posRef.current = pos;
    viewRef.current = view;
  });
  const animateTo = useCallback((target: Map<string, Point>) => {
    cancelAnimationFrame(anim.current);
    const start = posRef.current;
    if (reducedMotion() || start.size === 0) return setPos(target);
    const t0 = performance.now();
    const step = (t: number) => {
      const f = Math.min(1, (t - t0) / 400);
      const e = 1 - (1 - f) ** 3;
      const next = new Map<string, Point>();
      for (const [id, p] of target) {
        const s = start.get(id) ?? p;
        next.set(id, { x: s.x + (p.x - s.x) * e, y: s.y + (p.y - s.y) * e });
      }
      setPos(next);
      if (f < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }, []);

  // Laid out once from nothing (300 ticks before the first draw), then only the new dots settle in (60 more).
  useEffect(() => {
    if (!width) return;
    const sim = all.nodes.map((n) => ({ id: n.id, r: radius(n) }));
    const from = posRef.current.size ? posRef.current : undefined;
    performance.mark("graph-layout-start");
    const next = layout(sim, all.edges, { width, height, from, ticks: from ? 60 : 300 });
    performance.measure("graph-layout", "graph-layout-start");
    if (from) animateTo(next);
    else {
      posRef.current = next;
      setPos(next);
    }
    // Only when the set of dots, or the box, changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, width, height]);

  // Wheel zoom about the pointer (a non-passive listener, so the page doesn't scroll).
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toBox(e.clientX, e.clientY);
      zoomAbout(p, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  /** A screen point in the layout's coordinates (before the zoom). */
  function toBox(cx: number, cy: number): Point {
    const r = svg.current!.getBoundingClientRect();
    const s = width / r.width;
    return { x: (cx - r.left) * s, y: (cy - r.top) * s };
  }
  function zoomAbout(p: Point, f: number) {
    setView((v) => {
      const k = Math.min(2.4, Math.max(0.6, v.k * f));
      const g = k / v.k;
      return { k, tx: p.x - (p.x - v.tx) * g, ty: p.y - (p.y - v.ty) * g };
    });
  }
  const unzoom = (p: Point) => ({ x: (p.x - viewRef.current.tx) / viewRef.current.k, y: (p.y - viewRef.current.ty) / viewRef.current.k });

  // Pointers: drag a dot, pan the background, pinch with two fingers; a press that barely moves is a click.
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ kind: "dot"; id: string; start: Point; moved: boolean } | { kind: "pan"; start: Point; from: View; moved: boolean } | { kind: "pinch"; dist: number; from: View; mid: Point } | null>(null);

  function down(e: React.PointerEvent, id: string | null) {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const p = toBox(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      gesture.current = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), from: viewRef.current, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      return;
    }
    gesture.current = id ? { kind: "dot", id, start: p, moved: false } : { kind: "pan", start: p, from: viewRef.current, moved: false };
    if (!id) setPanning(true);
  }
  function move(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    const p = toBox(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch" && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      const f = Math.hypot(a.x - b.x, a.y - b.y) / (g.dist || 1);
      const k = Math.min(2.4, Math.max(0.6, g.from.k * f));
      const s = k / g.from.k;
      setView({ k, tx: g.mid.x - (g.mid.x - g.from.tx) * s, ty: g.mid.y - (g.mid.y - g.from.ty) * s });
      return;
    }
    if (g.kind === "pinch") return;
    if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) < 4) return;
    g.moved = true;
    if (g.kind === "pan") setView({ ...g.from, tx: g.from.tx + p.x - g.start.x, ty: g.from.ty + p.y - g.start.y });
    else {
      const at = unzoom(p);
      setPos((m) => new Map(m).set(g.id, at));
    }
  }
  function up(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 0) return;
    gesture.current = null;
    setPanning(false);
    if (!g || g.kind === "pinch") return;
    if (g.kind === "dot") {
      if (!g.moved) return onOpen(g.id);
      // Dropped: the neighbours settle around it (not with reduced motion: the dot moved alone).
      if (reducedMotion()) return;
      const at = posRef.current.get(g.id);
      if (!at) return;
      const sim = all.nodes.map((n) => ({ id: n.id, r: radius(n) }));
      animateTo(layout(sim, all.edges, { width, height, from: posRef.current, ticks: 40, pinned: new Map([[g.id, at]]) }));
    }
  }

  // What's lit: the hovered, focused or open dot and its neighbours, or the search's matches.
  const near = useMemo(() => {
    if (!shine) return null;
    const s = new Set([shine]);
    for (const e of all.edges) {
      if (e.src === shine) s.add(e.dst);
      if (e.dst === shine) s.add(e.src);
    }
    return s;
  }, [shine, all.edges]);
  const on = (id: string) => (near ? near.has(id) : matches ? matches.has(id) : true);
  const edges = all.edges.filter((e) => pos.has(e.src) && pos.has(e.dst));

  // Labels: lit and matching dots first, then roles, then by links; below 1024 px only lit or matching ones.
  const labels = placeLabels(
    nodes
      .filter((n) => pos.has(n.id))
      .filter((n) => (near?.has(n.id) ?? false) || (matches?.has(n.id) ?? false) || (wide && (kindOf(n) !== "skill" || (degree.get(n.id) ?? 0) >= 3)))
      .map((n) => ({ n, rank: (near?.has(n.id) ? 0 : 4) + (matches?.has(n.id) ? 0 : 2) + (kindOf(n) === "role" ? 0 : 1) - (degree.get(n.id) ?? 0) / 100 }))
      .sort((a, b) => a.rank - b.rank)
      .map(({ n }) => ({ id: n.id, text: labelOf(n), x: pos.get(n.id)!.x, y: pos.get(n.id)!.y, r: radius(n), size: kindOf(n) === "skill" ? 11 : 12 })),
    width,
  );

  const ctl = "grid size-10 place-items-center rounded-[12px] border-[1.5px] border-line bg-surface text-[1.125rem] font-semibold text-ink hover:bg-tint";
  return (
    <figure aria-label={summary} className="relative m-0 overflow-hidden rounded-card border-[1.5px] border-line bg-surface" style={{ height }}>
      <div ref={box} className="absolute inset-0">
        {width > 0 && (
          <svg
            ref={svg}
            width="100%"
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="block touch-none select-none"
            style={{ cursor: panning ? "grabbing" : "grab" }}
            onPointerDown={(e) => down(e, null)}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          >
            <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
              <g aria-hidden="true">
                {edges.map((e) => {
                  const a = pos.get(e.src)!;
                  const b = pos.get(e.dst)!;
                  const mine = !!shine && (e.src === shine || e.dst === shine);
                  return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={mine ? "var(--color-ink-2)" : "var(--color-line)"} strokeWidth={mine ? 1.8 : 1.4} opacity={shine && !mine ? 0.25 : 1} />;
                })}
              </g>
              {nodes.map((n) => {
                const p = pos.get(n.id);
                if (!p) return null;
                const k = KIND.get(kindOf(n))!;
                const r = radius(n);
                return (
                  <g
                    key={n.id}
                    data-node={n.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${k.one}: ${labelOf(n)}`}
                    aria-haspopup="dialog"
                    opacity={on(n.id) ? 1 : 0.16}
                    className="cursor-pointer outline-none"
                    onPointerDown={(e) => (e.stopPropagation(), down(e, n.id))}
                    onPointerEnter={(e) => e.pointerType === "mouse" && onHover(n.id)}
                    onPointerLeave={(e) => e.pointerType === "mouse" && onHover(null)}
                    onFocus={() => setFocused(n.id)}
                    onBlur={() => setFocused((f) => (f === n.id ? null : f))}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      onOpen(n.id);
                    }}
                  >
                    {pulse.has(n.id) && <circle cx={p.x} cy={p.y} r={r} fill="none" stroke={k.fill} strokeWidth={2} className="graph-pulse" />}
                    <circle cx={p.x} cy={p.y} r={Math.max(r, 14)} fill="transparent" />
                    {(focused === n.id || open === n.id) && <circle data-focus-ring cx={p.x} cy={p.y} r={r + 4.5} fill="none" stroke="var(--color-ink)" strokeWidth={2.5} />}
                    <circle cx={p.x} cy={p.y} r={k.ring ? r - 1.5 : r} fill={k.ring ? "var(--color-surface)" : k.fill} stroke={k.ring ? k.fill : "none"} strokeWidth={k.ring ? 3 : 0} />
                  </g>
                );
              })}
              <g aria-hidden="true">
                {labels.map((l) => (
                  <text
                    key={l.id}
                    x={l.lx}
                    y={l.ly}
                    textAnchor="middle"
                    opacity={on(l.id) ? 1 : 0.16}
                    className="pointer-events-none"
                    style={{ font: `${l.size === 11 ? 500 : 600} ${l.size}px var(--font-sans), sans-serif`, fill: "var(--color-ink)", paintOrder: "stroke", stroke: "var(--color-surface)", strokeWidth: 3, strokeLinejoin: "round" }}
                  >
                    {l.text}
                  </text>
                ))}
              </g>
            </g>
          </svg>
        )}
      </div>
      <div className="absolute top-3 right-3 flex flex-col gap-1.5">
        <button type="button" aria-label="Zoom in" onClick={() => zoomAbout({ x: width / 2, y: height / 2 }, 1.25)} className={ctl}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAbout({ x: width / 2, y: height / 2 }, 1 / 1.25)} className={ctl}>
          −
        </button>
        <button type="button" aria-label="Fit the graph" onClick={() => setView({ k: 1, tx: 0, ty: 0 })} className={`${ctl} text-[0.75rem]`}>
          Fit
        </button>
      </div>
      <p aria-hidden="true" className="pointer-events-none absolute bottom-2.5 left-3.5 text-[0.75rem] text-ink-2">
        <span className="pointer-coarse:hidden">Click a dot for its card. Scroll to zoom, drag to move.</span>
        <span className="hidden pointer-coarse:inline">Tap a dot for its card. Pinch to zoom.</span>
      </p>
    </figure>
  );
}

// ---- the card -------------------------------------------------------------------------------------------------------------

function Sheet({ title, onClose, focus, children }: { title: string; onClose: () => void; focus: string; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const wide = useWide();
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  // Focus moves into the card, and to the right control when the card changes mode.
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>(focus)?.focus();
  }, [focus]);
  return (
    <>
      {!wide && <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-[60] bg-[rgba(15,26,21,0.35)]" />}
      <section
        ref={panel}
        role="dialog"
        aria-modal={!wide}
        aria-label={title}
        className="fixed z-[61] flex flex-col gap-3.5 overflow-y-auto bg-surface p-5 max-laptop:inset-x-0 max-laptop:bottom-0 max-laptop:max-h-[76svh] max-laptop:rounded-t-[22px] max-laptop:pb-[calc(24px+env(safe-area-inset-bottom))] laptop:top-0 laptop:right-0 laptop:h-svh laptop:w-[400px] laptop:border-l-[1.5px] laptop:border-line laptop:shadow-e2"
      >
        <span aria-hidden="true" className="mx-auto -mt-2 h-1 w-10 rounded-full bg-line laptop:hidden" />
        {children}
      </section>
    </>
  );
}

/** "From: Your resume" and the line it quotes, the GitHub repo, the page on your site, or a fact you added. */
function Origin({ node }: { node: GraphNode }) {
  const o = originOf(node);
  if (!o) return null;
  const link = "font-medium text-ink underline underline-offset-[3px] break-all";
  const from = o.kind === "github" ? "GitHub" : o.kind === "site" ? "Your website" : o.kind === "user" ? "A fact you added" : "Your resume";
  return (
    <div className="flex flex-col gap-1 border-l-[3px] border-line pl-2.5 text-small text-ink-2">
      <p>
        <span className="font-semibold text-ink">From:</span> {from}
        {fixedThisVisit.has(node.id) && " · You fixed this card."}
      </p>
      {o.kind === "resume" && o.label && <p className="leading-[1.45]">&ldquo;{o.label}&rdquo;</p>}
      {(o.kind === "github" || o.kind === "site") && o.ref && (
        <p>
          <a href={o.ref} target="_blank" rel="noopener noreferrer" className={link}>
            {o.label ?? o.ref}&nbsp;<span aria-hidden="true">↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      )}
      {o.kind === "user" && <p>In your words.</p>}
    </div>
  );
}

function NodeCard({ node, data, onClose, onOpen, onChanged }: {
  node: GraphNode;
  data: Graph;
  onClose: () => void;
  onOpen: (id: string) => void;
  onChanged: (msg: string | null, closed: boolean) => Promise<void>;
}) {
  const kind = kindOf(node);
  const skill = kind === "skill";
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const linked = data.edges.filter((e) => e.src === node.id || e.dst === node.id).map((e) => byId.get(e.src === node.id ? e.dst : e.src)).filter((n): n is GraphNode => !!n);
  const skills = linked.filter((n) => kindOf(n) === "skill");
  const uses = linked.filter((n) => kindOf(n) !== "skill");

  async function remove() {
    if (busy) return;
    setBusy(true);
    const r = await api.removeNode(node.id);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await onChanged(skill ? `Removed ${titleOf(node)} from ${plural(uses.length, "fact", "facts")}.` : "Removed from your graph.", true);
  }

  return (
    <Sheet title={mode === "edit" ? "Fix this card" : titleOf(node)} onClose={onClose} focus={mode === "edit" ? "#fix-title" : mode === "confirm" ? "#keep-it" : "#card-close"}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[0.75rem] font-semibold tracking-[0.06em] text-ink-2 uppercase">
          <KindDot kind={kind} />
          {KIND.get(kind)!.one}
        </span>
        <button id="card-close" type="button" aria-label="Close" onClick={onClose} className="grid size-11 place-items-center rounded-[12px] border-[1.5px] border-line text-[1.25rem] text-ink hover:bg-tint">
          ×
        </button>
      </div>

      {mode === "edit" ? (
        <FixForm
          node={node}
          onCancel={() => setMode("view")}
          onSaved={async () => {
            fixedThisVisit.add(node.id);
            setMode("view");
            setSaved("Saved. Nori matches with this from now on.");
            void noriReact({ row: "nod", say: "Fixed it." });
            await onChanged(null, false);
          }}
        />
      ) : (
        <>
          <h2 className="font-serif text-[1.75rem] leading-[1.15] text-ink">{titleOf(node)}</h2>
          <p className={`${HINT} -mt-1.5 text-[0.875rem]`}>{skill ? skillMeta(node) : [node.props.org, dates(node)].filter(Boolean).join(" · ")}</p>
          {!skill && node.props.statement && <p className="leading-[1.5] text-ink">{node.props.statement}</p>}
          {!skill && <Origin node={node} />}
          {!skill && skills.length > 0 && (
            <div>
              <p className="mb-1.5 text-ui font-semibold text-ink">Skills</p>
              <ul className="flex flex-wrap gap-1.5">
                {skills.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => onOpen(s.id)} className="flex min-h-[34px] items-center rounded-full bg-tint px-3 text-small text-ink hover:bg-line">
                      {titleOf(s)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {skill && uses.length > 0 && (
            <div>
              <p className="mb-1 text-ui font-semibold text-ink">Used in {plural(uses.length, "fact", "facts")}</p>
              <ul className="flex flex-col">
                {uses.map((u) => (
                  <li key={u.id}>
                    <button type="button" onClick={() => onOpen(u.id)} className="min-h-10 text-left text-small font-medium text-ink underline underline-offset-[3px]">
                      {labelOf(u)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {skill && <p className={HINT}>A skill changes through the cards that name it: fix one of those.</p>}
          {saved && <Status>{saved}</Status>}
          {error && <Status tone="error">{error}</Status>}
          {mode === "confirm" ? (
            <div role="alertdialog" aria-labelledby="remove-q" className="flex flex-col gap-2.5 rounded-[14px] bg-tint p-3.5">
              <p id="remove-q" className="leading-[1.4] font-semibold text-ink">
                {skill ? `Remove ${titleOf(node)} from ${plural(uses.length, "fact", "facts")}?` : "Remove this from your graph?"} Nori stops using it in matches and resumes.
              </p>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => void remove()} aria-disabled={busy || undefined} className={DANGER_FILL}>
                  {busy ? "Removing…" : "Remove"}
                </button>
                <button id="keep-it" type="button" onClick={() => setMode("view")} className={TEXT_BUTTON}>
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-4">
              {!skill && (
                <button type="button" onClick={() => (setMode("edit"), setSaved(null), setError(null))} className={buttonClass("outline", "min-h-11")}>
                  Fix
                </button>
              )}
              <button type="button" onClick={() => (setMode("confirm"), setSaved(null))} className={DANGER_BUTTON}>
                Remove
              </button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

// ---- Fix ------------------------------------------------------------------------------------------------------------------

const DATE = /^\d{4}(-(0[1-9]|1[0-2]))?$/;

function FixForm({ node, onCancel, onSaved }: { node: GraphNode; onCancel: () => void; onSaved: () => Promise<void> }) {
  const start = {
    title: titleOf(node),
    org: node.props.org ?? "",
    statement: node.props.statement ?? "",
    skills: node.props.skills ?? [],
    from: node.startDate ?? "",
    to: node.endDate ?? "",
    still: !!node.startDate && !node.endDate,
  };
  const [v, setV] = useState(start);
  const [skillText, setSkillText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const update = (p: Partial<typeof v>) => (setV((x) => ({ ...x, ...p })), setError(null));
  function addSkill() {
    const s = skillText.trim();
    if (s && !v.skills.some((x) => x.toLowerCase() === s.toLowerCase())) update({ skills: [...v.skills, s] });
    setSkillText("");
  }

  async function save() {
    if (busy) return;
    const from = v.from.trim();
    const to = v.still ? "" : v.to.trim();
    if (!v.title.trim()) return setError("Give it a title.");
    if (from && !DATE.test(from)) return setError("Write the start as a year, like 2021, or a month, like 2021-03.");
    if (to && !DATE.test(to)) return setError("Write the end as a year or a month, or tick “I still do this”.");
    if (from && to && to < from) return setError("The end is before the start.");
    const patch: NodePatch = {};
    if (v.title.trim() !== start.title) patch.title = v.title.trim();
    if (v.org.trim() !== start.org) patch.org = v.org.trim() || null;
    if (v.statement.trim() !== start.statement) patch.statement = v.statement.trim();
    if (v.skills.join("\n").toLowerCase() !== start.skills.join("\n").toLowerCase()) patch.skills = v.skills;
    if (from !== start.from) patch.startDate = from || null;
    // "I still do this" is an empty end; an empty To on a card that had one clears it too.
    if ((v.still ? "" : to) !== (start.still ? "" : start.to)) patch.endDate = to || null;
    if (Object.keys(patch).length === 0) return setError("Nothing has changed yet.");
    setBusy(true);
    const r = await api.editNode(node.id, patch);
    setBusy(false);
    if (!r.ok) return setError(r.status === 404 ? "That card was not found." : r.error);
    await onSaved();
  }

  return (
    <form
      noValidate
      onSubmit={(e) => (e.preventDefault(), void save())}
      className="flex flex-col gap-3.5"
    >
      <h2 className="font-serif text-[1.5rem] leading-[1.15] text-ink">Fix this card</h2>
      <Field id="fix-title" label="Title" value={v.title} onChange={(e) => update({ title: e.target.value })} />
      <Field id="fix-org" label="Company or school" value={v.org} onChange={(e) => update({ org: e.target.value })} />
      <div className="flex flex-col gap-2">
        <label htmlFor="fix-statement" className="text-ui leading-[1.3] font-semibold text-ink">
          What it says
        </label>
        <textarea id="fix-statement" rows={3} value={v.statement} onChange={(e) => update({ statement: e.target.value })} className="w-full rounded-input border-[1.5px] border-line-strong bg-surface px-3.5 py-2.5 text-body leading-[1.45] text-ink" />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-ui leading-[1.3] font-semibold text-ink">Skills</p>
        {v.skills.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Skills on this card">
            {v.skills.map((s) => (
              <li key={s} className="flex h-[34px] items-center gap-1 rounded-full bg-tint pr-1 pl-3 text-small text-ink">
                {s}
                <button type="button" aria-label={`Remove ${s}`} onClick={() => update({ skills: v.skills.filter((x) => x !== s) })} className="grid size-6 place-items-center rounded-full text-ink-2 hover:bg-surface">
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <label htmlFor="fix-skill" className="sr-only">
            Add a skill
          </label>
          <input
            id="fix-skill"
            value={skillText}
            placeholder="Add a skill"
            onChange={(e) => setSkillText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSkill())}
            className="h-12 min-w-0 flex-1 rounded-input border-[1.5px] border-line-strong bg-surface px-3.5 text-body text-ink"
          />
          <button type="button" onClick={addSkill} className={buttonClass("outline", "min-h-12 px-4")}>
            Add
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field id="fix-from" label="From" placeholder="2021 or 2021-03" inputMode="numeric" value={v.from} onChange={(e) => update({ from: e.target.value })} />
        <div className={v.still ? "opacity-45" : ""}>
          <Field id="fix-to" label="To" placeholder="2023 or 2023-06" inputMode="numeric" value={v.still ? "" : v.to} disabled={v.still} onChange={(e) => update({ to: e.target.value })} />
        </div>
      </div>
      <label className="-mt-1 flex min-h-10 items-center gap-2.5 text-[0.9375rem] text-ink">
        <input type="checkbox" checked={v.still} onChange={(e) => update({ still: e.target.checked })} className="size-5 accent-accent" />I still do this
      </label>
      {error && <Status tone="error">{error}</Status>}
      <div className="flex items-center gap-3">
        <button type="submit" aria-disabled={busy || undefined} className={buttonClass("primary", "min-h-11")}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className={TEXT_BUTTON}>
          Cancel
        </button>
      </div>
      <p className={HINT}>If you add a newer resume, cards from your resume are replaced, including ones you&rsquo;ve fixed.</p>
    </form>
  );
}

// ---- Add a fact: Write it, or Add a source ----------------------------------------------------------------------------------

type Tab = "write" | "source";

function AddDialog({ onClose, onDone, onGraphChanged }: { onClose: () => void; onDone: (msg: string) => Promise<void>; onGraphChanged: () => Promise<boolean> }) {
  const [tab, setTab] = useState<Tab>("write");
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const was = opener.current;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onKey);
      was?.focus();
    };
  }, []);
  // Tab stays inside the dialog.
  function trap(e: React.KeyboardEvent) {
    if (e.key !== "Tab" || !panel.current) return;
    const all = [...panel.current.querySelectorAll<HTMLElement>("button, input, textarea, a[href], [tabindex='0']")].filter((el) => !el.hasAttribute("disabled") && el.getClientRects().length);
    const first = all[0];
    const last = all.at(-1);
    if (!first || !last) return;
    const to = e.shiftKey ? (document.activeElement === first ? last : null) : document.activeElement === last ? first : null;
    if (!to) return;
    e.preventDefault();
    to.focus();
  }
  const tabs: [Tab, string][] = [["write", "Write it"], ["source", "Add a source"]];
  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-[60] bg-[rgba(15,26,21,0.35)]" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-title"
        onKeyDown={trap}
        className="fixed z-[61] flex flex-col gap-4 overflow-y-auto bg-surface p-5 max-tablet:inset-x-0 max-tablet:bottom-0 max-tablet:max-h-[88svh] max-tablet:rounded-t-[22px] max-tablet:pb-[calc(24px+env(safe-area-inset-bottom))] tablet:top-1/2 tablet:left-1/2 tablet:max-h-[86svh] tablet:w-[560px] tablet:-translate-x-1/2 tablet:-translate-y-1/2 tablet:rounded-card tablet:border-[1.5px] tablet:border-line tablet:p-6 tablet:shadow-e2"
      >
        <div className="flex items-center justify-between">
          <h2 id="add-title" className="font-serif text-[1.5rem] leading-[1.15] text-ink">
            Add to your graph
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} className="grid size-11 place-items-center rounded-[12px] border-[1.5px] border-line text-[1.25rem] text-ink hover:bg-tint">
            ×
          </button>
        </div>
        <div role="tablist" aria-label="How to add" className="flex gap-5 border-b-[1.5px] border-line">
          {tabs.map(([id, label], i) => (
            <button
              key={id}
              id={`add-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`add-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                const next = tabs[(i + 1) % tabs.length]![0];
                setTab(next);
                document.getElementById(`add-tab-${next}`)?.focus();
              }}
              className={`-mb-[1.5px] min-h-11 border-b-[2.5px] text-ui ${tab === id ? "border-accent font-semibold text-ink" : "border-transparent font-medium text-ink-2 hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div id={`add-panel-${tab}`} role="tabpanel" aria-labelledby={`add-tab-${tab}`} className="flex flex-col gap-4">
          {tab === "write" ? <WriteTab onDone={onDone} /> : <SourcesTab onGraphChanged={onGraphChanged} />}
        </div>
      </div>
    </>
  );
}

function WriteTab({ onDone }: { onDone: (msg: string) => Promise<void> }) {
  const [resume, setResume] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!resume) box.current?.focus();
  }, [resume]);
  async function add() {
    if (busy) return;
    if (text.trim().length < 3) return setError("Tell us a bit more");
    setBusy(true);
    setError(null);
    void noriReact({ event: "preparing", say: "Reading it…" }, 0);
    const r = await api.addFact(text.trim());
    setBusy(false);
    if (!r.ok) {
      void noriReact({ event: "idle" });
      return setError(r.error);
    }
    const said = r.data.note ?? `Added ${r.data.nodesCreated} to your graph.`;
    void noriReact({ row: "hop", say: r.data.note ? "Saved it." : said });
    await onDone(said);
  }
  if (resume) return <ResumePanel onCancel={() => setResume(false)} onDone={onDone} />;
  return (
    <form noValidate onSubmit={(e) => (e.preventDefault(), void add())} className="flex flex-col gap-3">
      <label htmlFor="fact-box" className="text-ui font-semibold text-ink">
        In your own words
      </label>
      <textarea
        ref={box}
        id="fact-box"
        rows={4}
        maxLength={2000}
        value={text}
        placeholder="A project, a result with a number, a certificate, a tool you use."
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "fact-hint fact-error" : "fact-hint"}
        onChange={(e) => (setText(e.target.value), setError(null))}
        className="w-full rounded-input border-[1.5px] border-line-strong bg-surface px-3.5 py-2.5 text-body leading-[1.45] text-ink aria-invalid:border-danger"
      />
      {error && (
        <p id="fact-error" role="alert" className="-mt-1 text-small text-danger">
          {error}
        </p>
      )}
      <p id="fact-hint" className={HINT}>
        Nori reads it into your graph: the fact, its skills, and what it links to. It&rsquo;s marked as added by you.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" aria-disabled={busy || undefined} className={buttonClass("primary", "min-h-11")}>
          Add it
        </button>
        {busy && (
          <p role="status" className={HINT}>
            Nori is reading it…
          </p>
        )}
      </div>
      <p className={`${HINT} border-t-[1.5px] border-line pt-3`}>
        Have a newer resume?{" "}
        <button type="button" onClick={() => setResume(true)} className="min-h-6 font-semibold text-ink underline underline-offset-[3px]">
          Add a newer resume
        </button>
      </p>
    </form>
  );
}

function ResumePanel({ onCancel, onDone }: { onCancel: () => void; onDone: (msg: string) => Promise<void> }) {
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  async function send(run: () => ReturnType<typeof api.resumeText>) {
    setBusy(true);
    setError(null);
    void noriReact({ event: "preparing", say: "Reading it…" }, 0);
    const r = await run();
    setBusy(false);
    if (!r.ok) {
      void noriReact({ event: "idle" });
      return setError(r.error);
    }
    const n = r.data.nodes.length;
    const said = r.data.note ?? `Nori read your resume: ${plural(n, "card", "cards")} from it.`;
    void noriReact({ row: "hop", say: "Read it." });
    await onDone(said);
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ui font-semibold text-ink">Add a newer resume</p>
      <p className={HINT}>Nori replaces what came from your old resume, including cards you&rsquo;ve fixed. Facts you added stay.</p>
      {paste ? (
        <>
          <label htmlFor="resume-text" className="sr-only">
            Your resume&rsquo;s text
          </label>
          <textarea id="resume-text" rows={6} value={text} onChange={(e) => (setText(e.target.value), setError(null))} className="w-full rounded-input border-[1.5px] border-line-strong bg-surface px-3.5 py-2.5 text-body text-ink" />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" aria-disabled={busy || undefined} onClick={() => (text.trim().length < 20 ? setError("Paste the full resume text") : void send(() => api.resumeText(text.trim())))} className={buttonClass("primary", "min-h-11")}>
              {busy ? "Reading…" : "Read it"}
            </button>
            <button type="button" onClick={() => setPaste(false)} className={TEXT_BUTTON}>
              Choose a file instead
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={file}
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            className="sr-only"
            id="resume-file"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 10 * 1024 * 1024) return setError("That file is too large. Resumes up to 10 MB are accepted.");
              void send(() => api.resumeFile(f));
            }}
          />
          <button type="button" aria-disabled={busy || undefined} onClick={() => file.current?.click()} className={buttonClass("primary", "min-h-11")}>
            {busy ? "Reading…" : "Choose a file"}
          </button>
          <button type="button" onClick={() => setPaste(true)} className={TEXT_BUTTON}>
            Paste the text
          </button>
          <button type="button" onClick={onCancel} className={TEXT_BUTTON}>
            Back to a fact
          </button>
          <p className={`${HINT} w-full`}>PDF, DOCX or text, up to 10 MB.</p>
        </div>
      )}
      {busy && (
        <p role="status" className={HINT}>
          Nori is reading it…
        </p>
      )}
      {error && <Status tone="error">{error}</Status>}
    </div>
  );
}

// ---- sources --------------------------------------------------------------------------------------------------------------

const SOURCE_KIND: Record<GraphSource["kind"], { name: string; label: string; hint: string; placeholder: string }> = {
  github: { name: "GitHub", label: "GitHub username", hint: "Your public repos (not forks or archived) become projects.", placeholder: "your-username" },
  site: { name: "Website", label: "Your website", hint: "The page you give, read like a resume.", placeholder: "yourname.com" },
  linkedin: { name: "LinkedIn", label: "LinkedIn link", hint: "Kept so it can go on your applications. Norinote never reads LinkedIn.", placeholder: "linkedin.com/in/your-name" },
};
const shownValue = (s: GraphSource) => s.value.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

function sourceState(s: GraphSource): { tone: ChipTone; text: string; busy?: boolean } {
  if (s.kind === "linkedin") return { tone: "neutral", text: "Kept, never read" };
  if (s.status === "pending") return { tone: "waiting", text: "Waiting to be read" };
  if (s.status === "reading") return { tone: "working", text: "Reading", busy: true };
  if (s.status === "failed") return { tone: "bad", text: "Couldn’t read it" };
  return { tone: "done", text: `${plural(s.factsAdded, "fact", "facts")} added` };
}

function SourcesTab({ onGraphChanged }: { onGraphChanged: () => Promise<boolean> }) {
  const [sources, setSources] = useState<GraphSource[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const seen = useRef<Map<string, string>>(new Map());

  const apply = useCallback((r: Awaited<ReturnType<typeof api.graphSources>>) => {
    if (!r.ok) return setLoadError(r.error);
    setLoadError(null);
    // A source that finished reading since the last look brings new dots: the graph reloads.
    const finished = r.data.sources.some((s) => {
      const was = seen.current.get(s.id);
      return was !== undefined && was !== s.status && s.status === "done";
    });
    seen.current = new Map(r.data.sources.map((s) => [s.id, s.status]));
    setSources(r.data.sources);
    if (finished) void onGraphChanged();
  }, [onGraphChanged]);
  const load = useCallback(async () => apply(await api.graphSources()), [apply]);
  useEffect(() => {
    void api.graphSources().then(apply);
  }, [apply]);
  // While one is waiting or being read, look again every few seconds.
  const waiting = !!sources?.some((s) => s.kind !== "linkedin" && (s.status === "pending" || s.status === "reading"));
  useEffect(() => {
    if (!waiting) return;
    const t = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(t);
  }, [waiting, load]);

  return (
    <>
      <p className="leading-[1.45] text-ink">Norinote reads only what you name here. It never searches for you by name.</p>
      {(["github", "site", "linkedin"] as const).map((kind) => (
        <SourceForm
          key={kind}
          kind={kind}
          onAdded={async (text) => {
            setMsg({ text, tone: "ok" });
            await load();
          }}
        />
      ))}
      <section aria-labelledby="sources-title" className="flex flex-col gap-2.5 border-t-[1.5px] border-line pt-4">
        <h3 id="sources-title" className="text-ui font-semibold text-ink">
          Your sources
        </h3>
        {msg && <Status tone={msg.tone}>{msg.text}</Status>}
        {loadError && !sources ? (
          <div className="flex flex-wrap items-center gap-3">
            <Status tone="error">{loadError}</Status>
            <button type="button" onClick={() => void load()} className={TEXT_BUTTON}>
              Try again
            </button>
          </div>
        ) : !sources ? (
          <div aria-hidden="true" className="h-14 animate-pulse rounded-[14px] bg-tint" />
        ) : sources.length === 0 ? (
          <p className={HINT}>None yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sources.map((s) => (
              <SourceRow
                key={s.id}
                source={s}
                onChanged={async (text, graph) => {
                  setMsg(text ? { text, tone: "ok" } : null);
                  await load();
                  if (graph) await onGraphChanged();
                }}
              />
            ))}
          </ul>
        )}
        <p className={HINT}>Removing a source removes every fact read from it.</p>
      </section>
    </>
  );
}

function SourceForm({ kind, onAdded }: { kind: GraphSource["kind"]; onAdded: (msg: string) => Promise<void> }) {
  const k = SOURCE_KIND[kind];
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function add() {
    if (busy) return;
    if (!value.trim()) return setError(kind === "github" ? "Add your GitHub username" : "Add a link");
    setBusy(true);
    const r = await api.addGraphSource(kind, value.trim());
    setBusy(false);
    if (!r.ok) return setError([r.error, r.detail].filter(Boolean).join(". "));
    setValue("");
    setError(null);
    const again = r.status === 200;
    await onAdded(again ? "That one is already here." : kind === "linkedin" ? "Kept. Norinote never reads LinkedIn." : "Added. Nori reads it in a minute or two.");
  }
  return (
    <form noValidate onSubmit={(e) => (e.preventDefault(), void add())} className="flex flex-col gap-1.5">
      <label htmlFor={`source-${kind}`} className="text-ui font-semibold text-ink">
        {k.label}
      </label>
      <div className="flex gap-2">
        <input
          id={`source-${kind}`}
          value={value}
          placeholder={k.placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={`source-${kind}-note`}
          onChange={(e) => (setValue(e.target.value), setError(null))}
          className="h-12 min-w-0 flex-1 rounded-input border-[1.5px] border-line-strong bg-surface px-3.5 text-body text-ink aria-invalid:border-danger"
        />
        <button type="submit" aria-disabled={busy || undefined} aria-label={`Add ${k.label.replace(/^Your/, "your")}`} className={buttonClass("outline", "min-h-12 px-5")}>
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      <p id={`source-${kind}-note`} role={error ? "alert" : undefined} className={`text-small ${error ? "text-danger" : "text-ink-2"}`}>
        {error ?? k.hint}
      </p>
    </form>
  );
}

function SourceRow({ source: s, onChanged }: { source: GraphSource; onChanged: (msg: string | null, graph: boolean) => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = sourceState(s);
  const name = SOURCE_KIND[s.kind].name;
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirm) keep.current?.focus();
  }, [confirm]);

  async function refresh() {
    if (busy) return;
    setBusy(true);
    const r = await api.refreshGraphSource(s.id);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await onChanged(`Nori reads ${name} again. Its facts are replaced when it’s done.`, false);
  }
  async function remove() {
    if (busy) return;
    setBusy(true);
    const r = await api.removeGraphSource(s.id);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await onChanged(`Removed ${name}.${r.data.factsRemoved ? ` ${plural(r.data.factsRemoved, "fact", "facts")} went with it.` : ""}`, r.data.factsRemoved > 0);
  }

  return (
    <li className="flex flex-col gap-2 rounded-[14px] border-[1.5px] border-line px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-[0.9375rem] text-ink">
          <span className="font-semibold">{name}</span> <span className="break-all text-ink-2">· {shownValue(s)}</span>
        </p>
        <StatusChip tone={state.tone} busy={state.busy}>
          {state.text}
        </StatusChip>
      </div>
      <p className={HINT}>
        {s.kind === "linkedin" ? `Added ${shortDate(s.createdAt)}` : s.lastReadAt ? `Read ${shortDate(s.lastReadAt)}` : `Added ${shortDate(s.createdAt)}`}
      </p>
      {s.status === "failed" && s.error && <p className="text-small text-danger">{s.error}</p>}
      {error && <Status tone="error">{error}</Status>}
      {confirm ? (
        <div role="alertdialog" aria-labelledby={`remove-source-${s.id}`} className="flex flex-col gap-2 rounded-[12px] bg-tint p-3">
          <p id={`remove-source-${s.id}`} className="leading-[1.4] font-semibold text-ink">
            Remove {name}? {s.factsAdded ? `Its ${plural(s.factsAdded, "fact goes", "facts go")} with it.` : "Nothing in your graph came from it yet."}
          </p>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => void remove()} aria-disabled={busy || undefined} className={DANGER_FILL}>
              {busy ? "Removing…" : "Remove"}
            </button>
            <button ref={keep} type="button" onClick={() => setConfirm(false)} className={TEXT_BUTTON}>
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          {s.kind !== "linkedin" && (
            <button type="button" onClick={() => void refresh()} aria-disabled={busy || state.busy || undefined} aria-label={`Read again, ${name}`} className={TEXT_BUTTON}>
              Read again
            </button>
          )}
          <button type="button" onClick={() => (setConfirm(true), setError(null))} aria-label={`Remove ${name}`} className={DANGER_BUTTON}>
            Remove
          </button>
        </div>
      )}
    </li>
  );
}
