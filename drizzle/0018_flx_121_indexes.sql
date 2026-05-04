CREATE INDEX "stage_run_pipeline_run_id_idx" ON "stage_run" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE INDEX "stage_run_pipeline_stage_id_idx" ON "stage_run" USING btree ("pipeline_stage_id");--> statement-breakpoint
CREATE INDEX "event_stage_run_id_idx" ON "event" USING btree ("stage_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_comment_issue_id_comment_number_idx" ON "issue_comment" USING btree ("issue_id","comment_number");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_org_id_name_idx" ON "provider" USING btree ("org_id","name");