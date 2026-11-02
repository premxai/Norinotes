ALTER TABLE "career_point_embeddings" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "career_points" ADD COLUMN "source" text DEFAULT 'resume' NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN "message_id" text;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN "links" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_messages_user_message_uq" ON "inbox_messages" USING btree ("user_id","message_id");--> statement-breakpoint
-- Rows written before the column existed carried the marker in scope.source (or, without a marker, had no source quote).
UPDATE "career_points" SET "source" = 'user' WHERE "scope"->>'source' = 'user' OR ("scope"->>'source' IS NULL AND "source_quote" IS NULL);--> statement-breakpoint
UPDATE "inbox_messages" SET "kind" = 'recruiter_reply' WHERE "kind" = 'reply';
