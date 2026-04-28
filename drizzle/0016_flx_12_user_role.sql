-- FLX-12 (2026-04-28): role-based edit/delete permissions.
-- Adds `role` column on the user table. Existing rows are grandfathered to
-- 'admin' so no permission regression hits the alpha homelab user.
--
-- Three roles for the alpha permission model:
--   admin      — full edit/delete/revert across all settings
--   maintainer — edit and revert; cannot delete
--   viewer     — read-only
--
-- Hand-written per FLX-16.

ALTER TABLE "user"
  ADD COLUMN "role" text NOT NULL DEFAULT 'admin';
