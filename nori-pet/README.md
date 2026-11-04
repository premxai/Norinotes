# @norinote/nori-pet

Nori, the Norinote companion: a plush rice ball who lives on the page, reacts to what the agent is doing, talks in
bubbles, holds codes and notes in its hands, reads along while you type, covers its eyes for your password, and can be
dragged, petted, tucked away and dropped onto a job.

- 45 animations (25 dashboard, 11 sign-in, 9 landing), hand-timed frames, 256 px cells, about 2.6 MB in all, loaded lazily
  (idle first, 69 KB).
- A framework-free player (`NoriPet`) plus a React wrapper (`Nori`, `useNori`), typed.
- Light and dark, reduced motion, keyboard and screen-reader friendly, phone sizes.

## See it

```bash
node nori-pet/scripts/serve.mjs
```

| Page | What |
|---|---|
| http://localhost:4410/playground/ | App playground: every event, bubble, size, theme, the full apply flow, drop Nori on a job |
| http://localhost:4410/playground/gallery.html | All 45 animations playing; filter by set; frame by frame; a one-by-one tour |
| http://localhost:4410/playground/login.html | Sign-in, sign-up and email code with Nori reading along, covering its eyes, peeking, turning a key |

## Add it to an app

1. Depend on it. In this repo: `"@norinote/nori-pet": "file:../../nori-pet"` in the app's package.json (or add
   `nori-pet` to the root workspaces). Anywhere else: `npm run pack:tgz` in `nori-pet/`, then
   `npm install path/to/dist/norinote-nori-pet-1.0.0.tgz`.
2. Serve the assets: `node nori-pet/scripts/copy-assets.mjs apps/landing/public/nori` (the app then uses `assets: "/nori/"`).
3. Load the styles once: `import "@norinote/nori-pet/style.css";`

### React (Next.js app router)

```tsx
"use client";
import { useRef } from "react";
import { Nori } from "@norinote/nori-pet/react";
import type { NoriPet } from "@norinote/nori-pet";

export function Companion() {
  const nori = useRef<NoriPet | null>(null);
  return <Nori ref={nori} assets="/nori/" onPet={() => "6 new jobs today, 3 ready to send."} onDrop={({ id }) => nori.current?.react("preparing")} />;
}
```

`@norinote/nori-pet/react` is marked `"use client"`. Nori renders into `document.body`, so the component itself renders
nothing; mount it once per page (in a layout for the dashboard).

### Plain JavaScript

```js
import { NoriPet } from "@norinote/nori-pet";
const nori = await NoriPet.create({ assets: "/nori/" });
```

## Recipes

Dashboard, applying:

```js
nori.react("preparing");                                                     // thinking
nori.react("prepared", { note: "1 gap", say: "Acme is ready: 1 gap to check." }); // reading, note in hand
nori.progress({ title: "Acme · Product analyst", step: "Answering 9 questions", percent: 52 });
nori.react("awaiting-code");
nori.react("code", { note: "482 913", say: "Acme sent a code. Typing it in." });  // catches the note, holds it out
nori.react("submitting");
nori.progressDone("Sent to Acme in 23s.");                                    // hop, sparkles
const yes = await nori.ask("Open to relocating to New York?", [{ label: "Yes", value: true }, { label: "No", value: false }]);
nori.on("drop", ({ id }) => { /* Nori was dropped on an element with data-nori-drop="{id}" */ });
nori.pointAt(document.querySelector("#apply"), "Tap here to send it.");
```

Sign-in and sign-up:

```js
nori.sitOn(document.querySelector("#signin-card"));          // sits on the card, follows scroll and resize
const unwire = nori.watchFields({ text: [email, name], password, reveal: showButton });
nori.react("signing-in");                                     // key
nori.react("signed-in", { say: "Welcome back!" });            // nod, then wave
nori.react("auth-failed", { say: "That password didn't match." });
nori.react("email-sent", { say: "Open the link I sent you." });
nori.react("welcome");                                        // bow with hearts
```

Landing page (play rows directly, or use the events):

```js
nori.sitOn(heroCard, { align: "right" });
nori.react("scroll-cue");        // points down
nori.play("present-left");       // gestures at the section on its left
nori.react("speed");             // stopwatch, for the 25-second story
nori.react("searching");         // magnifier
nori.play("laptop");             // typing fast
nori.play("papers");             // sorting resumes, the tailoring story
nori.react("relaxing");          // sips tea: autopilot
nori.react("thanks");            // felt heart, for the call to action
```

## API

| Member | What it does |
|---|---|
| `NoriPet.create(options)` | Loads `nori.json`, preloads idle, mounts Nori. Options: `assets`, `size` (`s`, `m`, `l`), `parent`, `onPet`, `sleepAfterMs`, `reducedMotion`, `storageKey`, `preload` (`"all"`, the default, fetches every row once the page is idle; `"lazy"` fetches rows as they're preloaded or played, for pages with a weight budget) |
| `react(event, { say, note, tone, ms, actions })` | Plays an event's animation and effects, optionally with a bubble, a note in hand, or a question (resolves with the answer) |
| `play(row, { loop })` | Plays any row by id (see the gallery) |
| `say(text, { tone, ms, title })` | A bubble that closes itself; tones `info`, `alert`, `success`, `error` |
| `ask(text, actions)` | A question bubble; resolves with the chosen `value` |
| `progress({ title, step, percent, startedAt })`, `progressDone(text)` | Live progress bubble with a seconds counter; done hops |
| `setNote(text)` | Text on the card in Nori's hands (rows that hold a card) |
| `sitOn(element, { overlap, align })` | Sits on top of an element; `null` sends it home |
| `watchFields({ text, password, reveal })` | Read-along, cover eyes, peek; returns an unwire function |
| `follow(fraction)` | Eyes follow a caret (0 left, 1 right; `null` stops) |
| `pointAt(element, say)`, `walkTo(x, y)` | Walks over and points; walks anywhere |
| `tuck()`, `untuck()`, `setSize(s)`, `mute(on)` | Hide to a peek at the bottom edge, size, silence bubbles |
| `fx(name)` | `hearts`, `sparkles`, `confetti`, `zzz`, `alert` |
| `on(event, fn)` | `drop`, `open` (double-click), `pet`, `answer`, `say`; returns an unsubscribe function |
| `history` | Everything Nori said (last 100), for a "What Nori did" panel |
| `destroy()` | Removes Nori and its listeners |

## Events

| Event | Nori |
|---|---|
| `hello`, `shortlist-ready`, `reply` | waves (sparkles for the shortlist and replies) |
| `preparing` / `prepared` | thinks / reads a sheet (ongoing) |
| `applying` / `submitting` | fills the form / dashes with an envelope (ongoing) |
| `awaiting-code` / `code` | waits / catches a note and holds it out with the code |
| `submitted` | hops, sparkles |
| `needs-user`, `captcha` | waits with a "!" badge (captcha deflates first); comes back if tucked |
| `failed`, `rejection` | deflates (rejection then comforts) |
| `interview`, `offer` | big celebrate, confetti |
| `cap-reached` | sleeps, zzz |
| `password`, `password-show`, `password-hide`, `password-done` | covers its eyes, peeks, covers again, uncovers |
| `signing-in`, `signed-in`, `auth-failed` | turns a key / nods then waves / gently shakes its head |
| `email-sent`, `welcome`, `loading` | holds up an envelope / bows with hearts / sways patiently |
| `scroll-cue`, `searching`, `speed`, `relaxing`, `thanks` | points down, magnifier, stopwatch, tea, heart |
| `idle` | back to resting |

## Interactions

| Input | Nori |
|---|---|
| Click, Enter | pet: hearts and the `onPet` line; a tucked Nori comes back instead |
| Drag | picked up, tilts with speed; shake to make it dizzy; lands and walks to the nearest side (remembered) |
| Drop on `[data-nori-drop]` | `drop` event with the element and its id |
| Double-click | `open` event |
| Right-click | settings bubble: mute, size, tuck away |
| Escape | tuck away or bring back |
| Hover nearby | looks at the cursor |
| Quiet for 2 minutes | falls asleep; any event or a pet wakes it |

Accessibility: Nori sits in its own landmark (`role="complementary"`, named "Nori"), so its bubbles aren't text outside
the page's landmarks; Nori itself is a focusable button with a label; every bubble is announced once through a polite live region
(questions name their answers); answers are real buttons; reduced motion shows still poses with no movement or effects.

Theming: override `--nori-*` properties (bubble, text, accent, alert, success, danger, font) on `.nori` or an ancestor.
Dark mode follows the system, `data-theme="dark"` on any ancestor, or a `.dark` class (next-themes, Tailwind).

## Making more art

```bash
node scripts/generate.mjs wave            # a new take of one row (gpt-image-2.5-sunburst, from art/canonical.png)
node scripts/build-rows.mjs wave          # rebuild it (newest take; pin one in work/picks.json)
node scripts/check.mjs                    # every strip, timing, anchor and event is consistent
node scripts/generate.mjs --status        # spend so far
```

New rows go in `art/catalog.mjs` (poses, timings, loop, `mirror`, `reverse`, `set`). A row costs about $0.07. The key comes
from the repo's `.env` and is never printed. `work/` (raw sheets, contact sheets, ledger) is not committed or packed.

## Layout

| Path | What |
|---|---|
| `src/` | `nori-pet.js` (player), `nori-pet.css`, `react.js`, types |
| `assets/` | `nori.json` (rows, timings, anchors) and `rows/*.webp` |
| `art/` | `canonical.png` (the reference Nori) and `catalog.mjs` (every row) |
| `scripts/` | generate, build, check, copy-assets, serve |
| `playground/` | the three demo pages |
