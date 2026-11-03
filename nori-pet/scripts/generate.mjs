// Generates one sprite sheet image per animation row with OpenAI's image edit endpoint, using art/canonical.png as the
// character reference. Every call is logged to work/ledger.json with its token usage and an estimated cost; a call that
// would take the estimate past CAP_USD is refused.
//
//   node scripts/generate.mjs idle wave        # those rows
//   node scripts/generate.mjs --all            # every row without a take yet
//   node scripts/generate.mjs --status         # spend so far
//
// The key is read from the repo's .env (OPENAI_API_KEY) and never printed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup, Resolver } from "node:dns";
import { ROWS, CANONICAL } from "../art/catalog.mjs";
import { grid } from "./grid.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "work", "raw");
const LEDGER = join(ROOT, "work", "ledger.json");
const CAP_USD = Number(process.env.CAP_USD ?? 24);
const MODEL = process.env.IMG_MODEL ?? "gpt-image-2.5-sunburst";
const QUALITY = process.env.IMG_QUALITY ?? "high";
// USD per million tokens, rounded up from the published rates so the estimate errs high.
const RATE = { textIn: 5, imageIn: 10, imageOut: 40 };
const EST_CALL = 0.3;

mkdirSync(RAW, { recursive: true });

function ledger() {
  return existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { entries: [{ what: "concept renders (6 x medium)", usd: 0.35 }] };
}
const spent = (l) => l.entries.reduce((s, e) => s + e.usd, 0);

function apiKey() {
  const env = readFileSync(resolve(ROOT, "..", ".env"), "utf8");
  const line = env.split(/\r?\n/).find((l) => l.startsWith("OPENAI_API_KEY="));
  const key = line?.slice("OPENAI_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
  if (!key) throw new Error("OPENAI_API_KEY is missing from .env");
  return key;
}

function prompt(row) {
  const { cols, rows } = grid(row.poses.length);
  const list = row.poses.map((p, i) => `${i + 1}) ${p}`).join("\n");
  return [
    "Use the attached image as the exact character reference. Draw the same plush rice ball mascot: identical cream felt",
    "rice texture with little rice-grain bumps, identical dark olive-green felt seaweed band across its lower front, identical",
    "small glossy black bead eyes, small embroidered smile, soft pink blush, stubby round arms and two round feet, same",
    "proportions, colors and soft studio lighting. It must look like the same physical toy in every pose.",
    "",
    `Make a sprite sheet: ${row.poses.length} separate poses of this one character, laid out in a grid of ${cols} columns and ${rows} rows`,
    "in reading order, each pose centered in its own equal cell with generous empty space between poses so no two poses touch.",
    "Every pose is drawn at the same scale as the others, full body visible, three-quarter front view unless the pose says",
    "otherwise, feet resting on the same ground line within each grid row.",
    "Fully transparent background. No floor, no cast shadows, no text, no numbers, no extra characters, no hands or arms of anyone else, no motion lines, no",
    "sparkles or effects. Any prop (a small plain pure white paper card with nothing written on it, a tiny pencil, an envelope,",
    "a key, a stopwatch, a magnifying glass, a laptop, a teacup, a felt heart) is small, held by the character and touches it.",
    "",
    "Poses:",
    list,
  ].join("\n");
}

// Resolves hosts with the system resolver and falls back to public DNS when it fails (seen on this machine's network).
const publicDns = new Resolver();
publicDns.setServers(["8.8.8.8", "1.1.1.1"]);
function lookup(host, opts, cb) {
  const done = (err, address) => (err ? cb(err) : opts?.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4));
  dnsLookup(host, { family: 4 }, (err, address) => (!err ? done(null, address) : publicDns.resolve4(host, (e2, list) => done(e2, list?.[0]))));
}

/** POST a FormData body with node:https (so the lookup above applies); image edits can take minutes. */
async function post(url, key, form) {
  const encoded = new Response(form);
  const payload = Buffer.from(await encoded.arrayBuffer());
  return new Promise((resolveP, reject) => {
    const req = httpsRequest(url, {
      method: "POST", lookup, timeout: 600_000,
      headers: { authorization: `Bearer ${key}`, "content-type": encoded.headers.get("content-type"), "content-length": payload.length },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolveP({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end(payload);
  });
}

function cost(usage) {
  const d = usage?.input_tokens_details ?? {};
  const textIn = d.text_tokens ?? 0;
  const imageIn = d.image_tokens ?? Math.max(0, (usage?.input_tokens ?? 0) - textIn);
  const imageOut = usage?.output_tokens ?? 0;
  return (textIn * RATE.textIn + imageIn * RATE.imageIn + imageOut * RATE.imageOut) / 1e6;
}

async function generate(row, key) {
  const l = ledger();
  if (spent(l) + EST_CALL > CAP_USD) throw new Error(`Refusing ${row.id}: estimated spend $${spent(l).toFixed(2)} + $${EST_CALL} would pass the $${CAP_USD} cap`);
  const form = new FormData();
  form.append("model", MODEL);
  form.append("prompt", prompt(row));
  form.append("size", "1536x1024");
  form.append("quality", QUALITY);
  form.append("background", process.env.IMG_BACKGROUND ?? "transparent");
  form.append("output_format", "png");
  form.append("image[]", new Blob([readFileSync(join(ROOT, CANONICAL))], { type: "image/png" }), "canonical.png");
  const res = await post("https://api.openai.com/v1/images/edits", key, form).catch((err) => { throw new Error(`${row.id}: network error: ${err.code ?? ""} ${err.message}`); });
  const body = JSON.parse(res.text);
  if (res.status >= 300) throw new Error(`${row.id}: ${res.status} ${body?.error?.message ?? "request failed"}`);
  const usd = cost(body.usage);
  const fresh = ledger();
  const take = fresh.entries.filter((e) => e.row === row.id).length + 1;
  const file = `${row.id}-${take}.png`;
  writeFileSync(join(RAW, file), Buffer.from(body.data[0].b64_json, "base64"));
  fresh.entries.push({ row: row.id, file, usd: Number(usd.toFixed(4)), usage: body.usage, at: new Date().toISOString() });
  writeFileSync(LEDGER, JSON.stringify(fresh, null, 2));
  console.log(`${file}  $${usd.toFixed(3)}  total $${spent(fresh).toFixed(2)} of $${CAP_USD}`);
}

const args = process.argv.slice(2);
if (args.includes("--status")) {
  const l = ledger();
  console.log(`spent about $${spent(l).toFixed(2)} of $${CAP_USD} in ${l.entries.length} entries`);
} else {
  const done = new Set(ledger().entries.map((e) => e.row));
  const wanted = args.includes("--all") ? ROWS.filter((r) => !done.has(r.id)) : ROWS.filter((r) => args.includes(r.id));
  if (wanted.length === 0) console.log("Nothing to generate.");
  const key = apiKey();
  const parallel = Number(process.env.PARALLEL ?? 3);
  let failed = 0;
  for (let i = 0; i < wanted.length; i += parallel) {
    // Sequential batches keep the cap check honest: each batch is checked before it starts.
    const batch = wanted.slice(i, i + parallel);
    const l = ledger();
    if (spent(l) + EST_CALL * batch.length > CAP_USD) { console.log(`Stopping before ${batch.map((r) => r.id).join(", ")}: cap`); break; }
    const results = await Promise.allSettled(batch.map((r) => generate(r, key)));
    for (const r of results) if (r.status === "rejected") { failed++; console.log(String(r.reason?.message ?? r.reason)); }
  }
  if (failed) process.exitCode = 1;
}
