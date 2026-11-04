# Error pages design spec

The rules to build part 5 from: page not found, something broke, and the app failing to start, as full pages and
inside the dashboard. [ui-plan.md](ui-plan.md) (part 5) says what's on these pages and why. This file says how they
look and behave, then gives the build checklist. The wireframe (the "Error pages" page of the design canvas) follows
these rules. Where they disagree, this file wins.

It builds on [auth-design-spec.md](auth-design-spec.md) (the scene frame, type, buttons) and
[dashboard-4a-spec.md](dashboard-4a-spec.md) (the shell, Night Dawn, Nori's seats), which aren't repeated.

Status: decided, except the items under [Still open](#11-still-open).

## 1. Decisions at a glance

| Area | Decision |
|---|---|
| Pages | Page not found, something broke (with Try again), and the app failing to start. No offline page |
| Full pages | The auth pages' frame (`SceneFrame`) with a new scene, the fork in the path, and a short card instead of a form |
| Dashboard | Under `/today`, `/applications`, `/inbox` and `/you`, a 404 or an error keeps the shell; a card in the content area, no scene |
| Failing to start | A plain page with inline styles and system fonts: no images, no Nori, nothing it could fail to load |
| Error details | Never shown: no message, stack, code or digest on any page. The browser console keeps Next's log |
| Reporting | None yet: Try again and Go home only |

## 2. Routes and files

Next's file conventions, so the right page shows wherever a visitor ends up:

| File | Shows | When |
|---|---|---|
| `app/not-found.tsx` | Page not found, full page | Any address the app doesn't have outside the dashboard, and `notFound()` outside it. HTTP 404 |
| `app/error.tsx` | Something broke, full page | An error thrown while showing a page outside the dashboard (landing, auth, onboarding, privacy, terms) |
| `app/global-error.tsx` | Failing to start | An error in the root layout itself. It replaces the whole document, so it has its own `<html>` and `<body>` |
| `app/(app)/not-found.tsx` | Page not found, in the shell | `notFound()` from a dashboard page. HTTP 404 |
| `app/(app)/error.tsx` | Something broke, in the shell | An error thrown in a dashboard page; the shell (its layout) stays |

- **Unknown dashboard addresses** reach the in-shell 404 through catch-all pages that call `notFound()`:
  `app/(app)/today/[...rest]`, `app/(app)/you/[...rest]`, `app/(app)/applications/[id]/[...rest]` and
  `app/(app)/inbox/[id]/[...rest]`. Static routes win over catch-alls, so `/you/search` and the others are unaffected.
  `/applications/:id` and `/inbox/:id` with an unknown id keep their own "not found" states (4b), since the address
  is right and only the record is missing.
- **Signed out on a dashboard 404:** the shell sends them to sign-in as now (`/signin?next=…`), then back to the 404.
- All of them are `noindex`. Titles: "Page not found · Norinote", "Something went wrong · Norinote", "Norinote".

## 3. Layout

| Page | 1024+ | 768–1023 | Below 768 |
|---|---|---|---|
| Not found, something broke (full) | The auth layout: the scene column (`5fr`) on the left, the card column (`7fr`) with the 72 px top bar and the logo; the card centred, up to 400 px | The scene as a band across the top, the card centred under it | The 56 px top bar, the band, then the card with the 16 px margin |
| In the shell | The rail; in the content area (up to 960 px), the title row (`PageHead`) and a card up to 560 px | The icon rail; the same | Top bar and tabs; Nori beside the title (`head` seat) |
| Failing to start | A single column, centred, up to 420 px | The same | 20 px margin, top-aligned, 48 px from the top |

The full pages use `SceneFrame` with the fork scene and no `aside` (there's no switch link). Short screens behave as
on the auth pages: the card aligns to the top and the scene column stays fixed.

## 4. The pages

### Page not found

- **Full:** an `h1` "This page isn't here" (Serif, the auth pages' `text-auth`), the lead "The link may be old, or the
  address may have a typo." (`text-lead`, `ink-2`), then **Go to the home page** (primary, `/`) and **Open your
  dashboard** (outline, `/today`).
- **In the shell:** the title row with the `h1` "This page isn't here", then a card (`surface`, 1.5 px `line`, 18 px
  radius) with the lead and **Go to Today** (primary).

### Something broke

- **Full:** an `h1` "Something went wrong on this page", the lead "It's not you. Try again; if it keeps happening,
  come back in a little while.", **Try again** (primary) and **Go to the home page** (outline).
- **In the shell:** the same words; **Try again** and **Go to Today**.
- **Try again** calls the boundary's `reset()` inside a transition after `router.refresh()`, so a page whose data
  failed on the server is fetched again too. While it runs the button reads "Trying again…" and is `aria-disabled`.
  If the page throws again, the boundary shows again, unchanged.
- The heading takes focus when the boundary appears (`tabIndex={-1}`), since the page's content was replaced under the
  visitor; a fresh 404 doesn't move focus.

### Failing to start

- `app/global-error.tsx` with its own document: `<html lang="en">`, a `<title>`, and a `<style>` element in the page
  (no `globals.css`, no `next/font`, no images, no Nori). The Dawn colours (`#FBF4EA` page, `#1F2A24` ink, `#55605A`
  ink-2, `#2F5D46` button with `#FFFDF8` text) and `system-ui` fonts.
- "Norinote" (bold, 17 px), the `h1` "Norinote couldn't load" (600, 32 px), "Check your connection, then try again.",
  and **Try again**, which reloads the page (`location.reload()`): with the root layout broken, a reset can't help.
  "Reloading…" while it does.

## 5. The scene

**Fork:** take 1 of 2 (`art/raw/fork-1.png`), built as `fork` (portrait, 640 to 1280 px) and `fork-band` (1.5:1, 480
to 1080 px). Nori's seat is the flat stone at the foot of the signpost: `x 0.61, y 0.7` in the portrait,
`x 0.61, y 0.723` in the band. `SceneFrame` gains `fork` (`FrameScene`), anchored at `px 0.61, py 0.62`.

| Crop | Largest AVIF | Budget |
|---|---|---|
| `fork` 1280 | 67 KB | 120 KB |
| `fork-band` 1080 | 47 KB | 80 KB |

## 6. Components

| Component | Spec |
|---|---|
| `ErrorCard` | The full pages' content: `h1`, lead, a row of one or two buttons (`buttonClass`), and the "Trying again…" state |
| `ShellError` | The in-shell version: `PageHead` with the `h1`, then a card with the lead and buttons |
| `GlobalError` | Section 4's plain page, self-contained |

The not-found and error files are a few lines each around these.

## 7. Nori

- **Full pages:** Nori sits on the stone (`data-nori-seat="error"`). `NoriStage` chooses its controller by the
  address, and a 404 can be any address, so it treats a page with an `error` seat as an error page whatever the path
  (a new `startErrorNori`: the seat, no greeting, the rows below).
- **Not found:** `look` (it steps through looking around), then idle; the bubble "Hmm, nothing here."
- **Something broke:** `dizzy`, then `comfort` with "Sorry about that."; Try again plays `nod`.
- **In the shell:** the same reactions through the dashboard's controller, at its usual seat (rail or head). `look`
  and `dizzy` join its rows fetched later.
- **Failing to start:** no Nori.
- The first-screen rule holds: a reaction waits until the page has settled, so the strips (`look` 46 KB, `dizzy` 74 KB,
  `comfort` 50 KB) aren't on the first screen.

## 8. Accessibility

- One `h1` per page; the buttons are real links or buttons with their words; "Trying again…" is announced (`role
  status`).
- The error boundaries move focus to the heading when they appear (section 4). Nori's bubble is decoration (the words
  are the page's).
- The failing-to-start page meets AA on its own colours (ink on page 13.6:1, ink-2 6.0:1, button text 7.4:1).

## 9. Performance

- Full pages: under 450 KB before the first interaction, LCP under 2.0 s on 4G, CLS under 0.05 (the auth pages'
  budget; the scene is the largest thing on them).
- In the shell: the dashboard's budgets (4a).
- Failing to start: its own HTML and Next's runtime only.

## 10. Copy

| Place | Words |
|---|---|
| Not found | This page isn't here · The link may be old, or the address may have a typo. · Go to the home page · Open your dashboard |
| Not found, in the shell | This page isn't here · The link may be old, or the address may have a typo. · Go to Today |
| Something broke | Something went wrong on this page · It's not you. Try again; if it keeps happening, come back in a little while. · Try again · Trying again… · Go to the home page (Go to Today in the shell) |
| Failing to start | Norinote · Norinote couldn't load · Check your connection, then try again. · Try again · Reloading… |
| Nori | Hmm, nothing here. · Sorry about that. |
| Titles | Page not found · Norinote · Something went wrong · Norinote · Norinote |

## 11. Still open

- Wording for a full page when the API itself is down (pages that need the API already say so).
- A reference code to quote, and a way to report a problem, once support and hosting are decided (landing Phase 6).

## 12. Build checklist

Each phase ends with lint, type check and a look at 390 and 1440. Commit only with an explicit go.

### Phase 1: scene and frame
- [ ] `fork` in `SceneFrame` (`FrameScene`, anchor), its seat, and the built crops (done: `public/scenes/fork-*`,
  `lib/scenes.json`).

### Phase 2: full pages
- [ ] `app/not-found.tsx`, `app/error.tsx` and `app/global-error.tsx` with `ErrorCard` and `GlobalError`; titles and
  `noindex`.

### Phase 3: the dashboard
- [ ] `app/(app)/not-found.tsx` and `app/(app)/error.tsx` with `ShellError`; the four catch-all pages.

### Phase 4: Nori
- [ ] `startErrorNori` and `NoriStage` recognising the `error` seat; the reactions in section 7.

### Phase 5: QA
- [ ] `tests/qa-errors.mjs` (`npm run qa:errors`): an unknown address outside the dashboard and under each section, at
  the 11 sizes in three engines, light and dark for the shell; their HTTP 404s; something broke, caused the way it
  happens for real (a mocked API answering with a malformed body, so a page throws), outside and inside the
  dashboard, with Try again recovering once the API answers properly and failing again when it doesn't; focus on the
  heading; that no error text reaches the page; Nori's reactions; axe; keyboard; budgets. Failing to start can't be
  caused from a browser in a working build, so `GlobalError` is rendered on its own (React's server renderer) and
  checked for its words, colours, contrast and that it loads nothing.
