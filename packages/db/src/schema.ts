import { sql } from "drizzle-orm";
import {
  bigint, bigserial, boolean, date, index, integer, jsonb, numeric, pgTable, primaryKey, real, text,
  timestamp, uniqueIndex, uuid, vector,
} from "drizzle-orm/pg-core";
import type { ApplicationStatus, AtsType, CareerPointKind, InboxKind, JobSpec, ShortlistStatus } from "@norinote/shared";

/** Embedding width. Must match EMBEDDING_MODEL (text-embedding-3-small is 1536). */
export const EMBEDDING_DIMENSIONS = 1536;

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();
/** `text[]` column; callers add .notNull().default(...). */
const textArray = (name: string) => text(name).array();

// ---------------------------------------------------------------------------------------------------------------------
// Shared, written once
// ---------------------------------------------------------------------------------------------------------------------

/** Where a company stands in the registry. New seeds start as candidate; the first poll validates them. */
export const COMPANY_STATUSES = ["candidate", "active", "probation", "disabled", "dead"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

/**
 * A company is a tenant on one job system. The registry columns drive the scheduler (see docs/job-collection.md):
 * `status`, `next_poll_at`, `priority` and `host` pick what to poll next; the rest record how the board behaves.
 */
export const companies = pgTable("companies", {
  id: id(),
  atsType: text("ats_type").$type<AtsType>().notNull(),
  atsToken: text("ats_token").notNull(),
  name: text("name").notNull(),
  /** Company web domain when a seed knows it. */
  domain: text("domain"),
  /** registry, seed:ats-scrapers, seed:open-ats-feed, user, url, crawl. */
  discoveredVia: text("discovered_via").notNull().default("user"),
  status: text("status").$type<CompanyStatus>().notNull().default("active"),
  /** Politeness group: boards with the same host share a concurrency limit. Null = the job system's own group. */
  host: text("host"),
  /** Why the board is disabled or dead (blocked by its host, five failed polls, 14 days empty, gone). Null otherwise. */
  statusReason: text("status_reason"),
  lastPolledAt: ts("last_polled_at"),
  lastSuccessAt: ts("last_success_at"),
  /**
   * First successful read. Jobs seen on that read were already on the board, so a job with no posted date counts as new
   * only when it first appears on a later read.
   */
  firstReadAt: ts("first_read_at"),
  nextPollAt: ts("next_poll_at"),
  /** Consecutive failed polls. */
  errorStreak: integer("error_streak").notNull().default(0),
  /** First "board not found" answer of the current probation. */
  notFoundSince: ts("not_found_since"),
  /** When the board first read as empty (null while it has jobs). 14 days empty disables it. */
  emptySince: ts("empty_since"),
  lastJobCount: integer("last_job_count").notNull().default(0),
  /** Jobs published (or first seen) in the last 7 days, as of the last poll. Drives the poll interval. */
  newJobs7d: integer("new_jobs_7d").notNull().default(0),
  /** Validator for conditional requests (If-None-Match). */
  etag: text("etag"),
  /** Higher polls first. Curated registry 100, seeds 0, empty boards -10. */
  priority: integer("priority").notNull().default(0),
  /** A user is waiting on this company (their lanes fit its jobs): until this time it polls at boost priority. */
  boostUntil: ts("boost_until"),
  blocked: boolean("blocked").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("companies_ats_token_uq").on(t.atsType, t.atsToken),
  index("companies_last_polled_idx").on(t.blocked, t.lastPolledAt),
  index("companies_status_next_poll_idx").on(t.status, t.nextPollAt),
  index("companies_ats_status_idx").on(t.atsType, t.status),
]);

export const jobs = pgTable("jobs", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  atsType: text("ats_type").$type<AtsType>().notNull(),
  externalId: text("external_id").notNull(),
  title: text("title").notNull(),
  location: text("location"),
  remote: boolean("remote").notNull().default(false),
  descriptionText: text("description_text").notNull().default(""),
  applyUrl: text("apply_url").notNull(),
  postedAt: ts("posted_at"),
  firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  closedAt: ts("closed_at"),
  /** Complete reads of the board in a row that did not list this job. A job closes at 2. */
  missingReads: integer("missing_reads").notNull().default(0),
  /** Normalised company + title + location, so the same job on two boards is stored once. */
  dedupeKey: text("dedupe_key").notNull(),
}, (t) => [
  uniqueIndex("jobs_ats_external_uq").on(t.atsType, t.externalId),
  index("jobs_closed_posted_idx").on(t.closedAt, t.postedAt),
  index("jobs_dedupe_key_idx").on(t.dedupeKey),
  index("jobs_company_idx").on(t.companyId),
]);

export const jobSpecs = pgTable("job_specs", {
  id: id(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  spec: jsonb("spec").$type<JobSpec>().notNull(),
  model: text("model").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("job_specs_job_version_uq").on(t.jobId, t.version)]);

export const jobEmbeddings = pgTable("job_embeddings", {
  jobId: uuid("job_id").primaryKey().references(() => jobs.id, { onDelete: "cascade" }),
  embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
  model: text("model").notNull(),
  createdAt: createdAt(),
}, (t) => [index("job_embeddings_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops"))]);

// ---------------------------------------------------------------------------------------------------------------------
// Per user
// ---------------------------------------------------------------------------------------------------------------------

export const users = pgTable("users", {
  id: id(),
  /** Stored lower-cased. */
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  emailVerifiedAt: ts("email_verified_at"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("users_email_uq").on(t.email)]);

export const sessions = pgTable("sessions", {
  /** SHA-256 of the cookie token; the token itself is never stored. */
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const authTokens = pgTable("auth_tokens", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** `telegram_link`: a one-time Telegram deep-link token (see docs/telegram.md). */
  kind: text("kind").$type<"email_verification" | "password_reset" | "telegram_link">().notNull(),
  /** SHA-256 of the emailed token. */
  tokenHash: text("token_hash").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("auth_tokens_hash_uq").on(t.tokenHash), index("auth_tokens_user_idx").on(t.userId, t.kind)]);

export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  /** Name, email, phone, links. */
  contact: jsonb("contact").$type<Record<string, string>>().notNull().default({}),
  location: text("location"),
  /** Per country: authorised, needs sponsorship, citizenship, clearance. */
  workAuth: jsonb("work_auth").$type<Record<string, unknown>>().notNull().default({}),
  salaryExpectation: jsonb("salary_expectation").$type<Record<string, unknown>>().notNull().default({}),
  startDate: text("start_date"),
  /** Equal opportunity defaults (gender, race, veteran, disability), each may be "decline". */
  eeo: jsonb("eeo").$type<Record<string, string>>().notNull().default({}),
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
  resumeText: text("resume_text"),
  /** One shared daily cap for all lanes. 0 = autopilot off. */
  dailyCap: integer("daily_cap").notNull().default(0),
  updatedAt: updatedAt(),
});

export const lanes = pgTable("lanes", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  titles: textArray("titles").notNull().default(sql`'{}'::text[]`),
  locations: textArray("locations").notNull().default(sql`'{}'::text[]`),
  /** Remote jobs also qualify, whatever their location. */
  remote: boolean("remote").notNull().default(false),
  minFit: real("min_fit").notNull().default(0.6),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [index("lanes_user_idx").on(t.userId)]);

export const careerPoints = pgTable("career_points", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").$type<CareerPointKind>().notNull(),
  title: text("title").notNull(),
  org: text("org"),
  /** `YYYY` or `YYYY-MM`. */
  startDate: text("start_date"),
  endDate: text("end_date"),
  text: text("text").notNull().default(""),
  skills: textArray("skills").notNull().default(sql`'{}'::text[]`),
  scope: jsonb("scope").$type<Record<string, unknown>>().notNull().default({}),
  metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
  sourceQuote: text("source_quote"),
  /** `resume` points are replaced on every resume upload; `user` facts (added by the user) are never touched. */
  source: text("source").$type<"resume" | "user">().notNull().default("resume"),
  createdAt: createdAt(),
}, (t) => [index("career_points_user_kind_idx").on(t.userId, t.kind)]);

export const careerPointEmbeddings = pgTable("career_point_embeddings", {
  careerPointId: uuid("career_point_id").primaryKey().references(() => careerPoints.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
  model: text("model").notNull(),
  /** Hash of the text that was embedded; a point is re-embedded when its text no longer hashes to this. */
  contentHash: text("content_hash"),
  createdAt: createdAt(),
}, (t) => [
  index("career_point_embeddings_user_idx").on(t.userId),
  index("career_point_embeddings_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
]);

export const shortlist = pgTable("shortlist", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  /** 0 to 1. */
  fit: numeric("fit", { precision: 4, scale: 3, mode: "number" }).notNull(),
  fitMap: jsonb("fit_map").$type<unknown[]>().notNull().default([]),
  reasons: textArray("reasons").notNull().default(sql`'{}'::text[]`),
  status: text("status").$type<ShortlistStatus>().notNull().default("new"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("shortlist_user_job_uq").on(t.userId, t.jobId),
  index("shortlist_user_status_fit_idx").on(t.userId, t.status, t.fit.desc()),
]);

export const applications = pgTable("applications", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  status: text("status").$type<ApplicationStatus>().notNull().default("queued"),
  /** The resume tailored for this application. No foreign key: resumes point back at applications. */
  resumeId: uuid("resume_id"),
  /** The posting's canonical URL (see @norinote/apply canonicalJobUrl): one application per user and URL, whichever job row it came from. */
  canonicalUrl: text("canonical_url"),
  answers: jsonb("answers").$type<Record<string, string>>().notNull().default({}),
  pendingQuestions: jsonb("pending_questions").$type<unknown[]>().notNull().default([]),
  receipt: jsonb("receipt").$type<Record<string, unknown>>(),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  preparedAt: ts("prepared_at"),
  approvedAt: ts("approved_at"),
  submittedAt: ts("submitted_at"),
  /** The job system confirmed receipt (a `confirmation` mail in the owned inbox). Not an outcome. */
  confirmedAt: ts("confirmed_at"),
  /**
   * Which tailoring produced the submitted resume, recorded once after submission: `off` (no tailoring report), `v<N>`
   * (tailoring report version N with model rewrites), `v<N>-selection` (selection only, the model was unavailable).
   */
  tailoringVersion: text("tailoring_version"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("applications_user_job_uq").on(t.userId, t.jobId),
  uniqueIndex("applications_user_canonical_url_uq").on(t.userId, t.canonicalUrl),
  index("applications_user_status_idx").on(t.userId, t.status),
]);

export const resumes = pgTable("resumes", {
  id: id(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  /** What was changed from the base resume, for the user to review. */
  changes: jsonb("changes").$type<unknown[]>().notNull().default([]),
  pdfPath: text("pdf_path"),
  pages: integer("pages"),
  atsChecks: jsonb("ats_checks").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index("resumes_application_idx").on(t.applicationId)]);

export const answerBank = pgTable("answer_bank", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  questionText: text("question_text").notNull(),
  questionEmbedding: vector("question_embedding", { dimensions: EMBEDDING_DIMENSIONS }),
  answer: text("answer").notNull(),
  source: text("source").$type<"default" | "user" | "model">().notNull(),
  lastUsedAt: ts("last_used_at"),
  createdAt: createdAt(),
}, (t) => [
  index("answer_bank_user_idx").on(t.userId),
  index("answer_bank_hnsw_idx").using("hnsw", t.questionEmbedding.op("vector_cosine_ops")),
]);

/**
 * Form recipe cache, shared by all users: for one form (fingerprint = hash of job system, company token and the sorted
 * normalised label|type|options of its fields), which profile slot each question maps to and which widget strategy filled
 * it. Never an applicant's value. A hit skips the classification model; a stale entry heals once and is rewritten.
 */
export const formRecipes = pgTable("form_recipes", {
  id: id(),
  fingerprint: text("fingerprint").notNull(),
  atsType: text("ats_type").notNull(),
  companyToken: text("company_token").notNull(),
  /** Per question: { labelKey, label, type, slot, strategy, optionMap }. */
  fields: jsonb("fields").$type<unknown[]>().notNull().default([]),
  version: integer("version").notNull().default(1),
  hits: integer("hits").notNull().default(0),
  heals: integer("heals").notNull().default(0),
  lastUsedAt: ts("last_used_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("form_recipes_fingerprint_uq").on(t.fingerprint), index("form_recipes_company_idx").on(t.atsType, t.companyToken)]);

export const runEvents = pgTable("run_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  ts: ts("ts").notNull().defaultNow(),
  step: text("step").notNull(),
  level: text("level").$type<"info" | "warn" | "error">().notNull().default("info"),
  message: text("message").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>(),
}, (t) => [index("run_events_application_ts_idx").on(t.applicationId, t.ts)]);

export const inboxAddresses = pgTable("inbox_addresses", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  address: text("address").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("inbox_addresses_address_uq").on(t.address), index("inbox_addresses_user_idx").on(t.userId)]);

export const inboxMessages = pgTable("inbox_messages", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  applicationId: uuid("application_id").references(() => applications.id, { onDelete: "set null" }),
  kind: text("kind").$type<InboxKind>().notNull(),
  code: text("code"),
  fromAddress: text("from_address").notNull(),
  /** The Message-ID header (or the provider id): a webhook retry of the same message is stored once. */
  messageId: text("message_id"),
  /** Magic links and confirmation URLs found in the message. */
  links: jsonb("links").$type<string[]>().notNull().default([]),
  subject: text("subject").notNull().default(""),
  body: text("body").notNull().default(""),
  /**
   * What the inbox package learnt about the message (see `InboxMeta` in @norinote/inbox): transport, attachment metadata
   * (names, types, sizes; never the content), spam verdict, verification link, link evidence, forwarding state.
   */
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  receivedAt: ts("received_at").notNull().defaultNow(),
}, (t) => [
  index("inbox_messages_user_received_idx").on(t.userId, t.receivedAt),
  index("inbox_messages_application_idx").on(t.applicationId),
  uniqueIndex("inbox_messages_user_message_uq").on(t.userId, t.messageId),
]);

export const channels = pgTable("channels", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"telegram">().notNull(),
  address: text("address").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("channels_user_kind_uq").on(t.userId, t.kind)]);

/** What a `channel_messages` row is: a message for the user, or (`apply_intent`) an Apply tap waiting for its application to be prepared. */
export type ChannelMessageKind = "digest" | "questions" | "prompt" | "submitted" | "needs_user" | "inbox" | "summary" | "notice" | "apply_intent";

/**
 * Outbox and log of Telegram messages (see docs/telegram.md). One row per message per user, deduplicated by `dedupe_key`
 * (`digest:2026-11-02`, `submitted:<application id>`, ...). `not_before` holds a message through quiet hours; the worker
 * sends `pending` rows and records the Telegram message id, which is how a reply or a button press finds its row again.
 */
export const channelMessages = pgTable("channel_messages", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").$type<ChannelMessageKind>().notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }),
  /** Text, buttons and what they refer to (job ids, question groups). Never a secret. */
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").$type<"pending" | "sent" | "skipped" | "failed" | "done">().notNull().default("pending"),
  notBefore: ts("not_before"),
  chatId: text("chat_id"),
  telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  createdAt: createdAt(),
  sentAt: ts("sent_at"),
}, (t) => [
  uniqueIndex("channel_messages_user_dedupe_uq").on(t.userId, t.dedupeKey),
  index("channel_messages_status_idx").on(t.status, t.notBefore),
  index("channel_messages_chat_message_idx").on(t.chatId, t.telegramMessageId),
]);

export const llmUsage = pgTable("llm_usage", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** UTC day, YYYY-MM-DD. */
  day: date("day", { mode: "string" }).notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  /** Millionths of a US dollar. */
  costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
  calls: integer("calls").notNull().default(0),
  updatedAt: updatedAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.day] })]);

/**
 * What happened to a submitted application (see docs/outcomes.md). "No response" is never stored: it is derived 30 days
 * after submission when no outcome exists. A confirmation is not an outcome (it sets `applications.confirmed_at`).
 */
export const outcomes = pgTable("outcomes", {
  id: id(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"reply" | "interview" | "rejection" | "offer">().notNull(),
  at: ts("at").notNull().defaultNow(),
  /** `inbox`: from a classified message in the owned inbox. `manual`: the user added it (many replies reach their own mailbox). */
  source: text("source").$type<"inbox" | "manual">().notNull().default("inbox"),
  /** The `inbox_messages` row it came from, once per message. Null for manual rows (and after the message is purged). */
  messageId: uuid("message_id").references(() => inboxMessages.id, { onDelete: "set null" }),
  /** The user removed it (a wrong automatic outcome). Kept, so re-reading the same message never brings it back. */
  deletedAt: ts("deleted_at"),
  createdAt: createdAt(),
}, (t) => [index("outcomes_application_idx").on(t.applicationId), uniqueIndex("outcomes_message_uq").on(t.messageId)]);

export const schema = {
  companies, jobs, jobSpecs, jobEmbeddings, users, sessions, authTokens, profiles, lanes, careerPoints,
  careerPointEmbeddings, shortlist, applications, resumes, answerBank, formRecipes, runEvents, inboxAddresses, inboxMessages,
  channels, channelMessages, llmUsage, outcomes,
};
