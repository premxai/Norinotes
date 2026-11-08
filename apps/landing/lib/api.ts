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
  /** Where a card came from: `label` is the resume line it quotes, the repo as owner/name, or the site's host. Null for skills. */
  origin?: { kind: "resume" | "user" | "github" | "site"; ref: string | null; label: string | null } | null;
};
export type GraphEdge = { id: string; src: string; dst: string; type: string };
/** A source the person named for their graph (`GET /api/graph/sources`). LinkedIn links are kept, never read. */
export type GraphSource = { id: string; kind: "github" | "site" | "linkedin"; value: string; status: "pending" | "reading" | "done" | "failed"; error: string | null; factsAdded: number; lastReadAt: string | null; createdAt: string };
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
export type Job = { id: string; companyName: string; companyLogoUrl?: string | null; title: string; location: string | null; remote: boolean | null; descriptionText?: string; applyUrl: string; postedAt: string | null; firstSeenAt?: string; closedAt?: string | null; atsType?: string; pay?: JobPay | null; employmentType?: EmploymentType | null; workplace?: Workplace | null };
/** What the listing states (null when it doesn't; never estimated). */
export type JobPay = { min: number | null; max: number | null; currency: "USD" | "EUR" | "GBP" | "CAD"; period: "year" | "month" | "hour" };
export type EmploymentType = "full_time" | "part_time" | "contract" | "internship" | "temporary";
export type Workplace = "remote" | "hybrid" | "onsite";
/** The employer, on GET /api/jobs/:id (size and about are null until collected). */
export type JobCompany = { name: string; website: string | null; logoUrl: string | null; size: string | null; about: string | null };
/** GET /api/jobs/:id/preview, the Jobs page's Review tab: the form's questions and what Nori would put in. */
export type PreviewQuestion = { key: string; label: string; type: string; required: boolean; status: "ready" | "ask" | "skip"; answer: string | null; source: string | null };
export type JobPreview =
  | { available: true; ats: string; questions: PreviewQuestion[]; counts: { total: number; ready: number; ask: number; skip: number } }
  | { available: false; ats: string | null; reason: string };

/** How the person's profile meets a job (`toMatch` in apps/api): requirements they cover and don't, and the reasons. */
export type Match = {
  jobId: string;
  score: number;
  explanation: { matched: { requirement: string; label: string; required: boolean }[]; missing: { requirement: string; required: boolean }[]; reasons: string[] };
  widenedBy: string | null;
  computedAt: string;
};
/** What a job asks for (`toRequirements`), on GET /api/jobs/:id; null until the job has been read. */
export type Requirements = {
  skills: { name: string; required: boolean }[];
  seniority: string | null;
  roleFamily: string | null;
  mustHaves: string[];
  niceToHaves: string[];
  disqualifiers: string[];
  summary?: string;
  responsibilities?: string[];
};
/** A row of GET /api/jobs: the job, the person's fit (null when it hasn't been scored for them) and their application. */
export type JobListItem = { job: Job; match: Match | null; applicationStatus: AppStatus | null; saved?: boolean; locations?: number; locationNames?: string[] };
/** `saved`: the person's saved jobs, newest saved first, whatever their age. `location`: the place contains it. */
export type JobsQuery = { view: "best" | "new" | "saved"; q?: string; maxAgeHours?: number; clearance?: "hide" | "show"; location?: string; remote?: boolean; limit?: number };

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
/** The tailored resume's text (`toResume` content); bullets keep the ids that `changes` point at. */
export type ResumeContent = {
  name: string;
  contact: Record<string, unknown>;
  summary?: string;
  experience: { title: string; company: string; location: string | null; start: string | null; end: string | null; bullets: { id: string; text: string }[] }[];
  education: { school: string; degree: string | null; field: string | null; start: string | null; end: string | null }[];
  skills: { group: string; items: string[] }[];
  projects: { name: string; bullets: { id: string; text: string }[] }[];
};
/** `id` (for GET /resumes/:id.pdf) and `content` come with every stored resume; older callers read only `changes`. */
export type ResumeView = { id?: string; content?: ResumeContent; changes: { before: string; after: string; reason: string; bulletId?: string }[]; pages?: number; createdAt?: string };
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
  /** When an application run took this message's code or link; null when Nori never used it. */
  usedAt: string | null;
};
export type InboxSettings = { forwardTo: string | null; forwardEnabled: boolean; retentionDays: number | null };

// Part 4c: the answers Nori remembered, Telegram and the account (4c spec sections 5 and 6).
export type BankAnswer = { id: string; questionText: string; answer: string; source: "user" | "default" | "model"; lastUsedAt: string | null };
export type TelegramEvents = { digest: boolean; questions: boolean; submitted: boolean; needsUser: boolean; inbox: boolean; summary: boolean };
export type TelegramSettings = { dailyTime: string; timezone: string; count: number; summaryTime: string; quietHours: { enabled: boolean; start: string; end: string }; events: TelegramEvents };
export type TelegramState = { configured: boolean; botUsername: string | null; linked: boolean; linkedAt: string | null; settings: TelegramSettings };
export type Session = { id: string; current: boolean; device: string; createdAt: string; expiresAt: string };

/**
 * Where applications went (GET /api/applications/flow): nodes in columns by `stage` (0 started; 1 sent, needs_you,
 * in_progress, cancelled, failed; 2 from sent: interview, replied, rejected, waiting, silent; 3 from interview: offer,
 * rejected_after_interview, interviewing) and the links between them. Each application takes one path; zeros are left out.
 */
export type FlowNode = { id: string; label: string; count: number; stage: 0 | 1 | 2 | 3 };
export type Flow = { since: string | null; total: number; nodes: FlowNode[]; links: { source: string; target: string; value: number }[] };

/** "Apply for me" (api-contract.md, Nori page): settings, batches the person approves at once, and what needs them. */
export type NoriSettings = { spacingMinutes: number; minFit: number; skipCompanies: string[]; dailyLimit: number };
export type BatchCounts = { total: number; sent: number; working: number; preparing: number; ready: number; needsYou: number; cancelled: number; failed: number };
export type Batch = { id: string; status: "running" | "stopped" | "done"; createdAt: string; finishedAt: string | null; lastStartedAt: string | null; counts: BatchCounts; waitingFor: "spacing" | "daily_limit" | "preparing" | "you" | null; nextAt: string | null };
export type Needs = "questions" | "code" | "captcha" | "account" | "other";
export type BatchApplication = { id: string; jobId: string; title: string; company: string; status: AppStatus; error: string | null; submittedAt: string | null; needs?: Needs };
export type BatchSkip = { jobId: string; reason: "not_found" | "skipped_company" | "same_company" | "already_applied" | "duplicate_recent" | string };
/** `questions` is how many; the questions themselves come with the application (GET /applications/:id). */
export type NeedsItem = { applicationId: string; jobId: string; title: string; company: string; applyUrl: string; needs: Needs; reason: string | null; questions: number; batchId: string | null; updatedAt: string };
export type GmailState = { available: boolean; connected: boolean; status: string | null };
/** Nori chat and schedule (api-contract.md): every change Nori made is listed, with an undoId when it can be undone. */
export type NoriAction = { kind: string; summary: string; undoId: string | null };
export type NoriMessage = { id: string; role: "user" | "nori"; text: string; actions: NoriAction[]; createdAt: string };
export type NoriSchedule = { enabled: boolean; days: string[]; time: string; timezone: string; paused: boolean; lastRunOn: string | null; nextRunOn: string | null };

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
  // The server wraps the job ({ job, match }); only the job is read here.
  job: (id: string) => call<{ job: Job }>(`/jobs/${encodeURIComponent(id)}`),
  // The Jobs page: open jobs from the last 72 hours (all of them, or those that fit the person's searches), one job with
  // what it asks for and the person's fit, and the counts.
  jobs: ({ view, q, maxAgeHours, clearance, location, remote, limit }: JobsQuery) => {
    const p = new URLSearchParams({ view, lanes: view === "best" ? "true" : "false", limit: String(limit ?? 100) });
    if (q) p.set("q", q);
    if (maxAgeHours) p.set("maxAgeHours", String(maxAgeHours));
    if (clearance) p.set("clearance", clearance);
    if (location) p.set("location", location);
    if (remote) p.set("remote", "true");
    return call<JobListItem[]>(`/jobs?${p}`);
  },
  jobDetail: (id: string) => call<{ job: Job & { requirements?: Requirements | null; saved?: boolean; company?: JobCompany }; match: Match | null }>(`/jobs/${encodeURIComponent(id)}`),
  jobPreview: (id: string) => call<JobPreview>(`/jobs/${encodeURIComponent(id)}/preview`),
  jobsSummary: () => call<{ open: number; newToday: number; fitsLanes: number; hasLanes: boolean }>("/jobs/summary"),
  /** The 30 most common places of open jobs, for the location filter. */
  jobLocations: () => call<{ locations: { name: string; count: number }[] }>("/jobs/locations"),
  /** Save (bookmark) a job for the Saved tab, or take it off. */
  saveJob: (id: string, on: boolean) => call<{ saved: boolean }>(`/jobs/${encodeURIComponent(id)}/save`, on ? { json: {} } : { method: "DELETE" }),
  applications: () => call<ApplicationRow[]>("/applications"),
  application: (id: string) => call<ApplicationDetail>(`/applications/${encodeURIComponent(id)}`),
  apply: (jobId: string) => call<Application>("/applications", { json: { jobId } }),
  approve: (id: string, answers?: Record<string, string>) => call<{ ok: true; status: AppStatus }>(`/applications/${encodeURIComponent(id)}/approve`, { json: answers ? { answers } : {} }),
  answer: (id: string, answers: Record<string, string>) => call<{ ok: true; status: AppStatus }>(`/applications/${encodeURIComponent(id)}/answer`, { json: { answers } }),
  retry: (id: string) => call<Application>(`/applications/${encodeURIComponent(id)}/retry`, { json: {} }),
  /**
   * The latest frame of the employer's page while Nori works on it (GET /applications/:id/live), or null (404: no live
   * view; offline; anything else). Fetched rather than pointed at, because the CSP allows images only from this site:
   * the caller shows the blob through an object URL.
   */
  liveFrame: async (id: string): Promise<Blob | null> => {
    try {
      const res = await fetch(`${API_URL}/api/applications/${encodeURIComponent(id)}/live`, { credentials: "include", cache: "no-store" });
      if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
      return await res.blob();
    } catch {
      return null;
    }
  },
  /** Drops an application before Nori is on the employer's page: it becomes failed, "Cancelled by you". 409 once it's there or sent. */
  cancel: (id: string) => call<{ ok: true; status: AppStatus }>(`/applications/${encodeURIComponent(id)}/cancel`, { json: {} }),
  /** The code an employer emailed the person, typed while the run waits for it (status awaiting_code). 409: not waiting any more. */
  code: (id: string, code: string) => call<{ ok: true }>(`/applications/${encodeURIComponent(id)}/code`, { json: { code } }),
  agentStatus: () => call<AgentStatus>("/agent/status"),
  // Part 4b.
  outcomes: (id: string) => call<Outcomes>(`/applications/${encodeURIComponent(id)}/outcomes`),
  addOutcome: (id: string, kind: OutcomeKind) => call<Outcomes & { outcome: Outcome; created: boolean }>(`/applications/${encodeURIComponent(id)}/outcomes`, { json: { kind } }),
  removeOutcome: (id: string, outcomeId: string) => call<Outcomes & { ok: true }>(`/applications/${encodeURIComponent(id)}/outcomes/${encodeURIComponent(outcomeId)}`, { method: "DELETE" }),
  summary: () => call<OutcomeSummary>("/outcomes/summary"),
  flow: (days: 7 | 30 | 90 | null) => call<Flow>(`/applications/flow${days ? `?days=${days}` : ""}`),
  /** Overview's graph: applications sent per local day in `tz`, every day listed oldest first (0 when none). */
  activity: (days: number, tz: string) =>
    call<{ days: { date: string; sent: number }[]; total: number; timezone: string }>(`/applications/activity?days=${days}&tz=${encodeURIComponent(tz)}`),
  inbox: () => call<InboxMessage[]>("/inbox?limit=200"),
  message: (id: string) => call<InboxMessage>(`/inbox/${encodeURIComponent(id)}`),
  inboxSettings: (settings: InboxSettings) => call<{ settings: InboxSettings }>("/inbox/settings", { method: "PUT", json: settings }),
  // Part 4c.
  addFact: (text: string) => call<{ nodesCreated: number; note: string | null }>("/graph/facts", { json: { text } }),
  editNode: (id: string, patch: NodePatch) => call<{ node: GraphNode }>(`/graph/nodes/${encodeURIComponent(id)}`, { method: "PATCH", json: patch }),
  removeNode: (id: string) => call<{ ok: true }>(`/graph/nodes/${encodeURIComponent(id)}`, { method: "DELETE" }),
  graphSources: () => call<{ sources: GraphSource[] }>("/graph/sources"),
  addGraphSource: (kind: GraphSource["kind"], value: string) => call<{ source: GraphSource }>("/graph/sources", { json: { kind, value } }),
  refreshGraphSource: (id: string) => call<{ source: GraphSource }>(`/graph/sources/${encodeURIComponent(id)}/refresh`, { json: {} }),
  removeGraphSource: (id: string) => call<{ ok: true; factsRemoved: number }>(`/graph/sources/${encodeURIComponent(id)}`, { method: "DELETE" }),
  saveLanes: (lanes: (Omit<Lane, "id"> & { id: string | null })[]) => call<Lane[]>("/lanes", { method: "PUT", json: lanes }),
  saveProfile: (patch: Record<string, unknown>) => call<Profile>("/profile", { method: "PUT", json: patch }),
  answers: () => call<BankAnswer[]>("/profile/answers"),
  editAnswer: (id: string, answer: string) => call<BankAnswer>(`/profile/answers/${encodeURIComponent(id)}`, { method: "PATCH", json: { answer } }),
  removeAnswer: (id: string) => call<{ ok: true }>(`/profile/answers/${encodeURIComponent(id)}`, { method: "DELETE" }),
  telegram: () => call<TelegramState>("/channels/telegram"),
  noriSettings: () => call<{ settings: NoriSettings }>("/nori/settings"),
  saveNoriSettings: (patch: Partial<NoriSettings>) => call<{ settings: NoriSettings }>("/nori/settings", { method: "PUT", json: patch }),
  batches: () => call<{ batches: Batch[] }>("/nori/batches"),
  batch: (id: string) => call<{ batch: Batch; applications: BatchApplication[] }>(`/nori/batches/${encodeURIComponent(id)}`),
  startBatch: (jobIds: string[]) => call<{ batch: Batch; added: number; skipped: BatchSkip[] }>("/nori/batches", { json: { jobIds } }),
  stopBatch: (id: string) => call<{ ok: true }>(`/nori/batches/${encodeURIComponent(id)}/stop`, { json: {} }),
  needsYou: () => call<{ items: NeedsItem[] }>("/nori/needs-you"),
  noriChat: (before?: string) => call<{ messages: NoriMessage[] }>(`/nori/chat${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  sendNori: (message: string) => call<{ message: NoriMessage; reply: NoriMessage }>("/nori/chat", { json: { message } }),
  undoNori: (undoId: string) => call<{ ok: boolean; summary: string }>(`/nori/chat/undo/${encodeURIComponent(undoId)}`, { json: {} }),
  noriSchedule: () => call<{ schedule: NoriSchedule }>("/nori/schedule"),
  applyRecommended: (limit?: number) => call<{ batch: Batch; added: number; skipped: BatchSkip[] }>("/nori/batches", { json: { recommended: true, ...(limit ? { limit } : {}) } }),
  /** Recommended: matches in the person's roles at or above the threshold (GET /jobs?view=best&minScore=). */
  recommended: (minScore: number) => call<JobListItem[]>(`/jobs?view=best&lanes=true&limit=200&minScore=${minScore}`),
  gmail: () => call<GmailState>("/inbox/gmail"),
  connectGmail: () => call<{ url: string }>("/inbox/gmail/connect", { json: {} }),
  disconnectGmail: () => call<{ ok: true }>("/inbox/gmail", { method: "DELETE" }),
  saveTelegram: (settings: Partial<TelegramSettings>) => call<TelegramState>("/channels/telegram", { method: "PUT", json: settings }),
  linkTelegram: (timezone: string) => call<{ code: string; expiresAt: string; botUsername: string; link: string }>("/channels/telegram/link", { json: { timezone } }),
  unlinkTelegram: () => call<{ ok: true; linked: false }>("/channels/telegram", { method: "DELETE" }),
  changePassword: (current: string, next: string) => call<{ ok: true }>("/auth/change-password", { json: { current, next } }),
  sessions: () => call<Session[]>("/auth/sessions"),
  endSession: (id: string) => call<{ ok: true }>(`/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  endOtherSessions: () => call<{ revoked: number }>("/auth/sessions/revoke-others", { json: {} }),
  deleteAccount: (confirm: string) => call<{ ok: true }>("/auth/account", { method: "DELETE", json: { confirm } }),
};
