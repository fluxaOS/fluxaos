# FLX-106 Discovery Notes

Verified signatures for every identifier the plan will use. File:line citations are exact.
No code, no plan edits — citations only.

---

## 1. DB connection — `src/core/db/connection.ts`

```ts
// src/core/db/connection.ts:10
export type Database = ReturnType<typeof drizzle<typeof schema>>;
```

**There is no `createDb` factory.** Core code only imports the type.

For scripts that need a live connection:

```ts
// src/scripts/db/connection.ts — used by CLI scripts
export const db = provider.getConnection();
export async function close(): Promise<void>
```

Import pattern for any new script:
```ts
import { db, close } from '@/scripts/db/connection';
// ... work ...
await close();
```

The new playbook-runner node runs inside the orchestrator (not as a standalone script),
so it receives `db: Database` via DI — no `close()` needed there.

---

## 2. IssueService — `src/core/services/issue.ts`

Factory: `createIssueService(db: Database)` → returns object. Lines 61–881.
Exported type alias: `IssueService = ReturnType<typeof createIssueService>` (line 883).

### `create` (line 369)
```ts
async create(data: {
  projectId: string;
  title: string;
  bodyMd?: string;
  typeId: string;       // REQUIRED — no default
  priorityId: string;  // REQUIRED — no default
  assignee?: string;
  labels?: unknown[];
  author?: string;
  parentIssueId?: string;
}): Promise<IssueSelect>
```

### `transition` (line 571)
```ts
async transition(
  id: string,
  toStateId: string,
  version: number,    // positional arg 3 — optimistic concurrency token
  userId?: string
): Promise<IssueSelect>
```
Throws `VERSION_CONFLICT` if `current.version !== version`.

### `stateOverride` (line 634)
Same signature as `transition`. Skips transition-graph validation.

### `close` (line 696)
```ts
async close(
  id: string,
  version: number,
  userId?: string
): Promise<IssueSelect>
```
Finds terminal state, delegates to `stateOverride`.

### `getStateByKey` (line 754)
```ts
async getStateByKey(projectId: string, key: string): Promise<IssueStateSelect>
```

### `getStateByConfigKey` (line 768)
```ts
async getStateByConfigKey(projectId: string, configKey: string): Promise<IssueStateSelect>
```

### `getStatusIdByConfigKey` (line 761)
```ts
async getStatusIdByConfigKey(projectId: string, configKey: string): Promise<string>
```

### `updateStatus` (line 734)
```ts
async updateStatus(
  id: string,
  statusId: string,
  actor: string,
  reason?: string
): Promise<IssueSelect>
```
No version check — status is non-versioned.

### No comment API on IssueService
There is no `comment.create`, no `issueService.comment`, no `blockerOfIssueId` field.
Comments are a separate service.

---

## 3. IssueCommentService — `src/core/services/issue-comment.ts`

Factory: `createIssueCommentService(db: Database)` → returns object. Lines 41–246.

### `create` (line 78)
```ts
async create(
  issueId: string,
  input: { bodyMd: string; author: string }
): Promise<IssueCommentSelect>
```
Allocates `commentNumber` with MAX+1 query. Renders HTML. Records `comment_added` event.

### No blocker relation table
There is no `blockerOfIssueId`, no `issueBlocker` join table, no FK from issue → issue for
blocking. Blocker reporting must be done via comment body text on the parent issue.

---

## 4. Schema — `src/core/db/schema.ts`

### `pipeline` (line 90)
```ts
pipeline = pgTable('pipeline', {
  id, projectId, name, description, isDefault, createdAt, updatedAt
})
```
No `playbookPath` column. Playbook lookup must be by `pipeline.name` slug convention,
not a stored path.

### `pipelineStage` (line 102)
```ts
pipelineStage = pgTable('pipeline_stage', {
  id, pipelineId, name, sortOrder, personaId,
  driver,         // text — legacy string slug
  timeoutSec, maxRetries,
  gateMode, gateRules,   // jsonb
  skillId,        // uuid FK → skill.id
  driverId,       // uuid FK → driver.id
  createdAt, updatedAt
})
```

### `stageRun` (line 138)
```ts
stageRun = pgTable('stage_run', {
  id, pipelineRunId, pipelineStageId,
  status, provider, model,
  driver,          // text slug
  attempt,
  pid, exitCode,
  costUsd, tokensIn, tokensOut,
  skillId, driverId,
  skillSignal, skillMetadata,  // jsonb
  trigger, errorMessage,
  startedAt, completedAt,
  createdAt, updatedAt
})
```

### `driver` (line 186)
```ts
driver = pgTable('driver', {
  id, name, slug, binary, defaultArgs,
  modelFlag, dirFlag, sessionNameFlag,
  promptTransport,      // text, default 'argv' — line 195
  outputFormat,         // text, default 'stream-json'
  outputFormatFlag,
  promptSendDelayMs,
  probeCommand,
  issuePromptTemplate,
  queuePromptTemplate,
  envVars, extraArgs,
  contextLayout,        // jsonb — REQUIRED, no default
  isEnabled,
  notes, version,
  createdAt, updatedAt
})
```

`promptTransport` seeded values (from `src/scripts/db/seed.ts` lines 222, 257):
- claude-code driver: `'argv'`
- openai-codex driver: `'argv'`

The stage-runner reads `driver.promptTransport` to decide how to pass the prompt.
New playbook code must read `driverRow.promptTransport`, not hardcode `'argv'`.

### `issue` (line 437)
```ts
issue = pgTable('issue', {
  id, projectId, number, title,
  bodyMd, bodyHtml,
  stateId, statusId, typeId, priorityId,
  isClosed, assignee, author, labels,
  version,        // optimistic concurrency — line 462
  source, closedAt,
  parentIssueId,  // uuid self-FK — line 471
  createdAt, updatedAt
})
```

**No blocker FK column.** `parentIssueId` is a parent/child (epic) relationship,
not a blocker relationship.

### `issueComment` (line 498)
```ts
issueComment = pgTable('issue_comment', {
  id, issueId, commentNumber, bodyMd, bodyHtml,
  author, version, isDeleted, editedAt,
  createdAt, updatedAt
})
```

### No blocker table
Searched schema: no `issueBlocker`, no `blocker_of_issue_id`, no blocking join table exists.

---

## 5. Orchestrator — `src/core/orchestrator/event-orchestrator.ts`

### `launchStage` (line 184)
```ts
async function launchStage(
  run: typeof pipelineRun.$inferSelect,
  stage: typeof pipelineStage.$inferSelect,
  preExisting?: typeof stageRun.$inferSelect
): Promise<void>
```

Flow inside `launchStage`:
1. Lines 193–194: reuse `preExisting` or call `runService.createStageRun()`
2. Lines 196–217: evaluate pre-gate (`hold`/`manual` modes short-circuit here)
3. Line 221: **`await executeStageRun(...)`** — the agent actually runs here
4. Lines 250–263: post-execution gate evaluation
5. Lines 271–285: call `applyVerdict(...)` with gate result

**The playbook branch must hook in at line 184 (`launchStage`), before line 221
(`executeStageRun`).** Hooking into `applyVerdict` is too late — the agent has
already run with the wrong prompt.

### `applyVerdict` (line 318)
```ts
async function applyVerdict(
  run: typeof pipelineRun.$inferSelect,
  stage: typeof pipelineStage.$inferSelect,
  sRun: typeof stageRun.$inferSelect,
  verdict: string,
  signalReason?: string | null,
  signalMeta?: Record<string, unknown> | null
): Promise<void>
```

Verdict routing (lines 326–408):
- `'proceed'` → launch next stage or complete run
- `'hold'` → mark stage pending; if `signalReason === 'already_complete'` → `stateOverride`; else → `updateStatus` to blocked
- `'rework'` → `handleReworkVerdict` → `getStateByConfigKey('issues.state.on_rework_key')` → `stateOverride`
- `'abort'` → `finishRun(failed)` + issue event

Current imports (lines 15–43): does NOT import `project` table. If the playbook
branch needs `project.slug` for scope discovery, the import must be added.

---

## 6. Gate Engine — `src/core/gates/engine.ts`

### `evaluateGate` (line 37)
```ts
export function evaluateGate(
  mode: GateMode,
  rules: RuleGroup | null,
  context: Record<string, unknown>
): GateEvaluation
```

Returns `GateEvaluation`:
```ts
{
  verdict: GateVerdict,      // 'proceed' | 'hold' | 'rework' | 'abort'
  passed: boolean,
  worstAction: FailureAction | null,
  ruleResults: RuleResult[],
  groupResult: GroupResult | null,
  reason: string,
}
```

### `resolveField` (line 196)
```ts
function resolveField(field: string, context: Record<string, unknown>): unknown {
  const parts = field.split('.');
  let current: unknown = context;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
```

**Context must be a properly nested object, not a flat string-key map.**
`{'meta.duration_sec': 142}` would NOT match a rule `field: 'meta.duration_sec'`
because `resolveField` splits on `.` and walks the object tree. The result doc
passed as context must already be structured: `{ meta: { duration_sec: 142 } }`.

### `FailureAction` enum (line 274–281)
```ts
const ACTION_WEIGHT: Record<FailureAction, number> = {
  abort: 6,
  rework: 5,
  hold: 4,
  escalate: 3,
  notify: 2,
  proceed: 1,
}
```
Six values: `'abort' | 'rework' | 'hold' | 'escalate' | 'notify' | 'proceed'`.
`worstAction` can also be `null` (no blocking failures, or warn-only).

### Severity `warn` behavior (lines 303–306)
```ts
// Warn-severity failures don't block — they always proceed
if (worst.rule.severity === 'warn') return null;
```
Warn-only failures produce `worstAction: null` → `verdict: 'proceed'` → `passed: true`.
The auditor does not need to treat warn failures as blocking.

### `GateVerdict` → `FailureAction` mapping (line 309–326)
```ts
function actionToVerdict(action: FailureAction | null): GateVerdict {
  if (action === null) return 'proceed';
  switch (action) {
    case 'abort':    return 'abort';
    case 'rework':   return 'rework';
    case 'hold':
    case 'escalate':
    case 'notify':   return 'hold';
    case 'proceed':  return 'proceed';
    default:         return 'hold';
  }
}
```

---

## 7. Integration tests — `src/__tests__/integration/`

Files present (38 total, flat directory — no subdirectories):

```
artifacts-cleanup.test.ts       artifacts-fs.test.ts
artifacts-inheritance.test.ts   artifacts-path.test.ts
brand-service.test.ts           cleanup-artifacts.test.ts
cleanup-fixtures.ts             cleanup-scheduler.test.ts
cleanup.test.ts                 cleanup-triggers.test.ts
crud-factory.test.ts            daemon.test.ts
deploy-bridge.test.ts           driver-crud.test.ts
epic.test.ts                    event-orchestrator-prelaunch.test.ts
feature-gated-tier.test.ts      features-primitive.test.ts
forge-router.test.ts            gates.test.ts
github-adapter.test.ts          gitignore.test.ts
isolation-provider.test.ts      issue-comment.test.ts
mission-control.test.ts         orchestrator-e2e.test.ts
path-resolver.test.ts           pipeline-terminal-hook.test.ts
project-settings.test.ts        realtime.test.ts
role-protected-mutations.test.ts services.test.ts
signal-parser.test.ts           skill-crud.test.ts
stage-runner-config.test.ts     stage-runner-issue-events.test.ts
stdout-parser.test.ts           supabase-connection.test.ts
worktree-copy.test.ts           worktree.test.ts
```

**Convention:**
- All tests live flat in `src/__tests__/integration/`
- No `src/__tests__/pipeline/` subdirectory exists
- New tests go in `src/__tests__/integration/` — named `playbook-parser.test.ts`,
  `playbook-runner.test.ts`, etc.
- `vi.fn()` mocks of real service interfaces are the policy violation to avoid
- Pure-function tests (like `signal-parser.test.ts`) are allowed alongside real-DB tests

---

## 8. Seed — `src/scripts/db/seed.ts`

### Standard Dev pipeline (lines 108–126)
```ts
[pipe] = await db.insert(pipeline).values({
  projectId: proj.id,
  name: 'Standard Dev',
  description: 'Research → Implement → Review → Deploy',
  isDefault: true,
}).returning();
```

**No `playbookPath` column on `pipeline`.** The schema has no such field.

### Stages seeded (lines 153–169)
```ts
const stagesDef = [
  { name: 'research',  sortOrder: 1, gateMode: 'auto',   gateRules: {} },
  { name: 'implement', sortOrder: 2, gateMode: 'rules',  gateRules: implementGateRules },
  { name: 'review',    sortOrder: 3, gateMode: 'auto',   gateRules: {} },
  { name: 'rework',    sortOrder: 4, gateMode: 'rules',  gateRules: implementGateRules },
  { name: 'deploy',    sortOrder: 5, gateMode: 'manual', gateRules: {} },
];
```

Skills seeded with `promptTemplate` combining `PIPELINE_PROMPT + ROLE_PROMPTS[name]`
(lines 291–491). Each stage's skill is a full text prompt, not a playbook path.

**C6 implication:** Since `pipeline` has no `playbookPath` column, the playbook
migration shim cannot branch on `pipeline.playbookPath != NULL`. Alternative
approach: use a naming convention (pipeline.name matches a bundled playbook slug)
or add a migration to add `playbookPath` to `pipeline`.

---

## Summary of plan corrections required

| Finding | Citation | Fix |
|---------|----------|-----|
| C1: `createDb` does not exist | `connection.ts:10` | Orchestrator receives `db: Database` via DI; scripts use `src/scripts/db/connection.ts` |
| C4: `issueService.comment.create` fabricated | `issue.ts:883` | Use `createIssueCommentService(db).create(issueId, {bodyMd, author})` |
| C4: `transition(id, stateId, version)` — version is arg 3 | `issue.ts:571` | Must read `issueRow.version` from DB before calling |
| C4: `blockerOfIssueId` fabricated | schema search | No blocker table; post single formatted comment via `createIssueCommentService` |
| C6: `playbookPath` not on pipeline | `schema.ts:90`, `seed.ts:115` | Need migration to add column, OR use pipeline.name convention |
| I4: flat context map breaks gate engine | `engine.ts:196–210` | Pass result doc as nested object; `resolveField` walks tree |
| I6: hardcoded `argv` | `schema.ts:195`, `seed.ts:222` | Read `driverRow.promptTransport` at runtime |
| I8: hook in `launchStage` not `applyVerdict` | `orchestrator.ts:184,221,318` | Playbook branch before `executeStageRun` at line 221 |
| I8: `project` import missing | `orchestrator.ts:15–43` | Add `project` to schema imports if scope lookup needed |
| Test paths | `ls __tests__/integration/` | `src/__tests__/integration/playbook-*.test.ts`, not `src/__tests__/pipeline/` |
