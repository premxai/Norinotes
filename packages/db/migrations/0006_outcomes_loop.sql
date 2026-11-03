ALTER TABLE "applications" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "tailoring_version" text;--> statement-breakpoint
ALTER TABLE "outcomes" ADD COLUMN "source" text DEFAULT 'inbox' NOT NULL;--> statement-breakpoint
ALTER TABLE "outcomes" ADD COLUMN "message_id" uuid;--> statement-breakpoint
ALTER TABLE "outcomes" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outcomes" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_message_id_inbox_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."inbox_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outcomes_message_uq" ON "outcomes" USING btree ("message_id");