"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buttonClass } from "@/components/Button";
import { Field } from "@/components/auth/fields";
import { api, type GraphEdge, type GraphNode, type NodePatch } from "@/lib/api";
import { noriReact } from "@/lib/auth-flow";
import { layout, placeLabels, type Point } from "@/lib/graph-layout";
import { CARD, DANGER_BUTTON, DANGER_FILL, H2, HINT, Status, TEXT_BUTTON } from "./YouTabs";

/* /you: the career graph (4c spec section 3): a drawn graph with a list view, a card per item, Fix, Remove, adding a
   fact and a newer resume. */

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

const HEIGHT = { wide: 520, narrow: 440 };
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

type Msg = { text: string; tone: "ok" | "error" } | null;

/** Cards fixed in this visit: the API keeps no record of edits, so "You fixed this card." lasts until a reload. */
const fixedThisVisit = new Set<string>();

// ---- the page -----------------------------------------------------------------------------------------------------------

export function CareerGraphPage() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const view = params.get("view") === "list" ? "list" : "graph";
  const [data, setData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<Kind>>(new Set());
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [composer, setComposer] = useState<"fact" | "resume" | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [pulse, setPulse] = useState<Set<string>>(new Set());
  const known = useRef<Set<string> | null>(null);
  const opener = useRef<HTMLElement | null>(null);

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

  const setView = (v: "graph" | "list") => router.replace(v === "list" ? `${path}?view=list` : path, { scroll: false });
  const byId = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);
  const open = openId ? (byId.get(openId) ?? null) : null;
  const count = (k: Kind) => (data?.nodes ?? []).filter((n) => kindOf(n) === k).length;
  const counts = [
    count("role") && plural(count("role"), "role", "roles"),
    count("project") && plural(count("project"), "project", "projects"),
    count("metric") && plural(count("metric"), "result", "results"),
    count("education") + count("certification") && plural(count("education") + count("certification"), "degree or certificate", "degrees and certificates"),
    count("skill") && plural(count("skill"), "skill", "skills"),
  ].filter(Boolean).join(" · ");

  const query = q.trim().toLowerCase();
  const matches = useMemo(() => new Set(query ? (data?.nodes ?? []).filter((n) => labelOf(n).toLowerCase().includes(query)).map((n) => n.id) : []), [data, query]);

  function openCard(id: string) {
    opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    setOpenId(id);
  }
  function closeCard() {
    setOpenId(null);
    opener.current?.focus();
  }

  const empty = !!data && data.nodes.length === 0;
  const visible = (data?.nodes ?? []).filter((n) => !hidden.has(kindOf(n)) && (view === "graph" || !query || matches.has(n.id)));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className={H2}>Your career graph</h2>
          <p className={`${HINT} mt-1 min-h-5 tabular-nums`}>{data ? counts || "Nothing yet" : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Show as" className="flex gap-1">
            {(["graph", "list"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`flex h-10 items-center rounded-full border-[1.5px] px-4 text-small font-medium ${view === v ? "border-ink bg-ink text-bg" : "border-line-strong text-ink hover:bg-tint"}`}
              >
                {v === "graph" ? "Graph" : "List"}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => (setComposer("fact"), setMsg(null))} className={buttonClass("primary", "min-h-11")}>
            Add a fact
          </button>
        </div>
      </div>
      <button type="button" onClick={() => (setComposer("resume"), setMsg(null))} className="-mt-2 min-h-9 self-start text-small font-medium text-ink underline underline-offset-[3px]">
        Add a newer resume
      </button>

      {composer === "fact" && (
        <FactComposer
          onCancel={() => setComposer(null)}
          onDone={async (text) => {
            setComposer(null);
            await load();
            setMsg({ text, tone: "ok" });
          }}
        />
      )}
      {composer === "resume" && (
        <ResumePanel
          onCancel={() => setComposer(null)}
          onDone={async (text) => {
            setComposer(null);
            setOpenId(null);
            await load();
            setMsg({ text, tone: "ok" });
          }}
        />
      )}
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
          <div aria-hidden="true" className="h-10" />
          <div aria-hidden="true" className="h-12" />
          <div aria-hidden="true" className="h-[440px] animate-pulse rounded-card border-[1.5px] border-line bg-surface laptop:h-[520px]" />
        </>
      ) : empty ? (
        <div className={`${CARD} items-start`}>
          <p className="text-[1.0625rem] font-semibold text-ink">Your graph is empty.</p>
          <p className={HINT}>Add your resume or a fact and Nori builds it from there.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setComposer("resume")} className={buttonClass("primary", "min-h-11")}>
              Add your resume
            </button>
            <button type="button" onClick={() => setComposer("fact")} className={buttonClass("outline", "min-h-11")}>
              Add a fact
            </button>
          </div>
        </div>
      ) : (
        <>
          <div role="group" aria-label="Kinds" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] tablet:mx-0 tablet:flex-wrap tablet:px-0 [&::-webkit-scrollbar]:hidden">
            {KINDS.map((k) => {
              const on = !hidden.has(k.kind);
              return (
                <button
                  key={k.kind}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setHidden((h) => (h.has(k.kind) ? new Set([...h].filter((x) => x !== k.kind)) : new Set([...h, k.kind])))}
                  className={`flex h-10 flex-none items-center gap-2 rounded-full border-[1.5px] bg-surface px-3.5 text-small font-medium text-ink ${on ? "border-line-strong" : "border-line line-through opacity-55"}`}
                >
                  <span aria-hidden="true" className="size-2.5 rounded-full" style={k.ring ? { boxShadow: `inset 0 0 0 2px ${k.fill}` } : { background: k.fill }} />
                  {k.label}
                </button>
              );
            })}
          </div>
          <div>
            <label htmlFor="graph-find" className="sr-only">
              Find in your graph
            </label>
            <input
              id="graph-find"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find in your graph"
              className="h-12 w-full rounded-input border-[1.5px] border-line-strong bg-surface px-3.5 text-body text-ink"
            />
          </div>

          {view === "graph" ? (
            <CareerGraph
              nodes={visible}
              all={data}
              matches={query ? matches : null}
              lit={openId ?? hover}
              pulse={pulse}
              onHover={setHover}
              onOpen={openCard}
              summary={`Your career graph: ${counts}. The List view has the same items.`}
            />
          ) : (
            <GraphList nodes={visible} onOpen={openCard} />
          )}
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
    </>
  );
}

// ---- the drawn graph ------------------------------------------------------------------------------------------------------

type View = { k: number; tx: number; ty: number };

function CareerGraph({ nodes, all, matches, lit, pulse, onHover, onOpen, summary }: {
  nodes: GraphNode[];
  all: { nodes: GraphNode[]; edges: GraphEdge[] };
  matches: Set<string> | null;
  lit: string | null;
  pulse: Set<string>;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
  summary: string;
}) {
  const wide = useWide();
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const height = wide ? HEIGHT.wide : HEIGHT.narrow;
  const [width, setWidth] = useState(0);
  const [pos, setPos] = useState<Map<string, Point>>(new Map());
  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  const [panning, setPanning] = useState(false);
  const anim = useRef(0);

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

  // What's lit: the hovered or open dot and its neighbours, or the search's matches.
  const shown = new Set(nodes.map((n) => n.id));
  const near = useMemo(() => {
    if (!lit) return null;
    const s = new Set([lit]);
    for (const e of all.edges) {
      if (e.src === lit) s.add(e.dst);
      if (e.dst === lit) s.add(e.src);
    }
    return s;
  }, [lit, all.edges]);
  const on = (id: string) => (near ? near.has(id) : matches ? matches.has(id) : true);
  const edges = all.edges.filter((e) => shown.has(e.src) && shown.has(e.dst) && pos.has(e.src) && pos.has(e.dst));

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
            aria-hidden="true"
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
              {edges.map((e) => {
                const a = pos.get(e.src)!;
                const b = pos.get(e.dst)!;
                const mine = !!lit && (e.src === lit || e.dst === lit);
                return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={mine ? "var(--color-ink-2)" : "var(--color-line)"} strokeWidth={mine ? 1.8 : 1.4} opacity={lit && !mine ? 0.25 : 1} />;
              })}
              {nodes.map((n) => {
                const p = pos.get(n.id);
                if (!p) return null;
                const k = KIND.get(kindOf(n))!;
                const r = radius(n);
                return (
                  <g
                    key={n.id}
                    data-node={n.id}
                    opacity={on(n.id) ? 1 : 0.16}
                    className="cursor-pointer"
                    onPointerDown={(e) => (e.stopPropagation(), down(e, n.id))}
                    onPointerEnter={(e) => e.pointerType === "mouse" && onHover(n.id)}
                    onPointerLeave={(e) => e.pointerType === "mouse" && onHover(null)}
                  >
                    {pulse.has(n.id) && <circle cx={p.x} cy={p.y} r={r} fill="none" stroke={k.fill} strokeWidth={2} className="graph-pulse" />}
                    <circle cx={p.x} cy={p.y} r={Math.max(r, 14)} fill="transparent" />
                    <circle cx={p.x} cy={p.y} r={k.ring ? r - 1.5 : r} fill={k.ring ? "var(--color-surface)" : k.fill} stroke={k.ring ? k.fill : "none"} strokeWidth={k.ring ? 3 : 0} />
                  </g>
                );
              })}
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
        <span className="pointer-coarse:hidden">Scroll to zoom, drag to move</span>
        <span className="hidden pointer-coarse:inline">Tap a dot for its name and card. Pinch to zoom.</span>
      </p>
    </figure>
  );
}

// ---- the list view --------------------------------------------------------------------------------------------------------

function Dot({ kind }: { kind: Kind }) {
  const k = KIND.get(kind)!;
  return <span aria-hidden="true" className="mt-1.5 size-2.5 flex-none rounded-full" style={k.ring ? { boxShadow: `inset 0 0 0 2px ${k.fill}` } : { background: k.fill }} />;
}

function GraphList({ nodes, onOpen }: { nodes: GraphNode[]; onOpen: (id: string) => void }) {
  const of = (...k: Kind[]) => nodes.filter((n) => k.includes(kindOf(n)));
  const roles = of("role");
  const groups: [string, GraphNode[]][] = [
    ["Projects", of("project")],
    ["Results", of("metric")],
    ["Education and certifications", of("education", "certification")],
  ];
  const skills = of("skill");
  const h3 = "text-[1rem] font-semibold text-ink";
  return (
    <div className="flex flex-col gap-6">
      {roles.length > 0 && (
        <section aria-labelledby="list-roles" className="flex flex-col gap-2.5">
          <h3 id="list-roles" className={h3}>
            Roles
          </h3>
          <ol className="flex flex-col gap-3 border-l-2 border-line">
            {roles.map((n) => (
              <li key={n.id} className="relative pl-[18px]">
                <span aria-hidden="true" className="absolute top-1.5 -left-[7px] size-3 rounded-full border-2 border-bg bg-accent" />
                <button type="button" onClick={() => onOpen(n.id)} className="min-h-6 text-left text-[0.9375rem] font-semibold text-ink hover:underline">
                  {labelOf(n)}
                </button>
                <p className={HINT}>{[dates(n), n.source === "a fact you added" ? "a fact you added" : "from your resume"].filter(Boolean).join(" · ")}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
      {groups.map(([title, list]) =>
        list.length ? (
          <section key={title} className="flex flex-col gap-2.5">
            <h3 className={h3}>{title}</h3>
            <ul className="grid grid-cols-1 gap-2.5 tablet:grid-cols-2">
              {list.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => onOpen(n.id)} className="flex w-full items-start gap-2.5 rounded-[16px] border-[1.5px] border-line bg-surface px-3.5 py-3 text-left hover:bg-tint">
                    <Dot kind={kindOf(n)} />
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">{titleOf(n)}</span>
                      <span className={`block ${HINT}`}>{[n.props.org, dates(n)].filter(Boolean).join(" · ")}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
      {skills.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h3 className={h3}>Skills</h3>
          <ul className="flex flex-wrap gap-1.5">
            {skills.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => onOpen(n.id)} className="flex min-h-[34px] items-center rounded-full bg-tint px-3 text-small text-ink hover:bg-line">
                  {titleOf(n)}
                  {typeof n.props.years === "number" && <span className="text-ink-2">&nbsp;· {n.props.years < 1 ? "<1" : Math.round(n.props.years)} yrs</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {nodes.length === 0 && <p className="rounded-card border-[1.5px] border-dashed border-line px-4 py-6 text-center text-ink-2">Nothing matches.</p>}
    </div>
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

function NodeCard({ node, data, onClose, onOpen, onChanged }: {
  node: GraphNode;
  data: { nodes: GraphNode[]; edges: GraphEdge[] };
  onClose: () => void;
  onOpen: (id: string) => void;
  onChanged: (msg: string | null, closed: boolean) => Promise<void>;
}) {
  const kind = kindOf(node);
  const k = KIND.get(kind)!;
  const skill = kind === "skill";
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const linked = data.edges.filter((e) => e.src === node.id || e.dst === node.id).map((e) => byId.get(e.src === node.id ? e.dst : e.src)).filter((n): n is GraphNode => !!n);
  const skills = linked.filter((n) => kindOf(n) === "skill");
  const uses = linked.filter((n) => kindOf(n) !== "skill");
  const fixed = fixedThisVisit.has(node.id);

  async function remove() {
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
          <span aria-hidden="true" className="size-2.5 rounded-full" style={k.ring ? { boxShadow: `inset 0 0 0 2px ${k.fill}` } : { background: k.fill }} />
          {k.one}
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
              <p className="mb-1 text-ui font-semibold text-ink">Used in</p>
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
          {!skill && (
            <p className={`${HINT} border-l-[3px] border-line pl-2.5`}>
              {node.source === "a fact you added" ? "A fact you added." : node.sourceQuote ? `From your resume: “${node.sourceQuote}”` : "From your resume."}
              {fixed && " You fixed this card."}
            </p>
          )}
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
          What you did
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

// ---- adding -----------------------------------------------------------------------------------------------------------------

function FactComposer({ onCancel, onDone }: { onCancel: () => void; onDone: (msg: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => box.current?.focus(), []);
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
  return (
    <form noValidate onSubmit={(e) => (e.preventDefault(), void add())} className={CARD}>
      <div>
        <label htmlFor="fact-box" className="text-ui font-semibold text-ink">
          Add a fact
        </label>
        <p id="fact-hint" className={`${HINT} mt-1`}>
          Something your resume leaves out: a project, a result with a number, a tool you use.
        </p>
      </div>
      <textarea
        ref={box}
        id="fact-box"
        rows={3}
        maxLength={2000}
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "fact-hint fact-error" : "fact-hint"}
        onChange={(e) => (setText(e.target.value), setError(null))}
        className="w-full rounded-input border-[1.5px] border-line-strong bg-surface px-3.5 py-2.5 text-body leading-[1.45] text-ink aria-invalid:border-danger"
      />
      {error && (
        <p id="fact-error" role="alert" className="-mt-1.5 text-small text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" aria-disabled={busy || undefined} className={buttonClass("primary", "min-h-11")}>
          Add it
        </button>
        <button type="button" onClick={onCancel} className={TEXT_BUTTON}>
          Cancel
        </button>
        {busy && (
          <p role="status" className={HINT}>
            Nori is reading it…
          </p>
        )}
      </div>
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
    <div className={CARD}>
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
            Cancel
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
