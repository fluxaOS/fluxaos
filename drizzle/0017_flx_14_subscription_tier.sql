-- FLX-14 (2026-04-28): subscription tiers + runtime feature gating.
-- Adds `subscription_tier` column on the organization table.
--
-- Two-step grandfathering: existing rows get 'enterprise' (preserves
-- current behavior — every alpha homelab org keeps every feature), but
-- the column default flips to 'free' so newly-created orgs land in the
-- restricted tier.
--
-- Tier values: 'free' | 'pro' | 'enterprise'. Engine treats unknown
-- values as 'free'.
--
-- Hand-written per FLX-16.

ALTER TABLE "organization"
  ADD COLUMN "subscription_tier" text NOT NULL DEFAULT 'enterprise';

ALTER TABLE "organization"
  ALTER COLUMN "subscription_tier" SET DEFAULT 'free';
