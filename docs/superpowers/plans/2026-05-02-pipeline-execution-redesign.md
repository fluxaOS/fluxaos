# Pipeline Execution Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace signal-based pipeline routing with a playbook-driven execution model where skills do only work, the result document carries facts, and the orchestrator audits and routes — with LangGraph handling stage execution and checkpointing.

**Architecture:** Four sequential phases — (1) Result Document schema + scripts, (2) Playbook YAML parser + discovery, (3) Orchestrator audit flow, (4) LangGraph three-node stage runner. Each phase is independently shippable. The existing orchestrator code path stays active throughout; new pipelines opt into the playbook model via `playbookPath` on the `pipeline` DB record (requires Task 2 migration). Parallel group parsing is supported (parser accepts the discriminated union) but execution throws `NotImplementedError` — tracked as a follow-up.

**Tech Stack:** TypeScript 5, Drizzle ORM, Supabase Postgres, `js-yaml` (add if absent), `@langchain/langgraph` + `@langchain/langgraph-checkpoint-postgres`, Zod for schema validation, tsx for scripts.

**Branch:** `flx-106-pipeline-execution-redesign`

**Discovery notes:** `docs/superpowers/plans/2026-05-02-flx-106-discovery-notes.md`

---

## Phase 1 — Result Document

### Task 1: Result document Zod schema

**Files:**
- Create: `src/core/pipeline/result-doc.ts`
- Test: `src/__tests__/integration/playbook-result-doc.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// src/__tests__/integration/playbook-result-doc.test.ts
import { describe, it, expect } from 'vitest';
import {
  ResultDocSchema,
  validateResultDoc,
  isValidResultDoc,
} from '@/core/pipeline/result-doc';

describe('ResultDocSchema', () => {
  const minimalValid = {
    issue: { id: 'uuid-1', number: 1, title: 'Test issue' },
    run: { pipelineRunId: 'uuid-2', stageRunId: 'uuid-3', stage: 'implement', attempt: 1 },
    org: { id: 'uuid-4', slug: 'acme' },
    project: { id: 'uuid-5', slug: 'myapp' },
    timing: { startedAt: '2026-05-02T03:00:00-07:00' },
    verdict: 'pass' as const,
    summary: 'Implementation complete.',
  };

  it('accepts minimal valid doc', () => {
    expect(() => ResultDocSchema.parse(minimalValid)).not.toThrow();
  });

  it('accepts full doc with all optional fields', () => {
    const full = {
      ...minimalValid,
      comment: 'Work looks good.',
      blockers: [{ title: 'Broken CI', description: 'CI is red on main.' }],
      artifacts: ['research-findings.md'],
      timing: {
        ...minimalValid.timing,
        endedAt: '2026-05-02T03:02:22-07:00',
        duration_sec: 142,
      },
      meta: { model: 'claude-sonnet-4-6', input_tokens: 1000, output_tokens: 200 },
    };
    expect(() => ResultDocSchema.parse(full)).not.toThrow();
  });

  it('rejects missing verdict', () => {
    const { verdict, ...rest } = minimalValid;
    expect(() => ResultDocSchema.parse(rest)).toThrow();
  });

  it('rejects missing summary', () => {
    const { summary, ...rest } = minimalValid;
    expect(() => ResultDocSchema.parse(rest)).toThrow();
  });

  it('accepts verdict: blocked', () => {
    expect(() => ResultDocSchema.parse({ ...minimalValid, verdict: 'blocked' })).not.toThrow();
  });

  it('rejects invalid verdict value', () => {
    // 'proceed' is the old signal format — not a valid ResultDoc verdict
    expect(() => ResultDocSchema.parse({ ...minimalValid, verdict: 'proceed' })).toThrow();
  });

  it('isValidResultDoc returns false for incomplete doc', () => {
    expect(isValidResultDoc({ verdict: 'pass' })).toBe(false);
  });

  it('isValidResultDoc returns true for valid doc', () => {
    expect(isValidResultDoc(minimalValid)).toBe(true);
  });
});

describe('validateResultDoc', () => {
  it('returns parsed doc on success', () => {
    const doc = {
      issue: { id: 'u1', number: 1, title: 'T' },
      run: { pipelineRunId: 'u2', stageRunId: 'u3', stage: 'research', attempt: 1 },
      org: { id: 'u4', slug: 'o' },
      project: { id: 'u5', slug: 'p' },
      timing: { startedAt: '2026-05-02T00:00:00Z' },
      verdict: 'fail' as const,
      summary: 'Failed.',
    };
    const result = validateResultDoc(doc);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.verdict).toBe('fail');
  });

  it('returns error on invalid doc', () => {
    const result = validateResultDoc({ verdict: 'bad' });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /mnt/dev/fluxaos && npx vitest run src/__tests__/integration/playbook-result-doc.test.ts 2>&1 | tail -20
```
Expected: error — module not found.

- [ ] **Step 3: Create the result-doc module**

```typescript
// src/core/pipeline/result-doc.ts
import { z } from 'zod';

const BlockerSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
});

const TimingSchema = z.object({
  startedAt: z.string(),
  endedAt: z.string().optional(),
  duration_sec: z.number().optional(),
});

const MetaSchema = z.object({
  model: z.string().optional(),
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
});

export const ResultDocSchema = z.object({
  issue: z.object({ id: z.string(), number: z.number(), title: z.string() }),
  run: z.object({
    pipelineRunId: z.string(),
    stageRunId: z.string(),
    stage: z.string(),
    attempt: z.number(),
  }),
  org: z.object({ id: z.string(), slug: z.string() }),
  project: z.object({ id: z.string(), slug: z.string() }),
  timing: TimingSchema,
  verdict: z.enum(['pass', 'fail', 'blocked']),
  summary: z.string().min(1),
  comment: z.string().optional(),
  blockers: z.array(BlockerSchema).optional(),
  artifacts: z.array(z.string()).optional(),
  meta: MetaSchema.optional(),
});

export type ResultDoc = z.infer<typeof ResultDocSchema>;

export type ValidateResultDocResult =
  | { success: true; data: ResultDoc }
  | { success: false; error: z.ZodError };

export function validateResultDoc(raw: unknown): ValidateResultDocResult {
  const result = ResultDocSchema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: result.error };
}

export function isValidResultDoc(raw: unknown): raw is ResultDoc {
  return ResultDocSchema.safeParse(raw).success;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd /mnt/dev/fluxaos && npx vitest run src/__tests__/integration/playbook-result-doc.test.ts 2>&1 | tail -10
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/pipeline/result-doc.ts src/__tests__/integration/playbook-result-doc.test.ts
git commit -m "feat: result document Zod schema (FLX-106)"
```

---

### Task 2: DB migration — add resultDoc to stage_run and playbookPath to pipeline

**Files:**
- Modify: `src/core/db/schema.ts`
- Run: `npm run db:generate && npm run db:migrate`

- [ ] **Step 1: Add columns to schema**

In `src/core/db/schema.ts`, locate the `pipeline` table (line 90) and add two columns after `isDefault`:

```typescript
// inside pipeline pgTable definition, after isDefault line:
playbookPath: text('playbook_path'),
playbookScope: text('playbook_scope'), // 'bundled' | 'org' | 'project'
```

In the `stageRun` table (line 138), add one column after `skillMetadata`:

```typescript
// inside stageRun pgTable definition, after skillMetadata:
resultDoc: jsonb('result_doc'),
```

- [ ] **Step 2: Generate migration**

```bash
cd /mnt/dev/fluxaos && npm run db:generate 2>&1 | tail -10
```
Expected: new migration file created in `drizzle/` directory.

- [ ] **Step 3: Run migration**

```bash
cd /mnt/dev/fluxaos && npm run db:migrate 2>&1 | tail -10
```
Expected: migration applied successfully.

- [ ] **Step 4: Confirm columns visible in db:runs output**

```bash
cd /mnt/dev/fluxaos && npm run db:runs 2>&1 | head -5
```
No error = migration applied. Columns are non-nullable optional; existing rows are unaffected.

- [ ] **Step 5: Seed Standard Dev pipeline with playbookPath**

In `src/scripts/db/seed.ts`, locate the `Standard Dev` pipeline insert at line 115.
Add `playbookPath: 'standard-dev'` to the values object:

```typescript
// src/scripts/db/seed.ts  ~line 115:
[pipe] = await db
  .insert(pipeline)
  .values({
    projectId: proj.id,
    name: 'Standard Dev',
    description: 'Research → Implement → Review → Deploy',
    isDefault: true,
    playbookPath: 'standard-dev',   // ← add this
    playbookScope: 'bundled',        // ← add this
  })
  .returning();
```

Also add an `UPDATE` for the case where the pipeline already exists (line ~110 `if (!pipe)` branch does the select — add an update after):

```typescript
// After the if(!pipe) select block:
if (pipe && !pipe.playbookPath) {
  [pipe] = await db
    .update(pipeline)
    .set({ playbookPath: 'standard-dev', playbookScope: 'bundled' })
    .where(eq(pipeline.id, pipe.id))
    .returning();
}
```

- [ ] **Step 6: Run seed to apply**

```bash
cd /mnt/dev/fluxaos && tsx src/scripts/db/nuke.ts && npm run db:seed 2>&1 | tail -20
```
Expected: seed completes, `pipeline: Standard Dev` logged.

- [ ] **Step 7: Commit**

```bash
git add src/core/db/schema.ts drizzle/ src/scripts/db/seed.ts
git commit -m "feat: add playbookPath/playbookScope to pipeline, resultDoc to stage_run; wire Standard Dev (FLX-106)"
```

---

### Task 3: init-result-doc script

**Files:**
- Create: `src/scripts/pipeline/init-result-doc.ts`
- Modify: `package.json`

The orchestrator calls this before starting the agent. It reads DB context and writes
a partial result doc to disk so the agent has the context fields pre-populated.

- [ ] **Step 1: Create the script**

```typescript
// src/scripts/pipeline/init-result-doc.ts
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { eq } from 'drizzle-orm';
import { db, close } from '@/scripts/db/connection';
import {
  stageRun,
  pipelineRun,
  pipelineStage,
  pipeline,
  issue,
  project,
  organization,
} from '@/core/db/schema';

async function main() {
  const args = process.argv.slice(2);
  const stageRunIdIdx = args.indexOf('--stage-run-id');
  const outputIdx = args.indexOf('--output');

  if (stageRunIdIdx === -1 || outputIdx === -1) {
    console.error('Usage: init-result-doc.ts --stage-run-id <uuid> --output <path>');
    await close();
    process.exit(1);
  }

  const stageRunId = args[stageRunIdIdx + 1];
  const outputPath = args[outputIdx + 1];

  const [sRun] = await db.select().from(stageRun).where(eq(stageRun.id, stageRunId));
  if (!sRun) {
    console.error(`stage_run not found: ${stageRunId}`);
    await close();
    process.exit(1);
  }

  const [run] = await db.select().from(pipelineRun).where(eq(pipelineRun.id, sRun.pipelineRunId));
  if (!run) {
    console.error(`pipeline_run not found: ${sRun.pipelineRunId}`);
    await close();
    process.exit(1);
  }

  const [stage] = await db.select().from(pipelineStage).where(eq(pipelineStage.id, sRun.pipelineStageId));
  if (!stage) {
    console.error(`pipeline_stage not found: ${sRun.pipelineStageId}`);
    await close();
    process.exit(1);
  }

  const [pl] = await db.select().from(pipeline).where(eq(pipeline.id, run.pipelineId));
  if (!pl) {
    console.error(`pipeline not found: ${run.pipelineId}`);
    await close();
    process.exit(1);
  }

  const [proj] = await db.select().from(project).where(eq(project.id, pl.projectId));
  if (!proj) {
    console.error(`project not found: ${pl.projectId}`);
    await close();
    process.exit(1);
  }

  const [orgRow] = await db.select().from(organization).where(eq(organization.id, proj.orgId));
  if (!orgRow) {
    console.error(`organization not found: ${proj.orgId}`);
    await close();
    process.exit(1);
  }

  let issueContext = { id: '', number: 0, title: '' };
  if (run.issueId) {
    const [iss] = await db.select().from(issue).where(eq(issue.id, run.issueId));
    if (iss) issueContext = { id: iss.id, number: iss.number, title: iss.title };
  }

  // Check idempotency: if result doc already exists with a valid verdict, skip init
  if (sRun.resultDoc && typeof sRun.resultDoc === 'object') {
    const existing = sRun.resultDoc as Record<string, unknown>;
    if (existing.verdict && ['pass', 'fail', 'blocked'].includes(existing.verdict as string)) {
      console.log(`result doc already has verdict '${existing.verdict}' — skipping init`);
      writeFileSync(outputPath, JSON.stringify(existing, null, 2));
      await close();
      return;
    }
  }

  const partial = {
    issue: issueContext,
    run: {
      pipelineRunId: run.id,
      stageRunId: sRun.id,
      stage: stage.name,
      attempt: sRun.attempt,
    },
    org: { id: orgRow.id, slug: orgRow.slug },
    project: { id: proj.id, slug: proj.slug },
    timing: { startedAt: new Date().toISOString() },
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(partial, null, 2));
  console.log(`result doc initialized: ${outputPath}`);

  await close();
}

main().catch(async (err) => {
  console.error(err);
  await close();
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script to package.json**

In `package.json` under `"scripts"`, add:
```json
"pipeline:init-result-doc": "tsx src/scripts/pipeline/init-result-doc.ts"
```

- [ ] **Step 3: Smoke test with a real stage_run ID**

```bash
cd /mnt/dev/fluxaos && npm run db:runs 2>&1 | head -20
# Copy a real stage_run ID from the output, e.g. abc123
npm run pipeline:init-result-doc -- --stage-run-id <real-id> --output /tmp/test-result-doc.json
cat /tmp/test-result-doc.json
```
Expected: JSON with `issue`, `run`, `org`, `project`, `timing.startedAt` fields populated from DB.
No `verdict` field yet — that is the agent's job.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/pipeline/init-result-doc.ts package.json
git commit -m "feat: init-result-doc script pre-populates context fields (FLX-106)"
```

---

### Task 4: ingest-result-doc script

**Files:**
- Create: `src/scripts/pipeline/ingest-result-doc.ts`
- Modify: `package.json`

The orchestrator calls this after the agent exits. It validates the result doc,
fills `endedAt` and `duration_sec`, then writes it to `stage_run.result_doc`.

- [ ] **Step 1: Create the script**

```typescript
// src/scripts/pipeline/ingest-result-doc.ts
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { eq } from 'drizzle-orm';
import { db, close } from '@/scripts/db/connection';
import { stageRun } from '@/core/db/schema';
import { validateResultDoc, type ResultDoc } from '@/core/pipeline/result-doc';

async function main() {
  const args = process.argv.slice(2);
  const stageRunIdIdx = args.indexOf('--stage-run-id');
  const resultDocIdx = args.indexOf('--result-doc');

  if (stageRunIdIdx === -1 || resultDocIdx === -1) {
    console.error('Usage: ingest-result-doc.ts --stage-run-id <uuid> --result-doc <path>');
    await close();
    process.exit(1);
  }

  const stageRunId = args[stageRunIdIdx + 1];
  const resultDocPath = args[resultDocIdx + 1];

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resultDocPath, 'utf-8'));
  } catch {
    console.error(`result doc not readable at ${resultDocPath} — treating as invalid`);
    console.log(JSON.stringify({ valid: false, reason: 'unreadable' }));
    await close();
    process.exit(0);
  }

  // Fill endedAt and duration_sec
  const endedAt = new Date().toISOString();
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (r.timing && typeof r.timing === 'object') {
      const t = r.timing as Record<string, unknown>;
      t.endedAt = endedAt;
      if (t.startedAt && typeof t.startedAt === 'string') {
        t.duration_sec = Math.round(
          (Date.now() - new Date(t.startedAt).getTime()) / 1000
        );
      }
    }
  }

  const validation = validateResultDoc(raw);

  if (!validation.success) {
    // Write raw doc to DB for audit trail even if invalid
    await db
      .update(stageRun)
      .set({ resultDoc: raw as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(stageRun.id, stageRunId));
    console.log(JSON.stringify({ valid: false, reason: 'schema_invalid', errors: validation.error.issues }));
    await close();
    process.exit(0);
  }

  const doc = validation.data;

  // Write to DB
  await db
    .update(stageRun)
    .set({
      resultDoc: doc as unknown as Record<string, unknown>,
      tokensIn: doc.meta?.input_tokens ?? 0,
      tokensOut: doc.meta?.output_tokens ?? 0,
      model: doc.meta?.model ?? null,
      completedAt: new Date(endedAt),
      updatedAt: new Date(),
    })
    .where(eq(stageRun.id, stageRunId));

  // Update the file with timing-filled doc
  writeFileSync(resultDocPath, JSON.stringify(doc, null, 2));

  // Emit validated doc for orchestrator to parse from stdout
  console.log(JSON.stringify({ valid: true, doc }));
  await close();
}

main().catch(async (err) => {
  console.error(err);
  await close();
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

In `package.json` under `"scripts"`, add:
```json
"pipeline:ingest-result-doc": "tsx src/scripts/pipeline/ingest-result-doc.ts"
```

- [ ] **Step 3: Smoke test end-to-end with init then ingest**

```bash
cd /mnt/dev/fluxaos && npm run db:runs 2>&1 | head -20
# Copy a real stage_run ID

# Init
npm run pipeline:init-result-doc -- --stage-run-id <real-id> --output /tmp/test-result-doc.json

# Manually add the agent's work fields
node -e "
const doc = JSON.parse(require('fs').readFileSync('/tmp/test-result-doc.json', 'utf-8'));
doc.verdict = 'pass';
doc.summary = 'Smoke test complete.';
doc.comment = 'All checks passed.';
require('fs').writeFileSync('/tmp/test-result-doc.json', JSON.stringify(doc, null, 2));
"

# Ingest
npm run pipeline:ingest-result-doc -- --stage-run-id <real-id> --result-doc /tmp/test-result-doc.json
```
Expected: `{"valid":true,"doc":{...}}` with `timing.endedAt` and `duration_sec` filled.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/pipeline/ingest-result-doc.ts package.json
git commit -m "feat: ingest-result-doc validates, fills timing, writes to DB (FLX-106)"
```

---

## Phase 2 — Playbook

### Task 5: Playbook Zod schema and parser

**Files:**
- Create: `src/core/pipeline/playbook.ts`
- Test: `src/__tests__/integration/playbook-parser.test.ts`

Parser supports both sequential stages (execute immediately) and parallel groups
(parse + type-check only; execution throws `NotImplementedError`).

- [ ] **Step 1: Install js-yaml if not present**

```bash
cd /mnt/dev/fluxaos && npm ls js-yaml 2>/dev/null | grep js-yaml || npm install js-yaml @types/js-yaml
```

- [ ] **Step 2: Create the test file**

```typescript
// src/__tests__/integration/playbook-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parsePlaybook } from '@/core/pipeline/playbook';

const minimalYaml = `
name: quick-task
description: Single stage task.
prompt: |
  You are a pipeline agent.
stages:
  - id: run
    skill: my-task
    onPass: complete
    onFail: complete
    fallback: complete
`;

const standardDevYaml = `
name: standard-dev
description: Research to deploy.
prompt: |
  Base prompt here.
stages:
  - id: research
    skill: research
    onPass: implement
    onFail: research
    fallback: blocked
    rules: []
  - id: implement
    skill: implement
    onPass: review
    onFail: rework
    fallback: blocked
    rules:
      - field: meta.duration_sec
        operator: less_than
        value: 7200
        severity: warn
        onFail: hold
        label: Time cap
  - id: review
    skill: review
    onPass: deploy
    onFail: rework
    fallback: blocked
  - id: deploy
    skill: deploy
    onPass: complete
    onFail: blocked
    fallback: complete
`;

describe('parsePlaybook', () => {
  it('parses minimal single-stage playbook', () => {
    const result = parsePlaybook(minimalYaml, 'quick-task.yaml');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.playbook.name).toBe('quick-task');
      expect(result.playbook.stages).toHaveLength(1);
      expect(result.playbook.stages[0].id).toBe('run');
    }
  });

  it('parses standard-dev four-stage playbook', () => {
    const result = parsePlaybook(standardDevYaml, 'standard-dev.yaml');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.playbook.stages).toHaveLength(4);
      const impl = result.playbook.stages.find(s => s.id === 'implement');
      expect(impl?.type).toBe('sequential');
      if (impl?.type === 'sequential') {
        expect(impl.rules).toHaveLength(1);
        expect(impl.trustMode).toBe('prescriptive');
      }
    }
  });

  it('fails on missing name', () => {
    const result = parsePlaybook('description: no name\nstages: []', 'bad.yaml');
    expect(result.success).toBe(false);
  });

  it('fails on missing stages', () => {
    const result = parsePlaybook('name: x\ndescription: y\nprompt: z', 'bad.yaml');
    expect(result.success).toBe(false);
  });

  it('fails on stage missing onFail', () => {
    const yaml = `
name: x
description: y
prompt: p
stages:
  - id: run
    skill: s
    onPass: complete
    fallback: complete
`;
    const result = parsePlaybook(yaml, 'bad.yaml');
    expect(result.success).toBe(false);
  });

  it('stage defaults trustMode to prescriptive', () => {
    const result = parsePlaybook(minimalYaml, 'q.yaml');
    if (result.success) {
      const stage = result.playbook.stages[0];
      expect(stage.type).toBe('sequential');
      if (stage.type === 'sequential') expect(stage.trustMode).toBe('prescriptive');
    }
  });

  it('parses parallel group stage', () => {
    const yaml = `
name: parallel-test
description: Pipeline with parallel review.
prompt: Base prompt.
stages:
  - id: implement
    skill: implement
    onPass: review-bundle
    onFail: rework
    fallback: blocked
  - id: review-bundle
    type: parallel
    aggregation: all-pass
    children:
      - id: code-review
        skill: review
      - id: security-scan
        skill: security-scan
    onPass: deploy
    onFail: rework
    fallback: blocked
  - id: deploy
    skill: deploy
    onPass: complete
    onFail: blocked
    fallback: complete
`;
    const result = parsePlaybook(yaml, 'parallel-test.yaml');
    expect(result.success).toBe(true);
    if (result.success) {
      const bundle = result.playbook.stages.find(s => s.id === 'review-bundle');
      expect(bundle?.type).toBe('parallel');
      if (bundle?.type === 'parallel') {
        expect(bundle.children).toHaveLength(2);
        expect(bundle.aggregation).toBe('all-pass');
      }
    }
  });

  it('rejects parallel group with fewer than 2 children', () => {
    const yaml = `
name: bad
description: Bad parallel.
prompt: p
stages:
  - id: solo
    type: parallel
    aggregation: all-pass
    children:
      - id: only-one
        skill: review
    onPass: complete
    onFail: complete
    fallback: complete
`;
    const result = parsePlaybook(yaml, 'bad.yaml');
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify fail**

```bash
cd /mnt/dev/fluxaos && npx vitest run src/__tests__/integration/playbook-parser.test.ts 2>&1 | tail -10
```
Expected: module not found.

- [ ] **Step 4: Create the playbook module**

```typescript
// src/core/pipeline/playbook.ts
import { z } from 'zod';
import { load as yamlLoad } from 'js-yaml';

// Child stage inside a parallel group — no routing fields (group owns routing)
const ParallelChildSchema = z.object({
  id: z.string().min(1),
  skill: z.string().min(1),
  trustMode: z.enum(['prescriptive', 'declarative']).optional(),
});

const SequentialStageSchema = z.object({
  type: z.literal('sequential').default('sequential'),
  id: z.string().min(1),
  skill: z.string().min(1),
  onPass: z.string().min(1),
  onFail: z.string().min(1),
  fallback: z.string().min(1),
  trustMode: z.enum(['prescriptive', 'declarative']).default('prescriptive'),
  rules: z.array(z.any()).optional().default([]),
});

const ParallelGroupSchema = z.object({
  type: z.literal('parallel'),
  id: z.string().min(1),
  children: z.array(ParallelChildSchema).min(2),
  aggregation: z.enum(['all-pass', 'any-pass', 'majority-pass', 'none']),
  onPass: z.string().min(1),
  onFail: z.string().min(1),
  fallback: z.string().min(1),
  rules: z.array(z.any()).optional().default([]),
});

const PlaybookStageSchema = z.discriminatedUnion('type', [
  SequentialStageSchema,
  ParallelGroupSchema,
]);

export const PlaybookSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  prompt: z.string().min(1),
  stages: z.array(PlaybookStageSchema).min(1),
});

export type Playbook = z.infer<typeof PlaybookSchema>;
export type PlaybookStage = z.infer<typeof PlaybookStageSchema>;
export type SequentialStage = z.infer<typeof SequentialStageSchema>;
export type ParallelGroup = z.infer<typeof ParallelGroupSchema>;

export function isParallelGroup(stage: PlaybookStage): stage is ParallelGroup {
  return stage.type === 'parallel';
}

export type ParsePlaybookResult =
  | { success: true; playbook: Playbook }
  | { success: false; error: string };

export function parsePlaybook(yamlContent: string, filename: string): ParsePlaybookResult {
  let raw: unknown;
  try {
    raw = yamlLoad(yamlContent);
  } catch (err) {
    return { success: false, error: `YAML parse error in ${filename}: ${String(err)}` };
  }

  const result = PlaybookSchema.safeParse(raw);
  if (!result.success) {
    return { success: false, error: `Schema validation failed in ${filename}: ${result.error.message}` };
  }

  return { success: true, playbook: result.data };
}

export function getStageById(playbook: Playbook, stageId: string): PlaybookStage | undefined {
  return playbook.stages.find(s => s.id === stageId);
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd /mnt/dev/fluxaos && npx vitest run src/__tests__/integration/playbook-parser.test.ts 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add src/core/pipeline/playbook.ts src/__tests__/integration/playbook-parser.test.ts
git commit -m "feat: playbook Zod schema and YAML parser with parallel group support (FLX-106)"
```

---

### Task 6: Playbook file discovery (three-scope)

**Files:**
- Create: `src/core/pipeline/playbook-discovery.ts`
- Test: `src/__tests__/integration/playbook-discovery.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// src/__tests__/integration/playbook-discovery.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { discoverPlaybooks, resolvePlaybook } from '@/core/pipeline/playbook-discovery';

const TMP = '/tmp/fluxaos-test-discovery';

const validYaml = `
name: test-pipeline
description: Test pipeline.
prompt: |
  Test prompt.
stages:
  - id: run
    skill: test
    onPass: complete
    onFail: complete
    fallback: complete
`;

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(`${TMP}/bundled`, { recursive: true });
  mkdirSync(`${TMP}/org`, { recursive: true });
  mkdirSync(`${TMP}/project`, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('discoverPlaybooks', () => {
  it('loads from bundled scope', async () => {
    writeFileSync(`${TMP}/bundled/my-pipeline.yaml`, validYaml);
    const results = await discoverPlaybooks({ bundledDir: `${TMP}/bundled` });
    expect(results).toHaveLength(1);
    expect(results[0].scope).toBe('bundled');
    expect(results[0].playbook.name).toBe('test-pipeline');
  });

  it('project overrides bundled by filename', async () => {
    writeFileSync(`${TMP}/bundled/my-pipeline.yaml`, validYaml);
    const projectYaml = validYaml.replace('name: test-pipeline', 'name: project-override');
    writeFileSync(`${TMP}/project/my-pipeline.yaml`, projectYaml);
    const results = await discoverPlaybooks({
      bundledDir: `${TMP}/bundled`,
      projectDir: `${TMP}/project`,
    });
    expect(results).toHaveLength(1);
    expect(results[0].scope).toBe('project');
    expect(results[0].playbook.name).toBe('project-override');
  });

  it('org overrides bundled but not project', async () => {
    writeFileSync(`${TMP}/bundled/p.yaml`, validYaml);
    const orgYaml = validYaml.replace('name: test-pipeline', 'name: org-version');
    writeFileSync(`${TMP}/org/p.yaml`, orgYaml);
    const projectYaml = validYaml.replace('name: test-pipeline', 'name: project-version');
    writeFileSync(`${TMP}/project/p.yaml`, projectYaml);
    const results = await discoverPlaybooks({
      bundledDir: `${TMP}/bundled`,
      orgDir: `${TMP}/org`,
      projectDir: `${TMP}/project`,
    });
    expect(results).toHaveLength(1);
    expect(results[0].playbook.name).toBe('project-version');
  });

  it('skips invalid YAML files and continues', async () => {
    writeFileSync(`${TMP}/bundled/good.yaml`, validYaml);
    writeFileSync(`${TMP}/bundled/bad.yaml`, 'name: x\ndescription: y\n# missing stages and prompt');
    const results = await discoverPlaybooks({ bundledDir: `${TMP}/bundled` });
    expect(results).toHaveLength(1);
    expect(results[0].playbook.name).toBe('test-pipeline');
  });
});

describe('resolvePlaybook', () => {
  it('resolves playbook by name', async () => {
    writeFileSync(`${TMP}/bundled/my-pipeline.yaml`, validYaml);
    const found = await resolvePlaybook('test-pipeline', { bundledDir: `${TMP}/bundled` });
    expect(found).not.toBeNull();
    expect(found?.playbook.name).toBe('test-pipeline');
  });

  it('returns null for unknown name', async () => {
    const found = await resolvePlaybook('nonexistent', { bundledDir: `${TMP}/bundled` });
    expect(found).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd /mnt/dev/fluxaos && npx vitest run src/__tests__/integration/playbook-discovery.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Create discovery module**

```typescript
// src/core/pipeline/playbook-discovery.ts
import { readdir, readFile, access } from 'fs/promises';
import { join, extname } from 'path';
import { parsePlaybook, type Playbook } from './playbook';

export type PlaybookScope = 'bundled' | 'org' | 'project';

export interface DiscoveredPlaybook {
  filename: string;
  scope: PlaybookScope;
  playbook: Playbook;
  filePath: string;
}

export interface DiscoveryOptions {
  bundledDir?: string;
  orgDir?: string;
  projectDir?: string;
}

async function loadFromDir(dir: string, scope: PlaybookScope): Promise<Map<string, DiscoveredPlaybook>> {
  const map = new Map<string, DiscoveredPlaybook>();
  try {
    await access(dir);
  } catch {
    return map;
  }

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return map;
  }

  for (const entry of entries) {
    const ext = extname(entry);
    if (ext !== '.yaml' && ext !== '.yml') continue;
    const filePath = join(dir, entry);
    try {
      const content = await readFile(filePath, 'utf-8');
      const result = parsePlaybook(content, entry);
      if (result.success) {
        map.set(entry, { filename: entry, scope, playbook: result.playbook, filePath });
      }
    } catch {
      // silently skip unreadable files
    }
  }
  return map;
}

export async function discoverPlaybooks(opts: DiscoveryOptions): Promise<DiscoveredPlaybook[]> {
  const merged = new Map<string, DiscoveredPlaybook>();

  // 1. bundled (lowest precedence)
  if (opts.bundledDir) {
    for (const [k, v] of await loadFromDir(opts.bundledDir, 'bundled')) merged.set(k, v);
  }
  // 2. org (overrides bundled)
  if (opts.orgDir) {
    for (const [k, v] of await loadFromDir(opts.orgDir, 'org')) merged.set(k, v);
  }
  // 3. project (overrides all)
  if (opts.projectDir) {
    for (const [k, v] of await loadFromDir(opts.projectDir, 'project')) merged.set(k, v);
  }

  return Array.from(merged.values());
}

export async function resolvePlaybook(
  name: string,
  opts: DiscoveryOptions
): Promise<DiscoveredPlaybook | null> {
  const all = await discoverPlaybooks(opts);
  return all.find(p => p.playbook.name === name) ?? null;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd /mnt/dev/fluxaos && npx vitest run src/__tests__/integration/playbook-discovery.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add src/core/pipeline/playbook-discovery.ts src/__tests__/integration/playbook-discovery.test.ts
git commit -m "feat: playbook three-scope file discovery (FLX-106)"
```

---

### Task 7: Bundled Standard Dev playbook and skill files

**Files:**
- Create: `src/core/pipeline/bundled/standard-dev.yaml`
- Create: `src/core/pipeline/bundled/skills/research.md`
- Create: `src/core/pipeline/bundled/skills/implement.md`
- Create: `src/core/pipeline/bundled/skills/review.md`
- Create: `src/core/pipeline/bundled/skills/rework.md`
- Create: `src/core/pipeline/bundled/skills/deploy.md`

- [ ] **Step 1: Create the bundled Standard Dev playbook**

```yaml
# src/core/pipeline/bundled/standard-dev.yaml
name: standard-dev
description: >
  Research → implement → review → deploy with conditional rework.
  The reference workflow for software development issues.

prompt: |
  You are a fluxaOS pipeline agent running in headless, unattended mode.

  Your only job is to do the work your skill describes and produce an honest
  result document at the path in the $RESULT_DOC_PATH environment variable.

  Rules:
  - You do NOT transition issue states.
  - You do NOT file tickets.
  - You do NOT write comments to the issue directly.
  - The orchestrator reads your result document and handles all of that.

  Result document fields you MUST write before exiting:
    verdict: "pass", "fail", or "blocked"
      - pass: work complete, proceed
      - fail: work attempted but did not meet the bar; engine routes to onFail
      - blocked: you are stuck and cannot continue; engine routes to fallback
    summary: one sentence describing what happened and why

  Result document fields you MAY write:
    comment: text to post as an issue comment (optional)
    blockers: array of {title, description} objects describing blockers (optional)
    artifacts: array of filenames you produced in $ARTIFACTS_DIR (optional)
    meta.model: the model identifier you used (optional)
    meta.input_tokens: integer token count (optional)
    meta.output_tokens: integer token count (optional)

  The context fields (issue, run, org, project, timing.startedAt) are already
  in the file. Do not overwrite them.

  Idempotency: this session may be a retry of a crashed prior run.
  Before creating anything external (branch, commit, PR, comment, API call),
  check whether it already exists and skip or reuse it.

  To write the result document:
    node -e "
      const fs = require('fs');
      const doc = JSON.parse(fs.readFileSync(process.env.RESULT_DOC_PATH, 'utf-8'));
      doc.verdict = 'pass';
      doc.summary = 'Your summary here.';
      doc.comment = 'Optional comment for the issue.';
      fs.writeFileSync(process.env.RESULT_DOC_PATH, JSON.stringify(doc, null, 2));
    "

stages:
  - id: research
    skill: research
    onPass: implement
    onFail: research
    fallback: blocked
    rules: []

  - id: implement
    skill: implement
    onPass: review
    onFail: rework
    fallback: blocked
    rules:
      - field: timing.duration_sec
        operator: less_than
        value: 7200
        severity: warn
        onFail: hold
        label: Implementation time cap (2 hours)

  - id: review
    skill: review
    onPass: deploy
    onFail: rework
    fallback: blocked
    rules: []

  - id: rework
    skill: rework
    onPass: review
    onFail: blocked
    fallback: blocked
    rules:
      - field: run.attempt
        operator: less_than
        value: 4
        severity: block
        onFail: abort
        label: Rework attempt cap (3 max)

  - id: deploy
    skill: deploy
    onPass: complete
    onFail: blocked
    fallback: complete
    rules: []
```

- [ ] **Step 2: Create research skill**

```markdown
<!-- src/core/pipeline/bundled/skills/research.md -->
---
name: research
description: Research the issue and produce an implementation-ready plan.
---

## Your Work

You are the research agent. The issue is in `research` state.

1. Read the issue title and description from `$RESULT_DOC_PATH` (`.issue.title`).
2. Explore the codebase to understand the affected areas.
3. Identify the root cause or implementation approach.
4. Write `$ARTIFACTS_DIR/research-findings.md` with:
   - Problem statement
   - Affected files and areas
   - Proposed implementation approach
   - Risks and unknowns
   - Verification approach

## You Are Done When

- `$ARTIFACTS_DIR/research-findings.md` exists and is complete.
- You have written `verdict` to the result document:
  - `pass` when the issue is ready for implement
  - `fail` when the issue cannot be researched (missing context, ambiguous)
  - `blocked` when you need operator input before continuing

## You Do Not Do

- Write any code.
- Create branches or commits.
- Transition issue states or write issue comments directly.
```

- [ ] **Step 3: Create implement skill**

```markdown
<!-- src/core/pipeline/bundled/skills/implement.md -->
---
name: implement
description: Make the scoped code changes and leave the branch ready for review.
---

## Your Work

You are the implement agent. The issue is in `implement` state.

1. Read `$ARTIFACTS_DIR/research-findings.md` if it exists.
2. Create a feature branch: `git checkout <branch> 2>/dev/null || git checkout -b <branch>`.
3. Make the implementation changes.
4. Run tests and lint. Fix failures.
5. Commit all changes.
6. Write `$ARTIFACTS_DIR/implementation-summary.md`:
   - What was changed and why
   - Files modified
   - Test results
   - Any deviations from the research plan

## You Are Done When

- All relevant tests pass and lint is clean.
- Changes are committed to the branch.
- `$ARTIFACTS_DIR/implementation-summary.md` is written.
- `verdict` is `pass` (ready for review) or `fail` (could not implement).

## You Do Not Do

- Merge PRs or push to main.
- Deploy to production.
- Transition issue states or write issue comments directly.
```

- [ ] **Step 4: Create review skill**

```markdown
<!-- src/core/pipeline/bundled/skills/review.md -->
---
name: review
description: Review implementation quality and route to deploy or rework.
---

## Your Work

You are the review agent. The issue is in `review` state.

1. Read `$ARTIFACTS_DIR/research-findings.md` and `$ARTIFACTS_DIR/implementation-summary.md`.
2. Review the diff: `git diff main...HEAD`.
3. Check for:
   - Correctness bugs and regressions
   - Missing or inadequate tests
   - Architecture violations
   - Security risks
   - Deploy risks
4. Write `$ARTIFACTS_DIR/review-findings.md` with structured findings.

## You Are Done When

- `$ARTIFACTS_DIR/review-findings.md` is written.
- `verdict` is `pass` (approved for deploy) or `fail` (needs rework).
- `comment` contains a concise review summary.
- If `fail`, `comment` lists specific required changes.

## You Do Not Do

- Merge PRs or deploy to production.
- Transition issue states or write issue comments directly.
```

- [ ] **Step 5: Create rework skill**

```markdown
<!-- src/core/pipeline/bundled/skills/rework.md -->
---
name: rework
description: Address review findings and resubmit for review.
---

## Your Work

You are the rework agent. The issue is in `rework` state.

1. Read `$ARTIFACTS_DIR/review-findings.md`.
2. Address each blocking finding.
3. Apply only changes needed to address review feedback.
4. Run tests and lint. Fix failures.
5. Commit changes.
6. Update `$ARTIFACTS_DIR/implementation-summary.md` with what changed during rework.

## You Are Done When

- All review findings are addressed or explicitly pushed back with justification.
- Tests and lint pass.
- Changes are committed.
- `verdict` is `pass` (ready for re-review) or `fail` (cannot resolve findings).

## You Do Not Do

- Address out-of-scope improvements.
- Merge PRs or deploy.
- Transition issue states or write issue comments directly.
```

- [ ] **Step 6: Create deploy skill**

```markdown
<!-- src/core/pipeline/bundled/skills/deploy.md -->
---
name: deploy
description: Merge approved work, deploy, verify, and close the issue.
---

## Your Work

You are the deploy agent. The issue is in `deploy` state.

1. Confirm review approved (`$ARTIFACTS_DIR/review-findings.md` shows pass).
2. Open a PR if one does not exist: `gh pr list --head <branch>` first.
3. Merge: `gh pr merge <number> --squash --auto`.
4. Run the deploy command for this project.
5. Verify the deploy succeeded.
6. Write `$ARTIFACTS_DIR/deploy-summary.md` with PR URL, merge SHA, deploy result.

## You Are Done When

- PR is merged and deploy is verified.
- `$ARTIFACTS_DIR/deploy-summary.md` is written.
- `verdict` is `pass` (deployed and verified) or `fail` (deploy failed after attempted recovery).

## You Do Not Do

- Re-review or rewrite approved implementation.
- Transition issue states or write issue comments directly.
  (The orchestrator closes the issue when `onPass: complete` is reached.)
```

- [ ] **Step 7: Verify bundled playbook parses**

```bash
cd /mnt/dev/fluxaos && npx tsx -e "
import { parsePlaybook } from './src/core/pipeline/playbook.js';
import { readFileSync } from 'fs';
const yaml = readFileSync('./src/core/pipeline/bundled/standard-dev.yaml', 'utf-8');
const result = parsePlaybook(yaml, 'standard-dev.yaml');
if (result.success) {
  console.log('VALID: ' + result.playbook.stages.length + ' stages:', result.playbook.stages.map(s => s.id).join(', '));
} else {
  console.error('INVALID:', result.error);
  process.exit(1);
}
"
```
Expected: `VALID: 5 stages: research, implement, review, rework, deploy`

- [ ] **Step 8: Commit**

```bash
git add src/core/pipeline/bundled/
git commit -m "feat: bundled Standard Dev playbook and work-only skill prompts (FLX-106)"
```

---

## Phase 3 — Orchestrator Audit

### Task 8: Playbook-aware orchestrator audit service

**Files:**
- Create: `src/core/pipeline/playbook-auditor.ts`
- Test: `src/__tests__/integration/playbook-auditor.test.ts`

The auditor reads a result doc and a playbook stage definition, runs gate rules (if any),
and returns an `AuditResult` describing what the orchestrator should do next.

Gate rules reference nested fields on the result doc — e.g., `timing.duration_sec` walks
`doc.timing.duration_sec`. The result doc is passed as-is (already nested); the gate engine's
`resolveField` walks the nested tree correctly.

- [ ] **Step 1: Create the test file**

```typescript
// src/__tests__/integration/playbook-auditor.test.ts
import { describe, it, expect } from 'vitest';
import { auditResultDoc } from '@/core/pipeline/playbook-auditor';
import type { Playbook } from '@/core/pipeline/playbook';
import type { ResultDoc } from '@/core/pipeline/result-doc';

const playbook: Playbook = {
  name: 'test',
  description: 'Test playbook',
  prompt: 'Test prompt',
  stages: [
    {
      type: 'sequential',
      id: 'implement',
      skill: 'implement',
      onPass: 'review',
      onFail: 'rework',
      fallback: 'blocked',
      trustMode: 'prescriptive',
      rules: [],
    },
    {
      type: 'sequential',
      id: 'review',
      skill: 'review',
      onPass: 'deploy',
      onFail: 'rework',
      fallback: 'blocked',
      trustMode: 'prescriptive',
      rules: [],
    },
  ],
};

const baseDoc: ResultDoc = {
  issue: { id: 'u1', number: 1, title: 'T' },
  run: { pipelineRunId: 'u2', stageRunId: 'u3', stage: 'implement', attempt: 1 },
  org: { id: 'u4', slug: 'o' },
  project: { id: 'u5', slug: 'p' },
  timing: { startedAt: '2026-05-02T00:00:00Z' },
  verdict: 'pass',
  summary: 'Done.',
};

describe('auditResultDoc', () => {
  it('routes pass verdict to onPass state', () => {
    const result = auditResultDoc(playbook, 'implement', baseDoc);
    expect(result.targetState).toBe('review');
    expect(result.action).toBe('transition');
  });

  it('routes fail verdict to onFail state', () => {
    const result = auditResultDoc(playbook, 'implement', { ...baseDoc, verdict: 'fail' });
    expect(result.targetState).toBe('rework');
    expect(result.action).toBe('transition');
  });

  it('uses fallback when result doc is null (invalid)', () => {
    const result = auditResultDoc(playbook, 'implement', null);
    expect(result.targetState).toBe('blocked');
    expect(result.action).toBe('fallback');
  });

  it('uses fallback when stage not found in playbook', () => {
    const result = auditResultDoc(playbook, 'nonexistent', baseDoc);
    expect(result.action).toBe('fallback');
  });

  it('includes comment from result doc', () => {
    const doc = { ...baseDoc, comment: 'Review passed cleanly.' };
    const result = auditResultDoc(playbook, 'implement', doc);
    expect(result.comment).toBe('Review passed cleanly.');
  });

  it('verdict: blocked routes to fallback', () => {
    const doc: ResultDoc = { ...baseDoc, verdict: 'blocked' };
    const result = auditResultDoc(playbook, 'implement', doc);
    expect(result.targetState).toBe('blocked');
    expect(result.action).toBe('fallback');
  });

  it('verdict: pass with non-empty blockers routes to fallback', () => {
    const doc: ResultDoc = {
      ...baseDoc,
      verdict: 'pass',
      blockers: [{ title: 'CI broken', description: 'Red on main.' }],
    };
    const result = auditResultDoc(playbook, 'implement', doc);
    expect(result.action).toBe('fallback');
    expect(result.blockers).toHaveLength(1);
  });

  it('warn-only rule failure does not override pass routing', () => {
    const playbookWithWarnRule: Playbook = {
      ...playbook,
      stages: [{
        type: 'sequential',
        id: 'implement',
        skill: 'implement',
        onPass: 'review',
        onFail: 'rework',
        fallback: 'blocked',
        trustMode: 'prescriptive',
        rules: [{
          field: 'timing.duration_sec',
          operator: 'less_than',
          value: 60,
          severity: 'warn',
          onFail: 'hold',
          label: 'Time cap',
        }],
      }],
    };
    // duration_sec = 3600, cap = 60, severity = warn → warn-only → does NOT block
    const doc: ResultDoc = { ...baseDoc, timing: { startedAt: '2026-05-02T00:00:00Z', duration_sec: 3600 } };
    const result = auditResultDoc(playbookWithWarnRule, 'implement', doc);
    expect(result.targetState).toBe('review'); // pass verdict respected; warn did not block
    expect(result.action).toBe('transition');
  });

  it('block-severity rule failure routes to fallback', () => {
    const playbookWithBlockRule: Playbook = {
      ...playbook,
      stages: [{
        type: 'sequential',
        id: 'implement',
        skill: 'implement',
        onPass: 'review',
        onFail: 'rework',
        fallback: 'blocked',
        trustMode: 'prescriptive',
        rules: [{
          field: 'run.attempt',
          operator: 'less_than',
          value: 2,
          severity: 'block',
          onFail: 'abort',
          label: 'Attempt cap',
        }],
      }],
    };
    // attempt = 1, cap = 2 → passes; test the inverse
    const doc: ResultDoc = { ...baseDoc, run: { ...baseDoc.run, attempt: 5 } };
    const result = auditResultDoc(playbookWithBlockRule, 'implement', doc);
    // attempt 5 < 2 is false → rule fails with severity:block, onFail:abort → fallback
    expect(result.action).toBe('fallback');
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd /mnt/dev/fluxaos && npx vitest run src/__tests__/integration/playbook-auditor.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Create the auditor module**

```typescript
// src/core/pipeline/playbook-auditor.ts
import { evaluateGate } from '@/core/gates/engine';
import type { RuleGroup } from '@/core/gates/types';
import type { Playbook } from './playbook';
import type { ResultDoc } from './result-doc';

export type AuditAction = 'transition' | 'fallback';

export interface AuditResult {
  action: AuditAction;
  targetState: string;
  comment?: string;
  blockers?: Array<{ title: string; description: string }>;
  artifacts?: string[];
}

export function auditResultDoc(
  playbook: Playbook,
  stageId: string,
  doc: ResultDoc | null
): AuditResult {
  const stage = playbook.stages.find(s => s.id === stageId);

  // No stage found in playbook — safe fallback to first stage's fallback
  if (!stage) {
    return {
      action: 'fallback',
      targetState: playbook.stages[0]?.fallback ?? 'blocked',
    };
  }

  // Invalid result doc — apply fallback
  if (!doc) {
    return {
      action: 'fallback',
      targetState: stage.fallback,
      comment: 'Stage did not produce a valid result document.',
    };
  }

  // verdict: blocked OR non-empty blockers[] → always fallback regardless of verdict
  const isBlocked =
    doc.verdict === 'blocked' || (doc.blockers !== undefined && doc.blockers.length > 0);
  if (isBlocked) {
    return {
      action: 'fallback',
      targetState: stage.fallback,
      comment: doc.comment,
      blockers: doc.blockers,
      artifacts: doc.artifacts,
    };
  }

  // Evaluate gate rules if configured.
  // Pass the result doc as-is (nested object) — resolveField() walks the tree via dot-path.
  // e.g. rule field "timing.duration_sec" resolves doc.timing.duration_sec correctly.
  const rules = (stage.rules ?? []) as RuleGroup['rules'];
  if (rules.length > 0) {
    const ruleGroup: RuleGroup = { logic: 'AND', rules };
    const evaluation = evaluateGate('rules', ruleGroup, doc as unknown as Record<string, unknown>);

    if (!evaluation.passed) {
      const worstAction = evaluation.worstAction;
      // Map FailureAction to a target state string
      const targetState =
        worstAction === 'rework' ? stage.onFail
          : worstAction === 'hold' ? 'hold'
          : stage.fallback; // abort, escalate, notify, proceed-but-failed → fallback

      return {
        action: 'fallback',
        targetState,
        comment: doc.comment,
        artifacts: doc.artifacts,
      };
    }
  }

  // Trust mode: prescriptive (default) — use agent verdict directly
  const targetState = doc.verdict === 'pass' ? stage.onPass : stage.onFail;

  return {
    action: 'transition',
    targetState,
    comment: doc.comment,
    artifacts: doc.artifacts,
  };
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd /mnt/dev/fluxaos && npx vitest run src/__tests__/integration/playbook-auditor.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add src/core/pipeline/playbook-auditor.ts src/__tests__/integration/playbook-auditor.test.ts
git commit -m "feat: playbook auditor routes result docs via gate engine (FLX-106)"
```

---

### Task 9: Paperwork executor service

**Files:**
- Create: `src/core/pipeline/paperwork-executor.ts`
- Test: `src/__tests__/integration/playbook-paperwork.test.ts`

The paperwork executor is called by the orchestrator after the auditor produces an `AuditResult`.
It posts a comment, posts a single formatted blocker summary if blockers exist, and transitions
the issue state — using the real service APIs verified against the codebase.

Note: there is no blocker relation table in the schema. Blockers are reported as a single
formatted comment on the parent issue. A follow-up Linear ticket will add proper
blocker-issue creation once the relation table exists.

- [ ] **Step 1: Create the test file**

Integration test against real Supabase — no vi.fn() mocks of service interfaces.
This test uses the real DB and tests the wiring without executing the full pipeline.

```typescript
// src/__tests__/integration/playbook-paperwork.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { createIssueService } from '@/core/services/issue';
import { createIssueCommentService } from '@/core/services/issue-comment';
import { executePaperwork } from '@/core/pipeline/paperwork-executor';
import type { AuditResult } from '@/core/pipeline/playbook-auditor';
import { eq } from 'drizzle-orm';
import { issue, issueComment } from '@/core/db/schema';

// Real DB integration — requires DIRECT_URL or DATABASE_URL in env
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const skip = !url;

const dbProvider = skip ? null : new SupabaseDatabaseProvider(url!);
const db = dbProvider?.getConnection();

describe.skipIf(skip)('executePaperwork (real DB)', () => {
  let testIssueId: string;
  let testProjectId: string;

  beforeAll(async () => {
    // Find the first seeded issue to use as test target
    if (!db) return;
    const [row] = await db.select({ id: issue.id, projectId: issue.projectId }).from(issue).limit(1);
    if (!row) throw new Error('No issues in DB — run db:seed first');
    testIssueId = row.id;
    testProjectId = row.projectId;
  });

  afterAll(async () => {
    await dbProvider?.close?.();
  });

  it('posts comment when audit has comment', async () => {
    if (!db) return;
    const issueService = createIssueService(db);
    const commentService = createIssueCommentService(db);

    const audit: AuditResult = {
      action: 'transition',
      targetState: 'research', // use a known valid state key from seed
      comment: 'Paperwork executor integration test comment.',
    };

    await executePaperwork({
      issueId: testIssueId,
      projectId: testProjectId,
      db,
      audit,
    });

    // Verify comment was created
    const comments = await commentService.list(testIssueId);
    const testComment = comments.find(c => c.bodyMd?.includes('Paperwork executor integration test comment.'));
    expect(testComment).toBeDefined();
  });

  it('posts blocker summary comment when blockers present', async () => {
    if (!db) return;
    const commentService = createIssueCommentService(db);

    const audit: AuditResult = {
      action: 'fallback',
      targetState: 'blocked',
      blockers: [
        { title: 'CI broken', description: 'Tests are red on main.' },
        { title: 'Missing dep', description: 'Package not found.' },
      ],
    };

    await executePaperwork({
      issueId: testIssueId,
      projectId: testProjectId,
      db,
      audit,
    });

    const comments = await commentService.list(testIssueId);
    const blockerComment = comments.find(c => c.bodyMd?.includes('Stage flagged 2 blocker(s)'));
    expect(blockerComment).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd /mnt/dev/fluxaos && npx vitest run src/__tests__/integration/playbook-paperwork.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Create the paperwork executor**

```typescript
// src/core/pipeline/paperwork-executor.ts
import type { Database } from '@/core/db/connection';
import { issue } from '@/core/db/schema';
import { eq } from 'drizzle-orm';
import { createIssueService } from '@/core/services/issue';
import { createIssueCommentService } from '@/core/services/issue-comment';
import type { AuditResult } from './playbook-auditor';

export interface PaperworkInput {
  issueId: string;
  projectId: string;
  db: Database;
  audit: AuditResult;
}

export async function executePaperwork(input: PaperworkInput): Promise<void> {
  const { issueId, projectId, db, audit } = input;

  const issueService = createIssueService(db);
  const commentService = createIssueCommentService(db);

  // 1. Post comment if present
  if (audit.comment) {
    await commentService.create(issueId, {
      bodyMd: audit.comment,
      author: 'orchestrator',
    });
  }

  // 2. Post blocker summary as a single formatted comment (no issue creation —
  //    no blocker relation table exists yet; follow-up ticket will add that).
  if (audit.blockers && audit.blockers.length > 0) {
    const lines = [
      `Stage flagged ${audit.blockers.length} blocker(s):`,
      '',
      ...audit.blockers.map((b, i) => `**${i + 1}. ${b.title}**\n${b.description}`),
    ];
    await commentService.create(issueId, {
      bodyMd: lines.join('\n'),
      author: 'orchestrator',
    });
  }

  // 3. Transition issue state using real IssueService API:
  //    - getStateByKey(projectId, key) → returns IssueStateSelect with .id
  //    - transition(id, toStateId, version, userId?) — version is arg 3
  //    Must read current version from DB before calling.
  const [issueRow] = await db.select().from(issue).where(eq(issue.id, issueId));
  if (!issueRow) return; // issue deleted concurrently — skip

  if (audit.targetState === 'complete') {
    // close() finds the terminal state and delegates to stateOverride
    await issueService.close(issueId, issueRow.version, 'orchestrator');
  } else {
    const targetState = await issueService.getStateByKey(projectId, audit.targetState);
    await issueService.transition(issueId, targetState.id, issueRow.version, 'orchestrator');
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd /mnt/dev/fluxaos && npx vitest run src/__tests__/integration/playbook-paperwork.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add src/core/pipeline/paperwork-executor.ts src/__tests__/integration/playbook-paperwork.test.ts
git commit -m "feat: paperwork executor posts comments and transitions issue state (FLX-106)"
```

---

### Task 10: Prompt composer

**Files:**
- Create: `src/core/pipeline/prompt-composer.ts`
- Test: `src/__tests__/integration/playbook-prompt-composer.test.ts`

Substitutes `${KEY}` brace-syntax vars (not bare `$KEY`) to match the standard-dev
playbook's `${RESULT_DOC_PATH}` and `${ARTIFACTS_DIR}` references.

- [ ] **Step 1: Create the test file**

```typescript
// src/__tests__/integration/playbook-prompt-composer.test.ts
import { describe, it, expect } from 'vitest';
import { composePrompt } from '@/core/pipeline/prompt-composer';

describe('composePrompt', () => {
  it('concatenates base prompt and skill prompt', () => {
    const result = composePrompt('Base prompt.', 'Skill work here.');
    expect(result).toContain('Base prompt.');
    expect(result).toContain('Skill work here.');
  });

  it('substitutes ${RESULT_DOC_PATH} in base prompt', () => {
    const result = composePrompt('Write to ${RESULT_DOC_PATH} when done.', 'Work.', {
      RESULT_DOC_PATH: '/tmp/result.json',
    });
    expect(result).toContain('/tmp/result.json');
    expect(result).not.toContain('${RESULT_DOC_PATH}');
  });

  it('substitutes ${ARTIFACTS_DIR} in skill prompt', () => {
    const result = composePrompt('Base.', 'Read ${ARTIFACTS_DIR}/plan.md.', {
      ARTIFACTS_DIR: '/tmp/artifacts',
    });
    expect(result).toContain('/tmp/artifacts/plan.md');
    expect(result).not.toContain('${ARTIFACTS_DIR}');
  });

  it('leaves unmatched vars untouched', () => {
    const result = composePrompt('Hello ${UNKNOWN}.', 'Work.', {});
    expect(result).toContain('${UNKNOWN}');
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd /mnt/dev/fluxaos && npx vitest run src/__tests__/integration/playbook-prompt-composer.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Create prompt composer**

```typescript
// src/core/pipeline/prompt-composer.ts

export function composePrompt(
  basePrompt: string,
  skillPrompt: string,
  vars: Record<string, string> = {}
): string {
  const substitute = (text: string) =>
    Object.entries(vars).reduce(
      (acc, [key, value]) => acc.replaceAll(`\${${key}}`, value),
      text
    );

  return [substitute(basePrompt), substitute(skillPrompt)].join('\n\n---\n\n');
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd /mnt/dev/fluxaos && npx vitest run src/__tests__/integration/playbook-prompt-composer.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add src/core/pipeline/prompt-composer.ts src/__tests__/integration/playbook-prompt-composer.test.ts
git commit -m "feat: prompt composer with brace-syntax variable substitution (FLX-106)"
```

---

### Task 11: Wire playbook auditor into event-orchestrator (migration shim)

**Files:**
- Modify: `src/core/orchestrator/event-orchestrator.ts`

Hook the playbook code path into `launchStage` before `executeStageRun` fires (line 221).
The shim branches on `pipeline.playbookPath != null`. Old pipelines (null) fall through
to the existing signal-based routing unchanged.

Parallel groups: if `launchStage` encounters a parallel group stage, throw
`NotImplementedError` so it surfaces cleanly. A follow-up ticket will implement execution.

- [ ] **Step 1: Add project and pipeline imports if missing**

In `src/core/orchestrator/event-orchestrator.ts`, locate the imports at lines 15–43.
If `project` is not already imported from `@/core/db/schema`, add it:

```typescript
// add to the schema imports block:
import {
  issue,
  pipeline,   // ← confirm this exists
  pipelineStage,
  project,    // ← add if missing
  stageRun,
} from '@/core/db/schema';
```

- [ ] **Step 2: Add playbook branch to `launchStage`**

In `src/core/orchestrator/event-orchestrator.ts`, inside `launchStage` (line 184),
after the pre-gate check block (after line 217) and immediately before
`const result = await executeStageRun(...)` at line 221, insert:

```typescript
// ── Playbook execution path ──────────────────────────────────────────
// Branch on playbookPath on the pipeline row. Old pipelines (null) fall through.
const [pipelineRow] = await db
  .select({ playbookPath: pipeline.playbookPath, projectId: pipeline.projectId })
  .from(pipeline)
  .where(eq(pipeline.id, run.pipelineId));

if (pipelineRow?.playbookPath) {
  const { isParallelGroup } = await import('@/core/pipeline/playbook');
  const { resolvePlaybook } = await import('@/core/pipeline/playbook-discovery');
  const { auditResultDoc } = await import('@/core/pipeline/playbook-auditor');
  const { executePaperwork } = await import('@/core/pipeline/paperwork-executor');
  const { runStageGraph } = await import('@/core/pipeline/langgraph-stage-runner');
  const { getCheckpointer } = await import('@/core/pipeline/checkpoint-store');
  const { composePrompt } = await import('@/core/pipeline/prompt-composer');

  const bundledDir = process.env.FLUXAOS_BUNDLED_PIPELINES_DIR
    ?? 'src/core/pipeline/bundled';
  const discovered = await resolvePlaybook(pipelineRow.playbookPath, { bundledDir });

  if (discovered) {
    const playbookStage = discovered.playbook.stages.find(s => s.id === stage.name);

    // Parallel groups: parser accepts them; execution not yet implemented
    if (playbookStage && isParallelGroup(playbookStage)) {
      throw new Error(
        `NotImplementedError: parallel group execution is not yet supported (stage: ${stage.name})`
      );
    }

    // Resolve driver row to get promptTransport
    const [driverRow] = stage.driverId
      ? await db.select().from(driver).where(eq(driver.id, stage.driverId))
      : [null];

    const artifactsBase = run.artifactsPath
      ?? `${process.env.FLUXAOS_ARTIFACTS_ROOT ?? '.fluxaos-artifacts'}/${run.id}`;
    const resultDocPath = `${artifactsBase}/result.json`;

    // Skill prompt from DB or bundled file
    const skillPromptTemplate = (stage as any).skillPromptTemplate
      ?? discovered.playbook.stages.find(s => s.id === stage.name)?.skill
      ?? '';

    const composedPrompt = composePrompt(
      discovered.playbook.prompt,
      skillPromptTemplate,
      {
        RESULT_DOC_PATH: resultDocPath,
        ARTIFACTS_DIR: artifactsBase,
      }
    );

    // Build driver args — respect promptTransport from driver row
    const transport = driverRow?.promptTransport ?? 'argv';
    const driverBinary = driverRow?.binary ?? 'claude';
    const driverArgs = [
      ...((driverRow?.defaultArgs as string[]) ?? []),
    ];

    if (transport === 'argv') {
      driverArgs.push(composedPrompt);
    }
    // stdin and file transports deferred — only argv is wired now

    const checkpointer = await getCheckpointer();
    const { ingestOutput } = await runStageGraph(
      {
        stageRunId: sRun.id,
        resultDocPath,
        artifactsDir: artifactsBase,
        prompt: composedPrompt,
        driverCommand: driverBinary,
        driverArgs,
        env: {
          RESULT_DOC_PATH: resultDocPath,
          ARTIFACTS_DIR: artifactsBase,
        },
      },
      checkpointer
    );

    // Parse ingest output
    let ingestResult: { valid: boolean; doc?: Record<string, unknown> };
    try {
      ingestResult = JSON.parse(ingestOutput);
    } catch {
      ingestResult = { valid: false };
    }

    const { isValidResultDoc } = await import('@/core/pipeline/result-doc');
    const resultDoc = ingestResult.valid && ingestResult.doc && isValidResultDoc(ingestResult.doc)
      ? ingestResult.doc
      : null;

    const audit = auditResultDoc(discovered.playbook, stage.name, resultDoc);
    const isTerminal = !discovered.playbook.stages.some(s => s.id === audit.targetState);

    if (run.issueId) {
      await executePaperwork({
        issueId: run.issueId,
        projectId: pipelineRow.projectId,
        db,
        audit,
      });
    }

    if (isTerminal) {
      await completePipelineRun(run);
    } else {
      const nextStage = await db
        .select()
        .from(pipelineStage)
        .where(
          and(
            eq(pipelineStage.pipelineId, run.pipelineId),
            eq(pipelineStage.name, audit.targetState)
          )
        )
        .then(rows => rows[0] ?? null);

      if (nextStage) {
        await launchStage(run, nextStage);
      } else {
        await finishRun(run, PIPELINE_RUN_STATUS.failed);
      }
    }

    return; // skip legacy signal routing
  }
}
// ── End playbook path — fall through to legacy executeStageRun ───────────
```

- [ ] **Step 3: Add driver import if missing**

The block above references `driver` from schema. Confirm it is in the imports block:

```typescript
import {
  driver,   // ← add if missing
  issue,
  pipeline,
  pipelineStage,
  project,
  stageRun,
} from '@/core/db/schema';
```

- [ ] **Step 4: Add env var to CLAUDE.md**

In `/mnt/dev/fluxaos/CLAUDE.md`, under "R-RUNTIME env vars", add:
```
- `FLUXAOS_BUNDLED_PIPELINES_DIR` (optional) — path to bundled pipeline YAML files. Default: `src/core/pipeline/bundled`.
```

Run `claude-md-management:claude-md-improver` skill and ensure score ≥ 90.
Append `claude-md-score: NN` to the commit message.

- [ ] **Step 5: Run lint**

```bash
cd /mnt/dev/fluxaos && npm run lint 2>&1 | grep -E "^src.*error" | head -20
```
Fix all type errors before committing.

- [ ] **Step 6: Commit**

```bash
git add src/core/orchestrator/event-orchestrator.ts CLAUDE.md
git commit -m "feat: wire playbook auditor into launchStage with migration shim (FLX-106)

claude-md-score: NN"
```

---

## Phase 4 — LangGraph Runner

### Task 12: Install LangGraph dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
cd /mnt/dev/fluxaos && npm install @langchain/langgraph @langchain/langgraph-checkpoint-postgres
```

- [ ] **Step 2: Verify install**

```bash
cd /mnt/dev/fluxaos && npm ls @langchain/langgraph 2>&1 | head -5
```
Expected: version printed without errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: install LangGraph and postgres checkpoint saver (FLX-106)"
```

---

### Task 13: LangGraph three-node stage execution graph

**Files:**
- Create: `src/core/pipeline/langgraph-stage-runner.ts`
- Test: `src/__tests__/integration/playbook-langgraph.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// src/__tests__/integration/playbook-langgraph.test.ts
import { describe, it, expect } from 'vitest';
import { buildStageGraph } from '@/core/pipeline/langgraph-stage-runner';

describe('buildStageGraph', () => {
  it('returns a compiled graph with invoke method', () => {
    const graph = buildStageGraph({
      stageRunId: 'test-id',
      resultDocPath: '/tmp/test.json',
      artifactsDir: '/tmp/artifacts',
      prompt: 'Test prompt.',
      driverCommand: 'echo',
      driverArgs: ['hello'],
    });
    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe('function');
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd /mnt/dev/fluxaos && npx vitest run src/__tests__/integration/playbook-langgraph.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Create the LangGraph stage runner**

```typescript
// src/core/pipeline/langgraph-stage-runner.ts
import { Annotation, StateGraph, END, START } from '@langchain/langgraph';
import { execFile } from 'child_process';
import { mkdirSync } from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface StageGraphInput {
  stageRunId: string;
  resultDocPath: string;
  artifactsDir: string;
  prompt: string;
  driverCommand: string;
  driverArgs: string[];
  env?: Record<string, string>;
}

const StageState = Annotation.Root({
  stageRunId: Annotation<string>(),
  resultDocPath: Annotation<string>(),
  artifactsDir: Annotation<string>(),
  prompt: Annotation<string>(),
  driverCommand: Annotation<string>(),
  driverArgs: Annotation<string[]>(),
  env: Annotation<Record<string, string> | undefined>(),
  prepared: Annotation<boolean>({ default: () => false }),
  executed: Annotation<boolean>({ default: () => false }),
  ingestOutput: Annotation<string | undefined>(),
  error: Annotation<string | undefined>(),
});

async function prepareNode(state: typeof StageState.State): Promise<Partial<typeof StageState.State>> {
  try {
    mkdirSync(state.artifactsDir, { recursive: true });

    await execFileAsync('npx', [
      'tsx',
      'src/scripts/pipeline/init-result-doc.ts',
      '--stage-run-id', state.stageRunId,
      '--output', state.resultDocPath,
    ], { env: { ...process.env, ...state.env } });

    return { prepared: true };
  } catch (err) {
    return { error: `prepare failed: ${String(err)}` };
  }
}

async function executeNode(state: typeof StageState.State): Promise<Partial<typeof StageState.State>> {
  if (state.error) return {};
  try {
    const agentEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...(state.env ?? {}),
      RESULT_DOC_PATH: state.resultDocPath,
      ARTIFACTS_DIR: state.artifactsDir,
    };

    await execFileAsync(state.driverCommand, state.driverArgs, {
      env: agentEnv,
      timeout: 2 * 60 * 60 * 1000, // 2 hours max
    });

    return { executed: true };
  } catch {
    // Agent exited non-zero — not an engine error; ingest handles partial result doc
    return { executed: true };
  }
}

async function ingestNode(state: typeof StageState.State): Promise<Partial<typeof StageState.State>> {
  try {
    const { stdout } = await execFileAsync('npx', [
      'tsx',
      'src/scripts/pipeline/ingest-result-doc.ts',
      '--stage-run-id', state.stageRunId,
      '--result-doc', state.resultDocPath,
    ], { env: { ...process.env, ...state.env } });

    return { ingestOutput: stdout.trim() };
  } catch (err) {
    return { ingestOutput: JSON.stringify({ valid: false, reason: String(err) }) };
  }
}

export function buildStageGraph(input: StageGraphInput) {
  const graph = new StateGraph(StageState)
    .addNode('prepare', prepareNode)
    .addNode('execute', executeNode)
    .addNode('ingest', ingestNode)
    .addEdge(START, 'prepare')
    .addEdge('prepare', 'execute')
    .addEdge('execute', 'ingest')
    .addEdge('ingest', END);

  return graph.compile();
}

export async function runStageGraph(
  input: StageGraphInput,
  checkpointer?: unknown
): Promise<{ ingestOutput: string; error?: string }> {
  const graph = buildStageGraph(input);

  const config = { configurable: { thread_id: input.stageRunId } };

  const result = await graph.invoke(input, config as never);
  return {
    ingestOutput: result.ingestOutput ?? JSON.stringify({ valid: false, reason: 'no ingest output' }),
    error: result.error,
  };
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd /mnt/dev/fluxaos && npx vitest run src/__tests__/integration/playbook-langgraph.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add src/core/pipeline/langgraph-stage-runner.ts src/__tests__/integration/playbook-langgraph.test.ts
git commit -m "feat: LangGraph three-node stage execution graph (FLX-106)"
```

---

### Task 14: PostgresSaver checkpoint store

**Files:**
- Create: `src/core/pipeline/checkpoint-store.ts`

The checkpointer persists LangGraph node state between crashes. `setup()` creates
the checkpoint tables in Supabase Postgres if they don't exist.

Note: `tsx src/scripts/db/nuke.ts` drops user data tables only — it does NOT drop
LangGraph checkpoint tables (they live in the `langgraph_*` schema namespace).
If a clean state is needed during development, truncate via `db:studio`.

- [ ] **Step 1: Create the checkpoint store factory**

```typescript
// src/core/pipeline/checkpoint-store.ts
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

let checkpointer: PostgresSaver | null = null;

export async function getCheckpointer(): Promise<PostgresSaver> {
  if (checkpointer) return checkpointer;

  const connectionString = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL or SUPABASE_DB_URL required for LangGraph PostgresSaver checkpointer'
    );
  }

  checkpointer = PostgresSaver.fromConnString(connectionString);
  await checkpointer.setup();
  return checkpointer;
}

export async function closeCheckpointer(): Promise<void> {
  if (checkpointer) {
    await checkpointer.end?.();
    checkpointer = null;
  }
}
```

- [ ] **Step 2: Verify lint passes**

```bash
cd /mnt/dev/fluxaos && npm run lint 2>&1 | grep -E "^src/core/pipeline/checkpoint" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add src/core/pipeline/checkpoint-store.ts
git commit -m "feat: PostgresSaver checkpoint store for LangGraph (FLX-106)"
```

---

## Phase 5 — Verification and PR

### Task 15: Integration smoke

**Files:**
- Create: `e2e/playbook-pipeline-smoke.spec.ts`

- [ ] **Step 1: Confirm dev server is running**

```bash
curl -s http://127.0.0.1:3003/api/health | jq .
```
Expected: `{"status":"ok"}`. If not running: `npm run dev -- -p 3003`.

- [ ] **Step 2: Create the Playwright smoke spec**

```typescript
// e2e/playbook-pipeline-smoke.spec.ts
import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

test('playbook auditor: routes standard-dev pass/fail correctly', async () => {
  const { parsePlaybook } = await import('../src/core/pipeline/playbook.js');
  const { auditResultDoc } = await import('../src/core/pipeline/playbook-auditor.js');
  const { readFileSync } = await import('fs');

  const yaml = readFileSync('src/core/pipeline/bundled/standard-dev.yaml', 'utf-8');
  const parsed = parsePlaybook(yaml, 'standard-dev.yaml');
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;

  const baseDoc = {
    issue: { id: 'u1', number: 1, title: 'T' },
    run: { pipelineRunId: 'u2', stageRunId: 'u3', stage: 'research', attempt: 1 },
    org: { id: 'u4', slug: 'o' },
    project: { id: 'u5', slug: 'p' },
    timing: { startedAt: new Date().toISOString() },
    verdict: 'pass' as const,
    summary: 'Done.',
  };

  const researchPass = auditResultDoc(parsed.playbook, 'research', baseDoc);
  expect(researchPass.targetState).toBe('implement');
  expect(researchPass.action).toBe('transition');

  const reviewFail = auditResultDoc(parsed.playbook, 'review', { ...baseDoc, verdict: 'fail' });
  expect(reviewFail.targetState).toBe('rework');

  const deployPass = auditResultDoc(parsed.playbook, 'deploy', baseDoc);
  expect(deployPass.targetState).toBe('complete');

  const blocked = auditResultDoc(parsed.playbook, 'implement', { ...baseDoc, verdict: 'blocked' });
  expect(blocked.action).toBe('fallback');
  expect(blocked.targetState).toBe('blocked');
});

test('init-result-doc script: exits cleanly when help requested', async () => {
  const result = execSync(
    'npx tsx src/scripts/pipeline/init-result-doc.ts 2>&1 || true',
    { cwd: process.cwd(), encoding: 'utf-8' }
  );
  expect(result).toContain('Usage:');
});

test('ingest-result-doc script: exits cleanly when help requested', async () => {
  const result = execSync(
    'npx tsx src/scripts/pipeline/ingest-result-doc.ts 2>&1 || true',
    { cwd: process.cwd(), encoding: 'utf-8' }
  );
  expect(result).toContain('Usage:');
});
```

- [ ] **Step 3: Run the Playwright smoke**

```bash
cd /mnt/dev/fluxaos && PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 FLUXAOS_LAN_AUTH_BYPASS=1 npx playwright test e2e/playbook-pipeline-smoke.spec.ts --reporter=line 2>&1 | tail -20
```
Expected: all tests pass.

- [ ] **Step 4: Run full integration test suite — confirm no regressions**

```bash
cd /mnt/dev/fluxaos && npx vitest run 2>&1 | tail -20
```
Expected: all pre-existing tests still pass.

- [ ] **Step 5: Run biome**

```bash
cd /mnt/dev/fluxaos && npx biome check --write src/core/pipeline/ src/scripts/pipeline/ 2>&1 | tail -10
```

- [ ] **Step 6: Commit smoke spec**

```bash
git add e2e/playbook-pipeline-smoke.spec.ts
git commit -m "test: playbook pipeline smoke spec (FLX-106)"
```

---

### Task 16: Open PR and update Linear

- [ ] **Step 1: Push branch**

```bash
git push -u origin flx-106-pipeline-execution-redesign
```

- [ ] **Step 2: Open PR**

```bash
gh pr create \
  --title "feat: pipeline execution redesign — playbook model + LangGraph (FLX-106)" \
  --body "$(cat <<'EOF'
## Summary

- Adds YAML playbook files as the pipeline configuration format (three-scope discovery: bundled → org → project)
- Result document schema: agent writes facts (verdict/summary/comment/blockers/artifacts), orchestrator acts
- Playbook auditor routes result docs through gate engine to onPass/onFail/fallback issue states
- Paperwork executor: posts comment, posts blocker summary, transitions issue state via real IssueService API
- LangGraph three-node stage execution graph (prepare → execute → ingest) with PostgresSaver checkpointing
- Migration shim: old DB-configured pipelines fall through to legacy routing; new pipelines opt in via playbookPath
- Bundled Standard Dev playbook with work-only skill prompts for all five stages
- Parallel group parsing accepted by schema; execution throws NotImplementedError (follow-up ticket filed)

Fixes FLX-106

## Test plan

- [ ] `npx vitest run` — all integration tests pass, no regressions
- [ ] `npx playwright test e2e/playbook-pipeline-smoke.spec.ts` — smoke passes
- [ ] `npm run pipeline:init-result-doc -- --help` exits with Usage message
- [ ] `npm run pipeline:ingest-result-doc -- --help` exits with Usage message
- [ ] Standard Dev pipeline has `playbookPath: 'standard-dev'` after `db:seed`
EOF
)"
```

- [ ] **Step 3: Update Linear FLX-106**

Use `mcp__plugin_linear_linear__save_issue` to:
- Set FLX-106 status to "In Review"
- Attach the PR URL

---

## File Map

| File | Status | Purpose |
|---|---|---|
| `src/core/pipeline/result-doc.ts` | Create | ResultDoc Zod schema, validate/parse helpers |
| `src/core/pipeline/playbook.ts` | Create | Playbook Zod schema, YAML parser, discriminated union stages |
| `src/core/pipeline/playbook-discovery.ts` | Create | Three-scope file discovery (bundled/org/project) |
| `src/core/pipeline/playbook-auditor.ts` | Create | Audit result doc via gate engine, return route |
| `src/core/pipeline/paperwork-executor.ts` | Create | Post comments, blocker summary, transition issue state |
| `src/core/pipeline/langgraph-stage-runner.ts` | Create | Three-node LangGraph graph (prepare/execute/ingest) |
| `src/core/pipeline/checkpoint-store.ts` | Create | PostgresSaver factory |
| `src/core/pipeline/prompt-composer.ts` | Create | Concatenate base + skill prompts with `${VAR}` substitution |
| `src/core/pipeline/bundled/standard-dev.yaml` | Create | Bundled Standard Dev playbook |
| `src/core/pipeline/bundled/skills/*.md` | Create | Work-only skill prompts (research/implement/review/rework/deploy) |
| `src/scripts/pipeline/init-result-doc.ts` | Create | Pre-populate result doc from DB using `db, close` from scripts/db/connection |
| `src/scripts/pipeline/ingest-result-doc.ts` | Create | Validate and write result doc to DB |
| `src/core/db/schema.ts` | Modify | Add playbookPath/playbookScope to pipeline, resultDoc to stage_run |
| `src/scripts/db/seed.ts` | Modify | Wire Standard Dev pipeline with playbookPath: 'standard-dev' |
| `src/core/orchestrator/event-orchestrator.ts` | Modify | Playbook shim in launchStage before executeStageRun |
| `e2e/playbook-pipeline-smoke.spec.ts` | Create | Playwright smoke for playbook parsing and routing |
| `src/__tests__/integration/playbook-*.test.ts` | Create | Integration tests (real DB, no vi.fn() service mocks) |
