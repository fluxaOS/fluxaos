-- FLX-197 (2026-05-07): record deploy outcomes independently of pipeline_run.
--
-- Before this change, a failed deploy mutated stage_run/pipeline_run rows
-- (flipping completed → failed and attributing the deploy error to whatever
-- stage_run was last). That lied about pipeline execution: deploy is a
-- post-pipeline action and its outcome must be observable separately.
--
-- One row per pipeline_run. Written by deploy-bridge on success/skip and
-- by pipeline-terminal-hook on failure.
--
-- Hand-written per FLX-16 (drizzle-kit generate is unusable in
-- autonomous sessions; meta snapshots still drift on main).

CREATE TABLE "deploy_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_run_id" uuid NOT NULL,
	"status" text NOT NULL,
	"skipped_reason" text,
	"error_stage" text,
	"error_message" text,
	"pr_row_id" uuid,
	"branch_row_id" uuid,
	"commit_sha" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "deploy_run" ADD CONSTRAINT "deploy_run_pipeline_run_id_pipeline_run_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_run"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "deploy_run" ADD CONSTRAINT "deploy_run_pr_row_id_issue_pull_request_id_fk" FOREIGN KEY ("pr_row_id") REFERENCES "public"."issue_pull_request"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "deploy_run" ADD CONSTRAINT "deploy_run_branch_row_id_issue_branch_id_fk" FOREIGN KEY ("branch_row_id") REFERENCES "public"."issue_branch"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "deploy_run_pipeline_run_id_idx" ON "deploy_run" USING btree ("pipeline_run_id");
