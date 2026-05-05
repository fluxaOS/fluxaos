-- R-EPIC (2026-04-24): parent/child issue hierarchy.
--
-- Hand-written per DEF-019 (drizzle meta snapshots still drifted on main;
-- `drizzle-kit generate` asks interactive questions and can't run in the
-- ambient session). Adds a nullable self-FK on `issue` so any issue may
-- declare a parent, with three invariants enforced at the DB:
--   1. parent_issue_id is NULL or references an existing issue.
--   2. parent_issue_id <> id (no self-parent).
--   3. parent and child share the same project_id (trigger, because CHECK
--      cannot subquery).
-- Self-referencing FK uses ON DELETE RESTRICT so deleting an issue that
-- still has children raises instead of silently orphaning them.
-- Partial index supports the parent→children lookup which is the hot path.
--
-- Made idempotent (IF NOT EXISTS guards) so it is a no-op on DBs where
-- 0005_org_and_user already created the issue table with these columns.

ALTER TABLE "issue" ADD COLUMN IF NOT EXISTS "parent_issue_id" uuid;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'issue_parent_fk' AND table_name = 'issue'
  ) THEN
    ALTER TABLE "issue"
      ADD CONSTRAINT "issue_parent_fk"
      FOREIGN KEY ("parent_issue_id") REFERENCES "issue"("id")
      ON DELETE RESTRICT;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'issue_no_self_parent' AND table_name = 'issue'
  ) THEN
    ALTER TABLE "issue"
      ADD CONSTRAINT "issue_no_self_parent"
      CHECK (parent_issue_id IS NULL OR parent_issue_id <> id);
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "issue_parent_idx" ON "issue" ("parent_issue_id")
  WHERE parent_issue_id IS NOT NULL;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION assert_issue_parent_same_project()
RETURNS trigger AS $$
DECLARE
  parent_project uuid;
BEGIN
  IF NEW.parent_issue_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT project_id INTO parent_project FROM issue WHERE id = NEW.parent_issue_id;
  IF parent_project IS NULL THEN
    RAISE EXCEPTION 'Parent issue % not found', NEW.parent_issue_id;
  END IF;
  IF parent_project <> NEW.project_id THEN
    RAISE EXCEPTION 'Parent issue % is in a different project', NEW.parent_issue_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'issue_parent_same_project'
  ) THEN
    CREATE TRIGGER issue_parent_same_project
    BEFORE INSERT OR UPDATE OF parent_issue_id ON "issue"
    FOR EACH ROW EXECUTE FUNCTION assert_issue_parent_same_project();
  END IF;
END $$;
