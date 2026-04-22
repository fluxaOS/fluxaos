<!-- Manually mirrored from /mnt/dev/fh-commons/templates/reference-docs/AGENT_BEHAVIOR.md.
     fluxaOS is decoupled from fhc sync (not in projects.json), so this file does NOT
     auto-update when the fh-commons template changes. When the template is updated in
     fh-commons, copy it here manually and re-substitute {{PROJECT}} -> fluxaOS. -->
# Agent Behavior for fluxaOS

AI does every step from brainstorm to shipped — no questions during a session. User is involved only for:

1. **Verifying finished work via web UI.** Journey test must pass 100% (no warnings, no skips, no "it's fine-ish"), then user personally signs off in the browser. Both required — test + sign-off. No code review from the user.
2. **Resetting direction** when things go off the rails (hallucination, stuck loop, obvious drift).

**Verification:** journey test simulates a user end-to-end — Playwright for web, XCUITest for iOS, integration test for services, molecule/integration for infra. No human review substitutes for a passing test; no passing test substitutes for the user's UI sign-off.

**No invented numeric thresholds** (budgets, retry counts, line limits) in durable artifacts unless the user set them.

**No cost or time estimates** — once a direction is approved, just do the work and report progress.

**Definition of done:** PRs merged to main, working tree clean, on main in sync with origin, merged branches deleted (locally + origin), worktrees pruned, `fhc sync` run if `templates/**` changed. Open PRs don't count as done.
