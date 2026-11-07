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
  location: string | null;
  /** The daily limit: 0 is no limit (4c spec section 5.1). */
  autoApplyDailyCap: number;
};

/** One node of the career graph (`buildGraphView` in apps/api). Skills carry `years`, `current` and `lastUsed`. */
export type GraphNode = {
  id: string;
  type: string;
  label: string;
  props: { title?: string; org?: string; statement?: string; skills?: string[]; years?: number; current?: boolean; lastUsed?: string; group?: string };
  startDate: string | null;
  endDate: string | null;
  /** "your resume" or "a fact you added"; null for skills. */
  source?: string | null;
  sourceQuote?: string | null;
};
export type GraphEdge = { id: string; src: string; dst: string; type: string };
/** `PATCH /api/graph/nodes/:id`: any of these; null clears `org` or a date (`endDate: null` is "still doing it"). */
export type NodePatch = { title?: string; org?: string | null; statement?: string; skills?: string[]; startDate?: string | null; endDate?: string | null };

/** What reading a resume returns (`IngestResult`). */
export type Ingest = {
  note: string | null;
  profilePatch: Partial<Pick<Profile, "fullName" | "email" | "phone" | "linkedin" | "github" | "website">> & { location?: string };
  nodes: GraphNode[];
};

export type Lane = { id: string; name: string; titles: string[]; locations: string[]; remote: boolean; minFit: number; enabled: boolean };

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

// Part 4c: the answers Nori remembered, Telegram and the account (4c spec sections 5 and 6).
export type BankAnswer = { id: string; questionText: string; answer: string; source: "user" | "default" | "model"; lastUsedAt: string | null };
export type TelegramEvents = { digest: boolean; questions: boolean; submitted: boolean; needsUser: boolean; inbox: boolean; summary: boolean };
export type TelegramSettings = { dailyTime: string; timezone: string; count: number; summaryTime: string; quietHours: { enabled: boolean; start: string; end: string }; events: TelegramEvents };
export type TelegramState = { configured: boolean; botUsername: string | null; linked: boolean; linkedAt: string | null; settings: TelegramSettings };
export type Session = { id: string; current: boolean; device: string; createdAt: string; expiresAt: string };

/** A failure carries the API's words (`error`) and, for some, more of them (`detail`: the daily limit's 429 names the limit). */
export type Result<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string; detail?: string };

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
  const detail = body && typeof body === "object" && "detail" in body && typeof body.detail === "string" ? body.detail : undefined;
  return { ok: false, status: res.status, error, ...(detail ? { detail } : {}) };
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
  graph: () => call<{ nodes: GraphNode[]; edges: GraphEdge[] }>("/graph"),
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
  /** The code an employer emailed the person, typed while the run waits for it (status awaiting_code). 409: not waiting any more. */
  code: (id: string, code: string) => call<{ ok: true }>(`/applications/${encodeURIComponent(id)}/code`, { json: { code } }),
  agentStatus: () => call<AgentStatus>("/agent/status"),
  // Part 4b.
  outcomes: (id: string) => call<Outcomes>(`/applications/${encodeURIComponent(id)}/outcomes`),
  addOutcome: (id: string, kind: OutcomeKind) => call<Outcomes & { outcome: Outcome; created: boolean }>(`/applications/${encodeURIComponent(id)}/outcomes`, { json: { kind } }),
  removeOutcome: (id: string, outcomeId: string) => call<Outcomes & { ok: true }>(`/applications/${encodeURIComponent(id)}/outcomes/${encodeURIComponent(outcomeId)}`, { method: "DELETE" }),
  summary: () => call<OutcomeSummary>("/outcomes/summary"),
  inbox: () => call<InboxMessage[]>("/inbox?limit=200"),
  message: (id: string) => call<InboxMessage>(`/inbox/${encodeURIComponent(id)}`),
  inboxSettings: (settings: InboxSettings) => call<{ settings: InboxSettings }>("/inbox/settings", { method: "PUT", json: settings }),
  // Part 4c.
  addFact: (text: string) => call<{ nodesCreated: number; note: string | null }>("/graph/facts", { json: { text } }),
  editNode: (id: string, patch: NodePatch) => call<{ node: GraphNode }>(`/graph/nodes/${encodeURIComponent(id)}`, { method: "PATCH", json: patch }),
  removeNode: (id: string) => call<{ ok: true }>(`/graph/nodes/${encodeURIComponent(id)}`, { method: "DELETE" }),
  saveLanes: (lanes: (Omit<Lane, "id"> & { id: string | null })[]) => call<Lane[]>("/lanes", { method: "PUT", json: lanes }),
  saveProfile: (patch: Record<string, unknown>) => call<Profile>("/profile", { method: "PUT", json: patch }),
  answers: () => call<BankAnswer[]>("/profile/answers"),
  editAnswer: (id: string, answer: string) => call<BankAnswer>(`/profile/answers/${encodeURIComponent(id)}`, { method: "PATCH", json: { answer } }),
  removeAnswer: (id: string) => call<{ ok: true }>(`/profile/answers/${encodeURIComponent(id)}`, { method: "DELETE" }),
  telegram: () => call<TelegramState>("/channels/telegram"),
  saveTelegram: (settings: Partial<TelegramSettings>) => call<TelegramState>("/channels/telegram", { method: "PUT", json: settings }),
  linkTelegram: (timezone: string) => call<{ code: string; expiresAt: string; botUsername: string; link: string }>("/channels/telegram/link", { json: { timezone } }),
  unlinkTelegram: () => call<{ ok: true; linked: false }>("/channels/telegram", { method: "DELETE" }),
  changePassword: (current: string, next: string) => call<{ ok: true }>("/auth/change-password", { json: { current, next } }),
  sessions: () => call<Session[]>("/auth/sessions"),
  endSession: (id: string) => call<{ ok: true }>(`/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  endOtherSessions: () => call<{ revoked: number }>("/auth/sessions/revoke-others", { json: {} }),
  deleteAccount: (confirm: string) => call<{ ok: true }>("/auth/account", { method: "DELETE", json: { confirm } }),
};
