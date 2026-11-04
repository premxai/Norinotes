// The link-preview image (spec section 15): the Dawn hero, the headline in Geist Serif Triangle and Nori on the hill,
// 1200 × 630. Written to app/opengraph-image.png and app/twitter-image.png, which Next serves as static metadata.
//   node art/og.mjs
// The serif ships only as WOFF2, which text rendering can't read, so art/fonts/ holds TTF copies (SIL OFL, see OFL.txt).
// To remake one: fontTools' TTFont(woff2) with flavor None, saved as .ttf.
import { copyFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NORI = resolve(APP, "..", "..", "nori-pet", "assets");
const W = 1200;
const H = 630;
const INK = "#1F2A24";

const scenes = JSON.parse(readFileSync(join(APP, "lib", "scenes.json"), "utf8"));
const hero = scenes.hero;
const src = join(APP, "public", hero.sources.find((s) => s.width === 1920).webp);

// Cover the 1200 × 630 frame, anchored to the bottom like the page (object-position 50% 100%).
const drawnW = Math.max(W, H * hero.aspect);
const drawnH = drawnW / hero.aspect;
const offX = (W - drawnW) / 2;
const offY = H - drawnH;
const bg = await sharp(src).resize(Math.round(drawnW), Math.round(drawnH)).extract({ left: Math.round(-offX), top: Math.round(-offY), width: W, height: H }).toBuffer();

const headline = await sharp({
  text: {
    text: `<span foreground="${INK}" letter_spacing="-1200">A few jobs you’re likely to get, every morning.</span>`,
    font: "Geist Serif Triangle 70",
    fontfile: join(APP, "art", "fonts", "GeistSerif-Triangle.ttf"),
    width: 980,
    align: "centre",
    rgba: true,
    dpi: 72,
    spacing: -6,
  },
}).png().toBuffer();
const hMeta = await sharp(headline).metadata();

const manifest = JSON.parse(readFileSync(join(NORI, "nori.json"), "utf8"));
const size = 150;
const nori = await sharp(join(NORI, manifest.rows.idle.src)).extract({ left: 0, top: 0, width: manifest.cell, height: manifest.cell }).resize(size, size).toBuffer();
const seatX = offX + hero.seat.x * drawnW;
const seatY = offY + hero.seat.y * drawnH;

const out = join(APP, "app", "opengraph-image.png");
await sharp(bg)
  .composite([
    { input: headline, left: Math.round((W - hMeta.width) / 2), top: 70 },
    { input: nori, left: Math.round(seatX - size / 2), top: Math.round(seatY - size * (248 / 256)) },
  ])
  .png({ compressionLevel: 9 })
  .toFile(out);
copyFileSync(out, join(APP, "app", "twitter-image.png"));
console.log(`Wrote app/opengraph-image.png and app/twitter-image.png (${W}x${H}); headline ${hMeta.width}x${hMeta.height}`);
