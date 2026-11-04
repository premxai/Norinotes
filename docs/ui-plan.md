# Norinote UI plan

Status: the landing page is built and passed QA (`apps/landing`). Sign-in and sign-up are planned, wireframed and
specified, and are next to build. Onboarding and the dashboard follow, in that order.

Nori, the plush rice ball, is the guide on every surface. It ships as `nori-pet/` (`@norinote/nori-pet`); its README
lists every animation (row), event and API call this plan uses.

## Roadmap

Four parts, one at a time. Each one is planned and wireframed, then built, before the next one starts.

| # | Part | Pages | Status |
|---|---|---|---|
| 1 | Landing | `/` (plus `/privacy` and `/terms`) | Built and QA'd in `apps/landing` ([landing-design-spec.md](landing-design-spec.md)). Phase 6 (launch) waits on its open items |
| 2 | Sign-in and sign-up | `/signin`, `/signup`, plus `/forgot-password`, `/reset-password`, `/verify-email` | Planned, wireframed and specified ([auth-design-spec.md](auth-design-spec.md)). Next: build |
| 3 | Onboarding | `/onboarding` (steps to be planned) | Not started |
| 4 | Dashboard | `/dashboard` and its views | Not started |

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
(`art/scenes.mjs` gate and nook, takes `gate-2` and `nook-2`). Specified in [auth-design-spec.md](auth-design-spec.md), which wins where it and this plan differ. Next: build.

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

Not planned yet. Same theme, Nori and scenes.

## Dashboard (part 4)

Not planned yet. It replaces `apps/web` when it's ready. Unlike the landing page, it needs both light and dark modes.
