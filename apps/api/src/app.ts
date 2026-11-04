import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { addJobByUrl } from "@norinote/ingest";
import { fileStoreFromEnv } from "@norinote/shared/files";
import { createMailer } from "./mailer.js";
import { errorHandler, HttpError } from "./http.js";
import { browserOrigins, originGuard, RateLimiter, securityHeaders } from "./security.js";
import type { ApiDeps, AppEnv, Ctx } from "./types.js";
import { agentRoutes } from "./routes/agent.js";
import { applicationRoutes } from "./routes/applications.js";
import { authRoutes } from "./routes/auth.js";
import { channelRoutes } from "./routes/channels.js";
import { artifactRoutes, resumeRoutes } from "./routes/files.js";
import { graphRoutes } from "./routes/graph.js";
import { healthRoutes } from "./routes/health.js";
import { inboundRoutes, inboxRoutes } from "./routes/inbox.js";
import { jobRoutes } from "./routes/jobs.js";
import { laneRoutes } from "./routes/lanes.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { applicationOutcomeRoutes, outcomeRoutes } from "./routes/outcomes.js";
import { profileRoutes } from "./routes/profile.js";
import { shortlistRoutes } from "./routes/shortlist.js";

const MB = 1024 * 1024;

/** Request body size by path: a resume upload and an inbound email may be large, everything else is small JSON. */
function maxBody(path: string, resumeBytes: number): number {
  if (path === "/api/profile/resume-file") return resumeBytes + MB;
  if (path === "/api/inbound/email" || path.startsWith("/api/inbox/webhook/")) return 25 * MB;
  if (path === "/api/profile/resume") return MB;
  return MB / 2;
}

/** Builds the API. Everything it touches arrives through `deps`, so tests inject PGlite and a recording queue. */
export function createApp(deps: ApiDeps): Hono<AppEnv> {
  const config = deps.config;
  const ctx: Ctx = {
    db: deps.db,
    enqueue: deps.enqueue,
    config,
    mailer: deps.mailer ?? createMailer(config, deps.log),
    now: deps.now ?? (() => new Date()),
    addJob: deps.addJob ?? addJobByUrl,
    log: deps.log ?? ((line) => console.log(line)),
    limiter: deps.limiter ?? new RateLimiter(),
    files: deps.files === undefined ? fileStoreFromEnv() : deps.files,
    ...(deps.telegram ? { telegram: deps.telegram } : {}),
  };

  const app = new Hono<AppEnv>();
  app.use("*", securityHeaders);
  app.use("/api/*", cors({ origin: browserOrigins(config), credentials: true, allowHeaders: ["Content-Type"], allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], maxAge: 600 }));
  app.use("/api/*", originGuard(config));
  app.use("/api/*", (c, next) => bodyLimit({
    maxSize: maxBody(c.req.path, config.maxResumeBytes),
    onError: () => { throw new HttpError(413, "That request is too large"); },
  })(c, next));

  app.route("/api/health", healthRoutes(ctx));
  app.route("/api/auth", authRoutes(ctx));
  app.route("/api", profileRoutes(ctx));
  app.route("/api/onboarding", onboardingRoutes(ctx));
  app.route("/api/graph", graphRoutes(ctx));
  app.route("/api/lanes", laneRoutes(ctx));
  app.route("/api/jobs", jobRoutes(ctx));
  app.route("/api/shortlist", shortlistRoutes(ctx));
  app.route("/api/applications", applicationRoutes(ctx));
  app.route("/api/applications", applicationOutcomeRoutes(ctx));
  app.route("/api/outcomes", outcomeRoutes(ctx));
  app.route("/api/resumes", resumeRoutes(ctx));
  app.route("/api/artifacts", artifactRoutes(ctx));
  app.route("/api/agent", agentRoutes(ctx));
  app.route("/api/inbox", inboxRoutes(ctx));
  app.route("/api/inbound", inboundRoutes(ctx));
  app.route("/api/channels", channelRoutes(ctx));

  app.notFound((c) => c.json({ error: "Not found" }, 404));
  app.onError(errorHandler(ctx.log));
  return app;
}
