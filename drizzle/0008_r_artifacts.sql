-- R-ARTIFACTS (2026-04-23): stage-to-stage artifacts directory paths.
--
-- Hand-written per DEF-019 (drizzle/meta/ snapshots still drifted from
-- applied schema; auto-generate would conflict). Adds nullable
-- artifacts_path columns on pipeline_run and isolation_environment.
-- Columns are populated by the isolation provider at acquire-time; the
-- orchestrator mirrors the path onto pipeline_run for observability.

ALTER TABLE "pipeline_run" ADD COLUMN "artifacts_path" text;
--> statement-breakpoint
ALTER TABLE "isolation_environment" ADD COLUMN "artifacts_path" text;
