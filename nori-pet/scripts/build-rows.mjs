// Turns each generated sheet in work/raw into a clean animation strip in assets/rows/<id>.webp and writes
// assets/nori.json (frames, timings, loop, anchors). Steps per row:
//   1. alpha clean-up: the model leaves a faint glow around the character; low alpha is cut, the edge kept soft
//   2. slice the sheet into poses along empty bands (falls back to the even grid it was asked for)
//   3. one scale per row, measured on the seaweed band (the steadiest body feature across poses), so Nori never
//      changes size between frames or rows
//   4. place every pose on a CELL x CELL frame: feet on the ground line, centre of mass in the middle
//   5. anchors per frame: `top` (where a bubble points) and `note` (the white card, where note text goes)
// Mirrored rows (walk-left, point-right, present-left) are flipped copies; reversed rows (uncover) play a row backwards. A grey contact sheet per row goes to work/contact for review.
//
//   node scripts/build-rows.mjs           # every row that has a take
//   node scripts/build-rows.mjs idle wave # just these
// work/picks.json may name the take to use per row ({ "wave": "wave-2.png" }); otherwise the newest take wins.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { ROWS } from "../art/catalog.mjs";
import { grid } from "./grid.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "work", "raw");
const OUT = join(ROOT, "assets", "rows");
const CONTACT = join(ROOT, "work", "contact");
const MANIFEST = join(ROOT, "assets", "nori.json");
const CELL = 256;
const GROUND = CELL - 8;
const TARGET_BAND = 60; // seaweed band height in px at CELL 256 (body about 185 px tall)
const MAX_FILL = CELL - 10;

mkdirSync(OUT, { recursive: true });
mkdirSync(CONTACT, { recursive: true });

const picks = existsSync(join(ROOT, "work", "picks.json")) ? JSON.parse(readFileSync(join(ROOT, "work", "picks.json"), "utf8")) : {};

function takeFor(id) {
  if (picks[id]) return picks[id];
  const takes = readdirSync(RAW).filter((f) => f.startsWith(`${id}-`) && /^\D+-\d+\.png$/.test(f.replace(`${id}-`, "x-")));
  takes.sort((a, b) => Number(b.match(/-(\d+)\.png$/)[1]) - Number(a.match(/-(\d+)\.png$/)[1]));
  return takes[0];
}

/** Low alpha (the glow) goes to 0, solid stays 255, the edge in between is stretched so it stays soft. */
function cleanAlpha(data) {
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    data[i] = a < 90 ? 0 : a > 210 ? 255 : Math.round(((a - 90) / 120) * 255);
  }
}

/** Runs of indexes whose count is above `min`, joining runs separated by less than `gap`. */
function runs(counts, min, gap) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= counts.length; i++) {
    const on = i < counts.length && counts[i] > min;
    if (on && start < 0) start = i;
    if (!on && start >= 0) { out.push([start, i]); start = -1; }
  }
  const merged = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] < gap) last[1] = r[1];
    else merged.push([...r]);
  }
  return merged;
}

/** Keep the `n` widest runs (stray specks make extra short runs), in order. */
const widest = (list, n) => list.map((r, i) => ({ r, i, w: r[1] - r[0] })).sort((a, b) => b.w - a.w).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.r);

function slice(data, width, height, n) {
  const { cols, rows } = grid(n);
  const rowCounts = new Array(height).fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]) rowCounts[y]++;
  let bands = runs(rowCounts, 2, 12).filter((b) => b[1] - b[0] > 40);
  bands = bands.length >= rows ? widest(bands, rows) : Array.from({ length: rows }, (_, i) => [Math.round((i * height) / rows), Math.round(((i + 1) * height) / rows)]);
  const boxes = [];
  for (const [b, [y0, y1]] of bands.entries()) {
    // The last grid row holds what is left (5 poses in a 3 x 2 grid leave 2), and the model often centres those.
    const want = b < rows - 1 ? cols : n - cols * (rows - 1);
    const colCounts = new Array(width).fill(0);
    for (let y = y0; y < y1; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]) colCounts[x]++;
    let cs = runs(colCounts, 2, 12).filter((c) => c[1] - c[0] > 30);
    cs = cs.length >= want ? widest(cs, want) : Array.from({ length: cols }, (_, i) => [Math.round((i * width) / cols), Math.round(((i + 1) * width) / cols)]).slice(0, want);
    for (const [x0, x1] of cs) boxes.push(tight(data, width, x0, y0, x1, y1));
  }
  return boxes.slice(0, n);
}

/** Tight box of opaque pixels inside a region, plus its centre of mass. */
function tight(data, width, x0, y0, x1, y1) {
  let minX = x1, minY = y1, maxX = x0, maxY = y0, sx = 0, sw = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const a = data[(y * width + x) * 4 + 3];
    if (!a) continue;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    sx += x * a; sw += a;
  }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1, cx: sw ? sx / sw : (x0 + x1) / 2 };
}

const isSeaweed = (r, g, b) => r < 110 && g < 115 && b < 90 && g >= r - 6 && g > b + 4 && r + g + b > 60;
const isNoteWhite = (r, g, b) => r > 236 && g > 236 && b > 232;

/** Rows of the box where the seaweed band spans at least a quarter of the pose's width. */
function bandHeight(data, width, box) {
  let h = 0;
  for (let y = box.top; y < box.top + box.height; y++) {
    let c = 0;
    for (let x = box.left; x < box.left + box.width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] === 255 && isSeaweed(data[i], data[i + 1], data[i + 2])) c++;
    }
    if (c >= box.width * 0.25) h++;
  }
  return h;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

async function anchors(png) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let top = CELL, topX = CELL / 2, nx = 0, ny = 0, nc = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4;
    if (data[i + 3] < 200) continue;
    if (y < top) { top = y; topX = x; }
    if (isNoteWhite(data[i], data[i + 1], data[i + 2])) { nx += x; ny += y; nc++; }
  }
  return { top: [Math.round(topX), top], note: nc > 60 ? [Math.round(nx / nc), Math.round(ny / nc)] : null };
}

async function buildRow(row) {
  const file = takeFor(row.id);
  if (!file) return null;
  const { data, info } = await sharp(join(RAW, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  cleanAlpha(data);
  const n = row.poses.length;
  const boxes = slice(data, info.width, info.height, n);
  const bands = boxes.map((b) => bandHeight(data, info.width, b)).filter((h) => h > 8);
  // Rows whose height changes on purpose (squash, arms up, sleeping) are sized by the seaweed band; the rest by
  // their median height against idle's, which holds when a card or a tilt hides part of the band.
  let scale = row.fit === "band" || !targetHeight ? TARGET_BAND / (median(bands) || 1) : targetHeight / median(boxes.map((b) => b.height));
  if (row.id === "idle") targetHeight = median(boxes.map((b) => b.height)) * scale;
  const biggest = Math.max(...boxes.map((b) => Math.max(b.width, b.height)));
  if (biggest * scale > MAX_FILL) scale = MAX_FILL / biggest;

  const raw = { raw: { width: info.width, height: info.height, channels: 4 } };
  const cells = [];
  for (const b of boxes) {
    const w = Math.max(1, Math.round(b.width * scale)), h = Math.max(1, Math.round(b.height * scale));
    const pose = await sharp(data, raw).extract({ left: b.left, top: b.top, width: b.width, height: b.height }).resize(w, h, { kernel: "lanczos3" }).png().toBuffer();
    const left = Math.min(CELL - w, Math.max(0, Math.round(CELL / 2 - (b.cx - b.left) * scale)));
    const top = Math.max(0, GROUND - h);
    cells.push(await sharp({ create: { width: CELL, height: CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: pose, left, top }]).png().toBuffer());
  }
  const meta = await writeStrip(row.id, cells, row);
  const out = { [row.id]: meta };
  if (row.mirror) {
    const flipped = await Promise.all(cells.map((c) => sharp(c).flop().png().toBuffer()));
    out[row.mirror] = await writeStrip(row.mirror, flipped, row);
  }
  if (row.reverse) {
    const label = { uncover: "Uncover eyes" }[row.reverse] ?? `${row.label} (reversed)`;
    out[row.reverse] = await writeStrip(row.reverse, [...cells].reverse(), { ...row, label, plays: `${row.plays}, undone`, loop: false, ms: [...row.ms].reverse(), note: false });
  }
  console.log(`${row.id.padEnd(10)} ${file.padEnd(16)} ${n} frames  scale ${scale.toFixed(3)}  band px ${median(bands)}  notes ${meta.anchors.note.filter(Boolean).length}`);
  return out;
}

async function writeStrip(id, cells, row) {
  const strip = sharp({ create: { width: CELL * cells.length, height: CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(cells.map((input, i) => ({ input, left: i * CELL, top: 0 })));
  const png = await strip.png().toBuffer();
  await sharp(png).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(join(OUT, `${id}.webp`));
  await sharp({ create: { width: CELL * cells.length, height: CELL, channels: 4, background: { r: 128, g: 132, b: 128, alpha: 1 } } })
    .composite([{ input: png }]).png().toFile(join(CONTACT, `${id}.png`));
  const a = await Promise.all(cells.map(anchors));
  return {
    src: `rows/${id}.webp`, set: row.set ?? "app", label: row.label, plays: row.plays, frames: cells.length, ms: row.ms, loop: row.loop,
    anchors: { top: a.map((x) => x.top), note: row.note ? a.map((x) => x.note) : a.map(() => null) },
  };
}

let targetHeight = 0;
const wanted = process.argv.slice(2);
// idle always builds first: it sets the height every height-fitted row is matched to.
if (wanted.length && !wanted.includes("idle")) wanted.unshift("idle");
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : { version: 1, cell: CELL, ground: GROUND, rows: {} };
for (const row of ROWS.filter((r) => wanted.length === 0 || wanted.includes(r.id))) {
  const built = await buildRow(row);
  if (built) Object.assign(manifest.rows, built);
  else console.log(`${row.id.padEnd(10)} no take yet`);
}
manifest.cell = CELL;
manifest.ground = GROUND;
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
