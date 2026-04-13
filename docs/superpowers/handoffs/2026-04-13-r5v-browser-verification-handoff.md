# R5-V Browser Verification Session Handoff

**Date:** 2026-04-13
**Branch:** `phase/r5v-manual-execution`
**PR:** #19 (not yet merged — blocked on open issues found during verification)
**Status:** Manual execution works end-to-end but has architectural issues to resolve before merge.

---

## What This Session Did

Browser verification of R5-V (Manual Stage Execution) against the 10-point checklist from the previous handoff. Found and fixed multiple issues that prevented the feature from working. Identified two remaining architectural issues that need resolution.

---

## Bugs Found and Fixed

### 1. Seed FK Bug — harness/skill never linked to pipeline stages
**Root cause:** `existingStages` was queried before stage INSERT, then the stale (empty) array was used in the FK update check — so on fresh nuke+seed, harness/skill FKs were never set.
**Fix:** Re-query stages after insert (`allStages`), use that for FK updates.
**File:** `src/core/db/seed.ts`

### 2. Wrong CLI flag: `--session-name` → `--name`
**Root cause:** Seed had `sessionNameFlag: '--session-name'` but Claude Code CLI uses `--name` / `-n`.
**Fix:** Updated seed to `--name`.
**File:** `src/core/db/seed.ts`

### 3. Missing `--print` flag
**Root cause:** `defaultArgs` only had `['--dangerously-skip-permissions']`. Without `--print`, Claude opens interactive mode which hangs the subprocess.
**Fix:** Added `--print` to `defaultArgs`.
**File:** `src/core/db/seed.ts`

### 4. `triggerRun` only created `pipeline_run`, no `stage_run`
**Root cause:** The trigger mutation called `createRun()` which only inserts a `pipeline_run` row. It relied on the orchestrator daemon to create `stage_run` rows, but the daemon isn't running during manual execution.
**Fix:** Created `src/core/orchestrator/manual-run.ts` — a standalone executor that creates DB rows AND spawns the subprocess. Trigger mutation now fires execution async (fire-and-forget).
**Files:** `src/core/orchestrator/manual-run.ts` (new), `src/server/routers/pipeline.ts`

### 5. Trigger mutation missing `stageId` parameter
**Root cause:** Frontend knew which stage to run (`matchingStage`) but the mutation only accepted `pipelineId` + `issueId`. Backend had no idea which stage to create.
**Fix:** Added `stageId` to trigger input. Client passes `matchingStage.id`.
**Files:** `src/server/routers/pipeline.ts`, `src/app/.../issues/[number]/client.tsx`

### 6. Pipelines page broken — stale `triggerRun` call
**Root cause:** Pipelines page had a "Start Run" button calling trigger without `stageId` or valid `issueId`.
**Fix:** Removed the button — runs are triggered from issue detail with a specific stage context.
**File:** `src/app/.../pipelines/page.tsx`

### 7. Subprocess waiting for stdin
**Root cause:** `execa` defaults stdin to `pipe`, so Claude waited 3s for stdin before proceeding.
**Fix:** Set `stdin: 'ignore'` in SubprocessExecutor.
**File:** `src/adapters/subprocess/executor.ts`

### 8. Subprocess running in wrong directory
**Root cause:** `cwd` was set to the materializer's temp workspace (`/tmp/fluxaos-runs/...`). Claude listed workspace files instead of working on the project.
**Fix:** Changed `cwd` to `process.cwd()` (project root). Workspace is accessed via `--add-dir`.
**File:** `src/core/orchestrator/manual-run.ts`

### 9. `CLAUDE_CODE_SIMPLE=1` env var broke auth
**Root cause:** Setting this env var is equivalent to `--bare` mode, which skips keychain/OAuth reads. Claude couldn't authenticate.
**Fix:** Removed the env var.
**File:** `src/core/orchestrator/manual-run.ts`

### 10. Copy button broken on HTTP
**Root cause:** `navigator.clipboard.writeText()` requires HTTPS. Dev server runs on HTTP.
**Fix:** Added `execCommand('copy')` fallback for non-HTTPS contexts.
**File:** `src/components/pipeline/LiveOutput.tsx`

---

## Current State of the System

### What Works End-to-End
The manual execution pipeline is functional: click "Run Stage" on an issue → `pipeline_run` + `stage_run` created → `claude --print` spawned as a subprocess → stdout streamed to `event` table → LiveOutput component renders transcript in real-time via Supabase Realtime → stage completes with exit code recorded. One successful run completed (exit 0, research stage, ~12s duration).

### Database State After Verification
- **1 harness** seeded: Claude Code (`--print --dangerously-skip-permissions`, `--name` for sessions, `--add-dir` for workspace, `--model` for model selection)
- **1 skill** seeded: `research` with prompt template "Research the following topic thoroughly..."
- **4 pipeline stages**: research (skill+harness), implement (harness only), review (harness only), deploy (harness only) — all stages have `harnessId` set after FK fix
- **1 completed pipeline run** with 1 completed stage run (exit 0)

### Execution Architecture
Manual runs bypass the orchestrator daemon entirely. The flow:
1. tRPC `trigger` mutation creates `pipeline_run` (running) + `stage_run` (launching)
2. Same mutation fires `executeManualRun()` async (fire-and-forget — HTTP response returns immediately)
3. `manual-run.ts` (340 lines) reads stage/harness/skill/issue from DB, calls materializer, builds CLI command, spawns subprocess via `SubprocessExecutor`
4. Subprocess `onStdout`/`onStderr` callbacks write `OUTPUT` events to DB
5. On completion: stage_run updated with exit code, pipeline_run marked completed/failed
6. Frontend: `LiveOutput` subscribes to Supabase Realtime INSERT on `event` table, triggers tRPC refetch on each event

### What the Subprocess Actually Runs
```
claude --print --dangerously-skip-permissions \
  --name fluxaos-{stageRunId} \
  --add-dir /tmp/fluxaos-runs/{stageRunId}/ \
  -- "research: {issue_title} — {issue_description}"
```
- `cwd` = project root (`/mnt/dev/fluxaos/`)
- `stdin` = `/dev/null` (ignored)
- Workspace at `--add-dir` path contains: `CLAUDE.md` (skill instructions), `context.md` (issue metadata)
- No model flag passed (routing resolver returns null — no provider/model configured)

### UI Component Status
| Component | State | Notes |
|-----------|-------|-------|
| RunDetailModal | Working | Opens from issue detail, shows header + status badge + UUID |
| PipelineStatusBadge | Working | Shows colored dot + status label (queued → running → completed/failed) |
| StageTimeline | Working | Shows single stage with status dot, clickable |
| LiveOutput | Working | Real-time streaming, raw/parsed toggle, verbose toggle, auto-scroll |
| Copy button | Fixed | Falls back to `execCommand` on HTTP |
| GateResultsPanel | Untested | No gate evaluation has run yet |
| Cancel buttons | Untested | Cancel Run and Cancel Stage both present in UI |
| Settings dropdowns | Working | Skill + harness `<select>` populated from DB in stage creation form |

### What's Broken or Incomplete
1. **Skill content not reaching Claude properly** — CLAUDE.md is written to workspace and `--add-dir` points there, but the current approach is vendor-locked (writes `CLAUDE.md` specifically for Claude Code). The prompt itself (`"research: title — description"`) is thin. Claude completed the run but only listed directory contents rather than performing meaningful research.
2. **No model configured** — routing resolver returns null, so `--model` flag is omitted. Claude uses its default model.
3. **stage_run.harness column not set** — the completed run shows `harness: null` because `manual-run.ts` doesn't set harness/provider/model on the stage_run row at creation time (only the orchestrator's `launchStage` does).
4. **No gate evaluation triggered** — the manual-run completes the stage and pipeline but doesn't evaluate gates. The orchestrator has gate logic but manual-run skips it.
5. **No issue event for completion** — manual-run writes `stage_completed`/`stage_failed` issue events but doesn't write `pipeline_completed`/`pipeline_failed`.

---

## Remaining Issues (Blocking Merge)

### Issue A: Skill/persona injection is vendor-locked to Claude Code
**Problem:** The materializer writes `CLAUDE.md` to inject skill instructions, which is Claude Code-specific. The design spec says the engine must be harness-agnostic.
**Proposed fix:** Add `contextTransport` field to `harness_catalog` that defines how each harness receives context (e.g., `system-prompt-file` for Claude, env vars for others). The command builder would handle injection, not the materializer. The materializer should only produce raw content files.
**Impact:** Architectural — affects materializer, command builder, harness_catalog schema.

### Issue B: No end-to-end journey test
**Problem:** All 93 integration tests pass, but none actually invoke `claude --print`. Every bug found in this session would have been caught by a single journey test that triggers a run and checks the output.
**Proposed fix:** Add a journey test that seeds data, triggers a manual run, and verifies the stage completes with exit 0 and events are recorded.

---

## Files Changed This Session

### New Files
| File | Purpose |
|------|---------|
| `src/core/orchestrator/manual-run.ts` | Standalone single-stage executor — no daemon dependency |

### Modified Files
| File | Changes |
|------|---------|
| `src/server/routers/pipeline.ts` | Trigger mutation: added `stageId`, fire-and-forget execution via manual-run |
| `src/app/.../issues/[number]/client.tsx` | Pass `matchingStage.id` to trigger mutation |
| `src/app/.../pipelines/page.tsx` | Removed stale "Start Run" button |
| `src/core/db/seed.ts` | Fixed FK assignment bug, corrected CLI flags (`--name`, `--print`) |
| `src/core/skills/materializer.ts` | Embed skill instructions in CLAUDE.md (temporary — see Issue A) |
| `src/adapters/subprocess/executor.ts` | `stdin: 'ignore'` |
| `src/components/pipeline/LiveOutput.tsx` | Copy fallback for HTTP |

---

## Verification Checklist Status

| # | Check | Result |
|---|-------|--------|
| 1 | Settings: skill + harness dropdowns populated | Pass (after seed fix) |
| 2 | Assign skill + harness to stage | Pass (seed auto-assigns) |
| 3 | Issue detail: "Run Stage" opens RunDetailModal | Pass |
| 4 | StageTimeline shows stages with status dots | Pass |
| 5 | LiveOutput streams transcript in real-time | Pass |
| 6 | Raw/parsed toggle, auto-scroll, copy | Copy fixed; others pass |
| 7 | Gate evaluation after stage completes | Not tested (needs proper skill execution) |
| 8 | Cancel button | Not tested |
| 9 | Pipeline detail: "View in modal" | Not tested |
| 10 | Activity feed events | Not tested |

---

## What's Next

1. **Resolve Issue A** — make context injection harness-agnostic (add `contextTransport` to harness_catalog)
2. **Resolve Issue B** — add journey test that invokes real CLI
3. **Complete verification checklist** — items 7-10
4. **Merge PR #19** after all issues resolved
5. **R-UI** — mockup reconciliation (includes harness catalog management page)

---

## Key Insight

R5-V was "complete" by structural verification (types, tests, code review) but failed immediately on browser verification. Every bug was a real-world integration issue invisible to static analysis. This validates the project's "no self-certification" principle — human verification against running software is non-negotiable.
