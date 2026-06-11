-- FLX-277 (2026-06-10): create the missing issue-catalog unique indexes.
--
-- Systematic audit of live `pg_indexes` (+ unique constraints) against every
-- `uniqueIndex(...)` / `.unique()` / `index(...)` declaration in
-- src/core/db/schema.ts found that NONE of the partial unique indexes on the
-- five issue catalog tables (issue_type / issue_state / issue_status /
-- issue_priority / issue_label) or on issue_transition were ever CREATEd by a
-- migration — the same schema/DB drift class FLX-266 fixed for config_entry
-- (drizzle/0031). Consequence in live DBs: duplicate catalog keys per project
-- (and per global scope) are silently accepted; `services.test.ts > rejects
-- duplicate key` fails because the INSERT resolves.
--
-- Also missing from the same audit: the plain (non-unique)
-- `issue_project_closed_idx` declared on `issue`. Included here so live DBs
-- match schema.ts index declarations exactly.
--
-- All other declared unique indexes verified present: deploy_run_pipeline_run_id_idx,
-- driver slug UNIQUE (live name `harness_catalog_slug_unique`),
-- driver_revision_driver_id_revision_idx, issue_project_number_idx,
-- issue_comment_issue_id_comment_number_idx, isolation_env_active_idx,
-- skill_revision_skill_id_revision_idx, cron_job_project_slug_idx,
-- config_entry_scope_project_key_idx, and the partial *_name_uq waterfall
-- indexes from 0030.
--
-- Duplicate data: a fresh nuke+seed is clean. If a live DB already contains
-- duplicate keys, CREATE UNIQUE INDEX fails loudly ("could not create unique
-- index") and the migration aborts — duplicates must be resolved by hand,
-- never silently skipped.
--
-- Hand-written per FLX-16/FLX-283 (drizzle-kit generate is broken in this
-- repo; meta snapshots drift on main).

CREATE UNIQUE INDEX IF NOT EXISTS "issue_type_project_key_idx"
  ON "issue_type" ("project_id", "key") WHERE "project_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "issue_type_global_key_idx"
  ON "issue_type" ("key") WHERE "project_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "issue_state_project_key_idx"
  ON "issue_state" ("project_id", "key") WHERE "project_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "issue_state_global_key_idx"
  ON "issue_state" ("key") WHERE "project_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "issue_status_project_key_idx"
  ON "issue_status" ("project_id", "key") WHERE "project_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "issue_status_global_key_idx"
  ON "issue_status" ("key") WHERE "project_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "issue_priority_project_key_idx"
  ON "issue_priority" ("project_id", "key") WHERE "project_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "issue_priority_global_key_idx"
  ON "issue_priority" ("key") WHERE "project_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "issue_label_project_key_idx"
  ON "issue_label" ("project_id", "key") WHERE "project_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "issue_label_global_key_idx"
  ON "issue_label" ("key") WHERE "project_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "issue_transition_project_states_idx"
  ON "issue_transition" ("project_id", "from_state_id", "to_state_id") WHERE "project_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "issue_transition_global_states_idx"
  ON "issue_transition" ("from_state_id", "to_state_id") WHERE "project_id" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issue_project_closed_idx"
  ON "issue" ("project_id", "is_closed");
