# Norinote web (temporary dashboard)

A lean Next.js app over the Norinote API. A new landing page and dashboard will replace it and talk to the same API.

- `npm run dev --workspace @norinote/web` starts it on port 3000. `/api/*` is proxied to `API_URL` (default `http://localhost:4000`).
- `NEXT_PUBLIC_USE_MOCK=1` answers every call from `src/lib/mock.ts`, so it runs without the API.
- `SESSION_COOKIE_NAME` (default `norinote_session`) is the cookie the API sets on sign-in. The proxy only checks it exists.
- Every API call lives in `src/lib/api.ts`; wire types are in `src/lib/types.ts`.
