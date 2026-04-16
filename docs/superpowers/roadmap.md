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
| R5.5 — Skill-to-Orchestrator IPC | **Done — PR #23, #26, #29** | [r5.5-ipc-plan](superpowers/plans/2026-04-13-r5.5-ipc-protocol-plan.md) | [r5.5-ipc-design](superpowers/specs/2026-04-13-r5.5-ipc-protocol-design.md) |
| R-INFRA — fh-commons Decoupling + Dev Tooling | **Done** | [r-infra-plan](superpowers/plans/2026-04-15-r-infra-implementation-plan.md) | [r-infra-design](superpowers/specs/2026-04-15-infra-decoupling-design.md) |
| R-UI — Mockup Reconciliation | **Not started** | — | [ui-inventory](superpowers/specs/2026-04-11-ui-inventory.md) |
| R6 — Polish + Ship | **Not started** | — | — |

## R5.5 Verification Results (2026-04-15)

Manual browser verification at `http://192.168.54.101:3003`:

| Test | Result | Notes |
|------|--------|-------|
| 1. Seed — 2 issues exist | **PASS** | Both issues present, Research/Open |
| 2. Gate results after run | **PARTIAL** | Gate result IS written (good). Issue advanced research→implement. Pipeline status shows "completed". Tense/casing inconsistencies in labels. |
| 3. Hold/already_complete | **PASS (caveat)** | State moved to Complete correctly. But skill found real `/api/health/route.ts` in the fluxaOS repo — seed issue #2 is a bad test case since it matches real code. Workspace `cwd` doesn't prevent filesystem exploration. |
| 4. Clean pipeline output | **Not verified** | |
| 5. Hold/needs_human | **Deferred** | |

New deferred issues filed in `docs/superpowers/deferred-fixes.md`: activity feed display, state/status tense inconsistency, text casing inconsistency.

## What's Next

1. ~~**Update skills to emit flux:signal**~~ — **Done (PR #29).** Hold verdicts wired, gate results written for every run.
2. ~~**R-INFRA — Developer Tooling**~~ — **Done.** fh-commons fully decoupled, native TS DB scripts (`db:issues`, `db:runs`, `db:gates`, `db:events`), seed verification suite (`verify:seed`), standalone git hooks.
3. **R-UI** — reconcile UI with approved mockup at `docs/planning/mockups/dashboard-mockup.html`
   - Driver catalog management page (list/edit/toggle; formerly "harness" — renamed in R-UI-1)
   - Skill edit/delete in settings
   - Real-time updates (LiveOutput streaming, activity feed auto-refresh, duration updates)
4. **R6** — polish + ship

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
