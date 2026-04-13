# R5-V Architectural Cleanup — Session Handoff

**Date:** 2026-04-13, ~1:00 AM PDT
**Branch:** `phase/r5v-manual-execution`
**PR:** #19 (blocked — all issues below must be resolved before merge)
**Status:** Design spec written, implementation plan written, ready for execution.

---

## What This Session Did

1. **Reviewed the browser verification handoff** — 5 broken/incomplete features identified in the previous session
2. **Launched 3 parallel DA audit agents** — vendor lock-in, hardcoded values/DRY, and architectural drift
3. **Synthesized audit findings** — 17 issues total (5 CRITICAL, 7 HIGH, 5 MEDIUM), all stemming from one root cause: the manual-run path was bolted on alongside the orchestrator instead of sharing infrastructure
4. **Made architectural decision** — event-orchestrator (Supabase Realtime) is the intended architecture per the roadmap; manager.ts (polling) is drift and will be deleted
5. **Designed 4-layer bottom-up refactor** through collaborative brainstorming (Approach A: constants → shared services → shared execution → consumer cleanup)
6. **Resolved harness-agnosticism design** — all harnesses get the same two-file workspace layout, only filenames vary via `contextLayout` jsonb column on `harness_catalog`
7. **Wrote design spec** — `docs/superpowers/specs/2026-04-13-r5v-architectural-cleanup-design.md`
8. **Wrote implementation plan** — `docs/superpowers/plans/2026-04-13-r5v-architectural-cleanup.md` (14 tasks, full code)

---

## Key Documents

| Document | Path | Purpose |
|----------|------|---------|
| **Design Spec** | `docs/superpowers/specs/2026-04-13-r5v-architectural-cleanup-design.md` | Full design with 4-layer architecture, schema changes, file map |
| **Implementation Plan** | `docs/superpowers/plans/2026-04-13-r5v-architectural-cleanup.md` | 14 bite-sized tasks with exact code, file paths, and commit messages |
| **Browser Verification Handoff** | `docs/superpowers/handoffs/2026-04-13-r5v-browser-verification-handoff.md` | Previous session's findings — the 5 issues + 10 bugs fixed |
| **Roadmap v2** | `docs/superpowers/plans/2026-04-07-fluxaos-roadmap-v2.md` | Confirms Supabase Realtime as intended event transport |

---

## What Needs to Happen Next

**Execute the 14-task implementation plan.** Subagent-driven development recommended (one subagent per task, review between tasks). Tasks are sequential — Layer 1 must land before Layer 2 can use the constants, etc.

### Task Summary

| Task | Layer | What | Key Files |
|------|-------|------|-----------|
| 1 | L1 | Constants module | `src/core/constants.ts` (new) |
| 2 | L1 | Types re-export from constants | `src/core/orchestrator/types.ts` |
| 3 | L2 | PipelineRunService consolidation | `src/core/orchestrator/pipeline-run-service.ts` |
| 4 | L3 | Schema migration for contextLayout | `src/core/db/schema.ts`, `drizzle/0002_harness_context_layout.sql` |
| 5 | L3 | Harness-agnostic materializer | `src/core/skills/materializer.ts` |
| 6 | L3 | Shared stage-runner extraction | `src/core/orchestrator/stage-runner.ts` (new) |
| 7 | L3 | Manual-run thin wrapper | `src/core/orchestrator/manual-run.ts` |
| 8 | L4 | Event-orchestrator vendor fix | `src/core/orchestrator/event-orchestrator.ts`, `src/core/ports/realtime.ts` |
| 9 | L4 | Delete manager.ts + update exports | `src/core/orchestrator/manager.ts` (deleted), `src/core/orchestrator/index.ts` |
| 10 | L4 | Routing resolver fail-fast + seed data | `src/core/orchestrator/routing-resolver.ts`, `src/core/db/seed.ts` |
| 11 | L4 | Gate service constants | `src/core/gates/service.ts` |
| 12 | L4 | UI status constants | `StageTimeline.tsx`, `PipelineStatusBadge.tsx` |
| 13 | L4 | Remaining cleanup | `output-parser.ts`, `providers/page.tsx`, `executor.ts` |
| 14 | — | Verification | grep checks, build, tests, seed |

---

## What Gets Fixed

### 5 Handoff Issues (All Merge-Blocking for PR #19)

| # | Issue | Fixed By |
|---|-------|----------|
| 1 | Skill/context injection vendor-locked to `CLAUDE.md` | Task 5 (materializer reads `contextLayout` from harness config) |
| 2 | `stage_run.harness` column stays null | Task 6 (stage-runner calls `completeStageRun` with harness metadata) |
| 3 | No gate evaluation after manual stage completion | Task 7 (manual-run calls gate service after `executeStageRun`) |
| 4 | No model configured — `--model` flag never passed | Task 10 (seed creates provider, model, and routing rule) |
| 5 | Missing `pipeline_completed`/`pipeline_failed` issue events | Task 7 (manual-run writes pipeline-level issue events) |

### 17 DA Audit Findings

| Severity | Count | Fixed By |
|----------|-------|----------|
| CRITICAL (5) | Supabase imports in core, duplicated logic, dead code, diverged event types, CLAUDE.md hardcoding | Tasks 1, 6, 8, 9 |
| HIGH (7) | Status string duplication, copy-pasted DB updates, duplicated event helpers, silent defaults, magic numbers, vendor placeholders, no constants module | Tasks 1, 3, 10, 12, 13 |
| MEDIUM (5) | Silent gate mode default, hardcoded workspace path, demo deletes events, silent actor default, vendor comment | Tasks 9, 11, 13 |

---

## Architecture Decisions Made This Session

1. **Realtime over Polling** — Event-orchestrator (Supabase Realtime) is the intended architecture per roadmap v2. Manager.ts (polling) is deleted.
2. **Shared execution via `executeStageRun()`** — Both manual-run and event-orchestrator call the same function. No duplicated logic.
3. **Harness-agnostic materializer** — Two files always (`instructionsFile` + `contextFile`), same content structure, only filenames vary per harness. Filenames stored in `harness_catalog.context_layout` (jsonb).
4. **No per-harness adapter translation layer** — Materializer writes directly to the harness-configured filenames. No intermediate "standard layout" that gets translated.
5. **Constants as single source of truth** — All status strings, event types, verdicts, defaults centralized in `src/core/constants.ts`. Both backend and frontend import from the same module.
6. **PipelineRunService owns all DB mutations** — No more private helper functions scattered across orchestrators.

---

## Current Branch State

```
Recent commits on phase/r5v-manual-execution:
8de3295 docs: R5-V architectural cleanup implementation plan
344be4c docs: R5-V architectural cleanup design spec
0c473ac docs: R5-V complete session handoff + roadmap status update
738630c feat: R5-V UI components, integration tests, and page wiring (Tasks 8-15)
bf49e43 docs: R5-V implementation session handoff — Tasks 1-7 complete
62f03af feat: event-driven orchestrator + pipeline router updates for R5-V
edcadb6 feat: output parser — converts harness stdout to typed transcript entries
```

Uncommitted changes from the browser verification session (10 bug fixes) are still present — these are the fixes that made manual execution work end-to-end. They should be committed as part of the implementation or before starting Task 1.

---

## Restore Point

To pick up from here:

```bash
cd /mnt/dev/fluxaos
git checkout phase/r5v-manual-execution
```

Then read:
1. `docs/superpowers/plans/2026-04-13-r5v-architectural-cleanup.md` — the implementation plan
2. `docs/superpowers/specs/2026-04-13-r5v-architectural-cleanup-design.md` — the design rationale

Execute with subagent-driven development: one subagent per task, review between tasks. Start at Task 1.

---

## User Preferences (Carry Forward)

- **No self-certification** — every phase verified by human in running browser
- **No fallbacks** — never implement polling fallbacks or degraded-mode alternatives
- **No unit tests** — integration tests against real Supabase only
- **Do it right** — user explicitly said "I would rather spend 10 extra hours now and do this right"
- **Vendor agnosticism is non-negotiable** — the engine must never know about specific tools
