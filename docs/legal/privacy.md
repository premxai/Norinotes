# Privacy policy

Draft for `/privacy` (part 6). Every statement is checked against the code; see "What Norinote handles" in
[ui-plan.md](../ui-plan.md). Text in `[[double brackets]]` is not settled and must be filled in before publishing (the
build refuses to ship a page that still has one).

Last updated: [[the date it's published]]

> **In short.** Norinote keeps what it needs to find jobs for you and apply with your OK: your account, your resume and
> the career graph built from it, your profile and preferences, and a record of every application. A few services run
> it for us, and employers see an application only after you've approved it. There's no tracking, no advertising, and we
> don't sell your data. You can change or delete it in the app, and deleting your account deletes all of it.

## 1. Who we are

Norinote is a job agent: Nori, its assistant, finds jobs that fit you, tailors your resume and answers from your own
facts, and applies only with your OK. "We" and "us" in this policy mean Norinote, operated by [[the operator's legal
name and address]].

Questions about this policy, or about your data, go to **support@norinote.xyz**.

## 2. What we collect and why

Everything here comes from you, or from what Norinote does for you. We don't buy data about you or look you up
elsewhere.

| What | Why | Kept |
|---|---|---|
| **Your account:** email address, name, and your password (stored only as a scrypt hash, never as you typed it) | Signing in, and emails about your account | Until you delete the account |
| **Sessions:** a cookie that keeps you signed in, and the kind of device and browser it was made on | Keeping you signed in, and listing your devices on the Account page so you can sign them out | 30 days, or until you sign out |
| **Your resume:** the file and its text | Building your career graph, and tailoring | Until you replace it or delete the account |
| **Your career graph:** your roles, projects, skills and achievements, and facts you add | Matching you to jobs, and writing only from what's true about you | Until you remove them or delete the account |
| **Your profile:** contact details, work authorisation, salary, start date, notice period, relocation, clearance, and that you're over 18 | Filling in application forms | Until you change them or delete the account |
| **Voluntary self-identification:** gender, race or ethnicity, veteran status, disability, only if you give them | Answering these questions where an application asks, the way you chose (including "decline to answer") | Until you change them or delete the account |
| **Your job search:** your lanes, places, salary floor and other preferences | Finding jobs that fit | Until you change them or delete the account |
| **Answers Nori remembered:** your answers to application questions | Reusing them on later forms, so you're not asked twice | Until you edit or delete them, or delete the account |
| **Applications:** each job, what was sent, the tailored resume, screenshots of the filled-in form, and a log of what Nori did | Your record of what was sent in your name | Until you delete the account |
| **Nori's inbox:** email sent to your Nori address: the sender, subject and text; for attachments, only their names and sizes (never the files) | Verification codes and replies about your applications | 90 days by default; you can choose 1 to 365 |
| **Telegram, if you connect it:** your Telegram chat id | Sending you the messages you chose (the daily list, questions, updates) | Until you disconnect |

The lawful basis for each (for the EU and UK):

- **Running the service you signed up for** (contract): your account, sessions, resume, career graph, profile, job
  search, remembered answers, applications and inbox.
- **Your consent:** voluntary self-identification, and connecting Telegram. You can withdraw it
  any time in the app, which stops that use from then on.
- **Legitimate interests:** keeping the service secure and preventing abuse, for example the sessions list and limits
  on sign-in attempts.

**In your browser.** The site keeps a few settings in your browser's local storage, such as the theme and which inbox
messages you've seen. They stay on your device and aren't sent to us. The only cookie is the session cookie above:
there are no analytics, advertising or tracking cookies, so there's nothing to accept.

## 3. Who else handles it

A few companies run parts of Norinote for us. They handle your data only to provide their service to us, under their
data processing terms.

| Company | What for | Where |
|---|---|---|
| OpenAI | Reading your resume and job posts, matching, tailoring, and drafting answers (see section 7) | United States |
| Supabase | The database and stored files | United States (California) |
| Fly.io | Running the API and the worker that applies | United States (California) |
| Vercel | Hosting this website | Global network |
| Cloudflare | Receiving mail for Nori's inbox, and the domain's DNS | Global network |
| Resend | Sending account emails (verification and password resets) | United States |
| Telegram | Messages between you and Nori, only if you connect it | Telegram's own servers |

**Company logos** on job cards load from Brandfetch's image server, which sees your IP address and that the request
came from Norinote, as any website you visit would.

**Employers.** When you approve an application, what it sends (your answers, your tailored resume, and the profile
details the form asks for) goes to that employer through its own application system (such as Greenhouse, Lever or
Ashby). From then on the employer handles it under its own privacy policy. Nothing goes to an employer without your
OK.

We don't sell your personal information, share it for advertising, or give it to anyone else, except where the law
requires us to.

**Transfers.** Norinote is run from the United States. If you're in the EU, UK or Switzerland, your data is transferred
there under [[the safeguard: the EU-US Data Privacy Framework and its UK extension, or the standard contractual clauses,
as each provider's data processing terms set out]].

## 4. How long we keep it

As the table in section 2 says: most things until you change them or delete your account, sessions for 30 days, and
inbox messages for 90 days unless you choose otherwise.

**Deleting your account** (Account, then Delete account) deletes your account and everything in section 2 at once,
including your stored resumes and the screenshots of your applications. It can't be undone. What an employer has
already received stays with that employer.

## 5. Your rights

Wherever you live, you can:

- **See and correct** your data: most of it is on the You and Applications pages, where you can change it.
- **Delete** it: remove any fact, answer or lane in the app, or delete your account.
- **Get a copy** of it in a machine-readable form: email us and we'll send it.
- **Object** to a use of it, or **withdraw consent** you gave (section 2).
- **Complain** to your data protection authority, if you're in the EU or UK.

**California.** You have the right to know what personal information we collect, use and disclose (this policy sets it
out), to delete it, and to correct it, and not to be treated differently for using these rights. We don't sell or
share personal information, as the CCPA defines those words, and we don't use sensitive personal information for
anything other than providing the service you asked for.

To use a right the app doesn't cover, email **support@norinote.xyz** from your account's email address. We'll answer
within a month (45 days for California requests), and we may ask you to confirm it's you.

[[If an EU or UK representative is appointed: "Our representative in the EU is …, and in the UK …"]]

## 6. Security

Passwords are stored only as scrypt hashes. The session cookie can't be read by scripts on the page. Everything
between your browser, Norinote and its providers is sent encrypted (HTTPS). Files are kept in a private store that
only Norinote's servers can read, and the API gives each file only to the account it belongs to.

No system is perfectly secure. If a breach puts your data at risk, we'll tell you and the authorities as the law
requires.

## 7. AI

Norinote uses OpenAI's models to read your resume and job posts, match you to jobs, tailor your resume, and draft
answers. What it sends is what that task needs: your resume, your career graph, a job post, or an application's
questions. OpenAI's API terms say this isn't used to train their models; OpenAI may keep it for up to 30 days to check
for abuse.

Nori writes only from your own facts. It doesn't invent experience, and you see and approve every application before
it's sent.

## 8. Children

Norinote is for people 18 and older. If you think someone under 18 has an account, tell us and we'll delete it.

## 9. Changes

When this policy changes, we'll update the date at the top. If a change affects how your data is used, we'll tell you
by email before it takes effect.

## 10. Contact

**support@norinote.xyz**. [[The operator's legal name and postal address.]]
