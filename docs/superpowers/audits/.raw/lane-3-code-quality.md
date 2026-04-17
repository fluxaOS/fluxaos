# Lane 3 — Code Quality Auditor — Raw Output

## Required-reading proof

- **invariants.md:** "No driver name appears in application code. The words \"claude-code,\" \"aider,\" \"codex\" must never appear in src/ except in adapter registration and seed data."
- **2026-04-07-fluxaos-spec-v2.md:** "Core business logic lives in `core/` and imports ONLY from `core/ports/` — TypeScript interfaces that define contracts."
- **2026-04-09-rebuild-spec.md:** "DRY strictly enforced. No exceptions without prior discussion. No copy-paste between adapters, routers, or services."
- **CLAUDE.md:** "**Agnostic engine** — no stage/provider/driver/enum literals in app code (seed data and adapters only)"
- **session-quick-start.md:** "Optimistic concurrency required on all mutable entities (`WHERE version = $expected`)"

## Mechanical-check output

### 1. Unused-export heuristic

Exports scanned across R-UI-1 + R-UI-2 in-scope files. Cross-referenced each exotic export against the repository.

Notable findings:
- `src/core/orchestrator/types.ts` re-exports `DEFAULT_ORCHESTRATOR_CONFIG`, `OrchestratorConfig`, `StageJobPayload` — only consumers are the barrel at `src/core/orchestrator/index.ts` (unused) and `src/core/orchestrator/stage-worker.ts` (dead — see Finding CQ-3) plus tests.
- `src/core/pipeline/types.ts`: `PIPELINE_RUN_TRANSITIONS`, `STAGE_RUN_TRANSITIONS`, `CreatePipelineInput`, `UpdatePipelineInput`, `CreatePipelineStageInput`, `StageRunMetadata` — zero callers outside the defining file (`grep -rn "from '@/core/pipeline/types'"` returns empty).
- `src/core/orchestrator/index.ts` (barrel): `grep -rn "from '@/core/orchestrator'"` returns empty — nobody consumes the barrel.
- `src/core/orchestrator/stage-worker.ts`: `createStageJobHandler` — only referenced from the unused barrel; no runtime callers.

### 2. Vendor-term leakage (harness)

Command: `grep -rn 'harness\|Harness' src/ --include='*.ts' --include='*.tsx' --exclude-dir=__tests__ | grep -v 'seed\|fixture'`

Output: **(empty)** — rename is clean.

### 3. Magic strings in added lines

R-UI-1 diff (62de54c..5cdcc1b):
```
+                <option value="global">global</option>
+                <option value="project">project</option>
+            type="button"
+            type="checkbox"
+            type="text"
```
All legit React/HTML attributes or DB-enum select options for `scope`.

R-UI-2 diff (main..HEAD):
```
+        data-testid="live-output-pane"
```
Test-selector literal — legitimate.

## Findings

### AUDIT-CQ-1: Driver router inlines optimistic-lock update instead of reusing the service pattern
- **Category:** DRY
- **Severity:** High
- **File:line:** `src/server/routers/driver.ts:88-97`; contrast with `src/core/services/skill.ts:43-58` + `src/server/routers/skill.ts:61-70`
- **Evidence (driver router):**
  ```
  .mutation(async ({ ctx, input }) => {
    const { id, version, ...data } = input;
    const [row] = await ctx.db
      .update(driver)
      .set({ ...(data as any), version: version + 1, updatedAt: new Date() })
      .where(and(eq(driver.id, id), eq(driver.version, version)))
      .returning();
    if (!row) throw new Error('Optimistic concurrency conflict');
    return row;
  }),
  ```
  Compare `src/core/services/skill.ts:47-57` which encapsulates the same pattern behind `updateWithVersion`. The CRUD factory in `src/core/services/crud-factory.ts:41-48` provides a non-versioned `update` and was never extended with the versioned variant even though R-UI-1 made version-locked update the norm.
- **Direction:** Hoist the version-locked update pattern into the shared CRUD factory (or a sibling helper) so driver/skill/future entities stop hand-rolling the `version + 1` + `WHERE version = expected` clause.

### AUDIT-CQ-2: `src/core/orchestrator/stage-worker.ts` is a dead parallel execution path with a mutually inconsistent command builder
- **Category:** dead
- **Severity:** High
- **File:line:** `src/core/orchestrator/stage-worker.ts:38-117` (handler), `:127-154` (inline `buildCommand`); only consumer is the unused barrel at `src/core/orchestrator/index.ts:7`.
- **Evidence:**
  ```
  function buildCommand(
    routing: StageJobPayload['routing'],
    prompt: string,
  ): { command: string; args: string[]; env: Record<string, string> } {
    ...
    return {
      command: routing.driver,
      args: ['--prompt', prompt, '--model', routing.modelIdentifier],
      env,
    };
  }
  ```
  This hardcodes `--prompt` / `--model` flags and ignores every `driver` column (`binary`, `modelFlag`, `defaultArgs`, `promptTransport`, etc.) that `src/core/orchestrator/command-builder.ts:72-137` consumes. The live execution path is `stage-runner.ts → command-builder.ts`; nothing invokes `createStageJobHandler`.
- **Direction:** Delete the unused worker + its inline `buildCommand` (or replace the inline logic with `buildCommand` from `command-builder.ts`) before R-UI-2 wires BullMQ — otherwise the spec's planned "rewrite job handler to call `executeStageRun` via the shared path" lands onto a file that will silently conflict with the canonical command assembly.

### AUDIT-CQ-3: `src/core/pipeline/types.ts` — entire module is dead code
- **Category:** dead
- **Severity:** Medium
- **File:line:** `src/core/pipeline/types.ts:1-73`
- **Evidence:** `grep -rn "from '@/core/pipeline/types'" src/` returns empty. `PIPELINE_RUN_TRANSITIONS`, `STAGE_RUN_TRANSITIONS`, `CreatePipelineInput`, `UpdatePipelineInput`, `CreatePipelineStageInput`, `StageRunMetadata` are defined but never imported. Parallel `PipelineRunStatus` / `StageRunStatus` are also defined in `src/core/constants.ts:12-49` and re-exported via `src/core/orchestrator/types.ts:9-23` — the constants.ts version is the one in use.
- **Direction:** Remove `src/core/pipeline/types.ts` or replace it with a pure re-export of the real source of truth — keeping a second copy risks future drift on status literals.

### AUDIT-CQ-4: `src/core/orchestrator/index.ts` barrel is never imported; exposes dead symbols
- **Category:** dead
- **Severity:** Low
- **File:line:** `src/core/orchestrator/index.ts:1-22`
- **Evidence:** `grep -rn "from '@/core/orchestrator'"` returns empty. Every consumer imports the concrete submodule file directly (`event-orchestrator`, `manual-run`, `pipeline-run-service`, `stage-runner`, `types`). The barrel's only job today is to keep `createStageJobHandler` and `DEFAULT_ORCHESTRATOR_CONFIG` reachable via a path nobody uses.
- **Direction:** Delete the barrel or shrink it to only the symbols the outside world actually consumes (currently: zero).

### AUDIT-CQ-5: `RunDetailModal` runs Realtime subscription AND a 2-second polling refetch for the same data
- **Category:** over-eng
- **Severity:** High
- **File:line:** `src/components/pipeline/RunDetailModal.tsx:67-76` + `:143-187`
- **Evidence:**
  ```
  const runQuery = trpc.pipeline.runs.get.useQuery(
    { id: queryRunId },
    {
      enabled: isOpen,
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === 'running' || status === 'queued' ? 2000 : false;
      },
    }
  );
  ```
  Immediately below, the component also subscribes to the `stage_run` UPDATE table via `useRealtime().subscribeToTable(...)` and merges rows into the same cache. The R-UI-2 design (spec lines 41, 88–89) and invariant 18 require Realtime to be the streaming mechanism with no polling fallbacks; this pairs both.
- **Direction:** The Realtime subscription supersedes the polling — keeping both is either a forgotten leftover or two code paths fighting over the same cache; pick one and back the spec's explicit "no fallbacks" stance.

### AUDIT-CQ-6: R-UI-2 `issue activity feed` Realtime subscription was promised in spec but the file was untouched
- **Category:** dead (unfulfilled spec hook) / magic-value
- **Severity:** Medium
- **File:line:** `src/app/[org]/[user]/[project]/issues/[number]/client.tsx` (whole file; no `useRealtime` import)
- **Evidence:** R-UI-2 spec section "Three subscription-site changes" item 3 calls for `useRealtime().subscribeToTable<IssueEventRow>(...)` in this file, and the spec's "Files > Modified" lists it. `grep "useRealtime\|issue_event" src/app/[org]/[user]/[project]/issues/[number]/client.tsx` returns empty, and the only working-tree change on `feat/r-ui-2-impl` shows imports unchanged. The activity feed still relies on `eventsQuery.refetch()` inside comment/state mutation success callbacks (lines 388–407).
- **Direction:** Either ship the subscription the spec promised or move this file out of the R-UI-2 surface — right now it contradicts the spec's exit criterion #2 ("Activity feed auto-refreshes").

### AUDIT-CQ-7: Pipeline router hardcodes run/stage status literals and event-type strings already defined in `core/constants`
- **Category:** magic-value
- **Severity:** Medium
- **File:line:** `src/server/routers/pipeline.ts:121-124`, `:220-238`, `:258-263`, `:273-279`, `:338-341`, `:382-385`
- **Evidence:**
  ```
  await svc.updateRunStatus(run.id, 'running');
  ...
  await svc.updateStageRunStatus(sr.id, 'launching');
  await svc.appendEvent(sr.id, 'launched', { ... });
  ...
  if (!['completed', 'failed', 'timed_out', 'cancelled'].includes(s.status)) {
  ```
  Meanwhile `src/core/constants.ts:12-65` exports `PIPELINE_RUN_STATUS`, `STAGE_RUN_STATUS`, `STAGE_RUN_TERMINAL`, and `EVENT_TYPE` constants the R-UI-1 rename wave touched. This file is in-scope per the R-UI-1 file list.
- **Direction:** Route these literals through the existing `core/constants` exports so the one in-source source of truth for status/event vocabulary is preserved; the per-call-site string literals are exactly the "drift risk" invariant 11 warns against.

### AUDIT-CQ-8: Stage-worker ignores driver config; writes routing into `FLUXAOS_*` env vars that no live code reads
- **Category:** dead / magic-value
- **Severity:** Medium
- **File:line:** `src/core/orchestrator/stage-worker.ts:131-144`
- **Evidence:**
  ```
  env.FLUXAOS_PROVIDER = routing.providerName;
  env.FLUXAOS_MODEL = routing.modelIdentifier;
  env.FLUXAOS_PROMPT = prompt;
  ...
  if (keyValue) {
    env.FLUXAOS_API_KEY = keyValue;
  }
  ```
  `grep -rn "FLUXAOS_PROVIDER\|FLUXAOS_MODEL\|FLUXAOS_PROMPT\|FLUXAOS_API_KEY" src/` only returns hits in this file — no subprocess consumer reads them. Magic env-var names defined in code, not config.
- **Direction:** Either wire the stage-worker to the real `command-builder` (per Finding CQ-2) and drop these invented env names, or delete the worker entirely.

### AUDIT-CQ-9: `output-parser.ts` hardcodes the Anthropic Messages JSON protocol inside `src/core/`
- **Category:** vendor-leak
- **Severity:** Medium
- **File:line:** `src/core/orchestrator/output-parser.ts:66-152`
- **Evidence:**
  ```
  if (type === 'assistant') {
    const msg = (evt.message ?? {}) as Record<string, unknown>;
    ...
    if (p.type === 'text') { ... }
    else if (p.type === 'tool_use') { ... }
  ...
  if (type === 'user') {
    ...
    if (p.type === 'tool_result') { ... }
  ```
  The `assistant`/`user`/`tool_use`/`tool_result`/`total_cost_usd` vocabulary is the Anthropic Messages streaming schema verbatim (matches the payload shape emitted by `claude-code`'s `--output-format stream-json`). `getParser(outputFormat)` at `:178-189` still dispatches on an opaque string, but the `stream-json` branch is hard-coded to a single vendor's protocol inside `src/core/`.
- **Direction:** Move vendor-shaped JSON parsing behind an adapter (or at minimum a configurable parser registry) — per invariant 7 + spec §Adapter Architecture the `core/` tree shouldn't embed a specific provider's wire format.

### AUDIT-CQ-10: `createEventOrchestrator` declared `QueueProvider`-less; spec requires a breaking signature change R-UI-2 paused on
- **Category:** dead (partially-migrated code)
- **Severity:** Medium
- **File:line:** `src/core/orchestrator/event-orchestrator.ts:57-62` + `:345-391`
- **Evidence:** R-UI-2 design spec (§"Modified (EDIT ONLY)" → event-orchestrator.ts) states: "REPLACE existing `recoverOnStartup()` (not extend), replace in-process `executeStageRun` call with BullMQ enqueue, accept `QueueProvider` as a constructor dependency." The shipped file still has:
  ```
  export function createEventOrchestrator(
    db: Database,
    executor: StageExecutor,
    realtime: RealtimeProvider,
    config: Partial<EventOrchestratorConfig> = {},
  ): EventOrchestrator {
  ```
  and a `launchStage`/`recoverOnStartup` that call `executeStageRun` directly (`:181-188`, `:375`). The R-UI-2 `QueueProvider` port change shipped (commit 55df983), but the consumer was not updated — the orchestrator now diverges from both the spec and from the worker-shaped `QueueWorker` port.
- **Direction:** Confirm whether this divergence is an intentional pause (handoff commit da987b3 suggests yes) and if so fence the out-of-date orchestrator behind a clearly-dead marker; otherwise complete the constructor + `recoverOnStartup` change before R-UI-2 merges so the queue port doesn't sit unused in core.

### AUDIT-CQ-11: `driverDescriptor` maps an `integer` DB column to `fieldType: 'text'`, breaking the Save round-trip
- **Category:** unused / over-eng
- **Severity:** Medium
- **File:line:** `src/app/[org]/[user]/[project]/settings/drivers/descriptor.ts:69-73` vs `src/core/db/schema.ts:184` vs `src/server/routers/driver.ts:77`
- **Evidence:**
  - Descriptor: `{ key: 'promptSendDelayMs', label: 'Prompt send delay (ms)', fieldType: 'text' }`
  - Schema: `promptSendDelayMs: integer('prompt_send_delay_ms').notNull().default(0)`
  - Router: `promptSendDelayMs: z.number().int().optional()`
  - `RecordField.tsx:143-151` text branch emits `String(e.target.value)` → edited value becomes a string; Zod `z.number().int()` rejects strings → Save fails.
- **Direction:** Either add a numeric `fieldType` to `RecordField` or coerce inside the descriptor's save path — today the field is only safely readable, which undermines R-UI-1's "full CRUD" premise.

### AUDIT-CQ-12: Stage-runner's default contextLayout silently hardcodes `CLAUDE.md` / `context.md`
- **Category:** magic-value / vendor-leak
- **Severity:** Low
- **File:line:** `src/core/orchestrator/stage-runner.ts:180-183`
- **Evidence:**
  ```
  const contextLayout = (driverRow.contextLayout as { instructionsFile: string; contextFile: string }) ?? {
    instructionsFile: 'CLAUDE.md',
    contextFile: 'context.md',
  };
  ```
  `CLAUDE.md` is Anthropic/Claude-specific nomenclature; R-UI-1 added `contextLayout` as a jsonb column precisely to remove this coupling (see design spec §Descriptors). The fallback invites a driver row with a missing `contextLayout` to silently masquerade as Claude.
- **Direction:** Fail fast if `contextLayout` is absent (per invariant 9) rather than auto-coercing to a vendor-specific filename.

### AUDIT-CQ-13: Pipeline settings page hardcodes gate-mode strings the invariant tree calls out as configurable
- **Category:** magic-value
- **Severity:** Low
- **File:line:** `src/app/[org]/[user]/[project]/settings/page.tsx:166-167`, `:215`, `:234-237`, `:278`
- **Evidence:**
  ```
  const [newGateMode, setNewGateMode] = useState<string>('auto');
  ...
  gateRules: newGateMode === 'rules' ? newGateRules : undefined,
  ...
  <option value="auto">auto</option>
  <option value="rules">rules</option>
  <option value="hold">hold</option>
  ```
  `src/core/constants.ts` already exports `GATE_MODE` (referenced by orchestrator code at `event-orchestrator.ts:40`). The R-UI-1 rename pass edited this file; the hardcoded mode list survived.
- **Direction:** Pull the gate-mode options from the shared `GATE_MODE` constant (or a DB catalog) so "hold" vs "manual" vs new modes can't drift between UI and engine.

### AUDIT-CQ-14: `orchestrator/demo.ts` imports the legacy `SupabaseDatabaseProvider` directly — bypasses the adapter registry
- **Category:** vendor-leak (within `src/core/`)
- **Severity:** Medium
- **File:line:** `src/core/orchestrator/demo.ts:13`
- **Evidence:**
  ```
  import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
  ```
  File sits under `src/core/orchestrator/` (invariant 7 territory). While the file is self-described as a dev-CLI demo, the import from `@/adapters/supabase/*` inside a `src/core/` path contradicts the "Zero vendor imports in `src/core/`" rule the rebuild spec re-asserts, and it's the pattern R-UI-2 just created a dedicated `server-client.ts` to avoid.
- **Direction:** Either move `demo.ts` out of `src/core/` (it's an entrypoint script, not domain logic) or route it through the same registry path everything else uses.

### AUDIT-CQ-15: `src/core/db/schema.ts` is 1076 lines — 2× the hard 500-line limit
- **Category:** over-eng
- **Severity:** Low
- **File:line:** `src/core/db/schema.ts:1-1076`
- **Evidence:** `wc -l src/core/db/schema.ts` → 1076. Invariant 10 / CLAUDE.md (code standards) state "Max ~500 lines per file. Split into multiple files when approaching this limit." R-UI-1 added new columns to this file during the rename; the file was already oversize before, but the touch keeps it oversize.
- **Direction:** Split the schema into per-domain files (issues, routing, pipeline, org/project, skills/drivers) with a single re-export barrel — the rebuild spec's "What We Keep" section treats schema as salvageable infrastructure, not as license to keep a mega-file.

### AUDIT-CQ-16: `src/adapters/supabase/realtime.ts` silences a type error with `@ts-expect-error` and then hand-writes Supabase's payload shape
- **Category:** over-eng
- **Severity:** Low
- **File:line:** `src/adapters/supabase/realtime.ts:36-54`
- **Evidence:**
  ```
  .on(
    // @ts-expect-error supabase-js postgres_changes overloads are imprecise here.
    'postgres_changes',
    config,
    (payload: {
      eventType: 'INSERT' | 'UPDATE' | 'DELETE';
      new: T;
      old: T | null;
    }) => {
  ```
  The hand-written payload type duplicates what `@supabase/supabase-js` already ships (`RealtimePostgresChangesPayload`). Worse, `@ts-expect-error` without a pinned SDK version is a ticking brittleness — an SDK upgrade that actually does type the overload correctly makes this a compile error.
- **Direction:** Either import the SDK's own payload type and drop the expect-error suppression, or narrow the suppression to a specific SDK version with a tracking comment — either way the adapter layer is the exact place where "invariant 7 gives us the vocabulary" should mean "use the vendor types here."

## Phase 2 candidates (out-of-scope observations)

- `src/app/[org]/[user]/[project]/pipelines/[id]/page.tsx:31-35` and `RunDetailModal.tsx:71-76` both hand-roll the same "poll every 2s while running/queued" `refetchInterval` closure — duplicate pattern outside the R-UI-2 explicit in-scope surface but adjacent to it.
- `src/server/routers/pipeline.ts:139-174` does N+1 queries per `runs.get` (one stage-def + one events query per stage run inside `Promise.all`). Out-of-scope for R-UI-1/R-UI-2 but a cost the new Realtime append path will multiply.
- `src/app/[org]/[user]/[project]/settings/page.tsx:158-170` duplicates the "fetch all skills + drivers" pattern that the new `RecordEditor` pages already make per-page; a shared hook would help once more settings adopt the primitive.
- `src/core/services/crud-factory.ts` has a non-versioned `update`/`remove` used by `pipeline`, `persona`, `provider`, `brand`, `project`, `organization`, `user`, `routing` services — any of those is currently vulnerable to the same optimistic-lock gap R-UI-1 closed for skills and (inline) drivers.
- `src/components/pipeline/LiveOutput.tsx:6-7` and `RunDetailModal.tsx:5-7` both carry `biome-ignore lint/style/useImportType` with identical rationale — candidate for a shared helper or a biome config change rather than per-file ignores.

## Blocked

None.
