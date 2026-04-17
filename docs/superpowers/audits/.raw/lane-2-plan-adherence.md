# Lane 2 — Plan Adherence Auditor — Raw Output

## Required-reading proof

- docs/invariants.md: "Adding a new provider requires zero application code changes."
- docs/superpowers/specs/2026-04-07-fluxaos-spec-v2.md: "Containment rule (NON-NEGOTIABLE): No Supabase client imports outside of `adapters/supabase/`."
- docs/superpowers/specs/2026-04-09-rebuild-spec.md: "2 containers. No local postgres. Ever."
- CLAUDE.md: "Edit, never Write — never overwrite existing files; build missing endpoints instead of deleting UI"
- docs/session-quick-start.md: "Issues found during verification go to `docs/superpowers/deferred-fixes.md` — NOT Forgejo tickets."

## Mechanical-check output

### PR #31 body (R-UI-1 — Settings CRUD + harness→driver rename) — merged 2026-04-17T00:32:57Z

> ## Summary
> - Renamed `harness_catalog` → `driver` across schema, code, tests, and active docs (Session A + Session B + this session).
> - Added `RecordEditor` primitive (list + detail + edit/delete) at `src/components/record-editor/` with three pieces: `RecordField` (field-type dispatch), `RecordActionsBar` (state machine), `RecordEditor` (composite). Vendor-agnostic: zero tRPC imports; mutations injected via props.
> - Added `Feature` enum + `hasFeature()` stub at `src/core/features/features.ts` as the DEF-001..004 hook point for future SaaS tier gating.
> - Added optimistic locking + FK-safe delete to the skill service (`updateWithVersion`, `deleteWithVersion`, `countReferences`); skill router now requires `version` on `update` and `delete`.
> - Shipped two new settings pages: `/settings/drivers` (view/edit/toggle) and rewrote `/settings/skills` (view/edit/create/delete) on top of `RecordEditor`.
> - Added a `Drivers` link in the settings sidebar.
> - Seeded `docs/terminology.md` with 11 domain-term entries … DEF-005 seed.
> - Scaffolded Playwright e2e harness: … 6 journey markdown stories under `docs/journeys/` + matching `.spec.ts` files under `e2e/` — all tagged `@r-ui-1`.
> - Added homelab-only auth bypass (`FLUXAOS_LAN_AUTH_BYPASS`) so Playwright can run against the dev server without a seeded test user. Unset in production → behavior unchanged.
> - Fixed pre-existing gates.test.ts flake …
> - Excluded `e2e/**` and `website/**` from vitest discovery …
> - Updated `docs/superpowers/specs/2026-04-11-ui-inventory.md` with new Drivers section … Marked R-UI-1 complete in `docs/superpowers/roadmap.md`; promoted R-UI-2 (real-time updates) as the next phase.
>
> ## Test plan
> - [x] `npm run verify:seed` passes 10/10
> - [x] `npx vitest run` passes 117/117 (4 intentional skips) across 9 test files
> - [x] `npx playwright test --grep @r-ui-1` passes 6/6, stable across two consecutive runs (~15s each)
> - [x] No residual `harness` in live source, tests, or active docs — only 4 intentional "formerly known as" clarifier lines in terminology.md, invariants.md, and roadmap.md
> - [ ] Manual browser verification of each journey on `http://192.168.54.101:3003` with `FLUXAOS_LAN_AUTH_BYPASS=1`

### PR #32 body (R-UI-1 code-review follow-ups) — merged 2026-04-17T00:45:37Z

> ### 1. Hardcoded `userId = 'local-dev'` → real auth hook — New `src/lib/auth/use-current-user.ts` subscribes to Supabase `onAuthStateChange` …
> ### 2. `skill.delete` wrapped in transaction — `countReferences` + `deleteWithVersion` now run in a single `db.transaction`, closing a TOCTOU race …
> ### 3. `conflict-on-save.spec.ts` — `networkidle` → deterministic waits …
> ### 4. `RecordField` tags — unique keys — `key={tag}` → `key={\`${tag}-${i}\`}` …
> ## Test plan
> - [x] `npx tsc --noEmit` clean (only pre-existing `events.ts:53`)
> - [x] `npx vitest run` — 118 passed (+1 vs. main for the null-userId test), 4 skipped, 9 files
> - [x] `npx playwright test --grep @r-ui-1` — 6/6 passed in 14.3s against `http://192.168.54.101:3003`
> - [ ] Manual browser verification

### PR #33 body (Session D handoff doc) — merged 2026-04-17T04:12:57Z

> Session D handoff document for the post-R-UI-1 code-review follow-ups merged in PR #32 (squashed to `6d1c14e`). Captures: Root-cause + resolution trace for all 4 findings … Full UI test results: 118/118 vitest passing, 6/6 Playwright journeys passing … State snapshot … R-UI-2 brainstorming entry-point and scope pointers …

### R-UI-1 commit log (`git log 62de54c..5cdcc1b -- src/`) — 3 merge commits (squashed PRs)

```
6d1c14e fix: R-UI-1 code-review follow-ups (4 fixes, no deferrals) (#32)
5b12860 feat: R-UI-1 — settings CRUD + harness→driver rename (#31)
```
(PR #33 was docs-only; `main..HEAD` for R-UI-1 captured both squash commits within range)

### R-UI-2 commit log (`git log main..HEAD -- src/`) — 11 commits on `feat/r-ui-2-impl`

```
4345e3c feat(run-detail): route Realtime through port; add useNow duration tick
5c18eac feat(live-output): route Realtime through useRealtime; stream via setData append; add testid
4307b0e feat(realtime): mount RealtimeContextProvider inside TRPCProvider at project-scoped layout
0b0368d feat(realtime): useNow hook for live-duration re-renders
ebccb0a feat(realtime): client-side context and useRealtime hook
ee3cc43 feat(supabase): server-side client factory (invariant-7 boundary)
8603385 feat(db): enable Supabase Realtime publication for event, stage_run, pipeline_run, issue_event
fc98d35 feat(realtime): Supabase Realtime adapter with filter support
01207e6 test(realtime): failing integration test for Supabase adapter (3 cases)
55df983 feat(queue): return QueueWorker from process() for clean shutdown; set lockDuration
23a20eb feat(port): add optional filter param to RealtimeProvider.subscribeToTable
```

## Findings

### R-UI-1 coverage table

| Spec/plan item | Status | Evidence | Severity |
|---|---|---|---|
| Phase 0 rename (schema, migration, routers, 24 files) | Done | `src/core/db/schema.ts` rename verified in diff; `src/server/routers/driver.ts` replaces `harness.ts`; Grep for `harness\|Harness\|HARNESS` in `src/` returns 0 matches | — |
| `RecordEditor` primitive (types, RecordField, RecordActionsBar, RecordEditor) | Done | Files exist at `src/components/record-editor/` (types.ts, RecordField.tsx, RecordActionsBar.tsx, RecordEditor.tsx) | — |
| `Feature` enum + `hasFeature()` stub | Done | `src/core/features/features.ts` created; `src/__tests__/integration/features-primitive.test.ts` created | — |
| Driver descriptor + page | Done | `src/app/[org]/[user]/[project]/settings/drivers/{descriptor.ts,page.tsx}` present | — |
| Skill descriptor + page (rewrite) | Done | `src/app/[org]/[user]/[project]/settings/skills/{descriptor.ts,page.tsx}` present | — |
| Optimistic lock + `countReferences` + FK-safe delete (skill router) | Done | `src/server/routers/skill.ts` +100 lines; `createSkillService` has `updateWithVersion`, `deleteWithVersion`, `countReferences` | — |
| Nav Drivers link | Done | `src/components/nav.tsx` diff +2 lines | — |
| Terminology glossary seed | Done | `docs/terminology.md` + roadmap/invariants entries; "formerly known as" clarifier retained (per spec) | — |
| Six Playwright journeys with stories | Done | `e2e/*.spec.ts` (6 files) + `docs/journeys/*.md` (6 files + README) | — |
| Integration tests (driver-crud, skill-crud, features-primitive) | Done | All three files present in `src/__tests__/integration/` | — |
| Manual browser verification (success criterion #7) | Deferred-silent | PR #31 body and PR #32 body both show `- [ ] Manual browser verification` unchecked; roadmap entry at `docs/superpowers/roadmap.md:17` still marks R-UI-1 "Done" | Medium |

## R-UI-2 coverage table (Tasks 1–32)

| Plan task | Status | Evidence | Severity |
|---|---|---|---|
| Task 1 — Filter param on `subscribeToTable` | Done | `src/core/ports/realtime.ts:23` `filter?: string` added | — |
| Task 2 — `QueueWorker` return from `process()` + lockDuration | Done | `src/core/ports/queue.ts:27-29,42`; `src/adapters/bullmq/queue.ts:86-105` includes `lockDuration: 300_000`; mock queue updated | — |
| Task 3 — Failing Realtime adapter test | Done | `src/__tests__/integration/realtime-adapter.test.ts` created (commit `01207e6`) | — |
| Task 4 — Supabase Realtime adapter | Done | `src/adapters/supabase/realtime.ts` created | — |
| Task 5 — Realtime publication + gate-checked unique index migration (+ Task 5 v3 grants) | Done | `drizzle/0005_realtime_publication.sql` — publication DO block, `GRANT SELECT`, partial unique index all present | — |
| Task 6 — Server-side Supabase client factory | Done | `src/adapters/supabase/server-client.ts` created | — |
| Task 7 — RealtimeContext + `useRealtime()` | Done | `src/lib/realtime/{context.tsx,use-realtime.ts}` created | — |
| Task 8 — `useNow` hook | Done | `src/lib/realtime/use-now.ts` created | — |
| Task 9 — Mount provider in project-scoped layout | Done | `src/app/[org]/[user]/[project]/layout.tsx:2,12,19` | — |
| Task 10 — LiveOutput port migration + `setData` append + testid | Done | `src/components/pipeline/LiveOutput.tsx:13,112-113,172-197,311` | — |
| Task 11 — RunDetailModal port migration + useNow duration tick | Done | `src/components/pipeline/RunDetailModal.tsx:90-113,146-187` | — |
| Task 12 — Issue activity feed subscription + activity-item testid | Deferred-flagged | Handoff `docs/superpowers/handoffs/2026-04-17-r-ui-2-implementation-session-a-paused.md:14-22` explicitly flags pause "before Task 12"; `git log main..HEAD -- 'src/app/[org]/[user]/[project]/issues/[number]/client.tsx'` returns no commits | — |
| Task 13 — GateResultsPanel `rule.field` access fix | Deferred-flagged | Handoff line 260 lists "Task 13: GateResultsPanel - fix rule-field access" as remaining; no diff in `src/components/pipeline/GateResultsPanel.tsx` on branch | — |
| Tasks 14-18 — Orchestrator rewiring (StageJobPayload shrink, service helpers, stage-worker rewrite, re-entry guard, BullMQ dispatch + terminal-status handler, replace recoverOnStartup) | Deferred-flagged | Handoff lines 261-266 list Tasks 14-18 as "Remaining"; `git log main..HEAD -- src/core/orchestrator/event-orchestrator.ts` returns nothing | — |
| Tasks 19-20 — `main.ts` and `worker-main.ts` entrypoints | Deferred-flagged | `ls src/core/orchestrator/` shows no `main.ts` or `worker-main.ts` | — |
| Tasks 21-22 — Systemd unit templates + install script | Deferred-flagged | `ls scripts/` returns only `update-claude-commands.sh`; no `scripts/systemd/` | — |
| Task 23 — Docs (CLAUDE.md + session-quick-start orchestrator commands) | Deferred-flagged | Handoff line 267 lists Task 23; no diff to CLAUDE.md or session-quick-start.md on branch | — |
| Tasks 24-28 — Five `@r-ui-2` Playwright journeys | Deferred-flagged | Handoff lines 268-272; `ls e2e/` shows only the 6 `@r-ui-1` specs, none of the 5 R-UI-2 specs | — |
| Task 29 — Rewrite `orchestrator.test.ts` with Redis precondition + 3 branches | Deferred-flagged | Handoff line 273; only change to file on branch is `+2/-1` adding a stub `close` method to the mock queue (diff shows just the `process<T>(…)` signature tweak) | — |
| Task 30 — Full vitest run (verification only) | Deferred-flagged | Handoff line 274 | — |
| Task 31 — Adapter-boundary audit | Deferred-flagged | Handoff line 275 | — |
| Task 32 — Manual verification + roadmap update | Deferred-flagged | Handoff lines 9-10, 276: "Task 32 still requires explicit human manual-verification sign-off"; `docs/superpowers/roadmap.md:18` still "Plan ready" (correct). | — |

### AUDIT-PLAN-1: R-UI-1 roadmap marked "Done" without manual browser verification
- **Phase:** R-UI-1
- **Spec/plan reference:** R-UI-1 spec Success Definition item #7 ("User-driven browser verification of all six journeys confirms correct behavior"); plan Task 31 Step 5 ("Manual browser verification")
- **Status:** Deferred-silent
- **Severity:** Medium
- **Evidence:** PR #31 body: `- [ ] Manual browser verification of each journey on http://192.168.54.101:3003 with FLUXAOS_LAN_AUTH_BYPASS=1` (checkbox unchecked). PR #32 body: `- [ ] Manual browser verification` (checkbox unchecked). `docs/superpowers/roadmap.md:17`: `| R-UI-1 — Settings CRUD + harness→driver rename | **Done** | …`. Invariant 21: "No phase is complete without human verification. An agent saying 'this works' or 'tests pass' is not verification."
- **Direction:** Require the unchecked "Manual browser verification" box to be flipped (or a handoff note confirming the user performed it) before roadmap transitions a phase to "Done."

### AUDIT-PLAN-2: LAN auth bypass is scope-creep vs the R-UI-1 spec
- **Phase:** R-UI-1
- **Spec/plan reference:** R-UI-1 spec "Explicitly out of scope" list + Scope Decision section — no mention of authentication bypasses; plan Tasks 1–31 do not include an auth-middleware change
- **Status:** Scope-creep
- **Severity:** Medium
- **Evidence:** `src/lib/supabase/middleware.ts:58-79` adds `isLanAuthBypassEnabled()` returning `process.env.FLUXAOS_LAN_AUTH_BYPASS === '1'`; PR #31 commit `feat(auth): add LAN-CIDR dev auth bypass gated by FLUXAOS_LAN_AUTH_BYPASS` states "Enables Playwright journeys to run against the dev server without a seeded test user." Subsequent follow-up commit `fix(auth): simplify LAN bypass — remove spoofable header IP check` narrowed an initial CIDR check after code review flagged spoofability.
- **Direction:** Scope additions of this weight should be captured in the spec/plan or as a separate phase with their own review, not merged under a CRUD phase's umbrella.

### AUDIT-PLAN-3: R-UI-2 `@ts-expect-error` added in adapter without a tracked follow-up
- **Phase:** R-UI-2
- **Spec/plan reference:** R-UI-2 plan Task 4 (Step 1 adapter code). Invariant-adjacent concerns (fail-fast, typing discipline).
- **Status:** Done (plan-authorised) but type-suppression expanded
- **Severity:** Low
- **Evidence:** `src/adapters/supabase/realtime.ts:36`: `// @ts-expect-error supabase-js postgres_changes overloads are imprecise here.` — added by commit `fc98d35` exactly as the plan prescribed at plan line 351 (`// @ts-expect-error — supabase-js types for postgres_changes are imprecise`). It is the only type suppression added in R-UI-2's committed scope.
- **Direction:** The suppression matches the plan verbatim, but a note in `deferred-fixes.md` tracking "Supabase Realtime postgres_changes typing" would let the suppression be removed when upstream types improve.

### AUDIT-PLAN-4: Plan-level discrepancy — plan Task 9 File Map lists root `src/app/layout.tsx`, body then redirects to project-scoped layout
- **Phase:** R-UI-2
- **Spec/plan reference:** plan line 48 (`src/app/layout.tsx | Wrap children in RealtimeContextProvider.`) versus plan Task 9 body at line 671 ("NOT the root layout. `src/app/layout.tsx` is a pure Server Component…").
- **Status:** Missing (inconsistency within the plan itself — File Map not updated when the task body was corrected)
- **Severity:** Low
- **Evidence:** `docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md:48`: `| src/app/layout.tsx | Wrap children in RealtimeContextProvider. |`. Same file line 671: "**NOT the root layout.** `src/app/layout.tsx` is a pure Server Component … `RealtimeContextProvider` must be mounted there, inside `TRPCProvider`, so …". Implementation correctly followed the task body — `src/app/[org]/[user]/[project]/layout.tsx` got the provider (commit `4307b0e`). The File Map line is stale.
- **Direction:** Reconcile the File Map row with the corrected task body — the pattern will recur as the plan evolves; a single-source-of-truth file list avoids later confusion.

### AUDIT-PLAN-5: Plan self-review block claims 33 tasks vs handoff's 32 — mismatch is real but not trapped
- **Phase:** R-UI-2
- **Spec/plan reference:** handoff line 280 ("the actual plan has 33 task headings because of `Task 16b`"); plan numbering ends at Task 32 but inserts Task 16b mid-stream at plan line 1277.
- **Status:** Missing (plan's self-review claims 32 tasks; actually has 33 because of the insertion)
- **Severity:** Low
- **Evidence:** `docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md:1277`: `### Task 16b: Add re-entry guard to executeStageRun (v3 CRITICAL)`. Handoff at lines 278-280: "Plan-count note: the user handoff said 32 tasks, but the actual plan has 33 task headings because of `Task 16b`."
- **Direction:** Renumber or treat 16b consistently in any automated count so downstream tracking doesn't silently drift.

### AUDIT-PLAN-6: Plan Task 30 is declared "No commit — verification only" but Task 29 ships a commit that wasn't fully rewritten; verification gate never fires
- **Phase:** R-UI-2
- **Spec/plan reference:** plan Task 29 (unskip + rewrite with Redis precondition, three branches of `recoverOnStartup`); plan Task 30 (`npx vitest run`, "0 failures").
- **Status:** Deferred-flagged (handoff explicitly lists Task 29 as remaining work, line 273)
- **Severity:** Low (evidence-based; no self-certification claim)
- **Evidence:** The only R-UI-2 change to `src/__tests__/integration/orchestrator.test.ts` is a 3-line tweak to make the mock queue's `process()` return `{ close: async () => {} }` to satisfy the new `QueueWorker` interface (commit `55df983`). The test file's describe remains `describe.skip(...)` on line 20/311 of the base file (`git show 62de54c:src/__tests__/integration/orchestrator.test.ts` still has `TODO: adapt test for event-orchestrator (was written for polling manager)` and `describe.skip(...)` at both locations), and the branch's copy still has `// TODO: adapt tests for event-orchestrator (were written for polling manager)` per grep at `src/__tests__/integration/orchestrator.test.ts:20,319`. This is expected for a paused-after-Task-11 branch, but it is a TODO added-in-the-past-and-not-removed in the R-UI-2 branch's surface.
- **Direction:** When the branch resumes, Task 29's rewrite must eliminate both `describe.skip` blocks rather than only the signature tweak that was committed for Task 2.

### AUDIT-PLAN-7: R-UI-2 plan Task 31's Step 1 allow-list includes `src/adapters/supabase/auth.ts` implicitly but explicit allow-list in the plan omits test fixture allowance; nothing broken yet
- **Phase:** R-UI-2
- **Spec/plan reference:** plan Task 31 Step 1 allow-list (plan lines 2321-2332) vs current grep output.
- **Status:** Done (grep passes against the written allow-list) — noted for completeness only
- **Severity:** Low
- **Evidence:** Grep for `from '@supabase/supabase-js'|from '@supabase/ssr'|from '@supabase/realtime-js'` on the branch returns:
  - `src/lib/supabase/{client.ts,middleware.ts,server.ts}` — allowed
  - `src/__tests__/integration/realtime-adapter.test.ts` — allowed (test)
  - `src/adapters/supabase/{auth.ts,server-client.ts,realtime.ts}` — allowed
  Zero matches in `src/core/`, `src/components/`, or `src/app/`. Invariant 7 holds for the committed R-UI-2 surface.
- **Direction:** None — recorded as a pass with evidence (per audit instruction #4 "absence of findings is NOT a positive claim," this line is evidence of a completed mechanical check, not a positive claim about the phase).

## Phase 2 candidates (out-of-scope observations)

- `src/core/orchestrator/stage-worker.ts:90` and `:167` carry pre-existing `// TODO: parse from provider output` / `// TODO: Parse token counts from provider output`. These predate both audit surfaces (they exist on `main` at `62de54c`) and are not in either plan.
- `src/app/[org]/[user]/[project]/issues/[number]/client.tsx` is at 1019 lines per the handoff, exceeding invariant 10's ~500 line ceiling. This predates R-UI-2 but directly blocked the committed Task 12 attempt. Also out of R-UI-1's scope but flagged by the R-UI-2 session for the next session.

## Blocked

None.
