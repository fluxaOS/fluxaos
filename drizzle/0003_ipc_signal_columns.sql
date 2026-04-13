ALTER TABLE "stage_run" ADD COLUMN "skill_signal" text;--> statement-breakpoint
ALTER TABLE "stage_run" ADD COLUMN "skill_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "stage_run" ADD COLUMN "trigger" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "stage_run" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "harness_catalog" ADD COLUMN "output_format" text DEFAULT 'stream-json' NOT NULL;--> statement-breakpoint
ALTER TABLE "harness_catalog" ADD COLUMN "output_format_flag" text;
