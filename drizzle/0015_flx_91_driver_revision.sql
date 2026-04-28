-- FLX-91 (2026-04-28): introduce driver_revision append-only history
-- table. Mirror of skill_revision (FLX-13) for the driver entity.
--
-- Hand-written per FLX-16.

CREATE TABLE "driver_revision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "driver_id" uuid NOT NULL,
  "revision_number" integer NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "binary" text NOT NULL,
  "default_args" jsonb NOT NULL,
  "model_flag" text,
  "dir_flag" text,
  "session_name_flag" text,
  "prompt_transport" text NOT NULL,
  "output_format" text NOT NULL,
  "output_format_flag" text,
  "prompt_send_delay_ms" integer NOT NULL,
  "probe_command" text,
  "issue_prompt_template" text,
  "queue_prompt_template" text,
  "env_vars" jsonb NOT NULL,
  "extra_args" jsonb NOT NULL,
  "context_layout" jsonb NOT NULL,
  "is_enabled" boolean NOT NULL,
  "notes" text,
  "snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
  "snapshot_by" text,
  CONSTRAINT "driver_revision_driver_id_fkey"
    FOREIGN KEY ("driver_id") REFERENCES "driver"("id") ON DELETE cascade
);

CREATE UNIQUE INDEX "driver_revision_driver_id_revision_idx"
  ON "driver_revision" ("driver_id", "revision_number");
