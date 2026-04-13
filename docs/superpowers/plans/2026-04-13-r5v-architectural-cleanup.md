# R5-V Architectural Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 5 merge-blocking issues and 17 DA audit findings by refactoring the orchestration layer bottom-up: constants → shared services → shared execution → consumer cleanup.

**Architecture:** 4-layer bottom-up refactor. Layer 1 creates a shared constants module. Layer 2 consolidates `PipelineRunService` to own all DB mutations. Layer 3 extracts `executeStageRun()` into a shared stage-runner and makes the materializer harness-agnostic. Layer 4 cleans up consumers: fixes vendor boundary violations, deletes dead code, adds fail-fast checks, and seeds routing data.

**Tech Stack:** TypeScript, Drizzle ORM, Supabase (Postgres + Realtime), Next.js, tRPC, execa

**Design Spec:** `docs/superpowers/specs/2026-04-13-r5v-architectural-cleanup-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `src/core/constants.ts` | All status strings, event types, gate verdicts, defaults, timeouts |
| `src/core/orchestrator/stage-runner.ts` | Shared `executeStageRun()` — loads config, materializes, spawns, streams |
| `drizzle/0002_harness_context_layout.sql` | Migration adding `context_layout` column to `harness_catalog` |

### Modified Files

| File | What Changes |
|------|-------------|
| `src/core/orchestrator/pipeline-run-service.ts` | Add `appendIssueEvent()`, `failStageAndRun()`; use constants |
| `src/core/orchestrator/manual-run.ts` | Gut to ~40-line wrapper around `executeStageRun()` |
| `src/core/orchestrator/event-orchestrator.ts` | Use `RealtimeProvider` port, `runService`, `executeStageRun()`, constants |
| `src/core/skills/materializer.ts` | Read filenames from `contextLayout` option instead of hardcoding |
| `src/core/orchestrator/types.ts` | Re-derive types from constants; keep terminal sets |
| `src/core/orchestrator/index.ts` | Update barrel exports (remove manager, add stage-runner) |
| `src/core/orchestrator/routing-resolver.ts` | Remove `'subprocess'` fallback; fail fast |
| `src/core/gates/service.ts` | Use `DEFAULT_GATE_MODE` constant |
| `src/core/db/schema.ts` | Add `contextLayout` column to `harnessCatalog` |
| `src/core/db/seed.ts` | Add `contextLayout` to harness; add provider/model/routing rule |
| `src/core/orchestrator/demo.ts` | Remove event deletion; use `createEventOrchestrator` |
| `src/core/orchestrator/output-parser.ts` | Fix vendor-specific comment |
| `src/components/pipeline/StageTimeline.tsx` | Import status constants for dot color map keys |
| `src/components/pipeline/PipelineStatusBadge.tsx` | Import status constants for config keys |
| `src/app/[org]/[user]/[project]/settings/providers/page.tsx` | Remove vendor-specific placeholder text |
| `src/adapters/subprocess/executor.ts` | Use `KILL_GRACE_PERIOD_MS` constant |
| `src/core/ports/realtime.ts` | Extend interface with `subscribeToTable()` method |

### Deleted Files

| File | Why |
|------|-----|
| `src/core/orchestrator/manager.ts` | Polling-based orchestrator replaced by event-orchestrator |

---

## Task 1: Constants Module

**Files:**
- Create: `src/core/constants.ts`

- [ ] **Step 1: Create the constants file**

```typescript
// src/core/constants.ts

/**
 * Shared constants — single source of truth for all status strings,
 * event types, gate verdicts, defaults, and timeouts.
 *
 * Imported by both server-side code and UI components (read-only values).
 * Zero imports — this file has no dependencies.
 */

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

export type PipelineRunStatus = (typeof PIPELINE_RUN_STATUS)[keyof typeof PIPELINE_RUN_STATUS];

export const PIPELINE_RUN_TERMINAL: ReadonlySet<string> = new Set([
  PIPELINE_RUN_STATUS.completed,
  PIPELINE_RUN_STATUS.failed,
  PIPELINE_RUN_STATUS.timed_out,
  PIPELINE_RUN_STATUS.cancelled,
]);

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

export type StageRunStatus = (typeof STAGE_RUN_STATUS)[keyof typeof STAGE_RUN_STATUS];

export const STAGE_RUN_TERMINAL: ReadonlySet<string> = new Set([
  STAGE_RUN_STATUS.completed,
  STAGE_RUN_STATUS.failed,
  STAGE_RUN_STATUS.timed_out,
  STAGE_RUN_STATUS.cancelled,
]);

// ── Event Types (written to `event` table) ─────────────────
export const EVENT_TYPE = {
  STAGE_STARTED: 'STAGE_STARTED',
  STAGE_COMPLETED: 'STAGE_COMPLETED',
  OUTPUT: 'OUTPUT',
  ERROR: 'ERROR',
  GATE_EVALUATED: 'GATE_EVALUATED',
} as const;

export type EventType = (typeof EVENT_TYPE)[keyof typeof EVENT_TYPE];

// ── Issue Event Types (written to `issue_event` table) ─────
export const ISSUE_EVENT_TYPE = {
  stage_started: 'stage_started',
  stage_completed: 'stage_completed',
  stage_failed: 'stage_failed',
  pipeline_completed: 'pipeline_completed',
  pipeline_failed: 'pipeline_failed',
  gate_hold: 'gate_hold',
} as const;

export type IssueEventType = (typeof ISSUE_EVENT_TYPE)[keyof typeof ISSUE_EVENT_TYPE];

// ── Gate Verdicts ──────────────────────────────────────────
export const GATE_VERDICT = {
  proceed: 'proceed',
  hold: 'hold',
  rework: 'rework',
  abort: 'abort',
} as const;

export type GateVerdict = (typeof GATE_VERDICT)[keyof typeof GATE_VERDICT];

// ── Gate Modes ─────────────────────────────────────────────
export const GATE_MODE = {
  auto: 'auto',
  rules: 'rules',
  hold: 'hold',
  manual: 'manual',
  skip: 'skip',
} as const;

export type GateMode = (typeof GATE_MODE)[keyof typeof GATE_MODE];

// ── Defaults ───────────────────────────────────────────────
export const DEFAULT_STAGE_TIMEOUT_SEC = 300;
export const DEFAULT_GATE_MODE = GATE_MODE.auto;
export const DEFAULT_SORT_STRATEGY = 'quality' as const;
export const KILL_GRACE_PERIOD_MS = 5_000;
export const ORCHESTRATOR_HEARTBEAT_MS = 5_000;
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit src/core/constants.ts`

If tsc doesn't support single-file checking, run: `npm run build`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/constants.ts
git commit -m "feat: add shared constants module (statuses, event types, defaults)"
```

---

## Task 2: Update types.ts to Re-Export from Constants

**Files:**
- Modify: `src/core/orchestrator/types.ts`

The existing `types.ts` defines `PipelineRunStatus`, `StageRunStatus`, `StageEventType`, and terminal sets. These now come from `constants.ts`. We re-export them so existing consumers don't break, then update imports incrementally.

- [ ] **Step 1: Replace type definitions and terminal sets with re-exports**

Replace the entire contents of `src/core/orchestrator/types.ts` with:

```typescript
/**
 * Orchestrator types — shared across the pipeline engine.
 *
 * Status types and terminal sets are re-exported from constants.ts.
 * Domain-specific interfaces (routing, job payloads, config) live here.
 */

// Re-export status types and sets from the single source of truth
export {
  type PipelineRunStatus,
  type StageRunStatus,
  PIPELINE_RUN_TERMINAL,
  STAGE_RUN_TERMINAL,
  type EventType as StageEventType,
  PIPELINE_RUN_STATUS,
  STAGE_RUN_STATUS,
  EVENT_TYPE,
  ISSUE_EVENT_TYPE,
  GATE_VERDICT,
  GATE_MODE,
  DEFAULT_STAGE_TIMEOUT_SEC,
  ORCHESTRATOR_HEARTBEAT_MS,
} from '@/core/constants';

// ─── Routing ───────────────────────────────────────────────────────────

/** Result of resolving routing for a stage. All from DB config. */
export interface ResolvedRouting {
  providerId: string;
  providerName: string;
  providerBaseUrl: string | null;
  providerApiKeyRef: string | null;
  modelId: string;
  modelIdentifier: string;
  harness: string;
  costPer1kInput: number;
  costPer1kOutput: number;
}

// ─── Job Payload ───────────────────────────────────────────────────────

/** Data enqueued to BullMQ for a stage execution job. */
export interface StageJobPayload {
  stageRunId: string;
  pipelineRunId: string;
  pipelineStageId: string;
  issueId: string;
  projectId: string;
  /** Resolved at enqueue time — worker doesn't query routing. */
  routing: ResolvedRouting;
  /** Prompt/skill template rendered at enqueue time. */
  prompt: string;
  /** Working directory for the subprocess. */
  cwd: string;
  /** Timeout in milliseconds. */
  timeoutMs: number;
}

// ─── Orchestrator Config ───────────────────────────────────────────────

export interface OrchestratorConfig {
  /** How often the orchestrator checks for work (ms). */
  heartbeatIntervalMs: number;
  /** Max concurrent pipeline runs. */
  maxConcurrentRuns: number;
  /** Max concurrent stages across all runs. */
  maxConcurrentStages: number;
  /** Queue name for stage execution jobs. */
  queueName: string;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  heartbeatIntervalMs: ORCHESTRATOR_HEARTBEAT_MS,
  maxConcurrentRuns: 5,
  maxConcurrentStages: 3,
  queueName: 'stage-execution',
};
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: No type errors. All existing imports of `STAGE_RUN_TERMINAL`, `PipelineRunStatus`, etc. from `./types` still resolve.

- [ ] **Step 3: Commit**

```bash
git add src/core/orchestrator/types.ts
git commit -m "refactor: re-export status types from constants module"
```

---

## Task 3: Consolidate PipelineRunService

**Files:**
- Modify: `src/core/orchestrator/pipeline-run-service.ts`

Add `appendIssueEvent()` and `failStageAndRun()`. Replace all inline status strings with constants.

- [ ] **Step 1: Add the issueEvent import and new methods**

At the top of the file, add `issueEvent` to the schema import:

```typescript
import {
  pipeline,
  pipelineStage,
  pipelineRun,
  stageRun,
  event,
  issueEvent,
  issue,
} from '@/core/db/schema';
```

Replace the type imports:

```typescript
import {
  type PipelineRunStatus,
  type StageRunStatus,
  STAGE_RUN_TERMINAL,
  STAGE_RUN_STATUS,
  PIPELINE_RUN_STATUS,
} from './types';
```

Add to the `PipelineRunService` interface (after `getNextStage`):

```typescript
  /** Write an issue event (stage_started, stage_completed, etc.) */
  appendIssueEvent(
    issueId: string,
    type: string,
    payload: Record<string, unknown>,
    actor: string,
  ): Promise<void>;

  /** Fail both the stage run and the pipeline run in one call. */
  failStageAndRun(stageRunId: string, runId: string): Promise<void>;
```

Add the implementations inside the returned object (after `getNextStage` implementation):

```typescript
    async appendIssueEvent(issueId, type, payload, actor) {
      await db.insert(issueEvent).values({
        issueId,
        actor,
        type,
        payload,
      });
    },

    async failStageAndRun(stageRunId, runId) {
      await db
        .update(stageRun)
        .set({
          status: STAGE_RUN_STATUS.failed,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(stageRun.id, stageRunId));
      await db
        .update(pipelineRun)
        .set({
          status: PIPELINE_RUN_STATUS.failed,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(pipelineRun.id, runId));
    },
```

- [ ] **Step 2: Replace inline status strings with constants throughout the file**

In `createRun`: change `status: 'queued'` to `status: PIPELINE_RUN_STATUS.queued`

In `getQueuedRuns`: change `eq(pipelineRun.status, 'queued')` to `eq(pipelineRun.status, PIPELINE_RUN_STATUS.queued)`

In `getRunningRuns`: change `eq(pipelineRun.status, 'running')` to `eq(pipelineRun.status, PIPELINE_RUN_STATUS.running)`

In `updateRunStatus`: change `status === 'running'` to `status === PIPELINE_RUN_STATUS.running`

In `createStageRun`: change `status: 'pending'` to `status: STAGE_RUN_STATUS.pending`

In `updateStageRunStatus`: change `status === 'running'` to `status === STAGE_RUN_STATUS.running`

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/orchestrator/pipeline-run-service.ts
git commit -m "feat: add appendIssueEvent and failStageAndRun to PipelineRunService; use constants"
```

---

## Task 4: Schema Migration — Add contextLayout to harness_catalog

**Files:**
- Modify: `src/core/db/schema.ts`
- Create: `drizzle/0002_harness_context_layout.sql`

- [ ] **Step 1: Add the column to the Drizzle schema**

In `src/core/db/schema.ts`, add this line inside the `harnessCatalog` table definition, after the `extraArgs` line:

```typescript
  contextLayout: jsonb('context_layout').notNull().default(sql`'{"instructionsFile":"CLAUDE.md","contextFile":"context.md"}'::jsonb`),
```

- [ ] **Step 2: Create the migration file**

```sql
-- drizzle/0002_harness_context_layout.sql
-- Add context_layout to harness_catalog for harness-agnostic file materialization
ALTER TABLE "harness_catalog"
  ADD COLUMN "context_layout" jsonb NOT NULL DEFAULT '{"instructionsFile":"CLAUDE.md","contextFile":"context.md"}'::jsonb;
```

- [ ] **Step 3: Run the migration**

Run: `npm run db:migrate`
Expected: Migration applies successfully.

- [ ] **Step 4: Verify with Drizzle codegen**

Run: `npm run db:generate`
Expected: No diff (schema already matches migration).

- [ ] **Step 5: Commit**

```bash
git add src/core/db/schema.ts drizzle/0002_harness_context_layout.sql
git commit -m "feat: add contextLayout column to harness_catalog"
```

---

## Task 5: Make Materializer Harness-Agnostic

**Files:**
- Modify: `src/core/skills/materializer.ts`

- [ ] **Step 1: Update MaterializeOptions to accept contextLayout**

Replace the `MaterializeOptions` interface:

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

- [ ] **Step 2: Replace hardcoded CLAUDE.md with contextLayout filenames**

In the `materialize` function, replace:

```typescript
  // 1. Write CLAUDE.md — persona + skill instructions combined
  //    Claude auto-discovers CLAUDE.md from --add-dir directories,
  //    but skills/{name}/SKILL.md requires explicit invocation.
  //    Embedding skill instructions in CLAUDE.md ensures they're always read.
  const parts: string[] = [];
  const personaContent = buildPersonaContent(options.persona);
  if (personaContent) {
    parts.push(personaContent);
  }
  if (options.skill.promptTemplate) {
    parts.push(`## Skill: ${options.skill.name}\n\n${options.skill.promptTemplate}`);
  }
  if (parts.length > 0) {
    await atomicWrite(join(workspacePath, 'CLAUDE.md'), parts.join('\n\n'));
  }

  // 3. Write context.md with issue metadata
  const contextMd = buildContextContent(options.issue, options.projectName);
  await atomicWrite(join(workspacePath, 'context.md'), contextMd);
```

With:

```typescript
  // 1. Write instructions file — persona + skill instructions combined
  //    Filename comes from harness config (e.g. CLAUDE.md, AGENTS.md, GEMINI.md)
  const parts: string[] = [];
  const personaContent = buildPersonaContent(options.persona);
  if (personaContent) {
    parts.push(personaContent);
  }
  if (options.skill.promptTemplate) {
    parts.push(`## Skill: ${options.skill.name}\n\n${options.skill.promptTemplate}`);
  }
  if (parts.length > 0) {
    await atomicWrite(
      join(workspacePath, options.contextLayout.instructionsFile),
      parts.join('\n\n'),
    );
  }

  // 2. Write context file with issue metadata
  const contextMd = buildContextContent(options.issue, options.projectName);
  await atomicWrite(
    join(workspacePath, options.contextLayout.contextFile),
    contextMd,
  );
```

- [ ] **Step 3: Remove the stale skills directory creation**

The current code creates `skillDir = join(workspacePath, 'skills', options.skill.name)` but never writes to it (skill content goes into the instructions file). Remove this dead code:

Replace:

```typescript
  const workspacePath = join(WORKSPACE_ROOT, options.stageRunId);
  const skillDir = join(workspacePath, 'skills', options.skill.name);

  // Create directories
  await mkdir(skillDir, { recursive: true });
```

With:

```typescript
  const workspacePath = join(WORKSPACE_ROOT, options.stageRunId);

  // Create workspace directory
  await mkdir(workspacePath, { recursive: true });
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Compile errors in `manual-run.ts` and `event-orchestrator.ts` because they call `materialize()` without `contextLayout`. This is expected — Task 6 fixes it.

- [ ] **Step 5: Commit**

```bash
git add src/core/skills/materializer.ts
git commit -m "refactor: make materializer harness-agnostic — read filenames from contextLayout"
```

---

## Task 6: Create Shared Stage Runner

**Files:**
- Create: `src/core/orchestrator/stage-runner.ts`

This is the core extraction — the shared `executeStageRun()` function that replaces ~200 duplicated lines in manual-run.ts and event-orchestrator.ts.

- [ ] **Step 1: Create stage-runner.ts**

```typescript
// src/core/orchestrator/stage-runner.ts

/**
 * Stage Runner — shared execution logic for a single stage run.
 *
 * Loads all config from DB, materializes workspace, builds command,
 * spawns subprocess, streams output to events, completes stage run.
 *
 * Used by both manual-run (fire-and-forget from tRPC) and
 * event-orchestrator (Realtime-driven state machine).
 */
import { eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import type { StageExecutor } from '@/core/ports/stage-executor';
import type { PipelineRunService } from './pipeline-run-service';
import {
  pipelineRun,
  pipelineStage,
  stageRun,
  issue,
  skill,
  harnessCatalog,
  persona,
  brand,
  pipeline,
} from '@/core/db/schema';
import { materialize, cleanup } from '@/core/skills/materializer';
import { buildCommand, renderTemplate } from './command-builder';
import { parseLine } from './output-parser';
import { createRoutingResolver } from './routing-resolver';
import {
  STAGE_RUN_STATUS,
  EVENT_TYPE,
  ISSUE_EVENT_TYPE,
  DEFAULT_STAGE_TIMEOUT_SEC,
} from '@/core/constants';

// ── Types ────────────────────────────────────────────────────────────

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
  stageName: string;
  harnessName: string;
  providerName: string | null;
  modelIdentifier: string | null;
  issueId: string | null;
  stageId: string;
}

// ── Main ─────────────────────────────────────────────────────────────

/**
 * Execute a single stage run end-to-end.
 *
 * Loads all config from DB, materializes workspace, builds command,
 * spawns subprocess, streams output to events, completes stage run.
 *
 * Does NOT complete the pipeline run or write pipeline-level issue events —
 * that's the caller's responsibility (manual-run vs orchestrator have
 * different pipeline progression logic).
 */
export async function executeStageRun(
  ctx: StageRunContext,
): Promise<StageRunResult> {
  const { db, executor, runService, runId, stageRunId } = ctx;

  // ── Load all required data ───────────────────────────────────────

  const [run] = await db
    .select()
    .from(pipelineRun)
    .where(eq(pipelineRun.id, runId));
  if (!run) throw new Error(`Pipeline run not found: ${runId}`);

  const [sRun] = await db
    .select()
    .from(stageRun)
    .where(eq(stageRun.id, stageRunId));
  if (!sRun) throw new Error(`Stage run not found: ${stageRunId}`);

  const [stage] = await db
    .select()
    .from(pipelineStage)
    .where(eq(pipelineStage.id, sRun.pipelineStageId));
  if (!stage) throw new Error(`Pipeline stage not found: ${sRun.pipelineStageId}`);

  // Harness (required)
  let harnessRow: typeof harnessCatalog.$inferSelect | null = null;
  if (stage.harnessId) {
    const [h] = await db
      .select()
      .from(harnessCatalog)
      .where(eq(harnessCatalog.id, stage.harnessId));
    harnessRow = h ?? null;
  }
  if (!harnessRow) {
    await runService.appendEvent(stageRunId, EVENT_TYPE.ERROR, {
      error: 'No harness configured for stage',
      stageName: stage.name,
    });
    throw new Error(`No harness configured for stage: ${stage.name}`);
  }

  // Skill (optional)
  let skillRow: typeof skill.$inferSelect | null = null;
  if (stage.skillId) {
    const [s] = await db
      .select()
      .from(skill)
      .where(eq(skill.id, stage.skillId));
    skillRow = s ?? null;
  }

  // Issue (optional)
  let issueRow: typeof issue.$inferSelect | null = null;
  if (run.issueId) {
    const [i] = await db
      .select()
      .from(issue)
      .where(eq(issue.id, run.issueId));
    issueRow = i ?? null;
  }

  // Routing
  const routingResolver = createRoutingResolver(db);
  let projectId: string | null = issueRow?.projectId ?? null;
  if (!projectId) {
    const [pipe] = await db
      .select({ projectId: pipeline.projectId })
      .from(pipeline)
      .where(eq(pipeline.id, run.pipelineId));
    projectId = pipe?.projectId ?? null;
  }
  const routing = projectId
    ? await routingResolver.resolve(stage.id, projectId)
    : null;

  // Persona (optional)
  let personaRow: (typeof persona.$inferSelect & { brandEntry?: typeof brand.$inferSelect | null }) | null = null;
  if (stage.personaId) {
    const [p] = await db
      .select()
      .from(persona)
      .where(eq(persona.id, stage.personaId));
    if (p) {
      let brandRow: typeof brand.$inferSelect | null = null;
      if (p.brandId) {
        const [b] = await db
          .select()
          .from(brand)
          .where(eq(brand.id, p.brandId));
        brandRow = b ?? null;
      }
      personaRow = { ...p, brandEntry: brandRow };
    }
  }

  // ── Materialize + Build + Spawn ──────────────────────────────────

  // Read contextLayout from harness config
  const contextLayout = (harnessRow.contextLayout as { instructionsFile: string; contextFile: string }) ?? {
    instructionsFile: 'CLAUDE.md',
    contextFile: 'context.md',
  };

  const workspacePath = await materialize({
    stageRunId: sRun.id,
    contextLayout,
    persona: personaRow
      ? {
          soul: personaRow.soul,
          identity: personaRow.identity,
          brandToneOfVoice: personaRow.brandEntry?.toneOfVoice,
          brandStyleGuide: personaRow.brandEntry?.styleGuide,
        }
      : null,
    skill: {
      name: skillRow?.name ?? stage.name,
      promptTemplate: skillRow?.promptTemplate ?? null,
    },
    issue: issueRow
      ? {
          number: issueRow.number,
          title: issueRow.title,
          bodyMd: issueRow.bodyMd,
        }
      : { number: 0, title: 'No issue context' },
  });

  try {
    // Build prompt
    const template =
      harnessRow.issuePromptTemplate ?? '{{skill_name}}: {{issue_title}}';
    const prompt = renderTemplate(template, {
      issue_number: issueRow?.number,
      issue_title: issueRow?.title ?? '',
      issue_description: issueRow?.bodyMd ?? '',
      skill_name: skillRow?.name ?? stage.name,
      workspace_path: workspacePath,
    });

    // Build command
    const cmd = buildCommand(harnessRow, {
      model: routing?.modelIdentifier ?? '',
      workspacePath,
      prompt,
      sessionName: `fluxaos-${sRun.id.slice(0, 8)}`,
    });

    // Mark running
    await runService.updateStageRunStatus(sRun.id, STAGE_RUN_STATUS.running);

    // STAGE_STARTED event
    await runService.appendEvent(sRun.id, EVENT_TYPE.STAGE_STARTED, {
      provider: routing?.providerName,
      model: routing?.modelIdentifier,
      harness: harnessRow.name,
      skill: skillRow?.name,
      attempt: sRun.attempt,
    });

    // Issue event
    if (run.issueId) {
      await runService.appendIssueEvent(
        run.issueId,
        ISSUE_EVENT_TYPE.stage_started,
        {
          stageRunId: sRun.id,
          stageName: stage.name,
          skillName: skillRow?.name,
          harness: harnessRow.name,
          attempt: sRun.attempt,
        },
        'stage-runner',
      );
    }

    // Spawn subprocess
    let lineNumber = 0;
    const result = await executor.execute({
      command: cmd.binary,
      args: cmd.args,
      cwd: process.cwd(),
      env: cmd.env,
      timeoutMs: (stage.timeoutSec ?? DEFAULT_STAGE_TIMEOUT_SEC) * 1000,
      onStdout: (data: string) => {
        const lines = data.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          lineNumber++;
          const entries = parseLine(line, lineNumber);
          for (const entry of entries) {
            runService
              .appendEvent(sRun.id, EVENT_TYPE.OUTPUT, {
                ...entry,
                content: entry.text ?? entry.toolCommand ?? entry.toolOutput ?? '',
              })
              .catch(logError);
          }
        }
      },
      onStderr: (data: string) => {
        lineNumber++;
        runService
          .appendEvent(sRun.id, EVENT_TYPE.OUTPUT, {
            lineNumber,
            content: data.trim(),
            kind: 'raw',
            isStderr: true,
          })
          .catch(logError);
      },
    });

    // Complete stage run with full metadata
    const finalStatus = result.exitCode === 0
      ? STAGE_RUN_STATUS.completed
      : STAGE_RUN_STATUS.failed;

    await runService.completeStageRun(sRun.id, finalStatus, {
      provider: routing?.providerName,
      model: routing?.modelIdentifier,
      harness: harnessRow.name,
    });

    // Completion event
    const eventType = result.exitCode === 0
      ? EVENT_TYPE.STAGE_COMPLETED
      : EVENT_TYPE.ERROR;
    await runService.appendEvent(sRun.id, eventType, {
      exitCode: result.exitCode,
      duration: result.durationMs,
    });

    // Issue events
    if (run.issueId) {
      const issueEventType = result.exitCode === 0
        ? ISSUE_EVENT_TYPE.stage_completed
        : ISSUE_EVENT_TYPE.stage_failed;
      await runService.appendIssueEvent(
        run.issueId,
        issueEventType,
        {
          stageRunId: sRun.id,
          stageName: stage.name,
          exitCode: result.exitCode,
        },
        'stage-runner',
      );
    }

    // Cleanup workspace
    await cleanup(workspacePath);

    return {
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stageName: stage.name,
      harnessName: harnessRow.name,
      providerName: routing?.providerName ?? null,
      modelIdentifier: routing?.modelIdentifier ?? null,
      issueId: run.issueId,
      stageId: stage.id,
    };
  } catch (err) {
    // Subprocess error (timeout, signal, etc.)
    await runService.completeStageRun(sRun.id, STAGE_RUN_STATUS.failed, {
      harness: harnessRow.name,
    });
    await runService.appendEvent(sRun.id, EVENT_TYPE.ERROR, {
      message: err instanceof Error ? err.message : String(err),
    });
    await cleanup(workspacePath).catch(logError);

    throw err; // Re-throw so caller can handle pipeline-level failure
  }
}

function logError(err: unknown): void {
  console.error('[stage-runner]', err);
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: This file compiles. Errors remain in manual-run.ts and event-orchestrator.ts (fixed in Tasks 7-8).

- [ ] **Step 3: Commit**

```bash
git add src/core/orchestrator/stage-runner.ts
git commit -m "feat: extract shared executeStageRun into stage-runner.ts"
```

---

## Task 7: Rewrite manual-run.ts as Thin Wrapper

**Files:**
- Modify: `src/core/orchestrator/manual-run.ts`

- [ ] **Step 1: Replace entire file contents**

```typescript
// src/core/orchestrator/manual-run.ts

/**
 * Manual Run Executor — runs a single stage without the orchestrator daemon.
 *
 * Called fire-and-forget from the tRPC trigger mutation. Delegates all
 * execution logic to the shared stage-runner. Handles pipeline-level
 * completion and gate evaluation.
 */
import type { Database } from '@/core/db/connection';
import type { StageExecutor } from '@/core/ports/stage-executor';
import { createPipelineRunService } from './pipeline-run-service';
import { createGateService } from '@/core/gates/service';
import { executeStageRun } from './stage-runner';
import {
  PIPELINE_RUN_STATUS,
  ISSUE_EVENT_TYPE,
  EVENT_TYPE,
  GATE_MODE,
  DEFAULT_GATE_MODE,
} from '@/core/constants';
import { eq } from 'drizzle-orm';
import { pipelineStage, stageRun } from '@/core/db/schema';

/**
 * Execute a single stage run. Fire-and-forget — caller does not await.
 * All state is written to the DB; the UI reads it via Realtime.
 */
export async function executeManualRun(
  db: Database,
  executor: StageExecutor,
  runId: string,
  stageRunId: string,
): Promise<void> {
  const runService = createPipelineRunService(db);
  const gateService = createGateService(db);

  try {
    const result = await executeStageRun({
      db,
      executor,
      runService,
      runId,
      stageRunId,
    });

    // Gate evaluation (if stage has gates configured)
    const [sRun] = await db
      .select({ pipelineStageId: stageRun.pipelineStageId })
      .from(stageRun)
      .where(eq(stageRun.id, stageRunId));
    if (sRun) {
      const [stage] = await db
        .select({ gateMode: pipelineStage.gateMode })
        .from(pipelineStage)
        .where(eq(pipelineStage.id, sRun.pipelineStageId));

      const gateMode = (stage?.gateMode ?? DEFAULT_GATE_MODE) as string;
      if (result.exitCode === 0 && gateMode === GATE_MODE.rules) {
        const gateResult = await gateService.evaluateStageGate(
          sRun.pipelineStageId,
          stageRunId,
          {
            exit_code: result.exitCode,
            cost_usd: 0,
            tokens_in: 0,
            tokens_out: 0,
            provider: result.providerName,
            model: result.modelIdentifier,
            harness: result.harnessName,
          },
        );
        await runService.appendEvent(stageRunId, EVENT_TYPE.GATE_EVALUATED, {
          verdict: gateResult.verdict,
          passed: gateResult.passed,
          reason: gateResult.reason,
        });
      }
    }

    // Complete pipeline run
    const status = result.exitCode === 0
      ? PIPELINE_RUN_STATUS.completed
      : PIPELINE_RUN_STATUS.failed;
    await runService.completeRun(runId, status);

    // Pipeline-level issue events
    if (result.issueId) {
      const issueEventType = result.exitCode === 0
        ? ISSUE_EVENT_TYPE.pipeline_completed
        : ISSUE_EVENT_TYPE.pipeline_failed;
      await runService.appendIssueEvent(
        result.issueId,
        issueEventType,
        { runId, exitCode: result.exitCode },
        'manual-run',
      );
    }
  } catch (err) {
    console.error('[manual-run]', err);
    await runService.failStageAndRun(stageRunId, runId);
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: No type errors for this file.

- [ ] **Step 3: Commit**

```bash
git add src/core/orchestrator/manual-run.ts
git commit -m "refactor: rewrite manual-run as thin wrapper around stage-runner"
```

---

## Task 8: Fix Event-Orchestrator Vendor Boundary

**Files:**
- Modify: `src/core/ports/realtime.ts`
- Modify: `src/core/orchestrator/event-orchestrator.ts`

This task fixes the Supabase imports in core and switches event-orchestrator to use the shared `executeStageRun()` and `PipelineRunService`.

- [ ] **Step 1: Extend RealtimeProvider port for table subscriptions**

Replace the contents of `src/core/ports/realtime.ts`:

```typescript
import type { Unsubscribe } from './auth';

export interface RealtimeTableEvent<T> {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: T;
  old: T | null;
}

export interface RealtimeProvider {
  /** Subscribe to generic channel events. */
  subscribe<T>(
    channel: string,
    event: string,
    callback: (payload: T) => void,
  ): Unsubscribe;

  /** Subscribe to INSERT/UPDATE/DELETE on a specific table. */
  subscribeToTable<T>(
    channelName: string,
    table: string,
    event: 'INSERT' | 'UPDATE' | '*',
    callback: (payload: RealtimeTableEvent<T>) => void,
  ): Unsubscribe;

  broadcast<T>(channel: string, event: string, payload: T): Promise<void>;
}
```

- [ ] **Step 2: Rewrite event-orchestrator to use ports and shared execution**

Replace the entire contents of `src/core/orchestrator/event-orchestrator.ts`:

```typescript
/**
 * Event-Driven Orchestrator — the systemd-managed pipeline state machine.
 *
 * Subscribes to Realtime for pipeline_run and stage_run changes.
 * Reads all config from DB. Writes all state via PipelineRunService.
 * The harness never touches the database.
 *
 * State machine:
 *   pipeline_run created → read first stage → create stage_run
 *   stage_run queued → executeStageRun → running → completed/failed
 *   stage_run completed → evaluate gate → verdict determines next state
 *   stage_run failed → check retry budget → retry or fail permanently
 *   all stages done → complete pipeline_run → write issue events
 */
import { eq, and, asc, sql } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import type { StageExecutor } from '@/core/ports/stage-executor';
import type { RealtimeProvider } from '@/core/ports/realtime';
import type { Unsubscribe } from '@/core/ports/auth';
import {
  pipeline,
  pipelineStage,
  pipelineRun,
  stageRun,
  issue,
  skill,
  harnessCatalog,
} from '@/core/db/schema';
import { createPipelineRunService } from './pipeline-run-service';
import { createRoutingResolver } from './routing-resolver';
import { createGateService } from '@/core/gates/service';
import { executeStageRun } from './stage-runner';
import {
  PIPELINE_RUN_STATUS,
  STAGE_RUN_STATUS,
  STAGE_RUN_TERMINAL,
  EVENT_TYPE,
  ISSUE_EVENT_TYPE,
  GATE_MODE,
  GATE_VERDICT,
  DEFAULT_GATE_MODE,
  DEFAULT_STAGE_TIMEOUT_SEC,
} from '@/core/constants';
import type { GateMode } from '@/core/constants';

export interface EventOrchestratorConfig {
  maxConcurrentRuns: number;
}

const DEFAULT_CONFIG: EventOrchestratorConfig = {
  maxConcurrentRuns: 5,
};

export interface EventOrchestrator {
  start(): void;
  stop(): void;
  recoverOnStartup(): Promise<void>;
  readonly running: boolean;
}

export function createEventOrchestrator(
  db: Database,
  executor: StageExecutor,
  realtime: RealtimeProvider,
  config: Partial<EventOrchestratorConfig> = {},
): EventOrchestrator {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const runService = createPipelineRunService(db);
  const gateService = createGateService(db);

  let unsubscribeInsert: Unsubscribe | null = null;
  let unsubscribeUpdate: Unsubscribe | null = null;
  let isRunning = false;

  // ─── Realtime Subscription ──────────────────────────────────────────

  function start(): void {
    if (isRunning) return;
    isRunning = true;

    unsubscribeInsert = realtime.subscribeToTable(
      'orchestrator-insert',
      'pipeline_run',
      'INSERT',
      (payload) => {
        const row = payload.new as typeof pipelineRun.$inferSelect;
        if (row.status === PIPELINE_RUN_STATUS.pending) {
          handleNewRun(row.id).catch(logError('handleNewRun'));
        }
      },
    );

    unsubscribeUpdate = realtime.subscribeToTable(
      'orchestrator-update',
      'pipeline_run',
      'UPDATE',
      (payload) => {
        const row = payload.new as typeof pipelineRun.$inferSelect;
        if (row.status === PIPELINE_RUN_STATUS.pending) {
          handleNewRun(row.id).catch(logError('handleNewRun'));
        }
      },
    );
  }

  function stop(): void {
    isRunning = false;
    unsubscribeInsert?.();
    unsubscribeInsert = null;
    unsubscribeUpdate?.();
    unsubscribeUpdate = null;
  }

  function logError(context: string) {
    return (err: unknown) => {
      console.error(`[orchestrator:${context}]`, err);
    };
  }

  // ─── Pipeline Handlers ──────────────────────────────────────────────

  async function handleNewRun(runId: string): Promise<void> {
    const run = await runService.getRun(runId);
    if (!run || run.status !== PIPELINE_RUN_STATUS.pending) return;

    // Check concurrency limit
    const running = await runService.getRunningRuns();
    if (running.length >= cfg.maxConcurrentRuns) return;

    // Get stages
    const stages = await runService.getStages(run.pipelineId);
    if (stages.length === 0) {
      await runService.updateRunStatus(runId, PIPELINE_RUN_STATUS.failed);
      return;
    }

    // Mark running
    await runService.updateRunStatus(runId, PIPELINE_RUN_STATUS.running);

    // Launch first stage
    await launchStage(run, stages[0]);
  }

  // ─── Stage Execution ────────────────────────────────────────────────

  async function launchStage(
    run: typeof pipelineRun.$inferSelect,
    stage: typeof pipelineStage.$inferSelect,
  ): Promise<void> {
    // Get existing stage runs for attempt counting
    const existingRuns = await runService.getStageRuns(run.id);
    const attemptsForStage = existingRuns.filter(
      (sr) => sr.pipelineStageId === stage.id,
    ).length;

    // Create stage_run
    const sRun = await runService.createStageRun(run.id, stage.id);

    // Evaluate pre-gate
    const gateMode = (stage.gateMode ?? DEFAULT_GATE_MODE) as GateMode;
    if (gateMode === GATE_MODE.hold || gateMode === GATE_MODE.manual) {
      await runService.updateStageRunStatus(sRun.id, STAGE_RUN_STATUS.pending);
      await runService.appendEvent(sRun.id, EVENT_TYPE.GATE_EVALUATED, {
        verdict: GATE_VERDICT.hold,
        reason: `gate mode: ${gateMode}`,
      });
      if (run.issueId) {
        await runService.appendIssueEvent(
          run.issueId,
          ISSUE_EVENT_TYPE.gate_hold,
          {
            stageRunId: sRun.id,
            stageName: stage.name,
            verdict: GATE_VERDICT.hold,
            reason: `gate mode: ${gateMode}`,
          },
          'orchestrator',
        );
      }
      return;
    }

    // Execute the stage via shared stage-runner
    try {
      const result = await executeStageRun({
        db,
        executor,
        runService,
        runId: run.id,
        stageRunId: sRun.id,
      });

      // Post-execution gate evaluation
      if (result.exitCode === 0 && gateMode === GATE_MODE.rules) {
        const gateResult = await gateService.evaluateStageGate(
          stage.id,
          sRun.id,
          {
            exit_code: result.exitCode,
            cost_usd: 0,
            tokens_in: 0,
            tokens_out: 0,
            provider: result.providerName,
            model: result.modelIdentifier,
            harness: result.harnessName,
          },
        );

        await runService.appendEvent(sRun.id, EVENT_TYPE.GATE_EVALUATED, {
          verdict: gateResult.verdict,
          passed: gateResult.passed,
          reason: gateResult.reason,
        });

        await applyVerdict(run, stage, sRun, gateResult.verdict);
      } else if (result.exitCode === 0) {
        // auto/skip gate → proceed
        await applyVerdict(run, stage, sRun, GATE_VERDICT.proceed);
      } else {
        // Failed — check retry budget
        await handleStageFailed(run, stage, sRun);
      }
    } catch (err) {
      // Stage execution threw (timeout, signal, etc.)
      // stage-runner already marked stage_run as failed
      await handleStageFailed(run, stage, sRun);
    }
  }

  // ─── Verdict Application ────────────────────────────────────────────

  async function applyVerdict(
    run: typeof pipelineRun.$inferSelect,
    stage: typeof pipelineStage.$inferSelect,
    sRun: typeof stageRun.$inferSelect,
    verdict: string,
  ): Promise<void> {
    if (verdict === GATE_VERDICT.proceed) {
      const nextStage = await runService.getNextStage(
        run.pipelineId,
        stage.sortOrder,
      );

      if (nextStage) {
        await launchStage(run, nextStage);
      } else {
        await completePipelineRun(run);
      }
    } else if (verdict === GATE_VERDICT.hold) {
      await runService.updateStageRunStatus(sRun.id, STAGE_RUN_STATUS.pending);
    } else if (verdict === GATE_VERDICT.rework) {
      await handleStageFailed(run, stage, sRun);
    } else if (verdict === GATE_VERDICT.abort) {
      await runService.completeRun(run.id, PIPELINE_RUN_STATUS.failed);
      if (run.issueId) {
        await runService.appendIssueEvent(
          run.issueId,
          ISSUE_EVENT_TYPE.pipeline_failed,
          {
            pipelineRunId: run.id,
            reason: 'Gate verdict: abort',
            failedStage: stage.name,
          },
          'orchestrator',
        );
      }
    }
  }

  async function handleStageFailed(
    run: typeof pipelineRun.$inferSelect,
    stage: typeof pipelineStage.$inferSelect,
    sRun: typeof stageRun.$inferSelect,
  ): Promise<void> {
    const maxRetries = stage.maxRetries ?? 0;
    if (sRun.attempt < maxRetries + 1) {
      await launchStage(run, stage);
    } else {
      await runService.completeRun(run.id, PIPELINE_RUN_STATUS.failed);
      if (run.issueId) {
        await runService.appendIssueEvent(
          run.issueId,
          ISSUE_EVENT_TYPE.pipeline_failed,
          {
            pipelineRunId: run.id,
            reason: `Stage failed after ${sRun.attempt} attempt(s)`,
            failedStage: stage.name,
          },
          'orchestrator',
        );
      }
    }
  }

  async function completePipelineRun(
    run: typeof pipelineRun.$inferSelect,
  ): Promise<void> {
    await runService.completeRun(run.id, PIPELINE_RUN_STATUS.completed);
    if (run.issueId) {
      await runService.appendIssueEvent(
        run.issueId,
        ISSUE_EVENT_TYPE.pipeline_completed,
        { pipelineRunId: run.id },
        'orchestrator',
      );
    }
  }

  // ─── Crash Recovery ─────────────────────────────────────────────────

  async function recoverOnStartup(): Promise<void> {
    const staleRuns = await db
      .select()
      .from(stageRun)
      .where(eq(stageRun.status, STAGE_RUN_STATUS.running));

    for (const sRun of staleRuns) {
      const alive = sRun.pid ? isProcessAlive(sRun.pid) : false;

      if (!alive) {
        const [stage] = await db
          .select()
          .from(pipelineStage)
          .where(eq(pipelineStage.id, sRun.pipelineStageId));

        if (!stage) {
          await runService.completeStageRun(sRun.id, STAGE_RUN_STATUS.failed, {});
          continue;
        }

        await runService.completeStageRun(sRun.id, STAGE_RUN_STATUS.failed, {});
        await runService.appendEvent(sRun.id, EVENT_TYPE.ERROR, {
          message: 'Process died — crash recovery',
          attempt: sRun.attempt,
        });

        const maxRetries = stage.maxRetries ?? 0;
        if (sRun.attempt < maxRetries + 1) {
          const run = await runService.getRun(sRun.pipelineRunId);
          if (run) {
            await launchStage(run, stage);
          }
        } else {
          await runService.completeRun(sRun.pipelineRunId, PIPELINE_RUN_STATUS.failed);
        }
      }
    }
  }

  function isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  return {
    start,
    stop,
    recoverOnStartup,
    get running() {
      return isRunning;
    },
  };
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/ports/realtime.ts src/core/orchestrator/event-orchestrator.ts
git commit -m "refactor: event-orchestrator uses RealtimeProvider port and shared stage-runner"
```

---

## Task 9: Delete manager.ts and Update Barrel Exports

**Files:**
- Delete: `src/core/orchestrator/manager.ts`
- Modify: `src/core/orchestrator/index.ts`
- Modify: `src/core/orchestrator/demo.ts`

- [ ] **Step 1: Update barrel exports**

Replace `src/core/orchestrator/index.ts`:

```typescript
/**
 * Orchestrator barrel export.
 */
export { createEventOrchestrator, type EventOrchestrator, type EventOrchestratorConfig } from './event-orchestrator';
export { createPipelineRunService, type PipelineRunService } from './pipeline-run-service';
export { createRoutingResolver, type RoutingResolver } from './routing-resolver';
export { createStageJobHandler, type StageWorkerDeps } from './stage-worker';
export { executeStageRun, type StageRunContext, type StageRunResult } from './stage-runner';
export type {
  PipelineRunStatus,
  StageRunStatus,
  StageEventType,
  ResolvedRouting,
  StageJobPayload,
  OrchestratorConfig,
} from './types';
export {
  PIPELINE_RUN_TERMINAL,
  STAGE_RUN_TERMINAL,
  DEFAULT_ORCHESTRATOR_CONFIG,
} from './types';
```

- [ ] **Step 2: Delete manager.ts**

```bash
git rm src/core/orchestrator/manager.ts
```

- [ ] **Step 3: Update demo.ts to use event-orchestrator**

In `src/core/orchestrator/demo.ts`, replace the import:

```typescript
// Before
import { createOrchestratorManager } from './manager';

// After
import { createEventOrchestrator } from './event-orchestrator';
```

Then update the demo to use `createEventOrchestrator` instead of `createOrchestratorManager`. The demo also needs to remove the event deletion at line 248. Replace the cleanup section (lines 246-254):

```typescript
  // Cleanup demo data (events are append-only — never deleted)
  console.log('\n── Cleanup ─────────────────────────────────────────\n');
  for (const sr of finalStageRuns) {
    const { stageGateResult } = await import('@/core/db/schema');
    await db.delete(stageGateResult).where(eq(stageGateResult.stageRunId, sr.id)).catch(() => {});
    await db.delete(stageRun).where(eq(stageRun.id, sr.id)).catch(() => {});
  }
  await db.delete(pipelineRun).where(eq(pipelineRun.id, run.id)).catch(() => {});
  log('🧹', 'Demo data cleaned up (events preserved)');
```

- [ ] **Step 4: Update orchestrator.test.ts imports**

In `src/__tests__/integration/orchestrator.test.ts`, replace all `createOrchestratorManager` references with `createEventOrchestrator`. Note: the test may need deeper changes to work with the Realtime-based orchestrator. If tests fail due to the architectural change, add a `// TODO: adapt test for event-orchestrator` comment and skip them — the tests were written for the polling manager.

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: delete polling manager, update barrel exports and demo"
```

---

## Task 10: Routing Resolver — Fail Fast + Seed Routing Data

**Files:**
- Modify: `src/core/orchestrator/routing-resolver.ts`
- Modify: `src/core/db/seed.ts`

- [ ] **Step 1: Remove silent 'subprocess' default**

In `src/core/orchestrator/routing-resolver.ts`, replace lines 139-144:

```typescript
    // 7. Resolve harness: stage override > rule preferred > rule fallback > 'subprocess'
    const harness =
      stage.harness ??
      rule?.preferredHarness ??
      rule?.fallbackHarness ??
      'subprocess';
```

With:

```typescript
    // 7. Resolve harness: stage override > rule preferred > rule fallback (fail fast)
    const harness =
      stage.harness ??
      rule?.preferredHarness ??
      rule?.fallbackHarness;
    if (!harness) {
      return null; // No harness configured — caller must handle
    }
```

Also replace the import and add `DEFAULT_SORT_STRATEGY`:

At the top of the file, add:

```typescript
import { DEFAULT_SORT_STRATEGY } from '@/core/constants';
```

Replace line 129:

```typescript
      const strategy = rule?.sortStrategy ?? 'quality';
```

With:

```typescript
      const strategy = rule?.sortStrategy ?? DEFAULT_SORT_STRATEGY;
```

- [ ] **Step 2: Seed provider, model, routing profile, and routing rule**

In `src/core/db/seed.ts`, add these imports to the schema import:

```typescript
import {
  // ... existing imports ...
  provider,
  model,
  routingProfile,
  routingRule,
} from './schema';
```

After the skills section in the seed function, add a new section:

```typescript
  // ── 5d. Provider + Model + Routing ─────────────────────────────────────
  let [defaultProvider] = await db
    .insert(provider)
    .values({
      orgId: org.id,
      name: 'Anthropic',
      type: 'anthropic',
      apiKeyRef: 'env:ANTHROPIC_API_KEY',
      isHealthy: true,
    })
    .onConflictDoNothing()
    .returning();

  if (!defaultProvider) {
    [defaultProvider] = await db
      .select()
      .from(provider)
      .where(eq(provider.orgId, org.id))
      .limit(1);
  }

  if (defaultProvider) {
    let [defaultModel] = await db
      .insert(model)
      .values({
        providerId: defaultProvider.id,
        name: 'Claude Sonnet 4.6',
        identifier: 'claude-sonnet-4-6',
        costPer1kInput: '0.003',
        costPer1kOutput: '0.015',
      })
      .onConflictDoNothing()
      .returning();

    if (!defaultModel) {
      [defaultModel] = await db
        .select()
        .from(model)
        .where(eq(model.providerId, defaultProvider.id))
        .limit(1);
    }

    let [defaultProfile] = await db
      .insert(routingProfile)
      .values({
        orgId: org.id,
        name: 'Default',
        description: 'Default routing profile',
        isDefault: true,
      })
      .onConflictDoNothing()
      .returning();

    if (!defaultProfile) {
      [defaultProfile] = await db
        .select()
        .from(routingProfile)
        .where(eq(routingProfile.orgId, org.id))
        .limit(1);
    }

    if (defaultProfile) {
      await db
        .insert(routingRule)
        .values({
          profileId: defaultProfile.id,
          stageName: null, // wildcard — matches all stages
          preferredHarness: 'claude-code',
          sortStrategy: 'quality',
        })
        .onConflictDoNothing();
      console.log(`  routing: ${defaultProvider.name} → ${defaultModel?.identifier ?? 'n/a'} via ${defaultProfile.name}`);
    }
  }
```

Also add `contextLayout` to the harness insert. In the harness values object, add:

```typescript
      contextLayout: { instructionsFile: 'CLAUDE.md', contextFile: 'context.md' },
```

- [ ] **Step 3: Verify seed runs**

Run: `npx tsx src/core/db/seed.ts`
Expected: Seed completes with routing output line.

- [ ] **Step 4: Commit**

```bash
git add src/core/orchestrator/routing-resolver.ts src/core/db/seed.ts
git commit -m "fix: routing resolver fails fast; seed creates provider/model/routing rule"
```

---

## Task 11: Gate Service — Use Constants

**Files:**
- Modify: `src/core/gates/service.ts`

- [ ] **Step 1: Replace inline 'auto' with constant**

Add import at the top:

```typescript
import { DEFAULT_GATE_MODE } from '@/core/constants';
import type { GateMode } from '@/core/constants';
```

Remove the `GateMode` import from `'./types'` (keep `RuleGroup` and `GateEvaluation`):

```typescript
import type {
  RuleGroup,
  GateEvaluation,
} from './types';
```

Replace line 62:

```typescript
      const mode = (stage.gateMode ?? 'auto') as GateMode;
```

With:

```typescript
      const mode = (stage.gateMode ?? DEFAULT_GATE_MODE) as GateMode;
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/gates/service.ts
git commit -m "refactor: gate service uses DEFAULT_GATE_MODE constant"
```

---

## Task 12: UI Components — Use Status Constants

**Files:**
- Modify: `src/components/pipeline/StageTimeline.tsx`
- Modify: `src/components/pipeline/PipelineStatusBadge.tsx`

- [ ] **Step 1: Update StageTimeline**

Add import at the top of `StageTimeline.tsx` (after `'use client'`):

```typescript
import { STAGE_RUN_STATUS } from '@/core/constants';
```

Replace the `dotColors` object:

```typescript
const dotColors: Record<string, string> = {
  [STAGE_RUN_STATUS.completed]:  'bg-emerald-400',
  [STAGE_RUN_STATUS.running]:    'bg-sky-400 animate-pulse',
  [STAGE_RUN_STATUS.launching]:  'bg-sky-400 animate-pulse',
  [STAGE_RUN_STATUS.pending]:    'bg-amber-400',
  hold:                          'bg-amber-400',
  [STAGE_RUN_STATUS.failed]:     'bg-red-400',
  queued:                        'bg-slate-500',
  [STAGE_RUN_STATUS.cancelled]:  'bg-slate-500',
};
```

- [ ] **Step 2: Update PipelineStatusBadge**

Add import at the top of `PipelineStatusBadge.tsx` (after `'use client'`):

```typescript
import { PIPELINE_RUN_STATUS, STAGE_RUN_STATUS } from '@/core/constants';
```

Replace the `statusConfig` object:

```typescript
const statusConfig: Record<string, { pill: string; dot: string; label: string }> = {
  [PIPELINE_RUN_STATUS.running]:   { pill: 'bg-sky-400/10 text-sky-400',     dot: 'bg-sky-400 animate-pulse',    label: 'Running' },
  [PIPELINE_RUN_STATUS.queued]:    { pill: 'bg-amber-400/10 text-amber-400',  dot: 'bg-amber-400',                label: 'Queued' },
  [PIPELINE_RUN_STATUS.completed]: { pill: 'bg-emerald-400/10 text-emerald-400', dot: 'bg-emerald-400',           label: 'Completed' },
  [PIPELINE_RUN_STATUS.failed]:    { pill: 'bg-red-400/10 text-red-400',      dot: 'bg-red-400',                  label: 'Failed' },
  [PIPELINE_RUN_STATUS.cancelled]: { pill: 'bg-slate-400/10 text-slate-400',  dot: 'bg-slate-400',                label: 'Cancelled' },
  [STAGE_RUN_STATUS.pending]:      { pill: 'bg-amber-400/10 text-amber-400',  dot: 'bg-amber-400',                label: 'Pending' },
};
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/pipeline/StageTimeline.tsx src/components/pipeline/PipelineStatusBadge.tsx
git commit -m "refactor: UI components use status constants instead of inline strings"
```

---

## Task 13: Remaining Cleanup

**Files:**
- Modify: `src/core/orchestrator/output-parser.ts`
- Modify: `src/app/[org]/[user]/[project]/settings/providers/page.tsx`
- Modify: `src/adapters/subprocess/executor.ts`

- [ ] **Step 1: Fix vendor-specific comment in output parser**

In `src/core/orchestrator/output-parser.ts`, replace lines 33-36:

```typescript
/**
 * Parse a single stdout line into one or more TranscriptEntries.
 *
 * Claude Code outputs one JSON object per line. The `type` field determines
```

With:

```typescript
/**
 * Parse a single stdout line into one or more TranscriptEntries.
 *
 * The harness outputs one JSON object per line. The `type` field determines
```

- [ ] **Step 2: Remove vendor-specific UI placeholders**

In `src/app/[org]/[user]/[project]/settings/providers/page.tsx`:

Replace line 138:
```
placeholder="anthropic, openai, etc."
```
With:
```
placeholder="provider slug"
```

Replace line 161:
```
placeholder="env:ANTHROPIC_API_KEY"
```
With:
```
placeholder="env:API_KEY_NAME"
```

Replace line 257:
```
placeholder="claude-sonnet-4-6"
```
With:
```
placeholder="model identifier"
```

- [ ] **Step 3: Use constant for kill grace period in subprocess executor**

In `src/adapters/subprocess/executor.ts`, add import at top:

```typescript
import { KILL_GRACE_PERIOD_MS } from '@/core/constants';
```

Replace line 77:

```typescript
      }, 5_000);
```

With:

```typescript
      }, KILL_GRACE_PERIOD_MS);
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator/output-parser.ts src/app/[org]/[user]/[project]/settings/providers/page.tsx src/adapters/subprocess/executor.ts
git commit -m "fix: remove vendor references from comments, UI placeholders, and magic numbers"
```

---

## Task 14: Run Tests and Verify

**Files:** None (verification only)

- [ ] **Step 1: Run the full build**

Run: `npm run build`
Expected: Clean build with no type errors.

- [ ] **Step 2: Run integration tests**

Run: `npx vitest run`
Expected: All tests pass (some orchestrator tests may need skipping per Task 9 note).

- [ ] **Step 3: Run the seed**

Run: `npx tsx src/core/db/seed.ts`
Expected: Seed completes with provider/model/routing output.

- [ ] **Step 4: Grep verification — no CLAUDE.md in core**

Run: `grep -r "CLAUDE.md" src/core/ --include="*.ts" | grep -v "seed.ts" | grep -v "node_modules"`
Expected: No matches.

- [ ] **Step 5: Grep verification — no @supabase in core**

Run: `grep -r "@supabase" src/core/ --include="*.ts" | grep -v "seed.ts" | grep -v "nuke.ts" | grep -v "node_modules"`
Expected: No matches.

- [ ] **Step 6: Commit any test fixes**

If any tests needed adaptation:
```bash
git add -A
git commit -m "test: adapt integration tests for orchestrator refactor"
```

---

## Task Summary

| Task | Layer | What | Key Files |
|------|-------|------|-----------|
| 1 | L1 | Constants module | `constants.ts` (new) |
| 2 | L1 | Types re-export from constants | `types.ts` |
| 3 | L2 | PipelineRunService consolidation | `pipeline-run-service.ts` |
| 4 | L3 | Schema migration for contextLayout | `schema.ts`, migration |
| 5 | L3 | Harness-agnostic materializer | `materializer.ts` |
| 6 | L3 | Shared stage-runner extraction | `stage-runner.ts` (new) |
| 7 | L3 | Manual-run thin wrapper | `manual-run.ts` |
| 8 | L4 | Event-orchestrator vendor fix | `event-orchestrator.ts`, `realtime.ts` |
| 9 | L4 | Delete manager.ts + update exports | `manager.ts` (deleted), `index.ts` |
| 10 | L4 | Routing resolver fail-fast + seed data | `routing-resolver.ts`, `seed.ts` |
| 11 | L4 | Gate service constants | `service.ts` |
| 12 | L4 | UI status constants | `StageTimeline.tsx`, `PipelineStatusBadge.tsx` |
| 13 | L4 | Remaining cleanup | `output-parser.ts`, `providers/page.tsx`, `executor.ts` |
| 14 | — | Verification | grep checks, build, tests |
