# Deferred Fixes

Issues found during verification that aren't showstoppers. Fix before merge or track as follow-up issues.

---

## ~~ARCH: Skill-to-orchestrator IPC protocol not defined~~ — RESOLVED (R5.5)

**Found:** 2026-04-13 during R5-V browser verification
**Resolved:** 2026-04-15 in R5.5 (PR #23, #26, #29) — `flux:signal` stdout protocol shipped. Skills emit structured JSON signals; the systemd daemon parses and applies state transitions. The orchestrator remains the single DB writer.

## ARCH: Manual-run does not auto-advance issue state (by design)

**Found:** 2026-04-13 — initially implemented auto-advance, then removed
**Severity:** N/A — architectural decision, not a bug
**Context:** Manual-run is an admin override. The admin sees the output and decides what state to transition to. Auto-advancing was wrong because: (1) the skill owns the decision about next state, (2) exit code 0 doesn't mean "advance" (skill may find work already done), (3) the orchestrator shouldn't make decisions the skill should make.

---

## ~~UI: Skill edit/delete missing~~ — RESOLVED (R-UI-1)

**Found:** 2026-04-13 during R5-V browser verification
**Resolved:** 2026-04-16 in R-UI-1 (PR #31) — `src/app/[org]/[user]/[project]/settings/skills/page.tsx` rewritten to use `RecordEditor` primitive with Edit/Save/Cancel/Delete affordances. Skill router gained `update` (version-required optimistic lock) and `delete` (version-required + FK-safe via `countReferences`) mutations. Covered by journeys `edit-a-skill`, `delete-an-unreferenced-skill`, `delete-a-referenced-skill-fails-gracefully`.

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

## ~~UI: Issue activity feed doesn't auto-refresh via Realtime~~ — RESOLVED (R-UI-2.5)

**Found:** 2026-04-13 during R5-V browser verification
**Severity:** Medium — issue events (stage_started, pipeline_completed) only appear after page refresh
**Location:** Issue detail client component
**What's needed:** Subscribe to `issue_event` table changes via Supabase Realtime, or add polling refetch
**Resolved:** 2026-04-20 in R-UI-2.5 (PR #TBD) — `ActivityFeed.tsx` subscribes to `issue_event` table via `registry.get<RealtimeProvider>('realtime')` and refetches the events query on any matching row change. Replaces manual `eventsQuery.refetch()` calls in comment mutation success handlers.

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
**Update (2026-04-20, R-UI-2.5):** The Realtime subscription to `stage_run` landed in R-REM-W2 and covers status-driven refetches (which refresh end-times once the run terminates). What remains open is only the live elapsed-duration tick while a run is in progress — that's the `useNow` hook from the retired R-UI-2 plan, explicitly deferred from R-UI-2.5 scope. No further action until a separate phase picks it up.

## UI: Closed issues should display "Closed" not "Complete"

**Found:** 2026-04-13 during R5-V browser verification
**Severity:** Low — issue state shows "Complete" but users expect "Closed" for `isClosed=true`
**Location:** Issue detail and list components
**What's needed:** When `isClosed` is true, display "Closed" label regardless of state name. Or add a visual indicator (strikethrough, badge) for closed issues.

## UI: Raw JSON shows initial events immediately but output only at end

**Found:** 2026-04-13 during R5-V browser verification
**Severity:** Low — the `launched` events appear right away in raw JSON mode, but output events only appear when the run completes. This is the same batching issue as LiveOutput but specifically visible in raw mode.

## ~~UI: Activity feed does not show correctly~~ — RESOLVED (R-UI-2.5, incidental)

**Found:** 2026-04-15 during R5.5 browser verification
**Severity:** Medium — activity feed display is broken or misleading
**Location:** Issue detail activity/event feed
**What's needed:** Investigate and fix activity event rendering
**Resolved:** 2026-04-20 in R-UI-2.5 (PR #TBD) — rendering verified correct via the e2e/activity-feed-realtime.spec.ts Playwright smoke (commit d5c4129) which asserts the feed renders event rows and updates without manual refresh. The original ambiguous repro did not recur; any residual concern would be caught by this smoke.

## UI: State/status labels have inconsistent verb tenses

**Found:** 2026-04-15 during R5.5 browser verification
**Severity:** Low — e.g. pipeline shows "completed" (past tense) while states use present tense like "Research", "Implement"
**What's needed:** Align all state/status labels to consistent tense conventions. States should be nouns/phases (Research, Implementation, Review). Statuses should be adjectives/states (Open, Running, Blocked, Completed).

## UI: Inconsistent text casing across UI

**Found:** 2026-04-15 during R5.5 browser verification
**Severity:** Low — some labels are all lowercase, some sentence case, some all uppercase
**What's needed:** Standardize to sentence case throughout the UI

## ~~Adapter: RealtimeProvider not implemented~~ — RESOLVED (R-REM-W2, back-filled)

**Found:** 2026-04-13 during architectural cleanup
**Severity:** Low (event-orchestrator not used in manual execution path)
**Location:** Need `src/adapters/supabase/realtime.ts` implementing `RealtimeProvider` port
**What's needed:** Wrap Supabase Realtime client to implement `subscribeToTable()` from `src/core/ports/realtime.ts`
**Resolved:** 2026-04-19 in R-REM-W2 (PR #43) — `SupabaseRealtimeProvider` adapter shipped at `src/adapters/supabase/realtime.ts`, registered in both `bootstrap.ts` and `bootstrap-client.ts`. Consumers resolve it via `registry.get<RealtimeProvider>('realtime')`. Back-fill note: this entry should have been struck when W2 merged; captured during R-UI-2.5.

## DEF-001 — Feature: Openclaw-style preview gate (blur-until-viewed)

**Found:** 2026-04-16 during R-UI-1 brainstorming
**Severity:** Low — privacy/demo affordance, not a GTM blocker
**Location:** `RecordEditor` accepts a `previewGate` prop today (no-op default); wire real implementation when an auth/visibility model exists
**What's needed:** When displaying sensitive record content (prompt templates, system prompts), render blurred by default with a "Preview" button that unblurs. Click "Editor" to switch to edit-in-place mode with unblurred content. Pattern reference: openclaw Agents settings page.

## DEF-002 — Feature: Role-based edit/delete permissions for skills and drivers

**Found:** 2026-04-16 during R-UI-1 brainstorming
**Severity:** Medium — needed before beta, not blocking in-team dev
**Location:** `src/server/routers/skill.ts` and `src/server/routers/driver.ts` delete mutations; `canEdit`/`canDelete` props on `RecordEditor` (currently return `true`); `hasFeature(user, Feature.ROLE_BASED_PERMISSIONS)` gate point in `src/core/features/features.ts`
**What's needed:** Gate hard-delete and edit behind a role check (e.g., `admin` or `maintainer`). Non-privileged users see a soft-delete ("archive") option instead, or are blocked entirely. Requires auth role model — currently every user is effectively admin.

## DEF-003 — Feature: Version history and revert for skills and drivers

**Found:** 2026-04-16 during R-UI-1 brainstorming
**Severity:** Medium — not a GTM blocker for beta, but a planned feature (Portainer Enterprise-style versioning)
**Location:** Would add `skill_revision` and `driver_revision` tables (additive, no changes to existing tables). `RecordEditor` has `onEditSnapshot` prop hook that fires on every edit enter — wire it to a snapshot mutation when this ships.
**What's needed:** On every edit save, snapshot the full row to a revision table with author + timestamp + monotonic `revision_number`. UI lists past revisions and allows revert (writes a new revision that restores the snapshotted fields). The existing `version` int continues to serve as the optimistic-concurrency lock; `revision_number` is the semantic history counter.

## DEF-004 — Feature: Subscription tier model + runtime feature gating

**Found:** 2026-04-16 during R-UI-1 brainstorming
**Severity:** High — GTM blocker for SaaS monetization
**Location:** `src/core/features/features.ts` (`hasFeature()` today returns `true` for everything); need to add tier/subscription state on user or organization, plus tRPC middleware for backend enforcement
**What's needed:** Open-core SaaS model — one codebase, runtime feature gating for enterprise tiers. Wire `hasFeature(user, feature)` to real subscription state on `user` or `organization`. Enforce in two layers: tRPC middleware rejects gated mutations; UI hides/disables affordances. Grandfather principle: users who were already using a feature when it becomes gated retain access (no take-away-to-monetize).

## DEF-005 — Terminology glossary document (LIVING)

**Found:** 2026-04-16 during R-UI-1 brainstorming (harness/skill naming collision)
**Status:** Seeded in R-UI-1 (PR #31) with 11 terms at `docs/terminology.md`: `driver`, `skill`, `pipeline`, `pipeline_stage`, `pipeline_run`, `stage_run`, `issue`, `issue_state`, `issue_status`, `gate`, `routing_profile`. Every future phase adds entries for new domain terms. When a term is renamed, the old name stays as "formerly known as" for at least one milestone. Enforcement: PRs introducing new domain terms must include a glossary entry in the same PR. This entry stays open as a standing reminder, not a TODO.

## DEF-006 — Structured JSON editor for `jsonb` driver fields

**Found:** 2026-04-16 during R-UI-1 design audit
**Severity:** Medium — readonly in MVP limits driver reconfigurability for JSON-valued fields
**Location:** `RecordEditor` + `driverDescriptor` — `defaultArgs`, `envVars`, `extraArgs`, `contextLayout` are currently rendered as `readonly` (display-only) because they're `jsonb` columns
**What's needed:** A structured JSON editor field type — Monaco with JSON schema validation, or a form-builder keyed off each field's implied shape. Until this exists, changing those fields requires direct DB edits via `db:studio`. The R-UI-1 UI exposes them as readonly so users can see their contents; editing is a deferred upgrade.

## DEF-007 — Canonical source for git hooks (track + install script)

**Found:** 2026-04-16 during R-UI-1 Session A (rename phase)
**Severity:** Medium — hooks are per-clone and drift silently across contributors
**Location:** Today hooks live only in `.git/hooks/` (untracked). No canonical source in the repo.
**What's needed:** Move canonical pre-commit / pre-push scripts into a tracked directory (e.g., `scripts/hooks/`) with a `scripts/install-hooks.sh` that copies them into `.git/hooks/`. Document in `CLAUDE.md`. The R-UI-1 Session A rename added a size-exemption list for `src/core/db/schema.ts` that only exists in the local clone — other contributors pulling this branch will still hit the 500-line check until they re-run the (currently nonexistent) install script.

**Local-clone exemptions added in Session B (Task 5 prep commit):** beyond `src/core/db/schema.ts`, the local pre-commit hook now also exempts `src/__tests__/integration/orchestrator.test.ts` (550 lines) and `src/scripts/db/seed.ts` (587 lines; path updated from `src/core/db/seed.ts` in Wave 1 Task 8). These two are DEF-008 candidates — split later if a clean seam emerges. Until DEF-007 ships an install script, fresh clones must re-add these exemptions manually.

## DEF-008 — Pre-existing violations in `src/__tests__/integration/services.test.ts`

**Found:** 2026-04-18 during Wave 1 Task 7 commit (pre-commit hook rejected a re-stage of the file).
**Severity:** Low — tests pass and the file compiles. Cleanup-only concerns.
**Location:** `src/__tests__/integration/services.test.ts`
**What's broken:**
1. 6 × `@typescript-eslint/no-explicit-any` errors at lines 38, 381, 408, 524, 527, 557 (`Record<string, any>` patterns). All predate Wave 1 (last touched in `1feffd6`, the R3 initial integration-tests commit). Can be tightened to `Record<string, unknown>` or a Drizzle-table-typed union.
2. File length 561 lines > 500-line hook limit (was 564 on main before Task 7 edit). Companion to DEF-007's existing exemption list — candidate to either split or exempt.
**How Task 7 handled it:** Committed with `--no-verify` (user-authorized). The hook was re-triggered only because Task 7 mechanically had to delete 3 `schema.issueAttachment/issueDependency/issueSavedView` references from `tableMap`. Neither violation was introduced by Task 7.
**What's needed:** Either add this file to `SIZE_EXEMPT_FILES` in the pre-commit hook and replace the 6 `any`s with narrower types, or split the test file along the catalog/issue-lifecycle seam. Pairs with DEF-007 (canonical hook source) so the exemption lives in a tracked file.

## DEF-009 — Seeded issues missing `bodyHtml`; description shows "No description" until edited

**Found:** 2026-04-20 during R-UI-2.5 human browser verification.
**Severity:** Low — user-visible only on seeded issues. Fresh issues created through the UI render correctly.
**Location:** `src/scripts/db/seed.ts` — `db.insert(issue).values({ ..., bodyMd: '...' })` at issue #1 (~line 520) and #2 (~line 553). `bodyHtml` is never set.
**Root cause:** `EditableBody` renders from `bodyHtml` in view mode (per invariant #14 — server-rendered at write time, safe for `dangerouslySetInnerHTML`) and falls back to a "No description. Click to add one." placeholder when `bodyHtml` is null. The tRPC mutation paths (`issue.create`, `issue.updateFields`) both run a markdown → HTML renderer before writing to the DB, so UI-authored issues always have `bodyHtml` populated. The seed script bypasses the mutation path and writes `bodyMd` directly, leaving `bodyHtml` null. Clicking Edit and saving re-runs the mutation path, populates `bodyHtml`, and the description becomes visible.
**What's needed:** In the seed script, either (a) call the shared markdown → HTML helper before each `db.insert(issue).values(...)` and pass `bodyHtml` alongside `bodyMd`, or (b) route seed inserts through the same `createIssueService`-equivalent that the tRPC router uses, so markdown rendering is a single source of truth. Option (b) is the DRY fix; option (a) is faster. Either way, `npm run verify` should eventually assert that every seeded issue has both `bodyMd` AND `bodyHtml` populated.

## DEF-010 — Tag input only accepts single tag; space and comma separators don't split

**Found:** 2026-04-20 during R-UI-2.5 human browser verification.
**Severity:** Low — multi-tag UX is broken but no data loss; users can work around by submitting one tag at a time (if the UI even supports that; behavior with a single tag entry is fine per this report).
**Location:** Issue detail — wherever the tag field is rendered (need to locate on investigation; likely `src/app/[org]/[user]/[project]/issues/[number]/client.tsx` or a component it imports). Pre-existing behavior — not touched in R-UI-2.5.
**Repro:** On an issue detail page, type one tag, press space (or comma) expecting it to commit and start a new tag. Second tag is not accepted.
**What's needed:** Tag field should split on space/comma/Enter and commit each trimmed segment as a separate tag. Also consider: paste handling, max-length per tag, duplicate suppression. Wire to the existing tag mutation path. Independent of R-UI-2.5 scope.
