-- FLX-215 (2026-05-10): drop routing_rule.fallback_driver.
--
-- The column existed to back a 3-link `??` chain in routing-resolver
-- (stage.driver ?? rule.preferredDriver ?? rule.fallbackDriver) but was:
--   * never surfaced in the routing settings UI (only preferredDriver is editable)
--   * never seeded with a value
--   * never referenced in tests
--   * semantically indistinguishable from preferredDriver
--
-- That makes it a banned silent default per ARCHITECTURAL_STANDARDS.md §2 /
-- AGENT_BEHAVIOR.md "No fallbacks ever". The resolver now does a single
-- explicit override: stage.driver wins; otherwise rule.preferredDriver;
-- otherwise the resolver returns null and stage-runner fails fast.
--
-- Hand-written per FLX-16 (drizzle-kit generate is unusable in autonomous
-- sessions; meta snapshots still drift on main).

ALTER TABLE "routing_rule" DROP COLUMN "fallback_driver";
