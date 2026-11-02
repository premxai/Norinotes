/**
 * Wire types for the Norinote HTTP API (see ARCHITECTURE.md "API surface"). Timestamps are ISO strings.
 * Where packages/shared defines the same shape (Lane, Application, ShortlistItem) these mirror it.
 */

/** queued -> preparing -> prepared -> applying -> awaiting_code -> submitted | needs_user | failed */
export const APPLICATION_STATUSES = ["queued", "preparing", "prepared", "applying", "awaiting_code", "submitted", "needs_user", "failed"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export type InboxKind =
  | "verification_code" | "recruiter_reply" | "interview" | "rejection" | "offer" | "confirmation" | "other";

export type User = { id: string; email: string; name: string | null; emailVerifiedAt?: string | null; createdAt: string };

export type SessionInfo = { id: string; current: boolean; device: string; createdAt: string; expiresAt: string };

export type Preferences = {
  titles?: string[];
  locations?: string[];
  remote?: "only" | "ok" | "no";
  salaryMin?: number;
  stages?: string[];
  excludeCompanies?: string[];
};

export type WorkStatus = "citizen" | "permanent_resident" | "visa" | "other";
export type WorkAuth = {
  authorizedUS?: boolean;
  needsSponsorship?: boolean;
  status?: WorkStatus;
  visaType?: string;
  notes?: string;
} & Record<string, unknown>;

export type SalaryExpectation = { amount?: number | null; currency?: string; period?: "year" | "month" | "hour" };
/** "decline" = Prefer not to say (the default for every EEO answer). */
export type Eeo = { gender?: string; race?: string; veteran?: string; disability?: string };

export const ONBOARDING_STEPS = ["resume", "contact", "authorization", "screening", "preferences"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];
export type OnboardingStep = OnboardingStepId | "done";

export type Profile = {
  userId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  website: string | null;
  location: string | null;
  workAuth: WorkAuth;
  preferences: Preferences;
  rawResumeText?: string | null;
  /** How many applications Norinote may send by itself each day, shared by every lane. 0 means only on your click. */
  autoApplyDailyCap: number;
  updatedAt: string;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  github?: string | null;
  pronouns?: string | null;
  willingToRelocate?: boolean | null;
  remotePreference?: string | null;
  heardAbout?: string | null;
  salaryExpectation?: SalaryExpectation | null;
  earliestStartDate?: string | null;
  noticePeriodWeeks?: number | null;
  eeo?: Eeo | null;
  securityClearance?: string | null;
  over18?: boolean | null;
  onboarding?: { step: OnboardingStep; completedAt?: string | null } | null;
};

/** GET /api/onboarding */
export type OnboardingState = { step: OnboardingStep; profile: Profile };

export type Me = { user: User; profile: Profile };

// ---------- graph ----------
export type GraphNode = {
  id: string;
  type: string;
  label: string;
  props: Record<string, unknown>;
  startDate?: string | null;
  endDate?: string | null;
  source?: string | null;
  sourceQuote?: string | null;
};
export type GraphEdge = { id: string; src: string; dst: string; type: string };
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };

export type IngestResult = {
  nodesCreated: number;
  edgesCreated: number;
  usedLLM: boolean;
  profilePatch: Partial<{ fullName: string; email: string; phone: string; linkedin: string; github: string; location: string; website: string }>;
  /** When absent the wizard ranks GET /api/graph by degree instead. */
  nodes?: GraphNode[];
};

// ---------- jobs ----------
/** What a job asks for, read once per job. Optional: the API sends it when the job has been understood. */
export type JobRequirements = {
  skills: { name: string; required: boolean }[];
  seniority: string;
  roleFamily: string;
  yearsMin: number | null;
  mustHaves: string[];
  niceToHaves: string[];
  disqualifiers: string[];
  summary?: string;
};

export type Job = {
  id: string;
  companyId?: string | null;
  companyName: string;
  atsType: string;
  externalId?: string;
  title: string;
  location: string | null;
  remote: boolean;
  descriptionText: string;
  applyUrl: string;
  postedAt: string | null;
  requirements?: JobRequirements | null;
  firstSeenAt: string;
  lastSeenAt?: string;
  closedAt: string | null;
};

export type MatchExplanation = {
  matched: { requirement: string; nodeId: string; label: string; required: boolean }[];
  missing: { requirement: string; required: boolean }[];
  reasons: string[];
};

/** score is 0..1 */
export type Match = { jobId: string; score: number; explanation: MatchExplanation; computedAt?: string };

export type JobWithMatch = {
  job: Job;
  match: Match | null;
  /** Present when the API annotates the job with the user's application state. */
  applicationStatus?: ApplicationStatus | null;
  /** Grouped list rows: how many places this posting is open in (same company and title), and up to 8 of their names. */
  locations?: number;
  locationNames?: string[];
};

/** GET /api/jobs/summary: counts over open jobs from the last 60 days. */
export type JobsSummary = { open: number; newToday: number; newThisWeek: number; fitsLanes: number; hasLanes: boolean };

export type JobDetail = { job: Job; match: Match | null };

// ---------- shortlist ----------
/** GET /api/shortlist. `fit` is 0..1. The job is joined in so a card needs no second call. */
export type ShortlistItem = {
  id: string;
  jobId: string;
  fit: number;
  reasons: string[];
  status: "new" | "dismissed" | "applied";
  createdAt: string;
  job: Pick<Job, "id" | "companyName" | "title" | "location" | "remote" | "applyUrl" | "postedAt">;
};

// ---------- applications ----------
export type PendingQuestion = { id: string; text: string; type: string; options?: string[]; required: boolean };

/** Proof of submission. Every field is optional: the worker records what it has. */
export type Receipt = {
  confirmationText?: string;
  screenshotPath?: string;
  finalUrl?: string;
  submittedVia?: string;
  dryRun?: boolean;
  fields?: { label: string; value: string }[];
} & Record<string, unknown>;

export type Application = {
  id: string;
  jobId: string;
  status: ApplicationStatus;
  resumeId: string | null;
  /** Question id (or text) to the answer that will be entered. */
  answers: Record<string, string>;
  pendingQuestions: PendingQuestion[];
  receipt: Receipt | null;
  error: string | null;
  attempts: number;
  preparedAt: string | null;
  approvedAt: string | null;
  submittedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type ResumeBullet = { id: string; text: string; nodeIds: string[]; edited?: boolean };
export type ResumeChange = { bulletId: string; before: string; after: string; reason: string; nodeIds: string[] };
export type AtsCheck = { id: string; label: string; pass: boolean; detail?: string; weight?: number };
export type ResumeContent = {
  name: string;
  contact: { email?: string; phone?: string; location?: string; linkedin?: string; website?: string; github?: string };
  summary?: string;
  experience: { title: string; company: string; location?: string; start?: string; end?: string; bullets: ResumeBullet[] }[];
  education: { school: string; degree?: string; field?: string; start?: string; end?: string }[];
  skills: { group: string; items: string[] }[];
  projects?: { name: string; bullets: ResumeBullet[] }[];
  certifications?: string[];
};

/** GET /api/resumes/:id. The PDF is at /api/resumes/:id.pdf. */
export type Resume = {
  id: string;
  applicationId: string | null;
  content: ResumeContent;
  changes: ResumeChange[];
  pages: number | null;
  atsChecks: AtsCheck[];
  createdAt?: string;
};

export type RunEventRow = {
  id?: string;
  applicationId?: string;
  ts: string;
  level: "info" | "warn" | "error";
  step: string;
  message: string;
  data?: Record<string, unknown> | null;
};

export type ApplicationListItem = { application: Application; job: Job; resume?: Resume | null };

export type ApplicationDetail = {
  application: Application;
  job: Job;
  resume: Resume | null;
  events: RunEventRow[];
};

// ---------- inbox / channels ----------
export type InboxMessage = {
  id: string;
  applicationId: string | null;
  fromAddress: string;
  subject: string;
  bodyText: string;
  receivedAt: string;
  kind: InboxKind;
  code: string | null;
  /** Absent means the API does not track it; only an explicit false counts as unread. */
  read?: boolean;
};

/** Whether the Telegram bot exists on this server, its handle, and whether this account has a chat linked. */
export type TelegramInfo = { configured: boolean; botUsername: string | null; linked: boolean };
/** A one-time code to send to the bot; `link` opens the bot with the code prefilled. */
export type TelegramLink = { code: string; expiresAt: string; botUsername: string | null; link: string | null };

// ---------- agent status and activity ----------
export type AgentActivityKind =
  | "discovered" | "scored" | "queued" | "skipped" | "prepared" | "approved"
  | "submitted" | "needs_user" | "reply" | "interview";

export type AgentActivity = {
  id: string;
  ts: string;
  kind: AgentActivityKind;
  applicationId?: string | null;
  jobId?: string | null;
  message: string;
  data?: { job?: { title: string; companyName: string }; reasons?: string[]; count?: number; dryRun?: boolean };
};

export type AgentStatus = {
  lastTickAt?: string | null;
  nextTickAt?: string | null;
  dailyCap: number;
  usedToday: number;
  /** False: the server runs in dry-run mode, forms are filled but never sent. Absent means live. */
  liveSubmit?: boolean;
};

/** One lane is one kind of job the user wants (mirrors packages/shared Lane). `minFit` is 0..1. */
export type Lane = {
  id: string;
  name: string;
  titles: string[];
  locations: string[];
  remote: boolean;
  minFit: number;
  enabled: boolean;
};
