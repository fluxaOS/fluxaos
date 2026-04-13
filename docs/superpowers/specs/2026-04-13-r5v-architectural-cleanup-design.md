# R5-V Architectural Cleanup — Design Spec

**Date:** 2026-04-13
**Branch:** `phase/r5v-manual-execution`
**PR:** #19 (blocked on these issues)
**Status:** Design approved, ready for implementation planning

---

## Problem Statement

Browser verification of R5-V (Manual Stage Execution) revealed 5 broken/incomplete features. A subsequent DA audit found these were symptoms of deeper architectural rot: vendor lock-in in core engine code, ~500 lines of duplicated orchestration logic, dead code, diverged type definitions, hardcoded magic strings, and fail-fast violations.

The engine's founding principle — **harness-agnostic, config-driven, DI everywhere** — has eroded. This spec defines a bottom-up refactor to restore those boundaries and fix all blocking issues before PR #19 can merge.

---

## Scope

### What This Fixes

**5 Handoff Issues (all merge-blocking):**

| # | Issue | Root Cause |
|---|-------|------------|
| 1 | Skill/context injection vendor-locked to Claude Code | Materializer hardcodes `CLAUDE.md` filename |
| 2 | `stage_run.harness` column stays null after execution | `manual-run.ts` doesn't call `completeStageRun()` with harness info |
| 3 | No gate evaluation after manual stage completion | `manual-run.ts` skips gate logic entirely |
| 4 | No model configured — `--model` flag never passed | No routing rule seeded for default pipeline stages |
| 5 | Missing `pipeline_completed`/`pipeline_failed` issue events | `manual-run.ts` writes stage events but not pipeline events |

**17 DA Audit Findings:**

| Severity | Count | Summary |
|----------|-------|---------|
| CRITICAL | 5 | Supabase imports in core, duplicated orchestration logic, dead event-orchestrator, diverged event types, CLAUDE.md hardcoding |
| HIGH | 7 | Status strings duplicated across UI/core, copy-pasted DB updates (8+), duplicated event helpers, silent `'subprocess'` default, magic timeout `300` repeated 3x, vendor names in UI placeholders, no constants module |
| MEDIUM | 5 | Silent gate mode default, hardcoded workspace path, demo deletes events, silent actor default, vendor-specific comment in output parser |

### What This Does NOT Touch

- Schema structure (no new tables, no column renames — one column addition to `harness_catalog`)
- tRPC router API contracts
- UI component behavior (only placeholder text changes)
- Test suite
- Seed data structure (only values change)

---

## Architecture Decision: Realtime vs Polling

The roadmap (v2, Phase 4) specifies Supabase Realtime as the event transport. The codebase contains two competing implementations:

- `event-orchestrator.ts` (739 lines) — Realtime-driven state machine. **Never wired up.** Dead code.
- `manager.ts` (333 lines) — Polling-based heartbeat loop. **Currently active.**

**Decision:** Event-orchestrator is the intended architecture. Manager.ts is drift.

**Action:**
- Keep event-orchestrator, fix its vendor boundary violations
- Delete manager.ts
- Extract shared execution logic so both manual-run and event-orchestrator use the same code path

---

## Design: 4-Layer Bottom-Up Refactor

### Layer 1: Constants Module

**New file:** `src/core/constants.ts`

Single source of truth for all status strings, event types, gate verdicts, defaults, and timeouts. Imported by both server-side code and UI components (read-only values, no DB access).

**Contents:**

```typescript
// ── Pipeline Run Statuses ──────────────────────────────────
export const PIPELINE_RUN_STATUS = {
  pending: 'pending',
  queued: 'queued',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  timed_out: 'timed_out',
  cancelled: 'cancelled',
  blocked: 'blocked',
} as const;

// ── Stage Run Statuses ─────────────────────────────────────
export const STAGE_RUN_STATUS = {
  pending: 'pending',
  launching: 'launching',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  timed_out: 'timed_out',
  cancelled: 'cancelled',
} as const;

// ── Event Types (written to `event` table) ─────────────────
export const EVENT_TYPE = {
  STAGE_STARTED: 'STAGE_STARTED',
  STAGE_COMPLETED: 'STAGE_COMPLETED',
  OUTPUT: 'OUTPUT',
  ERROR: 'ERROR',
  GATE_EVALUATED: 'GATE_EVALUATED',
} as const;

// ── Issue Event Types (written to `issue_event` table) ─────
export const ISSUE_EVENT_TYPE = {
  stage_started: 'stage_started',
  stage_completed: 'stage_completed',
  stage_failed: 'stage_failed',
  pipeline_completed: 'pipeline_completed',
  pipeline_failed: 'pipeline_failed',
} as const;

// ── Gate Verdicts ──────────────────────────────────────────
export const GATE_VERDICT = {
  proceed: 'proceed',
  hold: 'hold',
  rework: 'rework',
  abort: 'abort',
} as const;

// ── Gate Modes ─────────────────────────────────────────────
export const GATE_MODE = {
  auto: 'auto',
  manual: 'manual',
  rule: 'rule',
} as const;

// ── Defaults ───────────────────────────────────────────────
export const DEFAULT_STAGE_TIMEOUT_SEC = 300;
export const DEFAULT_GATE_MODE = GATE_MODE.auto;
export const DEFAULT_SORT_STRATEGY = 'quality' as const;
export const KILL_GRACE_PERIOD_MS = 5_000;
export const ORCHESTRATOR_HEARTBEAT_MS = 5_000;
```

**Consumer changes:** All files using inline `'running'`, `'completed'`, `'STAGE_STARTED'`, `300`, etc. import from this module. UI components (`StageTimeline`, `PipelineStatusBadge`) use the same constants — status map keys can never drift from the backend.

---

### Layer 2: Shared Services Consolidation

**Existing file:** `src/core/orchestrator/pipeline-run-service.ts`

`PipelineRunService` already has 12 well-designed methods: `createRun`, `updateRunStatus`, `completeRun`, `createStageRun`, `updateStageRunStatus`, `completeStageRun`, `appendEvent`, etc. The problem: both `manual-run.ts` and `event-orchestrator.ts` ignore it and write raw DB queries instead.

**New methods added to `PipelineRunService`:**

```typescript
/** Write an issue event (stage_started, stage_completed, etc.) */
appendIssueEvent(
  issueId: string,
  type: string,
  payload: Record<string, unknown>,
  actor: string,
): Promise<void>;

/** Fail both the stage run and the pipeline run in one call. */
failStageAndRun(
  stageRunId: string,
  runId: string,
): Promise<void>;
```

**Consumer changes:**
- `manual-run.ts`: Delete private `writeEvent()`, `writeIssueEvent()`, `failStageAndRun()` helpers. Use `runService` methods.
- `event-orchestrator.ts`: Delete private `appendEvent()`, `appendIssueEvent()` closures. Use `runService` methods.
- All inline status strings in both files replaced with Layer 1 constants.
- `PipelineRunService` itself updated to use Layer 1 constants internally.

---

### Layer 3: Shared Execution

**New file:** `src/core/orchestrator/stage-runner.ts`

Extracts the ~200 lines of duplicated execution logic into a single function used by both manual-run and event-orchestrator.

**Interface:**

```typescript
export interface StageRunContext {
  db: Database;
  executor: StageExecutor;
  runService: PipelineRunService;
  runId: string;
  stageRunId: string;
}

export interface StageRunResult {
  exitCode: number;
  durationMs: number;
}

/**
 * Execute a single stage run end-to-end.
 *
 * Loads all config from DB, materializes workspace, builds command,
 * spawns subprocess, streams output to events, completes stage run.
 */
export async function executeStageRun(
  ctx: StageRunContext,
): Promise<StageRunResult>
```

**What `executeStageRun` does internally (10 steps):**

1. Load stage, harness, skill, issue, routing, persona from DB
2. Validate harness exists — fail fast via `runService.failStageAndRun()` if missing
3. Materialize workspace — call `materialize()` with harness `contextLayout` (see below)
4. Render prompt via `renderTemplate()`
5. Build command via `buildCommand()`
6. Mark stage `running` via `runService.updateStageRunStatus()`
7. Write `STAGE_STARTED` event via `runService.appendEvent()`
8. Spawn subprocess, stream stdout/stderr to events via `runService.appendEvent()`
9. Complete stage via `runService.completeStageRun()` with exit code, harness name, provider, model
10. Write `STAGE_COMPLETED` or `ERROR` event, write issue events, cleanup workspace

**Materializer changes (harness-agnostic context injection):**

The materializer currently hardcodes `CLAUDE.md` at line 77 of `materializer.ts`. Different harnesses expect different filenames for the same content:

| Harness | Instructions File | Why |
|---------|------------------|-----|
| Claude Code | `CLAUDE.md` | Auto-discovered from `--add-dir` directories |
| Codex | `AGENTS.md` | OpenAI's convention |
| Gemini CLI | `GEMINI.md` | Google's convention |

The content is identical — persona soul, skill prompt, issue context. Only the filename varies, and the filename is a property of the harness.

**Schema change:** Add `contextLayout` (jsonb, NOT NULL) to `harness_catalog`:

```sql
ALTER TABLE harness_catalog
  ADD COLUMN context_layout jsonb NOT NULL DEFAULT '{"instructionsFile": "CLAUDE.md", "contextFile": "context.md"}';
```

**Shape:**

```jsonb
{
  "instructionsFile": "CLAUDE.md",
  "contextFile": "context.md"
}
```

Always two files. Same content structure. Only filenames vary per harness. No optional files, no per-skill splitting, no null layouts.

**Materializer interface change:**

```typescript
export interface MaterializeOptions {
  stageRunId: string;
  contextLayout: { instructionsFile: string; contextFile: string };
  persona?: PersonaInput | null;
  skill: SkillInput;
  issue: IssueInput;
  projectName?: string;
}
```

Line 77 changes from:
```typescript
await atomicWrite(join(workspacePath, 'CLAUDE.md'), parts.join('\n\n'));
```
To:
```typescript
await atomicWrite(join(workspacePath, options.contextLayout.instructionsFile), parts.join('\n\n'));
```

Line 82 changes from:
```typescript
await atomicWrite(join(workspacePath, 'context.md'), contextMd);
```
To:
```typescript
await atomicWrite(join(workspacePath, options.contextLayout.contextFile), contextMd);
```

The materializer no longer knows or cares what harness will consume the files.

**Seed update:** The Claude Code harness entry gets `contextLayout`:
```typescript
contextLayout: { instructionsFile: 'CLAUDE.md', contextFile: 'context.md' }
```

**UI update:** The harness settings form adds two fields for context layout filenames. Users creating custom harness entries provide the filenames their tool expects.

**What manual-run.ts becomes (~40 lines):**

```typescript
export async function executeManualRun(
  db: Database,
  executor: StageExecutor,
  runId: string,
  stageRunId: string,
): Promise<void> {
  const runService = createPipelineRunService(db);
  try {
    const result = await executeStageRun({
      db, executor, runService, runId, stageRunId,
    });

    // Complete pipeline run
    const status = result.exitCode === 0
      ? PIPELINE_RUN_STATUS.completed
      : PIPELINE_RUN_STATUS.failed;
    await runService.completeRun(runId, status);

    // Pipeline-level issue events
    const run = await runService.getRun(runId);
    if (run?.issueId) {
      await runService.appendIssueEvent(
        run.issueId,
        result.exitCode === 0
          ? ISSUE_EVENT_TYPE.pipeline_completed
          : ISSUE_EVENT_TYPE.pipeline_failed,
        { runId, exitCode: result.exitCode },
        'manual-run',
      );
    }

    // Gate evaluation
    // (gate service call here if stage has gates configured)
  } catch (err) {
    await runService.failStageAndRun(stageRunId, runId);
  }
}
```

**What event-orchestrator's `launchStage()` becomes:**

Same pattern — thin wrapper that calls `executeStageRun()`, then uses the result to drive the Realtime-based state machine (evaluate gates, advance to next stage, handle rework loops).

---

### Layer 4: Consumer Cleanup

Everything the first three layers don't cover.

#### 4a. Event-Orchestrator Vendor Boundary Fix

`event-orchestrator.ts` line 19 imports `SupabaseClient` and `RealtimeChannel` from `@supabase/supabase-js` — a core boundary violation.

**Fix:** `createEventOrchestrator()` receives a `RealtimeProvider` port instead of `SupabaseClient`:

```typescript
// Before (violates core boundary)
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
createEventOrchestrator(db, executor, supabase: SupabaseClient, config)

// After (uses port abstraction)
import type { RealtimeProvider } from '@/core/ports/realtime';
createEventOrchestrator(db, executor, realtime: RealtimeProvider, config)
```

Supabase-specific subscription logic moves to the adapter implementation of `RealtimeProvider`.

#### 4b. Delete Dead Code

- **`manager.ts`** — polling-based orchestrator. Replaced by event-orchestrator. Delete.
- **Private helper functions in `manual-run.ts`** — `writeEvent()`, `writeIssueEvent()`, `failStageAndRun()`. Replaced by `PipelineRunService`. Delete.
- **Private helper closures in `event-orchestrator.ts`** — `appendEvent()`, `appendIssueEvent()`. Same. Delete.

#### 4c. Routing Resolver: Fail Fast

`routing-resolver.ts:144` silently defaults to `'subprocess'`:

```typescript
// Before (silent default)
const harness = stage.harness ?? rule?.preferredHarness ?? rule?.fallbackHarness ?? 'subprocess';

// After (fail fast)
const harness = stage.harness ?? rule?.preferredHarness ?? rule?.fallbackHarness;
if (!harness) {
  throw new Error(`No harness configured for stage ${stage.id} and no routing rule fallback`);
}
```

#### 4d. Seed: Default Routing Rule

The routing resolver returns null because no routing rule maps the default pipeline stages to a provider + model. Add to seed script:

- Insert a row into `routing_rule` for the seeded pipeline's project, linking to the seeded provider and model
- Set `preferredHarness` to the Claude Code harness slug
- Set the model identifier (e.g. `claude-sonnet-4-6`) so the resolver returns a real value
- This ensures `--model` flag is populated when the resolver runs

#### 4e. Gate Evaluation in Manual-Run

After `executeStageRun()` completes, manual-run calls the gate service if the stage has gates configured:

```typescript
const gateService = createGateService(db); // factory, same DI pattern as runService
const stage = /* loaded during executeStageRun, returned or re-queried */;
if (stage.gateMode && stage.gateMode !== GATE_MODE.auto) {
  const gateResult = await gateService.evaluate(stageRunId);
  await runService.appendEvent(stageRunId, EVENT_TYPE.GATE_EVALUATED, gateResult);
}
```

#### 4f. UI Placeholder Cleanup

`src/app/.../settings/providers/page.tsx`:
- Line 138: `"anthropic, openai, etc."` changed to `"provider slug"`
- Line 257: `"claude-sonnet-4-6"` changed to `"model identifier"`

#### 4g. Output Parser Comment

`src/core/orchestrator/output-parser.ts` line 35:
- `"Claude Code outputs one JSON object per line"` changed to `"The harness outputs one JSON object per line"`

#### 4h. Demo Script: Remove Event Deletion

`src/core/orchestrator/demo.ts:248` deletes events from the append-only event table. Remove the `db.delete(event)` calls. Events are the audit trail and survive even when stage runs are cleaned up.

#### 4i. Other Silent Defaults

- Gate mode default: use `DEFAULT_GATE_MODE` constant instead of inline `'auto'`
- Sort strategy default: use `DEFAULT_SORT_STRATEGY` constant instead of inline `'quality'`
- Timeout default: use `DEFAULT_STAGE_TIMEOUT_SEC` constant instead of inline `300`

---

## Schema Changes

One column addition:

| Table | Column | Type | Nullable | Default | Purpose |
|-------|--------|------|----------|---------|---------|
| `harness_catalog` | `context_layout` | `jsonb` | `NOT NULL` | `'{"instructionsFile":"CLAUDE.md","contextFile":"context.md"}'` | Filenames the materializer writes for this harness |

**Migration:** Single `ALTER TABLE ADD COLUMN` with a default so existing rows are backfilled.

---

## Files Changed

### New Files

| File | Purpose |
|------|---------|
| `src/core/constants.ts` | Shared constants (statuses, event types, verdicts, defaults) |
| `src/core/orchestrator/stage-runner.ts` | Shared `executeStageRun()` function |
| Migration for `context_layout` column | Schema change |

### Modified Files

| File | Changes |
|------|---------|
| `src/core/orchestrator/pipeline-run-service.ts` | Add `appendIssueEvent()`, `failStageAndRun()`; use constants |
| `src/core/orchestrator/manual-run.ts` | Reduce to ~40-line wrapper around `executeStageRun()` |
| `src/core/orchestrator/event-orchestrator.ts` | Use `RealtimeProvider` port, `runService`, `executeStageRun()`, constants |
| `src/core/skills/materializer.ts` | Read filenames from `contextLayout` instead of hardcoding `CLAUDE.md` |
| `src/core/orchestrator/types.ts` | Align `StageEventType` with actual event types; re-export from constants |
| `src/core/orchestrator/routing-resolver.ts` | Remove silent `'subprocess'` default; fail fast |
| `src/core/gates/engine.ts` | Use verdict constants |
| `src/core/gates/service.ts` | Use gate mode constants |
| `src/core/db/schema.ts` | Add `contextLayout` column to `harnessCatalog` |
| `src/core/db/seed.ts` | Add `contextLayout` to harness entry; add default routing rule |
| `src/core/orchestrator/demo.ts` | Remove event deletion |
| `src/core/orchestrator/output-parser.ts` | Fix vendor-specific comment |
| `src/components/pipeline/StageTimeline.tsx` | Import status constants |
| `src/components/pipeline/PipelineStatusBadge.tsx` | Import status constants |
| `src/app/.../settings/providers/page.tsx` | Remove vendor-specific placeholder text |
| `src/adapters/subprocess/executor.ts` | Use `KILL_GRACE_PERIOD_MS` constant |

### Deleted Files

| File | Reason |
|------|--------|
| `src/core/orchestrator/manager.ts` | Polling-based orchestrator replaced by event-orchestrator |

---

## Verification Checklist

After implementation, verify in a running browser:

- [ ] Trigger manual run from issue detail — stage completes with exit 0
- [ ] `stage_run` row has `harness`, `provider`, `model` populated (not null)
- [ ] `event` table has `STAGE_STARTED`, `OUTPUT`, `STAGE_COMPLETED` events
- [ ] `issue_event` table has both `stage_completed` and `pipeline_completed` events
- [ ] LiveOutput streams transcript in real-time
- [ ] `--model` flag appears in subprocess command (check server logs)
- [ ] No `CLAUDE.md` literal in any `src/core/` file (grep verification)
- [ ] No `@supabase` import in any `src/core/` file except `seed.ts`/`nuke.ts` (grep verification)
- [ ] StageTimeline and PipelineStatusBadge render all status states correctly
- [ ] Provider settings page has no vendor-specific placeholder text
- [ ] `npm run build` succeeds (no type errors from constant changes)
- [ ] `npx vitest` — all integration tests pass

---

## What This Does NOT Address (Future Work)

- Journey test that invokes real CLI (separate ticket)
- Cancel button functionality (untested, separate ticket)
- Gate evaluation UI (GateResultsPanel untested, separate ticket)
- Harness catalog management UI page (R-UI roadmap item)
- Cost parsing from harness output
- Multi-stage pipeline progression (only single-stage manual runs for now)
