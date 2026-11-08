# Dashboard v2: the plan

The upgraded dashboard, agreed section by section before anything is built. Each section is written here first, then
wireframed on the design canvas, then built and QA'd, one at a time.

Status: **building (MVP for the hackathon demo).** Every section is agreed and wireframed; the foundation and the
section MVPs were built on 2026-11-07. Decided by the user on 2026-11-07: scheduling is **free** for now; the Overview
header art is generated (felt hills, light and dark); /signup may sit at 455 KB; features with no place in v2 (batch
history, minutes between applications) are dropped for now. Still open: the Privacy, Terms, FAQ and landing wording for
autopilot, Gmail and graph sources (after the demo).

## The rail

Top to bottom:

1. **Overview** (replaces Today)
2. **Jobs**
3. **Applications**
4. **Tracker**
5. **Inbox**
6. **Nori**
7. **Career graph**
8. **Settings**

And the person's name at the foot of the rail.

Still to decide: where today's "You" pages go (career graph, job search preferences, Nori's settings, account), and
the phone layout (eight sections don't fit a tab bar; suggested: four tabs and More).

## 1. Overview

Agreed:

- **Header:** an illustrated image with a greeting for the person ("Good evening, Prem").
- **Four recommended jobs** as cards, with **View all** (to Jobs). Cards are clean rounded squares, not long
  rectangles: four across on a wide screen, three on a smaller one, fewer on phones. They should look premium.
- **Activity graph** under the cards, in the style of GitHub's contribution graph: one square per day, darker the more
  applications were sent that day.

That's all on Overview.

Decided (suggestions accepted):

- **What a square card shows.** Suggested: company logo, job title (two lines at most), company and place, the match
  chip, and one action (Apply), with Save if Save exists by then.
- **The graph's span.** GitHub shows a year (52 weeks by 7 days). Suggested: the last 6 months, scrolling sideways on
  phones, with a legend (less, more) and a total ("34 applications in the last 6 months").
- **What counts on the graph:** applications sent only (suggested), or also replies and interviews.
- **Where "Nori needs you" goes,** now that Overview doesn't have it: a dot on Applications or Nori in the rail, or a
  slim bar at the top of every page.
- **The header image:** new art is needed (the current scenes are photographic). It goes through the image budget.

## 2. Jobs

Agreed: follow the reference layout (a list beside the selected job), in Norinote's theme.

- **Top:** a search bar, then tabs: **All**, **Recommended**, **Saved**, **Applied**.
- **Left, the list:** a header row ("Jobs", with All filters and a location switch such as Worldwide). Each row:
  logo, job title, company and place, the date posted, the pay when the listing gives it, and tags (job type and
  so on). The selected row is tinted.
- **Right, the job:** clicking a row opens it here. Logo, title and company; **Offering** (the pay) when the listing
  gives it; tabs **Overview**, **Company**, **Insights**, **Review**; Overview reads **About the role** and **What
  you'll do**, each with a small illustration.
- **The call to action** (decided): **Apply** sits in the job's header, top right, with **Save** beside it,
  and stays pinned at the top of the right panel as the description scrolls. Rows in the list carry no Apply button,
  so the list stays clean and nobody applies by a stray click. On phones the job opens on its own screen with Apply
  and Save pinned at the bottom.

Decided (suggestions accepted):

- **What the Company, Insights and Review tabs hold.** Suggested: Company = what we know of the employer (size, what
  it makes, where it hires); Insights = why it matches you (the reasons and the match score); Review = what Nori would
  send before you apply (the tailored resume changes and the answers it already knows, plus anything it would ask).
- **Real data only.** Pay shows only when the listing states it (most don't); tags come from the listing. Search across
  all jobs, the location switch, filters and Saved each need backend work: today the API only has your matches
  (`/api/shortlist`) and one job (`/api/jobs/:id`).
- **What All and Recommended mean.** Suggested: All = every open job in your job search (titles and places you chose),
  Recommended = your matches, best first.

## 3. Applications

Agreed: the same layout as Jobs (a list beside the selected one), for the jobs the person has started applying to,
one by one or through Nori.

- **Left, the list:** each row is a job with a small status chip: **Optimizing resume**, **Applying**, **Needs help**,
  **Applied**, and the others it can end in (didn't go through, cancelled).
- **Right, by status:**
  - **Applied:** two things to open: **the resume that was sent** and **the screenshot of the application** after
    Submit.
  - **Applying (in progress):** **watch it live**: the employer's form filling in, step by step (Watch Nori apply).
  - **Needs help:** what Nori couldn't fill, as a form to fill here. Once filled, the run carries on, live.
- **What happens after Apply** (from Jobs), shown on the right as it goes:
  1. **Optimizing your resume:** a loading animation, no resume shown.
  2. **Resume ready:** it's stored in the application's **Resume** section (on the right), not shown full screen.
  3. **Filling the application:** the live view, step by step, until it's sent or needs help.

Decided (suggestions accepted):

- **Apply means send.** In this flow pressing Apply starts it all, with no "Ready for your OK" step between the resume
  and the form (today there is one: Send it). Suggested: yes, Apply is the approval; the button and the Terms already
  allow it ("you approve each application", one at a time). To confirm.
- **The Resume section:** suggested as a tab or panel on the right for that application (the tailored resume, what
  changed, Download PDF), next to the screenshot once it's applied.
- **After it's applied:** do the stepper (Applied, Waiting, Interview, Offer), your notes, "Next action" and the
  outcome chips (reply, interview, rejected) from the earlier Applications design stay here, or does Tracker hold
  outcomes now?
- **Add applications** (ones applied to outside Norinote) from the earlier design: keep or drop.
- **Emailed codes** count as Applying (the live view shows "Waiting for the code", and the code box when Gmail isn't
  connected), not as Needs help.

## 4. Tracker

Agreed: plain and static. A plain background with no header image, illustration or extras; just the content.

As built (to confirm it stays): the headline numbers (sent, replies, interviews, offers, response rate), the 7 days /
30 days / 90 days / All switch, and the flow diagram of where applications went, whose steps open the matching
applications.

## 5. Inbox

Agreed: keep the Inbox as it is (the list of messages beside the open one, codes large with Copy, settings folded at
the top). Change it only where the other sections require, for consistency:

- the new rail and the person's name at its foot;
- the same visual language as Jobs and Applications (list rows, the selected row tinted, panel shapes);
- a message linked to an application opens that application in **Applications** (the new layout), and a verification
  code that Nori already used says so.

## 6. Nori

Agreed: Nori is where you **talk with your agent**. In the conversation you can:

- ask and set **which roles** it looks for, and **add a role**;
- set the **daily cap**;
- set the **threshold score** (the match score a job needs);
- **schedule** applying, or **apply now**.

Auto-apply only ever takes the **Recommended** jobs (the Jobs tab), never all jobs.

Decided (suggestions accepted):

- **A setup panel beside the chat** (suggested): the current roles, daily cap, threshold and schedule shown as a small
  card that the conversation edits, so the settings are visible at a glance and not only in the chat history. Every
  change Nori makes from a message is shown back ("Daily cap set to 15") and can be undone.
- **What Recommended means:** suggested, your matches in your roles at or above your threshold score. Raising the
  threshold shrinks it; that's the control.
- **Schedule is in (decided).** "Apply now" sends the Recommended jobs once; a schedule sends new Recommended jobs on
  its own, within the daily cap and above the threshold, without the person seeing each one. This is autopilot, so
  before it ships: the Terms, Privacy, FAQ, landing copy ("You approve what's sent", "never applies to a job you
  didn't pick", "Autopilot is coming with Pro") and the pricing cards are rewritten to describe it, and it's decided
  whether scheduling is free or Pro. Still to decide: how a schedule is set (days and a time, such as weekdays at
  9 am, in the person's time zone), how it's paused, and what Nori sends afterwards (Telegram or email summary).
- **Where today's Nori page parts go:** suggested, Needs you and the live run → Applications (Needs help, Applying);
  Gmail and Telegram → Settings; batch history → Applications and Tracker.
- **Greenhouse only for now:** auto-apply sends Greenhouse applications only (the API enforces it); the chat should say
  so when asked to apply.
- **Backend:** a chat endpoint that understands these requests and calls the existing settings, lanes and batch APIs,
  plus a scheduler for scheduled runs. None of this exists yet; it also spends AI tokens per message.

## 7. Career graph

Agreed: a section of its own, below Nori. The graph is built from the person's resume plus what can be found about
them online (GitHub repos and projects, and other public work), stored, and used by the agent: resume optimization
pulls its facts from it.

- **The page shows only the graph** (the Obsidian-style one: dots for roles, projects, skills, certifications and
  results, joined by lines) **and Add fact**.
- **Add fact:** the person adds anything the graph missed, in their own words (a project, an experience, a
  certification, anything). Nori reads it and the new dots appear in the graph.

Decided (suggestions accepted):

- **Correcting the graph.** Suggested: clicking a dot shows a small card with where the fact came from (resume line,
  GitHub repo, added by you) and Fix and Remove, so a wrong fact can't end up on a resume. Without it the page is
  only the graph and Add fact.
- **Where online facts come from.** Suggested: only sources the person connects or names (their GitHub account, a
  personal site, a LinkedIn URL they paste), never a search for them by name; each dot from those says its source.
  This needs a GitHub connection and reader on the backend, and the Privacy policy must describe it (what's read,
  that it's stored, how to remove it).
- **What happens to today's graph tools** (filters by kind, search, zoom, the list view): suggested, keep zoom and
  search, drop the rest to match "only the graph".

## 8. Settings

Agreed:

- **Account:** email, password, signed-in devices, theme (light or dark), and delete the account.
- **Profile:** contact details and the facts forms ask for (work authorization, start date and so on).
- **Job search basics** the Nori chat doesn't handle: places, salary, companies to skip.
- **Connections:** Gmail (for emailed codes) and Telegram (questions and news while away).

Roles, the daily cap, the threshold score and the schedule are set in the Nori chat, not here.
