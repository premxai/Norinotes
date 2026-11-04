CREATE INDEX "applications_job_idx" ON "applications" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "jobs_with_text_idx" ON "jobs" USING btree ("id") WHERE "jobs"."description_text" <> '';--> statement-breakpoint
CREATE INDEX "saved_jobs_job_idx" ON "saved_jobs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "shortlist_job_idx" ON "shortlist" USING btree ("job_id");