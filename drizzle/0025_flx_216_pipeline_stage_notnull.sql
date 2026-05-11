-- FLX-216 (2026-05-10): enforce NOT NULL on pipeline_stage.timeout_sec and
-- pipeline_stage.gate_mode so the stage runner can trust the DB value and
-- stop silently substituting hard-coded defaults at read time.
--
-- Per the "no fallbacks ever" rule: if the DB doesn't hold a value, fail
-- fast — don't pick one. Existing rows already carry the default values
-- (300 / 'auto') from the previous schema; the column-level DEFAULT stays so
-- the DB still writes the canonical value when callers omit the column,
-- and NOT NULL pins the invariant going forward.
--
-- Hand-written per FLX-16 (drizzle-kit generate is unusable in autonomous
-- sessions; meta snapshots still drift on main).

UPDATE "pipeline_stage" SET "timeout_sec" = 300 WHERE "timeout_sec" IS NULL;
--> statement-breakpoint
UPDATE "pipeline_stage" SET "gate_mode" = 'auto' WHERE "gate_mode" IS NULL;
--> statement-breakpoint
ALTER TABLE "pipeline_stage" ALTER COLUMN "timeout_sec" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "pipeline_stage" ALTER COLUMN "gate_mode" SET NOT NULL;
