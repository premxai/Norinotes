CREATE TABLE "form_recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL,
	"ats_type" text NOT NULL,
	"company_token" text NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"heals" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "canonical_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "form_recipes_fingerprint_uq" ON "form_recipes" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "form_recipes_company_idx" ON "form_recipes" USING btree ("ats_type","company_token");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_user_canonical_url_uq" ON "applications" USING btree ("user_id","canonical_url");