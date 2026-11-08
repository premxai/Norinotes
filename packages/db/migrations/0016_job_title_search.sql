CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_title_trgm_idx" ON "jobs" USING gin ("title" gin_trgm_ops);