# Deploying Norinote

A fresh stack, separate from the old Nori apps. Nobody uses the old apps, so they are stopped first and the new stack
goes straight onto the real names; the old ones are deleted once the new stack works.

| Piece | Where | Config |
|---|---|---|
| The app: landing page, sign-in, onboarding, dashboard, Privacy and Terms | `norinote.xyz` on Vercel | `apps/landing` |
| Old dashboard address | `jobs.norinote.xyz`, redirects to `norinote.xyz` | a redirect domain on the same Vercel project |
| API | `api.norinote.xyz` on Fly (sjc) | `fly.api.toml`, `Dockerfile` target `api` |
| Worker | Fly (sjc), no public ports | `fly.worker.toml`, `Dockerfile` target `worker` |
| Database | Supabase Pro, us-west-1 (paid from the account's credits) | `DATABASE_URL` |
| Files | Supabase Storage through its S3 API, bucket `artifacts` | `S3_*`, `ARTIFACTS_DIR` |
| Account emails | Resend | `RESEND_API_KEY`, `MAIL_FROM` |
| Inbox addresses | Cloudflare Email Routing and an Email Worker, `@in.norinote.xyz` | `INBOUND_WEBHOOK_SECRET` |
| Telegram | A new bot from BotFather | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` |
| Company logos | Brandfetch Logo API (free, no attribution) | `BRANDFETCH_CLIENT_ID` |

Code is in the public repository `premxai/Norinotes`. `apps/web` (the temporary dashboard) is not deployed: the dashboard
lives in `apps/landing` (route group `(app)`: `/today`, `/applications`, `/inbox`, `/you`).

## DNS

`norinote.xyz` was bought on Spaceship and uses Spaceship's nameservers. Move the nameservers to a free Cloudflare
account (the domain stays registered at Spaceship): Cloudflare Email Routing then handles the inbox addresses, and the
records for Vercel and Fly are ordinary DNS records there. Keep the Vercel and Fly records "DNS only" (grey cloud), so
Vercel and Fly issue and renew their own certificates.

| Name | Type | Points at |
|---|---|---|
| `norinote.xyz` | A | Vercel (`76.76.21.21`, or what Vercel shows) |
| `jobs` | CNAME | `cname.vercel-dns.com` (the redirect domain) |
| `api` | A and AAAA, or CNAME | the API Fly app (`fly certs add api.norinote.xyz` prints them) |
| `in` | MX | Cloudflare Email Routing (added by Cloudflare when routing is turned on) |
| `send`, `resend._domainkey` (as Resend shows) | MX and TXT | the records Resend shows when verifying `norinote.xyz` |

Check that Cloudflare copied every existing record before switching nameservers. The old `jobs` record is replaced
when the new Vercel project takes the domain.

## The app on Vercel

One Vercel project, root directory `apps/landing`, framework Next.js, Node.js 22 or newer, "Include files outside the
root directory" left on (the app imports workspace packages). No `vercel.json` is needed. Its environment:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.norinote.xyz` (the browser calls it; the Content-Security-Policy allows only this API) |
| `NEXT_PUBLIC_SITE_URL` | `https://norinote.xyz` |

Domains: `norinote.xyz` (and `www.norinote.xyz` redirecting to it), and `jobs.norinote.xyz` as a redirect to
`norinote.xyz` that keeps the path, so links to the old dashboard still land: `/applications/<id>` exists in the new app,
and the old `/jobs`, `/profile`, `/settings` and `/login` paths redirect inside it.

The site and the API are on the same site (`norinote.xyz`), so the API's session cookie (httpOnly, `SameSite=Lax`,
`Secure`) is sent with the app's calls. `WEB_URL` and `LANDING_URL` on the API are both `https://norinote.xyz`: it is the
allowed browser origin, account-email links point at its `/verify-email` and `/reset-password`, and Telegram links open
`/today?job=<id>`, `/applications/<id>` and `/inbox`.

## Files

Tailored resume PDFs, apply screenshots and traces are written under `ARTIFACTS_DIR` on the worker and copied to object
storage under the same relative key (`packages/shared/src/files.ts`). The API serves a file from its own disk when it
has it, otherwise from storage; a restarted worker fetches a resume PDF back before applying. Deleting an account
deletes the user's files: resumes under `resumes/<userId>/`, screenshots and traces under `applications/<userId>/`, and
older files found through the account's receipts and run log. Both apps must use the same `ARTIFACTS_DIR`
(`/app/data/artifacts` in the toml files). Create the bucket `artifacts` as private in Supabase, and an S3 access key
under Storage settings.

## Lean storage

The collected index is 2.9 GB, almost all job descriptions. Users only see the last 72 hours, so older jobs keep only a
small "already seen" record. See docs/job-collection.md.

## Images

```bash
docker build --target api -t norinote-api .
docker build --target worker -t norinote-worker .
```

Both run the TypeScript sources with tsx and install only the API and worker workspaces. The worker image is the
Playwright image; its version (`PLAYWRIGHT_VERSION` in the Dockerfile) must match `playwright` in `package-lock.json`.
The API runs migrations on start.

## Secrets

Set once per app with `fly secrets set NAME=value -a <app>`, never in the toml files or the repository.

| Secret | API | Worker |
|---|---|---|
| `DATABASE_URL` (Supabase direct connection) | yes | yes |
| `SESSION_SECRET` (long random string) | yes | yes |
| `OPENAI_API_KEY` | yes | yes |
| `RESEND_API_KEY` | yes | |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | yes | yes |
| `INBOUND_WEBHOOK_SECRET` | yes | |
| `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | yes | yes |
| `BRANDFETCH_CLIENT_ID` (public, sent to browsers in logo URLs; kept out of the repository with the rest) | yes | |

`DATABASE_URL` on Fly is Supabase's **direct** connection (`postgres` user, host `db.<ref>.supabase.co`, port 5432).
It is IPv6, which Fly reaches, and allows up to 60 connections. Do not use the session pooler for the apps: its
client limit is the project's Pool Size (15 by default), and the two apps together need more (`DB_POOL_MAX` plus
`QUEUE_POOL_MAX` per app, in the toml files), so the API stops answering when the worker is busy. The pooler (IPv4) is
for running scripts from a computer without IPv6, such as `scripts/import-seeds.mts`.

Characters with a meaning in URLs must be percent-encoded in the password (`#` as `%23`, `@` as `%40`, `/` as `%2F`),
or the driver reads a different host.

Keep the values in `.env.production` (ignored by git) and send them from there, so nothing is typed into a terminal's
history. `DATABASE_URL_POOLER` in that file is the pooler string for local scripts and stays off Fly:

```powershell
Get-Content .env.production | Where-Object { $_ -match '^[A-Z0-9_]+=.+' -and $_ -notmatch '^DATABASE_URL_POOLER=' } | flyctl secrets import -a norinote-api
$w = 'DATABASE_URL','SESSION_SECRET','OPENAI_API_KEY','TELEGRAM_BOT_TOKEN','TELEGRAM_BOT_USERNAME','S3_ENDPOINT','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY'; Get-Content .env.production | Where-Object { $_ -match '^([A-Z0-9_]+)=.+' -and $w -contains $Matches[1] } | flyctl secrets import -a norinote-worker
```

## Order

1. Create the accounts and apps: Cloudflare (add the site, check the copied records, switch the nameservers at
   Spaceship), Supabase project in us-west-1 (the `artifacts` bucket and an S3 key; the first migration enables
   `vector`), two Fly apps (rename `app` in both toml files if the names are taken), Resend (verify `norinote.xyz`),
   Telegram bot, Brandfetch developer account (client id).
2. Stop the old apps and free the names: scale the old Fly app to zero, and remove `norinote.xyz`, `www`, `jobs` and
   `api` from the old Vercel and Fly apps that hold them.
3. Set the secrets (table above), deploy both Fly apps with the toml values, `fly certs add api.norinote.xyz -a <api app>`
   and add the records it prints. Create the Vercel project with the real `NEXT_PUBLIC_*` values and add its domains.
4. Load the boards (`scripts/import-seeds.mts`) and let the worker collect for a day.
5. Turn on the inbox addresses (Cloudflare Email Routing for `in.norinote.xyz` and the Email Worker, docs/inbox.md).
6. Test end to end. `scripts/smoke.mts` checks the wiring (pages, headers, CORS, cookie, a throwaway account from
   sign-up to deletion); then by hand in a browser: sign up, verify email, upload a resume, see today's jobs, tailor a
   resume, dry-run an application, mark an outcome, Telegram digest, inbox address.

   ```bash
   npx tsx scripts/smoke.mts --site https://norinote.xyz --api https://api.norinote.xyz --old-dashboard https://jobs.norinote.xyz
   ```

7. Once it works, delete the old Fly app and Vercel project. The old Neon databases go when deliberately deleted.

Real submission stays off (`ALLOW_REAL_SUBMIT=false`) until it is switched on on purpose.
