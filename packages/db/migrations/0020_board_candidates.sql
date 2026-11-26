CREATE TABLE "board_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ats_type" text NOT NULL,
	"ats_token" text NOT NULL,
	"name" text NOT NULL,
	"sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"status_reason" text,
	"open_jobs" integer,
	"fresh_us_jobs" integer,
	"target_jobs" jsonb,
	"score" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"next_verify_at" timestamp with time zone,
	"error_streak" integer DEFAULT 0 NOT NULL,
	"company_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_candidates" ADD CONSTRAINT "board_candidates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_candidates_ats_token_uq" ON "board_candidates" USING btree ("ats_type","ats_token");--> statement-breakpoint
CREATE INDEX "board_candidates_status_next_idx" ON "board_candidates" USING btree ("status","next_verify_at");