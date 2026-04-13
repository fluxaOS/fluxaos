# Deferred Fixes

Issues found during verification that aren't showstoppers. Fix before merge or track as follow-up issues.

---

## UI: Skill edit/delete missing

**Found:** 2026-04-13 during R5-V browser verification
**Severity:** Medium — users can create skills but not edit or delete them
**Location:** `src/app/[org]/[user]/[project]/settings/skills/page.tsx`
**What's needed:** Add edit (inline or modal) and delete buttons to each skill card. Requires `skill.update` and `skill.delete` tRPC mutations.

## UI: GateResultsPanel untested

**Found:** 2026-04-13 — original verification checklist item #7
**Severity:** Low — gate evaluation logic exists but no gates have fired in browser
**What's needed:** Trigger a run on the `implement` stage (gateMode: rules) and verify the gate panel renders

## UI: Cancel buttons untested

**Found:** 2026-04-13 — original verification checklist item #8
**Severity:** Low — buttons exist in UI but haven't been clicked
**What's needed:** Trigger a long-running stage, click cancel, verify stage_run and pipeline_run are marked cancelled

## Tests: Orchestrator tests skipped

**Found:** 2026-04-13 during architectural cleanup
**Severity:** Medium — `orchestrator.test.ts` describe block skipped because tests were written for the deleted polling manager
**Location:** `src/__tests__/integration/orchestrator.test.ts`
**What's needed:** Rewrite tests for event-orchestrator architecture, or write new manual-run integration tests

## UI: Issue activity feed doesn't auto-refresh via Realtime

**Found:** 2026-04-13 during R5-V browser verification
**Severity:** Medium — issue events (stage_started, pipeline_completed) only appear after page refresh
**Location:** Issue detail client component
**What's needed:** Subscribe to `issue_event` table changes via Supabase Realtime, or add polling refetch

## Adapter: RealtimeProvider not implemented

**Found:** 2026-04-13 during architectural cleanup
**Severity:** Low (event-orchestrator not used in manual execution path)
**Location:** Need `src/adapters/supabase/realtime.ts` implementing `RealtimeProvider` port
**What's needed:** Wrap Supabase Realtime client to implement `subscribeToTable()` from `src/core/ports/realtime.ts`
