-- FLX-271 (FLX-239 Stage 8): drop the tenancy slug columns.
-- Epic: docs/superpowers/plans/2026-05-18-tenancy-waterfall-epic.md (Stage 8)
--
-- The UUID-only route tree (/p/{uuid}/...) shipped in Stage 4 and the old
-- slug route tree was deleted in the same stage, so nothing reads
-- organization.slug, user.slug, or project.slug any more. Rip-and-replace:
-- no backfill, no compatibility shim — CLAUDE.md `## Environments` override
-- authorizes this (no production, no real users).
--
-- driver.slug, driver_revision.slug, and cron_job.slug are machine
-- identifiers for config records, not URL tenancy slugs. They stay.

DROP INDEX IF EXISTS "user_org_slug_idx";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN IF EXISTS "slug";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN IF EXISTS "slug";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN IF EXISTS "slug";
