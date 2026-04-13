# R5-V Design Spec: Manual Stage Execution with Full Materialization

**Date:** 2026-04-12
**Status:** Draft — awaiting approval
**Author:** Joe Pierce + Claude

---

## Goal

"Run Stage" button on issue detail → orchestrator checks issue state → maps state to pipeline stage → resolves skill + harness from DB → materializes skill to disk → spawns harness subprocess → streams output via Supabase Realtime → PAT-style modal shows live transcript → gate engine evaluates result → verdict determines next action (all from DB config, nothing hardcoded).

---

## Principles

1. **Everything from DB.** Every decision the orchestrator makes is driven by database state. No hardcoded stage names, skill names, harness names, state mappings, or behavior.
2. **Harness is read-only.** The harness (subprocess) reads the materialized workspace and writes to stdout/stderr. The orchestrator is the sole writer to the database.
3. **No fallbacks.** Supabase Realtime is the streaming mechanism. If it doesn't work, that's a bug to fix, not a scenario to code around. One path, always.
4. **Full audit trail.** Every orchestrator action writes to the event store and/or issue event log. Every state change is recorded with full context.
5. **Restart unless stopped.** On crash recovery, the orchestrator re-launches failed stages within the DB-configured retry budget — unless a human explicitly cancelled them.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  Browser — RunDetailModal                           │
│  LiveOutput, StageTimeline, GateResultsPanel        │
│  Subscribes to: Supabase Realtime (event table)     │
└──────────────────┬──────────────────────────────────┘
                   │ Supabase Realtime
┌──────────────────┴──────────────────────────────────┐
│  Orchestrator (systemd service, Node.js, no LLM)    │
│  Event-driven: subscribes to Realtime on stage_run  │
│  Reads: issue state, pipeline stage, skill,         │
│         harness catalog, routing rules, gate rules  │
│  Writes: pipeline_run, stage_run, event,            │
│          issue_event, stage_gate_result, issue       │
└──────┬──────────────────────────────────────────────┘
       │ spawns subprocess
┌──────┴──────────────────────────────────────────────┐
│  Harness (e.g. claude CLI)                          │
│  Reads: materialized workspace (skills, persona)    │
│  Writes: stdout/stderr only                         │
└─────────────────────────────────────────────────────┘
```

---

## New Schema

### harness_catalog

Matches PAT's `v2_tools` model field-for-field.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid | PK |
| `name` | text | Display name ("Claude Code") |
| `slug` | text | Lookup key ("claude-code") |
| `binary` | text | CLI path ("claude") |
| `modelFlag` | text | Flag for model selection ("--model") |
| `dirFlag` | text | Flag for working directory ("--add-dir") |
| `sessionNameFlag` | text | Flag for session naming ("--session") |
| `promptTransport` | text | How prompt is passed: "argv", "stdin", "flag" |
| `promptFlag` | text | Flag name if promptTransport is "flag" ("--prompt") |
| `issuePromptTemplate` | text | Template for structured issues |
| `queuePromptTemplate` | text | Template for quick tasks |
| `defaultArgs` | jsonb | Always-included CLI args (array of strings) |
| `envVars` | jsonb | Environment variables to set (key-value object) |
| `version` | int | Optimistic concurrency |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

### pipeline_stage changes

| Column | Change | Purpose |
|--------|--------|---------|
| `skillId` | Add (FK → `skill`) | Which skill to execute at this stage |
| `harnessId` | Add (FK → `harness_catalog`) | Which harness to use (replaces text `harness` field) |
| `harness` | Remove | Replaced by `harnessId` FK |

### stage_run changes

| Column | Change | Purpose |
|--------|--------|---------|
| `attempt` | Add (int, default 1) | Which attempt this is (for retry tracking) |
| `pid` | Add (int, nullable) | OS process ID for orphan detection on crash recovery |
| `exitCode` | Add (int, nullable) | Process exit code |
| `skillId` | Add (FK → `skill`, nullable) | Snapshot of which skill was used (audit) |
| `harnessId` | Add (FK → `harness_catalog`, nullable) | Snapshot of which harness was used (audit) |

Note: The existing text fields `provider`, `model`, and `harness` on `stage_run` are kept as denormalized snapshots of what was actually used at execution time (the resolved values). The new FK fields (`skillId`, `harnessId`) point to the catalog entries for traceability. Both are written by the orchestrator at stage start.

### skill table

The `skill` table already exists. Verify it has these fields (add if missing):

| Column | Required | Purpose |
|--------|----------|---------|
| `promptTemplate` | Yes | The full skill instructions/content — materialized to disk at execution time |
| `inputSchema` | Optional | Expected input shape |
| `outputSchema` | Optional | Expected output shape |

---

## Execution Flow

Every step reads from DB. Every action writes to DB.

```
 1. Human clicks "Run Stage" on issue detail
 2. tRPC mutation creates pipeline_run (status: pending)
 3. Orchestrator receives Realtime event for new pipeline_run
 4. Orchestrator reads issue state from issue table
 5. Orchestrator reads pipeline_stage matching current state
 6. Orchestrator reads skillId from pipeline_stage → fetches skill from skill table
 7. Orchestrator reads harnessId from pipeline_stage → fetches harness from harness_catalog
 8. Orchestrator resolves routing (provider, model) from routing_rule/routing_profile
 9. Orchestrator creates stage_run (status: queued, attempt: 1)
10. Materializer writes skill + persona to temp workspace directory
11. Command builder assembles CLI command from harness_catalog entry
12. Orchestrator updates stage_run (status: running, startedAt, pid, provider, model)
13. Orchestrator inserts event (STAGE_STARTED) + issue_event ("Stage X started")
14. SubprocessExecutor spawns harness process
15. Orchestrator captures stdout/stderr → inserts event rows (OUTPUT, TOOL_CALL, etc.)
16. Supabase Realtime pushes event rows to frontend LiveOutput
17. Process exits
18. Orchestrator updates stage_run (status: completed/failed, completedAt, exitCode, cost)
19. Orchestrator inserts event (STAGE_COMPLETED or ERROR)
20. Gate engine evaluates result against gateMode + gateRules from pipeline_stage
21. Orchestrator inserts stage_gate_result (verdict, rule snapshot, results)
22. Orchestrator inserts event (GATE_EVALUATED)
23. Gate verdict determines next action (all from DB config):
    - proceed → orchestrator reads next pipeline_stage by sort_order, go to step 5
    - hold → orchestrator updates stage_run (status: pending), waits for human release
    - rework → orchestrator creates new stage_run (attempt + 1, within maxRetries budget)
    - abort → orchestrator updates pipeline_run (status: failed, completedAt)
24. When all stages complete → orchestrator updates pipeline_run (status: completed)
25. Orchestrator transitions issue state via issue_transition rules from DB
26. Orchestrator inserts issue_event ("Pipeline run completed/failed")
27. Materializer cleans up temp workspace
```

---

## Crash Recovery

The orchestrator follows **restart-unless-stopped** semantics (like Docker's `unless-stopped` restart policy).

### On systemd restart:

1. Orchestrator queries DB for stage_run rows with status `running`
2. For each stale running stage:
   a. Check if subprocess is still alive by `pid` on stage_run
   b. If process is dead:
      - Check `attempt` against `maxRetries` on pipeline_stage
      - If within retry budget → create new stage_run (attempt + 1), re-execute
      - If retry budget exhausted → mark stage_run as `failed`, insert ERROR event
   c. If process is alive → re-attach to stdout/stderr, resume capturing output
3. Stage runs with status `cancelled` are **never** re-launched — the human explicitly stopped them

### Guardrails:

- `maxRetries` on `pipeline_stage` (default 0 = no retries) — prevents crash loops
- `attempt` on `stage_run` — tracks how many times this stage has been tried
- A crashing stage that exhausts its retry budget fails permanently with full error context
- The human must explicitly re-trigger to try again

---

## Skill Materialization

### Service: `src/core/skills/materializer.ts`

At execution time, the materializer creates an isolated workspace for the harness:

1. Read skill from DB by `skillId` on the pipeline stage
2. Read persona from DB (soul, identity, brand) by `personaId` on the pipeline stage
3. Create temp workspace directory (e.g. `/tmp/fluxaos-runs/{stageRunId}/`)
4. Write persona prompt → `CLAUDE.md` (or harness-equivalent config file)
5. Write skill content → `skills/{skillName}/SKILL.md` from `skill.promptTemplate`
6. Write project context as needed (issue title, description, state, metadata)
7. Return workspace path
8. After execution completes → remove temp workspace directory

### What gets materialized:

| File | Source | Purpose |
|------|--------|---------|
| `CLAUDE.md` | `persona.soul` + `persona.identity` + `brand` | Persona instructions for the harness |
| `skills/{name}/SKILL.md` | `skill.promptTemplate` | Skill instructions |
| `context.md` | Issue fields (title, description, number, state, labels) | Work context |

The harness reads these files as it normally would — it doesn't know or care that they came from a database.

---

## Command Builder

### Service: `src/core/orchestrator/command-builder.ts`

Reads a `harness_catalog` entry and builds the full CLI command. No hardcoded flags, paths, or arguments.

### Build algorithm:

1. Start with `binary` from harness_catalog (e.g. `claude`)
2. Append `defaultArgs` (e.g. `["--dangerously-skip-permissions"]`)
3. Append `modelFlag` + resolved model (e.g. `--model claude-sonnet-4-20250514`)
4. Append `dirFlag` + materialized workspace path (e.g. `--add-dir /tmp/fluxaos-runs/{id}`)
5. Set `envVars` in subprocess environment
6. Handle prompt based on `promptTransport`:
   - `argv` → prompt is positional argument after `--` separator
   - `stdin` → prompt piped to subprocess stdin
   - `flag` → `promptFlag` + prompt text (e.g. `--prompt "..."`)
7. Render `issuePromptTemplate` with issue context (title, description, number, state)

### Template variables:

Templates use `{{variable}}` syntax. Available variables:

| Variable | Source |
|----------|--------|
| `{{issue_number}}` | issue.number |
| `{{issue_title}}` | issue.title |
| `{{issue_description}}` | issue.bodyMarkdown |
| `{{issue_state}}` | issue.state (from catalog) |
| `{{issue_priority}}` | issue.priority (from catalog) |
| `{{issue_type}}` | issue.type (from catalog) |
| `{{skill_name}}` | skill.name |
| `{{workspace_path}}` | materialized workspace directory |
| `{{project_name}}` | project.name |

---

## Orchestrator Event-Driven Model

### Trigger mechanism:

The orchestrator is a systemd-managed Node.js process that subscribes to Supabase Realtime. No polling. No LLM tokens.

| Realtime subscription | Trigger |
|----------------------|---------|
| `pipeline_run` status changes | New run created → start execution |
| `stage_run` status changes | Stage completed/failed → evaluate gate, advance/retry |
| `stage_run` status = `cancelled` | Human stopped it → stand down, do not re-launch |

### State machine:

The orchestrator is a pure state machine. Given current DB state, it deterministically decides the next action. No AI reasoning, no token usage, no ambiguity.

```
pipeline_run created (pending)
  → read first stage → create stage_run (queued)

stage_run queued
  → materialize → build command → spawn → update (running)

stage_run completed
  → evaluate gate → verdict determines next state

stage_run failed
  → check retry budget → retry or fail permanently

stage_run cancelled
  → do nothing (restart-unless-stopped)

all stages completed
  → update pipeline_run (completed) → transition issue state
```

### Future: Auto mode controls (not in R5-V scope)

When the orchestrator runs in auto mode, it will support four controls:
- **start** — begin watching for work (subscribe to Realtime)
- **stop** — stop immediately, orphan recovery on restart
- **drain** — stop accepting new work, let in-flight stages finish
- **restart** — stop + start

The current event-driven design is compatible with all four: start = subscribe, stop = unsubscribe, drain = flag to skip new queues, restart = unsubscribe + resubscribe. Nothing to build now, but the architecture supports it.

---

## Orchestrator Audit Trail

Every orchestrator action writes to the DB. The harness never writes to the DB.

### Event store writes (append-only `event` table):

| Event Type | When | Payload |
|------------|------|---------|
| `STAGE_STARTED` | Stage execution begins | Routing snapshot (provider, model, harness, skill, attempt) |
| `OUTPUT` | Each line of stdout/stderr | `{ lineNumber, content, kind }` where kind is text/tool_call/tool_result/result/system/raw |
| `TOOL_CALL` | Parsed tool invocation | `{ toolName, command, args }` |
| `COST_UPDATE` | Incremental cost data parsed from output | `{ costUsd, tokensIn, tokensOut }` |
| `STAGE_COMPLETED` | Stage finished | `{ exitCode, costUsd, tokensIn, tokensOut, duration }` |
| `ERROR` | Stage failed or crashed | `{ message, exitCode, attempt, retriesRemaining }` |
| `GATE_EVALUATED` | Gate rules checked | `{ verdict, passed, ruleResults, reason }` |

### Issue event writes (`issue_event` table):

| Event | When | Payload |
|-------|------|---------|
| Stage started | Orchestrator launches stage | `{ stageRunId, stageName, skillName, harness, attempt }` |
| Stage completed | Stage finishes | `{ stageRunId, stageName, exitCode, costUsd, verdict }` |
| Stage failed | Stage errors/crashes | `{ stageRunId, stageName, error, attempt, retriesRemaining }` |
| Stage cancelled | Human cancelled | `{ stageRunId, stageName, cancelledBy }` |
| Gate hold | Gate requires human decision | `{ stageRunId, stageName, verdict, reason }` |
| Pipeline completed | All stages done | `{ pipelineRunId, totalCostUsd, duration }` |
| Pipeline failed | Run aborted/failed permanently | `{ pipelineRunId, reason, failedStage }` |
| State transition | Issue state changed by orchestrator | `{ fromState, toState, triggeredBy: "orchestrator" }` |

### DB state writes:

| Table | Fields updated | When |
|-------|---------------|------|
| `pipeline_run` | status, startedAt, completedAt, totalCostUsd | Run lifecycle |
| `stage_run` | status, startedAt, completedAt, pid, exitCode, costUsd, tokensIn, tokensOut, attempt | Stage lifecycle |
| `stage_gate_result` | verdict, passed, worstAction, ruleSnapshot, ruleResults, reason | Gate evaluation |
| `issue` | stateId, updatedAt | State transition on stage completion |

---

## UI Components

### RunDetailModal (`src/components/pipeline/RunDetailModal.tsx`)

Matches PAT's `RunDetailModal` layout:

**Header:**
- `#{issue_number} — {issue_title}`
- StatusBadge (Running/Queued/Completed/Failed/Cancelled/Pending)
- Cancel Run button
- Close button

**Left sidebar (w-72):**
- Run Info section:
  - Project name
  - Trigger (manual / auto)
  - Priority (from issue)
  - Entry stage
  - Started timestamp
  - Duration (live-updating while running)
- StageTimeline:
  - Vertical list of stage buttons
  - Status dot per stage (colored, animated pulse for running)
  - Stage name + attempt label (e.g. "implement (attempt 2)")
  - Duration per stage
  - Click → selects stage → updates right panel
  - Selected state: ring highlight

**Right panel (flex-1):**
- Stage header:
  - Stage name
  - Attempt number
  - Model name
  - Route source badge
  - Duration
  - Exit code
  - Cancel Stage button (if running)
- Result summary box (if completed) / Error summary box (if failed)
- Tab bar: Output | Gates
- Tab content area

### LiveOutput (`src/components/pipeline/LiveOutput.tsx`)

**Toolbar:**
- Line count
- Verbose toggle (show/hide system entries)
- Raw JSON toggle (raw vs parsed mode)
- Auto-scroll toggle
- Copy button

**Output pane (h-96, monospace, dark bg):**

**Raw mode:** Numbered lines of stdout/stderr, no parsing.

**Parsed mode:** Transcript entries from event stream, displayed by kind:

| Kind | Display |
|------|---------|
| `text` | Message icon + text content |
| `tool_call` | Terminal icon + tool name + command preview |
| `tool_result` | Indented with left border, red if `isError` |
| `result` | Zap icon + Done/Failed + cost |
| `system` | Dimmed text, visible only when Verbose is on |
| `raw` | Monospace, no icon (unparsed lines) |

**Streaming:** Subscribes to Supabase Realtime on `event` table filtered by `stage_run_id`. Events render as they arrive. Auto-scroll when viewport is near bottom.

### GateResultsPanel (`src/components/pipeline/GateResultsPanel.tsx`)

- List of gate results for the selected stage
- Each result: VerdictBadge + pass/fail per rule + failure reason
- Reuses existing `VerdictBadge` component from R4-V

### StageTimeline (`src/components/pipeline/StageTimeline.tsx`)

- Vertical list of stages from pipeline config
- Each stage shows: status dot, name, attempt count, duration
- Clickable — selecting a stage updates the right panel
- Status dot colors: green (completed), blue+pulse (running), yellow (pending/hold), red (failed), gray (queued/cancelled)

### StatusBadge (`src/components/pipeline/StatusBadge.tsx`)

- Colored dot + label
- Statuses: Running, Queued, Completed, Failed, Cancelled, Pending
- Optional stage name suffix (e.g. "Running — implement")

---

## Settings UI Changes

Pipeline settings stage form gets two new dropdowns (both pull from DB, no hardcoded options):

| Field | Source | Purpose |
|-------|--------|---------|
| Skill | `skill` table | Which skill this stage executes |
| Harness | `harness_catalog` table | Which harness runs the skill |

These appear alongside the existing gate mode dropdown and rule builder.

---

## Seed Data

### harness_catalog

One entry matching PAT's claude tool configuration:

| Field | Value |
|-------|-------|
| name | Claude Code |
| slug | claude-code |
| binary | claude |
| modelFlag | --model |
| dirFlag | --add-dir |
| sessionNameFlag | --session-name |
| promptTransport | argv |
| promptFlag | null |
| issuePromptTemplate | `{{skill_name}}: {{issue_title}} — {{issue_description}}` |
| queuePromptTemplate | `{{issue_title}}` |
| defaultArgs | `["--dangerously-skip-permissions"]` |
| envVars | `{}` |

### skill

One entry for testing:

| Field | Value |
|-------|-------|
| name | research |
| description | Research a topic and produce findings |
| promptTemplate | `Research the following topic thoroughly. Produce a summary of findings with sources.` |
| scope | project |

### pipeline_stage updates

The seeded "research" stage gets `skillId` → research skill, `harnessId` → claude-code harness.

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `src/core/db/schema.ts` | Schema changes: harness_catalog table, pipeline_stage + stage_run columns |
| `drizzle/migrations/XXXX_*.sql` | Migration for schema changes |
| `src/core/skills/materializer.ts` | Materialize skill + persona to temp workspace |
| `src/core/orchestrator/command-builder.ts` | Build CLI command from harness_catalog entry |
| `src/core/orchestrator/event-orchestrator.ts` | Event-driven orchestrator (Realtime subscriptions, state machine) |
| `src/core/orchestrator/output-parser.ts` | Parse harness stdout into typed transcript entries |
| `src/components/pipeline/RunDetailModal.tsx` | PAT-style execution modal |
| `src/components/pipeline/LiveOutput.tsx` | Live transcript with raw/parsed modes |
| `src/components/pipeline/GateResultsPanel.tsx` | Gate results display per stage |
| `src/components/pipeline/StageTimeline.tsx` | Clickable vertical stage list |
| `src/components/pipeline/StatusBadge.tsx` | Pipeline/stage status badge |
| `src/server/routers/harness.ts` | tRPC router for harness_catalog CRUD |

### Modified Files (EDIT ONLY)

| File | Changes |
|------|---------|
| `src/core/db/schema.ts` | Add harness_catalog table, skillId/harnessId on pipeline_stage, attempt/pid/exitCode on stage_run |
| `src/core/db/seed.ts` | Seed harness_catalog entry, skill entry, update pipeline_stage FKs |
| `src/server/routers/pipeline.ts` | Wire orchestrator trigger, add harness/skill to stage queries |
| `src/app/.../settings/page.tsx` | Add skill + harness dropdowns to stage form |
| `src/app/.../issues/[number]/client.tsx` | Open RunDetailModal on "Run Stage" click |
| `src/app/.../pipelines/[id]/page.tsx` | Use RunDetailModal for run detail view |
| `src/server/root.ts` | Register harness router |

---

## Exit Criteria

User verification in browser:

1. Open Settings → Pipeline → see skill and harness dropdowns populated from DB
2. Assign a skill and harness to a stage, save
3. Open an issue → click "Run Stage"
4. RunDetailModal opens with PAT-style layout
5. StageTimeline shows stages with status dots
6. LiveOutput streams transcript entries in real-time via Supabase Realtime
7. Toggle between raw and parsed output modes
8. Stage completes → gate evaluates → verdict displayed in Gates tab
9. Gate verdict auto-advances (proceed) or holds (hold) per DB config
10. Cancel a running stage → orchestrator respects cancellation, does not re-launch
11. All events visible in issue activity feed
12. Kill the systemd service mid-execution → restart → orchestrator recovers correctly based on retry budget
