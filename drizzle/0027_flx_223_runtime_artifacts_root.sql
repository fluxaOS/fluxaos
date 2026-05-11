-- FLX-223 (2026-05-11): migrate FLUXAOS_ARTIFACTS_ROOT from env to
-- config_entry (scope=`'global'`, project_id=NULL, key=`runtime.artifacts_root`).
--
-- Second instance of the FLX-222 pattern (workspace_root). The env path is
-- being removed; the DB is the new sole source of truth (no fallbacks). We
-- insert the row with value=jsonb null, which is the explicit "use the
-- adapter's built-in in-project `<repo>/.fluxaos-artifacts/` layout" choice.
-- An operator who previously set FLUXAOS_ARTIFACTS_ROOT in .env should update
-- this row to the JSON-encoded absolute path string after migration, via
-- Settings → System or:
--
--   UPDATE config_entry
--   SET value = to_jsonb('/srv/flux/artifacts'::text),
--       version = version + 1,
--       previous_value = value,
--       updated_at = now()
--   WHERE scope = 'global' AND project_id IS NULL
--     AND key = 'runtime.artifacts_root';
--
-- Per ARCHITECTURAL_STANDARDS.md §2 ("no fallbacks"): if this row is
-- missing, the worktree isolation provider throws MissingGlobalConfigError
-- at acquire time. The row presence itself is the contract.
--
-- Hand-written per FLX-16 (drizzle-kit generate is unusable in autonomous
-- sessions; meta snapshots still drift on main).

-- Use WHERE NOT EXISTS rather than ON CONFLICT because the unique index
-- `config_entry_scope_project_key_idx` is a vanilla btree where NULLs are
-- treated as distinct — `ON CONFLICT` would not match an existing row whose
-- project_id IS NULL against another whose project_id IS NULL, and the
-- insert would duplicate.
INSERT INTO "config_entry" ("scope", "project_id", "key", "value", "version")
SELECT 'global', NULL, 'runtime.artifacts_root', 'null'::jsonb, 1
WHERE NOT EXISTS (
  SELECT 1 FROM "config_entry"
  WHERE "scope" = 'global'
    AND "project_id" IS NULL
    AND "key" = 'runtime.artifacts_root'
);
