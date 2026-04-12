# R5-V: Manual Stage Execution — Session Handoff

**Date:** 2026-04-11
**From:** Session (brainstorming + R3.5 + R4-V)
**To:** Next session (R5-V implementation)

## Goal

A human clicks "Run Stage" on an issue → the current stage executes → live output streams in a modal → human sees the result and decides whether to advance to the next state.

No orchestrator daemon. No BullMQ queue. No automatic stage advancement. Just: "run this one stage for this one issue, right now, because I clicked the button."

## Why This Order

The pipeline orchestrator automates something that doesn't work manually yet. If a human can't trigger a single stage and see it run, the automation has nothing valid to automate. Manual execution first, orchestrator second.

## What Exists (R5 committed code)

The R5 commit (`dd83936`) added 2,055 lines across 11 files. The backend is architecturally complete:

| Component | File | Status |
|-----------|------|--------|
| Orchestrator Manager | `src/core/orchestrator/manager.ts` | Built but not started at boot |
| Pipeline Run Service | `src/core/orchestrator/pipeline-run-service.ts` | Functional |
| Routing Resolver | `src/core/orchestrator/routing-resolver.ts` | Functional |
| Stage Worker | `src/core/orchestrator/stage-worker.ts` | Built but not wired to BullMQ |
| Subprocess Executor | `src/adapters/subprocess/executor.ts` | Functional (execa wrapper) |
| tRPC Endpoints | `src/server/routers/pipeline.ts` | 9+ endpoints including trigger, executeStage, approveStage |
| Types | `src/core/orchestrator/types.ts` | Complete |
| Integration Tests | `src/__tests__/integration/orchestrator.test.ts` | 13 tests passing |

### tRPC Endpoints That Exist

- `pipeline.runs.trigger` — create a queued run for an issue
- `pipeline.runs.executeStage` — mark a pending stage as 'launching'
- `pipeline.runs.approveStage` — approve a held stage
- `pipeline.runs.rejectStage` — reject (rework/abort)
- `pipeline.runs.get` — get run with stage runs and events
- `pipeline.runs.list` — list runs for a pipeline
- `pipeline.runs.listByProject` — list all runs in a project
- `pipeline.runs.issueState` — get pipeline state for an issue
- `pipeline.runs.events` — get events for a stage run
- `pipeline.runs.cancel` — cancel a run
- `pipeline.runs.kpis` — aggregate metrics

### UI That Exists

- Issue detail page has a "Run Stage" button (`src/app/[org]/[user]/[project]/issues/[number]/client.tsx`)
- Pipeline stages display with color-coded status
- Pipelines list page with "Start Run" button

### What's Missing for Manual Execution

1. **Prompt building** — hardcoded to empty string in `manager.ts` line 247. Needs to build from issue context + persona + skills.
2. **Direct execution path** — currently requires orchestrator heartbeat to pick up queued work. Need a synchronous "execute now" path that bypasses the queue.
3. **Live output modal** — PAT has `RunDetailModal` + `LiveOutput` components. fluxaOS has no equivalent.
4. **Harness mapping** — `buildCommand()` assumes harness name = executable command. Needs a registry.
5. **BullMQ worker not registered** — handler exists but not wired to `queue.process()`.

## What PAT Has (Reference)

PAT's frontend has the exact UX we need:

- `RunDetailModal.tsx` — modal with tabs (Stage Timeline, Live Output, Agent Conversation)
- `LiveOutput.tsx` — streams stdout/stderr with parsed transcript entries (text, tool calls, tool results, cost updates)
- `StageTimeline.tsx` — vertical timeline of stage progression
- `useStageStreamLifecycle.ts` — hook for real-time output streaming
- `StageGatesSection.tsx` — gate configuration UI in settings

## Approach for R5-V

### Phase 1: Direct Execution (no queue, no orchestrator)

Build a simple synchronous execution path:

1. "Run Stage" button on issue detail calls a new tRPC endpoint
2. Endpoint looks up: issue state → pipeline stage → routing config
3. Endpoint directly spawns the subprocess (no BullMQ, no queue)
4. Output streams back via server-sent events or Supabase Realtime
5. Stage completes → result stored → UI updates

This proves the engine works without any automation infrastructure.

### Phase 2: Live Output Modal

Build the modal that shows:
- Stage name and status
- Live streaming output (stdout/stderr)
- Cost/token tracking (even if zeros initially)
- Gate verdict after completion
- "Advance to next state" / "Rework" buttons

Reference PAT's `RunDetailModal` and `LiveOutput` for the UX pattern.

### Phase 3: Gate Integration

After a stage runs:
- Evaluate gate rules (R4 engine already works)
- Show verdict in the modal
- Human decides: approve (advance) or reject (rework/hold)

## Approved Mockup Reference

`planning/mockups/pipeline-run-detail-mockup.svg` shows:
- Stage timeline (Research ✓, Implement ✓, Review → gate pending, Deploy queued)
- Per-stage: provider/model info, status badges
- Gate controls: Approve / Rework / Abort buttons
- Cancel run button
- Cost display

## Enforcement

This phase uses the full skill chain installed in R3.5:
- Write guard hook (no Write on existing files)
- Phase snapshot (capture before, compare after)
- Session Protocol in CLAUDE.md (scope to plan, Edit only)
- Codex stop-time review gate (fires automatically at session end)

## How to Start

```
Resume the fluxaOS rebuild. Read CLAUDE.md first (Session Protocol + invariants).
Read docs/superpowers/specs/2026-04-11-r5v-manual-execution-handoff.md for context.
Goal: "Run Stage" button on issue detail → stage executes → live output in modal → human sees result.
No orchestrator daemon. No queue. Direct execution, manual advancement.
Reference PAT at /mnt/dev/pat/frontend/src/components/RunDetailModal.tsx and LiveOutput.tsx for the UX pattern.
```
