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
| R-UI-1 — Settings CRUD + harness→driver rename | **Done** | [r-ui-1-plan](superpowers/plans/2026-04-16-r-ui-1-implementation.md) | [r-ui-1-design](superpowers/specs/2026-04-16-r-ui-1-design.md) |
| R-UI-2 — Real-time updates | **Retired — superseded by R-UI-2.5 (branch archived)** | [r-ui-2-plan](superpowers/plans/2026-04-16-r-ui-2-implementation.md) | [r-ui-2-design](superpowers/specs/2026-04-16-r-ui-2-design.md) |
| R-UI-2.5 — Realtime user-visible remnant (ActivityFeed extraction + Realtime subscription + RunDetailModal poll removal) | **Done — PR #47** | [r-ui-2-5-plan](superpowers/plans/2026-04-20-r-ui-2-5-implementation.md) | [disposition-design](superpowers/specs/2026-04-20-r-ui-2-disposition-and-w3-decomposition-design.md) |
| R-AUDIT — Multi-team audit (P1 + P2) | **Done** | [audit-plan](superpowers/plans/2026-04-17-r-ui-audit-plan.md) | [audit-design](superpowers/specs/2026-04-17-r-ui-audit-design.md) |
| R-REM-W1 — Foundation remediation (invariant 7, CRUD factory, dead-code purge) | **Done** | [wave-1-plan](superpowers/plans/2026-04-17-wave-1-foundation-plan.md) | — (triage supersedes spec: [triage](superpowers/audits/2026-04-17-audit-triage.md)) |
| R-REM-W2 — Architecture remediation (realtime registry, stdout-parser port, transactional soft-delete) | **Done — PR #43** | [w2-plan](superpowers/plans/2026-04-18-r-rem-w2-implementation.md) | [w2-design](superpowers/specs/2026-04-18-r-rem-w2-design.md) |
| R-REM-W3 — Alpha-critical build (CLI, GitHub adapter, Anthropic adapter, settings tabs, Mission Control) | **Not started** | — | [triage](superpowers/audits/2026-04-17-audit-triage.md) |
| R-REM-W4 — Cleanup + polish + roadmap reconciliation | **Not started** | — | — |
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

## R-AUDIT Results (2026-04-17)

Four-lane specialist audit over two phases. **Phase 1** audited R-UI-1 merge + R-UI-2 in-flight branch (56 files): 28 findings. Escalation trigger fired (all three conditions). **Phase 2** swept the other 96 files with 10 parallel specialists: 80 findings. Combined: **111 findings (35 High / 44 Medium / 32 Low).**

User-led triage produced:
- **6 pattern decisions** — see [audit-triage.md](audits/2026-04-17-audit-triage.md)
- **2 fork resolutions** — retire ARCHITECTURAL_STANDARDS, accept Drizzle-typed `Database`
- **~20+ findings reclassified as false positives** under the clarified invariant 7 (Drizzle is core stack, not a pluggable vendor)
- **3 items deferred post-alpha** — Just Do It, OpenAI, Brand
- **~55-65 actionable remediation items** split across 4 waves

Artifacts (all in `docs/superpowers/audits/`):
- `2026-04-17-r-ui-1-r-ui-2-audit.md` — Phase 1 report
- `2026-04-17-phase2-full-codebase-audit.md` — Phase 2 report
- `2026-04-17-audit-triage.md` — triage decisions (authoritative)
- `.raw/` — Phase 1 raw specialist outputs
- `.raw-phase2/` — Phase 2 raw specialist outputs

## What's Next

1. ~~**R-UI-1** — Settings CRUD + harness→driver rename~~ — **Done.**
2. **R-UI-2** — Real-time updates — **Retired (2026-04-20).** Tasks 1-11 shipped independently via R-REM-W1/W2 against a different file structure. Remaining user-visible scope moved to R-UI-2.5 (below); orchestrator rewire (Tasks 14-22) permanently deferred — target files were deleted/relocated in W1/W2. Branch `feat/r-ui-2-impl` archived.

2a. **R-UI-2.5** — Realtime user-visible remnant — **Done (2026-04-20), PR #47.** Three items: extracted `ActivityFeed` from the 880-line issue detail client to `src/app/[org]/[user]/[project]/issues/[number]/ActivityFeed.tsx` (880 → 368 lines — resolves AUDIT-003 and explains the secondary `IssueDetailEditors` extraction that landed in commit d1cc351 as a deviation required to satisfy the 500-line invariant); added Realtime subscription to `issue_event` table with client-side issueId filtering (resolves AUDIT-012 — R-UI-2 spec exit criterion #2, end-to-end verified via `e2e/activity-feed-realtime.spec.ts`); deleted 2-second `refetchInterval` from `RunDetailModal.tsx` since its existing Realtime subscription on `stage_run` covers the data (resolves AUDIT-005 — live invariant-9 violation on main). Full verification: tsc clean, vitest 122+/122+, verify 10/10, Playwright smokes green (both the new activity-feed smoke and the existing `run-stage-smoke` which was also updated to reference issue #1 since the seed no longer has issue #3), human browser check pending.
3. **R-AUDIT** — Multi-team audit — **Done (2026-04-17).** Four-lane specialist audit over two phases produced 111 findings (35H / 44M / 32L). User-led triage resolved 6 patterns + 2 forks. Triage document supersedes individual finding severities.
4. **R-REM-W1** — Foundation remediation — **Done (2026-04-18).** Tasks 1-6 shipped in PR #37 (invariant 7 amended, ARCHITECTURAL_STANDARDS retired, CRUD factory rewritten with versioned variant, dead exports + ~1,100 LOC of dead source deleted). Tasks 7-9 shipped in PR #38 (dropped 3 dead schema tables + remaining router procedures via migration 0006, relocated out-of-core scripts to `src/scripts/` per invariant 7, fixed pre-existing events.ts tsc error). Full verification: tsc clean, vitest 115/115, verify 10/10, user-confirmed browser check. See [Tasks 1-6 handoff](superpowers/handoffs/2026-04-18-wave-1-tasks-1-6-session-handoff.md) and [Tasks 7-9 handoff](superpowers/handoffs/2026-04-18-wave-1-finish-session-handoff.md).
5. **R-REM-W2** — Architecture remediation — **Done (2026-04-19), PR #43.** Three remediation items shipped: (a) `RealtimeProvider` port + `SupabaseRealtimeProvider` adapter, with `LiveOutput` and `RunDetailModal` routed through `registry.get('realtime')` instead of importing `@supabase/supabase-js` directly; (b) `StdoutParser` port + `SubprocessStdoutParser` adapter relocated from `src/core/orchestrator/output-parser.ts`, with the orchestrator and `LiveOutput` resolving a parser from the registry based on driver `output_format`; (c) `issueCommentService.softDelete` wrapped in `db.transaction` with version bump atomic. Plus invariant-7 scope clarification (`src/lib/` is framework glue, exempt). Two client-bundle bugs surfaced during browser verification and were fixed in a follow-up commit: `bootstrap-client.ts` was split from `bootstrap()` to keep `node:child_process` out of the client chunk, then its `NEXT_PUBLIC_*` reads were converted from dynamic `process.env[name]` to literal member expressions so Next.js inlines them, and `stdoutParser` was added to `bootstrapClient()` (the adapter is pure logic, safe for the browser). Regression guard: `e2e/run-stage-smoke.spec.ts`. Full verification: tsc clean, vitest 122/122, verify 10/10, lint baseline unchanged, human browser check passed. See [w2-design](superpowers/specs/2026-04-18-r-rem-w2-design.md), [w2-plan](superpowers/plans/2026-04-18-r-rem-w2-implementation.md), [session handoff](superpowers/handoffs/2026-04-18-r-rem-w2-session-handoff.md).
6. **R-REM-W3** — Alpha-critical build — **Scoped, not planned.** Depends on W1 + W2. CLI (thin tRPC-client wrapper), GitHub adapter, Anthropic adapter, 6 Settings tabs, Mission Control.
7. **R-REM-W4** — Cleanup + polish + roadmap reconciliation. Depends on W1-W3.
8. **R6** — Polish + ship. Depends on W1-W4.

**Deferred post-alpha (explicitly out of remediation scope):** Just Do It mode, OpenAI adapter (Anthropic is sole alpha AI provider), Brand service.

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
9. **Invariants need prose + script agreement.** Phase 2 audit found invariant 7's prose banned `drizzle-orm` runtime imports in core while the verification script didn't scan for them — 100+ live imports either all violated or all fine depending on which source was authoritative. A rule you enforce partially is a rule you don't enforce.
10. **Tech stack vs. pluggable integrations is the right boundary.** Lock-in on Drizzle / Next.js / tRPC is fine; the adapter-registry pattern applies to systems you connect to (AI providers, git hosts, auth backends, realtime transports), not to the query layer. Collapsing both categories under one invariant produces false positives and drift.
11. **Mechanical enforcement isn't sufficient by itself.** R3.5 added phase-snapshot scripts; self-certification still reappeared in R5-V and R5.5 PRs. Process discipline needs cultural enforcement (merge-blocking manual-verification checkbox, PR template gates) to survive.
12. **Dead code is worse than missing code.** `src/core/pipeline/types.ts` had shadow status-type unions that nobody imported — but any future agent importing them would silently drift against the real source. Half-built scaffolding trains agents to copy the wrong pattern; delete it, rebuild when needed.
