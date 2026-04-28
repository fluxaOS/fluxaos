-- FLX-13 (2026-04-28): introduce skill_revision append-only history
-- table. Driver revisions ship in a sibling slice.
--
-- Hand-written per FLX-16.

CREATE TABLE "skill_revision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "skill_id" uuid NOT NULL,
  "revision_number" integer NOT NULL,
  "name" text NOT NULL,
  "scope" text NOT NULL,
  "description" text,
  "prompt_template" text,
  "input_schema" jsonb,
  "output_schema" jsonb,
  "tags" jsonb,
  "snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
  "snapshot_by" text,
  CONSTRAINT "skill_revision_skill_id_fkey"
    FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE cascade
);

CREATE UNIQUE INDEX "skill_revision_skill_id_revision_idx"
  ON "skill_revision" ("skill_id", "revision_number");
