# Phase 2 — Lane 3 Code Quality — Area: src/__tests__/

## Required-reading proof

- **invariants.md:** "No unit tests. Ever."
- **2026-04-07-fluxaos-spec-v2.md:** "Containment rule (NON-NEGOTIABLE): No Supabase client imports outside of `adapters/supabase/`."
- **2026-04-09-rebuild-spec.md:** "True E2E testing. Tests hit real Supabase Postgres, real auth, real browser (Playwright)."
- **CLAUDE.md:** "No unit tests — integration tests against real Supabase only; journey test is the real test."
- **session-quick-start.md:** "Optimistic concurrency required on all mutable entities"

## Mechanical-check output

Duplicate setup/teardown patterns in the 7 other integration files (DB bootstrap, afterAll cleanup arrays).

`as any` casts in `services.test.ts:384, 411, 527, 530, 560` (event-payload assertions) + line 38 `Record<string, any>`.

## Findings

### AUDIT-P2-CQ-TESTS-1: DB bootstrap block duplicated across all integration files
- **Category:** DRY
- **Severity:** Medium
- **File:line:** `supabase-connection.test.ts:11-15`; `services.test.ts:26-30`
- **Evidence:** 4-line identical block (`process.env.DATABASE_URL` + throw + `new SupabaseDatabaseProvider(url)` + `provider.getConnection()`) repeats across both in-scope files plus 5 others.
- **Direction:** Extract to `src/__tests__/helpers/db.ts`.

### AUDIT-P2-CQ-TESTS-2: `(… as any)` escape hatch on every event-payload assertion
- **Category:** any-cast
- **Severity:** Medium
- **File:line:** `services.test.ts:384, 411, 527, 530, 560`
- **Evidence:** Event `payload` is `unknown`/jsonb; every consumer reaches through `as any`.
- **Direction:** Declare typed payload shapes co-located with event emitters.

### AUDIT-P2-CQ-TESTS-3: Cross-describe coupling via shared outer-scope `let` + `cleanup.find(table==='issue')`
- **Category:** over-eng
- **Severity:** Medium
- **File:line:** `services.test.ts:70-85, 477-481`
- **Evidence:** `getIssueId()` scrapes cleanup queue with "issue tests must run first" error; comment admits the abuse.
- **Direction:** Each describe creates its own fixtures via beforeAll, or collapse into explicit journey.

### AUDIT-P2-CQ-TESTS-4: `tableMap` uses `Record<string, any>` — schema table type erased
- **Category:** any-cast
- **Severity:** Low
- **File:line:** `services.test.ts:38`
- **Direction:** Type as `Record<string, PgTable>`.

### AUDIT-P2-CQ-TESTS-5: Unused `type SkillSignal` import
- **Category:** dead
- **Severity:** Low
- **File:line:** `signal-parser.test.ts:2`
- **Direction:** Drop.

### AUDIT-P2-CQ-TESTS-6: Two stream-json test cases assert near-identical paths
- **Category:** DRY
- **Severity:** Low
- **File:line:** `signal-parser.test.ts:67-107`
- **Evidence:** Second case doesn't actually exercise stdout fallback because `content` field carries the signal.
- **Direction:** Tighten one fixture or merge.

### AUDIT-P2-CQ-TESTS-7: supabase-connection.test.ts is redundant with services.test.ts
- **Category:** dead
- **Severity:** Low
- **File:line:** `supabase-connection.test.ts:17-45`
- **Evidence:** Whole describe re-executed as side effect of services.test.ts first test.
- **Direction:** Fold or delete.

### AUDIT-P2-CQ-TESTS-8: Magic event-type strings in filter helpers
- **Category:** magic-value
- **Severity:** Low
- **File:line:** `services.test.ts:383, 409, 525, 558`
- **Evidence:** `filter((e) => e.type === 'state_changed')` etc.
- **Direction:** Import `IssueEventType` / constants.

### AUDIT-P2-CQ-TESTS-9: Invariant #13 (append-only events) never verified
- **Category:** dead (coverage gap)
- **Severity:** Medium
- **File:line:** `services.test.ts` comment-service describe
- **Evidence:** Suite creates 4+ event types but never attempts update/delete against `issueEvent` to verify the append-only contract.
- **Direction:** Add a test attempting update/delete on event table, asserting the invariant.

## Phase 2 overflow candidates

- DB-bootstrap duplication spans 7 more integration files.
- `orchestrator.test.ts:22` has `createOrchestratorManager` shim with `as unknown[]` — placeholder-stub left in place.

## Blocked

None.
