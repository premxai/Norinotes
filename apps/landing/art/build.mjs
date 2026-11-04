// Turns the picked raw scenes into the files the page serves (spec section 8):
//   crop to the scene's aspect, upscale past the source with Lanczos and a light sharpen, add a faint noise so the sky
//   doesn't band, then AVIF and WebP at each width, a 24 px blurred preview and the dominant colour.
//   node art/build.mjs            all scenes
//   node art/build.mjs hero desk  some scenes
// Writes public/scenes/<id>-<width>.{avif,webp} and lib/scenes.json (sources, sizes, colours, Nori's seat).
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(APP, "art", "raw");
const OUT = join(APP, "public", "scenes");
const MANIFEST = join(APP, "lib", "scenes.json");

/**
 * The picked take of each scene and how it's served.
 * crop: target aspect (width / height) and where the band sits vertically (0 top, 0.5 middle, 1 bottom).
 * seat: where Nori's feet go, as fractions of the cropped image. budgetKB: the largest WebP/AVIF allowed at 1920 px
 * (or the largest width when it's smaller).
 */
export const PICKS = {
  // Dawn hills, the sun low on the right; Nori sits on the near crest right of centre.
  hero: { file: "hero-1.png", widths: [768, 1280, 1920, 2560], seat: { x: 0.64, y: 0.675 }, budgetKB: 180 },
  // The same morning in portrait for phones; the near crest is left of centre.
  "hero-phone": { file: "hero-phone-2.png", widths: [480, 780, 1080], seat: { x: 0.42, y: 0.69 }, budgetKB: 120 },
  // The little desk for section 06: an empty spot on the desk's left half, a calm wall on the right for the bubble.
  desk: { file: "desk-1.png", crop: { aspect: 4 / 3, y: 0.5 }, widths: [640, 960, 1280], seat: { x: 0.3, y: 0.69 }, budgetKB: 120 },
  // Later morning for the final call to action. 2:1 keeps the top 45% as sky for the words (the middle crosses busy
  // hills, where ink falls to 1.5:1); the seat is the low hill in the middle.
  horizon: { file: "horizon-2.png", crop: { aspect: 2, y: 0.25 }, widths: [768, 1280, 1920, 2560], seat: { x: 0.5, y: 0.85 }, budgetKB: 120 },
  // A low strip of hills for the footer, where Nori falls asleep on the right.
  footer: { file: "footer-1.png", crop: { aspect: 4, y: 1 }, widths: [768, 1280, 1920], seat: { x: 0.8, y: 0.55 }, budgetKB: 60 },
};

const NOISE = 3; // ± levels of triangular noise (about 1.2% of the range): enough to break gradient banding, too faint to see

async function cropped(pick) {
  const src = sharp(join(RAW, pick.file));
  const { width, height } = await src.metadata();
  if (!pick.crop) return { img: src, width, height };
  const h = Math.min(height, Math.round(width / pick.crop.aspect));
  const w = Math.min(width, Math.round(h * pick.crop.aspect));
  const top = Math.round((height - h) * pick.crop.y);
  const left = Math.round((width - w) / 2);
  return { img: sharp(join(RAW, pick.file)).extract({ left, top, width: w, height: h }), width: w, height: h };
}

function dither({ data, info }) {
  for (let i = 0; i < data.length; i++) {
    const n = Math.round((Math.random() + Math.random() - 1) * NOISE);
    data[i] = Math.max(0, Math.min(255, data[i] + n));
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
}

async function build(id, pick) {
  if (!existsSync(join(RAW, pick.file))) throw new Error(`${id}: art/raw/${pick.file} is missing`);
  const { img, width, height } = await cropped(pick);
  const base = await img.removeAlpha().toBuffer();
  const aspect = width / height;
  const sources = [];
  const report = [];
  for (const w of pick.widths) {
    const h = Math.round(w / aspect);
    let step = sharp(base).resize(w, h, { kernel: "lanczos3" });
    if (w > width) step = step.sharpen({ sigma: 0.5 });
    const noisy = dither(await step.raw().toBuffer({ resolveWithObject: true }));
    const raw = await noisy.png().toBuffer();
    const avif = join(OUT, `${id}-${w}.avif`);
    const webp = join(OUT, `${id}-${w}.webp`);
    await sharp(raw).avif({ quality: 50, effort: 6, chromaSubsampling: "4:2:0" }).toFile(avif);
    await sharp(raw).webp({ quality: 80, effort: 6 }).toFile(webp);
    sources.push({ width: w, height: h, avif: `/scenes/${id}-${w}.avif`, webp: `/scenes/${id}-${w}.webp` });
    report.push(`${w}: ${(statSync(avif).size / 1024).toFixed(0)} KB avif, ${(statSync(webp).size / 1024).toFixed(0)} KB webp`);
  }
  const preview = await sharp(base).resize(24).webp({ quality: 40 }).toBuffer();
  const { dominant } = await sharp(await sharp(base).resize(64).toBuffer()).stats();
  const color = `#${[dominant.r, dominant.g, dominant.b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  const checkW = pick.widths.includes(1920) ? 1920 : pick.widths.at(-1);
  const checkKB = statSync(join(OUT, `${id}-${checkW}.avif`)).size / 1024;
  const over = checkKB > pick.budgetKB;
  console.log(`${id} (${width}x${height}${width < pick.widths.at(-1) ? `, upscaled to ${pick.widths.at(-1)}` : ""}): ${report.join("; ")}${over ? `  OVER BUDGET at ${checkW}: ${checkKB.toFixed(0)} KB > ${pick.budgetKB} KB` : ""}`);
  return {
    aspect: Number(aspect.toFixed(4)),
    color,
    preview: `data:image/webp;base64,${preview.toString("base64")}`,
    seat: pick.seat,
    sources,
  };
}

const wanted = process.argv.slice(2).filter((a) => PICKS[a]);
const ids = wanted.length ? wanted : Object.keys(PICKS);
mkdirSync(OUT, { recursive: true });
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
for (const id of ids) manifest[id] = await build(id, PICKS[id]);
mkdirSync(dirname(MANIFEST), { recursive: true });
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${ids.length} scene(s) to public/scenes/ and lib/scenes.json`);
