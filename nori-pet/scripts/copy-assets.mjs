// Copies Nori's assets (nori.json and rows/) into an app's public folder, so the app can pass assets: "/nori/".
//   node nori-pet/scripts/copy-assets.mjs apps/landing/public/nori
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dest = process.argv[2];
if (!dest) {
  console.log("Usage: node nori-pet/scripts/copy-assets.mjs <destination folder>, for example apps/landing/public/nori");
  process.exit(1);
}
const target = resolve(process.cwd(), dest);
mkdirSync(target, { recursive: true });
cpSync(join(ROOT, "assets"), target, { recursive: true });
console.log(`Copied Nori's assets to ${target}. Use NoriPet.create({ assets: "/<that public path>/" }).`);
