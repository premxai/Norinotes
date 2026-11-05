# Norinote UI plan

Status: the landing page is built and passed QA (`apps/landing`). Sign-in and sign-up are built and passed QA too.
Onboarding is built and passed QA as well.
The dashboard is planned, and parts 4a (the shell and Today) and 4b (Applications and Inbox) are built. Part 4c (You)
is built and QA'd.

Nori, the plush rice ball, is the guide on every surface. It ships as `nori-pet/` (`@norinote/nori-pet`); its README
lists every animation (row), event and API call this plan uses.

## Roadmap

Four parts, one at a time. Each one is planned and wireframed, then built, before the next one starts.

| # | Part | Pages | Status |
|---|---|---|---|
| 1 | Landing | `/` (plus `/privacy` and `/terms`) | Built and QA'd in `apps/landing` ([landing-design-spec.md](landing-design-spec.md)). Phase 6 (launch) waits on its open items |
| 2 | Sign-in and sign-up | `/signin`, `/signup`, plus `/forgot-password`, `/reset-password`, `/verify-email` | Built and QA'd in `apps/landing` ([auth-design-spec.md](auth-design-spec.md)) |
| 3 | Onboarding | `/onboarding/resume`, `contact`, `work`, `questions`, `preferences`, `done` | Built and QA'd in `apps/landing` ([onboarding-design-spec.md](onboarding-design-spec.md)) |
| 4 | Dashboard | `/today`, `/applications`, `/inbox`, `/you`, in three parts (4a, 4b, 4c) | 4a built and QA'd ([dashboard-4a-spec.md](dashboard-4a-spec.md)); 4b built and QA'd ([dashboard-4b-spec.md](dashboard-4b-spec.md)); 4c built and QA'd ([dashboard-4c-spec.md](dashboard-4c-spec.md)) |
| 5 | Error pages | Page not found, something broke, and the app failing to start | Built and QA'd ([error-pages-spec.md](error-pages-spec.md)) |
| 6 | Privacy and Terms | `/privacy`, `/terms` | Planned, texts drafted ([privacy](legal/privacy.md), [terms](legal/terms.md)) and wireframed. Next: the spec |

Rules for every part:
- **Built fresh.** Nothing is copied from the older sites (`C:\dev\nori-landing`, `C:\dev\nori-site`), the current
  `apps/web` dashboard, or the `nori-pet/playground` demo pages. Only what's decided in these docs and the design canvas
  goes in.
- **One design.** Same Dawn theme, Geist Serif Triangle, Geist and Geist Mono, spacing, grid, components and motion as the
  landing spec. Each part adds its own pages, not its own style.
- **Same Nori.** Every page uses `@norinote/nori-pet` and its animations. Sign-in and sign-up get the reading-along and
  eye-covering behaviour (`watchFields`); onboarding and the dashboard get the agent events.
- **Same painted world.** New scenes for each part are generated with the same model and prompt style as the landing
  scenes, so the whole product feels like one place.

How the parts link:

| From | To |
|---|---|
| Landing **Get started**, **Start Pro**, final call to action, dropping Nori on the button | `/signup` (Pro passes `?plan=pro`) |
| Landing **Sign in** | `/signin` |
| `/signup` done | `/onboarding` |
| `/signin` done | `/dashboard`, or `/onboarding` if it isn't finished |
| `/onboarding` done | `/dashboard` |
| Sign-in **Forgot password?** | `/forgot-password` |
| The reset email's link | `/reset-password?token=…`, then `/signin` |
| The confirmation email's link | `/verify-email?token=…`, then onward (see part 2) |

Until part 2 is built, `/signin` and `/signup` are plain placeholder pages in the same theme, so the landing page's links
work from day one.

## Landing page

How it looks, moves and behaves at every size (grid, spacing, type scale, colour contrast, images, Nori, motion,
accessibility, budgets), plus the build checklist: [landing-design-spec.md](landing-design-spec.md).

One long page that tells a single day with Nori: you wake up to a shortlist, Nori applies, you stay in charge, and
replies make it better. It has three main moments: the hero (01), the apply replay (04) and Nori asking the visitor a
question (06). Everything else supports those.

### How Nori behaves on the page

- **One Nori, hopping between sections.** On desktop, Nori sits on each section's anchor card (`sitOn`) when that
  section is most in view, then hops to the next one. It plays that section's cue once and goes back to idle. Scrolling
  back replays the cue only if the cue is short.
- **Phones.** Nori stays small (`size: "s"`) in the bottom corner. It doesn't travel, but it still plays each section's
  cue. It stays tuckable.
- **At most one bubble per section,** short, and never covering the section's headline or button. Bubbles close by
  themselves. The only exception is the question in section 06.
- **Always optional.** Visitors can drag, pet, tuck (Escape) or mute Nori. With reduced motion, Nori shows still poses
  with no hopping. The page must read completely with Nori tucked away.
- Cues start from an IntersectionObserver on each section, not from scroll position. A cue only plays once Nori has
  arrived.

### Sections

| # | Section | What the visitor sees | Nori's cue (rows and events) |
|---|---|---|---|
| 01 | Hero (poster) | A full-bleed generated clay scene with the headline set large in its calm sky, one line of support, **Get started** plus a quieter **Watch Nori apply** (scrolls to 04). No dashboard screenshot. The product appears as Nori's folded note, "3 for today", which unfolds into 3 sample jobs with fit scores and **Send all 3**. On phones the note opens as a bottom sheet. | Sits on the empty hilltop the scene leaves for it, holding the note (`hold`). The note peeks open by itself after about 3 seconds; click Nori or the note to unfold it. Then `scroll-cue` (points down) |
| 02 | No board to scroll | Contrast: a blurred wall of listings fades down to the 3 that fit (the copy says "hundreds", not an unmeasured number). Short copy: jobs are collected once, understood once, matched to you. | `searching` (magnifier) while the wall fades |
| 03 | How it works | Sticky panel, 4 steps that advance on scroll: 1. upload your resume, which becomes a career graph. 2. Nori finds jobs you're likely to get. 3. Nori tailors a one-page resume and answers. 4. You click, and it's sent in about 20 seconds. | Walks along the steps: `read`, `think`, `papers`, `laptop` |
| 04 | Watch one apply | A labelled **sample** replay: a form fills field by field, a timer counts up, an email code arrives in Nori's inbox, then "Sent" lands at about 20 seconds. **Run it again** button. | The real apply flow: `applying` (scribble), `awaiting-code` (wait), `code` with the code on its note (catch, then hold), `submitting` (dash), `submitted` (hop, sparkles); `progress` bubble with the live timer |
| 05 | Tailored, never invented | A before-and-after resume: changed bullets highlighted, each with its reason and the source line from your history. A coverage line: "8 of 9 must-haves shown". | `read` with a note "2 bullets changed" |
| 06 | You stay in charge | Three cards: you approve every send (or set a daily cap for autopilot); questions nobody can answer come to you once and are remembered; Nori stops for captchas and account walls, and never gets around them. | Nori asks the visitor a real question in its bubble, such as "Open to relocating?" with Yes and No (`ask`). The answer drops into a sample answer bank card next to it. Then `nod` |
| 07 | Gets smarter from replies | A week timeline: Mon sent 3, Wed a reply, Thu an interview, Fri a rejection. Each outcome nudges the next shortlist. | `celebrate` on the interview, `deflated` then `comfort` on the rejection, as the timeline reaches them |
| 08 | Wherever you are | Dashboard, Telegram (approve from a message) and Nori's own inbox for codes and replies. | `email-sent` (check-mail) |
| 09 | Pricing | Free and Pro at $9 a month. The Free tier's limits are placeholders until decided. | `relaxing` (tea) on Pro: "Autopilot" |
| 10 | FAQ | 6 to 8 short, honest answers: what it applies to, what it never does, data and privacy, cost, which job systems it covers. | `think` while an answer is open |
| 11 | Final call to action | "Let Nori take the first shift." and **Get started**. | `thanks` (heart). Dropping Nori on the button (`data-nori-drop`) plays `welcome` (bow, hearts) and opens sign-up |
| 12 | Footer | Product, privacy, terms, GitHub. | Falls asleep if the visitor lingers (the built-in 2-minute sleep, shortened to about 20 seconds here) |

### Honesty rules for copy and samples

- Use only true numbers: "about 20 seconds" (click to sent is 12 to 30 seconds in the apply evals). No user counts,
  ratings, testimonials or company logos. Prices only as decided.
- Every demo (shortlist, replay, resume diff, timeline) uses a made-up company and is labelled "Sample".
- Never claim Nori gets past captchas, invents experience, or applies without approval or a cap the user set.

### Type (decided)

- **Headlines:** Geist Serif, the Triangle version (triangle dots on i, j and punctuation). It has a single weight, 400,
  so headlines get their weight from size, not bold.
- **Text and UI:** Geist (Sans). **Numbers, timers, codes and fit scores:** Geist Mono.
- All three ship in Vercel's `geist` npm package (1.9.0 and later, SIL Open Font License). In Next.js:
  `geist/font/serif/triangle`, `geist/font/sans` and `geist/font/mono`. The serif matches Geist Sans's cap height and
  x-height, so the two can share a line.

### Images

- One painted world, generated with the same image model as Nori (`gpt-image-2.5-sunburst`): soft felt, clay and rice
  paper, like a photographed craft diorama. No people, no text, and never fake product screenshots.
- Scenes never contain Nori. Each leaves an empty spot (a hilltop, a desk) where the live, draggable Nori sits, and a calm
  area where the headline sits.
- About 5 scenes: the hero, a small desk scene for 06, a wide horizon for the final call to action (11), and possibly a
  footer horizon. The real UI appears only in 04 (the replay) and 08 (dashboard, Telegram, inbox).
- Hero tests are made for both theme candidates (`nori-pet/work/scenes/`, not committed): Dawn (sunrise over sage hills)
  and Midnight (moon, stitched stars, a paper lantern beside Nori's spot). About $0.06 each.
- Served as webp (hero about 90 KB at 1536 px), lazy below the fold. The landing page uses one fixed mode, since a painted
  scene can't flip between light and dark; the dashboard keeps both.

### Theme (decided): Dawn

A sunrise world for "every morning": rice cream, soft peach sky, sage hills, seaweed green.

| Token | Hex | Use |
|---|---|---|
| `bg` | `#FBF4EA` | Page background (rice cream) |
| `surface` | `#FFFDF8` | Cards, the unfolded note, bubbles |
| `surface-2` | `#F5EBDD` | Alternate section bands, side panels |
| `tint` | `#F0E2CF` | Placeholders, chips, quiet fills |
| `line` | `#E4D7C4` | Borders and rules |
| `ink` | `#1F2A24` | Text and headlines |
| `ink-2` | `#55605A` | Secondary text |
| `accent` | `#2F5D46` | Seaweed green: primary buttons, active states, progress (text on it: `surface`) |

Midnight (nori black `#0F1714`, lantern amber `#F2B65C`) stays in the wireframe's Theme switch for reference only. Its
lantern scene could come back later as a night variant, such as the footer where Nori falls asleep.

### Open
- Headline and section copy.
- The Free tier's limits.

## Sign-in and sign-up (part 2)

Status: planned and wireframed: the "Sign-in and sign-up" page of the design canvas
(https://claude.ai/artifact/WtzZgiFAkh9ef64jW6iLFr), desktop and phone, every page and state, with the gate and nook scenes
(`art/scenes.mjs` gate and nook, takes `gate-2` and `nook-2`). Specified in [auth-design-spec.md](auth-design-spec.md), which wins where it and this plan differ. Built and
passed QA (spec section 16).

They live in `apps/landing` under the `(auth)` route group, so the same Nori stays mounted from the landing page into
sign-up and on into onboarding.

### Decided

| Question | Decision |
|---|---|
| Layout | **Split.** The scene on the left with Nori in it, the form on the right on plain cream. On phones the scene becomes a short band above the form |
| Sign-in methods | **Email and password**, which the API already has, with forgot password and email confirmation. Google comes later as its own backend task in `apps/api` |
| Sign-up fields | **Email and password.** The name is asked in onboarding's contact step |
| Scenes | **Two new ones.** Sign-up: an open garden gate with a path towards the sunrise hills (starting out). Sign-in: back at the desk with a mug (coming back) |

Why the scene goes on the left:
1. **One order at every size.** On phones the scene sits above the form. Left then right on desktop reads in the same
   order as top then bottom on a phone, so the page has a single reading order.
2. **Nori faces the form.** Sitting at the scene's right edge, Nori looks toward the fields it reads along with, and its
   peek and eye-covering point at what you're typing.
3. **The path ends at the button.** The eye starts on the picture and ends at the bottom right, on **Create account** or
   **Sign in**.

Swapping sides is a mirror of the grid, so the wireframe can still test it.

### Pages

The API emails links to `/verify-email` and `/reset-password`, so those pages have to exist. Part 2 is therefore two
main pages and three small ones, all on the same layout.

| Route | What it does | Scene |
|---|---|---|
| `/signup` | Create an account, then go to `/onboarding` | Gate |
| `/signin` | Sign in, then go to `/dashboard`, or `/onboarding` if it isn't finished (`GET /onboarding` gives the step) | Desk |
| `/forgot-password` | Ask for a reset link. The answer is the same for every address | Desk |
| `/reset-password?token=…` | Choose a new password. Every session is signed out, so it ends on "Sign in with your new password" | Desk |
| `/verify-email?token=…` | Confirm the address from the email. Works signed in or not | Gate |

If you're already signed in (`GET /auth/session`), `/signin` and `/signup` send you on to where you'd land after signing
in. A `?next=` path is honoured only when it's a same-site path.

### Anatomy

**Laptop and up (64rem+):** two columns at full height (`100svh`, with a minimum so short screens scroll).

- **Scene column** (about 5/12 of the width): the scene covers it. Nori's seat is near its right edge, and there's a
  calm patch for one short line of Nori's words.
- **Form column:** cream `bg`. The form is up to 25rem wide and vertically centred.
  - Top bar: the logo (to `/`) on the left. On the right, the switch link ("Have an account? **Sign in**").
  - Headline in Geist Serif, then one line of lead.
  - Plan chip, only with `?plan=pro` (see Open).
  - Fields with visible labels (never placeholder-only): Email, then Password with a show/hide button. Sign-up shows
    the hint "At least 8 characters" under it. Sign-in puts **Forgot password?** on the password label's row.
  - The form error, when there is one, just above the button.
  - The primary button, full width.
  - Sign-up only: small print, "By creating an account you agree to the **Terms** and **Privacy**."

**Tablet (48–64rem):** the phone layout with a taller band and the form centred. (A 2/5 split left a 320 px sliver of
scene; see the spec.)

**Phone (under 48rem):** a 56 px logo bar on `bg`, then the scene as a band about 30svh tall, with Nori sitting on it
at size `s`. (The logo can't sit on the gate scene: it fails contrast there.) The form follows at full width with the
page margin. The switch link moves under the button.

### Nori

The rows and events already exist in `nori-pet`.

| Moment | What Nori does |
|---|---|
| Arriving from the landing page | The same Nori hops into the scene's seat. On a direct visit it starts on the seat and plays `hello` (wave) once |
| Typing your email | Reads along (`watchFields`, `type-along`) |
| Password field focused | Covers its eyes (`password`). **Show** makes it peek (`password-show`), **Hide** covers again, and leaving the field uncovers (`password-done`) |
| Submitting | Turns a key (`signing-in`) while the request runs |
| Sign-up succeeds | Bows with hearts (`welcome`), then goes on to `/onboarding` |
| Sign-in succeeds | Nods and waves (`signed-in`, "Welcome back!"), then goes on |
| Wrong password, address taken, too many tries | Gently shakes its head (`auth-failed`) with a short bubble. The error is always in the form as well; Nori is never the only place it appears |
| Reset link sent | Holds up an envelope (`email-sent`, "Check your inbox") |
| Confirming email | Sways while it checks (`loading`), then `celebrate`. On an expired link: `deflated`, then `comfort` |

Same rules as the landing page: Nori stays on the scene and never covers a field or button. It can be dragged, tucked
and muted. Reduced motion gets still poses, and every page works fully with Nori tucked away.

### Form behaviour

- A real `<form>` with `name` and `autocomplete` (`email`, `new-password` on sign-up, `current-password` on sign-in) so
  password managers work. No paste blocking and no "confirm password" field; the show button covers that.
- The API's messages are already plain English and are shown as they are. "An account with this email already exists.
  **Sign in** instead." links to `/signin` with the email carried over in memory, never in the URL.
- Field errors sit under their field (`aria-invalid`, `aria-describedby`). After a failed submit, focus goes to the
  first error. A polite live region says "Signing in…".
- Network failure: "Couldn't reach Norinote. Check your connection and try again." Rate limits: the API's own wording.
- The email field gets autofocus on laptops and up only, so a phone keyboard doesn't cover the scene on arrival.
- An unconfirmed email doesn't block anything. The reminder to confirm lives in the dashboard.

### Connecting to the API

- Calls go to `apps/api` with `credentials: "include"`. Its cookie is httpOnly and `SameSite=Lax`.
- The API accepts only `WEB_URL` as a browser origin, and builds the email links from it. In development that's set to
  `http://localhost:3400`. This is an environment setting, not a code change.
- In production the app and the API must be on the same site (for example `norinote.com` and `api.norinote.com`) for
  the cookie to work. That's part of the hosting decision (landing spec, Phase 6).
- Without `RESEND_API_KEY`, the API prints the email links to its console, which is enough for local testing.

### Scenes

The same model, style prompt and pipeline as the landing scenes. Each scene comes as a portrait crop for the column and a
wide phone crop for the band.

- **Gate (sign-up, verify):** an open wooden garden gate in a felt hedge at sunrise, stepping stones leading through it
  towards the landing page's hills, a paper lantern on the post. Nori sits on the flat top of the fence post at the
  right edge. Chosen over a round hillside door (too close to a familiar fantasy home) and a cottage front door (read as
  "welcome home" rather than "starting out").
- **Desk (sign-in, forgot, reset):** a low wooden desk by a round window in morning light, a steaming mug, a folded note,
  a small plant. An empty cushion for Nori. This is a cosier interior than the landing's desk scene, so the two don't
  look like repeats.
- Budget: about 8 images including retries, roughly $1–2 from the same ledger (about $3.90 of $24 spent so far).

### Copy (draft)

| Page | Headline | Lead | Button |
|---|---|---|---|
| Sign-up | Create your account | Then add your resume, and Nori builds your first shortlist. | Create account |
| Sign-in | Welcome back | Sign in to see today's shortlist. | Sign in |
| Forgot | Reset your password | We'll email you a link. It works for one hour. | Send link |
| Reset | Choose a new password | You'll sign in with it next. | Save password |
| Verify (ok) | Email confirmed | Thanks. You're all set. | Continue |
| Verify (expired) | This link has expired | Links last 3 days. Sign in and ask for a new one. | Sign in |

The time limits (one hour, 3 days) are the API's real values.

### Budgets and checks

The landing spec's budgets and QA matrix apply: LCP under 2.0s on 4G, CLS under 0.1, axe clean, keyboard only, reduced
motion, three engines, 11 sizes. The QA script also covers each form's error states and a full sign-up, sign-in and reset
against a local API.

### Open

- **What `?plan=pro` shows.** There's no billing yet. Proposal: a small chip, "Pro selected · you'll add payment after
  setup", carried into onboarding. Until billing exists, everyone starts on Free.
- **Google sign-in:** later, as a separate `apps/api` task.
- **Hosting and domain:** the API and the app on the same site (shared with landing Phase 6).

## Onboarding (part 3)

Status: planned and wireframed: the "Onboarding" page of the design canvas, desktop and phone, every step, with the
workshop scene (`art/scenes.mjs` workshop, take `workshop-1`, picked over take 2). Specified in [onboarding-design-spec.md](onboarding-design-spec.md), which wins where it and this plan
differ. Built and passed QA (spec section 15).

It lives in `apps/landing` as well, so the same Nori walks in from sign-up. Signing up opens it; signing in opens it
until it's finished.

### Decided

| Question | Decision |
|---|---|
| Structure | **Step screens.** Five short steps, one topic each, with a progress bar, **Back** and **Continue**. Each step is saved when you continue, so leaving halfway resumes where you stopped |
| Resume step | **The graph builds live.** Once the upload is read, your roles, projects, education and skills appear one by one as small cards that join into your career graph, with Nori arranging them |
| Voluntary self-identification | **Optional and folded away** in the questions step, with "I don't wish to answer" as the default |
| Scene | **One new scene:** Nori's workshop (take 1), a felt workbench under a cork board of cards joined by threads, where the graph is made. Nori sits on the bench between the paper stack and the plant (x 0.844, y 0.648). One scene for every step, plus a phone band |

### What the API already does

The steps are the API's (`apps/api/src/profile-model.ts`, `ONBOARDING_STEPS`): `PUT /api/onboarding` with
`{ step, data }` saves one step, writes only that step's fields, and moves the saved progress forward (never back).
`GET /api/onboarding` returns the step to resume at and the profile so far.

- **Resume:** `POST /api/profile/resume-file` (PDF, DOCX or text, up to 10 MB) or `POST /api/profile/resume` (pasted
  text) reads the resume, builds the career graph and returns its nodes plus the contact details found in it. The
  request waits for the whole read; the cards are then revealed one at a time. If the AI service is down, the API reads
  it with a basic parser and says so (`note`).
- **After the last step** the API creates the first lane from the job titles, gives the account its own inbox address
  (once an inbound domain is set), and starts the first shortlist run.

### Pages

One route per step, so the browser's Back works and a link can reopen a step.

| # | Route | Step (API) | What it asks |
|---|---|---|---|
| 1 | `/onboarding/resume` | `resume` | Upload a PDF or DOCX (drag and drop, or choose), or paste the text. Then the graph builds |
| 2 | `/onboarding/contact` | `contact` | Full name, email (the account's by default), phone, city, state, country, LinkedIn, GitHub, website, pronouns (optional). Filled from the resume where it could be |
| 3 | `/onboarding/work` | `authorization` | Authorized to work in the US? Need sponsorship? Status (citizen, permanent resident, visa, other) and visa type. Open to relocating? Remote, hybrid or on-site |
| 4 | `/onboarding/questions` | `screening` | What applications ask: salary expectation, earliest start date, notice period, security clearance, over 18, how you heard about the job. Folded away: voluntary self-identification |
| 5 | `/onboarding/preferences` | `preferences` | Job titles, locations, remote, minimum salary, companies to skip |
| | `/onboarding/done` | | What happens now: the lane Nori made, the inbox address, the first shortlist on its way. **Open my dashboard** |

- `/onboarding` alone opens the step to resume at. Signed out: `/signin?next=/onboarding`. Already finished:
  `/dashboard`.
- Steps 2 to 5 can be left with only what's required. Step 1 is required: there's no shortlist without a resume.
- **Back** never loses what you typed: going back shows what's saved, and the current step keeps its unsaved values in
  memory.
- Not asked here: the daily cap for sending without asking (autopilot). Until it's set in the dashboard, Nori asks
  before every application.

### Layout

The sign-in shell, a little wider: the scene on the left (5/12) from 1024 px, a band above the form below that. The form
column holds up to 560 px, so short fields can pair up (city and state, start date and notice period). Above the form:
"Step 2 of 5", the step's name and a five-part progress bar. **Back** and **Continue** sit at the bottom; on phones they
stick to the bottom of the screen.

### The resume step

1. **Before:** a drop zone ("Drop your resume here, or choose a file", PDF or DOCX up to 10 MB) and "Paste the text
   instead".
2. **Reading:** the file name, then "Nori is reading your resume…" with what it's looking for ticking past (roles,
   skills, dates). Nori reads (`read`, then `papers`). It can take a while, so the wording says so.
3. **The graph:** cards appear one by one, grouped as roles, projects, education and certifications, each with its dates
   and a few skill chips. Skills shared between cards are drawn as threads between them. Nori points at each group as
   it arrives (`point`, then `present`). A count sums it up: "4 roles, 2 projects, 23 skills".
4. **Check it:** every card opens to show the line of the resume it came from. **Continue** moves on;
   **Use a different file** starts over. If the basic parser was used, a calm line says the detailed read will follow.

On phones the cards stack in one column and the threads are left out; the count and the groups stay.

### Nori

| Moment | What Nori does |
|---|---|
| Arriving from sign-up | Glides from the gate to the workbench seat, then bows (`welcome`) once |
| Resume: reading | `read`, then `papers`, until the answer |
| Resume: cards arriving | `point` at each group, `present` at the end |
| Contact filled from the resume | Says "Filled these from your resume." once |
| Work authorization saved | `nod` |
| Self-identification unfolded | Covers its eyes (`cover`): "Only used where an application asks." Uncovers when it's folded again |
| Titles typed in preferences | `search` |
| Done | `celebrate`, then `searching` while the first shortlist runs |
| A step's save fails | The gentle no (`auth-failed`), with the error in the form |

### Copy (draft)

| Step | Headline | Lead |
|---|---|---|
| Resume | Start with your resume | Nori reads it once and turns it into your career graph. That's how it knows which jobs you'll likely get. |
| Contact | How can employers reach you? | Filled from your resume where we could. Check it's right. |
| Work | Where can you work? | Applications ask this every time. Answer once and Nori fills it in. |
| Questions | The usual questions | Reused on every application. Skip what you'd rather answer case by case. |
| Preferences | What are you looking for? | Nori builds your first search from this. You can change it any time. |
| Done | You're all set | Nori is finding your first jobs now. They'll be on your dashboard as soon as they're in. |

### Open

- The done page links to the dashboard placeholder until part 4 exists.
- The inbox address only exists once the API has an inbound email domain set; the done page leaves it out until then.

## Dashboard (part 4)

Status: planned (the whole dashboard, and part 4a in detail); 4a is wireframed on the "Dashboard 4a: Today" page of the
design canvas, desktop and phone, light and dark, with the night strip (`art/scenes.mjs` night, take `night-1`, picked over take 2;
light mode reuses the landing footer's hills). Specified in [dashboard-4a-spec.md](dashboard-4a-spec.md), which wins
where it and this plan differ. Next: build 4a.

The everyday app: where the morning shortlist lands, where you approve and watch applications, and where everything Nori
did is kept. It lives in `apps/landing` like the other parts (route group `(app)`), so the same Nori carries over from
onboarding, and it replaces `apps/web` once it's done. Unlike the landing page it has a light and a dark mode.

### Decided

| Question | Decision |
|---|---|
| Navigation | **A side rail on desktop, bottom tabs on phones.** Four sections: Today, Applications, Inbox, You. Nori docks at the foot of the rail (desktop) or stands in the corner of Today's greeting strip (narrower) |
| Today | **Job cards, each with its own Apply.** Title, company, fit score, the two strongest reasons; **Send all 3** above them. A card opens the full job, the tailored resume and what Nori will answer |
| Applying | **A live panel.** The card you applied from becomes a panel (a side panel on desktop, a sheet on phones) that steps through the real run log with a timer, and Nori acts it out: the landing page's replay, for real |
| Dark mode | **Night Dawn.** A deep seaweed-green night that keeps the green accent, so both modes feel like one product. Follows the system, with a switch in You |

### Three parts, one at a time

The dashboard is too big for one pass, so it's planned once and then wireframed, specified and built in three parts.

| Part | Sections | What it covers |
|---|---|---|
| **4a** | The shell, Today | The rail and tabs, light and dark, Nori docked; today's shortlist; approving and the live apply panel; the "needs you" moments (questions, codes, captchas, account walls); the daily cap; sign-out; the "confirm your email" reminder |
| **4b** | Applications, Inbox | Every application with its status, receipt, tailored resume and run log; outcomes (replies, interviews, offers, rejections) and the week view; Nori's inbox of codes and replies |
| **4c** | You | The career graph (open a card, fix or remove it, add a fact); lanes and preferences; the autopilot daily cap; the answer bank; Telegram; account (email, password, sessions, delete) and the theme switch |

### What the API already does

| Need | Endpoint |
|---|---|
| Today's shortlist, and whether it was widened | `GET /api/shortlist`, `GET /api/shortlist/meta`; `POST /api/shortlist/:jobId/dismiss` |
| A job in full | `GET /api/jobs/:id` |
| Apply, approve, answer, retry | `POST /api/applications` `{ jobId }`, `POST /:id/approve` `{ answers? }`, `POST /:id/answer` `{ answers }`, `POST /:id/retry` |
| One application: job, tailored resume, run log | `GET /api/applications/:id` (`events` is the run log the live panel plays) |
| The daily cap and today's use | `GET /api/agent/status` |
| What Nori did, newest first | `GET /api/agent/activity` |
| Outcomes, inbox, lanes, graph, profile, Telegram, account | `/api/outcomes`, `/api/inbox`, `/api/lanes`, `/api/graph`, `/api/profile`, `/api/channels/telegram`, `/api/auth/*` (parts 4b and 4c) |

Application statuses: `queued`, `preparing`, `prepared` (ready for your click), `applying`, `awaiting_code`,
`needs_user`, `submitted`, `failed`. There's no live push from the API, so open pages poll: every 2 s while an
application is applying, every 30 s otherwise, and never while the tab is hidden.

### Routes

`/today`, `/applications` (and `/applications/:id`), `/inbox`, `/you`. `/dashboard`, where sign-in and onboarding
send people today, redirects to `/today`. Signed out: `/signin?next=…`. Onboarding not finished: `/onboarding`.

### Layout

- **Desktop (1024+):** a 248 px rail on the left (logo, the four sections with counts, the cap meter, Nori at the
  foot), and the section on the right, up to 960 px wide. The live panel slides in on the right at 420 px and the list
  narrows beside it.
- **Tablet (768–1023):** the rail collapses to 72 px icons with labels on hover and focus; the live panel overlays.
- **Phone:** a top bar (logo, the section's name) and a bottom tab bar (64 px plus the safe area) with the four
  sections. The live panel is a full-height sheet. Nori stands in the corner of the greeting strip, small.
- **Scenes:** the dashboard is for work, so there's no full scene. Today opens with a short greeting band ("Good
  morning, Alex") over a thin strip of the Dawn hills (light) or a night version (dark), and Nori sleeps on the strip in
  the evening when there's nothing to do.

### Part 4a: Today

**Top of the page:** the greeting, then one line on the day: "3 for today · 1 needs you · 2 of 5 sent today" (the
cap). If the search was widened: "Showing similar roles while Nori looks for more" (from `meta`). **Send all 3** on
the right.

**A job card:**
- Title, company and location (or Remote), how long ago it was posted (always under 72 hours), and the fit score in
  Geist Mono.
- The two strongest reasons in a line each ("Led a design system, like this role asks").
- **Apply** (primary) and **Not for me** (a quiet text button that dismisses it, with **Undo** for 5 seconds).
- Opening a card (anywhere but the buttons) shows the job in full: the description, every reason, the tailored resume
  Nori will send (with the changed lines marked, as on the landing page), and the questions it already knows how to
  answer.

**The live panel:** opens when you press **Apply** (or **Send all 3**, one panel per job, stacked).

| Status | What the panel shows | Nori |
|---|---|---|
| `queued`, `preparing` | "Getting it ready": tailoring the resume, reading the form | `papers` |
| `prepared` | Ready: the tailored resume and answers to check, then **Send it** (the approval) | `present` |
| `applying` | Each run-log step as it happens (opening the page, filling fields, uploading, submitting) with a running timer | `scribble`, `type-along` |
| `awaiting_code` | "Waiting for the email code" and the inbox address it'll arrive at | `wait`, then `catch` when it lands |
| `needs_user` | The questions nobody could answer, as a short form; **Send answers** carries on. Captchas and account walls: what happened and a link to finish it yourself | `point`, or `deflated` for a wall |
| `submitted` | "Sent in 18 seconds", the receipt, and a link to the application | `celebrate` |
| `failed` | What went wrong in words, **Try again** (retry) and the run log | `deflated`, then `comfort` |

**Needs you:** anything waiting on you (prepared or needs-user applications) sits above the shortlist as a highlighted
row, and the Today tab shows a dot.

**Empty states:** the first morning ("Nori is still finding your first jobs"), a day with nothing new ("Nothing new
today. Nori checks again overnight"), and every job handled ("That's today done").

**Also in 4a:** the cap meter in the rail ("2 of 5 today", from `agent/status`; autopilot off shows "Nori asks before
every send"); sign-out under the account name; the "Confirm your email" banner until it's confirmed, with **Send it
again** (`POST /api/auth/resend-verification`).

### Part 4b: Applications and Inbox

Status: planned and wireframed: the "Dashboard 4b: Applications and Inbox" page of the design canvas (Applications
with one application's page, the Inbox, and a phone board for both; light and dark). Specified in [dashboard-4b-spec.md](dashboard-4b-spec.md), which wins where it and this plan
differ. Built and QA'd: 982 checks in three engines (the spec's build checklist).

| Question | Decision |
|---|---|
| Applications | **A list with filters.** Newest first; tabs for All, In progress, Sent, Replied and Closed with counts; each row's state as a chip. A row opens the application's own page, `/applications/:id` |
| Results | **A week strip and a few numbers** at the top of Applications: this week's days with what happened on each, then honest numbers, shown as counts until there are 5 or more |
| Inbox | **A list and a reading pane.** Messages on the left with a kind chip, the open one on the right; codes large with **Copy**; each message links to its application. Phones: the list, then the message on its own page |
| Inbox settings | **In the Inbox:** your Nori address, forwarding a copy to your own email, and how long messages are kept |

#### What the API already does

| Need | Endpoint |
|---|---|
| Every application, newest first | `GET /api/applications` (up to 200, with the job and tailored resume) |
| One application in full | `GET /api/applications/:id` (job, tailored resume with changes, run log, receipt) |
| Its outcomes, and marking one by hand | `GET /api/applications/:id/outcomes` (state: pending, reply, interview, offer, rejection, no_response); `POST` `{ kind }`; `DELETE /:outcomeId` |
| The numbers | `GET /api/outcomes/summary`: sent, settled, responses, interviews, rejections, offers, no response, rates and the median days to a first reply. Rates are null below 5 settled applications |
| The inbox | `GET /api/inbox` (newest first, with the linked application), `GET /api/inbox/:id` (the full message) |
| The address and settings | `GET /api/inbox/address`, `PUT /api/inbox/settings` `{ forwardTo, forwardEnabled, retentionDays }` |

An application counts as **no response** after 30 days without an outcome. Replies that go to the person's own mailbox
can't be seen by the Nori inbox, which is why outcomes can be marked by hand.

#### Applications (`/applications`)

- **The week strip:** Monday to Sunday of the current week, one column per day with small marks for what happened
  (sent, reply, interview, offer, rejection), today outlined. Tapping a day filters the list to it. Previous and next
  week buttons.
- **The numbers, under the strip:** "12 sent · 3 replies · 1 interview", and once there are 5 or more settled
  applications, "Response rate 25%" and "Median 3 days to a first reply". Below 5: counts only, with "Rates show once 5
  applications have had an answer or 30 days."
- **Filter tabs:** All, In progress (queued to awaiting a code, and needs you), Sent (submitted, no outcome yet),
  Replied (reply, interview or offer), Closed (rejection, no response, failed). Each with its count.
- **A row:** the job title and company, the state chip (Applying, Needs you, Waiting, Reply, Interview, Offer, Rejected,
  No response, Didn't go through), when it was sent, and one line of what happened last ("Replied in 2 days",
  "Interview on 12 Nov" when the message says so, or "Sent 4 Nov").
- **Empty:** "Nothing sent yet. Applications you send from Today show up here."

#### One application (`/applications/:id`)

- **Header:** title, company, place, the state chip and when it was sent; **Open the job posting**.
- **What happened, newest first:** outcomes and inbox messages for this application, then the run log, then "Created".
  Messages open in the Inbox.
- **Mark what happened:** Reply, Interview, Offer, Rejection, as buttons (the API's manual outcomes), each undoable from
  the timeline. "Replies that go to your own email don't reach Nori's inbox, so you can mark them here."
- **The resume sent:** the tailored resume's changed lines with their reasons (as on the landing page), and a link to
  the full document when the API has one.
- **The receipt:** the confirmation number, a dry-run note when it was a practice run, and the screenshot when there is
  one.
- **Still in progress:** the live panel's content in place (the same states as Today's panel).

#### Inbox (`/inbox`)

- **Top:** "Your Nori inbox: alex.r@inbox.norinote.com" with **Copy**, and **Settings** (a disclosure): forward a copy to
  your own email (on or off, and the address), keep messages for 30, 90 or 365 days or forever.
- **The list:** sender, subject, when, a kind chip (Code, Confirmation, Reply, Interview, Rejection, Offer, Other) and
  the application it belongs to ("Product designer · Fernway"). Unread in bold. Filter: All, Codes, Replies.
- **The reading pane:** subject, sender, time; a code shown large in Geist Mono with **Copy**; a verification link as a
  button; the body as plain text; attachments listed; **Open the application** when it's linked. Spam marked as such.
- **Empty:** "Nothing here yet. Codes and replies from employers land here, and Nori uses them to finish applications."
  Not configured (no inbound domain): "Nori's inbox isn't switched on yet."

#### Nori in 4b

`reply` (a wave) when a reply arrives, `interview` and `offer` (celebrate with confetti), `rejection` (deflated, then
comfort), each once per new outcome since the last visit. In the Inbox, `check-mail` while a message is open, and
`catch` for a code.

#### Copy (draft, 4b)

| Place | Words |
|---|---|
| Numbers | 12 sent · 3 replies · 1 interview · Response rate 25% · Median 3 days to a first reply |
| Small sample | Rates show once 5 applications have had an answer or 30 days. |
| Mark | What happened? Reply · Interview · Offer · Rejection · Undo |
| Mark note | Replies that go to your own email don't reach Nori's inbox, so you can mark them here. |
| Inbox empty | Nothing here yet. Codes and replies from employers land here, and Nori uses them to finish applications. |
| Forwarding | Forward a copy to my email · Keep messages for 90 days |

### Part 4c: You

Status: planned and wireframed: the "Dashboard 4c: You" page of the design canvas (desktop and phone, every sub-page,
light and dark in Tweaks, plus an empty graph, Telegram's three states and an unconfirmed email). On 4 Nov the API
gained card editing, the answer bank and an enforced daily limit; the plan and the wireframe both use them (Fix edits
the card in place, "Answers Nori remembered" on the Nori page, and No limit). Specified in
[dashboard-4c-spec.md](dashboard-4c-spec.md), which wins where it and this plan differ. Built and QA'd: 1240 checks in
three engines (the spec's build checklist).

Everything Nori knows about you and every setting, in one place: the career graph Nori matches and tailors from, what
it searches for, what it puts on forms, how it reaches you, and the account.

| Question | Decision |
|---|---|
| Layout | **Four sub-pages under a tab row:** Graph (`/you`), Job search (`/you/search`), Nori (`/you/nori`) and Account (`/you/account`). Each loads only its own data |
| The career graph | **A drawn graph, like Obsidian's graph view:** dots joined by lines, skills joined to the roles, projects and results that used them. Hover or focus a dot and it and its neighbours stay lit while the rest fades; drag, pan and zoom. A **List** view shows the same items as grouped cards; it's also the keyboard and screen-reader route |
| Fixing a card | **Edit in place.** **Fix** turns the card into a form (title, company, what was done, skills, from and to) and saves with `PATCH /api/graph/nodes/:id`. A skill has no Fix, only Remove. (Planned as remove-then-add; the API gained editing on 4 Nov) |
| Autopilot and the answer bank | **The limit and the answers now, autopilot later.** The daily limit is editable and the API enforces it; the page still says "Nori asks before every send. Sending on its own is coming." The answers Nori remembered get their own section on the Nori page (edit an answer, delete one). Autopilot stays on the API's to-do list |

#### What the API already does

| Need | Endpoint |
|---|---|
| The graph | `GET /api/graph`: `nodes` (role, project, metric, education, certification, skill; `props` with title, org, statement, skills, years; dates; `source`, "your resume" or "a fact you added"; `sourceQuote`) and `edges` (fact to skill, `used`) |
| Edit a card | `PATCH /api/graph/nodes/:id` with any of `{ title, org, statement, skills, startDate, endDate }`: dates `YYYY` or `YYYY-MM`, `endDate: null` means current, `org: null` clears it. Returns `{ node }` and re-runs matching. 400 for an empty or invalid edit (an end before the start too), 422 for a skill, 404 not found; 120 an hour. The card keeps its source, so a newer resume still replaces resume cards, edited or not |
| Add a fact, remove one | `POST /api/graph/facts` `{ text }` (3 to 2000 characters, AI-parsed; returns `nodesCreated` and a `note` when the AI was unavailable; 60 an hour); `DELETE /api/graph/nodes/:id` (a skill's id takes that skill off every fact). Both re-run matching |
| A newer resume | `POST /api/profile/resume-file` (PDF, DOCX or text, 10 MB) or `POST /api/profile/resume` (pasted text) |
| Lanes | `GET /api/lanes`; `PUT /api/lanes` with the whole array (name, titles, locations, remote, minFit 0 to 1, enabled; up to 20). Re-runs matching |
| What Nori puts on forms | `GET /api/me`, `PUT /api/profile`: contact, work authorisation, salary expectation, start date, notice period, relocation, clearance, over 18, voluntary EEO answers, `preferences` (salaryMin, excludeCompanies), `autoApplyDailyCap` 0 to 100 |
| The daily limit | `autoApplyDailyCap` above 0 caps approvals per UTC day across the web, Telegram and the worker; 0 is no limit. Approving over it is 429 "Today's limit is used up" and the application stays ready. One approved earlier has already counted and is never refused. `GET /api/agent/status` `usedToday` is the same count |
| The answers Nori remembered | `GET /api/profile/answers` (`id`, `questionText`, `answer`, `source` user, default or model, `lastUsedAt`; most recently used first); `PATCH /api/profile/answers/:id` `{ answer }` (1 to 2000 characters; becomes `source: "user"`); `DELETE /api/profile/answers/:id`. Only the answer can change, not the question |
| Telegram | `GET`, `PUT`, `DELETE /api/channels/telegram`; `POST /api/channels/telegram/link` (a single-use `t.me` link, 15 minutes) |
| Account | `GET /api/auth/session`, `POST /api/auth/resend-verification`, `POST /api/auth/change-password` (signs out every other session), `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `POST /api/auth/sessions/revoke-others`, `DELETE /api/auth/account` `{ confirm }` (the account email) |

#### What the API doesn't do yet (its to-do list)

- **Autopilot:** nothing approves a prepared application on its own. (The daily limit is enforced now.)
- **Change the account email.** Shown read-only.
- **Links between facts.** Edges only join a fact to its skills, so roles and projects meet through shared skills, not
  directly.

#### Graph (`/you`)

- **Top:** "Your career graph" with true counts ("4 roles · 6 results · 23 skills"), **Add a fact** (primary), a
  Graph / List switch kept in the address (`?view=list`), and **Add a newer resume** in a small menu.
- **The graph:** one dot per item, sized by how many links it has, coloured by kind with the theme's tokens (roles
  `accent`, results `peach`, projects, education and certifications their own tints, skills neutral). Labels show on
  the bigger dots, and on any dot under the pointer or focus. Lines are the `used` links. A force layout (`d3-force`,
  about 10 KB, loaded only on this page) is settled before it's drawn, so it doesn't swim in; dragging a dot moves its
  neighbours, but not with reduced motion. Zoom and pan with the wheel, pinch or drag, plus **+**, **−** and **Fit**
  buttons. 560 px tall on desktop, 440 on tablets, 60% of the screen on phones.
- **Filters and search:** chips for Roles, Projects, Results, Education, Certifications and Skills (hide or show a
  kind), and "Find in your graph", which lights the matches.
- **Opening an item:** tap or Enter opens its card, as a side panel on desktop and a sheet on phones: title, company,
  dates, what was done, its skills (each opens that skill), and where it came from ("From your resume: '…'", or "A fact
  you added"). A skill's card shows its years, when it was last used, and the facts that use it. **Fix** (not on
  skills) and **Remove**.
- **Fix:** the card becomes a form in place: title, company, what was done, skills (chips), from and to (a year or a
  month; "I still do this" clears the end). **Save** sends only what changed; the card keeps where it came from. The
  API's errors show by their field ("The end is before the start."). A note under the form: "If you add a newer
  resume, cards from your resume are replaced, including ones you've fixed."
- **Remove:** confirmed in place: "Remove this from your graph? Nori stops using it in matches and resumes." For a
  skill: "Remove Figma from 4 facts?" There's no Undo, since the API can't restore it.
- **Add a fact:** a box, "Something your resume leaves out: a project, a result with a number, a tool you use." **Add
  it** reports what the API made ("Added 3 to your graph."), and the new dots pulse once. The API's limit and
  AI-allowance messages show as they come.
- **List view:** roles as a timeline, then projects, results, education and certifications as cards, then skills as
  chips with years. The same card opens from each.
- **Empty:** "Your graph is empty. Add your resume or a fact and Nori builds it from there."

#### Job search (`/you/search`)

- **Lanes:** one card per lane: its name, job titles and places as chips (or Remote), the lowest fit Nori shortlists
  (50 to 90%), and an on/off switch. **Add a lane** (up to 20), **Remove**. **Save** sends the whole list: "Saved. Nori
  looks again with these."
- **Everywhere:** the lowest salary to consider, and companies to skip, as chips.

#### Nori (`/you/nori`)

- **Daily limit:** how many applications a day (1 to 100, or **No limit**), and "2 sent today". "Nori asks before
  every send. Sending on its own is coming." and "The count starts again at midnight UTC."
- **Answers Nori remembered:** each question as the form asked it, your answer, where it came from ("You told Nori",
  "Your default", "Nori's draft") and when it was last used, most recent first. **Edit** changes the answer only (1 to
  2000 characters; saving makes it yours, so Nori never overwrites it) and **Delete** asks first. Empty: "Nothing yet.
  When a form asks something new, your answer is kept here for next time."
- **What Nori puts on forms:** the onboarding answers, editable in three groups (Contact, Work authorisation, Standard
  questions), each with its own Save. These are the fields onboarding collected, edited with the same controls.
- **Telegram:** not switched on: "Telegram isn't switched on yet." Not linked: **Connect Telegram** opens the bot link
  and the page waits for the link, up to 15 minutes. Linked: the morning list's time and how many jobs, the evening
  summary's time, quiet hours, the time zone, which messages to get, and **Disconnect**.

#### Account (`/you/account`)

- **Email:** shown read-only, confirmed or not, with **Send the link again** when not.
- **Password:** current and new, with "Changing it signs you out everywhere else."
- **Where you're signed in:** each device with when it signed in, "This device" marked; **Sign out** on each, and
  **Sign out everywhere else**.
- **Theme:** System, Light and Dark, the same switch as the account menu.
- **Delete your account:** type your email to confirm. "Everything goes: your graph, applications, inbox and resumes.
  This can't be undone."

#### Fixes to the built parts

- The rail's cap note says "Nori sends up to your cap without asking." when the limit is above 0. That isn't true:
  nothing sends on its own. It becomes "Nori asks before every send." for every limit, and the 4a spec changes with it.
- Approving over the limit now fails with 429. **Send it** shows the API's words ("Today's limit is used up.") and
  leaves the application ready; **Send all** stops at the first 429 and says how many went and that the rest wait
  for tomorrow.

#### Nori in 4c

`preparing` (thinks) while a fact or resume is being read, then a hop with "Added 3 to your graph."; `searching` when
lanes are saved; `hello` when Telegram links; `password-done` after a password change. Nothing on removal or account
deletion.

#### Copy (draft, 4c)

| Place | Words |
|---|---|
| Graph counts | 4 roles · 6 results · 23 skills |
| Add a fact | Something your resume leaves out: a project, a result with a number, a tool you use. · Add it |
| Added | Added 3 to your graph. |
| Fix | Fix · Save · Cancel · I still do this · If you add a newer resume, cards from your resume are replaced, including ones you've fixed. |
| Remove | Remove this from your graph? Nori stops using it in matches and resumes. · Remove · Keep it |
| Lanes saved | Saved. Nori looks again with these. |
| Daily limit | Up to 5 applications a day · No limit · 2 sent today · Nori asks before every send. Sending on its own is coming. · The count starts again at midnight UTC. |
| Over the limit | Today's limit is used up. · Sent 3. The other 2 wait until tomorrow. |
| Answers | Answers Nori remembered · You told Nori · Your default · Nori's draft · Last used 2 Nov · Edit · Delete · Delete this answer? Nori will ask again next time. |
| Telegram | Connect Telegram · Waiting for you in Telegram… · Connected 4 Nov · Disconnect |
| Password | Changing it signs you out everywhere else. |
| Delete | Everything goes: your graph, applications, inbox and resumes. This can't be undone. |

#### Open (4c)

- A big graph (200 or more dots) may need a canvas instead of SVG; the wireframe and build measure it.
- Labels: the wireframe shows the bigger dots' labels on desktop and only the lit ones on phones. The build needs a
  collision step so two labels never overlap (two did in the wireframe's sample).
- Whether **Add a newer resume** adds to the graph or replaces what came from the old resume (the API's `replace`
  flag) is settled in the spec.

### Night Dawn (dark)

| Token | Light (Dawn) | Dark (Night Dawn) |
|---|---|---|
| `bg` | `#FBF4EA` | `#0F1A15` |
| `surface` | `#FFFDF8` | `#16241D` |
| `surface-2` | `#F5EBDD` | `#13201A` |
| `tint` | `#F0E2CF` | `#1F3028` |
| `line` | `#E4D7C4` | `#2B3D34` |
| `line-strong` | `#857A6A` | `#7D8F85` |
| `ink` | `#1F2A24` | `#F4EFE4` |
| `ink-2` | `#55605A` | `#B5C1BA` |
| `accent` | `#2F5D46` | `#86C4A0` |
| `accent-hover` | `#244A38` | `#A3D6B8` |
| `on-accent` | `#FFFDF8` | `#0F1A15` |
| `danger` | `#B23A2E` | `#F08A7E` |
| `warning` | `#8A5A00` | `#E8B75C` |

Measured in dark: ink on bg 15.5:1, ink-2 on bg 9.6:1, accent on bg 8.8:1, on-accent on accent 8.8:1, line-strong on
bg 5.2:1, danger on bg 7.3:1. Every pair passes AA. Nori's sprite is the same in both; nori-pet already themes its
bubble in dark mode.

### Nori in the dashboard

The agent events nori-pet was made for: `shortlist-ready` (a wave with the count) when new jobs arrive, `preparing`,
`prepared`, `applying`, `submitting`, `awaiting-code`, `code`, `submitted`, `needs-user`, `captcha`, `failed`, and later
`reply`, `interview`, `offer`, `rejection` (part 4b) and `cap-reached`. One reaction at a time: the latest application
the live panel shows. In the evening with nothing waiting, Nori falls asleep on the greeting strip.

### Copy (draft, 4a)

| Place | Words |
|---|---|
| Greeting | Good morning, Alex / Good afternoon / Good evening |
| Day line | 3 for today · 1 needs you · 2 of 5 sent today |
| Apply | Apply · Not for me · Undo |
| Ready to send | Ready to send. Check the resume and answers, then send it. · **Send it** |
| Sent | Sent in 18 seconds · View the application |
| Needs you | Nori needs 2 answers to finish this one. |
| Wall | This site asked for a captcha. Nori never gets around those; finish it here: **Open the application** |
| Nothing today | Nothing new today. Nori checks again overnight. |

### Open

- Pro and autopilot: until billing exists, the cap meter says what the cap is. Autopilot (sending without asking)
  isn't in the API yet; part 4c sets the limit and says so.
- Notifications outside the app (email digests, browser notifications): not in part 4; Telegram covers approvals for
  now.
- The evening strip and night strip are two small new scenes (about $0.25).

## Error pages (part 5)

Status: planned and wireframed: the "Error pages" page of the design canvas (desktop and phone, the five pages, Try
again working or not, the dashboard versions in light and dark). The fork scene is take 1 of 2 (`art/raw/fork-1.png`,
built as `fork` and `fork-band`; take 2 was more photographic, with a lake and houses). Specified in
[error-pages-spec.md](error-pages-spec.md), which wins where it and this plan differ. Built and QA'd: 1148 checks in three
engines (the spec's build checklist).

What a visitor sees when an address doesn't exist or something breaks. Today there's nothing of ours: a wrong address
gets Next's plain default 404, and a crash its default error screen. Inside the dashboard, an application or message
that isn't there already has its own "not found" state (4b), and every dashboard page already says when it can't reach
Norinote, so those stay as they are.

### Decided

| Question | Decision |
|---|---|
| Which pages | **Three:** page not found (`not-found`), something broke on a page (`error`, with Try again) and the app failing to start (`global-error`). Signed-out and onboarding redirects already work; no offline page |
| Look | **A new small scene** for the full-page versions, made with the same model, style prompt and pipeline as the others |
| Inside the dashboard | **Inside the shell:** under `/today`, `/applications`, `/inbox` and `/you`, a 404 or an error keeps the rail and tabs, so Today is one click away. Everywhere else, the full page |
| Reporting a problem | **Not yet:** Try again and Go home only. There's no support address or error reporting yet; a way to report comes with hosting and support (landing Phase 6) |

### The pages

- **Page not found, full page** (any address that isn't ours outside the dashboard): the scene, then a short card:
  "This page isn't here", "The link may be old, or the address may have a typo.", **Go to the home page** (primary) and
  **Open your dashboard** (outline; signed-out visitors land on sign-in from there, as now). HTTP 404, not indexed.
- **Page not found, in the shell** (an unknown address under a dashboard section, such as `/today/old` or
  `/you/settings`): the rail and tabs, then a card in the content area with the same words and **Go to Today**. No
  scene: the dashboard has no scenes in its content area, and the Dawn scene would clash with Night Dawn.
- **Something broke** (an error thrown while showing a page): "Something went wrong on this page", "It's not you.
  Try again; if it keeps happening, come back in a little while.", **Try again** (re-renders the page) and **Go to the
  home page**. Full page with the scene outside the dashboard; in the shell inside it. The error's details never show;
  the page has no stack traces, messages or codes.
- **The app failing to start** (an error in the root layout itself, so neither the fonts, the scene nor Nori can be
  relied on): a plain page with its own styles inline, the Dawn colours and system fonts, "Norinote couldn't load",
  "Check your connection, then try again." and **Try again** (reloads). No Nori, no images.

### The scene

**Fork (not found, something broke):** a felt garden path splitting in two at a small wooden signpost whose arrows are
blank, low hedges on either side, the landing page's hills soft in the distance in morning light. A flat stone at the
foot of the post, in sharp focus and empty, for Nori. A portrait crop for the column and a wide crop for phones, as for
the auth scenes, so the page uses the auth layout (scene beside the card from 1024 px, a band above it below).

Budget: about 3 images including retries, roughly $0.25 to $0.75 from the ledger ($4.57 of $24 spent so far). Spent:
2 takes, $0.11 ($4.68 of $24).

### Nori

- **Not found:** `look` (looks around), then sits on the stone; "Hmm, nothing here." in a bubble. In the shell, the
  same at Nori's usual seat.
- **Something broke:** `dizzy`, then `comfort`; "Sorry about that." Try again plays `nod` on the way.
- **Failing to start:** no Nori (the sprites may be what failed).

### Copy (draft)

| Place | Words |
|---|---|
| Not found | This page isn't here · The link may be old, or the address may have a typo. · Go to the home page · Open your dashboard |
| Not found, in the shell | This page isn't here · The link may be old, or the address may have a typo. · Go to Today |
| Something broke | Something went wrong on this page · It's not you. Try again; if it keeps happening, come back in a little while. · Try again · Go to the home page |
| Failing to start | Norinote couldn't load · Check your connection, then try again. · Try again |
| Nori | Hmm, nothing here. · Sorry about that. |

### Budgets and checks

- The same budgets as the auth pages: under 450 KB before the first interaction, LCP under 2.0 s on 4G, CLS under 0.05.
  The failing-to-start page loads nothing but itself.
- QA: every page at the 11 sizes in three engines; the 404's status code; Try again recovering from a thrown error; the
  in-shell versions in light and dark; axe; keyboard; and that no error detail ever reaches the page.

### Open

- Wording for when the API itself is down on a full page (not part of this: pages that need the API already say so).
- A reference code to quote, once there's somewhere to report a problem.

## Privacy and Terms (part 6)

Status: planned, texts drafted in [legal/privacy.md](legal/privacy.md) and [legal/terms.md](legal/terms.md), and wireframed
(the design canvas, page "Privacy and Terms"); the drafts win where they and this plan differ. Next: the spec. The only
unsettled text left is the date, marked `[[like this]]` and filled in when the pages are published; the build must
refuse to ship a page that still has one.

Today `/privacy` and `/terms` are placeholders ("being written"); sign-up already links to both. This part writes the two
texts and the pages that hold them. They say only what the code does: every claim below is checked against the repo,
and where something isn't decided, the text doesn't pretend it is.

### Decided

| Question | Decision |
|---|---|
| Who "we" are | **Norinote, operated by Nori, 34010 10th Street, Union City, California 94587** (for now; see Open), with Nori as its voice |
| Contact | **support@norinote.xyz** for everything: help, data requests, the terms; and that postal address |
| Who it's for | **Anyone 18 or older in the United States.** Not offered in the EU or UK yet, so no GDPR sections, representative or transfer safeguards; the privacy policy covers California (CCPA/CPRA and CalOPPA's Do Not Track statement) |
| Law | **California**, with disputes in the state or federal courts of Alameda County (where the address is), unless the user's own state gives them the right to sue where they live |
| Review | **Published as written,** without a lawyer's review. (Recommended against: these carry legal weight, and the mistakes that matter are the ones a non-lawyer can't see) |
| Voice | Plain English, short sections, the same honesty rules as the landing page. A summary at the top of each, then the full text |

### What Norinote handles (from the code)

| Data | Why | Where | How long |
|---|---|---|---|
| Account: email, password (hashed), name | Sign-in, account emails | Supabase (Postgres, us-west-1) | Until the account is deleted |
| Sessions: a cookie (`norinote_session`, httpOnly) and the device it was made on | Staying signed in | Supabase | 30 days, or until signed out |
| Resume (the text and the file) | Building the career graph, tailoring | Supabase (Postgres and Storage) | Until replaced or the account is deleted |
| Career graph, facts you add | Matching and tailoring | Supabase | Until removed or the account is deleted |
| Profile: contact details, work authorisation, salary, start date, notice, relocation, clearance, over 18 | Filling in application forms | Supabase | Until changed or the account is deleted |
| Voluntary self-identification (gender, race or ethnicity, veteran status, disability) | Only where an application asks, and only as you chose | Supabase | Until changed or the account is deleted |
| Lanes and preferences | Finding jobs | Supabase | Until changed or the account is deleted |
| Answers Nori remembered | Reusing your answers on later forms | Supabase | Until edited, deleted, or the account is deleted |
| Applications: what was sent, the tailored resume, screenshots of the form, the run log | Your record, and showing what Nori did | Supabase (Postgres and Storage) | Until the account is deleted |
| Nori's inbox: messages to your Nori address (text, sender, subject; attachments' names and sizes, never their content) | Codes and replies for applications | Supabase | 90 days by default (you can shorten it), forwarded to your email if you turn that on |
| Telegram (if you connect it): your chat id | Sending you the messages you chose | Supabase | Until you disconnect |
| In your browser: the theme, what's new in the inbox, what you last saw | Remembering your choices on that device | Your browser (local storage) | Until you clear it |

**Who else handles it (processors):** OpenAI (reading resumes and job posts, scoring, tailoring, drafting answers),
Supabase (database and files), Fly.io (the API and the worker), Vercel (the website), Resend (account emails),
Cloudflare (receiving mail for Nori's inbox, DNS), Telegram (if you connect it). Your browser loads company logos from
Brandfetch's image server, which sees your IP address and the page's origin. **Employers** receive what an application
sends, through their own application systems (Greenhouse, Lever, Ashby), and only after your OK.

**What it doesn't do:** no analytics or tracking, no advertising, no selling or sharing data for ads, no cookies other
than the session. Deleting the account deletes everything above (stored resumes included); what an employer already
received is theirs, under their own policy.

### The privacy policy

1. A summary in a few lines: what we keep, why, who else sees it, that we don't sell it, and how to delete it.
2. Who we are and how to reach us (support@norinote.xyz).
3. What we collect and why, as the table above, with the legal basis for each use (GDPR): the contract (running the
   service you signed up for), your consent (voluntary self-identification, Telegram, forwarding), legitimate interests
   (security, preventing abuse).
4. Who else handles it: the processors and employers above, and that the data is stored and processed in the United
   States, with the safeguard used for transfers from the EU and UK.
5. How long we keep it, and what deleting the account does.
6. Your rights: access, correction, deletion, export, objecting, withdrawing consent; and for California, the right
   to know, delete and correct, and that we don't sell or share personal information. How to use them (the app's own
   controls first, then support@norinote.xyz), and that you can complain to your data protection authority.
7. AI: what's sent to OpenAI and why; that it isn't used to train their models under OpenAI's API terms (as stated
   by OpenAI for API data); that Nori only writes from your own facts.
8. Security, in plain terms: passwords hashed, sessions httpOnly, data encrypted in transit; no promise beyond that.
9. Children: not for anyone under 18.
10. Changes to the policy, and the date it last changed.

### The terms

1. A summary in a few lines.
2. Who can use Norinote: 18 or older; one account each; true details.
3. What Norinote does: finds jobs, tailors your resume and answers from your own facts, and applies **only with your
   OK**, on the systems it supports; it never creates accounts with employers or gets around captchas. No promise of
   interviews, jobs or any result.
4. What you agree to: that what you give Nori is true and yours to give; that you've checked what's sent (you OK
   every application); that you're responsible for applications sent in your name; that you'll follow the employers'
   and job sites' own terms.
5. Acceptable use: no misrepresentation, no applying for someone else, no attacking or overloading the service, no
   scraping it.
6. Plans: Free, and Pro at $9 a month as the landing page says. Until billing exists there's nothing to pay; billing,
   renewal and cancellation terms are added before anyone is charged. Nothing about autopilot until it exists.
7. The code is open source (MIT, `premxai/Norinotes`); the licence covers the code, these terms cover the service.
8. Your content stays yours; you let Norinote use it only to run the service for you.
9. Third-party services (employers' systems, job boards, Telegram): not ours, their terms apply.
10. Ending: delete your account any time; we may suspend accounts that break these terms.
11. The service as it is: no warranties beyond what the law requires; the limits of liability the law allows.
12. Changes, the law that applies (see Open), and contact.

### The pages

`/privacy` and `/terms`, outside the dashboard, in the Dawn theme: the landing page's nav and footer, then a readable
column (about 680 px) with the title, "Last updated …", the summary in a tinted box, a list of sections that jumps to
each, and the full text. No scene; Nori sits beside the title, reading (`read`), and says nothing. Each page links to
the other. Both are indexed.

### Open

- **The operator's name.** "Nori" at the Union City address is a placeholder for now. Replace it with the legal name of
  the person or company running Norinote before launch.
- **Data processing agreements** with OpenAI, Supabase, Fly, Vercel, Resend and Cloudflare: the user is accepting them.
- **support@norinote.xyz** must deliver before the pages are published: the user is setting it up.
- **Billing terms** (renewal, cancellation, refunds) before Pro charges anyone.
- **Inbox forwarding isn't sent yet** (the worker uses a stub forwarder that only logs). The texts leave forwarding out;
  add it back (Resend) when it's real.
- **No export in the app.** The privacy text offers a copy of your data by email; an export button would make that
  self-service.
- **EU and UK users later.** Serving them brings back GDPR's legal bases, a controller identity, an EU and a UK
  representative, and transfer safeguards.

Settled since the plan: deleting an account now deletes its application screenshots and traces too (`8333ef9`), as the
privacy text says; and the landing page no longer promises autopilot or payment as if they existed (the Pro card says
"Coming soon · nothing is charged yet", the FAQ and "You stay in charge" say autopilot is coming, and the sign-up chip
says "free until Pro launches").
