# Privacy and Terms design spec

The rules to build part 6 from: `/privacy` and `/terms`. [ui-plan.md](ui-plan.md) (part 6) says what the pages hold
and why, and the two texts say it in full. This file says how the pages are built, look and behave, then gives the
build checklist. The wireframe (the "Privacy and Terms" page of the design canvas) follows these rules. Where they
disagree, this file wins.

It builds on [landing-design-spec.md](landing-design-spec.md) (Dawn, type, the nav and footer, Nori on the landing
page) and [auth-design-spec.md](auth-design-spec.md) (Nori's seats), which aren't repeated.

Status: decided, except the items under [Still open](#11-still-open).

## 1. Decisions at a glance

| Area | Decision |
|---|---|
| Source of the text | The two Markdown files, moved to `apps/landing/content/legal/`. The pages render them at build time; nobody copies text into components |
| Rendering | A small renderer for the subset the texts use, on the server only. No Markdown library, no client JavaScript of its own |
| Unsettled text | `[[…]]` fails the production build, so a page can't ship with a gap. In development it shows as a yellow mark |
| Look | Dawn only, the landing page's nav (solid from the start) and footer, one 680 px column. No scene |
| Nori | Beside the title, reading (`read`, looping). Says nothing, reacts to nothing but a pet |
| Who it's for | People in the United States. The texts say so; the pages add nothing of their own |
| Indexing | Both indexed, with a description and a canonical address |

## 2. Routes and files

| File | What |
|---|---|
| `content/legal/privacy.md`, `content/legal/terms.md` | The texts, moved from `docs/legal/` (`git mv`) without the draft note above "Last updated". `docs/ui-plan.md` links to them there |
| `lib/legal.ts` | `readLegal(name)`: reads the file, checks it (section 4), and returns `{ title, updated, summary, sections }` |
| `components/legal/LegalPage.tsx` | The page: header, summary, contents, sections, the link to the other page (server component) |
| `components/legal/Blocks.tsx` | Paragraphs, lists, tables (and their phone cards), and inline text: bold, code, links, email addresses |
| `app/(marketing)/privacy/page.tsx`, `terms/page.tsx` | `export const dynamic = "force-static"`; metadata (section 9); `<LegalPage doc={readLegal("privacy")} other="terms" />` |
| `components/Nav.tsx` | A `solid` prop (no hero on these pages), and its links become `/#how`, `/#pricing`, `/#faq` when not on the home page |
| `components/NoriStage.tsx`, `lib/seat-nori.ts` | `/privacy` and `/terms` get a `legal` controller (section 7) instead of the landing page's choreography |
| `components/ComingNext.tsx` | Deleted: these two pages were its last users |
| `tests/qa-legal.mjs` | `npm run qa:legal` (section 10) |

## 3. Layout

- **Nav:** the landing page's, solid from the first frame (the 64 px bar with its line), sticky. Its section links go
  to the home page's sections.
- **Column:** `max-w-[42.5rem]` (680 px), centred, `px-[var(--page-x)]`, `pt-12 pb-section` (desktop `pt-16`).
- **Header:** the label "Legal" (`font-mono text-label text-ink-2`, uppercase like the section eyebrows), the title
  (`font-serif text-auth`, the auth pages' heading size), and "Last updated 4 November 2026" (`text-small text-ink-2`,
  the date written out). Nori's seat sits to the title's right: 128 px outside the column from `laptop` (where the page
  has the room), 76 px inside it below that, the title wrapping before it.
- **Summary:** a `bg-tint rounded-card p-6` box: "In short" (`font-semibold text-small`) then the summary (`text-lead`).
- **Contents:** "On this page", a `<nav aria-label="On this page">` with an ordered list of the section titles without
  their numbers (the list numbers them). Two columns from `tablet`. `bg-surface border-[1.5px] border-line rounded-card`.
- **Sections:** each a `<section aria-labelledby>` with a top line (`border-t-[1.5px] border-line pt-6`) and an `<h2>`
  (`font-serif`, 30 px desktop, 26 px phones, `scroll-mt-20` so the sticky nav doesn't cover it).
- **Body text:** 17 px, line height 1.65, `text-ink`; paragraphs and list items 14 px apart; lists with bullets,
  22 px indent.
- **Links:** underlined, `decoration-accent`, `underline-offset-[3px]`, as everywhere on the landing page. Email
  addresses are `mailto:` links.
- **The other page:** last, "Also read the terms of service." (or the privacy policy), linking to it.
- **Footer:** the landing page's.

The gaps are 22 px between header, summary, contents and sections on phones, 28 px from `laptop`.

## 4. The text

**The subset.** The renderer reads, in order: `# Title`; `Last updated: …`; one `> ` blockquote (the summary, its
"**In short.**" dropped because the box has its own heading); then `## n. Title` sections holding paragraphs, `- `
lists (continuation lines indented two spaces) and `|` tables (the first row is the header). Inline: `**bold**`,
`` `code` ``, `[text](href)`, and bare email addresses. Anything else (a `###`, a numbered list, an image, raw HTML)
throws, naming the file and line, so the text can't quietly use something the page doesn't show.

**Checks, at build time.**
- `[[…]]` anywhere: throws in production builds (`NODE_ENV=production`); in development, renders as a `<mark>`
  (`bg-[#FFF1B8] border border-dashed border-[#D9A800]`), as in the wireframe.
- `Last updated:` must be a date (`YYYY-MM-DD` in the file); the page writes it out ("4 November 2026") in a `<time
  dateTime>`.
- Section numbers run from 1 without gaps.
- Links: `/privacy`, `/terms`, `/#…` and `https://` only. `/#pricing` keeps working as the home page's section.

**Anchors.** Each section's id is its title without the number, as a slug: `who-we-are`, `what-we-collect-and-why`.
Stable across renumbering, readable in a shared link.

**Tables.** From `tablet` up: a real table in a `bg-surface border-[1.5px] border-line rounded-card` box, `text-small`,
a visually hidden `<caption>` (the section title), `<th scope="col">` headers in `font-mono text-label text-ink-2` on
`bg-surface-2`, the first cell of each row a `<th scope="row">`. If it's still wider than the column it scrolls
sideways inside its box, which is then focusable (`tabIndex={0}`, `role="region"`, labelled by the caption).
Below `tablet`: one card per row instead (the first cell as its heading, then each other cell under its column's name
in `font-mono text-label`), as an `<ul>` of cards. Both are in the HTML; the one not shown is `hidden` at that width.

**Both pages.**

| | Privacy | Terms |
|---|---|---|
| Title | Privacy policy | Terms of service |
| Sections | 10 | 12 |
| Tables | 2 (what we collect, who else handles it) | none |
| Links out | `/terms`; support email | `/privacy`, `/#pricing`, GitHub, support email |

## 5. Print

Legal pages get printed and saved as PDFs. `@media print`: no nav, footer, Nori or contents box; black text on white;
links print their address after them (`a[href^="http"]::after`); tables always as tables, never cards; sections avoid
breaking right after their heading (`break-after: avoid` on `h2`).

## 6. Components

- `LegalPage({ doc, other })`: section 3's layout. Server component; `Nav`, `Footer` and Nori's seat are the only
  client pieces on the page, and all three already exist.
- `Blocks`: `Paragraph`, `List`, `Table` (with `TableCards`), `Inline`. Inline parsing returns React nodes, never HTML
  strings: no `dangerouslySetInnerHTML` anywhere.
- `readLegal(name: "privacy" | "terms")`: `fs.readFileSync` of `content/legal/<name>.md` at build time, parsed and
  checked. The result is plain data, so `LegalPage` can be tested on it.

## 7. Nori

- **Seat:** `data-nori-seat="legal"` beside the title (section 3). `NoriStage` treats `/privacy` and `/terms` as kind
  `legal`.
- **Controller:** `startLegalNori` = `startSeatNori` with seat `["legal"]`, no greeting (`idle`, key
  `norinote-legal-greet`), and `laterRows: ["read"]`. Once seated and the page has settled, Nori plays `read`, which
  loops (6 frames, about 1.8 s), and keeps reading.
- **Reduced motion:** `read`'s first frame, still, as Nori's other loops do.
- **Pet:** the usual reaction. No bubble, no `say`: Nori never speaks on these pages.
- **Arriving from the landing page:** Nori walks to the seat as it does between the landing and auth pages.

## 8. Accessibility

- One `<h1>`; an `<h2>` per section; landmarks: the nav, `main#main` (the skip link's target), the contents nav, the
  footer.
- The contents list is the page's keyboard shortcut: every item is a link to its section. Following one moves the
  browser's focus starting point to that section, so the next Tab is inside it; no script is needed.
- Tables as in section 4; cards as a list, each card's heading a `<p>` in `font-semibold`, not a heading (12 rows
  would flood the outline).
- 200 % zoom and 320 px wide: no sideways page scroll; only a table's own box may scroll.
- Contrast: the Dawn tokens, already checked; the development mark isn't shipped.
- axe: no violations at 390 and 1440 px.

## 9. Performance and SEO

- **Static:** both pages are prerendered (`○` in the build output). No API calls.
- **Weight:** under 300 KB before the first interaction at 390 px (4G, 4x CPU); no images but Nori's strip and the
  logo. LCP (the title) under 1.5 s. CLS under 0.05: the seat's box is sized before Nori arrives, so the title
  never moves.
- **Metadata:** title "Privacy policy" and "Terms of service" (the root template adds "· Norinote"); description, the
  summary's first sentence; `alternates.canonical`; indexed (no `robots` override). The root's Open Graph image is
  kept.

## 10. QA

`tests/qa-legal.mjs`, on the QA build, Chromium, Firefox and WebKit, 390 × 844 and 1440 × 900:

- **Status and metadata:** 200, the titles, the canonical, indexable, prerendered.
- **Text:** no `[[` in the HTML; the summary, every section and every table row rendered (counted against the
  Markdown); each section's id as section 4 says.
- **Facts against the code:** the session length in the text equals the API's `sessionDays` default; the inbox's 90
  days equals `INBOX_RETENTION_DAYS`'s default; 1 to 365 equals the retention setting's range; Greenhouse, Lever and
  Ashby are the drivers `packages/apply` registers. The test reads the source files (it changes nothing), so a change
  in the code that makes the text untrue fails here.
- **Links:** every contents link scrolls its heading into view below the nav, and the next Tab lands inside that
  section; every link resolves
  (the in-site ones 200, `mailto:` well formed); the nav's section links go to the home page.
- **Layout:** cards below `tablet`, tables from it; no sideways page scroll at 320 px and at 200 % zoom.
- **Print:** `emulateMedia({ media: "print" })`: no nav, footer, Nori or contents; tables shown.
- **Nori:** seated beside the title, playing `read`; still under reduced motion; never a bubble.
- **Accessibility:** axe, keyboard (every stop shows the focus ring), the outline (one `h1`, then the `h2`s in order).
- **Budgets:** section 9's.
- **The rest:** the landing, auth and error suites still pass (the nav and `NoriStage` change).

## 11. Still open

- **When the pages go live.** The build fills "Last updated" with the day it's committed. Committing it waits for the
  user's word that `support@norinote.xyz` delivers and the providers' data processing terms are accepted, since the
  texts rely on both. QA runs with a test date until then.
- **The operator's name** stays "Nori" until the user gives the legal name (the plan's Open list).

## 12. Build checklist

### Phase 1: text and renderer
- [ ] Move the texts to `content/legal/` and drop the draft notes; update the plan's links.
- [ ] `lib/legal.ts`: the subset, the checks and their errors, anchors.
- [ ] `Blocks`: paragraphs, lists, tables and cards, inline.

### Phase 2: pages
- [ ] `LegalPage`, the two routes and their metadata; delete `ComingNext`.
- [ ] `Nav`'s `solid` prop and home-page links; print styles.

### Phase 3: Nori
- [ ] The `legal` seat, `startLegalNori`, and `NoriStage` choosing it.

### Phase 4: QA
- [ ] `tests/qa-legal.mjs` and `npm run qa:legal`; the earlier suites.
