# Deploying Norinote

A fresh stack, separate from the old Nori apps, which keep running until the new one passes testing.

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
| (root) | TXT/MX for Resend | the records Resend shows when verifying `norinote.xyz` |

Copy every existing record (the current `jobs` record points at the old Vercel project) into Cloudflare before
switching nameservers, so nothing goes dark during the move. The `jobs` record moves to the new project only at the
switch (step 5 below).

## The app on Vercel

One Vercel project, root directory `apps/landing`, framework Next.js. Its environment:

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
| `DATABASE_URL` (Supabase pooler, session mode) | yes | yes |
| `SESSION_SECRET` (long random string) | yes | yes |
| `OPENAI_API_KEY` | yes | yes |
| `RESEND_API_KEY` | yes | |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | yes | yes |
| `INBOUND_WEBHOOK_SECRET` | yes | |
| `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | yes | yes |
| `BRANDFETCH_CLIENT_ID` (public, sent to browsers in logo URLs; kept out of the repository with the rest) | yes | |

## Order

1. Create the accounts and apps: Cloudflare (add the site and copy the records; switch the nameservers when they are
   all there), Supabase project in us-west-1 (enable the `vector` extension, create the `artifacts` bucket and an S3
   key), two Fly apps (rename `app` in both toml files if the names are taken), Resend (verify `norinote.xyz`), one
   Vercel project (`apps/landing`), Telegram bot, Brandfetch developer account (client id).
2. Deploy to temporary subdomains of `norinote.xyz`: `next.norinote.xyz` (the app) and `api-next.norinote.xyz` (the
   API). They must be on `norinote.xyz`: the session cookie is `SameSite=Lax`, so sign-in does not stick across the
   unrelated `vercel.app` and `fly.dev` addresses. The toml files hold the real names; override them for this step:

   ```bash
   fly deploy -c fly.api.toml -e WEB_URL=https://next.norinote.xyz -e LANDING_URL=https://next.norinote.xyz -e API_URL=https://api-next.norinote.xyz
   fly deploy -c fly.worker.toml -e WEB_URL=https://next.norinote.xyz -e API_URL=https://api-next.norinote.xyz
   ```

   and on Vercel set `NEXT_PUBLIC_API_URL=https://api-next.norinote.xyz` and `NEXT_PUBLIC_SITE_URL=https://next.norinote.xyz`
   for the deployment on `next.norinote.xyz`. The old apps keep the real names meanwhile.
3. Load the boards (`scripts/import-seeds.mts`) and let the worker collect for a day.
4. Test end to end. `scripts/smoke.mts` checks the wiring (pages, headers, CORS, cookie, a throwaway account from
   sign-up to deletion); then by hand in a browser: sign up, verify email, upload a resume, see today's jobs, tailor a
   resume, dry-run an application, mark an outcome, Telegram digest, inbox address.

   ```bash
   npx tsx scripts/smoke.mts --site https://next.norinote.xyz --api https://api-next.norinote.xyz
   ```

5. Point the real names at the new apps (`norinote.xyz`, `jobs.norinote.xyz` as the redirect, `api.norinote.xyz`),
   redeploy with the toml values and the real `NEXT_PUBLIC_*` values, and run the smoke test against them.
6. Stop the old Fly app and Vercel project. The old Neon database is kept until it is deliberately deleted.

Real submission stays off (`ALLOW_REAL_SUBMIT=false`) until it is switched on on purpose.
