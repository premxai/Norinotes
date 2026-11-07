CREATE TABLE "graph_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"facts_added" integer DEFAULT 0 NOT NULL,
	"last_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nori_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nori_chat_undo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"before" jsonb NOT NULL,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "career_points" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "career_points" ADD COLUMN "graph_source_id" uuid;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN "used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "graph_sources" ADD CONSTRAINT "graph_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nori_chat_messages" ADD CONSTRAINT "nori_chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nori_chat_undo" ADD CONSTRAINT "nori_chat_undo_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "graph_sources_user_kind_value_uq" ON "graph_sources" USING btree ("user_id","kind","value");--> statement-breakpoint
CREATE INDEX "nori_chat_user_created_idx" ON "nori_chat_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "nori_chat_undo_user_idx" ON "nori_chat_undo" USING btree ("user_id");