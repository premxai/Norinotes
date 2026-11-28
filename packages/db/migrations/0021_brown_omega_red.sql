CREATE TABLE "apply_locks" (
	"key" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"held_until" timestamp with time zone NOT NULL,
	"free_at" timestamp with time zone NOT NULL
);
