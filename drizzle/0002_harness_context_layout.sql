-- Add context_layout to harness_catalog for harness-agnostic file materialization
ALTER TABLE "harness_catalog"
  ADD COLUMN "context_layout" jsonb NOT NULL DEFAULT '{"instructionsFile":"CLAUDE.md","contextFile":"context.md"}'::jsonb;
