-- FLX-78 (2026-04-27): drop the Claude-shaped default on
-- driver.context_layout. The engine is vendor-agnostic — driver-specific
-- defaults belong in seed/migration data, not the schema definition.
--
-- Hand-written per DEF-019 (drizzle-kit generate is unusable in
-- autonomous sessions; meta snapshots still drift on main).

ALTER TABLE "driver" ALTER COLUMN "context_layout" DROP DEFAULT;
