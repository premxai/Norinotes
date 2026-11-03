// Checks the built package: every manifest row has its strip, the strip is frames x cell wide and one cell tall, timings
// and anchors cover every frame, every reaction points at a built row, and every catalog row is built.
//   node scripts/check.mjs
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { ROWS } from "../art/catalog.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "assets", "nori.json"), "utf8"));
const problems = [];
let bytes = 0;

for (const [id, row] of Object.entries(manifest.rows)) {
  const file = join(ROOT, "assets", row.src);
  if (!existsSync(file)) { problems.push(`${id}: missing ${row.src}`); continue; }
  bytes += statSync(file).size;
  const meta = await sharp(file).metadata();
  if (meta.width !== row.frames * manifest.cell || meta.height !== manifest.cell) problems.push(`${id}: strip is ${meta.width}x${meta.height}, expected ${row.frames * manifest.cell}x${manifest.cell}`);
  if (row.ms.length !== row.frames) problems.push(`${id}: ${row.ms.length} timings for ${row.frames} frames`);
  if (row.anchors.top.length !== row.frames || row.anchors.note.length !== row.frames) problems.push(`${id}: anchors do not cover every frame`);
  if (!["app", "auth", "landing"].includes(row.set)) problems.push(`${id}: unknown set ${row.set}`);
}

for (const r of ROWS) {
  for (const id of [r.id, r.mirror, r.reverse].filter(Boolean)) if (!manifest.rows[id]) problems.push(`catalog row ${id} is not built`);
  if (r.note && !manifest.rows[r.id]?.anchors.note.some(Boolean)) problems.push(`${r.id}: holds a note but no note anchor was found`);
}

const { REACTIONS } = await import("../src/nori-pet.js").catch(() => ({ REACTIONS: null }));
if (REACTIONS) {
  for (const [event, r] of Object.entries(REACTIONS)) for (const id of [r.row, r.then].filter(Boolean)) if (!manifest.rows[id]) problems.push(`event ${event} uses missing row ${id}`);
}
for (const id of ["idle", "blink", "look", "walk", "walk-left", "dangle", "land", "dizzy", "petted", "sleep", "wake", "point", "point-right", "type-along"]) {
  if (!manifest.rows[id]) problems.push(`the player needs row ${id}`);
}

console.log(`${Object.keys(manifest.rows).length} rows, ${(bytes / 1024 / 1024).toFixed(2)} MB of strips, ${REACTIONS ? Object.keys(REACTIONS).length : "?"} events`);
if (problems.length) { console.log(problems.map((p) => `  - ${p}`).join("\n")); process.exitCode = 1; }
else console.log("All good.");
