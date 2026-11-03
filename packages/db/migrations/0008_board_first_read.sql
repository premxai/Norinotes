ALTER TABLE "companies" ADD COLUMN "first_read_at" timestamp with time zone;--> statement-breakpoint
-- Backfill: a board's first read is when its earliest job was first seen; a board read only while empty, its last success.
UPDATE "companies" c SET "first_read_at" = coalesce((SELECT min(j."first_seen_at") FROM "jobs" j WHERE j."company_id" = c."id"), c."last_success_at");
