/**
 * Typed client for the Norinote HTTP API (ARCHITECTURE.md "API surface").
 * In the browser every call is same-origin (`/api/...`, proxied to apps/api by next.config rewrites) so the
 * httpOnly session cookie rides along. On the server, calls go straight to the API with the incoming request's cookie
 * header forwarded. Only when NEXT_PUBLIC_USE_MOCK is exactly "1" is every call answered from ./mock instead of the
 * network. Live is the default, so a deploy that forgets the variable never ships the demo.
 */
import type {
  AgentActivity, AgentStatus, Application, ApplicationDetail, ApplicationListItem, Graph, InboxMessage, IngestResult, Job, JobDetail,
  JobsSummary, JobWithMatch, Lane, Me, OnboardingState, OnboardingStepId, Preferences, Profile, Resume, SessionInfo, ShortlistItem,
  TelegramInfo, TelegramLink, User,
} from "./types";
import { SESSION_COOKIE } from "./session";

export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "1";
/** Server-side base URL of apps/api. The browser never uses it. */
const SERVER_API_URL = (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

/**
 * `message` is what a person should read ("Cannot reach the server. Try again in a moment."), so every component that shows
 * `error.message` is already safe. The technical text (method, path, status, internal address) lives in `technical`, for logs.
 */
export class ApiError extends Error {
  technical: string;
  constructor(public status: number, technical: string, public detail: string = technical) {
    super(detail);
    this.technical = technical;
    this.name = "ApiError";
  }
}

/** A server message that names an environment variable is for the operator, not the person using Norinote. */
export function friendly(msg: string): string {
  if (/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b.*\b(?:is not set|not configured|missing)\b|\b(?:is not set|not configured)\b.*\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/.test(msg)) return "This feature is not set up on this Norinote yet.";
  return msg;
}

/** Base URL + headers for the current runtime: relative in the browser, absolute with forwarded cookies on the server. */
async function target(): Promise<{ base: string; headers: Record<string, string> }> {
  if (typeof window !== "undefined") return { base: "", headers: {} };
  const headers: Record<string, string> = {};
  try {
    const { headers: incoming } = await import("next/headers");
    const h = await incoming();
    const cookie = h.get("cookie");
    if (cookie) headers.cookie = cookie;
    const ua = h.get("user-agent");
    if (ua) headers["user-agent"] = ua;
  } catch { /* outside a request scope (build time) */ }
  return { base: SERVER_API_URL, headers };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { base, headers } = await target();
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  if (body !== undefined && !isForm) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      cache: "no-store",
      credentials: "include",
    });
  } catch (e) {
    const err = new ApiError(0, `Cannot reach the Norinote API${base ? ` at ${base}` : ""}. Start apps/api or set NEXT_PUBLIC_USE_MOCK=1. (${(e as Error).message})`, "Cannot reach the server. Try again in a moment.");
    if (typeof window === "undefined") console.warn(`[web] ${err.technical}`);
    throw err;
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: string; message?: string };
      msg = j.error ?? j.message ?? msg;
    } catch { /* not json */ }
    const err = new ApiError(res.status, `${method} ${path} failed (${res.status}): ${msg}`, friendly(msg));
    // A session that ended mid-visit (expired, signed out elsewhere, password reset): go sign in again, back to this page,
    // instead of leaving "Unauthorized" in every panel. Sign-in calls themselves report their own 401s.
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/")) {
      // /session-expired is a route handler that clears the cookie, so it needs a full navigation, not the client router.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/session-expired?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    if (typeof window === "undefined" && res.status >= 500) console.warn(`[web] ${err.technical}`);
    throw err;
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return (await res.text()) as unknown as T;
  return (await res.json()) as T;
}

/** Mock mode has no API to set the httpOnly cookie, so a readable stand-in keeps the proxy gate working. */
function mockSession(on: boolean) {
  if (typeof document === "undefined") return;
  document.cookie = on ? `${SESSION_COOKIE}=mock; path=/; max-age=2592000; samesite=lax` : `${SESSION_COOKIE}=; path=/; max-age=0`;
}

const mock = () => import("./mock");
/** GET /api/jobs. Server defaults: status open, sort best, maxAgeHours 72 (the most), lanes on for best, group on, clearance show. */
export type ListJobsParams = {
  q?: string; limit?: number; minScore?: number; status?: string;
  view?: "best" | "new" | "today";
  sort?: "best" | "new"; maxAgeHours?: number; lanes?: boolean; group?: boolean; clearance?: "hide" | "show";
};

const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
};

/** Calls only the live API can answer (account security). In mock mode they say so instead of faking it. */
async function live<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (USE_MOCK) throw new ApiError(0, "This needs the live API. Unset NEXT_PUBLIC_USE_MOCK and start apps/api.", "This is not available in demo mode: demo mode has no real account.");
  return request<T>(method, path, body);
}

/** Tailored resume PDF (same-origin, cookie authenticated). */
export const resumePdfUrl = (id: string) => `/api/resumes/${id}.pdf`;

/** New lanes get a temporary "new-" id in the browser; the server assigns the real one. */
const toWireLanes = (lanes: Lane[]) => lanes.map((l) => (l.id.startsWith("new-") ? { ...l, id: undefined } : l));

export const api = {
  // ---- auth
  session: async (): Promise<{ user: User }> => (USE_MOCK ? { user: (await mock()).me.user } : request("GET", "/api/auth/session")),
  login: async (email: string, password: string): Promise<{ user: User }> => {
    if (USE_MOCK) { mockSession(true); return { user: { ...(await mock()).me.user, email } }; }
    return request("POST", "/api/auth/login", { email, password });
  },
  signup: async (email: string, password: string, name: string): Promise<{ user: User }> => {
    if (USE_MOCK) { mockSession(true); return { user: { ...(await mock()).me.user, email, name } }; }
    return request("POST", "/api/auth/signup", { email, password, name });
  },
  logout: async (): Promise<void> => {
    if (USE_MOCK) { mockSession(false); return; }
    await request("POST", "/api/auth/logout");
  },
  /** Always resolves (the server answers the same for every address). */
  forgotPassword: async (email: string): Promise<void> => {
    if (USE_MOCK) return;
    await request("POST", "/api/auth/forgot-password", { email });
  },
  resetPassword: (token: string, password: string): Promise<{ ok: true }> => live("POST", "/api/auth/reset-password", { token, password }),
  changePassword: (current: string, next: string): Promise<{ ok: true }> => live("POST", "/api/auth/change-password", { current, next }),
  verifyEmail: (token: string): Promise<{ ok: true }> => live("POST", "/api/auth/verify-email", { token }),
  resendVerification: (): Promise<{ ok: true; verified: boolean }> => live("POST", "/api/auth/resend-verification", {}),
  sessions: (): Promise<SessionInfo[]> => live("GET", "/api/auth/sessions"),
  revokeSession: async (id: string): Promise<void> => { await live("DELETE", `/api/auth/sessions/${id}`); },
  revokeOtherSessions: (): Promise<{ revoked: number }> => live("POST", "/api/auth/sessions/revoke-others", {}),
  /** Permanently deletes the signed-in account and all its data. `confirm` must equal the account email. Mock mode is a no-op. */
  deleteAccount: async (confirm: string): Promise<void> => {
    if (USE_MOCK) return;
    await request("DELETE", "/api/auth/account", { confirm });
  },

  // ---- onboarding
  onboarding: async (): Promise<OnboardingState> => (USE_MOCK ? (await mock()).onboarding : request("GET", "/api/onboarding")),
  /** Merges `data` into the profile and advances past `step`. */
  saveOnboarding: async (step: OnboardingStepId, data: Record<string, unknown>): Promise<{ profile: Profile }> =>
    USE_MOCK ? { profile: { ...(await mock()).me.profile, ...data } as Profile } : request("PUT", "/api/onboarding", { step, data }),
  uploadResumeFile: async (file: File): Promise<IngestResult> => {
    if (USE_MOCK) return (await mock()).ingest;
    const form = new FormData();
    form.append("file", file);
    return request("POST", "/api/profile/resume-file", form);
  },

  // ---- me / profile
  me: async (): Promise<Me> => (USE_MOCK ? (await mock()).me : request("GET", "/api/me")),
  updateProfile: async (patch: Partial<Omit<Profile, "preferences">> & { preferences?: Preferences }): Promise<Profile> => {
    if (USE_MOCK) return { ...(await mock()).me.profile, ...patch, preferences: { ...(await mock()).me.profile.preferences, ...patch.preferences } } as Profile;
    return request("PUT", "/api/profile", patch);
  },
  uploadResume: async (text: string, replace = false): Promise<IngestResult> =>
    USE_MOCK ? (await mock()).ingest : request("POST", "/api/profile/resume", { text, replace }),

  // ---- graph
  graph: async (): Promise<Graph> => (USE_MOCK ? (await mock()).graph : request("GET", "/api/graph")),
  addFact: async (text: string): Promise<{ nodesCreated: number }> =>
    USE_MOCK ? { nodesCreated: 2 } : request("POST", "/api/graph/facts", { text }),
  deleteGraphNode: async (id: string): Promise<void> => {
    if (!USE_MOCK) await request("DELETE", `/api/graph/nodes/${id}`);
  },

  // ---- lanes
  lanes: async (): Promise<Lane[]> => (USE_MOCK ? (await mock()).lanes() : request("GET", "/api/lanes")),
  saveLanes: async (lanes: Lane[]): Promise<Lane[]> => (USE_MOCK ? (await mock()).saveLanes(lanes) : request("PUT", "/api/lanes", toWireLanes(lanes))),

  // ---- jobs
  listJobs: async (p: ListJobsParams = {}): Promise<JobWithMatch[]> =>
    USE_MOCK ? (await mock()).listJobs(p) : request("GET", `/api/jobs${qs(p)}`),
  jobsSummary: async (): Promise<JobsSummary> => (USE_MOCK ? (await mock()).jobsSummary() : request("GET", "/api/jobs/summary")),
  getJob: async (id: string): Promise<JobDetail> => (USE_MOCK ? (await mock()).getJob(id) : request("GET", `/api/jobs/${id}`)),
  addJobByUrl: async (url: string): Promise<{ job: Job }> =>
    USE_MOCK ? { job: (await mock()).getJob("j7").job } : request("POST", "/api/jobs/url", { url }),

  // ---- shortlist
  shortlist: async (): Promise<ShortlistItem[]> => (USE_MOCK ? (await mock()).shortlist() : request("GET", "/api/shortlist")),
  dismissShortlist: async (jobId: string): Promise<void> => {
    if (!USE_MOCK) await request("POST", `/api/shortlist/${jobId}/dismiss`);
  },

  // ---- applications
  createApplication: async (jobId: string): Promise<Application> =>
    USE_MOCK ? (await mock()).createApplication(jobId) : request("POST", "/api/applications", { jobId }),
  listApplications: async (): Promise<ApplicationListItem[]> =>
    USE_MOCK ? (await mock()).listApplications() : request("GET", "/api/applications"),
  getApplication: async (id: string): Promise<ApplicationDetail> =>
    USE_MOCK ? (await mock()).getApplication(id) : request("GET", `/api/applications/${id}`),
  /** The click that approves a prepared application: the worker submits it. */
  approveApplication: async (id: string, answers?: Record<string, string>): Promise<void> => {
    if (!USE_MOCK) await request("POST", `/api/applications/${id}/approve`, answers ? { answers } : {});
  },
  /** Answers to pending questions, keyed by question id. */
  answerQuestions: async (id: string, answers: Record<string, string>): Promise<void> => {
    if (!USE_MOCK) await request("POST", `/api/applications/${id}/answer`, { answers });
  },
  retryApplication: async (id: string): Promise<void> => {
    if (!USE_MOCK) await request("POST", `/api/applications/${id}/retry`);
  },

  // ---- resumes
  getResume: async (id: string): Promise<Resume> => (USE_MOCK ? (await mock()).getResume(id) : request("GET", `/api/resumes/${id}`)),

  // ---- inbox
  listInbox: async (): Promise<InboxMessage[]> => (USE_MOCK ? (await mock()).inbox : request("GET", "/api/inbox")),

  // ---- agent
  agentActivity: async (limit = 50): Promise<AgentActivity[]> =>
    USE_MOCK ? (await mock()).agentActivity.slice(0, limit) : request("GET", `/api/agent/activity${qs({ limit })}`),
  agentStatus: async (): Promise<AgentStatus> => (USE_MOCK ? (await mock()).agentStatus() : request("GET", "/api/agent/status")),

  // ---- channels
  telegramInfo: async (): Promise<TelegramInfo> => (USE_MOCK ? (await mock()).telegramInfo() : request("GET", "/api/channels/telegram")),
  telegramLink: async (): Promise<TelegramLink> => (USE_MOCK ? (await mock()).telegramLink() : request("POST", "/api/channels/telegram/link")),
};

/** Screenshot files are written under data/artifacts/<id>/; the API is assumed to expose them at /api/artifacts/<rest>. */
export function artifactUrl(path: string): string {
  if (/^(https?:|data:)/.test(path)) return path;
  const rest = path.replace(/\\/g, "/").replace(/^.*artifacts\//, "");
  return `/api/artifacts/${rest}`;
}
