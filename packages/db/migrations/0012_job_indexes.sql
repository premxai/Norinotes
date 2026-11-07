DROP INDEX "jobs_dedupe_key_idx";--> statement-breakpoint
CREATE INDEX "jobs_open_recency_idx" ON "jobs" USING btree (coalesce("posted_at", "first_seen_at")) WHERE "jobs"."closed_at" IS NULL;