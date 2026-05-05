-- FLX-153 (2026-05-05): make DB the single source of truth for pipeline routing.
-- Drops the YAML playbook columns from `pipeline` and the unused `skill_id`
-- foreign key from `pipeline_stage`. Adds `on_pass`, `on_fail`, `fallback`
-- routing columns to `pipeline_stage` so the orchestrator can read next-stage
-- routing directly from DB without consulting YAML files.
--
-- Hand-written per FLX-16 (drizzle-kit generate is unusable in
-- autonomous sessions; meta snapshots still drift on main).

ALTER TABLE "pipeline" DROP COLUMN IF EXISTS "playbook_path";--> statement-breakpoint
ALTER TABLE "pipeline" DROP COLUMN IF EXISTS "playbook_scope";--> statement-breakpoint
ALTER TABLE "pipeline_stage" DROP COLUMN IF EXISTS "skill_id";--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD COLUMN "on_pass" text;--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD COLUMN "on_fail" text;--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD COLUMN "fallback" text;
