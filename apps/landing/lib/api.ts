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

/** A job as the API sends it (`toJob`). `companyLogoUrl`: a Brandfetch CDN logo, or null (see CompanyLogo). */
export type Job = { id: string; companyName: string; companyLogoUrl?: string | null; title: string; location: string | null; remote: boolean | null; descriptionText?: string; applyUrl: string; postedAt: string | null };

/** One row of today's shortlist (`GET /api/shortlist`). */
export type ShortlistEntry = {
  id: string;
  jobId: string;
  fit: number;
  reasons: string[];
  status: string;
  createdAt: string;
  widenedBy: string | null;
  locationNames: string[];
  job: Job;
};

export type AppStatus = "queued" | "preparing" | "prepared" | "applying" | "awaiting_code" | "submitted" | "needs_user" | "failed";
export type Question = { id: string; text: string; type: string; options: string[]; required: boolean };

/** An application (`toApplication`). */
export type Application = {
  id: string;
  jobId: string;
  status: AppStatus;
  pendingQuestions: Question[];
  receipt: Record<string, unknown> | null;
  error: string | null;
  preparedAt: string | null;
  approvedAt: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RunEvent = { id: string; ts: string; level: string; step: string; message: string };
export type ResumeView = { changes: { before: string; after: string; reason: string }[] };
export type ApplicationDetail = { application: Application; job: Job; resume: ResumeView | null; events: RunEvent[] };
export type AgentStatus = { dailyCap: number; usedToday: number; liveSubmit: boolean };

// Part 4b: outcomes, the numbers and the inbox (4b spec sections 3 to 5).
export type OutcomeKind = "reply" | "interview" | "rejection" | "offer";
export type OutcomeState = "pending" | OutcomeKind | "no_response";
export type Outcome = { id: string; kind: OutcomeKind; at: string; source: string; messageId: string | null };
/** `GET /api/applications/:id/outcomes`; `state` is null until it's submitted. */
export type Outcomes = { applicationId: string; submittedAt: string | null; confirmedAt: string | null; state: OutcomeState | null; outcomes: Outcome[] };
export type OutcomeStats = {
  key: string;
  applications: number;
  settled: number;
  pending: number;
  responses: number;
  interviews: number;
  rejections: number;
  offers: number;
  noResponse: number;
  /** Null when fewer than 5 are settled. */
  responseRate: number | null;
  interviewRate: number | null;
  rejectionRate: number | null;
  /** Null when fewer than 5 got a reply. */
  medianDaysToFirstReply: number | null;
  smallSample: boolean;
};
export type OutcomeSummary = { overall: OutcomeStats; minSample: number; noResponseDays: number };
/** A row of the applications list (`GET /api/applications`). */
export type ApplicationRow = { application: Application; job: Job; resume: ResumeView | null };

export type InboxKind = "verification_code" | "confirmation" | "recruiter_reply" | "interview" | "rejection" | "offer" | "other";
export type InboxMessage = {
  id: string;
  applicationId: string | null;
  application: { id: string; status: string; jobTitle: string; companyName: string } | null;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  bodyText: string;
  receivedAt: string;
  kind: InboxKind;
  code: string | null;
  verificationLink: string | null;
  links: string[];
  attachments: { filename: string; contentType: string; size: number }[];
  spam: boolean;
};
export type InboxSettings = { forwardTo: string | null; forwardEnabled: boolean; retentionDays: number | null };

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
  inboxAddress: () => call<{ address: string | null; configured: boolean; settings: InboxSettings }>("/inbox/address"),
  shortlist: () => call<ShortlistEntry[]>("/shortlist"),
  // The dashboard (4a spec sections 7 and 8).
  me: () => call<{ user: User; profile: Profile }>("/me"),
  logout: () => call<{ ok: true }>("/auth/logout", { json: {} }),
  resendVerification: () => call<{ ok: true; verified?: boolean }>("/auth/resend-verification", { json: {} }),
  shortlistMeta: () => call<{ total: number; widened: string[]; lanesMatched: number; poolUsed: boolean }>("/shortlist/meta"),
  dismiss: (jobId: string) => call<{ ok: true }>(`/shortlist/${encodeURIComponent(jobId)}/dismiss`, { json: {} }),
  job: (id: string) => call<Job>(`/jobs/${encodeURIComponent(id)}`),
  applications: () => call<ApplicationRow[]>("/applications"),
  application: (id: string) => call<ApplicationDetail>(`/applications/${encodeURIComponent(id)}`),
  apply: (jobId: string) => call<Application>("/applications", { json: { jobId } }),
  approve: (id: string, answers?: Record<string, string>) => call<{ ok: true; status: AppStatus }>(`/applications/${encodeURIComponent(id)}/approve`, { json: answers ? { answers } : {} }),
  answer: (id: string, answers: Record<string, string>) => call<{ ok: true; status: AppStatus }>(`/applications/${encodeURIComponent(id)}/answer`, { json: { answers } }),
  retry: (id: string) => call<Application>(`/applications/${encodeURIComponent(id)}/retry`, { json: {} }),
  agentStatus: () => call<AgentStatus>("/agent/status"),
  // Part 4b.
  outcomes: (id: string) => call<Outcomes>(`/applications/${encodeURIComponent(id)}/outcomes`),
  addOutcome: (id: string, kind: OutcomeKind) => call<Outcomes & { outcome: Outcome; created: boolean }>(`/applications/${encodeURIComponent(id)}/outcomes`, { json: { kind } }),
  removeOutcome: (id: string, outcomeId: string) => call<Outcomes & { ok: true }>(`/applications/${encodeURIComponent(id)}/outcomes/${encodeURIComponent(outcomeId)}`, { method: "DELETE" }),
  summary: () => call<OutcomeSummary>("/outcomes/summary"),
  inbox: () => call<InboxMessage[]>("/inbox?limit=200"),
  message: (id: string) => call<InboxMessage>(`/inbox/${encodeURIComponent(id)}`),
  inboxSettings: (settings: InboxSettings) => call<{ settings: InboxSettings }>("/inbox/settings", { method: "PUT", json: settings }),
};
