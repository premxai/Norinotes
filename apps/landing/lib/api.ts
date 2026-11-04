/**
 * The `apps/api` calls the app makes (auth spec section 9, onboarding spec section 8). The browser talks to the API
 * directly, with its session cookie (httpOnly, set by the API), so the API's WEB_URL must be this app's origin.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

export const OFFLINE = "Couldn't reach Norinote. Check your connection and try again.";

/** The API's `userView`. */
export type User = { id: string; email: string; name: string | null; emailVerifiedAt: string | null; createdAt: string };

/** The onboarding steps, in order (`ONBOARDING_STEPS` in apps/api). */
export type StepId = "resume" | "contact" | "authorization" | "screening" | "preferences";
export type Progress = StepId | "done";

/** The parts of the API's `toProfile` that onboarding reads. */
export type Profile = {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  website: string | null;
  github: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  pronouns: string | null;
  workAuth: { authorizedUS?: boolean; needsSponsorship?: boolean; status?: string; visaType?: string };
  willingToRelocate: boolean | null;
  remotePreference: string | null;
  heardAbout: string | null;
  salaryExpectation: { amount: number; currency?: string; period?: string } | null;
  earliestStartDate: string | null;
  noticePeriodWeeks: number | null;
  eeo: Record<string, string>;
  securityClearance: string | null;
  over18: boolean | null;
  preferences: { titles?: string[]; locations?: string[]; remote?: "only" | "ok" | "no"; salaryMin?: number; excludeCompanies?: string[] };
  rawResumeText: string | null;
};

/** One node of the career graph (`buildGraphView` in apps/api). */
export type GraphNode = {
  id: string;
  type: string;
  label: string;
  props: { title?: string; org?: string; statement?: string; skills?: string[] };
  startDate: string | null;
  endDate: string | null;
  sourceQuote?: string | null;
};

/** What reading a resume returns (`IngestResult`). */
export type Ingest = {
  note: string | null;
  profilePatch: Partial<Pick<Profile, "fullName" | "email" | "phone" | "linkedin" | "github" | "website">> & { location?: string };
  nodes: GraphNode[];
};

export type Lane = { id: string; name: string; titles: string[]; locations: string[]; remote: boolean };

export type Result<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string };

async function call<T>(path: string, { method, json, form }: { method?: string; json?: unknown; form?: FormData } = {}): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method: method ?? (json === undefined && !form ? "GET" : "POST"),
      credentials: "include",
      headers: json === undefined ? undefined : { "content-type": "application/json" },
      body: form ?? (json === undefined ? undefined : JSON.stringify(json)),
    });
  } catch {
    return { ok: false, status: 0, error: OFFLINE };
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, status: res.status, data: body as T };
  // The API's errors are `{ error, detail? }` and written for people; anything else (a proxy's HTML page) isn't.
  const error = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : OFFLINE;
  return { ok: false, status: res.status, error };
}

export const api = {
  session: () => call<{ user: User }>("/auth/session"),
  signup: (email: string, password: string) => call<{ user: User }>("/auth/signup", { json: { email, password } }),
  login: (email: string, password: string) => call<{ user: User }>("/auth/login", { json: { email, password } }),
  forgot: (email: string) => call<{ ok: true }>("/auth/forgot-password", { json: { email } }),
  reset: (token: string, password: string) => call<{ ok: true }>("/auth/reset-password", { json: { token, password } }),
  verify: (token: string) => call<{ ok: true }>("/auth/verify-email", { json: { token } }),
  /** The onboarding step ("resume" … "done"), or null when signed out or unreachable. */
  onboardingStep: async () => {
    const r = await call<{ step: Progress }>("/onboarding");
    return r.ok ? r.data.step : null;
  },
  onboarding: () => call<{ step: Progress; profile: Profile }>("/onboarding"),
  saveStep: (step: StepId, data: Record<string, unknown>) => call<{ step: Progress; profile: Profile }>("/onboarding", { method: "PUT", json: { step, data } }),
  resumeFile: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return call<Ingest>("/profile/resume-file", { form });
  },
  resumeText: (text: string) => call<Ingest>("/profile/resume", { json: { text } }),
  graph: () => call<{ nodes: GraphNode[] }>("/graph"),
  lanes: () => call<Lane[]>("/lanes"),
  inboxAddress: () => call<{ address: string | null; configured: boolean }>("/inbox/address"),
  shortlist: () => call<unknown[]>("/shortlist"),
};
