-- FLX-224 (2026-05-11): migrate the FLUXAOS_CLEANUP_* + FLUXAOS_RUN_CLEANUP_SCHEDULER
-- env vars to config_entry (scope=`'global'`, project_id=NULL).
--
-- Third instance of the FLX-222 pattern (workspace_root) — same shape, five
-- keys this time:
--
--   cleanup.sweep_interval_min        positive int, minutes (default 10)
--   cleanup.stale_days                positive int, days (default 7)
--   cleanup.session_retention_days    positive int, days (default 30)
--   cleanup.artifacts_retention_days  positive int, days (default 30)
--   cleanup.scheduler_enabled         boolean (default false — opt-in)
--
-- The DB row is the contract — no "jsonb null = use built-in layout"
-- affordance for these keys. A missing row, a null value, or a value of the
-- wrong type all surface a hard error in the runtime-config reader. An
-- operator who previously had FLUXAOS_CLEANUP_* set in .env should compare
-- those numbers against the defaults inserted here and update the rows via
-- Settings → System (or:
--
--   UPDATE config_entry
--   SET value = to_jsonb(15::int),
--       version = version + 1,
--       previous_value = value,
--       updated_at = now()
--   WHERE scope = 'global' AND project_id IS NULL
--     AND key = 'cleanup.sweep_interval_min';
-- ).
--
-- The scheduler-enabled row defaults to FALSE: the pre-migration default
-- was that FLUXAOS_RUN_CLEANUP_SCHEDULER had to be `1` for the scheduler
-- to run. Anything else (unset, "0", "true", "yes") left the scheduler
-- disabled. Operators who want the scheduler running on the daemon must
-- flip this row to TRUE.
--
-- Hand-written per FLX-16 (drizzle-kit generate is unusable in autonomous
-- sessions; meta snapshots still drift on main).

-- Use WHERE NOT EXISTS rather than ON CONFLICT because the unique index
-- `config_entry_scope_project_key_idx` is a vanilla btree where NULLs are
-- treated as distinct — `ON CONFLICT` would not match an existing row whose
-- project_id IS NULL against another whose project_id IS NULL, and the
-- insert would duplicate.
INSERT INTO "config_entry" ("scope", "project_id", "key", "value", "version")
SELECT 'global', NULL, 'cleanup.sweep_interval_min', to_jsonb(10::int), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "config_entry"
  WHERE "scope" = 'global'
    AND "project_id" IS NULL
    AND "key" = 'cleanup.sweep_interval_min'
);

INSERT INTO "config_entry" ("scope", "project_id", "key", "value", "version")
SELECT 'global', NULL, 'cleanup.stale_days', to_jsonb(7::int), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "config_entry"
  WHERE "scope" = 'global'
    AND "project_id" IS NULL
    AND "key" = 'cleanup.stale_days'
);

INSERT INTO "config_entry" ("scope", "project_id", "key", "value", "version")
SELECT 'global', NULL, 'cleanup.session_retention_days', to_jsonb(30::int), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "config_entry"
  WHERE "scope" = 'global'
    AND "project_id" IS NULL
    AND "key" = 'cleanup.session_retention_days'
);

INSERT INTO "config_entry" ("scope", "project_id", "key", "value", "version")
SELECT 'global', NULL, 'cleanup.artifacts_retention_days', to_jsonb(30::int), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "config_entry"
  WHERE "scope" = 'global'
    AND "project_id" IS NULL
    AND "key" = 'cleanup.artifacts_retention_days'
);

INSERT INTO "config_entry" ("scope", "project_id", "key", "value", "version")
SELECT 'global', NULL, 'cleanup.scheduler_enabled', 'false'::jsonb, 1
WHERE NOT EXISTS (
  SELECT 1 FROM "config_entry"
  WHERE "scope" = 'global'
    AND "project_id" IS NULL
    AND "key" = 'cleanup.scheduler_enabled'
);
