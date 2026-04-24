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
**Resolved:** 2026-04-20 in R-UI-2.5 (PR #47) — `ActivityFeed.tsx` subscribes to `issue_event` table via `registry.get<RealtimeProvider>('realtime')` and refetches the events query on any matching row change. Replaces manual `eventsQuery.refetch()` calls in comment mutation success handlers.

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
**Resolved:** 2026-04-20 in R-UI-2.5 (PR #47) — rendering verified correct via the e2e/activity-feed-realtime.spec.ts Playwright smoke (commit d5c4129) which asserts the feed renders event rows and updates without manual refresh. The original ambiguous repro did not recur; any residual concern would be caught by this smoke.

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

## DEF-011 [RESOLVED 2026-04-21] — `ToolCallEntry` never renders in `LiveOutput` because orchestrator/parser payload shapes disagree

**Found:** 2026-04-20 during R-REM-W3-a journey-test authoring (live-Claude Research run produced 6 `kind: 'tool_call'` events in the DB that all rendered as `text` entries in the browser).
**Severity:** Medium — no data loss (every tool use IS persisted with `kind: 'tool_call'` and is queryable via `npm run db:events`), but the UI can't differentiate tool calls from text blocks, so the `<ToolCallEntry>` highlighting / `<ToolResultEntry>` collapsing / `<ResultEntry>` summary cost-display paths never fire in practice. The transcript is a wall of text.
**Location:**
- Orchestrator persists events via `recordEvent` with `payload` = `{id, kind, content, toolName, lineNumber, toolCommand, ...}` (pre-parsed from the driver's stream-json). `content` is the extracted tool command/query string, not the original JSON line.
- `src/components/pipeline/LiveOutput.tsx:96-106` builds `rawLines` from `eventsQuery.data`, extracting `payload.content` as each line's `content` field.
- `src/components/pipeline/LiveOutput.tsx:109-131` feeds each `content` string through `parseLine` (the `stream-json` parser at `src/adapters/subprocess/stdout-parser.ts:42-43`).
- `stdout-parser.ts:43-45` fast-paths any string that doesn't start with `{` to a `raw` entry. Extracted tool commands never start with `{`, so every tool_call event becomes a `raw` line.
- `LiveOutput.tsx:115-118` then promotes `raw` → `text` "for readability." Net effect: the entry's persisted `kind` is discarded and everything renders as plain text.

**Root cause:** mismatch between what the parser expects as input (the driver's original stdout line — a full stream-json object) and what LiveOutput actually hands it (the orchestrator's pre-extracted `content` substring). PAT's original pattern stored raw stdout lines in the event payload and let the client do all the parsing; fluxaOS's orchestrator does server-side parsing but LiveOutput still tries to re-parse.

**What's needed:** either
- (a) LiveOutput stops re-parsing and treats the DB event payloads as already-typed `TranscriptEntry` records — skip the `parseLine` step entirely when `payload.kind` is set; or
- (b) the orchestrator persists both the raw stdout line (for LiveOutput re-parse) and the parsed fields (for server-side queries/metadata). Option (a) is simpler and matches "don't parse twice."

Pairs with the `kind="tool_call"` vs `type="tool_use"` naming drift (Anthropic protocol term vs fluxaOS canonical term) which is already standardized at the DB/port layer.

**Journey-test workaround:** `e2e/real-anthropic-stage-run.spec.ts` asserts the transcript pane populated (`.font-mono > div` non-empty) instead of a specific `.text-soft-violet` span count, because that span never renders today. Once DEF-011 ships the assertion can be tightened back to the original plan.

**Resolution (2026-04-21):** Option (a) shipped — LiveOutput stops re-parsing. Orchestrator's `EVENT_TYPE.output` payloads are now persisted as plain `TranscriptEntry` records (redundant `content` projection dropped). LiveOutput consumes `event.payload` directly; `stdout-parser` port gained an `isStderr?: boolean` field that stage-runner's stderr path sets and LiveOutput's `raw` renderer styles amber. Raw JSON toolbar rewritten to show all persisted events pretty-printed. Journey test assertion tightened to `.text-soft-violet.font-medium` count ≥ 1. Spec: `docs/superpowers/specs/2026-04-21-def-011-liveoutput-payload-consumer-design.md`. Plan: `docs/superpowers/plans/2026-04-21-def-011-liveoutput-payload-consumer.md`.

## DEF-012 — Skill `housekeeping` needs fluxaOS-native rewrite

**Found:** 2026-04-20 during skills audit.
**Severity:** Medium — skill is currently broken and unusable; was not invoked recently so not actively bleeding, but blocks `end-of-day` (which calls it).
**Location:** `.claude/skills/housekeeping/SKILL.md` and `.agents/skills/housekeeping/SKILL.md` (mirrors). Both deleted in cleanup PR `cleanup/revert-premature-github-issues` pending rewrite — currently absent from disk.
**What's broken (audit findings before deletion):** "Critical Constraints" section says "This repository uses Forgejo (NOT GitHub)" — the literal opposite of fluxaOS. Forgejo/psql backend boilerplate referenced `.fhc-config.json` (deleted in R-INFRA). Issue-triage subagent (Subagent C) assumes a Forgejo issue backend that fluxaOS doesn't have. Service grep patterns (`gunicorn|uvicorn|flask|celery`) are Python ecosystem services — fluxaOS is Next.js with no managed services, just a dev server on `:3003`. Worktree/branch cleanup logic (Subagents A and B) was the only salvageable part.
**What's needed:** Rewrite as a fluxaOS-native skill. Scope to keep: parallel git cleanup (merged branches, stale 30d+ branches, all stash entries) + worktree cleanup (stale worktrees, prune metadata) + roadmap/deferred-fixes sanity scan (e.g., flag DEF entries marked RESOLVED but still in active list, flag roadmap rows out of sync with shipped PRs). Drop entirely: Forgejo references, Python service patterns, the issue-triage subagent. Use the `superpowers:brainstorming` skill to scope before rewriting — what does an admin actually want at session-end housekeeping for this project?

## DEF-013 [RESOLVED 2026-04-22] — Skill `end-of-day` needs fluxaOS-native rewrite

**Found:** 2026-04-20 during skills audit.
**Resolved:** 2026-04-22 in PR #65 (session-lifecycle-consolidation). Superseded — rather than rewriting `end-of-day`, adopted fh-commons #2845's consolidation design: `end-of-day` deleted, `session-end` added as its replacement (fluxaOS-adapted — no `flu` CLI, file-based memory markers, handoff convention at `docs/superpowers/handoffs/`). Same outcome as a rewrite but matches the cross-project convention.

## DEF-014 [RESOLVED 2026-04-22] — Skill `start-of-day` needs fluxaOS-native rewrite (preserve sub-skill structure)

**Found:** 2026-04-20 during skills audit.
**Resolved:** 2026-04-22 in PR #65 (session-lifecycle-consolidation). Superseded — rather than rewriting `start-of-day` + sub-skills, adopted fh-commons #2845's consolidation design: `start-of-day` deleted (with brief/plans/ingest sub-skills), `session-start` added as its replacement (fluxaOS-adapted — single flat skill, no `{{PARTIAL}}` resolver, file-based markers). Sub-skill routing pattern abandoned in favor of the simpler single-skill contract used across all fh-commons projects.

## DEF-015 — Skills audit: 9 broken skills deleted, no fluxaOS-native equivalents needed

**Found:** 2026-04-20 during skills audit.
**Severity:** Informational — record of completed cleanup, not action-required.
**Context:** Audit of 20 skills (mirrored to `.claude/skills/` and `.agents/skills/`) inherited from fh-commons in the R-INFRA decoupling found 9 skills broken beyond light edits. All 9 were deleted from both mirrors in PR `cleanup/revert-premature-github-issues`. The deletions are NOT pending rewrite — these skills had no fluxaOS-relevant function; their roles are covered by superpowers skills + native commands.
**Deleted skills (with replacement guidance):**
- `deploy` and `finish` — pat-pipeline-orchestrator skills with Python tooling. Replacement: `end-of-session` skill (handles PR/merge/cleanup) + `superpowers:finishing-a-development-branch` for branch-completion decisions.
- `implement` and `research` — fh-commons pipeline skills with `{{PARTIAL:...}}` template includes that were never resolved. Replacement: `superpowers:writing-plans` (research/design) + `superpowers:subagent-driven-development` (implementation cadence).
- `verify-webapp` — Python `fh_commons.browser` imports for a TypeScript/Playwright project. Replacement: Playwright e2e specs in `e2e/*.spec.ts` invoked directly via `npx playwright test`.
- `review` — pat-pipeline reviewer with Forgejo, `{{WEBAPP}}` placeholders, and `pat pipeline exit` calls. Replacement: `superpowers:requesting-code-review` skill + manual `gh pr` commands during `end-of-session`.
- `manager` — issue-lifecycle orchestrator that assumed a queryable issue backend (Forgejo or `pat`-style DB). fluxaOS pre-alpha doesn't have one — `deferred-fixes.md` is a static markdown file, not queryable. Replacement: none needed pre-alpha; revisit post-alpha if GitHub Issues adoption (R7) creates a real lifecycle to manage.
- `verify-issue` — same issue-backend assumption as `manager`. Replacement: `superpowers:verification-before-completion` for the verification discipline; the per-issue tracking is the operator's job pre-alpha.
- `check-logs` — was hardcoded to halt unconditionally on invocation (`webapp=false, has_logs=false` placeholders evaluated as a literal "false is false" check). Also had Python service grep patterns. Replacement: ad-hoc `npm run dev` console scan + Playwright `pageerror` capture in e2e specs (already in use per R-REM-W3-a journey test).
**What's needed:** Nothing. This entry is the audit trail. If any of the 9 deletions turns out to be missed, restore from git history (commit on `cleanup/revert-premature-github-issues` branch).

## DEF-016 — Verbose mode is noisy: `hook_started` / `hook_response` / `init` system entries swamp the transcript

**Found:** 2026-04-21 during DEF-011 human verification against issue #1 Research run.
**Severity:** Low — pre-alpha UX paper cut, not a functional bug.
**Repro:** Open any RunDetailModal for a Claude Code run, toggle Verbose on. The transcript leads with ~14 `hook_started` / `hook_response` / `init` system entries before any model text appears. On short runs (32s, ~33 output events here), the hook noise is ~40% of the rendered lines.
**What's needed:** Either (a) filter hook lifecycle messages out of the verbose renderer by default with an opt-in "Show hooks" sub-toggle, or (b) collapse contiguous hook events into a single "14 hooks initialized" summary line. Option (a) matches the existing Verbose/Raw JSON toggle pattern and is lower-risk. The filter predicate is straightforward — `system` kind entries whose `text` starts with `hook_` or equals `init`. Raw JSON mode should still show every event (it's the "everything" view).
**Context:** The signal-to-noise shifted after DEF-011 landed because verbose mode now cleanly shows every system entry, including the previously-invisible hook lifecycle chatter. This was hidden before because the re-parse collapsed them to `text` with different wrapping; now `kind === 'system'` entries render faintly but still take one line each.

## DEF-017 [RESOLVED 2026-04-21] — System entries render out of lineNumber order (3, 2, 1, 5, 4, 11, 12, 6, 7, 8, 9, 13, 10)

**Found:** 2026-04-21 during DEF-011 human verification against issue #1 Research run (Raw JSON pane).
**Severity:** Low-Medium — not a correctness regression from DEF-011 (pre-fix exhibited the same behavior via the re-parse path), but it's a real ordering anomaly in the persisted event stream. Investigate whether it reflects (a) out-of-order arrival from the Claude Code subprocess stdout stream, (b) out-of-order INSERT commits to Supabase, or (c) out-of-order `eventsQuery` result ordering on the read side.
**Repro:** Run any Claude Code stage through completion, open RunDetailModal, toggle Raw JSON. The leading `output` events with `kind: 'system'` arrive with scrambled `lineNumber` fields. Example from issue #1 Research run: 3, 2, 1, 5, 4, 11, 12, 6, 7, 8, 9, 13, 10. The parser's own `lineNumber` assignment is monotonic at the source, so the reordering happens downstream.
**What's needed:** Investigation. Three likely culprits:
  1. The parser assigns lineNumber synchronously but `appendEvent` is fire-and-forget (`.catch(logError)`) — multiple parallel inserts can commit out of order, and the persisted `createdAt` field would reflect DB-commit time, not parser time. Verify by adding a `lineNumber` ORDER BY on the events query (currently `events` router likely returns by `createdAt`).
  2. Supabase Realtime INSERT events arrive before the tRPC refetch completes, producing a brief misorder that resolves on next poll. Less likely given Raw JSON mode reads from `eventsQuery.data`, not the Realtime payload directly.
  3. The subprocess emits hook events on stderr/stdout asynchronously and the parser's `lineNumber` counter is a shared closure increment that races with itself.
**Fix sketch:** Sort `eventsQuery.data` by `(createdAt, payload.lineNumber)` in LiveOutput before rendering, OR change the events router to `ORDER BY created_at, (payload->>'lineNumber')::int`. The DB fix is cleaner and fixes it for every consumer (not just LiveOutput).
**Not a DEF-011 regression:** The pre-fix re-parse path exhibited the same ordering under the hood — the collapsing to `text` just made it less visually obvious. Worth fixing independently.

**Resolution (2026-04-21):** Hypothesis #1 confirmed. Direct PG inspection of the test data showed each fire-and-forget `appendEvent` INSERT receives a unique microsecond-precision `timestamp`, but the postgres-js connection pool round-robins the inserts across parallel connections — so commit order disagrees with producer (`lineNumber`) order. The original "fix sketch" (compound `ORDER BY timestamp, lineNumber`) was attempted and proven insufficient: the secondary key only resolves microsecond ties, but the dominant misordering happens between events with *different* timestamps. Real fix: kept the SQL simple (`ORDER BY timestamp ASC`) and added a JS post-sort merge in `pipelineRunService.listEvents()` — partition into stream events (have `lineNumber`) vs lifecycle events (no `lineNumber`), sort stream by `lineNumber`, then splice lifecycle events back in at their timestamp position. Both router consumers (`pipeline.get` and `pipeline.events`) routed through the new service method so the ordering lives in one place. Regression test: `src/__tests__/integration/orchestrator-e2e.test.ts > event ordering — DEF-017` (concurrent `Promise.all` insert of 20 stream events + 2 lifecycle, asserts monotonic lineNumber order plus chronological position of lifecycle events).

## DEF-018 — CI lint (`biome format`) failing on main: `tests/verify/seed-check.ts` and `src/scripts/db/scripts/*.ts`

**Found:** 2026-04-22 during PR #65 merge check.
**Severity:** Low — CI check only, app functionality unaffected. Makes all PRs show a red check even for unrelated changes.
**Repro:** `gh run list --branch main --limit 3` shows the last 3 merges to main all failed the `check` job. CI log shows `biome format` wants to reflow multi-line assertions in `tests/verify/seed-check.ts` and import statements in `src/scripts/db/scripts/*.ts`. The `check` job doesn't block merge, but it misleads reviewers into thinking the current PR broke CI.
**Location:** `tests/verify/seed-check.ts`, `src/scripts/db/scripts/{issues,runs,gates,events}.ts` and similar.
**What's needed:** Run `biome format --write` on the affected files and commit. Biome formatting is deterministic so this is a one-line fix per file; the content doesn't change semantically. Low-risk chore PR.
**Pre-existing context:** The failure predates PR #65 — it's been red since at least 2026-04-21. Probably a Biome config update or file added that wasn't formatted on the way in. Per global CLAUDE.md Rule 1 ("NEVER assume a test failure is pre-existing — check the base branch first"), verified against `origin/main` HEAD — same failure, same files, so not introduced by PR #65.

## DEF-019 — Drizzle meta snapshot drift since 0003; auto-generate unusable without hand-written migrations

**Found:** 2026-04-23 during R-RUNTIME T1 (migration 0007).
**Severity:** Medium — not a runtime bug, but makes `npm run db:generate` produce catch-up migrations that conflict with applied schema. Every future migration requires hand-writing or elaborate snapshot rehydration.
**Repro:** On `main` before R-RUNTIME, `drizzle/meta/` contains only `0000_snapshot.json` + `0003_snapshot.json` + `_journal.json` — migrations 0001, 0002 (missing file), 0004, and 0006 shipped without updating the meta cache. Running `npm run db:generate` with a clean schema prompts for resolver decisions on ~50 pre-existing columns and, after answering, emits a migration that `CREATE TABLE`s already-existing tables and `ADD COLUMN`s already-present columns — it would fail on apply.
**What R-RUNTIME did:** Hand-wrote `drizzle/0007_r_runtime.sql` with only the new table + 2 columns. Added journal entry manually. Commit `27f305b`.
**What's needed:** Rehydrate the snapshot. Two paths:
  1. **Clean slate rebaseline** — delete everything in `drizzle/meta/` except `_journal.json`, wipe dev DB, apply all historical migrations in order through 0007, then run `drizzle-kit introspect` (or equivalent) to regenerate a fresh `0007_snapshot.json` from the live DB state. Update `_journal.json` to reflect only the migrations that actually exist.
  2. **Manual snapshot construction** — hand-author `drizzle/meta/0007_snapshot.json` to match current `schema.ts`. More work, less risk of introducing drift.
Prefer option 1 during R-POLISH — same phase where clean-shipping the repo matters.
**Impact:** Until fixed, every migration needs hand-writing + manual journal entry. Annoying but tractable; R-RUNTIME got through it in ~5 minutes of reasoning plus manual SQL.

## DEF-020 [RESOLVED 2026-04-23] — R-RUNTIME journey test polls wrong terminal condition (race vs deploy bridge)

**Found:** 2026-04-23 during T20 live sandbox validation against `jdpierce21/fluxaos-alpha-e2e-sandbox`.
**Severity:** Low — test-only; engine correctness proved independently. No runtime bug.
**Symptom:** `e2e/r-runtime-deploy-journey.spec.ts` asserts `issue.state_key === 'review'` immediately after polling `pipeline_run.status === 'completed'`. Got `implement` on live sandbox. `db:issues` a few seconds later showed Review — the test read the DB during the race window between status flip and the deploy bridge's transition step.
**Why it races:** `manual-run.ts` / `event-orchestrator.ts` flip `pipeline_run.status` to `completed` BEFORE awaiting `terminalHook.onTerminal()`. The hook calls `deployBridge.deploy(runId)` which in turn opens the PR and issues the `issueService.transition(..., review, ...)`. Poll loop breaks out as soon as status reaches terminal — which is too early.
**Proof the engine works:** PR #1 opened on sandbox (https://github.com/jdpierce21/fluxaos-alpha-e2e-sandbox/pull/1) with correct body (issue link, run id, commit SHA), branch `fluxaos/issue-1-c1a50bfc` pushed, worktree at `<target>/.fluxaos-worktrees/` removed, isolation_environment row marked inactive, issue advanced to `review` with status `Blocked` (signal was `hold: needs_human` because the sandbox was empty — pipeline still completed end-to-end). Loop closed correctly; only the test's poll predicate was wrong.
**Fix sketch:** Change the poll terminal condition to `(pipeline_run.status IN terminal_set) AND EXISTS (SELECT 1 FROM issue_pull_request WHERE issue_id = $issueId)` — i.e., poll until the PR row is written, which is the true end of the deploy bridge transaction. Drop the `issueAfter` read race by combining into one query with a deadline. Alternative: make the terminal hook `await` *inside* the status-flip transaction so the status write and the deploy write are atomic — but that breaks the "release env outside the transaction" spec and would be a larger engine change. Prefer the test-side fix.
**Where:** `e2e/r-runtime-deploy-journey.spec.ts:158-176` (the 3-minute poll loop). Same race exists if any other test consumes `pipeline_run.status` as the deploy-bridge-done signal.

**Resolution (2026-04-23, R-ARTIFACTS W8-T18):** Poll loop now breaks out on either (a) `status IN ('failed','cancelled','error')` — short-circuit, no PR expected, or (b) `status === 'completed' AND issue_pull_request row exists` — the true terminal state after the deploy bridge's awaited steps finish. The new R-ARTIFACTS chain journey (`e2e/r-artifacts-chain.spec.ts`) uses the same pattern from the start.

## DEF-021 — R-ARTIFACTS chain journey: stage-2 "Run Stage" click blocked by stage-1 RunDetailModal overlay

**Found:** 2026-04-23 during T20 R-ARTIFACTS chain journey live run against `jdpierce21/fluxaos-alpha-e2e-sandbox`.
**Severity:** Low — test-only; engine correctness proved independently. No runtime bug.
**Symptom:** `e2e/r-artifacts-chain.spec.ts` drives Research stage successfully (stage_run terminal `proceed`, `research-findings.md` written, `pipeline_run.artifacts_path` populated, `.gitignore` auto-updated), then tries to advance state to `Implement` and click "Run Stage" again. Playwright retries the click ~180 times against `<div class="fixed inset-0 z-[70] ... intercepts pointer events">` — the RunDetailModal from stage 1 stayed open and blocked interaction with the stage-2 controls. Test fails at line 196.
**Proof the engine works:** Stage 1 produced a 3,274-byte high-quality `research-findings.md` that correctly diagnosed the empty sandbox and proposed a Next.js implementation plan. `pipeline_run.artifacts_path` = `/mnt/dev/fluxaos-alpha-e2e-sandbox/.fluxaos-artifacts/0605d125-75ac-4f53-90f6-9d10fc519ab5`. Both `.fluxaos-worktrees/` and `.fluxaos-artifacts/` appeared in the sandbox's `.gitignore`. The mechanism is fully wired end-to-end; the test just can't drive the second stage.
**Why it happened:** W7-T14's subagent added an Escape-close modal step between stages per the brief, but either the Escape handler is a no-op for RunDetailModal or the modal re-mounts on state change. The test didn't explicitly dismiss the modal between stages.
**Fix sketch:** Either (a) add an explicit modal-close interaction in the journey (e.g., click the modal's X button, or await `page.waitForSelector('div.fixed.inset-0', { state: 'detached' })` after Escape), or (b) structure the test to bypass the UI for stage 2 — call the `pipeline.runs.executeStage` tRPC mutation directly from the test. Option (a) is closer to real user behaviour; option (b) is more robust if the UI's modal lifecycle is flaky.
**Where:** `e2e/r-artifacts-chain.spec.ts:196` (stage 2 Run Stage click). Check the modal behaviour in `src/components/pipeline/RunDetailModal.tsx` — if Escape doesn't close it, that's its own bug.


