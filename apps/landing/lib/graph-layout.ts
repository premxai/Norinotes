/*
 * The career graph's layout (4c spec section 3.2): a small force simulation, run to rest before the graph is drawn, and
 * the label placement that keeps labels from overlapping. Written here rather than pulled from d3-force: the graph is
 * tens of dots, and this is all of the simulation it needs.
 */

export type Point = { x: number; y: number };
export type SimNode = { id: string; r: number };
export type SimEdge = { src: string; dst: string };

/** A stable number in [0, 1) from an id, so the same graph starts, and so settles, the same way on every visit. */
function hash(id: string, salt: number) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

type Opts = {
  width: number;
  height: number;
  /** Where dots already were: they start there. New dots start beside their placed neighbours. */
  from?: Map<string, Point>;
  ticks?: number;
  /** Held still (a dot being dragged). */
  pinned?: Map<string, Point>;
};

const PAD = 28;
/** Above this many dots the simulation cools faster (120 ticks), which keeps 250 dots near 150 ms on a slow phone. */
const BIG = 120;

export function layout(nodes: SimNode[], edges: SimEdge[], { width, height, from, ticks = 300, pinned }: Opts): Map<string, Point> {
  const n = nodes.length;
  const index = new Map(nodes.map((d, i) => [d.id, i]));
  const links = edges.flatMap((e) => {
    const a = index.get(e.src);
    const b = index.get(e.dst);
    return a === undefined || b === undefined ? [] : [[a, b] as const];
  });
  const cx = width / 2;
  const cy = height / 2;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);

  const neighbours = Array.from({ length: n }, () => [] as number[]);
  for (const [a, b] of links) {
    neighbours[a]!.push(b);
    neighbours[b]!.push(a);
  }
  const placed = new Array<boolean>(n).fill(false);
  nodes.forEach((d, i) => {
    const p = pinned?.get(d.id) ?? from?.get(d.id);
    if (p) {
      x[i] = p.x;
      y[i] = p.y;
      placed[i] = true;
    }
  });
  nodes.forEach((d, i) => {
    if (placed[i]) return;
    const near = neighbours[i]!.filter((j) => placed[j]);
    if (near.length) {
      x[i] = near.reduce((s, j) => s + x[j]!, 0) / near.length + (hash(d.id, 1) - 0.5) * 40;
      y[i] = near.reduce((s, j) => s + y[j]!, 0) / near.length + (hash(d.id, 2) - 0.5) * 40;
    } else {
      // A spiral seeded by the id, shaped like the box.
      const a = hash(d.id, 3) * Math.PI * 2;
      const r = 0.15 + 0.3 * Math.sqrt(hash(d.id, 4));
      x[i] = cx + Math.cos(a) * r * width;
      y[i] = cy + Math.sin(a) * r * height;
    }
  });

  const pin = nodes.map((d) => pinned?.get(d.id) ?? null);
  const fresh = !from || from.size === 0;
  const repel = 900 + 9000 / Math.max(n, 10);
  const gx = 0.012 * Math.min(1.6, height / width * 1.4);
  const gy = 0.012 * Math.min(1.6, width / height * 0.8);
  function pair(i: number, j: number, alpha: number) {
    let dx = x[i]! - x[j]!;
    let dy = y[i]! - y[j]!;
    let d2 = dx * dx + dy * dy;
    if (d2 < 0.01) {
      dx = hash(nodes[i]!.id, 5) - 0.5;
      dy = hash(nodes[j]!.id, 6) - 0.5;
      d2 = dx * dx + dy * dy + 0.01;
    }
    const d = Math.sqrt(d2);
    const f = Math.min(repel / d2, 14) * alpha;
    // Collision: dots never sit closer than their radii plus 6.
    const min = nodes[i]!.r + nodes[j]!.r + 6;
    const push = d < min ? (min - d) * 0.5 : 0;
    const k = (f + push) / d;
    vx[i]! += dx * k;
    vy[i]! += dy * k;
    vx[j]! -= dx * k;
    vy[j]! -= dy * k;
  }
  const steps = n > BIG ? Math.min(ticks, 120) : ticks;
  for (let t = 0; t < steps; t++) {
    const alpha = (fresh ? 1 : 0.35) * (1 - t / steps);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pair(i, j, alpha);
    for (const [a, b] of links) {
      const dx = x[b]! - x[a]!;
      const dy = y[b]! - y[a]!;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const f = ((d - 64) * 0.04 * alpha) / d;
      vx[a]! += dx * f;
      vy[a]! += dy * f;
      vx[b]! -= dx * f;
      vy[b]! -= dy * f;
    }
    for (let i = 0; i < n; i++) {
      const p = pin[i];
      if (p) {
        x[i] = p.x;
        y[i] = p.y;
        vx[i] = vy[i] = 0;
        continue;
      }
      vx[i]! += (cx - x[i]!) * gx * alpha;
      vy[i]! += (cy - y[i]!) * gy * alpha;
      x[i]! += vx[i]!;
      y[i]! += vy[i]!;
      vx[i]! *= 0.6;
      vy[i]! *= 0.6;
    }
  }

  // Fit to the box when laid out from nothing; otherwise only keep every dot inside it.
  const out = new Map<string, Point>();
  if (fresh && n > 1) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      x0 = Math.min(x0, x[i]!); x1 = Math.max(x1, x[i]!); y0 = Math.min(y0, y[i]!); y1 = Math.max(y1, y[i]!);
    }
    // Room for labels at the sides on wide boxes, and for the zoom buttons on the right.
    const padX = width > 600 ? 96 : PAD;
    const s = Math.min((width - 2 * padX - 40) / (x1 - x0 || 1), (height - 2 * PAD - 16) / (y1 - y0 || 1), 2.4);
    const ox = (width - 40 - (x1 - x0) * s) / 2;
    const oy = (height - 16 - (y1 - y0) * s) / 2;
    nodes.forEach((d, i) => out.set(d.id, { x: Math.round(ox + (x[i]! - x0) * s), y: Math.round(oy + (y[i]! - y0) * s) }));
  } else {
    nodes.forEach((d, i) => out.set(d.id, { x: Math.round(Math.min(width - PAD, Math.max(PAD, x[i]!))), y: Math.round(Math.min(height - PAD, Math.max(PAD, y[i]!))) }));
  }
  return out;
}

export type LabelIn = { id: string; text: string; x: number; y: number; r: number; size: 11 | 12 };
export type LabelOut = LabelIn & { lx: number; ly: number };

/**
 * Places labels under their dots in the given order (most important first), clamped inside the box, skipping any that
 * would overlap one already placed. Widths are estimated from the font size (Geist runs about 0.56 em a character).
 */
export function placeLabels(labels: LabelIn[], width: number): LabelOut[] {
  const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const out: LabelOut[] = [];
  for (const l of labels) {
    const w = l.text.length * l.size * 0.56 + 6;
    const cxl = Math.max(w / 2 + 4, Math.min(width - w / 2 - 4, l.x));
    const top = l.y + l.r + 3;
    const box = { x0: cxl - w / 2, x1: cxl + w / 2, y0: top, y1: top + l.size + 4 };
    if (boxes.some((b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) continue;
    boxes.push(box);
    out.push({ ...l, lx: cxl, ly: top + l.size });
  }
  return out;
}
