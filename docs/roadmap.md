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
| R5-V — Pipeline Engine + Manual Execution | **Spec approved, plan written** | [r5v-plan](superpowers/plans/2026-04-12-r5v-manual-execution-plan.md) | [r5v-design](superpowers/specs/2026-04-12-r5v-manual-execution-design.md), [handoff](superpowers/specs/2026-04-12-r5v-session-handoff.md) |
| R-UI — Mockup Reconciliation | **Not started** | — | [ui-inventory](superpowers/specs/2026-04-11-ui-inventory.md) |
| R6 — Polish + Ship | **Not started** | — | — |

## What's Next

1. **R5-V** — manual stage execution with full materialization (spec approved, plan written, 15 tasks)
2. **R-UI** — reconcile UI with approved mockup at `planning/mockups/dashboard-mockup.html`
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
