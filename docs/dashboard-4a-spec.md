# Dashboard 4a design spec: the shell and Today

The rules to build part 4a from: the dashboard's shell (rail, tabs, light and dark) and `/today`. [ui-plan.md](ui-plan.md)
(part 4) says what the dashboard is and why it's split in three. This file says how 4a looks, moves and behaves, then
gives the build checklist. The wireframe (the "Dashboard 4a: Today" page of the design canvas) follows these rules.
Where they disagree, this file wins.

It builds on [landing-design-spec.md](landing-design-spec.md) (type, focus ring, motion, budgets, QA) and
[auth-design-spec.md](auth-design-spec.md) (fields, the error box, the status line). Neither is repeated here.

Status: decided, except the items under [Still open](#14-still-open).

## 1. Decisions at a glance

| Area | Decision |
|---|---|
| Where | `apps/landing`, route group `(app)`: `/today` now; `/applications`, `/inbox` and `/you` as placeholders until 4b and 4c. `/dashboard` redirects to `/today` |
| Shell | A 248 px rail from 1024 px, a 72 px icon rail from 768 px, a top bar and bottom tabs below that |
| Theme | Dawn (light) and Night Dawn (dark), from the system by default; a three-way switch (System, Light, Dark) in the rail's account menu |
| Today | A greeting with a thin scene strip, a one-line summary, the "needs you" row, then job cards, each with **Apply** and **Not for me** |
| Applying | The live panel: a 420 px side panel from 1024 px, a full-height sheet below, playing the application's real status and run log |
| Updates | Polling: 2 s while an application is moving, 30 s otherwise, paused while the tab is hidden |
| Nori | At the foot of the rail from 1024 px; below that, standing in the corner of Today's greeting strip (above the tab bar it covered card buttons). Reacts to the application the panel shows |

## 2. Layout

| Range | Shell | Today | Live panel |
|---|---|---|---|
| 1024+ | Rail 248 px, `surface-2`, `line` right border, full height, sticky | Content up to 960 px, centred in what's left, padding 28 px 40 px | 420 px on the right, `surface`, `line` left border, full height; the content narrows beside it |
| 768–1023 | Rail 72 px: icons, the count as a badge, labels on hover and focus (a tooltip) | Content with 32 px side padding | Overlays the content from the right, 420 px, with a 40% scrim |
| Below 768 | Top bar 56 px (logo, the section's name); bottom tabs 64 px plus `env(safe-area-inset-bottom)` | Content with the 16 px page margin, 96 px clear above the tabs | A modal sheet from 32 px below the top of the screen, 22 px top corners, a grab handle |

- **Rail contents, top to bottom:** the logo (to `/today`); the four sections (Today, Applications, Inbox, You) as
  44 px rows with an icon, a label and a count; the cap meter; then at the foot Nori's seat and the
  account row (name, a menu with the theme switch and **Sign out**). The menu opens beside the rail (desktop) or below
  the top bar (phones), never upward over Nori's seat.
- **Tabs:** the same four, icon over label, 12 px labels; the current one in `ink`, the rest in `ink-2`; a dot on Today
  when something needs you.
- **Greeting strip:** 112 px tall from 1024 px, 132 px from 768 and 112 px on phones (tall enough for Nori to stand in
  its bottom-right corner below 1024 px), 20 px radius (16 px on phones), `object-fit: cover` at
  `50% 60%`. Light: the landing footer's hills (`footer`). Dark, and after 6 pm in light: the night strip (`night`).
  It's decoration (`alt=""`), with no text on it.

## 3. Spacing

| Between | Phone | 1024+ |
|---|---|---|
| Top of content and the greeting | 18 | 28 |
| Greeting and day line | 4 | 6 |
| Day line and strip, strip and the next block | 16 | 20 |
| Banner or needs row and the list header | 16 | 20 |
| Card and card | 12 | 14 |
| Inside a card | 16 padding, 10 gap | 18 by 20 padding, 10 gap |
| Live panel padding | 16 | 20 |

## 4. Type

| Element | Style |
|---|---|
| Greeting (`h1`) | Geist Serif Triangle, 32 px on phones, 40 px from 1024 |
| Day line | Body 14 px (phones) / 16 px, `ink-2` |
| List header ("3 for today", `h2`) | Geist 600, 18 / 20 px |
| Card title | Geist 600, 17 / 18 px |
| Card meta (company · place · posted) | Small 13 / 14 px, `ink-2` |
| Fit score | Geist 600, 18 / 20 px, tabular figures, with "fit" for screen readers. Not Mono: on the first screen it would load the mono font (70 KB) |
| Reasons | Small 14 px, `ink-2`, line height 1.45, an `accent` dot before each |
| Rail rows | Geist 500 15 px; current 600 |
| Counts | Geist 500 12 px, tabular figures, `ink-2` (Geist for the same reason) |
| Panel title | Geist 600, 21 / 22 px |
| Timer | Geist Mono 500, 18 / 20 px |
| Run-log lines | Small 14 px |

## 5. Colour and themes

The tokens in [ui-plan.md](ui-plan.md) (part 4, Night Dawn), as CSS variables. `app/globals.css` keeps the Dawn values
in `@theme` and redefines them for dark under `@media (prefers-color-scheme: dark)` guarded by
`:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]`. The switch writes `data-theme` on
`<html>` (and to `localStorage` for the next visit); "System" removes it. Only the `(app)` pages follow the theme; the
landing, auth and onboarding pages stay Dawn, so their scenes keep working.

| New pair (dark) | Ratio |
|---|---|
| `ink` on `bg` / `surface` / `tint` | 15.5 / 14.0 / 12.1 |
| `ink-2` on `bg` / `surface` | 9.6 / 8.7 |
| `accent` text on `bg` / `surface` | 8.8 / 8.0 |
| `on-accent` on `accent` / `accent-hover` | 8.8 / 10.9 |
| `line-strong` on `bg` / `surface` | 5.2 / 4.7 |
| `danger` / `warning` on `bg` | 7.3 / 9.6 |

- The "needs you" row and wall boxes use a 2 px `warning` border; failures a 2 px `danger` border. Words carry the
  meaning too ("Nori needs you", "Didn't go through").
- The theme is set before the first paint (an inline script reads `localStorage`), so dark never flashes light.

## 6. Components

| Component | Spec |
|---|---|
| `AppShell` | The rail or bar and tabs, Nori's seat, the account menu, the email banner slot, and the live panel's slot. One layout for the `(app)` group |
| Rail row / tab | A `Link` with `aria-current="page"` on the current one; the count is part of its name ("Today, 3") |
| Cap meter | "Sent today" and "2 of 5" (Mono), a 6 px `meter` bar; under it "Nori asks before every send" when the cap is 0 (autopilot off) |
| Email banner | `tint`, 14 px radius: "**Confirm your email** so employers' replies reach you. We sent a link to …" and **Send it again**. After sending: "Sent. Check your inbox." The resend's rate limit shows the API's words |
| Needs-you row | A button: a `warning` dot, "**Nori needs you** · 1 application waiting on you", **Open**. Opens the first waiting application in the panel |
| Job card | `surface`, 1.5 px `line`, 18 px radius. The company logo (below) on the left; the title and meta are one button that opens the job; the fit score on the right; two reasons; **Apply** (primary) and **Not for me** (text). Once applied, the buttons give way to a status chip and **Watch** |
| Company logo | `job.companyLogoUrl` (a Brandfetch CDN address, or null) as a plain `<img>`: `loading="lazy"`, `decoding="async"`, `alt=""` (the name is text beside it), `object-fit: contain` with 4 px padding on a light tile (`#fffdf8`, 1.5 px `line`, 10 px radius) in both themes, since logos are drawn for light backgrounds. 36 px on phones, 40 px from 768. When it's null, or the image fails (the CDN answers 404 when it has no logo), a letter tile in the same box: the name's first letter or digit, 600, `ink` on `tint`, hidden from screen readers. Brandfetch's terms allow only a plain `<img>` of its CDN: no next/image, proxying or saved copies. The CSP's `img-src` allows `https://cdn.brandfetch.io`, and the page's referrer policy (strict-origin-when-cross-origin) sends the origin Brandfetch needs. Roughly 4 in 5 companies have no known domain, so the tile is the usual case. No name-to-domain lookup in the browser: a same-named company could bring the wrong logo |
| Undo toast | `ink` fill, `bg` text, pill, bottom centre above the tabs: "Hidden from today." **Undo** (5 s) |
| Live panel | A header with "Application" or "Job" and a 44 px close button, then the job's title and meta, then the panel's state (section 7) |
| Status chip | Pill, `tint`: Getting it ready, Ready for your OK, Applying, Waiting for a code, Needs you, Sent, Didn't go through |
| Empty state | A card with a serif title and one line (section 9) |

## 7. The live panel

Opens from **Apply** (the application is created with `POST /api/applications { jobId }`), from **Watch**, from the
needs-you row, or from a job card (the job view). It shows one application; with several open (Send all), a switcher
in the header reads "1 of 3" with previous and next.

| Status | Panel | Nori (event) |
|---|---|---|
| Job view (no application) | The job: every reason, when it was posted, the description (`GET /api/jobs/:id`, the first 1,200 characters with **Read more**), and **Apply** | idle |
| `queued`, `preparing` | "Getting it ready": the run log so far ("Tailoring your resume", "Reading the application form") | `preparing` |
| `prepared` | "Ready to send": the tailored resume (`GET /api/applications/:id` → `resume`, changed lines marked as on the landing page), the answers Nori will give, and **Send it** (`POST /:id/approve`). Nothing is sent before this | `prepared` |
| `applying` | The run log as it grows, one line per event (`events[].message`, info and warn only, repeats folded), the newest at the bottom; the timer from `approvedAt` | `applying`, then `submitting` on the last step |
| `awaiting_code` | "Waiting for the email code" and the Nori inbox address it'll arrive at | `awaiting-code`; `code` when the next event says it arrived |
| `needs_user` with questions | "Nori needs 2 answers to finish this one." and a form built from `pendingQuestions` (text, choice or yes/no, as each question says), saved with `POST /:id/answer`; "Saved to your answer bank, so Nori won't ask again." | `needs-user` |
| `needs_user` without questions (a wall) | The API's `error` in words, "Nori never gets around those; finish it yourself and Nori will pick up the reply", and **Open the application page** (the job's apply link, in a new tab) | `captcha` |
| `submitted` | "Sent in 18 seconds" (approved to submitted), the receipt's confirmation (if any), **View the application** (`/applications/:id`, 4b) | `submitted` |
| `failed` | The API's `error` in words, "Nothing was sent" when nothing was, **Try again** (`POST /:id/retry`) and the run log | `failed` |

- **Polling** (`GET /api/applications/:id`): every 2 s while the status is `queued`, `preparing`, `applying` or
  `awaiting_code`; every 30 s otherwise; stopped while the tab is hidden and resumed on return.
- **Focus:** opening moves focus to the panel's title; closing returns it to the button that opened it. On phones the
  sheet is a modal dialog (focus trapped, Esc and the scrim close it); from 1024 px it's a complementary region.
- **Announcements:** each status change is announced once in a polite live region ("Applying", "Sent in 18 seconds");
  run-log lines are not announced one by one.
- **Approving more:** when the panel shows a `prepared` application and there are more from Send all, **Send it**
  moves on to the next one.

## 8. Today

- **Data:** `GET /api/shortlist` (the cards), `GET /api/shortlist/meta` (the widened note), `GET /api/applications` (to
  mark cards already applied and to find what needs you), `GET /api/agent/status` (the cap), `GET /api/auth/session`
  (the email banner), `GET /api/profile` (the first name). Every 30 s while visible.
- **Greeting:** "Good morning" before noon, "Good afternoon" before 6 pm, "Good evening" after, in the browser's time,
  with the first word of the profile's name (no name: "Good morning").
- **Day line:** "3 for today · 1 needs you · 2 of 5 sent today" (the parts that apply). Widened: a second line,
  "Showing similar roles while Nori looks for more".
- **Order:** waiting on you (needs-you row) first, then the cards by fit, highest first. Cards already sent move to the
  bottom with their chip.
- **Apply:** creates the application and opens the panel. **Send all N** creates one per card that has none, in order,
  and opens the panel on the first; each still waits for **Send it** unless autopilot is on (part 4c).
- **Not for me:** hides the card at once and shows the toast; `POST /api/shortlist/:jobId/dismiss` is sent when the
  5 s are up (the API has no un-dismiss), and **Undo** within them cancels it.
- **Posted:** "9 hours ago", "1 day ago". Users only ever see jobs from the last 72 hours; nothing here widens that.

## 9. Empty and error states

| State | Title | Line |
|---|---|---|
| First morning (no shortlist rows and no applications) | Nori is still finding your first jobs | They'll be here as soon as they're in. |
| Nothing new | Nothing new today | Nori checks again overnight. |
| All handled | That's today done | 3 sent. Nori checks for more overnight. |
| The API can't be reached | Couldn't reach Norinote | Check your connection; this page tries again by itself. **Try again** |

Signed out (401 anywhere): `/signin?next=<this page>`. Onboarding not finished: `/onboarding`.

## 10. Nori

An `app` controller in `NoriStage` for the `(app)` routes, using `lib/seat-nori.ts` with the seat
`data-nori-seat="rail"` (the rail's foot) from 1024 px, and `data-nori-seat="strip"` (the greeting strip's bottom-right
corner) below. It sits again whenever the page content above the seat changes height.
It plays the agent events nori-pet was made for, for the application the panel shows, once per status change:

| When | Event |
|---|---|
| New shortlist rows since the last visit | `shortlist-ready` with "3 jobs fit you today." |
| Status changes | `preparing`, `prepared`, `applying`, `submitting`, `awaiting-code`, `code`, `submitted`, `needs-user`, `captcha`, `failed` |
| The cap reached | `cap-reached` |
| Evening, nothing waiting, all handled | `sleep`, after 20 s idle |

Rows are prefetched after the page settles; the ones for the panel's current status first. No other bubbles: the
panel says the details.

## 11. Accessibility

On top of the landing and auth rules:
- Landmarks: the rail is `nav` ("Dashboard"), Today is `main`, the panel is `aside` (desktop) or a modal `dialog`
  (phones). One `h1` (the greeting); the list header and panel title are `h2`.
- Each card is a list item; the title button's name includes the company and fit ("Product designer at Fernway, fit
  0.86"); **Apply** says which job ("Apply to Product designer at Fernway").
- Status changes are announced once; timers aren't.
- The theme switch is a radio group with a visible label; the system choice is described ("Follows your device").
- Every target is at least 44 px (24 px minimum in text).

## 12. Performance

- `/today` is a static shell; its data comes from the API after load, with skeleton cards (fixed heights, so no shift).
- LCP: the greeting or the strip. Under 2.0 s on 4G; CLS under 0.05; under 450 KB before the first interaction.
- Polling is paused while hidden, and a request already in flight is never doubled.
- Our own JavaScript for the shell and Today under 35 KB gzip.

## 13. Copy

| Place | Words |
|---|---|
| Greeting | Good morning, Alex · Good afternoon, Alex · Good evening, Alex |
| Day line | 3 for today · 1 needs you · 2 of 5 sent today |
| Widened | Showing similar roles while Nori looks for more |
| Card | Apply · Not for me · Watch |
| Toast | Hidden from today. Undo |
| Ready | Ready to send. Check the resume and answers, then send it. Nothing goes out until you do. · Send it |
| Needs you | Nori needs 2 answers to finish this one. · Send answers |
| Wall | This site asked for a captcha. Nori never gets around those; finish it yourself and Nori will pick up the reply. · Open the application page |
| Failed | The API's words, then: Nothing was sent. · Try again |
| Sent | Sent in 18 seconds · View the application |
| Cap | Sent today · 2 of 5 · Nori asks before every send |
| Banner | Confirm your email so employers' replies reach you. · Send it again |

## 14. Still open

- What "Send all" does under autopilot (part 4c decides the cap and autopilot).
- Placeholders for Applications, Inbox and You until 4b and 4c.

## 15. Build checklist

Each phase ends with lint, type check and a look at 390 and 1440. Commit only with an explicit go.

### Phase 1: theme and scene
- [x] Night Dawn tokens on `.app-theme` (the dashboard only), the switch (System, Light, Dark) in the account menu,
  set before first paint by an inline script in the root layout (`data-app-theme`). The two dark tints pass: ink on
  `danger-tint` 13.1:1, `accent` on `accent-tint` 6.2:1.
- [x] `build.mjs` picks `night` (take `night-1`, a 4:1 strip; 30 KB AVIF at its widest); light reuses `footer`.

### Phase 2: shell
- [x] `components/app/AppShell.tsx`: rail, icon rail, top bar and tabs, the Today count and "needs you" dot, the cap
  meter, the account menu (theme, sign-out), the email banner with resend, Nori's rail seat, and the panel's slot.
  `/today`, placeholders for `/applications`, `/inbox`, `/you`; `/dashboard` redirects (`next.config.ts`). The session
  and onboarding guards.

### Phase 3: Today and the live panel
- [x] `components/app/Today.tsx` and `LivePanel.tsx`, with `lib/use-polling.ts` (2 s while moving, 30 s otherwise,
  paused while hidden): every state in sections 7 to 9, Send all with the switcher, the delayed dismiss and Undo.

### Phase 4: Nori
- [x] `startAppNori` in `lib/seat-nori.ts` (seats `rail` and `strip`); the panel and Today ask for the agent events.
  The seat controller is now loaded only on the pages that use it, and sits Nori again when the content above changes.

### Phase 5: QA
- [x] `tests/qa-today.mjs` (`npm run qa:today`): 420 checks in Chromium, Firefox and WebKit, light and dark, with the
  API mocked as a state machine, and a real run against a local API (sign up, onboard, land on Today; no worker, so the
  first morning shows). Applying for real needs the worker and is left to a person with it running.
- [x] Budgets: LCP 1.0 to 1.1 s (the strip), CLS 0.002 to 0.004, 401 KB before the first interaction.
- [x] On the same build: auth 730 of 730, onboarding 852 of 852, landing 184 of 184 once its first-screen budget was
  raised from 500 to 510 KB by decision (it measured 501 KB; landing spec section 13 says why).

What QA changed:
- **The account menu opened over Nori's seat.** It opens beside the rail now.
- **Visible text and accessible names didn't match** (rail counts, the card title button). The names are the visible
  text, with the fit score added for screen readers.
- **`aside` can't be a dialog.** The panel is a `div` with the dialog role.
- **On phones Nori stood over the greeting.** It stands inside the strip's corner, and the strip is taller below 1024.
- **Card chips lagged the panel.** Today checks applications every 4 s while one is moving.
- **Geist Mono on the first screen** (fit scores, counts): 70 KB, which took Today to 471 KB. Now Geist with tabular
  figures (section 4).
- **The weight check read 0 KB** under the test's fixed clock; it now runs on the real clock and fails on 0.
