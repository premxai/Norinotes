# Norinote UI plan

Status: the landing page is planned and specified, and is next to build. Sign-in and sign-up, onboarding and the
dashboard follow, in that order.

Nori, the plush rice ball, is the guide on every surface. It ships as `nori-pet/` (`@norinote/nori-pet`); its README
lists every animation (row), event and API call this plan uses.

## Roadmap

Four parts, one at a time. Each one is planned and wireframed, then built, before the next one starts.

| # | Part | Pages | Status |
|---|---|---|---|
| 1 | Landing | `/` (plus `/privacy` and `/terms`) | Planned, specified ([landing-design-spec.md](landing-design-spec.md)), wireframed. Next: build |
| 2 | Sign-in and sign-up | `/signin`, `/signup` (two pages) | Not started. Plan and wireframe after the landing page is built |
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

Not planned yet; it starts after the landing page is built. Two pages, `/signin` and `/signup`, in the same theme, with
Nori and generated scenes. Designed fresh.

## Onboarding (part 3)

Not planned yet. Same theme, Nori and scenes.

## Dashboard (part 4)

Not planned yet. It replaces `apps/web` when it's ready. Unlike the landing page, it needs both light and dark modes.
