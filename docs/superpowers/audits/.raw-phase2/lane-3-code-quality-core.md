# Phase 2 — Lane 3 Code Quality — Area: src/core/

## Required-reading proof

- **invariants.md** (line 67): "DRY strictly enforced. Use the CRUD factory pattern. No copy-paste between services, routers, or adapters. If you find yourself duplicating logic, extract it."
- **spec v2** (§Adapter Architecture): "Core business logic lives in `core/` and imports ONLY from `core/ports/` — TypeScript interfaces that define contracts."
- **rebuild-spec.md** (line 53): "DRY strictly enforced. No exceptions without prior discussion. No copy-paste between adapters, routers, or services."
- **CLAUDE.md:** "Agnostic engine — no stage/provider/driver/enum literals in app code (seed data and adapters only)"
- **session-quick-start.md:** "Optimistic concurrency required on all mutable entities (`WHERE version = $expected`)"

## Mechanical-check output

**Exports in area:** 151

**Vendor-term leakage inside core:**
```
src/core/gates/demo.ts:11,23 (SupabaseDatabaseProvider import + new)
src/core/orchestrator/types.ts:44 ("enqueued to BullMQ" comment)
src/core/orchestrator/stage-worker.ts:2,35 ("BullMQ worker" comments)
src/core/db/scripts/connection.ts:10,18 (SupabaseDatabaseProvider import + new)
```

**Magic status literals in core (excluding constants.ts):**
```
src/core/gates/demo.ts:161,170 ('running', 'queued')
src/core/orchestrator/stage-worker.ts:47,82,94,105,113 ('running', 'completed', 'failed', 'timed_out', 'launched', 'error')
src/core/pipeline/types.ts:3-14 (full PipelineRunStatus/StageRunStatus union redefinition)
```

**`any`/`unknown`/ts-* casts:**
```
src/core/gates/demo.ts:63 ('logic' in (s.gateRules as any))
src/core/orchestrator/signal-parser.ts:97 (msg.content as unknown[])
src/core/services/issue-comment.ts:126 (rows as unknown as Array<{ nextNumber: number }>)
src/core/services/crud-factory.ts:37,44 (data as any insert/update values)
src/core/services/issue-catalog.ts:93,101,110,157,165,174,188,192,196,200,204 (11 occurrences)
src/core/services/issue.ts:277 (rows as unknown)
```

## Findings

### AUDIT-P2-CQ-CORE-1: `GateMode`/`GateVerdict` duplicated across constants.ts + gates/types.ts
- **Category:** DRY
- **Severity:** High
- **File:line:** `src/core/gates/types.ts:79,84`; `src/core/constants.ts:100,89`
- **Evidence:** Two independent declarations of the same union; consumers split across files.
- **Direction:** Delete string unions in gates/types.ts, re-export from constants.

### AUDIT-P2-CQ-CORE-2: `core/pipeline/types.ts` is dead + redefines status enums
- **Category:** dead / DRY / magic-value
- **Severity:** High
- **File:line:** `src/core/pipeline/types.ts:1-73`
- **Evidence:** No imports anywhere in src/. Declares `PIPELINE_RUN_TRANSITIONS`, `STAGE_RUN_TRANSITIONS`, input/metadata types + redundant status unions.
- **Direction:** Delete file and empty `src/core/pipeline/` dir.

### AUDIT-P2-CQ-CORE-3: `core/brands/types.ts`, `personas/types.ts`, `skills/types.ts` are dead
- **Category:** dead
- **Severity:** Medium
- **File:line:** three files totaling ~100 lines
- **Evidence:** None of the exported `Create*Input`/`Update*Input`/`*Filter` types are consumed outside their declaring files.
- **Direction:** Delete or wire to a real consumer.

### AUDIT-P2-CQ-CORE-4: `stage-worker.ts` uses raw status/event literals while siblings use constants
- **Category:** magic-value / DRY
- **Severity:** High
- **File:line:** `src/core/orchestrator/stage-worker.ts:47,82,94,105,113`
- **Evidence:** Hardcoded `'running'|'completed'|'failed'|'timed_out'|'launched'|'error'`; no import from `@/core/constants`; neighbors (event-orchestrator.ts, pipeline-run-service.ts, stage-runner.ts) all use constants.
- **Direction:** Import `STAGE_RUN_STATUS` / `EVENT_TYPE` and replace literals.

### AUDIT-P2-CQ-CORE-5: `gates/demo.ts` imports SupabaseDatabaseProvider + uses magic status literals
- **Category:** vendor-leak / magic-value
- **Severity:** High
- **File:line:** `src/core/gates/demo.ts:11,23,161,170`
- **Evidence:** Core-path file imports from `@/adapters/supabase/database`; hardcodes `'running'`/`'queued'` in pipeline/stage inserts.
- **Direction:** Route via adapter registry; replace literals with constants.

### AUDIT-P2-CQ-CORE-6: `db/scripts/connection.ts` instantiates vendor adapter inside core
- **Category:** vendor-leak
- **Severity:** High
- **File:line:** `src/core/db/scripts/connection.ts:10,18`
- **Evidence:** `new SupabaseDatabaseProvider(url)` inside `src/core/`; propagates to every other script consuming this module.
- **Direction:** Move CLI-script helper out of `src/core/`.

### AUDIT-P2-CQ-CORE-7: `core/services/issue.ts` exceeds 500-line cap
- **Category:** over-eng
- **Severity:** High
- **File:line:** `src/core/services/issue.ts:1-685`
- **Evidence:** 685 lines — multiple concerns in one file.
- **Direction:** Split into issue-crud/issue-state/issue-markdown sub-modules.

### AUDIT-P2-CQ-CORE-8: `renderMarkdown` duplicated verbatim
- **Category:** DRY
- **Severity:** Medium
- **File:line:** `src/core/services/issue.ts:60-73`; `src/core/services/issue-comment.ts:41-54`
- **Evidence:** Identical 14-line function + comment in both files.
- **Direction:** Extract to shared helper.

### AUDIT-P2-CQ-CORE-9: `recordEvent` duplicated across four issue-domain services
- **Category:** DRY
- **Severity:** Medium
- **File:line:** `issue.ts:142-154`, `issue-comment.ts:61-73`, `issue-attachment.ts:30-42`, `issue-dependency.ts:29-41`
- **Evidence:** Four identical bodies; `issue-event.ts` already has `create(...)`.
- **Direction:** Consume `issue-event.ts` or extract shared helper.

### AUDIT-P2-CQ-CORE-10: `crud-factory.ts` uses `as any` on every insert/update
- **Category:** any-cast
- **Severity:** Medium
- **File:line:** `src/core/services/crud-factory.ts:37,44`
- **Evidence:** `values(data as any)`, `.set({ ...data, ... } as any)`.
- **Direction:** Tighten factory generic so `TInsert` constrains without `any`.

### AUDIT-P2-CQ-CORE-11: `issue-catalog.ts` re-implements createCrudService twice
- **Category:** DRY / over-eng
- **Severity:** Medium
- **File:line:** `src/core/services/issue-catalog.ts:56-180`
- **Evidence:** `createCatalogCrud` (56-116) and `createPriorityCrud` (120-180) are 90%+ identical; neither uses crud-factory.ts.
- **Direction:** Fold both into one factory parameterised by the ordering column.

### AUDIT-P2-CQ-CORE-12: Unused port abstractions (AI/Issue/Git/Notification/Storage)
- **Category:** dead / over-eng
- **Severity:** Medium
- **File:line:** `src/core/ports/ai.ts`, `issue.ts`, `git.ts`, `notification.ts`, `storage.ts`
- **Evidence:** Zero `implements` and zero `registry.get<...>('ai'|'issue'|'git'|'notification'|'storage')` calls anywhere.
- **Direction:** Remove until an adapter implementation + registry consumer exists.

### AUDIT-P2-CQ-CORE-13: `createBrandService` has no consumers
- **Category:** dead
- **Severity:** Medium
- **File:line:** `src/core/services/brand.ts:1-22`; `services/index.ts:15`
- **Evidence:** Only referenced from the barrel re-export; no brandRouter, no UI.
- **Direction:** Wire or delete.

### AUDIT-P2-CQ-CORE-14: `OUTPUT_FORMAT` constant + type has zero consumers
- **Category:** dead
- **Severity:** Low
- **File:line:** `src/core/constants.ts:118-123`
- **Evidence:** Only the definition exists.
- **Direction:** Delete.

### AUDIT-P2-CQ-CORE-15: `isRule` type guard has no consumer
- **Category:** dead
- **Severity:** Low
- **File:line:** `src/core/gates/types.ts:120-122`; barrel export.
- **Evidence:** `isRuleGroup` is used, `isRule` is not.
- **Direction:** Delete.

### AUDIT-P2-CQ-CORE-16: Gate engine's `FailureAction='proceed'` is semantically dead
- **Category:** dead / indirection
- **Severity:** Low
- **File:line:** `src/core/gates/engine.ts:312-328`
- **Evidence:** `resolveWorstAction` is only called on failed rules; failing rule → `'proceed'` is indistinguishable from `severity: 'warn'`.
- **Direction:** Remove `'proceed'` from FailureAction or document the semantics.

### AUDIT-P2-CQ-CORE-17: `testEvaluate` is a pure pass-through
- **Category:** indirection
- **Severity:** Low
- **File:line:** `src/core/gates/service.ts:36-40,83-89`
- **Evidence:** `testEvaluate(mode, rules, context) { return evaluateGate(mode, rules, context); }`. Only caller could `import evaluateGate` directly.
- **Direction:** Delete `testEvaluate` from GateService interface.

### AUDIT-P2-CQ-CORE-18: `services/issue-event.ts` hardcodes event-type strings instead of using ISSUE_EVENT_TYPE
- **Category:** magic-value
- **Severity:** Low
- **File:line:** `src/core/services/issue-event.ts:20-24`
- **Evidence:** FILTER_TYPE_MAP uses bare strings; several literals are keys on `ISSUE_EVENT_TYPE`, others aren't.
- **Direction:** Extend ISSUE_EVENT_TYPE and replace with constant references.

### AUDIT-P2-CQ-CORE-19: `estimateCost` returns hardcoded 0
- **Category:** dead / unused
- **Severity:** Low
- **File:line:** `src/core/orchestrator/stage-worker.ts:75-79,162-171`
- **Evidence:** All three params `_`-prefixed, returns 0 → `costUsd` always `'0.000000'`.
- **Direction:** Implement cost tracking or remove the fake scaffolding.

### AUDIT-P2-CQ-CORE-20: `core/ports/database.ts` leaks Drizzle return type through `Database`
- **Category:** vendor-leak
- **Severity:** Medium
- **File:line:** `src/core/ports/database.ts:1-6`; `src/core/db/connection.ts:7-10`
- **Evidence:** `export type Database = ReturnType<typeof drizzle<typeof schema>>;` — the port is effectively "return Drizzle-postgres-js"; no abstraction.
- **Direction:** Accept as explicit deviation, or introduce thin query-surface type. Flag for user decision.

## Phase 2 overflow candidates

- `src/core/orchestrator/stage-runner.ts`, `manual-run.ts`, `output-parser.ts`, `command-builder.ts`, `routing-resolver.ts` — only partially read; dedicated orchestrator lens warranted.
- `src/core/db/schema.ts` + `seed.ts` (Phase 1 coverage) but relevant to invariant-7 chain.
- `src/core/ports/queue.ts` and `realtime.ts` — not in area list; same "real adapter + real consumer" check applies.

## Blocked

None.
