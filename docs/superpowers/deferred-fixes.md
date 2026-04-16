# Deferred Fixes

Issues found during verification that aren't showstoppers. Fix before merge or track as follow-up issues.

---

## ARCH: Skill-to-orchestrator IPC protocol not defined

**Found:** 2026-04-13 during R5-V browser verification
**Severity:** High — skills cannot communicate decisions (state transitions, exit status, results) back to the orchestrator
**Context:** In PAT, skills call `pat pipeline exit --stage X --status Y --result Z` which writes to PAT's DB. The PAT manager reads those records. In fluxaOS, `pat pipeline exit` doesn't exist. The systemd daemon is the single DB writer — skills cannot write to the DB directly (race conditions, drift). Need an IPC mechanism for skills to signal completion/decisions back to the orchestrator.
**Options discussed:** Structured stdout JSON protocol, file-based result in workspace, or a local API endpoint that only systemd listens on.
**Blocked on:** Design session (brainstorming) to determine the right approach.

## ARCH: Manual-run does not auto-advance issue state (by design)

**Found:** 2026-04-13 — initially implemented auto-advance, then removed
**Severity:** N/A — architectural decision, not a bug
**Context:** Manual-run is an admin override. The admin sees the output and decides what state to transition to. Auto-advancing was wrong because: (1) the skill owns the decision about next state, (2) exit code 0 doesn't mean "advance" (skill may find work already done), (3) the orchestrator shouldn't make decisions the skill should make.

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

## UI: Activity feed does not show correctly

**Found:** 2026-04-15 during R5.5 browser verification
**Severity:** Medium — activity feed display is broken or misleading
**Location:** Issue detail activity/event feed
**What's needed:** Investigate and fix activity event rendering

## UI: State/status labels have inconsistent verb tenses

**Found:** 2026-04-15 during R5.5 browser verification
**Severity:** Low — e.g. pipeline shows "completed" (past tense) while states use present tense like "Research", "Implement"
**What's needed:** Align all state/status labels to consistent tense conventions. States should be nouns/phases (Research, Implementation, Review). Statuses should be adjectives/states (Open, Running, Blocked, Completed).

## UI: Inconsistent text casing across UI

**Found:** 2026-04-15 during R5.5 browser verification
**Severity:** Low — some labels are all lowercase, some sentence case, some all uppercase
**What's needed:** Standardize to sentence case throughout the UI

## Adapter: RealtimeProvider not implemented

**Found:** 2026-04-13 during architectural cleanup
**Severity:** Low (event-orchestrator not used in manual execution path)
**Location:** Need `src/adapters/supabase/realtime.ts` implementing `RealtimeProvider` port
**What's needed:** Wrap Supabase Realtime client to implement `subscribeToTable()` from `src/core/ports/realtime.ts`

## DEF-001 — Feature: Openclaw-style preview gate (blur-until-viewed)

**Found:** 2026-04-16 during R-UI-1 brainstorming
**Severity:** Low — privacy/demo affordance, not a GTM blocker
**Location:** `RecordEditor` accepts a `previewGate` prop today (no-op default); wire real implementation when an auth/visibility model exists
**What's needed:** When displaying sensitive record content (prompt templates, system prompts), render blurred by default with a "Preview" button that unblurs. Click "Editor" to switch to edit-in-place mode with unblurred content. Pattern reference: openclaw Agents settings page.

## DEF-002 — Feature: Role-based edit/delete permissions for skills and harnesses

**Found:** 2026-04-16 during R-UI-1 brainstorming
**Severity:** Medium — needed before beta, not blocking in-team dev
**Location:** `src/server/routers/skill.ts` and `src/server/routers/harness.ts` delete mutations; `canEdit`/`canDelete` props on `RecordEditor` (currently return `true`); `hasFeature(user, Feature.ROLE_BASED_PERMISSIONS)` gate point in `src/core/features/features.ts`
**What's needed:** Gate hard-delete and edit behind a role check (e.g., `admin` or `maintainer`). Non-privileged users see a soft-delete ("archive") option instead, or are blocked entirely. Requires auth role model — currently every user is effectively admin.

## DEF-003 — Feature: Version history and revert for skills and harnesses

**Found:** 2026-04-16 during R-UI-1 brainstorming
**Severity:** Medium — not a GTM blocker for beta, but a planned feature (Portainer Enterprise-style versioning)
**Location:** Would add `skill_revision` and `harness_revision` tables (additive, no changes to existing tables). `RecordEditor` has `onEditSnapshot` prop hook that fires on every edit enter — wire it to a snapshot mutation when this ships.
**What's needed:** On every edit save, snapshot the full row to a revision table with author + timestamp + monotonic `revision_number`. UI lists past revisions and allows revert (writes a new revision that restores the snapshotted fields). The existing `version` int continues to serve as the optimistic-concurrency lock; `revision_number` is the semantic history counter.

## DEF-004 — Feature: Subscription tier model + runtime feature gating

**Found:** 2026-04-16 during R-UI-1 brainstorming
**Severity:** High — GTM blocker for SaaS monetization
**Location:** `src/core/features/features.ts` (`hasFeature()` today returns `true` for everything); need to add tier/subscription state on user or organization, plus tRPC middleware for backend enforcement
**What's needed:** Open-core SaaS model — one codebase, runtime feature gating for enterprise tiers. Wire `hasFeature(user, feature)` to real subscription state on `user` or `organization`. Enforce in two layers: tRPC middleware rejects gated mutations; UI hides/disables affordances. Grandfather principle: users who were already using a feature when it becomes gated retain access (no take-away-to-monetize).

## DEF-005 — Terminology glossary document

**Found:** 2026-04-16 during R-UI-1 brainstorming (harness/skill naming collision)
**Severity:** High — prevents future "we've been talking about different things for four hours" incidents
**Location:** `docs/terminology.md` (new file; seeded as part of R-UI-1)
**What's needed:** A single glossary covering every domain entity and concept in fluxaOS. Each entry has: **field/entity name** (exact code identifier), **description** (plain-English meaning), **example** (concrete instance). Seed terms for R-UI-1: `coding_agent`, `skill`, `pipeline`, `pipeline_stage`, `pipeline_run`, `stage_run`, `issue`, `issue_state`, `issue_status`, `gate`, `routing_profile`. Every future phase adds entries for new terms introduced. When a term is renamed, the old name stays in the doc as "formerly known as" for at least one milestone. Enforcement: PRs introducing new domain terms require a glossary entry in the same PR.
