-- FLX-3 (2026-04-28): add `version` integer column to user, defaulting
-- to 1, for optimistic concurrency in the Users settings page (which
-- reuses RecordEditor's version-locked update/delete pattern).
--
-- Hand-written per FLX-16 (drizzle-kit generate is unusable in
-- autonomous sessions; meta snapshots still drift on main).

ALTER TABLE "user" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
