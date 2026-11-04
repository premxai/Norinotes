// Generates the landing page's painted scenes with the image model, from one shared style (spec section 8).
//   node art/scenes.mjs hero-phone desk horizon footer [--takes 2]
//   node art/scenes.mjs --status
// Raw takes land in art/raw/ (not committed). Spend goes to the same ledger as Nori's sprites, under one cap.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup, Resolver } from "node:dns";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(APP, "..", "..");
const RAW = join(APP, "art", "raw");
const LEDGER = join(REPO, "nori-pet", "work", "ledger.json");
const CAP_USD = Number(process.env.CAP_USD ?? 24);
const MODEL = process.env.IMG_MODEL ?? "gpt-image-2.5-sunburst";
// USD per million tokens, rounded up from the published rates so the estimate errs high.
const RATE = { textIn: 5, imageIn: 10, imageOut: 40 };
const EST_CALL = 0.3;

const STYLE = [
  "A handmade miniature diorama photographed in a studio: everything is soft wool felt, needle-felted fibres, matte clay",
  "and rice paper, with tiny stitched details. Warm, soft morning light, shallow depth of field, calm and cosy, gentle",
  "contrast. Palette: rice cream, soft peach and apricot light, sage and seaweed-green felt.",
  "No people, no animals, no characters, no faces, no text, no letters, no numbers, no logos, no frame or border.",
].join(" ");

/** Every scene leaves an empty seat for the live Nori and a calm area for words (spec section 8). */
export const SCENES = {
  "hero-phone": {
    size: "1024x1536",
    prompt: "Portrait composition of the same sunrise landscape as a website hero for a phone. The top 45 percent is calm open sky fading from rice-cream at the top to soft peach near the horizon, with almost no detail, so large headline text can sit on it. A low, soft, round felt sun peeks over far hills on the right. In the lower part, soft rounded rolling sage-green hills with morning mist in the valleys. The nearest hilltop, centred slightly left, has a small, flat, empty grassy spot in sharp focus, as if waiting for a little character to sit there (leave it empty).",
  },
  desk: {
    size: "1536x1024",
    prompt: "A tiny cosy felt-and-wood writing desk in soft morning light from a window on the left, seen from the front at desk height. On the left third of the desktop there is a small clear empty spot, as if waiting for a little character to sit there (leave it empty). On the desk: a tiny paper notebook, a small clay cup with a pencil, a folded paper note and a small potted felt plant, all small and kept to the edges. The right half of the picture is a calm, softly blurred warm cream wall with almost no detail, so a speech bubble and text can sit there.",
  },
  horizon: {
    size: "1536x1024",
    prompt: "A very wide, calm panorama of the same rolling sage-green felt hills later in the morning: the sun is higher, the sky is soft rice-cream and pale peach, the mist has lifted. Keep everything important inside a wide horizontal band across the middle; the top and bottom edges can be cropped. The centre of the picture is calm open sky above a gentle low hill line, so a headline and a button can sit in the middle. Low in the centre, on the nearest gentle hill, a small flat empty grassy spot in focus, as if waiting for a little character to sit there (leave it empty).",
  },
  footer: {
    size: "1536x1024",
    prompt: "A low, quiet horizon of rolling sage-green felt hills in full soft daylight, seen from far away, like the bottom edge of a landscape. The upper 60 percent is plain pale rice-cream sky with no detail at all. The hills are low, soft and simple, spread evenly from left to right, with a few tiny felt trees. On the right third, a small, flat, empty grassy spot on the nearest hill (leave it empty).",
  },
  // Part 2 (ui-plan.md): sign-up and email confirmation sit on the door, sign-in and the password pages on the nook.
  door: {
    size: "1024x1536",
    prompt: "Portrait composition. A small round felt door set into a soft sage-green grassy hillside at sunrise, with a tiny round window and a little paper lantern beside it. A short path of flat clay stepping stones leads up to the door. Right of the door, near the right edge, a small flat empty stone step in sharp focus, as if waiting for a little character to sit there (leave it empty). Keep the door, the stones and the empty step inside a horizontal band across the lower middle, so the picture can also be cropped to a wide strip. The top third is calm sky fading from rice-cream to soft peach, with almost no detail.",
  },
  // Alternatives to the round hillside door, which reads too much like a familiar fantasy home.
  cottage: {
    size: "1024x1536",
    prompt: "Portrait composition. The front of a tiny square felt-and-clay cottage at sunrise: a plain rectangular wooden front door painted soft seaweed green with a small brass knob, a little square window with a rice-paper blind, a pitched roof of felt tiles, a paper lantern on a hook by the door. A short path of flat clay stepping stones leads up to two low wooden steps. Right of the door, near the right edge, an empty wooden crate or flat step in sharp focus, as if waiting for a little character to sit there (leave it empty). Keep the door, the steps and the empty spot inside a horizontal band across the lower middle, so the picture can also be cropped to a wide strip. The top third is calm sky fading from rice-cream to soft peach, with almost no detail.",
  },
  gate: {
    size: "1024x1536",
    prompt: "Portrait composition. A small open wooden garden gate set in a low, soft, rounded felt hedge at sunrise, with a path of flat clay stepping stones leading through it towards gentle sage-green hills and a low round felt sun in the distance. A small paper lantern hangs from the gate post. Right of the gate, near the right edge, the flat top of a short wooden fence post or a flat stone in sharp focus, as if waiting for a little character to sit there (leave it empty). Keep the gate, the path and the empty spot inside a horizontal band across the lower middle, so the picture can also be cropped to a wide strip. The top third is calm sky fading from rice-cream to soft peach, with almost no detail.",
  },
  nook: {
    size: "1024x1536",
    prompt: "Portrait composition of a cosy indoor reading nook in early morning light: a low wooden desk under a round window with soft peach light coming through, a steaming clay mug, a folded paper note and a tiny potted felt plant on the desk, all kept small. Near the right edge of the desktop, a small flat empty felt cushion in sharp focus, as if waiting for a little character to sit there (leave it empty). Keep the desk, the mug and the empty cushion inside a horizontal band across the lower middle, so the picture can also be cropped to a wide strip. The top third is a calm, softly blurred warm cream wall with almost no detail.",
  },
};

function ledger() {
  return existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { entries: [] };
}
const spent = (l) => l.entries.reduce((s, e) => s + e.usd, 0);

function apiKey() {
  const env = readFileSync(join(REPO, ".env"), "utf8");
  const line = env.split(/\r?\n/).find((l) => l.startsWith("OPENAI_API_KEY="));
  const key = line?.slice("OPENAI_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
  if (!key) throw new Error("OPENAI_API_KEY is missing from .env");
  return key;
}

// Resolves hosts with the system resolver and falls back to public DNS when it fails (seen on this machine's network).
const publicDns = new Resolver();
publicDns.setServers(["8.8.8.8", "1.1.1.1"]);
function lookup(host, opts, cb) {
  const done = (err, address) => (err ? cb(err) : opts?.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4));
  dnsLookup(host, { family: 4 }, (err, address) => (!err ? done(null, address) : publicDns.resolve4(host, (e2, list) => done(e2, list?.[0]))));
}

function postJson(url, key, body) {
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((ok, fail) => {
    const req = httpsRequest(url, {
      method: "POST", lookup, timeout: 600_000,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "content-length": payload.length },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => ok({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", fail);
    req.end(payload);
  });
}

function cost(u) {
  const d = u?.input_tokens_details ?? {};
  const textIn = d.text_tokens ?? 0;
  const imageIn = d.image_tokens ?? Math.max(0, (u?.input_tokens ?? 0) - textIn);
  return (textIn * RATE.textIn + imageIn * RATE.imageIn + (u?.output_tokens ?? 0) * RATE.imageOut) / 1e6;
}

async function make(id, key) {
  const l = ledger();
  if (spent(l) + EST_CALL > CAP_USD) throw new Error(`Refusing ${id}: $${spent(l).toFixed(2)} spent, cap $${CAP_USD}`);
  const scene = SCENES[id];
  const res = await postJson("https://api.openai.com/v1/images/generations", key, {
    model: MODEL, prompt: `${STYLE} ${scene.prompt}`, size: scene.size, quality: "high", output_format: "png",
  });
  const body = JSON.parse(res.text);
  if (res.status >= 300) throw new Error(`${id}: ${res.status} ${body?.error?.message ?? "request failed"}`);
  const usd = cost(body.usage);
  const fresh = ledger();
  const take = fresh.entries.filter((e) => e.row === `landing-${id}`).length + 1;
  const file = `${id}-${take}.png`;
  writeFileSync(join(RAW, file), Buffer.from(body.data[0].b64_json, "base64"));
  fresh.entries.push({ row: `landing-${id}`, file: `apps/landing/art/raw/${file}`, usd: Number(usd.toFixed(4)), usage: body.usage, at: new Date().toISOString() });
  writeFileSync(LEDGER, JSON.stringify(fresh, null, 2));
  console.log(`${file}  $${usd.toFixed(3)}  total $${spent(fresh).toFixed(2)} of $${CAP_USD}`);
}

const args = process.argv.slice(2);
if (args.includes("--status")) {
  console.log(`spent about $${spent(ledger()).toFixed(2)} of $${CAP_USD}`);
} else {
  mkdirSync(RAW, { recursive: true });
  const takes = Number(args[args.indexOf("--takes") + 1]) || 1;
  const ids = args.filter((a) => SCENES[a]);
  if (ids.length === 0) console.log(`Scenes: ${Object.keys(SCENES).join(", ")}`);
  if (spent(ledger()) + EST_CALL * ids.length * takes > CAP_USD) throw new Error("This run could pass the cap");
  const key = apiKey();
  // Scenes run in parallel; each scene's takes run one after another so take numbers stay unique.
  await Promise.all(ids.map(async (id) => {
    for (let t = 0; t < takes; t++) await make(id, key).catch((e) => { process.exitCode = 1; console.log(e.message); });
  }));
}
