# FLX-109 Parallel Group Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement concurrent execution of `parallel` playbook stage groups so that the `NotImplementedError` guard in `event-orchestrator.ts` is replaced with real fan-out logic using `Promise.allSettled`, child result aggregation, and the existing audit/paperwork pipeline.

**Architecture:** A new `parallel-executor.ts` module (mirroring `loop-executor.ts`) handles all fan-out and aggregation logic. `event-orchestrator.ts` gains a third branch alongside the loop branch: detect `isParallelGroup`, delegate to `runParallelExecutor`, then hand a synthesized `ingestOutput` back to the shared audit path. Each child gets its own `stageRun` DB row (all pointing to the group's `pipelineStageId`) and a distinct LangGraph `threadId`. Aggregation rules (`all-pass`, `any-pass`, `majority-pass`, `none`) collapse N child verdicts into a single group verdict before routing.

**Tech Stack:** TypeScript, Vitest (integration tests — mock `runStageGraph` via `vi.mock`), Drizzle ORM, existing `runStageGraph` / `createStageRun` / `completeStageRun` ports.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/core/agents/parallel-executor.ts` | **Create** | Fan-out N children via `Promise.allSettled`, aggregate verdicts, return synthesized ingest output |
| `src/core/orchestrator/event-orchestrator.ts` | **Modify** | Replace `NotImplementedError` guard with `runParallelExecutor` branch (lines 271–275) |
| `src/__tests__/integration/parallel-executor.test.ts` | **Create** | Unit tests for `runParallelExecutor` (mock `runStageGraph` + `createStageRun`) |
| `src/core/pipeline/bundled/playbooks/parallel-smoke.yaml` | **Create** | Minimal 2-child parallel playbook for integration verification |

---

## Task 1: `parallel-executor.ts` — types, aggregation logic, and unit tests

**Files:**
- Create: `src/core/agents/parallel-executor.ts`
- Create: `src/__tests__/integration/parallel-executor.test.ts`

### Background

The executor must:
1. Call `createStageRun(pipelineRunId, groupPipelineStageId)` once per child to get `childStageRunId` values.
2. Fan out `runStageGraph` for each child via `Promise.allSettled` (never `Promise.all` — one child failing must not cancel others).
3. Parse each child's `ingestOutput` → `verdict` (`'pass'` | `'fail'` | `null` on error).
4. Apply `aggregation` rule to collapse N verdicts → group verdict.
5. Return a synthesized ingest output string matching the `{ valid, doc }` shape that `event-orchestrator.ts` already parses.

### Aggregation rules

| Rule | Group verdict |
|------|---------------|
| `all-pass` | `pass` iff every child verdict is `pass` |
| `any-pass` | `pass` iff at least one child verdict is `pass` |
| `majority-pass` | `pass` iff `passCount > children.length / 2` |
| `none` | always `pass` (aggregation not applied — children run for side-effects) |

### Steps

- [ ] **Step 1: Write the failing tests**

Create `/mnt/dev/fluxaos/src/__tests__/integration/parallel-executor.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/adapters/langgraph/langgraph-stage-runner', () => ({
  runStageGraph: vi.fn(),
}));

import { runStageGraph } from '@/adapters/langgraph/langgraph-stage-runner';
import { runParallelExecutor } from '@/core/agents/parallel-executor';
import type { ParallelExecutorInput } from '@/core/agents/parallel-executor';

const mockRunStageGraph = vi.mocked(runStageGraph);

const makePassOutput = (stageRunId: string) =>
  JSON.stringify({
    valid: true,
    doc: {
      issue: { id: 'i1', number: 1, title: 'T' },
      run: { pipelineRunId: 'p1', stageRunId, stage: 'child-a', attempt: 1 },
      org: { id: 'o1', slug: 'org' },
      project: { id: 'proj1', slug: 'proj' },
      timing: { startedAt: '2026-05-04T00:00:00Z' },
      verdict: 'pass',
      summary: 'Done.',
    },
  });

const makeFailOutput = (stageRunId: string) =>
  JSON.stringify({
    valid: true,
    doc: {
      issue: { id: 'i1', number: 1, title: 'T' },
      run: { pipelineRunId: 'p1', stageRunId, stage: 'child-b', attempt: 1 },
      org: { id: 'o1', slug: 'org' },
      project: { id: 'proj1', slug: 'proj' },
      timing: { startedAt: '2026-05-04T00:00:00Z' },
      verdict: 'fail',
      summary: 'Not done.',
    },
  });

const BASE_INPUT: ParallelExecutorInput = {
  pipelineRunId: 'run-001',
  groupPipelineStageId: 'pstage-001',
  artifactsBase: '/tmp/test-artifacts',
  children: [
    { id: 'child-a', skill: 'implement', stageRunId: 'srun-a' },
    { id: 'child-b', skill: 'review', stageRunId: 'srun-b' },
  ],
  aggregation: 'all-pass',
  driverCommand: 'npx',
  driverArgs: ['claude-code', '--headless'],
  prompt: 'Do the work.',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runParallelExecutor', () => {
  describe('aggregation: all-pass', () => {
    it('returns pass when all children pass', async () => {
      mockRunStageGraph
        .mockResolvedValueOnce({ ingestOutput: makePassOutput('srun-a') })
        .mockResolvedValueOnce({ ingestOutput: makePassOutput('srun-b') });

      const result = await runParallelExecutor(BASE_INPUT);
      const parsed = JSON.parse(result.ingestOutput) as { valid: boolean; doc: { verdict: string } };

      expect(parsed.valid).toBe(true);
      expect(parsed.doc.verdict).toBe('pass');
      expect(result.error).toBeUndefined();
    });

    it('returns fail when any child fails', async () => {
      mockRunStageGraph
        .mockResolvedValueOnce({ ingestOutput: makePassOutput('srun-a') })
        .mockResolvedValueOnce({ ingestOutput: makeFailOutput('srun-b') });

      const result = await runParallelExecutor(BASE_INPUT);
      const parsed = JSON.parse(result.ingestOutput) as { valid: boolean; doc: { verdict: string } };

      expect(parsed.doc.verdict).toBe('fail');
    });
  });

  describe('aggregation: any-pass', () => {
    it('returns pass when at least one child passes', async () => {
      mockRunStageGraph
        .mockResolvedValueOnce({ ingestOutput: makeFailOutput('srun-a') })
        .mockResolvedValueOnce({ ingestOutput: makePassOutput('srun-b') });

      const result = await runParallelExecutor({
        ...BASE_INPUT,
        aggregation: 'any-pass',
      });
      const parsed = JSON.parse(result.ingestOutput) as { valid: boolean; doc: { verdict: string } };

      expect(parsed.doc.verdict).toBe('pass');
    });

    it('returns fail when all children fail', async () => {
      mockRunStageGraph
        .mockResolvedValueOnce({ ingestOutput: makeFailOutput('srun-a') })
        .mockResolvedValueOnce({ ingestOutput: makeFailOutput('srun-b') });

      const result = await runParallelExecutor({
        ...BASE_INPUT,
        aggregation: 'any-pass',
      });
      const parsed = JSON.parse(result.ingestOutput) as { valid: boolean; doc: { verdict: string } };

      expect(parsed.doc.verdict).toBe('fail');
    });
  });

  describe('aggregation: majority-pass', () => {
    it('returns pass when majority pass (2 of 3)', async () => {
      mockRunStageGraph
        .mockResolvedValueOnce({ ingestOutput: makePassOutput('srun-a') })
        .mockResolvedValueOnce({ ingestOutput: makePassOutput('srun-b') })
        .mockResolvedValueOnce({ ingestOutput: makeFailOutput('srun-c') });

      const result = await runParallelExecutor({
        ...BASE_INPUT,
        children: [
          { id: 'child-a', skill: 'implement', stageRunId: 'srun-a' },
          { id: 'child-b', skill: 'review', stageRunId: 'srun-b' },
          { id: 'child-c', skill: 'test', stageRunId: 'srun-c' },
        ],
        aggregation: 'majority-pass',
      });
      const parsed = JSON.parse(result.ingestOutput) as { valid: boolean; doc: { verdict: string } };

      expect(parsed.doc.verdict).toBe('pass');
    });

    it('returns fail when majority fail (1 of 3)', async () => {
      mockRunStageGraph
        .mockResolvedValueOnce({ ingestOutput: makePassOutput('srun-a') })
        .mockResolvedValueOnce({ ingestOutput: makeFailOutput('srun-b') })
        .mockResolvedValueOnce({ ingestOutput: makeFailOutput('srun-c') });

      const result = await runParallelExecutor({
        ...BASE_INPUT,
        children: [
          { id: 'child-a', skill: 'implement', stageRunId: 'srun-a' },
          { id: 'child-b', skill: 'review', stageRunId: 'srun-b' },
          { id: 'child-c', skill: 'test', stageRunId: 'srun-c' },
        ],
        aggregation: 'majority-pass',
      });
      const parsed = JSON.parse(result.ingestOutput) as { valid: boolean; doc: { verdict: string } };

      expect(parsed.doc.verdict).toBe('fail');
    });
  });

  describe('aggregation: none', () => {
    it('always returns pass regardless of child verdicts', async () => {
      mockRunStageGraph
        .mockResolvedValueOnce({ ingestOutput: makeFailOutput('srun-a') })
        .mockResolvedValueOnce({ ingestOutput: makeFailOutput('srun-b') });

      const result = await runParallelExecutor({
        ...BASE_INPUT,
        aggregation: 'none',
      });
      const parsed = JSON.parse(result.ingestOutput) as { valid: boolean; doc: { verdict: string } };

      expect(parsed.doc.verdict).toBe('pass');
    });
  });

  describe('error handling', () => {
    it('treats a thrown child as a fail verdict (does not propagate)', async () => {
      mockRunStageGraph
        .mockRejectedValueOnce(new Error('subprocess crashed'))
        .mockResolvedValueOnce({ ingestOutput: makePassOutput('srun-b') });

      const result = await runParallelExecutor(BASE_INPUT); // all-pass
      const parsed = JSON.parse(result.ingestOutput) as { valid: boolean; doc: { verdict: string } };

      // one child crashed → treated as fail → all-pass fails
      expect(parsed.doc.verdict).toBe('fail');
      expect(result.childErrors).toHaveLength(1);
      expect(result.childErrors![0]).toMatch('srun-a');
    });

    it('runs all children even when one crashes (allSettled, not all)', async () => {
      mockRunStageGraph
        .mockRejectedValueOnce(new Error('crash'))
        .mockResolvedValueOnce({ ingestOutput: makePassOutput('srun-b') });

      await runParallelExecutor(BASE_INPUT);

      expect(mockRunStageGraph).toHaveBeenCalledTimes(2);
    });

    it('uses distinct threadIds for each child', async () => {
      mockRunStageGraph
        .mockResolvedValueOnce({ ingestOutput: makePassOutput('srun-a') })
        .mockResolvedValueOnce({ ingestOutput: makePassOutput('srun-b') });

      await runParallelExecutor(BASE_INPUT);

      const calls = mockRunStageGraph.mock.calls;
      const threadIds = calls.map((c) => c[2]);
      expect(new Set(threadIds).size).toBe(2);
      expect(threadIds[0]).toContain('srun-a');
      expect(threadIds[1]).toContain('srun-b');
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /mnt/dev/fluxaos/.worktrees/flx-109-parallel-group-execution
npx vitest run src/__tests__/integration/parallel-executor.test.ts
```

Expected: `Cannot find module '@/core/agents/parallel-executor'`

- [ ] **Step 3: Implement `parallel-executor.ts`**

Create `/mnt/dev/fluxaos/src/core/agents/parallel-executor.ts`:

```typescript
import { runStageGraph } from '@/adapters/langgraph/langgraph-stage-runner';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { isValidResultDoc } from '@/core/pipeline/result-doc';

export interface ParallelChild {
  id: string;
  skill: string;
  stageRunId: string;
}

export interface ParallelExecutorInput {
  pipelineRunId: string;
  groupPipelineStageId: string;
  artifactsBase: string;
  children: ParallelChild[];
  aggregation: 'all-pass' | 'any-pass' | 'majority-pass' | 'none';
  driverCommand: string;
  driverArgs: string[];
  prompt: string;
  env?: Record<string, string>;
  checkpointer?: BaseCheckpointSaver;
}

export interface ParallelExecutorResult {
  ingestOutput: string;
  error?: string;
  childErrors?: string[];
}

function aggregateVerdicts(
  verdicts: Array<'pass' | 'fail'>,
  rule: ParallelExecutorInput['aggregation']
): 'pass' | 'fail' {
  if (rule === 'none') return 'pass';
  const passCount = verdicts.filter((v) => v === 'pass').length;
  if (rule === 'all-pass') return passCount === verdicts.length ? 'pass' : 'fail';
  if (rule === 'any-pass') return passCount > 0 ? 'pass' : 'fail';
  // majority-pass
  return passCount > verdicts.length / 2 ? 'pass' : 'fail';
}

function synthIngestOutput(verdict: 'pass' | 'fail'): string {
  return JSON.stringify({
    valid: true,
    doc: {
      issue: { id: '', number: 0, title: '' },
      run: { pipelineRunId: '', stageRunId: '', stage: '', attempt: 1 },
      org: { id: '', slug: '' },
      project: { id: '', slug: '' },
      timing: { startedAt: new Date().toISOString() },
      verdict,
      summary: `Parallel group aggregation: ${verdict}`,
    },
  });
}

export async function runParallelExecutor(
  input: ParallelExecutorInput
): Promise<ParallelExecutorResult> {
  const tasks = input.children.map((child) => {
    const childResultDocPath = `${input.artifactsBase}/${child.id}/result.json`;
    const childArtifactsDir = `${input.artifactsBase}/${child.id}`;
    const threadId = `${child.stageRunId}_parallel_${child.id}`;

    return runStageGraph(
      {
        stageRunId: child.stageRunId,
        resultDocPath: childResultDocPath,
        artifactsDir: childArtifactsDir,
        prompt: input.prompt,
        driverCommand: input.driverCommand,
        driverArgs: input.driverArgs,
        env: input.env,
      },
      input.checkpointer,
      threadId
    );
  });

  const settled = await Promise.allSettled(tasks);

  const verdicts: Array<'pass' | 'fail'> = [];
  const childErrors: string[] = [];

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i]!;
    const child = input.children[i]!;

    if (outcome.status === 'rejected') {
      verdicts.push('fail');
      childErrors.push(`${child.stageRunId}: ${String(outcome.reason)}`);
      continue;
    }

    const { ingestOutput, error } = outcome.value;
    if (error) {
      verdicts.push('fail');
      childErrors.push(`${child.stageRunId}: ${error}`);
      continue;
    }

    let parsed: { valid: boolean; doc?: Record<string, unknown> };
    try {
      parsed = JSON.parse(ingestOutput) as typeof parsed;
    } catch {
      verdicts.push('fail');
      childErrors.push(`${child.stageRunId}: invalid JSON in ingest output`);
      continue;
    }

    const doc = parsed.valid && parsed.doc && isValidResultDoc(parsed.doc) ? parsed.doc : null;
    verdicts.push(doc?.verdict === 'pass' ? 'pass' : 'fail');
  }

  const groupVerdict = aggregateVerdicts(verdicts, input.aggregation);

  return {
    ingestOutput: synthIngestOutput(groupVerdict),
    childErrors: childErrors.length > 0 ? childErrors : undefined,
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/__tests__/integration/parallel-executor.test.ts
```

Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/parallel-executor.ts src/__tests__/integration/parallel-executor.test.ts
git commit -m "feat: parallel-executor with aggregation logic and tests (FLX-109)

Refs FLX-109"
```

---

## Task 2: Wire `runParallelExecutor` into `event-orchestrator.ts`

**Files:**
- Modify: `src/core/orchestrator/event-orchestrator.ts` — lines ~271–275 (NotImplementedError guard) and ~335 (loop branch) and `src/core/orchestrator/pipeline-run-service.ts` (read `createStageRun` signature)

### Background

The orchestrator's `launchStage` function already has three branches:
1. Pre-gate hold/manual → early return
2. Loop node → `runLoopExecutor` → shared audit path
3. Sequential → `runStageGraph` → shared audit path

We add branch 4: parallel group. The tricky part is that each child needs its own `stageRun` DB row. The orchestrator has access to `runService.createStageRun(pipelineRunId, pipelineStageId)`.

**Child stageRun rows:** All children share the group's `pipelineStageId` (the group stage's DB row id). This is fine — no unique constraint exists on `(pipelineRunId, pipelineStageId)`. The child `stageRun` rows serve as per-child execution records. Their `result_doc` columns are written by each child's `ingest-result-doc.ts` call.

**Child stage run lifecycle:** Children are created as `pending`, then `runParallelExecutor` handles execution. After `runParallelExecutor` returns, mark each child's `stageRun` status individually (completed/failed based on their individual verdict) and the group's `sRun` based on the aggregated verdict.

To do this, we need child stageRun IDs back from `runParallelExecutor`. The input already takes pre-created `stageRunId` per child — so the orchestrator creates them first, passes them in, then marks them after.

### Steps

- [ ] **Step 1: Read `createStageRun` signature**

Read `src/core/orchestrator/pipeline-run-service.ts` and find `createStageRun`. Confirm it takes `(pipelineRunId: string, pipelineStageId: string)` and returns a `stageRun` row with `.id`.

- [ ] **Step 2: Replace the NotImplementedError guard with the parallel branch**

In `src/core/orchestrator/event-orchestrator.ts`, locate the block at ~line 271:

```typescript
if (playbookStage && isParallelGroup(playbookStage)) {
  throw new Error(
    `NotImplementedError: parallel group execution is not yet supported (stage: ${stage.name})`
  );
}
```

Replace it with the following parallel branch (insert before the loop-node check, matching the loop pattern):

```typescript
if (playbookStage && isParallelGroup(playbookStage)) {
  const { runParallelExecutor } = await import(
    '@/core/agents/parallel-executor'
  );

  // Create a stageRun row for each child (all point to the group's pipelineStageId)
  const childStageRuns = await Promise.all(
    playbookStage.children.map(() =>
      runService.createStageRun(run.id, stage.id)
    )
  );

  await runService.updateStageRunStatus(sRun.id, STAGE_RUN_STATUS.running);

  const parallelCheckpointer = await getCheckpointer();
  const parallelResult = await runParallelExecutor({
    pipelineRunId: run.id,
    groupPipelineStageId: stage.id,
    artifactsBase,
    children: playbookStage.children.map((child, i) => ({
      id: child.id,
      skill: child.skill,
      stageRunId: childStageRuns[i]!.id,
    })),
    aggregation: playbookStage.aggregation,
    driverCommand: driverBinary,
    driverArgs,
    prompt: composedPrompt,
    env: {
      RESULT_DOC_PATH: resultDocPath,
      ARTIFACTS_DIR: artifactsBase,
    },
    checkpointer: parallelCheckpointer,
  });

  // Mark individual child stage runs
  for (let i = 0; i < childStageRuns.length; i++) {
    const childSRun = childStageRuns[i]!;
    const childError = parallelResult.childErrors?.find((e) =>
      e.startsWith(childSRun.id)
    );
    await runService.completeStageRun(
      childSRun.id,
      childError ? STAGE_RUN_STATUS.failed : STAGE_RUN_STATUS.completed,
      {}
    );
  }

  ingestOutput = parallelResult.ingestOutput;
  graphError = parallelResult.error;

  // fall through to shared audit path below
}
```

**Important:** The `ingestOutput` and `graphError` variables must be declared before all three branches (sequential, loop, parallel) so the shared audit path below can use them. Confirm these variables are declared with `let` before the if/else chain — they already are for the loop/sequential branches. If the parallel branch is inserted as an `else if` before the loop check, the existing `let ingestOutput: string; let graphError: string | undefined;` declarations cover it.

- [ ] **Step 3: Ensure the parallel branch feeds the shared audit path**

The shared audit path starts at the `if (graphError) { ... }` block after the if/else chain. Verify the parallel branch sets `ingestOutput` and `graphError` and then **falls through** to that block (no `return` at the end of the parallel branch — unlike the loop branch which has its own `return` after routing).

The parallel group's routing uses the existing `auditResultDoc` → `executePaperwork` → `completeStageRun(sRun.id)` → `launchStage(nextStage)` path, which is exactly correct.

- [ ] **Step 4: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run the parallel executor tests again to confirm nothing broke**

```bash
npx vitest run src/__tests__/integration/parallel-executor.test.ts
```

Expected: all 10 pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/orchestrator/event-orchestrator.ts
git commit -m "feat: wire runParallelExecutor into event-orchestrator launchStage (FLX-109)

Refs FLX-109"
```

---

## Task 3: Bundled parallel smoke playbook + integration verification

**Files:**
- Create: `src/core/pipeline/bundled/playbooks/parallel-smoke.yaml`
- Modify: `src/__tests__/integration/playbook-auditor.test.ts` — add parallel group auditor coverage

### Background

`auditResultDoc` in `playbook-auditor.ts` already handles parallel groups correctly as long as the synthesized result doc has a `verdict` field. The research confirmed this. We just need test coverage to lock it in.

We also create a smoke playbook for manual verification and as a seed fixture for future e2e work.

### Steps

- [ ] **Step 1: Verify `auditResultDoc` handles parallel groups**

Read `src/core/pipeline/playbook-auditor.ts`. Confirm that when `stageId` matches a `ParallelGroup`, it falls through to the `doc.verdict` dispatch using `stage.onPass` / `stage.onFail`. If there is a guard that throws for parallel groups, remove it. If it falls through naturally, proceed.

- [ ] **Step 2: Add parallel group coverage to `playbook-auditor.test.ts`**

Read `src/__tests__/integration/playbook-auditor.test.ts`. Add a `describe('parallel group stage')` block:

```typescript
describe('parallel group stage', () => {
  const parallelPlaybook: Playbook = {
    name: 'parallel-smoke',
    description: 'Two-child parallel smoke test',
    prompt: 'Run both children.',
    stages: [
      {
        type: 'parallel',
        id: 'parallel-review',
        children: [
          { id: 'child-a', skill: 'implement' },
          { id: 'child-b', skill: 'review' },
        ],
        aggregation: 'all-pass',
        onPass: 'done',
        onFail: 'blocked',
        fallback: 'blocked',
        rules: [],
      },
    ],
  };

  it('routes to onPass when aggregated verdict is pass', () => {
    const doc: ResultDoc = {
      issue: { id: 'i1', number: 1, title: 'T' },
      run: { pipelineRunId: 'p1', stageRunId: 's1', stage: 'parallel-review', attempt: 1 },
      org: { id: 'o1', slug: 'org' },
      project: { id: 'proj1', slug: 'proj' },
      timing: { startedAt: '2026-05-04T00:00:00Z' },
      verdict: 'pass',
      summary: 'All children passed.',
    };

    const audit = auditResultDoc(parallelPlaybook, 'parallel-review', doc);

    expect(audit.action).toBe('transition');
    expect(audit.targetState).toBe('done');
  });

  it('routes to onFail when aggregated verdict is fail', () => {
    const doc: ResultDoc = {
      issue: { id: 'i1', number: 1, title: 'T' },
      run: { pipelineRunId: 'p1', stageRunId: 's1', stage: 'parallel-review', attempt: 1 },
      org: { id: 'o1', slug: 'org' },
      project: { id: 'proj1', slug: 'proj' },
      timing: { startedAt: '2026-05-04T00:00:00Z' },
      verdict: 'fail',
      summary: 'Some children failed.',
    };

    const audit = auditResultDoc(parallelPlaybook, 'parallel-review', doc);

    expect(audit.action).toBe('transition');
    expect(audit.targetState).toBe('blocked');
  });

  it('routes to fallback when doc is null', () => {
    const audit = auditResultDoc(parallelPlaybook, 'parallel-review', null);

    expect(audit.targetState).toBe('blocked');
  });
});
```

- [ ] **Step 3: Run the auditor tests**

```bash
npx vitest run src/__tests__/integration/playbook-auditor.test.ts
```

Expected: all tests pass (including the new parallel group block).

- [ ] **Step 4: Create the smoke playbook**

Create `src/core/pipeline/bundled/playbooks/parallel-smoke.yaml`:

```yaml
name: parallel-smoke
description: Two-child parallel smoke playbook for development verification
prompt: |
  You are running a parallel review. Each child stage will independently
  evaluate the issue and return a verdict.

  Result doc path: {{RESULT_DOC_PATH}}
  Artifacts dir: {{ARTIFACTS_DIR}}

stages:
  - type: parallel
    id: parallel-review
    children:
      - id: child-a
        skill: implement
      - id: child-b
        skill: review
    aggregation: all-pass
    onPass: done
    onFail: blocked
    fallback: blocked
    rules: []
```

- [ ] **Step 5: Run full tsc check and all affected tests**

```bash
npx tsc --noEmit
npx vitest run src/__tests__/integration/parallel-executor.test.ts src/__tests__/integration/playbook-auditor.test.ts
```

Expected: tsc clean, all tests pass.

- [ ] **Step 6: Final commit**

```bash
git add \
  src/core/pipeline/bundled/playbooks/parallel-smoke.yaml \
  src/__tests__/integration/playbook-auditor.test.ts
git commit -m "feat: parallel smoke playbook + auditor test coverage for parallel groups (FLX-109)

Fixes FLX-109"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| Concurrent execution via `Promise.all` or similar | Task 1 (`Promise.allSettled`) |
| Merge result docs / decide aggregation strategy | Task 1 (all-pass / any-pass / majority-pass / none) |
| Wire each child through `runStageGraph` with its own `stageRunId` | Tasks 1 + 2 |
| Remove `NotImplementedError` guard | Task 2 |
| Each child gets its own `stageRunId` | Task 2 (orchestrator creates child stageRun rows) |
| `Promise.allSettled` not `Promise.all` (don't cancel on partial failure) | Task 1 |
| Distinct `threadId` per child | Task 1 (verified in test) |
| Group `sRun` stays running during children | Task 2 |
| Individual child `stageRun` rows marked completed/failed | Task 2 |
| Auditor handles parallel group result doc | Task 3 (verified + test coverage) |

**Placeholder scan:** No TBD/TODO/placeholder in any task. All code blocks are complete.

**Type consistency check:**
- `ParallelExecutorInput.children` is `Array<{ id, skill, stageRunId }>` — used consistently in Task 1 and Task 2.
- `ParallelExecutorResult.ingestOutput` and `.childErrors` — referenced consistently in Task 2 wiring.
- `aggregateVerdicts(verdicts, rule)` — defined in Task 1, used internally only.
- `synthIngestOutput(verdict)` — defined in Task 1, used internally only. The `doc` shape it produces is a minimal valid `ResultDoc` — the `auditResultDoc` call in the orchestrator reads `.verdict` from it via `isValidResultDoc` check.

**One note:** The `synthIngestOutput` function produces a skeletal `ResultDoc` with empty string IDs. `isValidResultDoc` must accept this. Read `src/core/pipeline/result-doc.ts` before implementing Task 1 to verify the schema — if it requires non-empty `issue.id`, `org.id`, etc., adjust the skeleton to use placeholder values like `'parallel-group'` instead of `''`.
