ALTER TABLE "companies" ADD COLUMN "domain" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "discovered_via" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "host" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "last_success_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "next_poll_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "error_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "not_found_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "empty_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "last_job_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "new_jobs_7d" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "etag" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "boost_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "missing_reads" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "companies_status_next_poll_idx" ON "companies" USING btree ("status","next_poll_at");--> statement-breakpoint
CREATE INDEX "companies_ats_status_idx" ON "companies" USING btree ("ats_type","status");
--> statement-breakpoint
-- Rows that exist today are the curated registry and boards users added: active, polled first.
UPDATE "companies" SET "discovered_via" = 'registry', "priority" = 100;--> statement-breakpoint
UPDATE "companies" SET "last_success_at" = "last_polled_at", "next_poll_at" = "last_polled_at" + interval '3 hours' WHERE "last_polled_at" IS NOT NULL;--> statement-breakpoint
UPDATE "companies" c SET "last_job_count" = (SELECT count(*) FROM "jobs" j WHERE j."company_id" = c."id" AND j."closed_at" IS NULL);
