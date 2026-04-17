# Phase 2 — Lane 1 Invariants — Area: src/__tests__/

## Required-reading proof

- **invariants.md:** "No unit tests. Ever. Zero unit tests in fluxaOS. Do not write them. Do not suggest them. Do not sneak them in alongside other work."
- **2026-04-07-fluxaos-spec-v2.md:** "fluxaOS is a general-purpose AI orchestration operating system."
- **2026-04-09-rebuild-spec.md:** "Labeled unit tests as 'E2E' (zero database, zero browser, zero HTTP)"
- **CLAUDE.md:** "No unit tests — integration tests against real Supabase only; journey test is the real test"
- **session-quick-start.md:** "Requires `.env` with: `DATABASE_URL` (Supabase transaction pooler, port 6543), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`"

## Mechanical-check output

Real-DB touchpoints:
```
src/__tests__/integration/services.test.ts: 4 (uses DATABASE_URL + SupabaseDatabaseProvider + drizzle)
src/__tests__/integration/signal-parser.test.ts: 0 (Phase 1 covered)
src/__tests__/integration/supabase-connection.test.ts: 5
```

Mocks: **none found.**

Skipped tests:
```
src/__tests__/integration/orchestrator.test.ts:320 describe.skip('orchestrator manager — tick cycle', …)
```
(Orchestrator file outside this area; noted as overflow.)

File sizes:
```
services.test.ts: 564 lines
signal-parser.test.ts: 182 (Phase 1)
supabase-connection.test.ts: 45
```

## Findings

### AUDIT-P2-INV-TESTS-1: services.test.ts exceeds 500-line cap
- **Invariant:** #10
- **Severity:** Low
- **File:line:** `src/__tests__/integration/services.test.ts:1-564`
- **Evidence:** 564 lines across four major describe blocks.
- **Direction:** Split per service group.

### AUDIT-P2-INV-TESTS-2: Cross-describe hidden state couples test groups into a fragile journey
- **Invariant:** #17
- **Severity:** Medium
- **File:line:** `src/__tests__/integration/services.test.ts:68-85, 317-481`
- **Evidence:** Module-scoped `let orgId`, etc. set in one describe, read from another. `getIssueId()` reaches into cleanup array with "issue tests must run first" thrown if not found. Implicit journey test masquerading as independent describes.
- **Direction:** Collapse into a single explicit journey describe or have each describe own its fixtures.

### AUDIT-P2-INV-TESTS-3: services.test.ts swallows cleanup errors
- **Invariant:** #16 (corollary)
- **Severity:** Low
- **File:line:** `src/__tests__/integration/services.test.ts:59-66`
- **Evidence:** `await db.delete(t).where(eq(t.id, id)).catch(() => {});` silently swallows cleanup failures.
- **Direction:** Surface errors; do not silently ignore delete failures.

### AUDIT-P2-INV-TESTS-4: supabase-connection.test.ts is a minimal connectivity probe, not a journey
- **Invariant:** #17
- **Severity:** Low
- **File:line:** `src/__tests__/integration/supabase-connection.test.ts:17-45`
- **Evidence:** Single round-trip insert/select against `organization`; glue-code smoke test, not user-visible journey.
- **Direction:** Mark as adapter smoke test or fold into journey harness.

## Phase 2 overflow candidates

- `src/__tests__/integration/orchestrator.test.ts:320` — `describe.skip(...)` — direct invariant-15/17 deferral evidence; outside this area list.

## Blocked

None.
