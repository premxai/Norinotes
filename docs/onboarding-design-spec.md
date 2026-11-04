# Onboarding design spec

The rules to build part 3 from: `/onboarding/resume`, `/contact`, `/work`, `/questions`, `/preferences` and `/done`.
[ui-plan.md](ui-plan.md) (part 3) says what each step asks and why. This file says how it looks, moves and behaves, then
gives the build checklist. The wireframe (the "Onboarding" page of the design canvas) follows these rules. Where they
disagree, this file wins.

It builds on [landing-design-spec.md](landing-design-spec.md) (tokens, type, focus ring, motion, budgets, QA) and
[auth-design-spec.md](auth-design-spec.md) (the split shell, fields, error box, status line, Nori on a seat). Neither is
repeated here.

Status: decided, except the items under [Still open](#14-still-open).

## 1. Decisions at a glance

| Area | Decision |
|---|---|
| Where | `apps/landing`, route group `(onboarding)`, one route per step, so Nori walks in from sign-up and the browser's Back works |
| Shell | The auth shell (scene 5/12 from 1024 px, a band below), with a 560 px form column and a progress header |
| Steps | The API's five (`ONBOARDING_STEPS`), each saved with `PUT /api/onboarding` when you press **Continue** |
| Resume | Upload (PDF, DOCX, up to 10 MB) or paste; then the career graph is revealed card by card |
| Self-identification | In the questions step, folded away, "I don't wish to answer" by default |
| Scene | The workshop (take `workshop-1`): one column crop and one band crop for every step |
| Nori | The same Nori on the workbench seat; reads while the resume is read, points at cards, covers its eyes for self-ID |

## 2. Layout

| Range | Layout |
|---|---|
| 1024+ | The auth shell: the scene column (5/12, sticky, full height) on the left; the form column on the right with the top bar, then the step content up to 560 px wide, aligned to the top (24 px below the top bar), because steps are taller than one screen. **Back** and **Continue** close the step, under a `line` rule |
| 768–1023 | The logo bar and the scene band (220 to 320 px), then the step content, centred, up to 560 px |
| Below 768 | The logo bar, the band (200 to 260 px), then the step content with the 16 px page margin. **Back** and **Continue** sit in a bar fixed to the bottom of the screen (76 px, `bg`, a `line` top border); the page leaves 76 px clear beneath its last field |

- **Top bar:** the logo (no prefetch, as on the auth pages) on the left; "Saved as you go" on the right, `ink-2`, small.
- **Progress header,** above the headline: "Step 2 of 5 · Contact" in Geist 13 px `ink-2`, then a five-part bar
  (6 px tall, 6 px gaps, pill ends): done and current parts `accent`, the rest `line`. It's a `progressbar` with
  `aria-valuenow` 1 to 5. The done page has no header.
- **Field grid:** one column, except pairs of short fields side by side from 390 px (city and state, start date and
  notice period) and, from 768 px, the pairs the wireframe shows (email and phone, LinkedIn and website, GitHub and
  pronouns, salary and start date, notice period and clearance, minimum salary and companies to skip). Pairs are a
  2-column grid with a 16 px gap (12 px below 768).

## 3. Spacing

The landing page's 4 px scale.

| Between | Phone | 768+ |
|---|---|---|
| Logo bar or band and the progress header | 24 | 24 |
| Progress label and bar | 8 | 10 |
| Progress header and headline | 22 | 24 |
| Headline and lead | 8 | 10 |
| Lead and the step's first field | 22 | 24 |
| Field and field (or fieldset) | 18 | 18 |
| Last field and the Back / Continue row | 24 (then the fixed bar) | 32 |

## 4. Type

The auth roles: the headline is `text-auth` (36 to 48 px), the lead is `lead`, labels are UI 16 px 600, hints and
field errors 14 px. Additions:

| Element | Style |
|---|---|
| Progress label | Geist 500, 13 px, `ink-2`, tabular figures. Not Mono: it would load the mono font (70 KB) on every step's first screen |
| "(optional)" after a label | Geist 400, `ink-2`, same size as the label |
| "From your resume" tag | Geist 600, 11 px, `accent` on `accent-tint`, pill (Geist for the same reason) |
| Card kind tag (Role, Project…) | The landing's Tag: Mono 11 px, `tint` fill, `ink-2` |
| Card dates | Geist Mono 12 px, `ink-2` |
| Card title | Geist 600, 15 px, line height 1.3, at most 2 lines (then an ellipsis) |
| Skill chip | Geist 12 px, 1 px `line` border, pill |
| Graph count | UI 16 px 600 |

## 5. Colour

The Dawn tokens, plus one.

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `accent-tint` | `#E6EFE8` | The "From your resume" tag | `accent` on it: 6.4:1, pass |

Threads between cards use `accent` and `line-strong` at 55% opacity; they're decoration (`aria-hidden`), so they don't
need 3:1. No text sits on the scene.

## 6. Components

| Component | Spec |
|---|---|
| `OnboardingFrame` | The auth shell's parts with the workshop scene, the wider column, the progress header and the step footer. One layout for the route group, so moving between steps keeps the scene and Nori |
| Step footer | **Back** (outline button) on the left, **Continue** (primary) on the right; "Finish" on the preferences step. Step 1 has no Back. On phones, the fixed bar: Back takes 1/3, Continue 2/3 |
| Choice group | A `fieldset` with a `legend` (the question) and native radios styled as pills: 44 px tall, 1.5 px `line-strong` border, `surface` fill; checked: `accent` border and a filled dot. Arrow keys move within the group |
| Chips input | Job titles, locations and companies to skip: chips (34 px, `tint`, a 24 px remove button labelled "Remove *name*") above a text input; Enter or a comma adds; Backspace in an empty input removes the last chip. A list of chips is a `ul` with a polite live region saying "Added Product designer" |
| Suggestions | Under job titles: "Suggested from your resume:" and up to 3 role titles from the graph as text buttons ("+ UX designer") |
| Drop zone | A `label` for a visually hidden `input type=file` (accept `.pdf,.docx,.txt`), 2 px dashed `line-strong`, 18 px radius, `surface`. Drag over: `accent` border, `accent-tint` fill. Holds an icon, "Drop your resume here, or choose a file" (phones: "Choose your resume"), "PDF or DOCX, up to 10 MB" and a **Choose a file** button |
| Paste panel | "Paste the text instead" swaps the drop zone for a labelled textarea (220 px tall, resizable), **Read this** and "Upload a file instead" |
| Reading panel | The file name, "Nori is reading your resume…" with a cycling detail (roles, dates, skills, projects; 0.7 s each, not under reduced motion) and "This can take up to half a minute" |
| Graph board | A list (`ul`) of cards: 2 columns from 768 px (272 px cards, 16 px gaps), 1 column below. Threads on an `aria-hidden` SVG under the cards, from 768 px only |
| Card | `surface`, 1.5 px `line`, 12 px radius, padding 12 by 14: kind tag and dates, title, up to 3 skill chips, and **Source** (a disclosure that shows the resume line it came from under the board) |
| Self-ID fold | A native `details`: summary "Voluntary self-identification (optional)" with "I don't wish to answer" on the right while folded; inside, a sentence on how it's used and four selects, each defaulting to "I don't wish to answer" |
| Done list | Three rows (card style, icon on the left): the lane (titles · locations or remote), the graph count, and the shortlist ("Finding your first jobs…", live) |

## 7. The resume step

| State | What shows | Nori |
|---|---|---|
| Empty | Drop zone and "Paste the text instead". No footer: **Continue** appears only once there's a graph (phones: the fixed bar says "Continue appears once your resume is read") | `welcome` (bow) on arrival from sign-up, once |
| Reading | The reading panel. The request is `POST /api/profile/resume-file` (multipart, field `file`) or `POST /api/profile/resume` (`{ text }`) | `read`, alternating with `papers`, until the answer |
| Error | The drop zone returns with the API's message in the form error box: 400 "Choose a resume file (PDF, DOCX or text)", 413 "That file is too large…", 422 "We could not read that file…", 429 "Too many resume uploads…" | The gentle no |
| Graph | Cards revealed in order: roles (newest first), projects, highlights (achievements), education, certifications. One every 350 ms, at most 12 cards; past 12, a row "and 5 more" that opens the rest. Each card fades up 8 px (`dur-slow`). Threads draw in once both ends are shown. Then the count: "3 roles, 1 project, 1 degree, 1 certification, 14 skills" | `point` at each card group as it starts, then `present` and "Here's what I found." |
| Basic parse | As Graph, plus one calm line under the count: "Read with basic parsing for now; the detailed read follows when the AI service is back." (when `note` is set) | Same |

- **Continue** saves the step with `PUT /api/onboarding { step: "resume", data: {} }` (the upload already stored the
  resume) and goes to contact. **Use a different file** returns to Empty; the next upload replaces the graph.
- Threads: one per pair of cards that share a skill, at most 8, preferring skills used by the most cards.
- The count and each card group's arrival are announced in a polite live region ("4 roles found"), never every card.
- Under reduced motion every card shows at once, with no fades, no threads drawing in and no cycling detail.
- The profile details found in the resume (`profilePatch`) are kept in memory for the contact step.

## 8. The other steps

Each step loads `GET /api/onboarding` once (on arrival at `/onboarding/*`) and fills its fields from `profile`, then
from the resume's `profilePatch`, then from the account email. **Continue** sends only that step's fields.

| Step | `PUT /api/onboarding` data | Required | Notes |
|---|---|---|---|
| Contact | `fullName, email, phone, city, state, country, linkedin, github, website, pronouns` | Full name, email | Fields filled from the resume get the "From your resume" tag until edited. Country defaults to "United States" |
| Work | `workAuth { authorizedUS, needsSponsorship, status, visaType }, willingToRelocate, remotePreference` | Authorized, sponsorship | Visa type shows only for "On a visa". Work setup: Remote, Hybrid, On-site, Any (`remotePreference`) |
| Questions | `salaryExpectation { amount, currency: "USD", period }, earliestStartDate, noticePeriodWeeks, securityClearance, over18, heardAbout, eeo { gender, race, veteran, disability }` | Over 18 | Salary: a number and a period (a year, a month, an hour). `eeo` is sent only if the fold was opened and a value changed |
| Preferences | `preferences { titles, locations, remote, salaryMin, excludeCompanies }` | At least one title | Remote: Only remote, Remote is fine, No remote (`only`, `ok`, `no`). **Finish** saves and goes to done |

- Checks run on **Continue**, as on the auth forms: errors under their fields, focus to the first.
- A failed save shows the API's message in the error box above the footer and keeps every value.
- **Back** goes to the previous step without saving the current one, and keeps its unsaved values in memory for the
  visit, so returning shows them.
- After a successful save, focus moves to the next step's headline (`tabindex="-1"`), so screen readers start at the
  top.

## 9. Routing

| Case | Result |
|---|---|
| `/onboarding` | The step `GET /api/onboarding` returns (`resume`, `contact`, …), or `/onboarding/done` when it's `done` and the done page hasn't been seen this visit, else `/dashboard` |
| A step ahead of the saved progress (typed into the address bar) | Redirect to the saved step |
| A step behind it | Allowed: it shows what's saved, and saving it again doesn't move progress back |
| Signed out (401) | `/signin?next=/onboarding` |
| Sign-up | `/onboarding/resume` (already the case) |

## 10. Nori

Same controller pattern as the auth pages: an `onboarding` controller picked by route in `NoriStage`, sitting Nori on
`data-nori-seat="onboarding"` and playing the reactions the steps ask for (`norinote:react`).

| Moment | Call |
|---|---|
| Arriving from sign-up | Glide to the workbench seat, then `react("welcome")` once per visit (`sessionStorage`) |
| Resume reading | `react("read")`; every 2.5 s alternate with `react("papers")` until the answer |
| Cards arriving | `react("point-right")` as each group starts; `react("present", { say: "Here's what I found." })` at the end |
| Contact filled from the resume | `say("Filled these from your resume.")`, once |
| Work saved | `react("nod")` |
| Self-ID unfolded | `react("password")` (covers its eyes) with "Only used where an application asks."; folded again: `react("password-done")` |
| Job titles focused | `react("search")`, back to idle when the field is left |
| Done | `react("celebrate")`, then `react("searching")` while the shortlist is checked |
| A save fails | `react("auth-failed", { say })` |

Rows needed beyond the auth set: `read`, `papers`, `point-right`, `present`, `search`. They're fetched after the page
settles, the resume step's first.

## 11. The done page

- Reads `GET /api/lanes` (the lane the API made: its titles and locations), `GET /api/inbox/address` (shown only when
  `configured` is true, as "Your Nori inbox: alex.r@inbox.norinote.com", with a short line on what it's for), and the
  graph count from the resume step (or `GET /api/graph`).
- The shortlist row checks `GET /api/shortlist` every 5 s for up to a minute. When jobs arrive: "3 jobs fit you already"
  and Nori `celebrate`s again. After a minute: "Nori is still looking. They'll be on your dashboard." No spinner; the
  row's circle is dashed.
- **Open my dashboard** goes to `/dashboard` (the placeholder until part 4).

## 12. Accessibility

On top of the landing and auth rules:
- One `h1` per step; the progress bar is named "Onboarding progress"; each step's `<title>` is "Step 2 of 5: Contact ·
  Norinote".
- Choice groups are `fieldset` and `legend`; chips inputs announce additions and removals; the drop zone works by
  keyboard (it's a label for a real file input) and by drag and drop.
- Autocomplete tokens on contact: `name`, `email`, `tel`, `address-level2`, `address-level1`, `country-name`, `url`.
- The graph is a list a screen reader can read in order; threads are hidden from it.
- No time limits. The reading can take 30 seconds; the page says so and stays usable (Back, Use a different file).
- Phones: the fixed footer never covers a focused field (the page scrolls it above the bar).

## 13. Performance

- Every step is static; the client code is the step forms, the graph board and the onboarding controller. Our own
  JavaScript under 30 KB gzip.
- The workshop column image is the LCP on desktop, the headline on phones: under 2.0 s on 4G, CLS under 0.05.
- Before the first interaction: under 450 KB, as on the auth pages.
- The graph board's animation is CSS only (opacity and transform), so it never blocks input.

## 14. Still open

- What the dashboard shows first once part 4 exists (the done page links to its placeholder until then).
- Editing the graph (fixing a wrong card) lives in the dashboard's profile view, not here.

## 15. Build checklist

Each phase ends with lint, type check and a look at 390 and 1440. Commit only with an explicit go.

### Phase 1: scene
- [x] `build.mjs` picks `workshop` (seat x 0.844, y 0.648) and `workshop-band` (`crop: { aspect: 1.5, y: 0.606 }`, seat
  x 0.844, y 0.70). Largest AVIFs: 71 KB and 42 KB.

### Phase 2: shell and components
- [x] Tokens `--color-accent-tint`, `--container-step`. The auth shell became `components/SceneFrame.tsx`, shared by
  `AuthFrame` and `OnboardingFrame`. `components/onboarding/controls.tsx`: the step shell and progress header, the step
  footer (fixed on phones), choice groups, selects, the chips input, labels with "(optional)" and the resume tag.
- [x] `lib/api.ts` gains the onboarding, resume, graph, lanes, inbox and shortlist calls; `lib/onboarding.ts` holds the
  saved progress, the profile, the resume just read and each step's drafts.

### Phase 3: steps
- [x] The six routes in `app/(onboarding)/onboarding/`, `components/onboarding/ResumeStep.tsx` and `steps.tsx`: every
  save in section 8, the checks, the error box, Back's drafts, focus on the next headline, and the routing in section 9
  (`/onboarding` itself replaces the placeholder).

### Phase 4: Nori
- [x] `lib/seat-nori.ts`: one seat controller for the auth pages and onboarding (it replaces `lib/auth-nori.ts`),
  picked by route in `NoriStage`. It can now show words on their own (`say`), for "Filled these from your resume."

### Phase 5: QA
- [x] `tests/qa-onboarding.mjs` (`npm run qa:onboarding`): 852 checks pass in Chromium, Firefox and WebKit, with the real
  end-to-end run (sign up, upload the sample resume, every step, the lane on the done page) against a local API. The
  API ran with `NODE_ENV=test`, so its AI was the built-in fake model and no OpenAI spend was used.
  On the same build the auth QA (730 of 730, with its end-to-end run) and the landing QA (184 of 184) still pass; the
  landing page's first screen measured 500 KB, exactly its budget.
- [x] Budgets: LCP 0.50 to 0.51 s on a phone over 4G with a 4x slower CPU, CLS 0, 389 to 415 KB before the first
  interaction.

What QA changed:
- **Geist Mono loaded on every step's first screen** (70 KB, which took the steps to 459 to 485 KB). The progress label,
  the "From your resume" tag and the self-ID hint are now Geist (section 4); the graph's cards keep Mono, after an
  action.

Still needs a person: a real resume through the real AI read (the fake model's parse is rough), VoiceOver and NVDA on
the choice groups, chips and fold, a real phone keyboard with the fixed footer, and real Safari.
