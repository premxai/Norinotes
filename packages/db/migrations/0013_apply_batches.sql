CREATE TABLE "apply_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"last_started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "apply_batches" ADD CONSTRAINT "apply_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apply_batches_user_status_idx" ON "apply_batches" USING btree ("user_id","status");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_batch_id_apply_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."apply_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_batch_idx" ON "applications" USING btree ("batch_id");