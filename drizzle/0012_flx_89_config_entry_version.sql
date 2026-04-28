-- FLX-89 (2026-04-28): add `version` integer column to config_entry,
-- defaulting to 1, for optimistic concurrency in the System settings
-- page (which reuses RecordEditor's version-locked update/delete).
--
-- Hand-written per FLX-16 (drizzle-kit generate is unusable in
-- autonomous sessions; meta snapshots still drift on main).

ALTER TABLE "config_entry" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
