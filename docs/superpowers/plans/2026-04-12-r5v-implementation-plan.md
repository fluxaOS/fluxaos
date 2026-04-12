# R5-V Implementation Plan: Manual Stage Execution with PAT-Parity UI

**Date:** 2026-04-12
**Status:** Draft — awaiting approval
**Execution:** Via `/implement → /review (Codex) → /rework → /deploy` skill chain

---

## Goal

"Run Stage" button on issue detail → stage executes → live output in PAT-style modal → human sees result and decides next action. No orchestrator daemon. No queue. Direct execution, manual advancement.

The UI must match PAT's `RunDetailModal` + `LiveOutput` + `StageTimeline` pattern. Not a simplified version — the same layout, same data, same interactions.

---

## What PAT Has (exact reference)

### RunDetailModal layout
- **Header:** `#{issue_number} — {issue_title}` + PipelineStatusBadge + Cancel Run button + Close
- **Left sidebar** (w-72):
  - Run Info section: project, trigger, priority, entry stage, started, duration
  - Stage Timeline: clickable vertical list of stages with status dots, durations
- **Right panel** (flex-1):
  - Stage header: stage name, attempt #, model, route source badge, duration, exit code, Cancel Stage button
  - Result/error summary boxes
  - Tab bar: Output | Gates (+ Agents tab if team_group_id)
  - Tab content area

### LiveOutput (Output tab)
- Toolbar: line count, Verbose toggle, Raw JSON toggle, Auto-scroll toggle, Copy button
- Output pane (h-96, monospace, dark bg):
  - **Raw mode:** numbered lines
  - **Parsed mode:** transcript entries from `stream-json` format:
    - `text` entries: message icon + text
    - `tool_call` entries: terminal icon + tool name + command preview
    - `tool_result` entries: indented with left border, error=red
    - `result` entries: zap icon + Done/Failed + cost
    - `system` entries: dimmed (verbose only)
- Streaming: SSE → fallback to polling. Auto-scroll when near bottom.

### GateResultsPanel (Gates tab)
- List of gate results: gate_id + pass/fail dot + failure_reason

### StageTimeline
- Vertical list of stage buttons
- Status dot (colored + animated), stage name, attempt label, duration
- Selected state: ring highlight
- Click → selects stage → updates right panel

### PipelineStatusBadge
- Colored dot + label (Running/Queued/Completed/Failed/Cancelled/Pending)
- Optional stage name suffix

---

## What fluxaOS Has (current state after revert)

- Issue detail (`client.tsx`): "Run Stage" button calls `pipeline.runs.trigger` / `pipeline.runs.executeStage` — just flips DB status, no actual execution
- Pipeline run detail (`pipelines/[id]/page.tsx`): StageRunCard with status, gate approval buttons, raw event list
- No output modal, no live streaming, no transcript parsing
- No harness table — harness is a string on routing rule
- No direct execution path — everything goes through orchestrator heartbeat

---

## Implementation Phases

### Phase A: Harness Table + Direct Executor (backend)

**Files to create:**
| File | Purpose | Lines |
|------|---------|-------|
| `src/core/db/schema.ts` | Add `harness` table matching PAT `v2_tools` | ~20 lines added |
| `src/core/orchestrator/direct-executor.ts` | Execute a stage directly: resolve routing → look up harness from DB → build command (PAT algorithm) → spawn subprocess → stream output to events | ~200 |

**Files to edit:**
| File | Change |
|------|--------|
| `src/core/db/seed.ts` | Add harness import + claude-code seed (PAT's exact default_args) |
| `src/core/orchestrator/types.ts` | Add `output_line` to StageEventType |
| `src/server/routers/pipeline.ts` | Add `runs.executeDirect` mutation, improve `runs.events` with afterTimestamp filter |

**Harness table fields (matching PAT v2_tools):**
- `id`, `orgId`, `name`, `binary`, `defaultArgs` (jsonb)
- `modelFlag`, `dirFlag`, `sessionNameFlag`
- `promptTransport` (argv/tmux_send_keys), `promptSendDelayMs`
- `issuePromptTemplate`, `queuePromptTemplate`
- `envVars` (jsonb), `extraArgs` (jsonb)
- `isEnabled`, `notes`, `createdAt`, `updatedAt`

**Claude-code seed (PAT exact):**
```
binary: "claude"
defaultArgs: ["--print", "--verbose", "--output-format", "stream-json",
              "--permission-mode", "bypassPermissions", "--dangerously-skip-permissions"]
modelFlag: "--model"
dirFlag: "--add-dir"
issuePromptTemplate: "/{skill_id} {issue_number}"
queuePromptTemplate: "/{skill_id} --next"
promptTransport: "argv"
```

**Command build algorithm (PAT exact):**
1. `cmd = [binary]`
2. `cmd.extend(defaultArgs)`
3. `cmd.push(modelFlag, modelIdentifier)` if model resolved
4. `cmd.push(sessionNameFlag, sessionName)` if both set
5. `cmd.push(dirFlag, dir)` for each add_dir
6. `cmd.push('--')` separator
7. `cmd.push(renderedPrompt)` — from `issuePromptTemplate.replace('{skill_id}', stageName).replace('{issue_number}', issueNumber)`

**executeDirect mutation:**
- Input: `{ stageRunId? }` or `{ pipelineId, issueId }`
- Creates run + stage run if needed
- Fires `executeStageDirectly()` in background (no await)
- Returns `{ stageRunId, pipelineRunId }` immediately
- All errors write events to DB (never throw silently)

### Phase B: RunDetailModal (PAT-parity UI)

**Files to create:**
| File | Purpose | Lines |
|------|---------|-------|
| `src/components/run-detail-modal.tsx` | Main modal — header, left sidebar (run info + stage timeline), right panel (stage detail + tabs) | ~250 |
| `src/components/live-output.tsx` | Output tab — toolbar, parsed transcript view, raw JSON view, auto-scroll | ~250 |
| `src/components/stage-timeline.tsx` | Clickable stage list with status dots, durations | ~100 |
| `src/components/pipeline-status-badge.tsx` | Status dot + label badge | ~40 |

**Files to edit:**
| File | Change |
|------|--------|
| `src/app/[org]/[user]/[project]/issues/[number]/client.tsx` | Wire "Run Stage" → executeDirect → open RunDetailModal |
| `src/app/[org]/[user]/[project]/pipelines/[id]/page.tsx` | Add "View Output" on StageRunCards → open RunDetailModal |

**RunDetailModal layout (PAT exact):**
- Fixed backdrop with blur, dismissible
- Modal: full-screen mobile, max-5xl desktop, rounded-2xl
- Header: `#{issue_number} — {issue_title}` + StatusBadge + Cancel + Close
- Left column (w-72): Run Info (MetaRows) + Stage Timeline
- Right column: Stage header + Result/Error + Tabs (Output | Gates) + Tab content
- Polls `pipeline.runs.get` every 2-3s while active
- Stage selection updates right panel

**LiveOutput (PAT exact):**
- Toolbar: line/entry count, Verbose toggle, Raw JSON toggle, Auto-scroll toggle, Copy
- Output pane: monospace, dark bg, h-96
- Parses `stream-json` format from claude output into transcript entries:
  - `type: "assistant"` → text entries + tool_use entries
  - `type: "user"` → tool_result entries
  - `type: "result"` → final result with cost
  - `type: "system"` → system events (verbose only)
- Deduplicates by message ID
- Polls events endpoint at 1s interval
- Auto-scroll when within 50px of bottom

**StageTimeline (PAT exact):**
- Vertical list, space-y-1
- Each row: status dot + icon + stage name + attempt + duration
- Color by status (completed=green, running=blue+pulse, failed=red, pending=purple)
- Selected: ring-1 highlight
- Click → setSelectedStageRunId → update tabs

### Phase C: Gate Integration

After stage completes, show gate verdict in the modal:
- Gates tab: list of gate results (pass/fail dots + gate_id + failure_reason)
- Gate approval buttons in stage header when status=pending (Approve / Rework / Abort)
- Uses existing `pipeline.runs.approveStage` / `pipeline.runs.rejectStage` mutations

---

## Execution Order

```
Phase A (backend) → Phase B (modal UI) → Phase C (gates in modal)
```

Each phase goes through: `/implement → /review (Codex) → /rework → /deploy`

---

## Acceptance Criteria

1. User clicks "Run Stage" on issue detail → modal opens
2. Modal shows left sidebar with run info + stage timeline
3. Subprocess actually executes (claude binary from harness DB config)
4. Output tab shows parsed transcript (text, tool calls, results) — not raw events
5. Verbose/Raw JSON/Auto-scroll toggles work
6. Stage timeline is clickable, updates right panel
7. Cancel Run / Cancel Stage buttons work
8. Gates tab shows gate results after stage completes
9. Gate approval buttons (Approve/Rework/Abort) work when stage is pending
10. All existing UI elements from the UI inventory remain intact
11. Command built entirely from DB config — zero hardcoded binaries or flags

---

## What This Does NOT Include

- Agent conversation tab (requires team_group_id infrastructure — future)
- SSE streaming (polling sufficient for v1, SSE is optimization)
- Tmux session management (direct subprocess, not tmux)
- User intervention (requires tmux send-keys — future)
- Automatic stage advancement (manual only per R5-V spec)

---

## Files Touched (complete list)

**Create (6):**
- `src/core/orchestrator/direct-executor.ts`
- `src/components/run-detail-modal.tsx`
- `src/components/live-output.tsx`
- `src/components/stage-timeline.tsx`
- `src/components/pipeline-status-badge.tsx`
- (migration SQL if needed)

**Edit (5):**
- `src/core/db/schema.ts` — add harness table
- `src/core/db/seed.ts` — add harness seed
- `src/core/orchestrator/types.ts` — add output_line event type
- `src/server/routers/pipeline.ts` — add executeDirect, improve events query
- `src/app/[org]/[user]/[project]/issues/[number]/client.tsx` — wire Run Stage → modal
- `src/app/[org]/[user]/[project]/pipelines/[id]/page.tsx` — wire View Output → modal
