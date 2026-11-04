// App icons from Nori's resting frame (spec section 15): a 32 px favicon, a 180 px Apple touch icon on the Dawn
// background, and a 512 px icon for a later web app manifest.
//   node art/icons.mjs
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import sharp from "sharp";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NORI = resolve(APP, "..", "..", "nori-pet", "assets");
const manifest = JSON.parse(readFileSync(join(NORI, "nori.json"), "utf8"));
const { cell } = manifest;
const BG = "#fbf4ea";

const frame = await sharp(join(NORI, manifest.rows.idle.src)).extract({ left: 0, top: 0, width: cell, height: cell }).toBuffer();
const nori = await sharp(frame).trim({ threshold: 1 }).toBuffer();

/** Nori fitted into a square, with padding as a fraction of the side. */
async function square(size, pad, background) {
  const inner = Math.round(size * (1 - 2 * pad));
  const fitted = await sharp(nori).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: fitted, gravity: "center" }])
    .png();
}

await (await square(32, 0.02, { r: 0, g: 0, b: 0, alpha: 0 })).toFile(join(APP, "public", "icon-32.png"));
await (await square(180, 0.12, BG)).toFile(join(APP, "app", "apple-icon.png"));
await (await square(512, 0.12, BG)).toFile(join(APP, "public", "icon-512.png"));
console.log("Wrote public/icon-32.png (32, also the nav logo), app/apple-icon.png (180) and public/icon-512.png");
