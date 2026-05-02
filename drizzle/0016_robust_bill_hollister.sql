ALTER TABLE "pipeline" ADD COLUMN "playbook_path" text;--> statement-breakpoint
ALTER TABLE "pipeline" ADD COLUMN "playbook_scope" text;--> statement-breakpoint
ALTER TABLE "stage_run" ADD COLUMN "result_doc" jsonb;