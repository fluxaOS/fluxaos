# R-UI-2 Disposition + R-REM-W3 Decomposition — Design

**Date:** 2026-04-20
**Status:** Design approved; plan pending
**Supersedes:** No existing specs. Consumes: `docs/superpowers/audits/2026-04-17-audit-triage.md`, `docs/superpowers/handoffs/2026-04-20-r-rem-w2-closeout-session-handoff.md`.

---

## Summary

R-REM-W2 closed out last session, leaving two open decisions:

1. What happens to `feat/r-ui-2-impl`, paused at tasks 1–11 of 32 with five R-AUDIT findings against it.
2. How R-REM-W3 — the biggest remaining remediation phase — decomposes into executable work.

This design records the decisions made in brainstorming and defines the work that follows. Two new phases are introduced. Neither replaces W3 as a whole; together with the brainstormed shape of W3's remainder, they supersede the original "alpha-critical build" umbrella.

---

## Context

### R-UI-2 state at session start

`feat/r-ui-2-impl` is 53 commits ahead and 17 commits behind `main` (`git rev-list --left-right --count main...feat/r-ui-2-impl`). Tasks 1–11 of the plan (port extensions + Supabase Realtime adapter + client-side realtime wiring through `LiveOutput` and `RunDetailModal`) were implemented independently during R-REM-W2 against a different file structure. Tasks 12–32 (activity-feed subscription, orchestrator rewire, BullMQ dispatch, systemd entrypoints, Playwright journeys, integration-test rewrite) have not started.

Audit findings against the paused code still on `main` or on the branch:

- **AUDIT-003** — `src/app/[org]/[user]/[project]/issues/[number]/client.tsx` is 880 lines. Invariant 10 ceiling is 500. Task 12 cannot proceed without a split.
- **AUDIT-005** — `RunDetailModal` runs a 2-second `refetchInterval` alongside its Realtime subscription. R-UI-2 spec principle 7 is "Realtime, no fallbacks"; invariant 9 is "no silent degradation." Still present on `main` at line 60 of `src/components/pipeline/RunDetailModal.tsx`.
- **AUDIT-010** — `event-orchestrator.ts` on the branch still has the pre-R-UI-2 constructor signature and `recoverOnStartup` shape. Obsolete: W1 deleted the surrounding code the tasks referenced (`stage-worker.ts`, `orchestrator/index.ts` barrel).
- **AUDIT-012** — Issue activity-feed Realtime subscription is in the R-UI-2 spec's exit criteria but was blocked behind AUDIT-003 and never shipped.
- **AUDIT-016** — R-UI-2 plan's File Map points to the root layout; spec and shipped code use the project-scoped layout. Documentation drift only.

### W1/W2 drift relative to the paused plan

Several files the R-UI-2 plan edits no longer exist on `main`:

- `src/core/orchestrator/stage-worker.ts` — deleted in W1 (AUDIT-006 dead-code purge).
- `src/core/orchestrator/index.ts` — deleted in W1.
- `src/core/orchestrator/output-parser.ts` — relocated to `src/adapters/subprocess/stdout-parser.ts` in W2 (resolves AUDIT-013's vendor-coupling concern by routing the parser through a registry adapter).

Tasks 14–22 of the R-UI-2 plan rewired BullMQ through these files. Their target is gone; rebasing would reconstruct deleted code.

### Anthropic adapter scope (post-exploration)

The R-AUDIT triage listed "Anthropic adapter: `src/adapters/anthropic/` with AIProvider implementation" as alpha-critical (Pattern 2). Exploration during brainstorming established:

- `src/core/ports/ai.ts` exists with an SDK-shaped interface (`complete`, `stream`, `listModels`, `healthCheck`). It has zero consumers.
- The orchestrator's actual AI invocation path is `executeStageRun` → `SubprocessExecutor` (`StageExecutor` port) → `claude` binary → `SubprocessStdoutParser` (`StdoutParser` port). No `AIProvider` involvement.
- Seed data already configures this path correctly: provider row `Anthropic` type `anthropic`, driver row `claude-code` with `binary: 'claude'`, model row `Claude Sonnet 4.6`, routing row wired to the default pipeline.
- The vendor-coupling concern from AUDIT-013 is already resolved by W2 — the `stream-json` parser lives in a registry-resolved adapter, not in core.

The "Anthropic adapter" deliverable, under the architecture that actually shipped, is therefore: delete the misfit `AIProvider` port, prove the existing subprocess path works end-to-end against live Claude, and update documentation. That is a small cleanup phase, not "1–2 days of code."

---

## Design

### Phase 1 — R-UI-2 branch retirement (inline in R-UI-2.5)

`feat/r-ui-2-impl` is retired. The remote branch stays in place as a historical reference; no rebase, no cherry-pick, no resume. The branch's R-UI-2 spec and plan files (`docs/superpowers/specs/2026-04-16-r-ui-2-design.md`, `docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md`) get a terminal-state note appended at the top:

> **Status (2026-04-20):** Tasks 1–11 shipped via R-REM-W1/W2 against a different file structure. Tasks 12–32 superseded by R-UI-2.5 (user-visible remnant) and W3 (orchestrator rewire deferred — the target files stage-worker.ts, orchestrator/index.ts, output-parser.ts were deleted or relocated in W1/W2). Branch `feat/r-ui-2-impl` archived; do not resume.

The spec and plan files stay at their existing paths (`docs/superpowers/specs/` and `docs/superpowers/plans/`) — this matches how every prior retired-or-superseded phase's artifacts are preserved. No archive subdirectory. The terminal-state note at the top of each file is the single source of truth for readers; it points forward to R-UI-2.5's spec/plan when those land.

Rationale for retire-over-rebase: the 17-commit drift includes a schema migration (Wave 1 dropped three tables) and the realtime port work the branch was about to do. A rebase would produce conflicts at the exact seam the branch targeted, while delivering no unique value that `main` lacks except the tasks 12+ work — which is easier to rebuild fresh than to rescue.

### Phase 2 — R-UI-2.5: Realtime user-visible remnant

Small focused phase covering the three live findings from AUDIT-003 / -005 / -012.

**Scope (three items):**

1. **Extract `ActivityFeed` component.** Cut the activity-feed section out of `src/app/[org]/[user]/[project]/issues/[number]/client.tsx` into a colocated `ActivityFeed.tsx`. Target: `client.tsx` ≤ 500 lines, `ActivityFeed.tsx` ≈ 300 lines. One extraction only; no speculative further splits. The cut seam is the events query + event list rendering + comment form + soft-delete affordance — all cohesive around the event feed. `client.tsx` imports `ActivityFeed` as a child component; props carry the issue ID plus whatever mutations the feed needs.

2. **Add Realtime subscription inside `ActivityFeed`.** The extracted component uses `registry.get<RealtimeProvider>('realtime')` via the existing `useRealtime()` hook (shipped in R-REM-W2) to subscribe to `issue_event` rows filtered by the current issue ID. On subscription events, invalidate the events tRPC query. Remove any `eventsQuery.refetch()` calls from comment- and state-mutation success handlers in `client.tsx` — realtime covers them.

3. **Drop polling from `RunDetailModal`.** Remove the `refetchInterval` block at `src/components/pipeline/RunDetailModal.tsx` ~lines 59–65. The existing `useRealtime().subscribeToTable('stage_run')` on the same component already handles live updates.

**Architecture:** No new files except `ActivityFeed.tsx`. No port changes. No adapter changes. No schema changes.

**Verification:**

- `npx tsc --noEmit` clean.
- `npx vitest run` green (122/122 baseline holds).
- `npm run verify` 10/10.
- `npm run lint` no new problems.
- `npm run build` compiles.
- New Playwright smoke `e2e/activity-feed-realtime.spec.ts`: open issue detail → add a comment → assert activity feed updates without manual refresh and without console errors matching `/Adapter ".*" is not registered|Missing required environment variable|Missing Supabase config/`.
- Existing `e2e/run-stage-smoke.spec.ts` still passes.
- **Human browser verification (required per invariant 21):** full activity-feed flow — add comment, observe feed update without refresh; trigger a stage run, observe `RunDetailModal` updates without polling visible in the network tab.

**Documentation updates (part of the PR):**

- `docs/superpowers/deferred-fixes.md` — strike through "UI: Issue activity feed doesn't auto-refresh via Realtime" with `RESOLVED (R-UI-2.5)` citation; strike through "Adapter: RealtimeProvider not implemented" with a back-filled `RESOLVED (R-REM-W2)` citation; retain "UI: Pipeline detail modal duration doesn't update in real-time" with a clarifying note that only the `useNow` live tick remains open (realtime subscription landed in W2; useNow explicitly deferred from R-UI-2.5). Re-evaluate "UI: Activity feed does not show correctly" during execution: strike if the extraction + subscription incidentally fix the rendering; otherwise leave open with a tighter repro.
- `docs/superpowers/roadmap.md` — flip R-UI-2 row status to **Retired — superseded by R-UI-2.5 and R-REM-W3 (branch archived)**; insert R-UI-2.5 row with status + links; update What's Next item 2 to reflect the shipped scope.
- Append terminal-state note to R-UI-2 design spec and plan files as described in Phase 1.

**Out of scope:**

- `useNow` hook for live duration ticks (cosmetic, deferred).
- AUDIT-016 plan/spec drift (paperwork on retired docs; the terminal-state note supersedes the need to fix individual lines).
- Anything else from the retired branch's tasks 12–32.

**Estimated shape:** 1–2 sessions. Single plan, single PR.

### Phase 3 — R-REM-W3-a: Anthropic port cleanup + end-to-end journey

Small cleanup phase that converts "the engine should work" into "we have watched the engine work against live Claude."

**Scope (three items):**

1. **Delete `src/core/ports/ai.ts`** — zero consumers, misfit shape. Remove `AIProvider` and related types (`CompletionMessage`, `CompletionParams`, `CompletionUsage`, `CompletionResult`, `CompletionChunk`, `ModelInfo`) from `src/core/ports/index.ts`. `tsc --noEmit` catches any accidental imports.

2. **Update triage document.** Append a resolution note to `docs/superpowers/audits/2026-04-17-audit-triage.md` Pattern 2 "Anthropic adapter" bullet: "Resolved under R-REM-W3-a (2026-04-XX). The existing seed provider/driver rows + orchestrator subprocess path + `SubprocessStdoutParser` satisfy the AIProvider boundary; the unused `AIProvider` port was retired."

3. **End-to-end journey.** With `ANTHROPIC_API_KEY` set in the environment, execute a real stage run against live Claude. New Playwright test `e2e/real-anthropic-stage-run.spec.ts` that skips cleanly when `ANTHROPIC_API_KEY` is absent; when present, it: seeds the catalog (or verifies seed), navigates to an issue, advances state to a stage that runs Claude, triggers Run Stage, waits for `RunDetailModal` to show terminal `stage_run.status = 'completed'`, asserts at least one `tool_use` event is present in the event stream, asserts no console errors.

**Architecture:** Pure deletion + documentation + journey test. No new code under `src/`.

**Verification:**

- `npx tsc --noEmit` clean (catches any lingering import of the deleted port).
- `npx vitest run` green.
- `npm run verify` 10/10.
- `npm run lint` no new problems.
- `npm run build` compiles.
- `e2e/real-anthropic-stage-run.spec.ts` passes against live API.
- **Human browser verification (required per invariant 21):** the operator watches the stage run in a browser end-to-end, confirms live Claude output streams into `RunDetailModal`, confirms terminal state reached.

**Documentation updates (part of the PR):**

- `docs/superpowers/roadmap.md` — insert R-REM-W3-a row; update What's Next item 6 to reflect the four remaining W3 slices (GitHub adapter, CLI, 6 Settings tabs, Mission Control) and the per-slice brainstorm-then-plan cadence.
- `docs/superpowers/audits/2026-04-17-audit-triage.md` — Pattern 2 resolution note as above.

**Out of scope:**

- `AIProvider` as a direct-SDK integration path. Deferred post-alpha; if ever needed, it is a separate port with a separate adapter, not a revival of the retired shape.
- OpenAI adapter. Deferred post-alpha per triage Pattern 2.

**Estimated shape:** 1 session. Small PR.

### Phase 4 — R-REM-W3 remainder (not planned in this design)

Four slices, each brainstormed + planned individually when reached:

1. **GitHub adapter** — `src/adapters/github/` implementing `GitProvider` (`src/core/ports/git.ts`) and `IssueProvider` (`src/core/ports/issue.ts`). Net-new external integration. First after W3-a because it is the only remaining alpha deliverable that requires non-trivial new code against an external service.
2. **CLI** — `src/cli/` thin tRPC-client wrapper per triage framing. Command shape and alpha command list TBD at brainstorm time.
3. **6 Settings tabs** — Cron Jobs, Teams, Users, System, Stages, Projects. Uses the W1 CRUD factory. Slice count (one tab-group? two? six?) determined at brainstorm time based on what the CRUD factory migration reveals in practice.
4. **Mission Control** — one page reading existing orchestrator state. Independent of adapters.

Order of the four is not pinned here. Each is brainstormed + planned + shipped as a separate PR. The design decision is that they do not require a top-level plan for W3 as a whole — each slice's brainstorm produces its own design spec and plan.

---

## Ordering

R-UI-2.5 → R-REM-W3-a → first W3-remainder slice (GitHub adapter).

R-UI-2.5 first because it is the smaller phase, resolves a live invariant-9 violation on `main`, and leaves `main` clean of paused-work debt before W3 begins.

R-REM-W3-a second because it is tiny, unlocks no dependents architecturally, but converts the alpha's core unlock (real Claude execution end-to-end) from "expected to work" to "observed to work" — a high-value demo milestone for the same session that does it.

GitHub adapter third because it is the next alpha-critical item with genuine code surface. CLI, Settings tabs, and Mission Control follow in any order determined session-by-session.

---

## Out of Scope for This Design

- Detailed task breakdowns for R-UI-2.5 or R-REM-W3-a. Those live in their respective plans.
- Brainstorms for the four W3-remainder slices. Each gets its own design spec when reached.
- `useNow` hook design. Deferred.
- `AIProvider`-as-direct-SDK. Deferred post-alpha.
- OpenAI adapter. Deferred post-alpha.

---

## Open Questions

None. All decisions settled during brainstorming.

---

## Verification That This Design Is Coherent

- Retires a branch rather than rebases it — justified by the 17-commit drift including schema changes and the parallel realtime work that independently shipped on `main`.
- R-UI-2.5 scope contains only items where a live finding on `main` motivates the work (AUDIT-005 polling) or where the R-UI-2 spec's user-visible exit criterion is otherwise unmet (AUDIT-012 activity-feed subscription, AUDIT-003 file split as enabler).
- R-REM-W3-a scope contains only items that make the alpha engine's current behavior observable and documented — no new code, no new ports, no new adapters.
- Neither phase introduces dependencies on future work. Both can ship in isolation.
- Both phases include the roadmap + deferred-fixes documentation updates as part of their PR, so the project state stays synchronized with the source tree.
- Both phases respect invariant 21 (no self-certification) with explicit human-browser verification requirements.
