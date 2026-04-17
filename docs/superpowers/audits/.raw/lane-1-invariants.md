# Lane 1 — Invariants Auditor — Raw Output

## Required-reading proof
- docs/invariants.md: "**Zero vendor imports in src/core/.** No Supabase, no Drizzle (except `import type` and schema definitions), no BullMQ, no provider SDKs."
- docs/superpowers/specs/2026-04-07-fluxaos-spec-v2.md: "**Containment rule (NON-NEGOTIABLE):** No Supabase client imports outside of `adapters/supabase/`. All database queries go through Drizzle ORM against raw Postgres."
- docs/superpowers/specs/2026-04-09-rebuild-spec.md: "**Zero vendor imports in `core/`.** The adapter registry is the only way to resolve implementations. Services receive dependencies via injection."
- CLAUDE.md: "**Orchestrator vs Workers** — systemd daemon manages pipeline state; AI workers are read-only executors that report via comments"
- docs/session-quick-start.md: "Optimistic concurrency required on all mutable entities (`WHERE version = $expected`)"

## Mechanical-check output

**Check 1 — Hardcoded stage names:** *(empty — no matches)*

**Check 2 — Hardcoded provider/driver names:** *(empty — no matches)*

**Check 3 — Hardcoded issue-type enums:**
```
src/core/services/issue-catalog.ts:24:type IssueTypeInsert = typeof issueType.$inferInsert;
src/core/services/issue-catalog.ts:25:type IssueTypeSelect = typeof issueType.$inferSelect;
src/core/services/issue-catalog.ts:27:type IssueStateInsert = typeof issueState.$inferInsert;
src/core/services/issue-catalog.ts:28:type IssueStateSelect = typeof issueState.$inferSelect;
src/core/services/issue-catalog.ts:33:type IssuePriorityInsert = typeof issuePriority.$inferInsert;
src/core/services/issue-catalog.ts:34:type IssuePrioritySelect = typeof issuePriority.$inferSelect;
src/core/services/issue.ts:25:type IssueStateSelect = typeof issueState.$inferSelect;
```
(These are Drizzle `$inferSelect` type aliases for catalog tables, not enums of literals — not invariant-4 violations.)

**Check 4 — Vendor imports in core:** *(empty — no matches)*

**Check 5 — File size (>500 lines):**
```
src/app/[org]/[user]/[project]/issues/[number]/client.tsx: 880 lines
src/__tests__/integration/services.test.ts: 564 lines
src/__tests__/integration/orchestrator.test.ts: 558 lines
src/__tests__/integration/gates.test.ts: 702 lines
src/core/db/schema.ts: 1076 lines
src/core/db/seed.ts: 587 lines
src/core/services/issue.ts: 685 lines
```

**Check 6 — Unit tests (no Supabase/DATABASE_URL/integration keyword):**
```
src/__tests__/integration/signal-parser.test.ts
src/__tests__/integration/features-primitive.test.ts
```

## Findings

### AUDIT-INV-1: `driver.delete` tRPC mutation has no optimistic-concurrency check
- **Invariant:** #12 ("Optimistic concurrency on all mutable entities. Issues, comments, and any entity that can be edited concurrently must use version fields. Update queries include `WHERE version = $expected`. Zero rows affected means conflict — return 409, not silent overwrite.")
- **Severity:** High
- **File:line:** /mnt/dev/fluxaos/src/server/routers/driver.ts:99-108
- **Evidence:**
  ```
  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .delete(driver)
        .where(eq(driver.id, input.id))
        .returning();
      if (!row) throw new Error(`Driver not found: ${input.id}`);
      return row;
    }),
  ```
  The `driver` table exposes `version: integer('version').notNull().default(1)` (schema.ts:193) and `driver.update` does use `and(eq(driver.id, id), eq(driver.version, version))` — but `driver.delete` ignores it entirely. Contrast with `skill.delete` (skill router, lines 78-109) which was correctly written with `deleteWithVersion`.
- **Direction:** Mirror the `skill.delete` version-locked pattern on `driver.delete`.

### AUDIT-INV-2: Two integration-folder files are unit tests (no DB, no Supabase)
- **Invariant:** #15 ("No unit tests. Ever. Zero unit tests in fluxaOS. Do not write them. Do not suggest them. Do not sneak them in alongside other work. This is non-negotiable.")
- **Severity:** High
- **File:line:**
  - /mnt/dev/fluxaos/src/__tests__/integration/features-primitive.test.ts (all 29 lines; added in R-UI-1)
  - /mnt/dev/fluxaos/src/__tests__/integration/signal-parser.test.ts (pre-existing, but in the R-UI-1 surface via test-file modifications)
- **Evidence:** `features-primitive.test.ts` asserts `expect(hasFeature(userId, feature)).toBe(true);` with no database, no Supabase client, no `integration` marker, no real external resource. Its "test" is a pure-logic assertion on a function that currently `return true;`.

  `signal-parser.test.ts` line 1: `import { describe, it, expect } from 'vitest'; import { parseSignalLine, type SkillSignal } from '@/core/orchestrator/signal-parser';` — exercises only a pure parser with JSON string fixtures.

  The R-UI-1 spec itself (line 459) acknowledges this: "features-primitive.test.ts — smoke test: `hasFeature()` returns `true` today. Test is a pure-logic test; lives in `integration/` alongside other tests for consistency but touches no DB." That is explicit unit-test admission.
- **Direction:** Either delete the tests or convert them to genuine integration assertions; invariant 15 leaves no room for "pure-logic test lives in integration/ for consistency."

### AUDIT-INV-3: File-size invariant violated in R-UI-2 surface (issue detail client)
- **Invariant:** #10 ("Max ~500 lines per file. Split into multiple files when approaching this limit.")
- **Severity:** High
- **File:line:** /mnt/dev/fluxaos/src/app/[org]/[user]/[project]/issues/[number]/client.tsx: 880 lines
- **Evidence:** `wc -l` reports 880 lines. The R-UI-2 handoff (2026-04-17-r-ui-2-implementation-session-a-paused.md lines 221-222) confirms this is a live blocker: "Pre-commit failed because the issue detail client is 1019 lines and the hook rejects files over 500 lines." Task 12 of R-UI-2 is explicitly scoped to edit this file; the plan did not account for the 500-line gate on a file already 380 lines over budget.
- **Direction:** Extraction must happen before Task 12 can proceed — a narrow activity-feed split is one option flagged in the handoff.

### AUDIT-INV-4: File-size invariant violated on multiple in-scope files (R-UI-1 surface)
- **Invariant:** #10 ("Max ~500 lines per file. Split into multiple files when approaching this limit.")
- **Severity:** Medium
- **File:line:**
  - /mnt/dev/fluxaos/src/core/db/schema.ts: 1076 lines
  - /mnt/dev/fluxaos/src/core/services/issue.ts: 685 lines
  - /mnt/dev/fluxaos/src/core/db/seed.ts: 587 lines
  - /mnt/dev/fluxaos/src/__tests__/integration/gates.test.ts: 702 lines
  - /mnt/dev/fluxaos/src/__tests__/integration/services.test.ts: 564 lines
  - /mnt/dev/fluxaos/src/__tests__/integration/orchestrator.test.ts: 558 lines
- **Evidence:** Every file listed is in the R-UI-1 file list (`.raw/r-ui-1-files.txt`) and exceeds ~500 lines. The R-UI-1 commit body explicitly notes a local pre-commit hook "also exempts orchestrator.test.ts and seed.ts from the 500-line size check (both DEF-008 candidates if we later identify a clean split)." — an exemption, not a resolution.
- **Direction:** Schema and seed can be split by subject-area tables/sections; tests can be split per concern.

### AUDIT-INV-5: R-UI-2 spec+plan require replacing `recoverOnStartup` / wiring BullMQ dispatch / adding `queue` param / completion subscription — none of this has landed on `feat/r-ui-2-impl`
- **Invariant:** #22 ("Architecture deviations are flagged, not decided. If an implementation choice differs from the spec or these invariants, stop and flag it to the user.")
- **Severity:** Medium
- **File:line:** /mnt/dev/fluxaos/src/core/orchestrator/event-orchestrator.ts:57-63 and 345-391
- **Evidence:**
  ```
  export function createEventOrchestrator(
    db: Database,
    executor: StageExecutor,
    realtime: RealtimeProvider,
    config: Partial<EventOrchestratorConfig> = {},
  ): EventOrchestrator {
  ```
  The R-UI-2 spec (lines 253-269) requires `createEventOrchestrator(db, executor, realtime, queue)` — a `queue: QueueProvider` parameter that is still missing. `recoverOnStartup()` still contains the "synchronous-execution-era" branch (`launchStage(run, stage)`) that spec lines 276-293 mark as "wrong" under the BullMQ-mediated architecture and requires complete replacement. The session handoff explicitly flags this as paused work (Tasks 14-22 not done). That is legitimate — but the `feat/r-ui-2-impl` branch's current `event-orchestrator.ts` is still the pre-R-UI-2 shape, which means the code on the branch does not yet match the design it was merged to implement. No deviation comment was added at the call sites identifying the gap.
- **Direction:** The paused state is acknowledged in the handoff — but the divergence between the running code and the R-UI-2 spec should be called out in-code (TODO/FIXME) or blocked by CI until Task 17-18 land, per invariant 22.

### AUDIT-INV-6: `RunDetailModal` polls `pipeline.runs.get` at 2 s while status is running/queued despite R-UI-2 routing Realtime through the adapter
- **Invariant:** #9 ("Everything is config-driven. No fallback defaults. No silent degradation.") and Principle 7 of R-UI-2 spec ("Supabase Realtime is the streaming mechanism. No fallbacks.")
- **Severity:** Medium
- **File:line:** /mnt/dev/fluxaos/src/components/pipeline/RunDetailModal.tsx:71-73
- **Evidence:**
  ```
  refetchInterval: (query) => {
    const status = query.state.data?.status;
    return status === 'running' || status === 'queued' ? 2000 : false;
  },
  ```
  R-UI-2 modifies this same file (Task 11) to route `stage_run` UPDATE through Realtime and adds a duration tick — but leaves the 2-second pipeline-run poll in place. The handoff Risk #5 ("RunDetailModal still has a run query refetch interval: Task 11 did not remove it. Do not assume that is a bug without checking the plan/spec.") explicitly defers the decision. The same pattern lives at /mnt/dev/fluxaos/src/app/[org]/[user]/[project]/pipelines/[id]/page.tsx:31-34.
- **Direction:** Either add a `pipeline_run` UPDATE Realtime subscription and drop the poll, or mark the polling in-code as a consciously-chosen belt-and-suspenders with a comment citing the decision.

### AUDIT-INV-7: `stage-worker.ts` job handler duplicates a minimal `buildCommand` and cost estimation in-file, diverging from the shared `buildCommand` / `stage-runner` pipeline
- **Invariant:** #11 ("DRY strictly enforced. Use the CRUD factory pattern. No copy-paste between services, routers, or adapters. If you find yourself duplicating logic, extract it.")
- **Severity:** Medium
- **File:line:** /mnt/dev/fluxaos/src/core/orchestrator/stage-worker.ts:121-171
- **Evidence:**
  ```
  // ─── Command Builder ───────────────────────────────────────────────────────

  /**
   * Build the execution command from routing config.
   * The driver name determines the command structure.
   * This is the ONLY place where driver names are interpreted.
   */
  function buildCommand(
    routing: StageJobPayload['routing'],
    prompt: string,
  ): { command: string; args: string[]; env: Record<string, string> } {
  ```
  The comment "THE ONLY place where driver names are interpreted" conflicts with the real `buildCommand` at /mnt/dev/fluxaos/src/core/orchestrator/command-builder.ts:72 which is the driver-config-driven builder used by `stage-runner.ts`. `stage-worker.ts` additionally hardcodes `--prompt`/`--model` CLI flags (line 151), violating invariant 2-3 in spirit (driver-flag names aren't read from the driver catalog row). This file is in the R-UI-1 surface through the rename sweep and the R-UI-2 plan (Task 16) calls out this exact problem ("Replace the duplicated `buildCommand` + inline execution with `executeStageRun` call") — but the rewrite has not landed.
- **Direction:** Delete the local `buildCommand` and `estimateCost` functions; route through `executeStageRun`, which already reads both flags and env from the driver row.

### AUDIT-INV-8: Rename sweep in R-UI-1 did not carry schema-level version columns onto `pipeline_stage` / `pipeline_run` / `stage_run`; admin UI flow `pipeline.update`/`stages.update`/`runs.cancel` mutates these rows without optimistic locking
- **Invariant:** #12 ("Optimistic concurrency on all mutable entities. … any entity that can be edited concurrently must use version fields.")
- **Severity:** Medium
- **File:line:** /mnt/dev/fluxaos/src/core/db/schema.ts:77-152 (table definitions) and /mnt/dev/fluxaos/src/server/routers/pipeline.ts:39-106, 213-280 (mutations)
- **Evidence:** Schema excerpt:
  ```
  export const pipeline = pgTable('pipeline', {
    id,
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    name: text('name').notNull(),
    description: text('description'),
    isDefault: boolean('is_default').default(false),
    createdAt,
    updatedAt,
  });
  ```
  No `version` column. Same for `pipelineStage`, `pipelineRun`, `stageRun` (lines 89-152). Router:
  ```
  update: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      isDefault: z.boolean().optional(),
    }))
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return createPipelineService(ctx.db).update(id, data);
    }),
  ```
  No `version` param, no `WHERE version = $expected`. Same pattern on `pipeline.stages.update/delete`, `pipeline.runs.cancel`, `pipeline.runs.cancelStage`. These entities are clearly user-mutable.
- **Direction:** Add version columns + version-checked update/delete per the `skill`/`driver` pattern — or document an explicit exemption invoking invariant 22 for why pipeline entities are exempted.

### AUDIT-INV-9: `driver.create`/`driver.update` use `as any` casts that bypass the Zod schema's type guarantees
- **Invariant:** #9 ("Everything is config-driven. … If a required configuration is missing, the system fails fast with a clear error message naming what's missing.")
- **Severity:** Low
- **File:line:** /mnt/dev/fluxaos/src/server/routers/driver.ts:58 and 92
- **Evidence:**
  ```
  .mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db.insert(driver).values(input as any).returning();
    return row;
  }),
  ...
  .set({ ...(data as any), version: version + 1, updatedAt: new Date() })
  ```
  The `any` casts silently allow jsonb fields whose runtime structure may not match the seed-time schema (contextLayout, envVars, extraArgs, defaultArgs) to pass through without failing fast on malformed JSON. The R-UI-1 spec (lines 417-428) flagged these fields as readonly in the UI "because a plain textarea is a footgun" — but the API surface still accepts them with no validation.
- **Direction:** Replace the `as any` with concrete Zod shapes (or at minimum jsonb-shape validators) so bad config fails at the router boundary, not inside the orchestrator.

## Phase 2 candidates (out-of-scope observations)
- `src/lib/supabase/client.ts`, `server.ts`, `middleware.ts` — referenced by the R-UI-2 adapter boundary but outside the file list; their vendor-containment posture is worth reviewing.
- `src/adapters/supabase/database.ts` and `auth.ts` — not touched by R-UI-1 or R-UI-2, but they define the adapter-layer boundary invariant 7 depends on.
- `src/core/services/issue-catalog.ts`, `src/core/services/crud-factory.ts` — DRY-source for CRUD mutations; candidates for a future audit of router-vs-service concurrency posture.
- `src/core/gates/*` — referenced but not in either file list; verdict/rule shape is load-bearing for R-UI-2 Task 13 fix.
- `src/app/[org]/[user]/[project]/pipelines/[id]/page.tsx:31-34` — same 2-second polling pattern as RunDetailModal; file is in R-UI-1 surface but the polling question applies.
