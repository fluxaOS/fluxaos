-- FLX-90 (2026-04-28): introduce cron_job catalog table for the
-- /settings/cron tab. This is the operator-facing definition only —
-- runtime engagement (scheduler/runner) is a separate follow-up.
--
-- Hand-written per FLX-16.

CREATE TABLE "cron_job" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "project_id" uuid NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "cron_expression" text NOT NULL,
  "action_type" text NOT NULL,
  "action_payload" jsonb,
  "is_enabled" boolean DEFAULT true NOT NULL,
  "last_run_at" timestamp with time zone,
  "next_run_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cron_job_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE cascade
);

CREATE UNIQUE INDEX "cron_job_project_slug_idx"
  ON "cron_job" ("project_id", "slug");
