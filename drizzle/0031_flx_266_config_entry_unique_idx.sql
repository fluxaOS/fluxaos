-- FLX-266 (2026-06-10): create the missing config_entry unique index.
--
-- src/core/db/schema.ts has declared
-- `config_entry_scope_project_key_idx` UNIQUE (scope, project_id, key)
-- since FLX-222, and migrations 0026/0027/0028 reference it in comments —
-- but no migration ever CREATEd it (schema/DB drift). Consequences in the
-- live DBs: `ON CONFLICT ("scope","project_id","key")` fails with "no
-- unique or exclusion constraint matching", and nothing actually prevents
-- duplicate config rows.
--
-- Vanilla btree: NULLs are distinct, so multiple global rows with
-- project_id NULL and DIFFERENT keys coexist, while (scope, project_id,
-- key) duplicates are rejected for non-null project_id. This matches the
-- seed's check-then-insert treatment of global rows.
--
-- Hand-written per FLX-16 (drizzle-kit generate is unusable in autonomous
-- sessions; meta snapshots still drift on main).

CREATE UNIQUE INDEX IF NOT EXISTS "config_entry_scope_project_key_idx"
  ON "config_entry" ("scope", "project_id", "key");
