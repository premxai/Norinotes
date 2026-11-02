"use client";

import {
  forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type Simulation, type SimulationLinkDatum, type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { useRouter } from "next/navigation";
import { FileUp, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { NODE_GROUPS } from "@/lib/format";
import type { Graph, GraphNode } from "@/lib/types";
import { Button, Field, Frame, Icon, IndexLabel, Notice, cx, inputClass } from "./ui";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------- type styling

type NodeLook = { fill: string | null; stroke: string | null; lw: number };
type Palette = Record<"ink" | "ink2" | "paper" | "stone" | "stone2" | "line" | "lineStrong" | "muted" | "faint" | "accent", string>;

/**
 * Kinds of fact told apart by tone and by filled versus outlined, never by a rainbow: colour keeps its meaning
 * elsewhere in Norinote. Roles and companies are ink, skills and tools blue, everything else neutral.
 */
function look(type: string, c: Palette): NodeLook {
  switch (type) {
    case "role": return { fill: c.ink, stroke: null, lw: 0 };
    case "company": return { fill: c.paper, stroke: c.ink, lw: 1.75 };
    case "skill": return { fill: c.accent, stroke: null, lw: 0 };
    case "tool": return { fill: c.paper, stroke: c.accent, lw: 1.75 };
    case "metric": return { fill: c.ink2, stroke: null, lw: 0 };
    case "project": return { fill: c.muted, stroke: null, lw: 0 };
    case "education": return { fill: c.paper, stroke: c.muted, lw: 1.75 };
    case "certification": return { fill: c.paper, stroke: c.ink2, lw: 1.75 };
    default: return { fill: c.lineStrong, stroke: null, lw: 0 };
  }
}

/** Same looks as CSS, for the DOM legend and panel swatches. */
function swatchStyle(type: string): React.CSSProperties {
  const v = (n: string) => `var(--${n})`;
  const l = look(type, { ink: v("ink"), ink2: v("ink-2"), paper: v("surface"), stone: v("sunken"), stone2: v("line"), line: v("line"), lineStrong: v("control"), muted: v("muted"), faint: v("muted"), accent: v("accent") });
  return { background: l.fill ?? "transparent", boxShadow: l.stroke ? `inset 0 0 0 ${l.lw >= 1.5 ? 1.5 : 1}px ${l.stroke}` : undefined };
}

function Swatch({ type, size = 10, dim }: { type: string; size?: number; dim?: boolean }) {
  return <span aria-hidden="true" className={cx("inline-block shrink-0 rounded-full transition-opacity duration-150", dim && "opacity-30")} style={{ width: size, height: size, ...swatchStyle(type) }} />;
}

const groupLabel = (type: string) => NODE_GROUPS.find((g) => g.type === type)?.label ?? type.charAt(0).toUpperCase() + type.slice(1) + "s";
const typeName = (type: string) => type.replace(/_/g, " ");

const EDGE_PHRASE: Record<string, [out: string, inn: string]> = {
  used: ["Uses", "Used in"],
  worked_at: ["Worked at", "Roles here"],
  achieved: ["Achieved", "Achieved in"],
  studied_at: ["Studied at", "Alumni"],
  part_of: ["Part of", "Includes"],
  evidenced_by: ["Evidenced by", "Evidence for"],
};
const edgePhrase = (type: string, dir: "out" | "in") => {
  const p = EDGE_PHRASE[type];
  if (p) return dir === "out" ? p[0] : p[1];
  const h = type.replace(/_/g, " ");
  return dir === "out" ? h.charAt(0).toUpperCase() + h.slice(1) : `${h.charAt(0).toUpperCase() + h.slice(1)} (from)`;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(d: string) {
  const m = /^(\d{4})-(\d{2})/.exec(d);
  return m ? `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : d;
}
function dateRange(n: GraphNode): string | null {
  if (n.startDate) return `${fmtDate(n.startDate)} – ${n.endDate ? fmtDate(n.endDate) : "present"}`;
  if (n.endDate) return `Until ${fmtDate(n.endDate)}`;
  return null;
}

const HIDDEN_PROPS = new Set(["statement", "metrics", "skills", "order", "hasNumber"]);
const humanKey = (k: string) => {
  const s = k.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
function propEntries(n: GraphNode): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(n.props ?? {})) {
    if (HIDDEN_PROPS.has(k) || v === null || v === undefined || v === "") continue;
    if (Array.isArray(v)) { if (v.length) out.push([humanKey(k), v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ")]); continue; }
    if (typeof v === "boolean") { out.push([humanKey(k), v ? "Yes" : "No"]); continue; }
    if (typeof v === "object") { out.push([humanKey(k), JSON.stringify(v)]); continue; }
    out.push([humanKey(k), String(v)]);
  }
  return out;
}

// ---------------------------------------------------------------- graph index

type Neighbor = { node: GraphNode; edgeType: string; dir: "out" | "in" };

function useIndex(graph: Graph) {
  return useMemo(() => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const adj = new Map<string, Neighbor[]>();
    for (const n of graph.nodes) adj.set(n.id, []);
    for (const e of graph.edges) {
      const s = byId.get(e.src);
      const d = byId.get(e.dst);
      if (!s || !d) continue;
      adj.get(s.id)!.push({ node: d, edgeType: e.type, dir: "out" });
      adj.get(d.id)!.push({ node: s, edgeType: e.type, dir: "in" });
    }
    const types = new Map<string, number>();
    for (const n of graph.nodes) types.set(n.type, (types.get(n.type) ?? 0) + 1);
    const order = (t: string) => { const i = NODE_GROUPS.findIndex((g) => g.type === t); return i === -1 ? 99 : i; };
    const typeList = [...types].sort((a, b) => order(a[0]) - order(b[0]));
    return { byId, adj, typeList };
  }, [graph]);
}

// ---------------------------------------------------------------- canvas graph

type SimNode = SimulationNodeDatum & { id: string; node: GraphNode; r: number; deg: number };
type SimLink = SimulationLinkDatum<SimNode> & { id: string; type: string };
type GraphApi = { draw: () => void; fit: (animate?: boolean) => void; focus: (id: string) => void; reset: () => void };

const ALWAYS_LABEL = new Set(["role", "company"]);
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function GraphView({ graph, focus }: { graph: Graph; focus?: string }) {
  const { byId, adj, typeList } = useIndex(graph);
  const [selected, setSelected] = useState<string | null>(focus && byId.has(focus) ? focus : null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [zoomPct, setZoomPct] = useState(100);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const apiRef = useRef<GraphApi | null>(null);
  const selectedRef = useRef<string | null>(selected);
  const hiddenRef = useRef<Set<string>>(hidden);
  const initialFocus = useRef(focus && byId.has(focus) ? focus : null);

  useEffect(() => {
    selectedRef.current = selected;
    apiRef.current?.draw();
  }, [selected]);
  useEffect(() => {
    hiddenRef.current = hidden;
    apiRef.current?.draw();
  }, [hidden]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || graph.nodes.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // palette + font from the design tokens
    const cs = getComputedStyle(document.documentElement);
    const tok = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
    const C: Palette = {
      ink: tok("--ink", "#2b2722"), ink2: tok("--ink-2", "#4a443c"), paper: tok("--surface", "#fffefc"), stone: tok("--sunken", "#f3f1ed"),
      stone2: tok("--line", "#e9e5df"), line: tok("--line", "#e9e5df"), lineStrong: tok("--control", "#8e877d"),
      muted: tok("--muted", "#6b645b"), faint: tok("--muted", "#6b645b"), accent: tok("--accent", "#2f5a8a"),
    };
    const font = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";

    // nodes sized by degree, 4..14px
    const deg = new Map<string, number>();
    const valid = graph.edges.filter((e) => byId.has(e.src) && byId.has(e.dst) && e.src !== e.dst);
    for (const e of valid) { deg.set(e.src, (deg.get(e.src) ?? 0) + 1); deg.set(e.dst, (deg.get(e.dst) ?? 0) + 1); }
    const degs = graph.nodes.map((n) => deg.get(n.id) ?? 0);
    const dMin = Math.min(...degs);
    const dMax = Math.max(...degs);
    const nodes: SimNode[] = graph.nodes.map((n) => {
      const d = deg.get(n.id) ?? 0;
      const t = dMax === dMin ? 0.35 : (d - dMin) / (dMax - dMin);
      return { id: n.id, node: n, deg: d, r: 4 + Math.sqrt(t) * 10 };
    });
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = valid.map((e) => ({ id: e.id, type: e.type, source: e.src, target: e.dst }));
    const nbrs = new Map<string, Set<string>>();
    for (const n of nodes) nbrs.set(n.id, new Set());
    for (const e of valid) { nbrs.get(e.src)!.add(e.dst); nbrs.get(e.dst)!.add(e.src); }

    const charge = -120 - Math.min(160, nodes.length * 3);
    const sim: Simulation<SimNode, SimLink> = forceSimulation(nodes)
      .force("link", forceLink<SimNode, SimLink>(links).id((d) => d.id).distance((l) => {
        const s = l.source as SimNode, t = l.target as SimNode;
        return 28 + s.r + t.r + (l.type === "worked_at" ? 18 : 0);
      }).strength(0.7))
      .force("charge", forceManyBody<SimNode>().strength(charge).distanceMax(420))
      .force("center", forceCenter(0, 0))
      .force("x", forceX<SimNode>(0).strength((d) => (d.deg === 0 ? 0.18 : 0.06)))
      .force("y", forceY<SimNode>(0).strength((d) => (d.deg === 0 ? 0.22 : 0.08)))
      .force("collide", forceCollide<SimNode>().radius((d) => d.r + 7).iterations(2))
      .stop();

    let W = 0, H = 0;
    let transform: ZoomTransform = zoomIdentity;
    let hover: string | null = null;
    let raf = 0;
    let anim = 0;

    const draw = () => {
      raf = 0;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = C.paper;
      ctx.fillRect(0, 0, W, H);
      const { x: tx, y: ty, k } = transform;

      // quiet dot grid, world-anchored so it pans with the graph
      const step = 32 * k;
      if (step >= 14) {
        ctx.fillStyle = C.line;
        const ox = ((tx % step) + step) % step, oy = ((ty % step) + step) % step;
        for (let x = ox; x < W; x += step) for (let y = oy; y < H; y += step) ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
      }

      const hid = hiddenRef.current;
      const sel = selectedRef.current;
      const visible = (n: SimNode) => !hid.has(n.node.type);
      const focusId = hover ?? null;
      const lit = focusId ? new Set([focusId, ...(nbrs.get(focusId) ?? [])]) : null;
      const selNbrs = sel ? nbrs.get(sel) : undefined;

      ctx.save();
      ctx.translate(tx, ty);
      ctx.scale(k, k);

      // edges: hairline at half opacity; the hovered node's edges darken
      for (const l of links) {
        const s = l.source as SimNode, t = l.target as SimNode;
        if (!visible(s) || !visible(t)) continue;
        const on = !!focusId && (s.id === focusId || t.id === focusId);
        const onSel = !focusId && !!sel && (s.id === sel || t.id === sel);
        ctx.globalAlpha = lit ? (on ? 0.85 : 0.08) : onSel ? 0.75 : 0.5;
        ctx.strokeStyle = on || onSel ? C.ink : C.lineStrong;
        ctx.lineWidth = (on || onSel ? 1.1 : 1) / k;
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(t.x!, t.y!);
        ctx.stroke();
      }

      // nodes
      for (const n of nodes) {
        if (!visible(n)) continue;
        const L = look(n.node.type, C);
        ctx.globalAlpha = lit && !lit.has(n.id) ? 0.16 : 1;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2);
        if (L.fill) { ctx.fillStyle = L.fill; ctx.fill(); }
        if (L.stroke) { ctx.strokeStyle = L.stroke; ctx.lineWidth = L.lw; ctx.stroke(); }
        if (n.id === sel || n.id === focusId) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = C.ink;
          ctx.lineWidth = 1 / k;
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, n.r + 4 / k + 1, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();

      // labels in screen space so they stay 11px at any zoom
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineJoin = "round";
      for (const n of nodes) {
        if (!visible(n)) continue;
        const isFocus = n.id === focusId || n.id === sel;
        const always = ALWAYS_LABEL.has(n.node.type);
        const show = always || isFocus || k > 1.6 || (lit ? lit.has(n.id) : (selNbrs?.has(n.id) ?? false));
        if (!show) continue;
        const sx = tx + n.x! * k;
        const sy = ty + (n.y! + n.r) * k + 5;
        if (sx < -200 || sx > W + 200 || sy < -20 || sy > H + 20) continue;
        const short = n.node.type === "role" && typeof n.node.props?.title === "string" ? (n.node.props.title as string) : n.node.label;
        const text = isFocus ? truncate(n.node.label, 44) : truncate(short, always ? 30 : 22);
        ctx.font = `${always || isFocus ? 500 : 400} ${always ? 11.5 : 11}px ${font}`;
        ctx.globalAlpha = lit && !lit.has(n.id) ? 0.2 : 1;
        ctx.lineWidth = 4;
        ctx.strokeStyle = C.paper;
        ctx.strokeText(text, sx, sy);
        ctx.fillStyle = always || isFocus ? C.ink : C.ink2;
        ctx.fillText(text, sx, sy);
      }
      ctx.globalAlpha = 1;
    };
    const requestDraw = () => { if (!raf) raf = requestAnimationFrame(draw); };

    // ---- zoom / pan
    const point = (ev: { clientX: number; clientY: number }): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [ev.clientX - r.left, ev.clientY - r.top];
    };
    const hit = (sx: number, sy: number): SimNode | null => {
      const [wx, wy] = transform.invert([sx, sy]);
      let best: SimNode | null = null;
      let bestD = Infinity;
      for (const n of nodes) {
        if (hiddenRef.current.has(n.node.type)) continue;
        const d = Math.hypot(n.x! - wx, n.y! - wy);
        if (d <= n.r + 4 / transform.k && d < bestD) { best = n; bestD = d; }
      }
      return best;
    };

    const zoomer: ZoomBehavior<HTMLCanvasElement, unknown> = d3zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.2, 5])
      .filter((ev: Event) => {
        const e = ev as MouseEvent & TouchEvent;
        if (e.type === "wheel") return true;
        if (e.ctrlKey || (e as MouseEvent).button) return false;
        const p = "touches" in e && e.touches?.length ? e.touches[0] : (e as MouseEvent);
        if (e.type === "touchstart" && e.touches.length > 1) return true;
        const [sx, sy] = point(p);
        return !hit(sx, sy);
      })
      .on("zoom", (ev: { transform: ZoomTransform }) => {
        transform = ev.transform;
        setZoomPct(Math.round(transform.k * 100));
        requestDraw();
      });
    const sel$ = select(canvas);
    sel$.call(zoomer);

    const setTransform = (t: ZoomTransform, animate = true) => {
      cancelAnimationFrame(anim);
      if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { zoomer.transform(sel$, t); return; }
      const from = transform;
      const t0 = performance.now();
      const dur = 420;
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        const k = from.k + (t.k - from.k) * e;
        zoomer.transform(sel$, zoomIdentity.translate(from.x + (t.x - from.x) * e, from.y + (t.y - from.y) * e).scale(k));
        if (p < 1) anim = requestAnimationFrame(tick);
      };
      anim = requestAnimationFrame(tick);
    };

    /** The part of the canvas not covered by the legend overlay or the detail panel. */
    const viewport = () => {
      const wide = W >= 900;
      const left = wide ? 272 : 16;
      const right = W - (wide && selectedRef.current ? 352 : 16);
      return { left, right, top: 16, bottom: H - 16 };
    };

    const fit = (animate = true) => {
      const vis = nodes.filter((n) => !hiddenRef.current.has(n.node.type));
      if (!vis.length || !W) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of vis) {
        const lab = ALWAYS_LABEL.has(n.node.type) ? 64 : 0; // room for the always-on label either side
        x0 = Math.min(x0, n.x! - n.r - lab); y0 = Math.min(y0, n.y! - n.r); x1 = Math.max(x1, n.x! + n.r + lab); y1 = Math.max(y1, n.y! + n.r + 18);
      }
      const vp = viewport();
      const pad = 28;
      const vw = vp.right - vp.left - pad * 2, vh = vp.bottom - vp.top - pad * 2;
      const k = Math.max(0.25, Math.min(1.8, vw / Math.max(1, x1 - x0), vh / Math.max(1, y1 - y0)));
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      setTransform(zoomIdentity.translate((vp.left + vp.right) / 2 - cx * k, (vp.top + vp.bottom) / 2 - cy * k).scale(k), animate);
    };

    const focusNode = (id: string) => {
      const n = nodeById.get(id);
      if (!n) return;
      const k = Math.min(1.5, Math.max(transform.k, 1.3));
      const vp = viewport();
      // the panel opens with the selection, so centre in the area left of it
      const right = W >= 900 ? W - 352 : vp.right;
      setTransform(zoomIdentity.translate((vp.left + right) / 2 - n.x! * k, (vp.top + vp.bottom) / 2 - n.y! * k).scale(k));
    };

    const warm = (ticks: number) => { for (let i = 0; i < ticks; i++) sim.tick(); };
    const reset = () => {
      for (const n of nodes) { n.x = n.y = n.vx = n.vy = NaN; n.fx = n.fy = null; }
      sim.nodes(nodes);
      sim.alpha(1);
      warm(160);
      fit();
      sim.alphaTarget(0).restart();
    };

    // ---- size
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      requestDraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ---- drag, hover, click
    let drag: { n: SimNode | null; x: number; y: number; moved: boolean; id: number } | null = null;
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      const [sx, sy] = point(ev);
      const n = hit(sx, sy);
      drag = { n, x: sx, y: sy, moved: false, id: ev.pointerId };
      if (n) {
        canvas.setPointerCapture(ev.pointerId);
        n.fx = n.x;
        n.fy = n.y;
      }
    };
    const onMove = (ev: PointerEvent) => {
      const [sx, sy] = point(ev);
      if (drag && drag.id === ev.pointerId) {
        if (Math.hypot(sx - drag.x, sy - drag.y) > 3) drag.moved = true;
        if (drag.n && drag.moved) {
          const [wx, wy] = transform.invert([sx, sy]);
          drag.n.fx = wx;
          drag.n.fy = wy;
          if (sim.alpha() < 0.3) sim.alphaTarget(0.25).restart();
          hover = drag.n.id;
          requestDraw();
        }
        return;
      }
      const n = hit(sx, sy);
      const id = n?.id ?? null;
      canvas.style.cursor = n ? "pointer" : "grab";
      if (id !== hover) { hover = id; requestDraw(); }
    };
    const onUp = (ev: PointerEvent) => {
      if (!drag || drag.id !== ev.pointerId) return;
      const d = drag;
      drag = null;
      if (d.n) {
        d.n.fx = null;
        d.n.fy = null;
        sim.alphaTarget(0);
        if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
      }
      if (!d.moved) setSelected(d.n ? (selectedRef.current === d.n.id ? null : d.n.id) : null);
    };
    const onLeave = () => { if (!drag && hover) { hover = null; requestDraw(); } };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);

    sim.on("tick", requestDraw);

    // settle most of the layout before the first paint, then let it breathe
    warm(220);
    const start = initialFocus.current;
    if (start) focusNode(start);
    else fit(false);
    sim.alpha(0.08).restart();

    apiRef.current = { draw: requestDraw, fit, focus: focusNode, reset };

    return () => {
      apiRef.current = null;
      sim.stop();
      sim.on("tick", null);
      ro.disconnect();
      cancelAnimationFrame(raf);
      cancelAnimationFrame(anim);
      sel$.on(".zoom", null);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [graph, byId]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return graph.nodes
      .filter((n) => n.label.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.label.toLowerCase().startsWith(q)) - Number(!b.label.toLowerCase().startsWith(q)) || a.label.length - b.label.length)
      .slice(0, 6);
  }, [graph, query]);

  const choose = (id: string) => {
    const n = byId.get(id);
    if (!n) return;
    if (hidden.has(n.type)) setHidden((h) => { const s = new Set(h); s.delete(n.type); return s; });
    setSelected(id);
    setQuery("");
    apiRef.current?.focus(id);
  };
  const toggleType = (t: string) => setHidden((h) => { const s = new Set(h); if (s.has(t)) s.delete(t); else s.add(t); return s; });

  if (graph.nodes.length === 0) return <GraphEmpty />;

  const sel = selected ? byId.get(selected) ?? null : null;

  return (
    <Frame surface="paper">
      <div className="relative">
        {/* controls: a static strip on phones, a framed overlay top-left on large screens */}
        <div className="relative z-10 border-b border-line bg-surface p-4 lg:absolute lg:left-4 lg:top-4 lg:w-[240px] lg:rounded-card lg:border lg:p-4">
          <div className="relative">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches[0]) { e.preventDefault(); choose(matches[0].id); }
                if (e.key === "Escape") setQuery("");
              }}
              placeholder="Find a node"
              aria-label="Find a node by label"
              className={cx(inputClass, "min-h-9 py-1 text-meta")}
            />
            {matches.length > 0 && (
              <ul className="absolute inset-x-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-control border border-line bg-surface" role="listbox" aria-label="Matching facts">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => choose(m.id)} className="flex w-full items-center gap-2 border-b border-line px-2.5 py-2 text-left text-meta text-ink last:border-b-0 hover:bg-sunken">
                      <Swatch type={m.type} size={8} />
                      <span className="min-w-0 flex-1 truncate">{m.label}</span>
                      <span className="text-[11px] capitalize text-muted">{typeName(m.type)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <ol className="mt-3 grid grid-cols-2 gap-x-4 sm:grid-cols-3 lg:grid-cols-1" aria-label="Node types">
            {typeList.map(([t, c]) => {
              const off = hidden.has(t);
              return (
                <li key={t}>
                  <button
                    type="button"
                    aria-pressed={!off}
                    onClick={() => toggleType(t)}
                    title={off ? `Show ${groupLabel(t).toLowerCase()}` : `Hide ${groupLabel(t).toLowerCase()}`}
                    className="group flex w-full items-center gap-2.5 py-[5px] text-left"
                  >
                    <Swatch type={t} dim={off} />
                    <span className={cx("min-w-0 flex-1 truncate text-meta transition-colors duration-150", off ? "text-muted line-through decoration-control" : "text-ink group-hover:text-ink-2")}>{groupLabel(t)}</span>
                    <span className="text-[12px] text-muted tnum">{c}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
            <button type="button" onClick={() => apiRef.current?.fit()} className="inline-flex h-8 items-center rounded-control border border-control px-3 text-[12px] font-semibold text-ink hover:bg-sunken">Fit</button>
            <button type="button" onClick={() => apiRef.current?.reset()} className="inline-flex h-8 items-center rounded-control border border-control px-3 text-[12px] font-semibold text-ink hover:bg-sunken">Reset layout</button>
            <span className="ml-auto text-[11px] text-muted tnum">{zoomPct}%</span>
          </div>
        </div>

        <div ref={wrapRef} className="relative h-[480px] sm:h-[640px] lg:h-[calc(100vh-140px)] lg:min-h-[640px]">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Career graph: ${plural(graph.nodes.length, "node")}, ${plural(graph.edges.length, "edge")}. Use the search box or legend to explore.`}
            className="absolute inset-0 block touch-none select-none"
            style={{ cursor: "grab" }}
          />
          <p className="pointer-events-none absolute bottom-3 left-4 hidden text-[11px] text-muted sm:block lg:left-[272px]">
            {plural(graph.nodes.length, "node")} &middot; {plural(graph.edges.length, "edge")} &middot; scroll to zoom, drag to pan
          </p>
        </div>

        {sel && (
          <NodePanel
            node={sel}
            nbrs={adj.get(sel.id) ?? []}
            onClose={() => setSelected(null)}
            onPick={(id) => { setSelected(id); apiRef.current?.focus(id); }}
          />
        )}
      </div>
    </Frame>
  );
}

function NodePanel({ node, nbrs, onClose, onPick, inline }: { node: GraphNode; nbrs: Neighbor[]; onClose: () => void; onPick: (id: string) => void; inline?: boolean }) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  // Retract a claim: it stops being evidence for resumes and answers. Not for the person node itself.
  async function remove() {
    if (!window.confirm(`Remove "${node.label}" from your graph? Norinote will stop using it in resumes and answers.`)) return;
    setRemoving(true);
    setRemoveError(null);
    try { await api.deleteGraphNode(node.id); onClose(); router.refresh(); } catch (e) { setRemoveError((e as Error).message); } finally { setRemoving(false); }
  }
  const groups = new Map<string, Neighbor[]>();
  for (const n of nbrs) {
    const key = edgePhrase(n.edgeType, n.dir);
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const props = propEntries(node);
  const dates = dateRange(node);
  const isMetric = node.type === "metric";
  const statement = isMetric ? String(node.props?.statement ?? node.label) : null;
  const evidenced = isMetric && Array.isArray(node.props?.skills) ? (node.props.skills as unknown[]).map(String) : [];
  const backedBy = isMetric ? nbrs.filter((n) => n.edgeType === "achieved" && n.dir === "in").map((n) => n.node) : [];

  return (
    <aside
      aria-label={`${typeName(node.type)}: ${node.label}`}
      className={inline
        ? "rounded-card border border-line bg-surface lg:sticky lg:top-6 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto"
        : "relative z-10 border-t border-line bg-surface lg:absolute lg:bottom-4 lg:right-4 lg:top-4 lg:w-[320px] lg:overflow-y-auto lg:rounded-card lg:border"}
    >
      <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
        <IndexLabel tone="ink"><Swatch type={node.type} size={9} /><span className="capitalize">{typeName(node.type)}</span></IndexLabel>
        <button type="button" onClick={onClose} aria-label="Close fact details" className="inline-flex h-8 w-8 items-center justify-center rounded-control text-ink-2 hover:bg-sunken hover:text-ink">
          <Icon icon={X} />
        </button>
      </div>
      <div className="space-y-5 px-5 py-5">
        <div>
          <h3 className="text-title font-semibold text-ink">{node.label}</h3>
          {(dates || node.source) && (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted">
              {dates && <span className="tnum">{dates}</span>}
              {dates && node.source && <span className="text-control">&middot;</span>}
              {node.source && <span>from {node.source}</span>}
            </p>
          )}
          {node.type !== "person" && (
            <button type="button" onClick={remove} disabled={removing} className="mt-3 inline-flex h-8 items-center rounded-control border border-danger px-3 text-[12px] font-semibold text-danger hover:bg-danger-tint disabled:opacity-40">
              {removing ? "Retracting..." : "Retract this fact"}
            </button>
          )}
          {removeError && <p role="alert" className="mt-1 text-[12px] text-danger-fg">{removeError}</p>}
        </div>

        {isMetric && statement && (
          <div>
            <div className="mb-2 text-meta font-medium text-muted">Resume line it backs</div>
            <p className="rounded-control bg-sunken px-3 py-2 text-body-sm text-ink-2">{statement}</p>
            {(backedBy.length > 0 || evidenced.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {backedBy.map((b) => (
                  <button key={b.id} type="button" onClick={() => onPick(b.id)} className="rounded-full border border-line px-2 py-[2px] text-[12px] text-ink-2 hover:border-control hover:text-ink">
                    {b.label}
                  </button>
                ))}
                {evidenced.map((s) => <span key={s} className="rounded-full bg-sunken px-2 py-[2px] text-[12px] text-ink">{s}</span>)}
              </div>
            )}
          </div>
        )}

        {props.length > 0 && (
          <dl className="border-t border-line text-meta">
            {props.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 border-b border-line py-2">
                <dt className="text-muted">{k}</dt>
                <dd className="break-words text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        )}

        {node.sourceQuote && (
          <div>
            <div className="mb-2 text-meta font-medium text-muted">Source</div>
            <p className="whitespace-pre-wrap break-words rounded-control bg-sunken px-3 py-2.5 text-meta text-ink-2">&ldquo;{node.sourceQuote}&rdquo;</p>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between text-meta font-medium text-muted">
            <span>Linked facts</span>
            <span className="tnum">{nbrs.length}</span>
          </div>
          {nbrs.length === 0 && <p className="py-2 text-meta text-muted">No links yet.</p>}
          {[...groups].map(([label, list]) => (
            <div key={label} className="mt-3 first:mt-0">
              <div className="pb-1 text-[12px] font-medium text-ink-2">{label} <span className="text-muted tnum">· {list.length}</span></div>
              <ol>
                {list.map((n) => (
                  <li key={n.node.id + n.edgeType + n.dir}>
                    <button type="button" onClick={() => onPick(n.node.id)} className="grid w-full grid-cols-[10px_minmax(0,1fr)] items-center gap-2 rounded-control px-1.5 py-1.5 text-left text-meta hover:bg-sunken">
                      <Swatch type={n.node.type} size={8} />
                      <span className="truncate text-ink" title={n.node.label}>{n.node.label}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- list view (the default)

/** Every fact as a row: filter by kind, search, open one to see its source and what it links to, retract it. */
function FactList({ graph, focus }: { graph: Graph; focus?: string }) {
  const { byId, adj, typeList } = useIndex(graph);
  const [type, setType] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(focus && byId.has(focus) ? focus : null);
  const order = (t: string) => { const i = NODE_GROUPS.findIndex((g) => g.type === t); return i === -1 ? 99 : i; };
  const term = q.trim().toLowerCase();
  const rows = graph.nodes
    .filter((n) => n.type !== "person")
    .filter((n) => !type || n.type === type)
    .filter((n) => !term || `${n.label} ${n.sourceQuote ?? ""}`.toLowerCase().includes(term))
    .sort((a, b) => order(a.type) - order(b.type) || String(b.startDate ?? "").localeCompare(String(a.startDate ?? "")) || a.label.localeCompare(b.label));
  const sel = selected ? byId.get(selected) ?? null : null;
  const kinds = typeList.filter(([t]) => t !== "person");

  return (
    <div className={cx("grid grid-cols-1 gap-4", sel && "lg:grid-cols-[minmax(0,1fr)_340px]")}>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 basis-56">
            <span className="sr-only">Search facts</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search facts and their sources" className={inputClass} />
          </label>
        </div>
        <div role="group" aria-label="Kind of fact" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          <button type="button" aria-pressed={type === null} onClick={() => setType(null)} className={cx("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium", type === null ? "border-ink bg-ink text-on-ink" : "border-line bg-surface text-ink-2 hover:border-control")}>
            All <span className="font-normal tnum">{graph.nodes.filter((n) => n.type !== "person").length}</span>
          </button>
          {kinds.map(([t, c]) => (
            <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(type === t ? null : t)} className={cx("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium", type === t ? "border-ink bg-ink text-on-ink" : "border-line bg-surface text-ink-2 hover:border-control")}>
              <Swatch type={t} size={8} /> {groupLabel(t)} <span className="font-normal tnum">{c}</span>
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="rounded-card border border-dashed border-line px-4 py-6 text-body-sm text-muted">No facts match.</p>
        ) : (
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {rows.map((n) => {
              const d = dateRange(n);
              const links = adj.get(n.id)?.length ?? 0;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(n.id)}
                    aria-pressed={selected === n.id}
                    className={cx("flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-sunken/50", selected === n.id && "bg-sunken")}
                  >
                    <span className="mt-1.5"><Swatch type={n.type} size={9} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-body-sm font-medium text-ink">{n.label}</span>
                      <span className="mt-0.5 block truncate text-meta text-muted">
                        <span className="capitalize">{typeName(n.type)}</span>{d ? ` · ${d}` : ""}{links ? ` · ${links} link${links === 1 ? "" : "s"}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {sel && <NodePanel inline node={sel} nbrs={adj.get(sel.id) ?? []} onClose={() => setSelected(null)} onPick={(id) => setSelected(id)} />}
    </div>
  );
}

/** The career graph page body: a list by default, a map to explore. */
export function CareerGraph({ graph, focus }: { graph: Graph; focus?: string }) {
  const [view, setView] = useState<"list" | "map">("list");
  if (graph.nodes.length === 0) return <GraphEmpty />;
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="View" className="inline-flex w-fit gap-1 rounded-control bg-sunken p-1">
        {(["list", "map"] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cx("h-8 rounded-[6px] px-4 text-[13px] font-medium", view === v ? "bg-surface text-ink shadow-[0_1px_2px_rgba(43,39,34,0.12)]" : "text-ink-2 hover:text-ink")}>
            {v === "list" ? "List" : "Map"}
          </button>
        ))}
      </div>
      {view === "list" ? <FactList graph={graph} focus={focus} /> : <GraphView graph={graph} focus={focus} />}
    </div>
  );
}

function GraphEmpty() {
  const steps = [
    ["Paste your resume", "Drop the plain text below. Roles, companies, skills and metrics become nodes, each with the line it came from.", "#teach"],
    ["Add facts", "Tell the agent what the resume leaves out: side projects, numbers, tools. One sentence is enough.", "#teach"],
    ["Review", "Come back here to check every node and its source. Tailored resumes only use what this graph can back.", null],
  ] as const;
  return (
    <Frame surface="none" className="flex flex-col gap-5 px-6 py-8">
      <div>
        <p className="text-title font-semibold text-ink">Your career graph is empty</p>
        <p className="mt-1 max-w-prose text-body-sm text-muted">Norinote writes resumes and answers only from facts here, so start by giving it some.</p>
      </div>
      <ol className="grid gap-3 md:grid-cols-3">
        {steps.map(([t, d, href]) => (
          <li key={t} className="rounded-card bg-sunken p-4">
            <p className="text-body-sm font-semibold text-ink">{t}</p>
            <p className="mt-1 text-meta text-muted">{d}</p>
            {href && <a href={href} className="mt-2 inline-flex text-meta font-medium text-accent underline-offset-4 hover:underline">Start here</a>}
          </li>
        ))}
      </ol>
    </Frame>
  );
}

/** "Tell the agent a fact" (POST /api/graph/facts) and resume paste (POST /api/profile/resume). */
export function GraphInputs() {
  const router = useRouter();
  const [fact, setFact] = useState("");
  const [resumeText, setResumeText] = useState("");
  // A corrected resume should replace what the old one said, or the old numbers stay as evidence. Chat facts are kept.
  const [replaceOld, setReplaceOld] = useState(true);
  const [busy, setBusy] = useState<"fact" | "resume" | null>(null);
  const [note, setNote] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  async function sendFact(e: React.FormEvent) {
    e.preventDefault();
    if (!fact.trim()) return;
    setBusy("fact");
    setNote(null);
    try {
      const { nodesCreated } = await api.addFact(fact.trim());
      setNote({ tone: "green", text: `Added ${plural(nodesCreated, "node")} to your graph.` });
      setFact("");
      router.refresh();
    } catch (err) {
      setNote({ tone: "red", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function sendResume(e: React.FormEvent) {
    e.preventDefault();
    if (!resumeText.trim()) return;
    setBusy("resume");
    setNote(null);
    try {
      const r = await api.uploadResume(resumeText.trim(), replaceOld);
      setNote({ tone: "green", text: `Ingested resume: ${plural(r.nodesCreated, "node")}, ${plural(r.edgesCreated, "edge")}${r.usedLLM ? "" : " (heuristic parser, no LLM configured)"}.` });
      setResumeText("");
      router.refresh();
    } catch (err) {
      setNote({ tone: "red", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div id="teach" className="flex scroll-mt-20 flex-col gap-3">
      <form onSubmit={sendFact} className="flex flex-col gap-2 sm:flex-row">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Add a fact</span>
          <input
            className={inputClass}
            value={fact}
            onChange={(e) => setFact(e.target.value)}
            placeholder="Tell Norinote something true, e.g. At Lumen I cut CI time by almost half"
          />
        </label>
        <Button type="submit" variant="primary" icon={Plus} disabled={busy !== null || !fact.trim()}>{busy === "fact" ? "Adding..." : "Add fact"}</Button>
      </form>
      <details className="group">
        <summary className="inline-flex cursor-pointer items-center gap-1 text-meta font-medium text-accent underline-offset-4 hover:underline">
          <Icon icon={FileUp} size={14} /> Or paste a whole resume
        </summary>
        <form onSubmit={sendResume} className="mt-3 flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
          <Field label="Resume text" hint="Plain text. Pasting the same resume again never duplicates facts.">
            <textarea className={cx(inputClass, "resize-y text-meta")} rows={6} value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder="Paste the full text of your resume" />
          </Field>
          <label className="flex items-start gap-2 text-meta text-ink">
            <input type="checkbox" className="mt-0.5" checked={replaceOld} onChange={(e) => setReplaceOld(e.target.checked)} />
            <span>Replace what my earlier resume said. Facts you added yourself stay. Untick to merge two resumes.</span>
          </label>
          <div><Button type="submit" variant="secondary" icon={FileUp} disabled={busy !== null || !resumeText.trim()}>{busy === "resume" ? "Reading..." : "Read resume"}</Button></div>
        </form>
      </details>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
    </div>
  );
}
