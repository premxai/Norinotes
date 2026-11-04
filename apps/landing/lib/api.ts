/**
 * The few `apps/api` calls the auth pages make (auth-design-spec.md section 9). The browser talks to the API directly,
 * with its session cookie (httpOnly, set by the API), so the API's WEB_URL must be this app's origin.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

export const OFFLINE = "Couldn't reach Norinote. Check your connection and try again.";

/** The API's `userView`. */
export type User = { id: string; email: string; name: string | null; emailVerifiedAt: string | null; createdAt: string };

export type Result<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string };

async function call<T>(path: string, body?: unknown): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "include",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: OFFLINE };
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, status: res.status, data: json as T };
  // The API's errors are `{ error, detail? }` and written for people; anything else (a proxy's HTML page) isn't.
  const error = json && typeof json === "object" && "error" in json && typeof json.error === "string" ? json.error : OFFLINE;
  return { ok: false, status: res.status, error };
}

export const api = {
  session: () => call<{ user: User }>("/auth/session"),
  signup: (email: string, password: string) => call<{ user: User }>("/auth/signup", { email, password }),
  login: (email: string, password: string) => call<{ user: User }>("/auth/login", { email, password }),
  forgot: (email: string) => call<{ ok: true }>("/auth/forgot-password", { email }),
  reset: (token: string, password: string) => call<{ ok: true }>("/auth/reset-password", { token, password }),
  verify: (token: string) => call<{ ok: true }>("/auth/verify-email", { token }),
  /** The onboarding step ("resume" … "done"), or null when signed out or unreachable. */
  onboardingStep: async () => {
    const r = await call<{ step: string }>("/onboarding");
    return r.ok ? r.data.step : null;
  },
};
