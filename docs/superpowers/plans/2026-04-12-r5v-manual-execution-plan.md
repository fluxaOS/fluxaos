# Phase R5-V: Manual Stage Execution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **CRITICAL:** This phase uses the enforcement skill chain. Run `/implement` first, which creates a restore point, generates phase snapshot, and scopes work to files listed below. After implementation, run `/review` for Codex adversarial review, then `/deploy` for merge + browser verification.
>
> **EDIT ONLY:** Never use Write on existing files. The Write guard hook enforces this for src/app/, src/components/, src/server/. Use Edit for all changes to existing files.

**Goal:** "Run Stage" button on issue detail → orchestrator resolves skill + harness from DB → materializes workspace → spawns harness → streams output via Supabase Realtime → PAT-style modal shows live transcript → gate engine evaluates → verdict from DB config determines next action. Everything from DB, nothing hardcoded, full audit trail.

**Spec:** `docs/superpowers/specs/2026-04-12-r5v-manual-execution-design.md`

**PAT Reference:**
- `RunDetailModal`: `/mnt/dev/pat/frontend/src/components/RunDetailModal.tsx`
- `LiveOutput`: `/mnt/dev/pat/frontend/src/components/LiveOutput.tsx`
- `v2_tools` model: `/mnt/dev/pat/src/pat/core/orchestrator/models/providers.py`
- `StageLauncher`: `/mnt/dev/pat/src/pat/core/orchestrator/stage_launcher.py`
- `RoutingResolver`: `/mnt/dev/pat/src/pat/core/orchestrator/routing_resolver.py`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `drizzle/XXXX_r5v_harness_catalog.sql` | Migration: harness_catalog table, pipeline_stage + stage_run columns |
| `src/core/skills/materializer.ts` | Materialize skill + persona + context to temp workspace |
| `src/core/orchestrator/command-builder.ts` | Build CLI command from harness_catalog entry |
| `src/core/orchestrator/event-orchestrator.ts` | Event-driven orchestrator (Realtime subscriptions, state machine) |
| `src/core/orchestrator/output-parser.ts` | Parse harness stdout into typed transcript entries |
| `src/components/pipeline/RunDetailModal.tsx` | PAT-style execution modal (header, sidebar, right panel, tabs) |
| `src/components/pipeline/LiveOutput.tsx` | Live transcript with raw/parsed modes, Realtime subscription |
| `src/components/pipeline/GateResultsPanel.tsx` | Gate results display per stage |
| `src/components/pipeline/StageTimeline.tsx` | Clickable vertical stage list with status dots |
| `src/components/pipeline/PipelineStatusBadge.tsx` | Pipeline/stage status badge with colored dots |
| `src/server/routers/harness.ts` | tRPC router for harness_catalog CRUD |

### Modified Files (EDIT ONLY)

| File | Changes |
|------|---------|
| `src/core/db/schema.ts` | Add harness_catalog table, skillId/harnessId on pipeline_stage, attempt/pid/exitCode/skillId/harnessId on stage_run |
| `src/core/db/seed.ts` | Seed harness_catalog (claude-code), seed research skill, update pipeline_stage FKs |
| `src/server/routers/pipeline.ts` | Wire orchestrator trigger, include harness/skill in stage queries |
| `src/server/root.ts` | Register harness router |
| `src/app/[org]/[user]/[project]/settings/page.tsx` | Add skill + harness dropdowns to stage form |
| `src/app/[org]/[user]/[project]/issues/[number]/client.tsx` | Open RunDetailModal on "Run Stage" click |
| `src/app/[org]/[user]/[project]/pipelines/[id]/page.tsx` | Use RunDetailModal for run detail view |

---

## Task 1: Schema — harness_catalog Table + Column Additions

**Files:**
- Edit: `src/core/db/schema.ts`
- Create: migration file via `npm run db:generate`

- [ ] **Step 1: Read the current schema**

Read `src/core/db/schema.ts` fully. Identify where pipeline_stage, stage_run, and skill are defined. Understand existing relations.

- [ ] **Step 2: Add harness_catalog table**

Using Edit, add after the `stageGateResult` table definition:

```typescript
export const harnessCatalog = pgTable('harness_catalog', {
  id,
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  binary: text('binary').notNull(),
  modelFlag: text('model_flag'),
  dirFlag: text('dir_flag'),
  sessionNameFlag: text('session_name_flag'),
  promptTransport: text('prompt_transport').notNull().default('argv'),
  promptFlag: text('prompt_flag'),
  issuePromptTemplate: text('issue_prompt_template'),
  queuePromptTemplate: text('queue_prompt_template'),
  defaultArgs: jsonb('default_args').notNull().default(sql`'[]'::jsonb`),
  envVars: jsonb('env_vars').notNull().default(sql`'{}'::jsonb`),
  version: integer('version').notNull().default(1),
  createdAt,
  updatedAt,
});
```

- [ ] **Step 3: Add skillId and harnessId to pipeline_stage**

Using Edit, add to the pipeline_stage table definition:

```typescript
skillId: uuid('skill_id').references(() => skill.id),
harnessId: uuid('harness_id').references(() => harnessCatalog.id),
```

Keep the existing text `harness` field for now — the migration will remove it after data is migrated to the FK.

- [ ] **Step 4: Add attempt, pid, exitCode, skillId, harnessId to stage_run**

Using Edit, add to the stage_run table definition:

```typescript
attempt: integer('attempt').notNull().default(1),
pid: integer('pid'),
exitCode: integer('exit_code'),
skillId: uuid('skill_id').references(() => skill.id),
harnessId: uuid('harness_id').references(() => harnessCatalog.id),
```

- [ ] **Step 5: Add relations for harness_catalog**

Using Edit, add relations:

```typescript
export const harnessCatalogRelations = relations(harnessCatalog, ({ many }) => ({
  pipelineStages: many(pipelineStage),
  stageRuns: many(stageRun),
}));
```

Update `pipelineStageRelations` to include:
```typescript
harnessCatalogEntry: one(harnessCatalog, {
  fields: [pipelineStage.harnessId],
  references: [harnessCatalog.id],
}),
skill: one(skill, {
  fields: [pipelineStage.skillId],
  references: [skill.id],
}),
```

Update `stageRunRelations` to include:
```typescript
harnessCatalogEntry: one(harnessCatalog, {
  fields: [stageRun.harnessId],
  references: [harnessCatalog.id],
}),
skillEntry: one(skill, {
  fields: [stageRun.skillId],
  references: [skill.id],
}),
```

- [ ] **Step 6: Verify skill table has promptTemplate**

Read the skill table definition. If `promptTemplate` (or equivalent content field) is missing, add it:

```typescript
promptTemplate: text('prompt_template'),
```

- [ ] **Step 7: Generate and run migration**

```bash
npm run db:generate
npm run db:migrate
```

- [ ] **Step 8: Type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Fix any type errors using Edit.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: harness_catalog schema + pipeline_stage/stage_run column additions for R5-V"
```

---

## Task 2: Seed Data — Harness Catalog + Research Skill

**Files:**
- Edit: `src/core/db/seed.ts`

- [ ] **Step 1: Read the current seed file**

Read `src/core/db/seed.ts` fully.

- [ ] **Step 2: Add harness_catalog seed**

Using Edit, add after the pipeline stage seeding section:

```typescript
// ── Harness Catalog ─────────────────────────────────────────────
const [claudeHarness] = await db
  .insert(harnessCatalog)
  .values({
    name: 'Claude Code',
    slug: 'claude-code',
    binary: 'claude',
    modelFlag: '--model',
    dirFlag: '--add-dir',
    sessionNameFlag: '--session-name',
    promptTransport: 'argv',
    promptFlag: null,
    issuePromptTemplate: '{{skill_name}}: {{issue_title}} — {{issue_description}}',
    queuePromptTemplate: '{{issue_title}}',
    defaultArgs: ['--dangerously-skip-permissions'],
    envVars: {},
  })
  .onConflictDoNothing()
  .returning();
```

- [ ] **Step 3: Add skill seed**

Using Edit, add skill seeding:

```typescript
// ── Skills ──────────────────────────────────────────────────────
const [researchSkill] = await db
  .insert(skill)
  .values({
    name: 'research',
    description: 'Research a topic and produce findings',
    promptTemplate: 'Research the following topic thoroughly. Produce a summary of findings with sources.',
    scope: 'project',
    projectId: project.id,
  })
  .onConflictDoNothing()
  .returning();
```

- [ ] **Step 4: Update pipeline_stage seeds with FKs**

Using Edit, update the stage definitions to include `skillId` and `harnessId`:

```typescript
{ name: 'research', sortOrder: 1, gateMode: 'auto', gateRules: {},
  skillId: researchSkill?.id, harnessId: claudeHarness?.id },
```

The other stages (implement, review, deploy) get `harnessId` but no `skillId` until those skills are seeded.

- [ ] **Step 5: Nuke and re-seed**

```bash
npx tsx src/core/db/nuke.ts && npm run db:seed
```

Verify no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: seed harness_catalog (claude-code) + research skill with pipeline_stage FKs"
```

---

## Task 3: tRPC Router — Harness Catalog CRUD

**Files:**
- Create: `src/server/routers/harness.ts`
- Edit: `src/server/root.ts`

- [ ] **Step 1: Read existing router patterns**

Read `src/server/routers/pipeline.ts` (first 50 lines) to understand the tRPC router pattern, DI, and Zod validation style.

- [ ] **Step 2: Create harness router**

Create `src/server/routers/harness.ts` with:

- `harness.list` — list all harness catalog entries
- `harness.getBySlug` — get a single harness by slug
- `harness.create` — create a new harness entry (all fields from schema)
- `harness.update` — update a harness entry (optimistic concurrency via version)
- `harness.delete` — delete a harness entry

Follow the existing pattern: Zod input validation, DB queries via Drizzle, optimistic concurrency on mutations.

- [ ] **Step 3: Register harness router**

Using Edit on `src/server/root.ts`, add the harness router to the app router.

- [ ] **Step 4: Type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: tRPC harness catalog router with CRUD operations"
```

---

## Task 4: Command Builder

**Files:**
- Create: `src/core/orchestrator/command-builder.ts`

- [ ] **Step 1: Read PAT's command building**

Read `/mnt/dev/pat/src/pat/core/orchestrator/stage_launcher.py` to understand how PAT builds tool commands. Pay attention to:
- How `binary` + flags are assembled
- How prompt transport works (argv vs stdin vs flag)
- How template variables are rendered
- The `--` separator for argv transport

- [ ] **Step 2: Create the command builder**

Create `src/core/orchestrator/command-builder.ts`:

```typescript
/**
 * Command Builder — assembles CLI commands from harness_catalog entries.
 *
 * Reads a harness catalog entry and builds the full command array.
 * No hardcoded flags, paths, or arguments. Everything from the DB record.
 *
 * Zero vendor imports. Zero domain concepts beyond "harness config → command."
 */
```

Implement:
- `buildCommand(harness, options)` → returns `{ binary, args, env, stdin? }`
  - `options`: `{ model, workspacePath, prompt }`
  - Assembles: binary + defaultArgs + modelFlag + dirFlag + prompt (by transport)
- `renderTemplate(template, variables)` → string with `{{var}}` replacement
  - Variables: issue_number, issue_title, issue_description, issue_state, issue_priority, issue_type, skill_name, workspace_path, project_name

No hardcoded values. If a flag field is null/undefined on the harness, skip it.

- [ ] **Step 3: Type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: command builder — assembles CLI commands from harness_catalog config"
```

---

## Task 5: Skill Materializer

**Files:**
- Create: `src/core/skills/materializer.ts`

- [ ] **Step 1: Read PAT's materialization pattern**

Read `/mnt/dev/pat/.runtime/fh-commons/src/fh_commons/cli/sync/core.py` to understand how PAT writes skill files. Also read PAT's `StageLauncher.launch()` to see how the workspace is used at execution time.

- [ ] **Step 2: Create the materializer**

Create `src/core/skills/materializer.ts`:

```typescript
/**
 * Skill Materializer — writes DB-stored skills and persona config to disk.
 *
 * At execution time, creates an isolated workspace directory with:
 * - CLAUDE.md (persona prompt: soul + identity + brand)
 * - skills/{name}/SKILL.md (skill content from promptTemplate)
 * - context.md (issue context: title, description, state, metadata)
 *
 * The harness reads these files as it normally would.
 * After execution, the workspace is cleaned up.
 *
 * Zero vendor imports. Operates on plain objects, writes to filesystem.
 */
```

Implement:
- `materialize(options)` → returns `workspacePath: string`
  - `options`: `{ stageRunId, persona, skill, issue, project }`
  - Creates `/tmp/fluxaos-runs/{stageRunId}/`
  - Writes `CLAUDE.md` from persona.soul + persona.identity + brand fields
  - Writes `skills/{skill.name}/SKILL.md` from skill.promptTemplate
  - Writes `context.md` with issue metadata (title, description, number, state, priority, type, labels)
- `cleanup(workspacePath)` → removes the temp directory

Use `node:fs/promises` and `node:os` for temp directory management. Atomic writes (write to temp file, rename).

- [ ] **Step 3: Type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: skill materializer — writes DB skills + persona to temp workspace"
```

---

## Task 6: Output Parser

**Files:**
- Create: `src/core/orchestrator/output-parser.ts`

- [ ] **Step 1: Read PAT's LiveOutput parsing**

Read `/mnt/dev/pat/frontend/src/components/LiveOutput.tsx` to understand the transcript entry types and how stdout JSON is parsed into structured entries.

- [ ] **Step 2: Create the output parser**

Create `src/core/orchestrator/output-parser.ts`:

```typescript
/**
 * Output Parser — converts harness stdout lines into typed transcript entries.
 *
 * The harness writes JSON events to stdout. This parser converts each line
 * into a TranscriptEntry with a kind (text, tool_call, tool_result, result,
 * system, raw) and structured fields.
 *
 * Lines that aren't valid JSON become 'raw' entries.
 */
```

Types:
```typescript
type EntryKind = 'text' | 'tool_call' | 'tool_result' | 'result' | 'system' | 'raw';

interface TranscriptEntry {
  id: string;
  kind: EntryKind;
  lineNumber: number;
  text?: string;
  toolName?: string;
  toolCommand?: string;
  toolOutput?: string;
  isError?: boolean;
  cost?: number;
}
```

Implement:
- `parseLine(line: string, lineNumber: number)` → `TranscriptEntry`
  - Try JSON.parse; if valid, map type field to kind
  - If not valid JSON → kind: 'raw', text: line
  - Map: `assistant`/`text` → `text`, `tool_use` → `tool_call`, `tool_result` → `tool_result`, `result` → `result`, `system` → `system`

- [ ] **Step 3: Type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: output parser — converts harness stdout to typed transcript entries"
```

---

## Task 7: Event-Driven Orchestrator

**Files:**
- Create: `src/core/orchestrator/event-orchestrator.ts`
- Edit: `src/server/routers/pipeline.ts`

This is the core of R5-V — the systemd-managed state machine.

- [ ] **Step 1: Read existing orchestrator code**

Read `src/core/orchestrator/manager.ts` and `src/core/orchestrator/stage-worker.ts` to understand the existing (polling-based) orchestrator. The new event-driven orchestrator replaces this approach.

Also read `src/adapters/subprocess/executor.ts` to understand the SubprocessExecutor interface.

- [ ] **Step 2: Read PAT's stage launcher**

Read `/mnt/dev/pat/src/pat/core/orchestrator/stage_launcher.py` and `/mnt/dev/pat/src/pat/core/orchestrator/routing_resolver.py` for the execution and routing flow.

- [ ] **Step 3: Create the event-driven orchestrator**

Create `src/core/orchestrator/event-orchestrator.ts`:

```typescript
/**
 * Event-Driven Orchestrator — the systemd-managed pipeline state machine.
 *
 * Subscribes to Supabase Realtime for pipeline_run and stage_run changes.
 * Reads all config from DB. Writes all state to DB. The harness never
 * touches the database.
 *
 * State machine:
 *   pipeline_run created → read first stage → create stage_run
 *   stage_run queued → materialize → build command → spawn → running
 *   stage_run completed → evaluate gate → verdict determines next state
 *   stage_run failed → check retry budget → retry or fail permanently
 *   stage_run cancelled → do nothing (restart-unless-stopped)
 *   all stages done → complete pipeline_run → transition issue state
 */
```

Implement:
- `EventOrchestrator` class
  - Constructor receives: `Database`, `SubprocessExecutor`, `Materializer`, Supabase Realtime client
  - `start()` — subscribe to Realtime on `pipeline_run` and `stage_run` tables
  - `stop()` — unsubscribe
  - `handleNewRun(pipelineRun)` — read first stage, create stage_run
  - `handleStageQueued(stageRun)` — full execution flow:
    1. Read pipeline_stage → skill, harness, persona from DB
    2. Resolve routing from DB
    3. Materialize workspace
    4. Build command
    5. Update stage_run (running, pid)
    6. Insert STAGE_STARTED event + issue_event
    7. Spawn subprocess via executor
    8. Capture stdout → insert OUTPUT events (parsed via output-parser)
    9. On exit → update stage_run, insert STAGE_COMPLETED/ERROR
    10. Evaluate gate → insert stage_gate_result + GATE_EVALUATED event
    11. Apply verdict (advance/hold/rework/abort)
  - `handleStageCompleted(stageRun)` — advance to next stage or complete run
  - `handleStageFailed(stageRun)` — check retry budget
  - `handleStageCancelled(stageRun)` — do nothing (restart-unless-stopped)
  - `recoverOnStartup()` — find stale `running` stage_runs, check PID, retry or fail

Every DB read uses the service layer. Every DB write includes audit trail (event + issue_event).

- [ ] **Step 4: Wire orchestrator trigger into pipeline router**

Using Edit on `src/server/routers/pipeline.ts`:
- The `pipeline.runs.trigger` mutation should create the pipeline_run record. The orchestrator picks it up via Realtime.
- The `pipeline.runs.executeStage` mutation should update stage_run status. The orchestrator picks it up via Realtime.
- Add `pipeline.runs.cancelStage` mutation that sets stage_run status to `cancelled`.
- Add `pipeline.runs.cancelRun` mutation that sets pipeline_run status to `cancelled` and all its queued/running stage_runs to `cancelled`.

- [ ] **Step 5: Type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: event-driven orchestrator — Realtime-subscribed pipeline state machine"
```

---

## Task 8: PipelineStatusBadge + StageTimeline Components

**Files:**
- Create: `src/components/pipeline/PipelineStatusBadge.tsx`
- Create: `src/components/pipeline/StageTimeline.tsx`

- [ ] **Step 1: Read PAT's components**

Read PAT's `RunDetailModal.tsx` sections for PipelineStatusBadge and StageTimeline. Note the exact status-to-color mapping, animated pulse for running, ring highlight for selected.

- [ ] **Step 2: Create PipelineStatusBadge**

Create `src/components/pipeline/PipelineStatusBadge.tsx`:
- Colored dot + label
- Statuses: Running, Queued, Completed, Failed, Cancelled, Pending
- Optional stage name suffix (e.g. "Running — implement")
- Match PAT's color scheme exactly

- [ ] **Step 3: Create StageTimeline**

Create `src/components/pipeline/StageTimeline.tsx`:
- Vertical list of stage buttons
- Props: `stages`, `selectedStageId`, `onSelectStage`
- Each stage shows: status dot (colored, animated pulse for running), name, attempt label, duration
- Click → calls `onSelectStage(stageId)`
- Selected state: ring highlight
- Status dot colors: green (completed), blue+pulse (running), yellow (pending/hold), red (failed), gray (queued/cancelled)

- [ ] **Step 4: Type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: PipelineStatusBadge + StageTimeline components matching PAT layout"
```

---

## Task 9: LiveOutput Component

**Files:**
- Create: `src/components/pipeline/LiveOutput.tsx`

- [ ] **Step 1: Read PAT's LiveOutput**

Read `/mnt/dev/pat/frontend/src/components/LiveOutput.tsx` fully. Note:
- Toolbar controls (line count, verbose, raw, auto-scroll, copy)
- How transcript entries are rendered by kind
- Auto-scroll behavior
- The exact styling and layout

- [ ] **Step 2: Create LiveOutput**

Create `src/components/pipeline/LiveOutput.tsx`:

**Toolbar:**
- Line count display
- Verbose toggle (show/hide system entries)
- Raw JSON toggle (switch between raw and parsed modes)
- Auto-scroll toggle
- Copy button (copies all output to clipboard)

**Output pane (h-96, monospace, dark bg):**

Raw mode: numbered lines of stdout/stderr.

Parsed mode — render by `kind` from TranscriptEntry:
- `text` → message icon + text content
- `tool_call` → terminal icon + tool name + command preview
- `tool_result` → indented with left border, red if `isError`
- `result` → zap icon + Done/Failed + cost
- `system` → dimmed text, visible only when Verbose is on
- `raw` → monospace, no icon

**Streaming:** Subscribe to Supabase Realtime on `event` table filtered by `stage_run_id` where `type = 'OUTPUT'`. Parse event payload into TranscriptEntry. Auto-scroll when viewport is within 50px of bottom.

- [ ] **Step 3: Type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: LiveOutput component — real-time transcript via Supabase Realtime"
```

---

## Task 10: GateResultsPanel Component

**Files:**
- Create: `src/components/pipeline/GateResultsPanel.tsx`

- [ ] **Step 1: Create GateResultsPanel**

Create `src/components/pipeline/GateResultsPanel.tsx`:
- Props: `stageRunId`
- Query: fetch `stage_gate_result` rows for this stage run
- Display: list of gate evaluations
  - VerdictBadge (reuse from R4-V)
  - Pass/fail count
  - Per-rule results: field, operator, expected, actual, pass/fail, label
  - Failure reason text
- Match PAT's GateResultsPanel layout

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: GateResultsPanel component for stage gate verdict display"
```

---

## Task 11: RunDetailModal Component

**Files:**
- Create: `src/components/pipeline/RunDetailModal.tsx`

This is the main modal that ties everything together. It depends on Tasks 8-10.

- [ ] **Step 1: Read PAT's RunDetailModal**

Read `/mnt/dev/pat/frontend/src/components/RunDetailModal.tsx` fully. Map every section, every field, every interaction. This is the reference — match it.

- [ ] **Step 2: Create RunDetailModal**

Create `src/components/pipeline/RunDetailModal.tsx`:

**Props:**
- `runId: string | null` — opens/closes modal (null = closed)
- `onClose: () => void`
- `initialStageName?: string` — pre-selects a stage on first load

**Data flow:**
- Query pipeline_run by ID (include pipeline, issue, stage_runs with pipeline_stage)
- Subscribe to Supabase Realtime on this pipeline_run's stage_runs for live status updates
- Auto-select: running stage, or last stage, or initialStageName

**Layout (match PAT exactly):**

Header:
- `#{issue_number} — {issue_title}`
- PipelineStatusBadge
- Cancel Run button (calls `pipeline.runs.cancelRun`)
- Close button (×)

Left sidebar (w-72):
- Run Info section:
  - Project: project name
  - Trigger: "manual" (for R5-V, always manual)
  - Priority: from issue priority catalog
  - Entry stage: first stage name
  - Started: timestamp
  - Duration: live-updating while running
- StageTimeline component (from Task 8)

Right panel (flex-1):
- Stage header:
  - Stage name
  - Attempt number (e.g. "attempt 2")
  - Model name (from stage_run.model)
  - Route source badge
  - Duration
  - Exit code (if completed/failed)
  - Cancel Stage button (if running, calls `pipeline.runs.cancelStage`)
- Result summary box (green, if completed with proceed verdict)
- Error summary box (red, if failed)
- Tab bar: Output | Gates
- Tab content:
  - Output tab → LiveOutput component (from Task 9)
  - Gates tab → GateResultsPanel component (from Task 10)

**Responsive:** Full-screen on mobile, max-w-6xl centered modal on desktop. Dark overlay backdrop.

- [ ] **Step 3: Type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: RunDetailModal — PAT-style execution modal with sidebar, timeline, live output"
```

---

## Task 12: Settings UI — Skill + Harness Dropdowns

**Files:**
- Edit: `src/app/[org]/[user]/[project]/settings/page.tsx`

- [ ] **Step 1: Read the current settings page**

Read the settings page fully. Identify where stages are created/edited and what form fields exist.

- [ ] **Step 2: Add tRPC queries for skills and harnesses**

Using Edit, add queries:

```typescript
const skillsQuery = trpc.skill.list.useQuery(/* project scope */);
const harnessQuery = trpc.harness.list.useQuery();
```

If `skill.list` doesn't exist, it needs to be added to the skill router first.

- [ ] **Step 3: Add skill dropdown to stage form**

Using Edit, add a skill select dropdown next to the existing gate mode dropdown:

```tsx
<select value={skillId} onChange={...}>
  <option value="">No skill</option>
  {skillsQuery.data?.map(s => (
    <option key={s.id} value={s.id}>{s.name}</option>
  ))}
</select>
```

- [ ] **Step 4: Add harness dropdown to stage form**

Using Edit, add a harness select dropdown:

```tsx
<select value={harnessId} onChange={...}>
  <option value="">No harness</option>
  {harnessQuery.data?.map(h => (
    <option key={h.id} value={h.id}>{h.name}</option>
  ))}
</select>
```

- [ ] **Step 5: Include skillId and harnessId in stage create/update mutations**

Using Edit, add `skillId` and `harnessId` to the mutation payloads for creating and updating stages.

- [ ] **Step 6: Type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: skill + harness dropdowns in pipeline settings (DB-driven, no hardcoded options)"
```

---

## Task 13: Wire RunDetailModal into Issue Detail + Pipeline Detail

**Files:**
- Edit: `src/app/[org]/[user]/[project]/issues/[number]/client.tsx`
- Edit: `src/app/[org]/[user]/[project]/pipelines/[id]/page.tsx`

- [ ] **Step 1: Read the issue detail client**

Read the file fully. Find the "Run Stage" button and the current `executeStage` mutation.

- [ ] **Step 2: Add RunDetailModal to issue detail**

Using Edit:
1. Import RunDetailModal
2. Add state: `const [activeRunId, setActiveRunId] = useState<string | null>(null)`
3. When "Run Stage" triggers a run, set `activeRunId` to the new run's ID
4. Render `<RunDetailModal runId={activeRunId} onClose={() => setActiveRunId(null)} />`

- [ ] **Step 3: Read the pipeline detail page**

Read `src/app/[org]/[user]/[project]/pipelines/[id]/page.tsx` fully.

- [ ] **Step 4: Add RunDetailModal to pipeline detail**

Using Edit:
1. Import RunDetailModal
2. When a run row is clicked, open the modal with that run's ID
3. Render `<RunDetailModal runId={selectedRunId} onClose={() => setSelectedRunId(null)} />`

- [ ] **Step 5: Type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: wire RunDetailModal into issue detail and pipeline detail pages"
```

---

## Task 14: Integration Tests

**Files:**
- Create: `src/__tests__/integration/orchestrator-e2e.test.ts`

- [ ] **Step 1: Read existing test patterns**

Read `src/__tests__/integration/gates.test.ts` for the test setup pattern (DB connection, cleanup, Vitest structure).

- [ ] **Step 2: Write orchestrator integration tests**

Create `src/__tests__/integration/orchestrator-e2e.test.ts`:

Tests (all against real Supabase):

1. **Command builder**: harness_catalog entry → correct command array
2. **Materializer**: skill + persona → workspace files written correctly
3. **Materializer cleanup**: workspace removed after cleanup
4. **Template rendering**: all `{{variables}}` resolve correctly
5. **Output parser**: JSON stdout → correct TranscriptEntry types
6. **Output parser**: non-JSON line → raw entry
7. **Orchestrator creates stage_run**: pipeline_run created → stage_run exists with correct attempt
8. **Orchestrator writes audit trail**: stage execution → event rows exist (STAGE_STARTED, STAGE_COMPLETED)
9. **Orchestrator evaluates gate**: stage completed → stage_gate_result exists with correct verdict
10. **Orchestrator respects cancellation**: cancelled stage_run → not re-launched
11. **Orchestrator respects retry budget**: failed stage with maxRetries=0 → no retry
12. **Orchestrator retries within budget**: failed stage with maxRetries=2, attempt=1 → new stage_run created
13. **Issue event audit**: stage lifecycle → issue_events exist with correct payloads

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/__tests__/integration/orchestrator-e2e.test.ts 2>&1 | tail -30
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: orchestrator integration tests — command builder, materializer, audit trail, retries"
```

---

## Task 15: Full Integration Test + Verification

- [ ] **Step 1: Run all integration tests**

```bash
npx vitest run src/__tests__/integration/ 2>&1 | tail -30
```

All tests must pass (existing gate tests + new orchestrator tests).

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Zero errors.

- [ ] **Step 3: Run invariant check**

```bash
grep -rn '"research"\|"implement"\|"review"\|"deploy"\|"complete"\|"rework"' src/ \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir=__tests__ --exclude-dir=adapters \
  | grep -v 'seed\|fixture\|\.test\.' || echo "PASS: No hardcoded stage names"
```

- [ ] **Step 4: Run phase snapshot check**

```bash
bash .claude/hooks/phase-snapshot-check.sh
```

- [ ] **Step 5: Signal ready for review**

Tell the user: "Phase R5-V implementation complete. Ready for `/review` (Codex adversarial review)."

---

## Exit Criteria

User verification in browser:

1. Open Settings → Pipeline → see skill and harness dropdowns populated from DB
2. Assign research skill and claude-code harness to the research stage, save
3. Create an issue, set state to match first pipeline stage
4. Click "Run Stage" → RunDetailModal opens
5. StageTimeline shows stages with status dots, research stage pulses blue (running)
6. LiveOutput streams transcript entries in real-time via Supabase Realtime
7. Toggle between raw and parsed output modes — both work
8. Verbose toggle hides/shows system entries
9. Stage completes → exit code displayed → gate evaluates → verdict in Gates tab
10. Gate verdict auto-advances (proceed) or holds (hold) per DB config
11. Cancel a running stage → status changes to cancelled → orchestrator does not re-launch
12. All events visible in issue activity feed (stage started, completed, gate evaluated, state transition)
13. Open Pipelines page → click a run → RunDetailModal opens with full details
14. Kill orchestrator mid-execution → restart → recovery behavior matches retry budget
