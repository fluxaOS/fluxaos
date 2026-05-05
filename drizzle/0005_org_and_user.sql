-- Baseline migration: captures tables and schema changes applied to prod
-- outside the migration chain. All CREATE TABLE statements use IF NOT EXISTS
-- so this is a safe no-op on prod where these already exist.
--
-- This migration:
-- 1. Creates organization and user (never had migration files)
-- 2. Replaces the simple issue model from 0000 with the rich FK-backed model
-- 3. Creates all issue lookup tables (state, status, type, priority, label,
--    transition, comment, branch, commit, pull_request)
-- 4. Creates stage_gate_result

-- Organization
CREATE TABLE IF NOT EXISTS "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"settings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_slug_idx" ON "organization" ("slug");
--> statement-breakpoint

-- User
CREATE TABLE IF NOT EXISTS "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_org_slug_idx" ON "user" ("org_id", "slug");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'user_org_id_fkey'
  ) THEN
    ALTER TABLE "user" ADD CONSTRAINT "user_org_id_fkey"
      FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint

-- Issue lookup tables (all IF NOT EXISTS — exist on prod already)
CREATE TABLE IF NOT EXISTS "issue_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"color" text NOT NULL,
	"sort_order" integer NOT NULL DEFAULT 0,
	"is_active" boolean NOT NULL DEFAULT true,
	"is_terminal" boolean NOT NULL DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issue_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"sort_order" integer NOT NULL DEFAULT 0,
	"is_active" boolean NOT NULL DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issue_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"color" text NOT NULL,
	"sort_order" integer NOT NULL DEFAULT 0,
	"is_active" boolean NOT NULL DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issue_priority" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"color" text NOT NULL,
	"weight" integer NOT NULL DEFAULT 0,
	"is_active" boolean NOT NULL DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issue_label" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"color" text NOT NULL,
	"sort_order" integer NOT NULL DEFAULT 0,
	"is_active" boolean NOT NULL DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Replace the simple issue table from 0000 with the rich FK-backed model.
-- On prod this table already has the correct schema so the DROP is skipped
-- via the IF EXISTS check on the old columns.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'issue' AND column_name = 'state' AND table_schema = 'public'
  ) THEN
    DROP TABLE IF EXISTS "issue" CASCADE;
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body_md" text,
	"body_html" text,
	"state_id" uuid NOT NULL,
	"status_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"priority_id" uuid NOT NULL,
	"is_closed" boolean NOT NULL DEFAULT false,
	"assignee" text,
	"author" text NOT NULL,
	"labels" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"version" integer NOT NULL DEFAULT 1,
	"source" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parent_issue_id" uuid
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "issue_project_number_idx" ON "issue" ("project_id", "number");
--> statement-breakpoint

-- Issue child tables
CREATE TABLE IF NOT EXISTS "issue_transition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"from_state_id" uuid NOT NULL,
	"to_state_id" uuid NOT NULL,
	"description" text,
	"sort_order" integer NOT NULL DEFAULT 0,
	"is_active" boolean NOT NULL DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issue_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"comment_number" integer NOT NULL,
	"body_md" text,
	"body_html" text,
	"author" text,
	"version" integer NOT NULL DEFAULT 1,
	"is_deleted" boolean NOT NULL DEFAULT false,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "issue_comment_issue_id_comment_number_idx" ON "issue_comment" ("issue_id", "comment_number");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issue_branch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"repo" text NOT NULL,
	"branch_name" text NOT NULL,
	"is_primary" boolean NOT NULL DEFAULT false,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issue_commit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"repo" text NOT NULL,
	"sha" text NOT NULL,
	"author" text,
	"message" text,
	"committed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issue_pull_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"repo" text NOT NULL,
	"provider" text NOT NULL,
	"pr_number" integer NOT NULL,
	"pr_url" text NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"head_branch" text NOT NULL,
	"base_branch" text NOT NULL,
	"author" text,
	"merged_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"is_primary" boolean NOT NULL DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Columns added to prod outside the migration chain
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "config_entry" ADD COLUMN IF NOT EXISTS "project_id" uuid;
--> statement-breakpoint
ALTER TABLE "issue_event" ADD COLUMN IF NOT EXISTS "actor" text NOT NULL DEFAULT 'system';
--> statement-breakpoint

-- Stage gate results
CREATE TABLE IF NOT EXISTS "stage_gate_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_run_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"passed" boolean NOT NULL,
	"worst_action" text,
	"rule_snapshot" jsonb NOT NULL,
	"rule_results" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
