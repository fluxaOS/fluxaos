# Phase 2 — Lane 1 Invariants — Area: src/core/

## Required-reading proof

- **invariants.md** (line 59): "Zero vendor imports in src/core/. No Supabase, no Drizzle (except `import type` and schema definitions), no BullMQ, no provider SDKs. Core services receive dependencies via injection. The adapter registry is the only resolution path."
- **spec v2** (line 114): "Containment rule (NON-NEGOTIABLE): No Supabase client imports outside of `adapters/supabase/`. All database queries go through Drizzle ORM against raw Postgres."
- **rebuild-spec** (line 56): "Zero vendor imports in `core/`. The adapter registry is the only way to resolve implementations. Services receive dependencies via injection."
- **CLAUDE.md** (line 49): "DI everywhere — services are factories receiving `Database`, zero vendor imports in `src/core/`"
- **session-quick-start.md** (line 42): "Optimistic concurrency required on all mutable entities (`WHERE version = $expected`)"

## Mechanical-check output

```
# Check 1: hardcoded stage names in src/core/
(no matches)

# Check 2: hardcoded provider/driver names in src/core/
(no matches)

# Check 3: hardcoded issue enums
src/core/constants.ts:100:export type GateMode = (typeof GATE_MODE)[keyof typeof GATE_MODE];
src/core/gates/types.ts:79:export type GateMode = 'auto' | 'rules' | 'hold' | 'manual' | 'skip';
src/core/services/issue-catalog.ts:24-34: Drizzle $inferInsert/Select aliases (not violations)
src/core/services/issue.ts:25: same

# Check 4: vendor imports (non-type) in src/core/
(no matches)

# Check 5: vendor adapter imports via @/adapters in src/core/
src/core/gates/demo.ts:11:import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
src/core/orchestrator/demo.ts:13 (Phase 1)
src/core/db/nuke.ts:10 (Phase 1)
src/core/db/scripts/connection.ts:10:import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
src/core/db/seed.ts:12 (Phase 1)

# Check 6: files > 500 lines
src/core/services/issue.ts: 685 lines (IN AREA)
```

## Findings

### AUDIT-P2-INV-CORE-1: `src/core/gates/demo.ts` imports vendor adapter
- **Invariant:** #7
- **Severity:** High
- **File:line:** `src/core/gates/demo.ts:11,23-24`
- **Evidence:** `import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';` + `const provider = new SupabaseDatabaseProvider(url); const db = provider.getConnection();`
- **Direction:** Relocate demo out of `src/core/` or inject `db` from caller.

### AUDIT-P2-INV-CORE-2: `src/core/db/scripts/connection.ts` instantiates vendor adapter inside core
- **Invariant:** #7
- **Severity:** High
- **File:line:** `src/core/db/scripts/connection.ts:10,18-19`
- **Evidence:** Same `SupabaseDatabaseProvider` import + instantiation pattern in a core-path module consumed by every `db/scripts/*.ts`.
- **Direction:** Move CLI-script helpers out of `src/core/`.

### AUDIT-P2-INV-CORE-3: `createGateService.evaluateStageGate` silent default for missing gateMode
- **Invariant:** #9
- **Severity:** High
- **File:line:** `src/core/gates/service.ts:63`
- **Evidence:** `const mode = (stage.gateMode ?? DEFAULT_GATE_MODE) as GateMode;` — null `gateMode` auto-proceeds rather than failing fast.
- **Direction:** Remove `?? DEFAULT_GATE_MODE` fallback; throw naming the missing config.

### AUDIT-P2-INV-CORE-4: `updateStatus` on issue service mutates without optimistic lock
- **Invariant:** #12
- **Severity:** High
- **File:line:** `src/core/services/issue.ts:613-617`
- **Evidence:** `db.update(issue).set({ statusId, updatedAt }).where(eq(issue.id, id))` — no version read, no `WHERE version = $expected`, no version bump; sibling `updateFields`/`transition`/`stateOverride` all enforce it.
- **Direction:** Bring `updateStatus` under the same version-check pattern.

### AUDIT-P2-INV-CORE-5: Soft-delete on issue_comment inserts event outside a transaction
- **Invariant:** #13 (event immutability / atomicity)
- **Severity:** Medium
- **File:line:** `src/core/services/issue-comment.ts:209-231`
- **Evidence:** Event insert + comment update not wrapped in `db.transaction` — failure between steps leaves event claiming deletion of still-live content.
- **Direction:** Wrap in `db.transaction`.

### AUDIT-P2-INV-CORE-6: `GateMode` literal-union type duplicated across constants.ts and gates/types.ts
- **Invariant:** #11
- **Severity:** Medium
- **File:line:** `src/core/constants.ts:100` + `src/core/gates/types.ts:79`
- **Evidence:** Two independent declarations of the same union.
- **Direction:** Collapse to one source in constants.ts; re-export from gates/types.ts.

### AUDIT-P2-INV-CORE-7: `GateVerdict` literal-union type duplicated across constants.ts and gates/types.ts
- **Invariant:** #11
- **Severity:** Medium
- **File:line:** `src/core/constants.ts:89` + `src/core/gates/types.ts:84`
- **Evidence:** Same duplication pattern.
- **Direction:** Collapse to constants.ts.

### AUDIT-P2-INV-CORE-8: `renderMarkdown` duplicated verbatim in issue.ts and issue-comment.ts
- **Invariant:** #11 / #14
- **Severity:** Medium
- **File:line:** `src/core/services/issue.ts:60-73` + `src/core/services/issue-comment.ts:41-54`
- **Evidence:** Identical function body with identical comment.
- **Direction:** Extract shared helper.

### AUDIT-P2-INV-CORE-9: `recordEvent` helper duplicated across four services
- **Invariant:** #11
- **Severity:** Medium
- **File:line:** `issue.ts:142-154`, `issue-comment.ts:61-73`, `issue-attachment.ts:30-42`, `issue-dependency.ts:29-41`
- **Evidence:** Four identical bodies; `issue-event.ts` already exposes `create(...)` doing the same thing.
- **Direction:** Route all four services through `issue-event.ts`.

### AUDIT-P2-INV-CORE-10: `ISSUE_EVENT_TYPE` incomplete; services emit magic strings beyond the constant
- **Invariant:** #4 / #11
- **Severity:** Medium
- **File:line:** `src/core/constants.ts:68-79` vs many services
- **Evidence:** Constant declares 8 types; services emit `comment_added`, `comment_edited`, `comment_deleted`, `fields_updated`, `issue_created`, `attachment_added`, `attachment_removed`, `dependency_added`, `dependency_removed`, `run_queued`.
- **Direction:** Extend the constant or make event types DB-catalog-driven.

### AUDIT-P2-INV-CORE-11: `src/core/services/issue.ts` exceeds 500-line cap
- **Invariant:** #10
- **Severity:** Medium
- **File:line:** `src/core/services/issue.ts:1-685`
- **Evidence:** 685 lines — 37% over cap.
- **Direction:** Split into focused modules.

### AUDIT-P2-INV-CORE-12: `transition` and `stateOverride` share ~identical update bodies
- **Invariant:** #11
- **Severity:** Low
- **File:line:** `src/core/services/issue.ts:437-510` and `:512-567`
- **Evidence:** Both methods load issue, assertVersion, load targetState, update with version check, record state_changed event — differ only in transition validation.
- **Direction:** Extract private `performStateChange` helper.

### AUDIT-P2-INV-CORE-13: Soft-delete blanks `bodyMd` while audit event only carries bodyMd
- **Invariant:** #14
- **Severity:** Low
- **File:line:** `src/core/services/issue-comment.ts:216-224`
- **Evidence:** Event stores `body_md: current.bodyMd` only; replay would require read-time HTML rendering.
- **Direction:** Store both bodyMd and bodyHtml in the event payload.

### AUDIT-P2-INV-CORE-14: `db/scripts/events.ts` reassigns query var instead of composing
- **Invariant:** #11
- **Severity:** Low
- **File:line:** `src/core/db/scripts/events.ts:46-58`
- **Evidence:** Whole builder rebuilt for WHERE clause instead of composing conditions.
- **Direction:** Single `db.select()...where(and(...conds))`.

## Phase 2 overflow candidates

- `src/core/db/seed.ts` (587) and `schema.ts` (1076) over cap (Phase 1 coverage).
- Multiple core files import `SupabaseDatabaseProvider` (same invariant 7 violation as Findings 1-2).
- `src/core/orchestrator/stage-runner.ts` (457 lines), `event-orchestrator.ts` (401 lines), `pipeline-run-service.ts` (318 lines) approaching limits.

## Blocked

None.
