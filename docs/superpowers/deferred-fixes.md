# Deferred Fixes

Issues found during verification that aren't showstoppers. Fix before merge or track as follow-up issues.

---

## UI: Skill edit/delete missing

**Found:** 2026-04-13 during R5-V browser verification
**Severity:** Medium — users can create skills but not edit or delete them
**Location:** `src/app/[org]/[user]/[project]/settings/skills/page.tsx`
**What's needed:** Add edit (inline or modal) and delete buttons to each skill card. Requires `skill.update` and `skill.delete` tRPC mutations.

## UI: GateResultsPanel rule details show empty dots

**Found:** 2026-04-13 — gate evaluation works, verdict displays correctly, but individual rule dots show no text
**Severity:** Low — verdict and pass/fail are correct, just the per-rule detail is missing
**Location:** `src/components/pipeline/GateResultsPanel.tsx`
**Root cause:** Panel expects `ruleResults[].field` but the stored `RuleResult` has `rule.field`, `rule.operator`, `rule.value` nested under a `rule` object. Panel needs to read `rule.rule.field` etc.

## UI: Previous run details not visible after new run

**Found:** 2026-04-13 during R5-V browser verification
**Severity:** Medium — after running implement stage, research run details are no longer accessible
**Location:** `RunDetailModal` or run history display
**What's needed:** Show run history per stage or allow selecting previous runs

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

## UI: LiveOutput updates all at once instead of streaming line-by-line

**Found:** 2026-04-13 during R5-V browser verification
**Severity:** Medium — output appears as a batch when the run completes rather than streaming incrementally
**Location:** `src/components/pipeline/LiveOutput.tsx`, `src/core/orchestrator/stage-runner.ts`
**What's needed:** Investigate whether Supabase Realtime INSERT events are batched or delayed. May need to flush event writes more aggressively, or switch from refetch-on-event to appending new events directly from the Realtime payload.

## UI: Pipeline detail modal duration doesn't update in real-time

**Found:** 2026-04-13 during R5-V browser verification
**Severity:** Low — duration shows stale value until modal is reopened
**Location:** `RunDetailModal` or parent component
**What's needed:** Poll or subscribe to `pipeline_run` / `stage_run` updates so duration reflects current elapsed time

## UI: Closed issues should display "Closed" not "Complete"

**Found:** 2026-04-13 during R5-V browser verification
**Severity:** Low — issue state shows "Complete" but users expect "Closed" for `isClosed=true`
**Location:** Issue detail and list components
**What's needed:** When `isClosed` is true, display "Closed" label regardless of state name. Or add a visual indicator (strikethrough, badge) for closed issues.

## UI: Raw JSON shows initial events immediately but output only at end

**Found:** 2026-04-13 during R5-V browser verification
**Severity:** Low — the `launched` events appear right away in raw JSON mode, but output events only appear when the run completes. This is the same batching issue as LiveOutput but specifically visible in raw mode.

## Adapter: RealtimeProvider not implemented

**Found:** 2026-04-13 during architectural cleanup
**Severity:** Low (event-orchestrator not used in manual execution path)
**Location:** Need `src/adapters/supabase/realtime.ts` implementing `RealtimeProvider` port
**What's needed:** Wrap Supabase Realtime client to implement `subscribeToTable()` from `src/core/ports/realtime.ts`
