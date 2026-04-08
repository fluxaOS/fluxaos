---
phase: 04-pipeline-engine
plan: 01-04
type: summary
tags: [state-machine, gate-engine, routing-resolver, bullmq, node-exec, just-do-it, cli]

requires:
  - phase: 03-personas-configuration/03-01
    provides: Persona service + inheritance resolution

provides:
  - Pipeline + StageRun state machines with validated transitions
  - Append-only event store for observability
  - Gate rules engine (auto/manual/hold/skip modes)
  - Routing resolver (persona → routing profile → provider/model/harness)
  - BullMQ adapter (QueueProvider) with stage execution worker
  - Node-exec adapter (StageExecutor) wrapping execa
  - "Just Do It" mode (prompt → ephemeral issue → default pipeline → run)
  - CLI commands: `fluxaos do`, `fluxaos run`
  - tRPC pipeline router: 16 endpoints

affects: [phase-5 UI pipeline runs page, phase-6 harness integration]

tech-stack:
  added: []
  patterns: [state-machine transitions, gate evaluation, routing resolution, subprocess orchestration]

key-files:
  created:
    - src/core/pipeline/types.ts
    - src/core/pipeline/service.ts
    - src/core/pipeline/index.ts
    - src/core/pipeline/just-do-it.ts
    - src/core/observability/types.ts
    - src/core/observability/service.ts
    - src/core/observability/index.ts
    - src/core/gates/types.ts
    - src/core/gates/engine.ts
    - src/core/gates/index.ts
    - src/core/routing/resolver.ts
    - src/adapters/bullmq/queue.ts
    - src/adapters/bullmq/worker.ts
    - src/adapters/bullmq/index.ts
    - src/adapters/node-exec/executor.ts
    - src/adapters/node-exec/index.ts
    - src/cli/commands/run.ts
    - src/__tests__/pipeline.test.ts
    - src/__tests__/gates.test.ts
    - src/__tests__/routing-resolver.test.ts
    - src/__tests__/integration/pipeline.integration.test.ts
  modified:
    - src/server/routers/pipeline.ts
    - src/core/routing/index.ts
    - src/config/index.ts
    - src/cli/index.ts

key-decisions:
  - "Same VALID_TRANSITIONS pattern as issues — proven, simple, type-safe"
  - "Gate verdict severity ordering: proceed < hold < rework < abort — worst wins"
  - "Default gate (no rules defined): exit_code_zero check with abort on failure"
  - "Harness precedence: stage config > rule preferredHarness > fallbackHarness > 'claude-code'"
  - "Worker catches routing failures gracefully — falls back to defaults rather than crashing"
  - "Cost parsing deferred to Phase 6 — hardcoded to '0' for now"

patterns-established:
  - "Pipeline state machine: pending → running → completed/failed/cancelled"
  - "Stage run lifecycle: queued → running → completed → gate eval → advance/hold/rework/abort"
  - "Rework cycle: completed → rework → queued (re-execution)"
  - "Gate modes: skip (always proceed), manual/hold (human approval), auto/rules (evaluate conditions)"
  - "Routing resolution: persona → profile → rules → filter providers → sort → select"
  - "Worker orchestration: resolve → materialize → execute → record → gate → advance"

duration: ~20min
started: 2026-04-08
completed: 2026-04-08
---

# Phase 4: Pipeline Engine — Summary

**The core execution engine: state machines, gates, routing, subprocess execution, and "Just Do It" mode.**

## Performance

| Metric | Value |
|--------|-------|
| Plans | 4 (04-01 through 04-04) |
| Files created | 21 |
| Files modified | 4 |
| Lines added | ~2,128 |
| Tests added | 42 (78 total) |

## Plan Results

| Plan | Scope | Status |
|------|-------|--------|
| 04-01 | Pipeline + StageRun state machine + event store | Complete |
| 04-02 | Routing resolver + gate rules engine | Complete |
| 04-03 | BullMQ + node-exec adapters + skill materialization wire-up | Complete |
| 04-04 | "Just Do It" mode + integration test + CLI extensions | Complete |

## What Was Built

### 04-01: State Machine + Event Store
- `PipelineRunStatus`: pending → running → completed/failed/cancelled
- `StageRunStatus`: queued → running → completed → rework → queued (cycle)
- Pipeline CRUD + stage CRUD + run lifecycle (start, advance, cancel, complete)
- Append-only event store: appendEvent, getStageEvents, getRunEvents
- Cost tallying on pipeline completion (SUM of stage costs)

### 04-02: Routing Resolver + Gate Engine
- Routing resolver: persona → routing profile → rules → filter/sort providers → select
- Gate engine: 5 modes (skip, manual, hold, auto, rules), 3 built-in conditions
- Verdict severity: proceed < hold < rework < abort (worst wins)
- Pattern matching for model filtering (glob with `*`)

### 04-03: BullMQ + Node-Exec Adapters
- BullMQ adapter implementing QueueProvider port interface
- Stage execution worker/orchestrator (the critical path tying everything together)
- Node-exec adapter wrapping execa with streaming, timeout, cancel support
- Skill materialization wired into execution (temp dir, cleanup)
- Adapter registration in config/index.ts

### 04-04: Just Do It + CLI + Integration Test
- `justDoIt(projectId, prompt)`: ephemeral issue → default pipeline → start run
- CLI: `fluxaos do "prompt"`, `fluxaos run start/status/cancel/list`
- tRPC: `pipeline.justDoIt`, `pipeline.approveStage`, `pipeline.rejectStage`
- Integration test: 3-stage lifecycle, rework cycle, abort, cancel, state coverage

## Deviations from Plan

- Cost parsing hardcoded to '0' — deferred to Phase 6 when real AI providers are wired up
- Integration test uses state machine + gate engine validation (no real DB) rather than full DB integration — sufficient to validate the critical paths

## Next Phase Readiness

**Ready for Phase 5 (Web UI):**
- All tRPC endpoints exist for pipeline CRUD, runs, stages, events, gate approval
- State machine transitions produce typed events for UI consumption
- "Just Do It" endpoint ready for dashboard prompt box
- Gate approval/rejection endpoints ready for run detail UI

**Ready for Phase 6 (AI Providers):**
- StageExecutor port interface proven with node-exec adapter
- Worker orchestration handles persona resolution + skill materialization + subprocess execution
- Cost recording infrastructure exists (just needs real parsing)

---
*Phase: 04-pipeline-engine*
*Completed: 2026-04-08*
