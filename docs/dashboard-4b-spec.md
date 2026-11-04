# Dashboard 4b design spec: Applications and Inbox

The rules to build part 4b from: `/applications`, `/applications/:id` and `/inbox`. [ui-plan.md](ui-plan.md) (part 4b)
says what's on these pages and why. This file says how they look and behave, then gives the build checklist. The
wireframe (the "Dashboard 4b: Applications and Inbox" page of the design canvas) follows these rules. Where they
disagree, this file wins.

It builds on [dashboard-4a-spec.md](dashboard-4a-spec.md): the shell, themes, type, polling, the live panel's states and
Nori's controller are the same and aren't repeated.

Status: decided, except the items under [Still open](#11-still-open).

## 1. Decisions at a glance

| Area | Decision |
|---|---|
| Applications | A list with filter tabs and counts, a week strip and honest numbers above it; each row opens `/applications/:id` |
| One application | Header, **What happened?** (mark an outcome by hand, undoable), a timeline, the resume sent, the receipt; the live panel's content while it's still moving |
| Inbox | A list and a reading pane from 1024 px; the message on its own page (`/inbox/:id`) below that; the address and settings at the top |
| Results | Rates only with 5 or more settled applications (the API's rule); counts otherwise |
| New mail | "New" means received since your last visit to the Inbox, remembered in the browser (the API has no read flag) |

## 2. Layout

| Range | Applications | One application | Inbox |
|---|---|---|---|
| 1024+ | Content up to 960 px: title, week strip, numbers, tabs, the list | Content up to 960 px: header, What happened?, then two columns (timeline 1.2fr, resume and receipt 1fr) | A header band (title, address, Settings) across the content, then the list (380 px) and the reading pane side by side, each scrolling on its own |
| 768–1023 | The same, 32 px side padding | One column | The list only; a message opens `/inbox/:id` |
| Below 768 | 16 px margin; the tabs scroll sideways; the week strip in 7 narrow columns | One column; What happened? buttons in a 2 by 2 grid | The list; a message opens `/inbox/:id` with "‹ Inbox" |

The rail, tabs and Nori's seats are the shell's (4a section 2). These pages have no greeting strip, so below 1024 px
the title row (`PageHead`) is tall enough for Nori to stand at its right end, beside the title: 84 px with an 80 px Nori
on phones, 120 px with a 112 px Nori on tablets, and the title keeps 112 to 144 px clear on the right. The page starts
right under the top bar, so the row costs about 30 px on phones. A floating corner would cover the rows' chips (the
first build tried one, 8 px above the tabs; QA caught it covering "Reply" and "Rejected"). The shell keeps that corner
seat only as a fallback for pages with neither a strip nor a title row (You, until 4c).

## 3. Applications (`/applications`)

**Data:** `GET /api/applications` (30 s, 4 s while one is moving), `GET /api/outcomes/summary` (on load, and again once
outcomes change), and `GET /api/applications/:id/outcomes` for every sent application. The tab counts and the week
strip need all of them, not only the rows on screen. They're fetched newest first, at most 6 at once, and kept for the
visit (`lib/use-outcomes.ts`). An application's outcomes are fetched again when its `updatedAt` or its newest linked
message (from `GET /api/inbox`, 30 s) changes, and after a mark or an Undo. Until they've all loaded, the Sent, Replied
and Closed tabs show no count, and a sent row shows "Sent".

**State of a row**, first match wins:

| State | From | Chip |
|---|---|---|
| In progress | status `queued`, `preparing`, `applying`, `awaiting_code` | Applying |
| Needs you | `prepared`, `needs_user` | Needs you (`warning` text) |
| Didn't go through | `failed` | Didn't go through |
| Offer, Interview, Reply, Rejected | the outcomes' `state` (`offer`, `interview`, `reply`, `rejection`) | Offer / Interview / Reply (`accent` on `accent-tint`), Rejected (`danger-tint`) |
| No response | submitted 30 or more days ago with no outcome (`no_response`) | No response (`ink-2`) |
| Waiting | submitted, nothing yet | Waiting |

**Filter tabs:** All, In progress (Applying and Needs you), Sent (Waiting), Replied (Reply, Interview, Offer), Closed
(Rejected, No response, Didn't go through). Each shows its count; the choice is kept in the URL (`?show=replied`).

**A row:** a link the full width of the list (it goes to a page): the company logo or letter tile (4a section 6), title · company (600, 16 px), the line under it (14 px, `ink-2`), the
chip on the right. The line: "Applying now", "Nori needs 2 answers", "Replied in 1 day", "Interview invitation, 2 days
after sending", "Rejected after 1 day", "Sent 4 Nov · no answer in 30 days", or "Sent 4 Nov". Days are from
`submittedAt` to the first outcome. Newest first by `createdAt`.

**The week strip:** Monday to Sunday of the week shown; each day a button with its short name, date and up to 4 marks
(8 to 10 px dots): sent (`line-strong`), reply or offer (`accent`), interview (`peach`), rejection (`danger`). A legend
under it. Today has a 1.5 px `ink` outline. A day toggles a filter on the list ("Clear Wed 4 Nov" appears). ‹ and ›
move by a week; there's nothing beyond this week. Each day's name includes what happened for screen readers ("Wednesday
4 November: 2 sent, 1 interview").

**The numbers:** "7 sent · 3 replies · 1 interview" (sent = `overall.applications`, replies = `responses`, interviews =
`interviews`). With `smallSample` false: "Response rate 60% · Median 2 days to a first reply" (`responseRate`,
`medianDaysToFirstReply`). With it true: "Rates show once 5 applications have had an answer or 30 days."

**Empty:** "Nothing sent yet. Applications you send from Today show up here." with **Go to Today**.

## 4. One application (`/applications/:id`)

**Data:** `GET /api/applications/:id` (polled as in 4a section 7 while moving), `GET /api/applications/:id/outcomes`,
and `GET /api/inbox` filtered to this application.

- **Header:** "‹ All applications", the title (serif, 36 px desktop, 28 px phones), the company logo or letter tile with company · place · "sent 4 Nov", the
  state chip, and **Open the job posting** (`job.applyUrl`, a new tab).
- **Still moving or waiting on you:** the live panel's content for its status (4a section 7) sits under the header, so
  Send it, answers, Try again and walls work here too.
- **What happened?** Shown once it's submitted: Reply, Interview, Offer, Rejection as outline buttons;
  `POST /api/applications/:id/outcomes { kind }`. The new entry appears at the top of the timeline with **Undo**
  (`DELETE /:outcomeId`) for as long as the page is open. The note: "Replies that go to your own email don't reach
  Nori's inbox, so you can mark them here."
- **Timeline, newest first:** outcomes ("Interview", with "from Nori's inbox" or "marked by you"), linked inbox messages
  (subject, opening `/inbox/:id`), "Sent" with the time from approval, the run log's last 5 lines (folded under "Show
  everything Nori did"), "Ready for your OK", "Created from Today". A 2 px `line` rule with a coloured dot per entry.
- **The resume sent:** the tailored resume's changed lines (`resume.changes`: after, with its reason under it), "2 lines
  changed", the same marking as Today's panel.
- **The receipt:** "Confirmation FW-20931 · sent in 18 s"; "A practice run: nothing reached the employer" when
  `receipt.dryRun`; **See the screenshot** when `receipt.screenshotPath` is set (opens
  `${API}/api/artifacts/<path>`).
- **Not found** (404): "That application isn't here." with **All applications**.

## 5. Inbox (`/inbox`, `/inbox/:id`)

**Data:** `GET /api/inbox` (30 s), `GET /api/inbox/:id` for the open message, `GET /api/inbox/address` (once).

- **Header band:** "Inbox" (serif), "Your Nori inbox:" and the address (Geist 600) with **Copy** ("Copied" for 2 s).
  Not configured (`configured` false): "Nori's inbox isn't switched on yet. Codes and replies go to your own email for
  now." and no list.
- **Settings** (a `details`, folded): "Forward a copy to my email" (a checkbox), "My email" (an email field), "Keep
  messages for" (30, 90 or 365 days → `retentionDays`; the API keeps 1 to 365 days, and no choice means its default of
  90, so there's no "Forever"), **Save** (`PUT /api/inbox/settings`). Forwarding with no address is caught here ("Add
  the email to forward to."), because the API would quietly switch it off. Folded, the summary reads "Forwarding to … ·
  kept 30 days" or "Not forwarding · kept 90 days". The API's errors show under Save.
- **Filters:** All, Codes (`verification_code`), Replies (`recruiter_reply`, `interview`, `rejection`, `offer`).
- **A list item:** a button: sender name (or address), the time ("9:12", "Yesterday", "3 Nov"), the subject, the kind
  chip (Code, Confirmation, Reply, Interview, Rejection, Offer, Other) and the linked application ("Product designer ·
  Fernway"). New since the last visit: the sender and subject in 700 and a dot, and "New" for screen readers. Spam:
  "Spam" in place of the kind, `ink-2`.
- **The message:** subject (22 px), sender and full time; then, if there's a code, the code in Geist 600 32 px with tabular figures and
  letter spacing, **Copy** and "Nori already entered it" when its application moved on; a verification link as an
  outline button ("Confirm with the employer", a new tab); the body as plain text (`white-space: pre-line`, links
  shown but not followed automatically); attachments as a list of names; **Open the application** when linked.
- **Selection:** from 1024 px the newest message is open on arrival and the URL follows (`/inbox/:id`), so Back works.
- **Empty:** "Nothing here yet. Codes and replies from employers land here, and Nori uses them to finish applications."

## 6. Components (new)

| Component | Spec |
|---|---|
| `WeekStrip` | 7 day buttons in a grid (`repeat(7, minmax(0, 1fr))`, 6 px gap), the legend, ‹ › week buttons (44 px) |
| `ResultLine` | The counts in 600 18 px, the rates or the small-sample note under it in 14 to 15 px `ink-2` |
| `FilterTabs` | A `role="group"` of toggle buttons (`aria-pressed`), 40 px tall, `ink` fill when on; they scroll sideways on phones with no visible bar |
| `ApplicationRow` | Section 3 |
| `Timeline` | An `ol` with the rule and dots; each entry a title and a time; the newest marked entry has **Undo** |
| `MarkOutcome` | The four buttons and the note; while a mark is saving, the buttons are `aria-disabled` |
| `InboxList`, `MessageView`, `InboxSettings` | Section 5 |
| `CompanyLogo` | 4a section 6: the Brandfetch logo as a plain lazy `<img>`, or a letter tile in the same 36 or 40 px box, on rows and the application's header |
| `StateChip` | 24 to 26 px pill; the colours in section 3; always words, never colour alone |

## 7. Nori

| When | Event |
|---|---|
| A new outcome since the last visit (from the summary or a row): reply | `reply` (a wave) with "They replied!" |
| Interview or offer | `interview` / `offer` (celebrate, confetti) with "An interview!" / "An offer!" |
| Rejection | `rejection` (deflated, then comfort) with "On to the next one." |
| You mark one by hand | the same event, once |
| A message is open in the Inbox | `email-sent` (check-mail) |
| A message with a code is open | `code` (catch, then hold) |

A reaction asked for before Nori has arrived (data can load before the sprites) waits for it: the latest one asked
for in the 8 s before Nori sits plays when it does, in place of the greeting (`takePendingReaction` in
lib/auth-flow.ts). And on a page's first load, until it has settled (1.5 s after load, as for the greeting) or the
visitor clicks or presses a key, a reaction waits too (not when Nori arrives from another page of the app), the latest one only, so its sprite strip (about 70 KB) stays off the first screen:
the Inbox opening on a code was 476 KB with the catch strip, 405 KB without.

At most one per page load for the "since the last visit" ones: the most important (offer, interview, reply, rejection).
The last visit is kept in `localStorage` (`norinote-last-seen-outcomes`, `norinote-inbox-seen-at`).

## 8. Accessibility

- One `h1` per page. The week strip's days are buttons with full names; the list rows are buttons inside list items;
  the reading pane is a `region` named by the message's subject, and opening a message moves focus to its subject only
  on phones (where it's a new page).
- Copy buttons announce "Copied" in a polite live region.
- Marking an outcome announces "Marked as interview. Undo is available."
- Chips are words; the week strip's dots have text for screen readers; colour never carries meaning alone.
- Targets at least 44 px (the week days are 44 px tall at least; the tabs 40 px with 8 px gaps, which passes 2.5.8).

## 9. Performance

- The pages are static shells; data comes after load into boxes of fixed height, so nothing moves: the week strip is
  212 px at every width (its legend sits at the foot, so a wrapped legend at 360 px still fits), the numbers have a slot
  68 px tall on phones and 52 px from 768 (their tallest), the tabs 40 px, and rows 76 px with their line on one line
  (truncated). The skeleton has the same heights. (The first build shifted by 0.42 on phones: the summary arrived after
  the list and pushed it down.)
- Outcome requests: one per sent application, at most 6 at once, kept for the visit (section 3).
- Under 450 KB before the first interaction, LCP under 2.0 s on 4G, CLS under 0.05. No Geist Mono on 4b's pages at
  all: counts, rates, codes and confirmation numbers are Geist with tabular figures. With Mono for the address and the
  code, the Inbox was 466 KB.

## 10. Copy

| Place | Words |
|---|---|
| Numbers | 7 sent · 3 replies · 1 interview · Response rate 60% · Median 2 days to a first reply |
| Small sample | Rates show once 5 applications have had an answer or 30 days. |
| Empty list | Nothing sent yet. Applications you send from Today show up here. · Go to Today |
| Mark | What happened? · Reply · Interview · Offer · Rejection · Undo |
| Mark note | Replies that go to your own email don't reach Nori's inbox, so you can mark them here. |
| Receipt | Confirmation … · sent in 18 s · A practice run: nothing reached the employer. · See the screenshot |
| Inbox off | Nori's inbox isn't switched on yet. Codes and replies go to your own email for now. |
| Inbox empty | Nothing here yet. Codes and replies from employers land here, and Nori uses them to finish applications. |
| Settings | Forward a copy to my email · My email · Keep messages for · Save · Add the email to forward to. |

## 11. Still open

- **An API addition** (an `apps/api` task, not this part): the outcome state in `GET /api/applications`, so the list
  needs no request per sent application. Until then, section 3's requests.
- **A read flag** for inbox messages, so "new" follows you across devices. Until then, the browser remembers.
- Interview dates aren't parsed from messages, so rows say "Interview invitation", not a date.

## 12. Build checklist

Each phase ends with lint, type check and a look at 390 and 1440. Commit only with an explicit go.

### Phase 1: data
- [x] `lib/api.ts`: outcomes (list, add, remove), the summary, the inbox (list, one, address, settings), and
  `job.companyLogoUrl`. `lib/app-state.ts`: the row state, chips, lines and week marks (section 3), exercised by QA's
  nine mocked applications, one per state. `lib/use-outcomes.ts`: every sent application's outcomes, 6 at once.

### Phase 2: Applications
- [x] `/applications`: week strip, numbers, tabs (kept in the URL), rows with their outcomes, logos or letter tiles,
  empty and offline states. Fixed heights, so the data arriving moves nothing.
- [x] `/applications/:id`: header with the logo, the live panel's content while moving (`ApplicationBody`, shared
  with the panel), What happened? with Undo, timeline, resume, receipt, not found.

### Phase 3: Inbox
- [x] `/inbox` and `/inbox/:id` (the Inbox is their layout, so the list stays put): header band and Copy, Settings,
  filters, list with "new", the reading pane (pane from 1024 px, its own page below), spam, empty and not-configured
  states.

### Phase 4: Nori
- [x] The events in section 7, once per new outcome, with the last-visit keys; the title-row seat below 1024 px; a
  reaction asked for before Nori arrives, or before a first load settles, waits for it.

### Phase 5: QA
- [x] `tests/qa-4b.mjs` (`npm run qa:4b`): the 11 sizes in three engines for each page, light and dark; the row states,
  logos and tiles, tabs and the day filter; marking and Undo (the API mocked); the small sample; the Inbox's list,
  pane, new mail, phone page, Copy, settings, spam and switched-off state; Nori's reactions; axe in both themes;
  keyboard; budgets.

**QA results (4 November 2026):** 982 of 982 checks pass.

| Page, 4G with a 4x slower CPU | First interaction | LCP | CLS |
|---|---|---|---|
| `/applications`, 390 px | 388 KB | 1.2 s | 0.001 |
| `/applications`, 1440 px | 378 KB | 1.6 s | under 0.05 |
| `/inbox`, 390 px | 398 KB | 1.6 s | under 0.05 |
| `/inbox`, 1440 px | 381 KB | 1.5 s | under 0.05 |

The earlier suites pass on the same build in three engines: Today 417, auth 726, onboarding 844 and landing 184. These
are their totals without the real-API runs, which weren't repeated. QA found and fixed:

- Nori's corner covering the rows' chips.
- A 0.42 layout shift on phones.
- Geist Mono putting the Inbox over budget.
- The catch strip loading on the first screen.
- Reactions lost before Nori arrived.
- qa-auth mocking the wrong API port, so it was hitting the real QA API's sign-up limit.

**Not covered.** The real-API run (`--e2e`) passes 4 of 4: a new account's empty Applications, the real summary, and the
Inbox in the QA API's set-up. The plan's real run, an application marked as an interview by hand, needs a sent
application, and the QA API can't make one without the worker. So marking was tested against the mocked API only.
