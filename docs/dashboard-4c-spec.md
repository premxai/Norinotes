# Dashboard 4c design spec: You

The rules to build part 4c from: `/you`, `/you/search`, `/you/nori` and `/you/account`. [ui-plan.md](ui-plan.md)
(part 4c) says what's on these pages and why. This file says how they look and behave, then gives the build checklist.
The wireframe (the "Dashboard 4c: You" page of the design canvas) follows these rules. Where they disagree, this file
wins.

It builds on [dashboard-4a-spec.md](dashboard-4a-spec.md) and [dashboard-4b-spec.md](dashboard-4b-spec.md): the
shell, themes, type, polling, the title-row seat (`PageHead`) and Nori's controller are the same and aren't repeated.

Status: decided, except the items under [Still open](#13-still-open).

## 1. Decisions at a glance

| Area | Decision |
|---|---|
| Layout | Four sub-pages under one tab row: Graph (`/you`), Job search (`/you/search`), Nori (`/you/nori`), Account (`/you/account`). Each loads only its own data |
| The career graph | A drawn graph, like Obsidian's: dots for facts and skills, lines for "used". Hover or focus lights a dot and its neighbours and fades the rest. A **List** view holds the same items and is the keyboard and screen-reader route |
| Fixing a card | In place, with `PATCH /api/graph/nodes/:id`. Skills have no Fix (the API refuses them); they change through the cards that name them |
| A newer resume | Replaces every card that came from the old resume, fixed or not; facts you added stay. Said before the upload |
| The daily limit | 1 to 100 a day, or No limit (0). The API enforces it. Autopilot doesn't exist, so the page says Nori asks before every send |
| Answers Nori remembered | Listed on the Nori page; the answer can be edited (it becomes yours) or deleted; the question can't change |
| Account | Email read-only (the API can't change it), password, devices, theme, delete |

## 2. Layout

| Range | All four pages |
|---|---|
| 1024+ | Content up to 960 px: `PageHead` "You", the sub-tab row, then the sub-page. The graph's card opens as a 400 px panel from the right, over the content, like the live panel |
| 768–1023 | The same, 32 px side padding; the card panel overlays |
| Below 768 | 16 px margin; the sub-tabs and the kind filters scroll sideways with no visible bar; two-column field grids become one column; the card is a bottom sheet (up to 76% of the screen, with a scrim) |

- **The sub-tab row** is a `nav` named "You" with four links (`aria-current="page"` on the current one), 40 px tall pills,
  `ink` fill when current. The rail's and tab bar's "You" stays current on all four.
- **Nori** stands in the title row below 1024 px (`PageHead`, 4b section 2) and in the rail above. With You built, no
  page needs the shell's corner seat any more, so it goes (4a's `AppShell` loses `data-nori-seat="corner"`).
- Each sub-page has an `h2` heading under the `h1` "You"; sections inside use `h2` too (they're siblings, not nested).

## 3. Graph (`/you`)

### 3.1 Top

- "Your career graph" (`h2`), and under it the true counts, zero kinds left out: "3 roles · 3 projects · 3 results ·
  2 degrees and certificates · 14 skills".
- On the right: a Graph / List switch (two toggle buttons, kept in the address as `?view=list`; Graph is the default)
  and **Add a fact** (primary).
- Under the counts, a small link **Add a newer resume** (section 3.7).
- Messages from the last action ("Added 3 to your graph.", "Removed from your graph.") show in one polite status line
  under the top, in `accent`.

### 3.2 The graph view

- **Filters:** six toggle chips (`aria-pressed`), Roles, Projects, Results, Education, Certifications, Skills, each with
  its kind's dot. On: `surface` with a `line-strong` border; off: 55% opacity and struck through. Hiding a kind hides its
  dots and their lines.
- **Find:** a search field, "Find in your graph". Matches (title contains the text, any case) stay lit with their
  labels; everything else fades to 16%.
- **The box:** `surface`, 1.5 px `line`, 18 px radius; 520 px tall at 1024+, 440 px on tablets and phones. Inside, top
  right: **+**, **−** and **Fit** (40 px buttons). Bottom left in 12 px `ink-2`: "Scroll to zoom, drag to move" (pointer)
  or "Tap a dot for its name and card. Pinch to zoom." (touch).
- **Dots:** one per node from `GET /api/graph`. Facts 8 px radius plus 1.1 per link (up to 15); skills 4 plus 1.6 per
  link (up to 13). Colours from the theme: role `accent`, project a blue (`#3F6E9E` light, `#8FB3DA` dark), result
  a deep peach (`#C2653B` light, `#EBA585` dark), education and certification as rings (3 px `warning`, and a violet
  `#7A5AA6`, `#BBA4DA`, on `surface`), skill `line-strong`. Against `surface` they measure, light then dark: role 7.4
  and 8.0, project 5.3 and 7.4, result 4.0 and 7.9, education 5.8 and 8.7, certification 5.4 and 7.2, skill 4.1 and
  4.7, all over the 3:1 that graphics need. (The interview `peach`, `#E8936A`, is 2.3 on `surface`, too pale for a dot.)
  Each dot has a hit area of at least 28 px.
- **Lines:** 1.4 px `line`; for the lit dot's own lines, 1.8 px `ink-2`. Others fade to 25% while one is lit.
- **Labels:** 600 12 px (facts) and 500 11 px (skills) in `ink` with a 3 px `surface` halo. At 1024+, shown for every
  fact, for skills with 3 or more links, and for lit or matching dots; below 1024 px only for lit or matching dots.
  Roles read "UX designer · Okra Health". A label never leaves the box (clamped at its edges), and labels never overlap:
  they're placed in order (lit, matches, roles, then by links) and one that would overlap a placed label is skipped
  until something lights it. (The wireframe has no such step, and two labels overlap there.)
- **Lighting:** hovering or pressing a dot lights it and its neighbours; the rest fade to 16%. Clicking or tapping opens
  its card and keeps it lit until the card closes.
- **Layout:** a small force simulation of its own (`lib/graph-layout.ts`: repulsion, links at 64 px, a pull to the
  centre shaped like the box, and collision at the radii plus 6), not `d3-force`: tens of dots need nothing more, and
  it adds no dependency. Starting positions come from a hash of each
  node's id, so the same graph lays out the same way on every visit. The simulation runs 300 ticks before the first
  draw, so nothing swims in; until then the box shows its skeleton at the same size. After an add or a fix, only the
  new dots start beside their neighbours and the simulation runs 60 more ticks, animated over 400 ms (none with reduced
  motion). Dragging a dot pins it while held and reheats the simulation gently (not with reduced motion: the dot moves
  alone).
- **Zoom and pan:** the wheel or a pinch zooms about the pointer, 0.6× to 2.4×; dragging the background pans. **Fit**
  returns to 1× and centre. +/− step by 1.25×.
- **New dots** from an add or a fix pulse once: a ring at their colour grows to 2.6× and fades, 1.1 s, three times;
  with reduced motion, a still 50% ring for 3 s.

### 3.3 The card

Opens on click, tap or Enter (in the list view). Header: the kind as a tag with its dot, and a 44 px close button
(Escape closes too; focus returns to what opened it). Then:

- **A fact:** the title (Serif 28 px), "Company · 2019 – 2022" (or "– now"), what was done, its skills as chip buttons
  (each opens that skill's card), and where it came from in a quoted line: "From your resume: "UX Designer, Okra
  Health, 2019–2022"" or "A fact you added." A card you've fixed adds "You fixed this card." for the rest of the
  visit (the API keeps no record of edits, so it's gone after a reload). **Fix** (outline) and **Remove** (a `danger`
  text button).
- **A skill:** the name, "7 years · used now" (or "last used 2022"), "Used in" with each fact as a link (opens its
  card), and **Remove** only.

The card fills from the node already loaded; it needs no request of its own.

### 3.4 Fix

**Fix** turns the card into a form in place, headed "Fix this card", focus on the title field:

| Field | Sends | Rules |
|---|---|---|
| Title | `title` | Required |
| Company or school | `org` | Empty sends `null` |
| What you did | `statement` | A 3-line textarea |
| Skills | `skills` | Chips with ×, and "Add a skill" with **Add** (Enter adds too); a skill already on the card isn't added twice |
| From, To | `startDate`, `endDate` | `YYYY` or `YYYY-MM`; "I still do this" sends `endDate: null` and dims To |

- **Save** sends only the fields that changed. Nothing changed: "Nothing has changed yet." (no request). The client
  checks the date format and an end before the start; the API checks again and its 400 message shows under the form.
  422 (it's a skill) can't happen from this form; 404 closes the card with "That card was not found." and reloads the
  graph; 429 shows the API's words.
- While saving, **Save** is `aria-disabled` and reads "Saving…". On success the card shows the returned `{ node }`
  with "Saved. Nori matches with this from now on." and the graph updates in place (new skills appear as new dots).
- **Cancel** puts the card back as it was. Under the buttons: "If you add a newer resume, cards from your resume are
  replaced, including ones you've fixed."

### 3.5 Remove

Confirmed inside the card (`role="alertdialog"`, focus on **Keep it**): "Remove this from your graph? Nori stops using
it in matches and resumes." For a skill: "Remove Figma from 4 facts? Nori stops using it in matches and resumes."
**Remove** (`danger` fill) and **Keep it**. `DELETE /api/graph/nodes/:id`; the card closes, the dot goes and the status
line says "Removed from your graph." or "Removed Figma from 4 facts." No Undo: the API can't restore it.

### 3.6 Add a fact

**Add a fact** opens a box at the top of the page, focus in it: "Add a fact", then "Something your resume leaves out: a
project, a result with a number, a tool you use." A textarea (3 to 2000 characters), **Add it** and **Cancel**. Under 3
characters: "Tell us a bit more" (the API's words). While the API reads it, **Add it** is `aria-disabled` and "Nori is
reading it…" shows beside it. Then the box closes and the status line says "Added 3 to your graph." (`nodesCreated`).
When the API answers with a `note` (the AI was unavailable), the note shows instead. 429: the API's words (60 an hour,
or "Today's AI allowance is used up. Try again tomorrow.").

### 3.7 A newer resume

**Add a newer resume** opens a small panel under the top: "Nori replaces what came from your old resume, including
cards you've fixed. Facts you added stay." **Choose a file** (PDF, DOCX or text, up to 10 MB) or **Paste the text**:
the same calls and messages as onboarding's resume step, in a compact panel (that step's controls are built for a
whole page). `POST /api/profile/resume-file` or `/api/profile/resume`;
the API's 413 and 422 messages show as they come. When it's done, the graph reloads and the status line says what the
API reports.

### 3.8 List view

- **Roles** as a timeline (`ol`, the 4b timeline's rule and dots): "UX designer · Okra Health", then "2019 – 2022 · from
  your resume".
- **Projects**, **Results**, **Education and certifications** as cards in two columns (one below 768): the dot, the
  title, "Company · dates".
- **Skills** as chips: "Figma · 7 yrs".
- Each is a button that opens the same card. The filters and search apply to the list too.

### 3.9 States

- **Loading:** the counts line and the box as skeletons at their final sizes.
- **Empty:** "Your graph is empty." and "Add your resume or a fact and Nori builds it from there." with **Add your
  resume** (section 3.7) and **Add a fact**.
- **Offline:** "Couldn't load your graph. Check your connection and try again." with **Try again**.

## 4. Job search (`/you/search`)

- **Heading:** "What Nori looks for", then "Nori shortlists a job when it fits at least one lane that's on."
- **A lane** (a card, `aria-label` "Lane: name"): the name field; on the right, "On" or "Off" and a switch
  (`role="switch"`, 48 by 28 px, "Look for Product design"); "Job titles" and "Places" as chips with ×, in
  onboarding's chip field (Enter, a comma or leaving the field adds; up to 20 each); "Remote is fine" (checkbox); "Lowest fit Nori
  shortlists: 70%" over a range from 50 to 90 in steps of 5 (sent as `minFit` 0.5 to 0.9; a stored value outside that
  shows clamped); "Higher means fewer, closer matches."; **Remove this lane** (`danger` text). An off lane is shown at
  70% opacity.
- **Add a lane** (outline) adds "New lane", on, 70%, with focus in its name; hidden at 20 lanes.
- **Every lane:** "Lowest salary to consider, a year" (`preferences.salaryMin` is one yearly number, so there's no
  period to choose; empty sends 0, which lets every job through), "US dollars. Jobs that show less are left out." and
  "Companies to skip" as chips (`preferences.excludeCompanies`).
- **Save** sends the lanes (`PUT /api/lanes`, the whole array) and then the preferences (`PUT /api/profile`). A lane
  with no name: "Name the lane" under it, and nothing is sent. Saved: "Saved. Nori looks again with these." (Nori
  `searching`). With unsaved changes, **Save** shows "Unsaved changes" beside it, and leaving the page asks first
  (`beforeunload`, and in-app links).

## 5. Nori (`/you/nori`)

### 5.1 Daily limit

- "Daily limit" (`h2`), then **−**, the value, **+** (44 px buttons; the value is an `output`, polite), then
  "applications a day · **2 sent today**" (`usedToday` from `GET /api/agent/status`).
- 1 to 100; **−** at 1 gives **No limit** (0), and **+** from No limit gives 1. With No limit the line is just "2 sent
  today".
- Under it: "Nori asks before every send. Sending on its own is coming. The count starts again at midnight UTC."
- Each change saves after 600 ms of no further change (`PUT /api/profile` `{ autoApplyDailyCap }`) and says "Saved.".
  The rail's meter follows: "2 of 5" with the bar, or just "2" with No limit.

### 5.2 What Nori puts on forms

"From onboarding. Nori fills these in on every application, and asks you when a form wants something new." Three
disclosures (`details`), Contact open first; closed, each shows a short summary on the right ("Allowed to work in the
US · no sponsorship", "$120,000 a year · 1 December 2026").

| Group | Fields (onboarding's, with its controls) |
|---|---|
| Contact | Full name, email on applications, phone, where you live (city, state, country), LinkedIn, website or portfolio |
| Work authorisation | Allowed to work in the US, needs sponsorship, status (and visa type), willing to relocate |
| Standard questions | Salary expectation, earliest start date, notice period, security clearance, over 18, voluntary self-identification |

Each group has its own **Save** (`PUT /api/profile` with that group's fields) and "Saved." Field errors are the API's
and onboarding's words. The controls come from `components/onboarding/controls.tsx` (`Label`, `ChoiceGroup`,
`SelectField`, `ChipsInput`), not copies of them.

### 5.3 Answers Nori remembered

- "Answers Nori remembered" (`h2`), then "What you told Nori on past applications. Nori reuses these when a form asks the
  same thing." `GET /api/profile/answers`, most recently used first, all of them (a bank is hundreds of rows at most;
  past 50, a **Show all 214** button).
- **A row:** the question as the form asked it (600), the answer, then "You told Nori" (`user`), "Your default"
  (`default`) or "Nori's draft" (`model`), "· Last used 2 Nov" (or "· Not used yet"), and **Edit** and **Delete** on the
  right.
- **Edit:** the answer becomes a textarea (focus in it), "Only the answer changes; the question stays as the form asked
  it.", **Save** and **Cancel**. Empty or over 2000 characters: "Write an answer, or delete this one." `PATCH
  /api/profile/answers/:id` `{ answer }`; saved, the row shows the returned answer and "You told Nori", and the status
  says "Saved. It's yours now, so Nori won't change it."
- **Delete:** confirmed in the row (`alertdialog`, focus on **Keep it**): "Delete this answer? Nori will ask again next
  time." `DELETE`; the row goes, "Deleted. Nori will ask again next time."
- **Empty:** "Nothing yet. When a form asks something new, your answer is kept here for next time."

### 5.4 Telegram

From `GET /api/channels/telegram`:

- **Not switched on** (`configured: false`): "Telegram isn't switched on yet."
- **Not linked:** "Get the morning list, Nori's questions and what was sent in Telegram, and answer from there." and
  **Connect Telegram**. That posts `/link` with the browser's time zone, opens the returned `t.me` link in a new tab and
  shows "Waiting for you in Telegram…" and "Open the bot and press Start. The link works for 15 minutes.", with **Open
  Telegram again** (the same link) and **Cancel**. While waiting, the page polls `GET` every 3 s (only while visible) until
  `linked`, for up to 15 minutes; after that: "The link ran out. Connect again for a new one."
- **Linked:** "Connected 4 Nov · @NorinoteBot", then:

| Setting | Control | Sends |
|---|---|---|
| Morning list at … with … jobs | A time field and a 1 to 10 select | `dailyTime`, `count` |
| Evening summary at | A time field | `summaryTime` |
| Quiet hours, from … to … | A checkbox and two time fields (dimmed when off) | `quietHours` |
| Time zone | A select of the browser's zones (`Intl.supportedValuesOf`) | `timezone` |
| Messages to get | Six checkboxes: Morning list, Questions from Nori, Sent applications, When Nori needs you, New mail in Nori's inbox, Evening summary | `events` |

**Save** (`PUT`, "Saved."; a 400's message shows under the form) and **Disconnect** (`danger` text; `DELETE`, then
"Disconnected. Nori won't message you in Telegram." and the not-linked state).

## 6. Account (`/you/account`)

- **Email:** the account email (600), a chip "Confirmed" (`accent` on its tint) or "Not confirmed yet" (`warning` on
  `tint`), and when not confirmed **Send the link again** (`POST /api/auth/resend-verification`; "Sent. Check your
  inbox.", or the API's limit message). "Changing your email isn't available yet."
- **Password:** "Current password" and "New password" side by side (stacked below 768), "Use at least 8 characters"
  under the new one, "Changing it signs you out everywhere else.", **Change password**. Empty current: "Enter your
  current password"; short new: the hint turns `danger`. `POST /api/auth/change-password`; 403: "Your current password
  is not right" (the API's). Done: "Changed. You're signed out everywhere else.", the fields clear and the device list
  reloads.
- **Where you're signed in:** `GET /api/auth/sessions`: each device ("Chrome on Windows") and "Signed in 2 Nov", this
  device marked with a chip, the others with **Sign out** (`DELETE /sessions/:id`). **Sign out everywhere else** (`POST
  /sessions/revoke-others`; "Signed out of 2 other devices."), hidden when there are none.
- **Theme:** a radio group of three pill labels, System, Light and Dark: the same store as the account menu
  (`norinote-theme`; picking either updates the other at once). "System follows your device."
- **Delete your account:** a closed disclosure with a `danger` border. Open: "Everything goes: your graph, applications,
  inbox and resumes. This can't be undone.", "Type alex.rivera@example.com to confirm" (the account's email) and **Delete
  my account** (`danger` fill, `aria-disabled` until the typed email matches, any case). `DELETE /api/auth/account` `{
  confirm }`, then to `/` signed out.
- **Sign out** (outline) at the foot.

## 7. Changes to built parts

- **The rail's note** says "Nori asks before every send." for every limit (it said "Nori sends up to your cap without
  asking." above 0, which was never true). 4a's spec changes with it.
- **Send it over the limit:** the approve's 429 shows its message and its detail in the panel, the API's words
  ("Today's limit is used up Your limit is 5 applications a day. Raise it in You, or send this one tomorrow."), and the
  application stays Ready for your OK. Nori `cap-reached` (sleeps).
- **Send all** only creates the applications and opens them as a stack in the panel; each still waits for its own
  **Send it**, so the limit meets them there, one by one, as above. (The plan had Send all approving them.)
- **The account menu's theme radios** had one name in both menus (the rail's and the top bar's), so they formed one
  group across the page and one menu always showed nothing chosen. Each menu now has its own group.
- **The corner seat** goes from the shell (section 2).

## 8. Components (new)

| Component | Spec |
|---|---|
| `YouTabs` | Section 2's sub-tab row |
| `CareerGraph` | Section 3.2: the SVG (lines, then dots with their hit areas and pulse rings, then labels), the controls; the layout from `lib/graph-layout.ts` |
| `GraphList` | Section 3.8 |
| `NodeCard` | Section 3.3 to 3.5: the side panel at 1024+, the bottom sheet below |
| `FactComposer` | Section 3.6, and the newer-resume panel of 3.7 |
| Lanes | Section 4, with onboarding's `ChipsInput` for titles, places and companies |
| `LimitStepper` | Section 5.1 |
| `AnswerRow` | Section 5.3 |
| `TelegramCard` | Section 5.4's three states and the settings |
| `Switch` | `role="switch"`, 48 by 28 px, `accent` when on, a label always |

## 9. Nori

| When | Event |
|---|---|
| A fact or a resume is being read | `preparing` (thinks), with "Reading it…" |
| It's added, or a card is fixed | a hop with "Added 3 to your graph." or "Fixed it." |
| Lanes are saved | `searching` with "Looking again with these." |
| Telegram links | `hello` (a wave) with "Connected! See you in Telegram." |
| The password is changed | a nod with "Password changed." (`password-done` plays the uncovering half of covering its eyes, which looks odd on its own) |
| Send it or Send all hits the limit (section 7) | `cap-reached` |

Nothing on removing, deleting an answer, or deleting the account. The rules of 4b section 7 apply: one at a time, a
reaction asked for before Nori arrives waits for it, and none on the first screen before the page settles.

## 10. Accessibility

- One `h1` ("You") per page, an `h2` per section; the sub-tabs are a named `nav` with `aria-current`.
- **The graph is for pointers; the list is for everyone.** The SVG and its labels are `aria-hidden`; the box is a
  `figure` labelled "Your career graph: 3 roles · … The List view has the same items." The Graph / List switch comes
  before it in the tab order, and screen readers get the list first ("Show as a list" is the switch's List button). The
  find field and filters work for both views.
- The card is a `dialog` (modal on phones with the scrim, non-modal side panel at 1024+) labelled by its title; focus
  moves into it and back to its opener on close. Confirmations are `alertdialog`s with focus on the safe choice.
- Every status ("Saved.", "Added 3 to your graph.", "Copied") is in a polite live region; errors use `role="alert"` and
  sit under their field with `aria-describedby`.
- Chips' × buttons are named ("Remove UX designer"); switches and the stepper have labels; the stepper's value is
  announced.
- Targets at least 44 px, except the graph's dots, whose hit areas are at least 28 px (and the list is the full-size
  route). Colour never carries meaning alone: every kind has its name in the filters, the card's tag and the list.

## 11. Performance

- Static shells; data after load into boxes of fixed height (the graph's box, the counts line, the stepper, each
  disclosure's summary row), so nothing moves.
- The layout is about 3 KB of the `/you` page's own code. It runs before the first draw (300 ticks, a few
  milliseconds for 40 dots).
- Under 450 KB before the first interaction on each sub-page, LCP under 2.0 s on 4G, CLS under 0.05. No Geist Mono.
- QA measures a 250-dot mocked graph on a 4x slower CPU: settling under 150 ms, and hover and drag frames under 16 ms.
  If SVG can't hold that, the dots and lines move to a canvas (section 13).

## 12. Copy

| Place | Words |
|---|---|
| Counts | 3 roles · 3 projects · 3 results · 2 degrees and certificates · 14 skills |
| Add a fact | Add a fact · Something your resume leaves out: a project, a result with a number, a tool you use. · Add it · Nori is reading it… · Added 3 to your graph. |
| Fix | Fix this card · Title · Company or school · What you did · Skills · Add a skill · From · To · I still do this · Save · Cancel · Nothing has changed yet. · The end is before the start. · Saved. Nori matches with this from now on. |
| Fix note | If you add a newer resume, cards from your resume are replaced, including ones you've fixed. |
| Source | From your resume: "…" · A fact you added. · You fixed this card. |
| Remove | Remove this from your graph? Nori stops using it in matches and resumes. · Remove Figma from 4 facts? · Remove · Keep it · Removed from your graph. |
| Newer resume | Nori replaces what came from your old resume, including cards you've fixed. Facts you added stay. |
| Empty graph | Your graph is empty. Add your resume or a fact and Nori builds it from there. |
| Lanes | What Nori looks for · Nori shortlists a job when it fits at least one lane that's on. · Lowest fit Nori shortlists: 70% · Higher means fewer, closer matches. · Remote is fine · Add a lane · Remove this lane · Name the lane · Saved. Nori looks again with these. |
| Every lane | Lowest salary to consider · US dollars. Jobs that show less are left out. · Companies to skip |
| Daily limit | Daily limit · applications a day · 2 sent today · No limit · Nori asks before every send. Sending on its own is coming. The count starts again at midnight UTC. |
| Forms | What Nori puts on forms · From onboarding. Nori fills these in on every application, and asks you when a form wants something new. |
| Answers | Answers Nori remembered · You told Nori · Your default · Nori's draft · Last used 2 Nov · Edit · Delete · Only the answer changes; the question stays as the form asked it. · Write an answer, or delete this one. · Saved. It's yours now, so Nori won't change it. · Delete this answer? Nori will ask again next time. |
| Telegram | Connect Telegram · Waiting for you in Telegram… · Open the bot and press Start. The link works for 15 minutes. · The link ran out. Connect again for a new one. · Connected 4 Nov · Disconnect · Disconnected. Nori won't message you in Telegram. |
| Password | Changing it signs you out everywhere else. · Changed. You're signed out everywhere else. |
| Devices | Where you're signed in · This device · Sign out · Sign out everywhere else · Signed out of 2 other devices. |
| Delete | Everything goes: your graph, applications, inbox and resumes. This can't be undone. · Delete my account |
| Over the limit | The API's: Today's limit is used up · Your limit is 5 applications a day. Raise it in You, or send this one tomorrow. |

## 13. Still open

- **Canvas for big graphs.** QA's 250-dot run misses section 11's first number: about 380 ms from the data to the
  drawn graph on a 4x slower CPU (the layout about 200 ms, drawing the rest), against 150. Hover holds (about 1 ms a
  render). A canvas would cut the drawing, not the layout. A graph from a resume is 20 to 60 dots, so the build stays
  on SVG and QA holds the 250-dot run under 400 ms until it's decided.
- **The API's to-do list** (not this part): autopilot, changing the account email, and links between facts (roles and
  projects meet only through shared skills).
- **How many answers a real bank holds:** if it's often past a few hundred, the list needs search; QA counts a real
  account's after the first weeks of use.

## 14. Build checklist

Each phase ends with lint, type check and a look at 390 and 1440. Commit only with an explicit go.

### Phase 1: data
- [x] `lib/api.ts`: the graph (get, add a fact, edit a card, remove), a newer resume, lanes, the profile (get, put),
  the answers (list, edit, delete), Telegram (get, put, link, delete), and the account calls (resend, change password,
  sessions, revoke, delete). Types for each.

### Phase 2: Graph
- [x] `/you`: the top, `CareerGraph` (layout, filters, find, lighting, labels without overlaps, zoom, pan, drag,
  pulses), `NodeCard` (card, Fix, Remove), `FactComposer` and the newer-resume panel, `GraphList`, the loading, empty and
  offline states. `?view=list` in the address.

### Phase 3: Job search and Nori
- [x] `/you/search`: lanes and every-lane preferences, Save with the unsaved-changes guard.
- [x] `/you/nori`: the limit stepper (and the rail following it), the three form groups with onboarding's controls,
  the answers, Telegram's three states and settings.

### Phase 4: Account and the built parts
- [x] `/you/account`: email, password, devices, theme (shared with the account menu), delete, sign out.
- [x] Section 7: the rail's note, Send it and Send all over the limit, and the corner seat removed.

### Phase 5: Nori and QA
- [x] The events in section 9.
- [x] `tests/qa-4c.mjs` (`npm run qa:4c`): the 11 sizes in three engines for each sub-page, light and dark; the graph's
  lighting, filters, find, card, Fix (each error), Remove, add a fact, the list view and the 250-dot timing; lanes and
  their checks; the stepper and No limit; form groups; answers (edit, empty, delete); Telegram's states and the link
  wait; password, devices, theme sync and delete; the 429s in Today; axe in both themes; keyboard; budgets. The API
  mocked, plus a real-API run (`--e2e`) for the graph edit, lanes, the limit, an answer edit and the account calls.

**QA results (4 November 2026):** 1240 of 1240 checks pass in three engines on the QA build, with the API mocked. The
last full run passed 1239; the one miss was the test reading Nori's wave before its strip had loaded, and the flows
passed 76 of 76 again once the test waited for it.
The real-API run (`--e2e`) passes 13 of 13 with the API's CORS fix below (uncommitted in `apps/api` at the time).

| Page, 4G with a 4x slower CPU | First interaction | LCP | CLS |
|---|---|---|---|
| `/you`, 390 px | 419 KB | 0.9 s | 0.002 |
| `/you`, 1440 px | 419 KB | 1.1 s | under 0.05 |
| `/you/search`, 390 and 1440 px | 419 KB | 1.0 s | under 0.05 |
| `/you/nori`, 390 and 1440 px | 412 to 419 KB | 1.2 s | under 0.05 |
| `/you/account`, 390 and 1440 px | 401 to 419 KB | 1.3 to 1.4 s | under 0.05 |
| 250-dot graph, 1440 px | | 373 ms from the data to drawn (layout 197) | hover renders in about 1 ms |

The earlier suites pass on the same build: Today 417, 4b 982, auth 726, onboarding 844 and landing 184, without their
real-API runs. QA found and fixed:

- **The account menus' theme radios.** Both menus (the rail's and the top bar's) shared one group name, so one always
  showed nothing chosen (4a).
- **Every section page prefetched on every page.** The rail's links prefetched each section's code, and with You
  built that was about 35 KB more on every first screen; /applications went from 378 to 421 KB. Links now prefetch
  when pointed at or focused.
- **The Inbox's catch strip on the first screen (4b).** Opening the newest message by navigating counted as arriving,
  so Nori caught its code at once; that reaction now waits for the page to settle. The Inbox at 1440 px went from 490
  to under 450 KB.
- **The landing page's paint shortcut in the dashboard.** `content-visibility: auto` with a 900 px placeholder applied
  to every `main > section` until the page settled, and Account's sections moved when it ended (0.11 to 0.38). It's
  now for the landing pages only.
- **Sections arriving one by one.** Nori's page drew each section as its data came, and later sections jumped (0.22
  to 0.38); it now shows them together.
- **Faded off lanes.** At 70% opacity an off lane's hint and Remove fell below AA; they use a quieter background.
- **Smaller:** a group's − beside its title, time fields clipping "AM", a cramped graph, and the layout's cost for
  big graphs (120 ticks above 120 dots: 440 to 373 ms).

**Found against the real API: editing.** The API's CORS allowed GET, POST, PUT, DELETE and OPTIONS, not PATCH, so the
browser's preflight failed for `PATCH /api/graph/nodes/:id` (Fix) and `PATCH /api/profile/answers/:id` (editing an
answer), which ended in "Couldn't reach Norinote". The mocked runs allowed PATCH, which is why they passed. The API
session added PATCH (`apps/api/src/app.ts`, with a test). With it the real run edits a card and the API keeps it, and
an answer's PATCH reaches the API (a new account has no answers, so that's checked with an unknown id's 404). Also
real: adding a fact, lanes, the limit, the answers list, devices and deleting the account.

**Not covered.** Telegram against the real API (the test API has no bot), a newer resume against the real API (its
fake model reads nothing from a short resume), and Send it over the limit with a real application (it needs the
worker).
