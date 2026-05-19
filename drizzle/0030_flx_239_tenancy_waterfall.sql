-- FLX-239 Stage 1: tenancy + waterfall scope columns.
-- Spec: docs/superpowers/specs/2026-05-18-tenancy-waterfall-design.md
-- Plan: docs/superpowers/plans/2026-05-18-flx-239-stage-1-schema.md
--
-- Rip-and-replace migration. No backfill of old rows. CLAUDE.md `## Environments`
-- override authorizes this — no production, no real users.

-- Phase 1: Drop old indexes that reference columns being dropped.
DROP INDEX IF EXISTS "project_user_slug_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "provider_org_id_name_idx";--> statement-breakpoint

-- Phase 2: Drop the old tenancy tables.
DROP TABLE IF EXISTS "team_member";--> statement-breakpoint
DROP TABLE IF EXISTS "team";--> statement-breakpoint

-- Phase 3: Create customer (placeholder).
CREATE TABLE "customer" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "external_billing_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Phase 4: Add organization.customer_id (placeholder; no FK, nullable).
ALTER TABLE "organization" ADD COLUMN "customer_id" uuid;--> statement-breakpoint

-- Phase 5: Create new team (humans-only).
CREATE TABLE "team" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organization"("id"),
  "name" text NOT NULL,
  "description" text,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Phase 6: Create team_member (humans; PK user_id+team_id).
CREATE TABLE "team_member" (
  "user_id" uuid NOT NULL REFERENCES "user"("id"),
  "team_id" uuid NOT NULL REFERENCES "team"("id"),
  "role" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_id", "team_id")
);--> statement-breakpoint

-- Phase 7: Create project_member (PK user_id+project_id).
CREATE TABLE "project_member" (
  "user_id" uuid NOT NULL REFERENCES "user"("id"),
  "project_id" uuid NOT NULL REFERENCES "project"("id"),
  "role" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_id", "project_id")
);--> statement-breakpoint

-- Phase 8: Project — guard, drop user_id, add team_id NOT NULL FK.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "project" LIMIT 1) THEN
    RAISE EXCEPTION 'FLX-239 Phase 8: project table must be empty before adding team_id NOT NULL. Run `tsx src/scripts/db/nuke.ts` first.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "team_id" uuid NOT NULL REFERENCES "team"("id");--> statement-breakpoint

-- Phase 9: Denormalization trigger — project.org_id always mirrors team.org_id.
CREATE OR REPLACE FUNCTION flx239_project_set_org_id_from_team()
RETURNS TRIGGER AS $$
BEGIN
  SELECT t.org_id INTO NEW.org_id FROM team t WHERE t.id = NEW.team_id;
  IF NEW.org_id IS NULL THEN
    RAISE EXCEPTION 'FLX-239: team % not found or has null org_id', NEW.team_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER project_set_org_id_from_team
  BEFORE INSERT OR UPDATE ON "project"
  FOR EACH ROW
  EXECUTE FUNCTION flx239_project_set_org_id_from_team();--> statement-breakpoint

-- Phase 10: Drop pre-existing collision columns.
ALTER TABLE "persona" DROP COLUMN "scope";--> statement-breakpoint
ALTER TABLE "persona" DROP COLUMN "project_id";--> statement-breakpoint
ALTER TABLE "skill" DROP COLUMN "scope";--> statement-breakpoint
ALTER TABLE "skill" DROP COLUMN "project_id";--> statement-breakpoint
ALTER TABLE "brand" DROP COLUMN "project_id";--> statement-breakpoint

-- Phase 11: Add waterfall scope columns; drop NOT NULL + FK on pre-existing org_id columns.
ALTER TABLE "persona" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "persona" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "persona" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "persona" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "persona" ADD COLUMN "kind" text NOT NULL DEFAULT 'catalog';--> statement-breakpoint

ALTER TABLE "skill" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "skill" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "skill" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "skill" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "skill" ADD COLUMN "kind" text NOT NULL DEFAULT 'catalog';--> statement-breakpoint

ALTER TABLE "brand" ALTER COLUMN "org_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "brand" DROP CONSTRAINT IF EXISTS "brand_org_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "provider" ALTER COLUMN "org_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "provider" DROP CONSTRAINT IF EXISTS "provider_org_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "routing_profile" ALTER COLUMN "org_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "routing_profile" DROP CONSTRAINT IF EXISTS "routing_profile_org_id_organization_id_fk";--> statement-breakpoint

ALTER TABLE "brand" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "brand" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "brand" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "brand" ADD COLUMN "kind" text NOT NULL DEFAULT 'catalog';--> statement-breakpoint

ALTER TABLE "provider" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "kind" text NOT NULL DEFAULT 'catalog';--> statement-breakpoint

ALTER TABLE "driver" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "driver" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "driver" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "driver" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "driver" ADD COLUMN "kind" text NOT NULL DEFAULT 'catalog';--> statement-breakpoint

ALTER TABLE "routing_profile" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "routing_profile" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "routing_profile" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "routing_profile" ADD COLUMN "kind" text NOT NULL DEFAULT 'catalog';--> statement-breakpoint

-- Phase 12: Reset existing rows to catalog kind.
UPDATE "persona" SET kind = 'catalog', org_id = NULL, team_id = NULL, user_id = NULL, project_id = NULL;--> statement-breakpoint
UPDATE "skill" SET kind = 'catalog', org_id = NULL, team_id = NULL, user_id = NULL, project_id = NULL;--> statement-breakpoint
UPDATE "brand" SET kind = 'catalog', org_id = NULL, team_id = NULL, user_id = NULL, project_id = NULL;--> statement-breakpoint
UPDATE "provider" SET kind = 'catalog', org_id = NULL, team_id = NULL, user_id = NULL, project_id = NULL;--> statement-breakpoint
UPDATE "driver" SET kind = 'catalog', org_id = NULL, team_id = NULL, user_id = NULL, project_id = NULL;--> statement-breakpoint
UPDATE "routing_profile" SET kind = 'catalog', org_id = NULL, team_id = NULL, user_id = NULL, project_id = NULL;--> statement-breakpoint

-- Phase 13: CHECK constraints — exactly one scope FK non-null + matching kind, OR all null + catalog.
ALTER TABLE "persona" ADD CONSTRAINT "persona_scope_check" CHECK (
  (org_id IS NOT NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'org')
  OR (org_id IS NULL AND team_id IS NOT NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'team')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NOT NULL AND project_id IS NULL AND kind = 'user')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NOT NULL AND kind = 'project')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'catalog')
);--> statement-breakpoint

ALTER TABLE "skill" ADD CONSTRAINT "skill_scope_check" CHECK (
  (org_id IS NOT NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'org')
  OR (org_id IS NULL AND team_id IS NOT NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'team')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NOT NULL AND project_id IS NULL AND kind = 'user')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NOT NULL AND kind = 'project')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'catalog')
);--> statement-breakpoint

ALTER TABLE "brand" ADD CONSTRAINT "brand_scope_check" CHECK (
  (org_id IS NOT NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'org')
  OR (org_id IS NULL AND team_id IS NOT NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'team')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NOT NULL AND project_id IS NULL AND kind = 'user')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NOT NULL AND kind = 'project')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'catalog')
);--> statement-breakpoint

ALTER TABLE "provider" ADD CONSTRAINT "provider_scope_check" CHECK (
  (org_id IS NOT NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'org')
  OR (org_id IS NULL AND team_id IS NOT NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'team')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NOT NULL AND project_id IS NULL AND kind = 'user')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NOT NULL AND kind = 'project')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'catalog')
);--> statement-breakpoint

ALTER TABLE "driver" ADD CONSTRAINT "driver_scope_check" CHECK (
  (org_id IS NOT NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'org')
  OR (org_id IS NULL AND team_id IS NOT NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'team')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NOT NULL AND project_id IS NULL AND kind = 'user')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NOT NULL AND kind = 'project')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'catalog')
);--> statement-breakpoint

ALTER TABLE "routing_profile" ADD CONSTRAINT "routing_profile_scope_check" CHECK (
  (org_id IS NOT NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'org')
  OR (org_id IS NULL AND team_id IS NOT NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'team')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NOT NULL AND project_id IS NULL AND kind = 'user')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NOT NULL AND kind = 'project')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'catalog')
);--> statement-breakpoint

-- Phase 14: Partial unique indexes — 5 per × 6 tables = 30 total.

-- Provider
CREATE UNIQUE INDEX "provider_org_name_uq" ON "provider" ("org_id", "name") WHERE org_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_team_name_uq" ON "provider" ("team_id", "name") WHERE team_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_user_name_uq" ON "provider" ("user_id", "name") WHERE user_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_project_name_uq" ON "provider" ("project_id", "name") WHERE project_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_catalog_name_uq" ON "provider" ("name") WHERE kind = 'catalog';--> statement-breakpoint

-- Persona
CREATE UNIQUE INDEX "persona_org_name_uq" ON "persona" ("org_id", "name") WHERE org_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "persona_team_name_uq" ON "persona" ("team_id", "name") WHERE team_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "persona_user_name_uq" ON "persona" ("user_id", "name") WHERE user_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "persona_project_name_uq" ON "persona" ("project_id", "name") WHERE project_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "persona_catalog_name_uq" ON "persona" ("name") WHERE kind = 'catalog';--> statement-breakpoint

-- Skill
CREATE UNIQUE INDEX "skill_org_name_uq" ON "skill" ("org_id", "name") WHERE org_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_team_name_uq" ON "skill" ("team_id", "name") WHERE team_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_user_name_uq" ON "skill" ("user_id", "name") WHERE user_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_project_name_uq" ON "skill" ("project_id", "name") WHERE project_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_catalog_name_uq" ON "skill" ("name") WHERE kind = 'catalog';--> statement-breakpoint

-- Brand
CREATE UNIQUE INDEX "brand_org_name_uq" ON "brand" ("org_id", "name") WHERE org_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_team_name_uq" ON "brand" ("team_id", "name") WHERE team_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_user_name_uq" ON "brand" ("user_id", "name") WHERE user_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_project_name_uq" ON "brand" ("project_id", "name") WHERE project_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_catalog_name_uq" ON "brand" ("name") WHERE kind = 'catalog';--> statement-breakpoint

-- Driver
CREATE UNIQUE INDEX "driver_org_name_uq" ON "driver" ("org_id", "name") WHERE org_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "driver_team_name_uq" ON "driver" ("team_id", "name") WHERE team_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "driver_user_name_uq" ON "driver" ("user_id", "name") WHERE user_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "driver_project_name_uq" ON "driver" ("project_id", "name") WHERE project_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "driver_catalog_name_uq" ON "driver" ("name") WHERE kind = 'catalog';--> statement-breakpoint

-- Routing Profile
CREATE UNIQUE INDEX "routing_profile_org_name_uq" ON "routing_profile" ("org_id", "name") WHERE org_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "routing_profile_team_name_uq" ON "routing_profile" ("team_id", "name") WHERE team_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "routing_profile_user_name_uq" ON "routing_profile" ("user_id", "name") WHERE user_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "routing_profile_project_name_uq" ON "routing_profile" ("project_id", "name") WHERE project_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "routing_profile_catalog_name_uq" ON "routing_profile" ("name") WHERE kind = 'catalog';--> statement-breakpoint

-- Phase 15: RLS policies.
-- Task 1's audit (docs/superpowers/audits/2026-05-18-flx-239-stage-1-rls.txt)
-- returned 0 rows — no RLS policies reference the old team/team_member tables.
-- Nothing to drop here.
