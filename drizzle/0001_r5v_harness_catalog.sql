-- R5-V: harness_catalog table + pipeline_stage/stage_run column additions
CREATE TABLE "harness_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"binary" text NOT NULL,
	"default_args" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_flag" text,
	"dir_flag" text,
	"session_name_flag" text,
	"prompt_transport" text DEFAULT 'argv' NOT NULL,
	"prompt_send_delay_ms" integer DEFAULT 0 NOT NULL,
	"probe_command" text,
	"issue_prompt_template" text,
	"queue_prompt_template" text,
	"env_vars" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extra_args" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "harness_catalog_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD COLUMN "skill_id" uuid;
--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD COLUMN "harness_id" uuid;
--> statement-breakpoint
ALTER TABLE "stage_run" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "stage_run" ADD COLUMN "pid" integer;
--> statement-breakpoint
ALTER TABLE "stage_run" ADD COLUMN "exit_code" integer;
--> statement-breakpoint
ALTER TABLE "stage_run" ADD COLUMN "skill_id" uuid;
--> statement-breakpoint
ALTER TABLE "stage_run" ADD COLUMN "harness_id" uuid;
--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD CONSTRAINT "pipeline_stage_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD CONSTRAINT "pipeline_stage_harness_id_harness_catalog_id_fk" FOREIGN KEY ("harness_id") REFERENCES "public"."harness_catalog"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stage_run" ADD CONSTRAINT "stage_run_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stage_run" ADD CONSTRAINT "stage_run_harness_id_harness_catalog_id_fk" FOREIGN KEY ("harness_id") REFERENCES "public"."harness_catalog"("id") ON DELETE no action ON UPDATE no action;
