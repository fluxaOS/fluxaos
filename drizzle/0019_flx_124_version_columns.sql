-- FLX-124 (2026-05-04): add `version` integer column to persona, team,
-- provider, routing_profile, and brand, defaulting to 1, for optimistic
-- concurrency in the RecordEditor (FLX-124).
--
-- Hand-written per FLX-16 (drizzle-kit generate is unusable in
-- autonomous sessions; meta snapshots still drift on main).

ALTER TABLE "persona" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "team" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "provider" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "routing_profile" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "brand" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
