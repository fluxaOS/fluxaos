# fluxaOS — Rewrite Roadmap

Rewriting PAT (Python/FastAPI) as a TypeScript system that actually works. PAT has the right design but broken execution — rules engine doesn't fire, pipeline doesn't flow.

## Phases

| Phase | Status | Plan | Spec |
|-------|--------|------|------|
| R1 — Infrastructure + Proof of Life | **Done** | [rebuild-plan](superpowers/plans/2026-04-09-rebuild-plan.md) | [rebuild-spec](superpowers/specs/2026-04-09-rebuild-spec.md) |
| R2 — Adapter Registry | **Done** | same | same |
| R3 — Rich Issue Model + CRUD + UI | **Done** | [rich-issue-plan-v2](superpowers/plans/2026-04-09-rich-issue-model-plan-v2.md) | [rich-issue-design](superpowers/specs/2026-04-09-rich-issue-model-design.md) |
| R3.5 — Enforcement Infrastructure | **Done** | [enforcement-plan](superpowers/plans/2026-04-11-enforcement-infrastructure-plan.md) | [drift-prevention-design](superpowers/specs/2026-04-11-session-drift-prevention-design.md) |
| R4-V — Gate Engine Verification | **Done** | [r4v-plan](superpowers/plans/2026-04-11-r4v-gate-engine-verification.md) | — |
| R5-V — Pipeline Engine + Manual Execution | **Done — PR #20** | [r5v-plan](superpowers/plans/2026-04-12-r5v-manual-execution-plan.md), [cleanup-plan](superpowers/plans/2026-04-13-r5v-architectural-cleanup.md) | [r5v-design](superpowers/specs/2026-04-12-r5v-manual-execution-design.md), [cleanup-design](superpowers/specs/2026-04-13-r5v-architectural-cleanup-design.md) |
| R5.5 — Skill-to-Orchestrator IPC | **Designed — ready for implementation** | [r5.5-ipc-plan](superpowers/plans/2026-04-13-r5.5-ipc-protocol-plan.md) | [r5.5-ipc-design](superpowers/specs/2026-04-13-r5.5-ipc-protocol-design.md) |
| R-UI — Mockup Reconciliation | **Not started** | — | [ui-inventory](superpowers/specs/2026-04-11-ui-inventory.md) |
| R6 — Polish + Ship | **Not started** | — | — |

## What's Next

1. **R5.5 — Execute IPC protocol implementation** — Design complete. 14-task plan ready. Skills communicate via `flux:signal` JSON lines in stdout. Needs execution + skill template updates to emit signals.
   - See [implementation plan](superpowers/plans/2026-04-13-r5.5-ipc-protocol-plan.md)
2. **R-UI** — reconcile UI with approved mockup at `planning/mockups/dashboard-mockup.html`
   - Harness catalog management page (list/create/edit/delete harnesses — currently only visible in stage dropdowns)
   - Skill edit/delete in settings
   - Real-time updates (LiveOutput streaming, activity feed auto-refresh, duration updates)
3. **R6** — polish + ship

## RCAs

- [UI Regression](rca/2026-04-11-ui-regression-rca.md) — cumulative feature loss across 6 rewrites; corrective audits not started
- [R5-V Session Failure](rca/2026-04-12-r5v-session-failure-rca.md) — session reverted after building non-working UI without following skill chain

## Lessons Learned

1. **Rewrites destroy context; edits preserve it.** Never use Write on existing files.
2. **Reading instructions ≠ following them.** Mechanical enforcement (hooks, snapshots) is required.
3. **Self-certification is worthless.** Every phase needs human verification in a running browser.
4. **The UI defines the backend.** When fixing type errors, build the missing endpoint — don't delete the UI.
5. **Vague plans produce vague work.** "Reference PAT" is not a plan. Component-level specificity required.
6. **Structural verification is necessary but not sufficient.** Types, tests, and code review missed 10 integration bugs that surfaced immediately in browser testing. Journey tests that invoke real external tools are essential.
7. **The orchestrator must not make decisions the skill should make.** Auto-advancing issue state on exit code 0 is wrong — the skill knows whether work is done, blocked, or needs rework. The orchestrator only manages execution lifecycle; the skill owns the outcome.
8. **Skills synced from fh-commons must have resolved partials.** Hand-written stub skills with wrong behavior (deploy asking for human review) cause real failures. Always sync via `fhc sync` or manually resolve `{{PARTIAL:...}}` placeholders.
