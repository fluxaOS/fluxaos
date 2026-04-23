-- R-RUNTIME (2026-04-23): workspace isolation table + project columns for
-- worktree-per-run deploy loop.
--
-- Hand-written rather than auto-generated because drizzle/meta/ snapshots
-- have drifted from the actual applied schema (last accurate snapshot is
-- 0003_snapshot.json; migrations 0004 and 0006 were applied without
-- refreshing the meta cache). Auto-generation in this state produces a
-- catch-up migration that would conflict with existing tables/columns.
-- Meta-snapshot rehydration is filed as a separate concern — see DEF.

-- ─── isolation_environment ────────────────────────────────────────────────

CREATE TABLE "isolation_environment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"provider" text DEFAULT 'worktree' NOT NULL,
	"working_path" text NOT NULL,
	"branch_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "isolation_environment" ADD CONSTRAINT "isolation_environment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "isolation_environment" ADD CONSTRAINT "isolation_environment_run_id_pipeline_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_run"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "isolation_env_active_idx" ON "isolation_environment" USING btree ("project_id","run_id") WHERE status = 'active';
--> statement-breakpoint
CREATE INDEX "isolation_env_project_status_idx" ON "isolation_environment" USING btree ("project_id","status");
--> statement-breakpoint

-- ─── project: default_branch + worktree_copy_files ───────────────────────

ALTER TABLE "project" ADD COLUMN "default_branch" text DEFAULT 'main' NOT NULL;
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "worktree_copy_files" jsonb DEFAULT '[]'::jsonb NOT NULL;
