# Lane 4 — Doc-Skim Auditor — Raw Output

## Required-reading proof

- `docs/invariants.md` (line 65): "Max ~500 lines per file. Split into multiple files when approaching this limit."
- `docs/superpowers/specs/2026-04-07-fluxaos-spec-v2.md` (line 137): "**The rule:** If you find yourself typing a vendor name inside `core/`, you're doing it wrong."
- `docs/superpowers/specs/2026-04-09-rebuild-spec.md` (line 56): "**Zero vendor imports in `core/`.** The adapter registry is the only way to resolve implementations. Services receive dependencies via injection."
- `CLAUDE.md` (line 53): "**Edit, never Write** — never overwrite existing files; build missing endpoints instead of deleting UI"
- `docs/session-quick-start.md` (line 42): "Optimistic concurrency required on all mutable entities (`WHERE version = $expected`)"

## Mechanical-check output

### R-UI-1 commit messages (62de54c..5cdcc1b -- src/)

```
--- 6d1c14e fix: R-UI-1 code-review follow-ups (4 fixes, no deferrals) (#32) ---
- fix(auth): replace hardcoded userId with useCurrentUser hook
- fix(skill): wrap delete in transaction to close countReferences→delete race
- test(e2e): replace networkidle with deterministic waits in conflict-on-save
- fix(record-editor): disambiguate tags chip keys with index suffix

--- 5b12860 feat: R-UI-1 — settings CRUD + harness→driver rename (#31) ---
(squash of Session A + B + C work: schema rename, record-editor, Feature enum,
driver settings page, skills settings page rewrite, Drivers nav link,
terminology.md seed, 6 Playwright journeys, LAN-CIDR auth bypass,
pre-existing gates.test.ts flake fix, RecordEditor id/version strip)
```

### R-UI-2 commit messages (main..HEAD -- src/)

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
(All R-UI-2 commits have empty bodies.)

### PR bodies

- **PR #31** (R-UI-1 settings CRUD + rename): extensive summary, test plan checks `verify:seed`, `vitest`, Playwright `@r-ui-1`, grep-harness-clean. Unchecked: "Manual browser verification of each journey." Notes 3 tRPC 500s in dev log during journey runs as "expected."
- **PR #32** (post-merge follow-ups): 4 fixes (hardcoded userId, skill delete transaction, networkidle→deterministic, tags key). Unchecked: "Manual browser verification."
- **PR #33** (Session D handoff doc): "Handoff renders correctly on GitHub / All linked file paths resolve / Session C and Session D handoffs cross-reference correctly" — docs-only.

## Findings

### AUDIT-DOC-1: R-UI-1 adds three files >500 lines to a hook exemption list instead of splitting

- **Pattern:** contradicts-invariant
- **Severity:** High
- **Locus:** commit `5b12860`, and `/mnt/dev/fluxaos/.git/hooks/pre-commit` lines 31-43 (`SIZE_EXEMPT_FILES`) — `src/__tests__/integration/orchestrator.test.ts` grew 550→557; `src/__tests__/integration/gates.test.ts` (702); `src/core/db/seed.ts` (587 pre-existing but newly exempted).
- **Doc that was skipped:** `docs/invariants.md:65` (Invariant 10).
- **Evidence:**
  - Commit body in 5b12860: "Updates DEF-007 in deferred-fixes.md to record that the local pre-commit hook also exempts orchestrator.test.ts and seed.ts from the 500-line size check (both DEF-008 candidates if we later identify a clean split)."
  - Another 5b12860 commit body: "gates.test.ts also added to pre-commit SIZE_EXEMPT_FILES (701 lines, DEF-008 candidate)."
  - Invariant 10: "**Max ~500 lines per file.** Split into multiple files when approaching this limit."
- **Direction:** Split the three files or re-flag the deviation to the user per invariant 22 instead of carving out hook exemptions.

### AUDIT-DOC-2: R-UI-2 Task 12 pause — spec requirement met with a plan-deviation that was not flagged to the user before pause

- **Pattern:** undocumented-deviation
- **Severity:** High
- **Locus:** `feat/r-ui-2-impl` branch tip (`4345e3c`), handoff at `docs/superpowers/handoffs/2026-04-17-r-ui-2-implementation-session-a-paused.md:219-232`.
- **Doc that was skipped:** `docs/invariants.md:94-95` (Invariant 22: "Architecture deviations are flagged, not decided.").
- **Evidence:**
  - Handoff: "Pre-commit failed because the issue detail client is 1019 lines and the hook rejects files over 500 lines... The user pushed back that this felt over-engineered, which was a valid signal. We clarified the product surface but did not settle the implementation choice before pausing."
  - Invariant 22: "If an implementation choice differs from the spec or these invariants, stop and flag it to the user. Do not make the decision autonomously and move on."
- **Direction:** Before resuming Task 12, surface the file-size invariant conflict and the prepend-vs-append ordering question (both noted in the handoff) as explicit deviation decisions to the user.

### AUDIT-DOC-3: R-UI-2 plan file map directs mounting `RealtimeContextProvider` at `src/app/layout.tsx` contradicting the spec's project-scoped-layout instruction

- **Pattern:** contradicts-invariant (plan contradicts spec)
- **Severity:** Medium
- **Locus:** `docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md:48` vs `docs/superpowers/specs/2026-04-16-r-ui-2-design.md:460`. The shipped code (`src/app/[org]/[user]/[project]/layout.tsx`, commit `4307b0e`) follows the spec, not the plan.
- **Doc that was skipped:** `docs/superpowers/specs/2026-04-16-r-ui-2-design.md:460`.
- **Evidence:**
  - Plan: "| `src/app/layout.tsx` | Wrap children in `RealtimeContextProvider`. |"
  - Spec: "`src/app/[org]/[user]/[project]/layout.tsx` — NOT the root layout. The root `src/app/layout.tsx` is a Server Component (exports `metadata`) and has no client providers."
- **Direction:** Correct the plan's File Map row so future sessions don't follow the wrong file pointer.

### AUDIT-DOC-4: Shipped `useRealtime` error text tells callers to mount "at the App Router root" — the exact placement the R-UI-2 spec forbids

- **Pattern:** rename-without-doc-update (message drift)
- **Severity:** Low
- **Locus:** `src/lib/realtime/use-realtime.ts:11` (commit `ebccb0a`).
- **Doc that was skipped:** `docs/superpowers/specs/2026-04-16-r-ui-2-design.md:460`.
- **Evidence:**
  - Code: `'useRealtime() called outside <RealtimeContextProvider>. Mount the provider at the App Router root.'`
  - Spec: "`src/app/[org]/[user]/[project]/layout.tsx` — NOT the root layout."
- **Direction:** Update the thrown message to match the authoritative mount site.

### AUDIT-DOC-5: PR #31 "Notes" section accepts dev-server tRPC 500s during journey runs as expected behavior

- **Pattern:** contradicts-invariant
- **Severity:** Medium
- **Locus:** PR #31 body, "Notes" block.
- **Doc that was skipped:** `docs/invariants.md:63` (Invariant 9: fail fast, no silent degradation) and memory entry `feedback_no_failures.md` ("Zero Test Failures: Never ship with red tests").
- **Evidence:**
  - PR #31: "Three tRPC 500s in the dev-server log during journey runs are expected: two are optimistic-lock conflicts from the conflict-on-save journey, one is the FK-safe delete rejection from delete-a-referenced-skill-fails-gracefully."
  - Invariant 9: "If a required configuration is missing, the system fails fast with a clear error message... A misconfigured system crashes immediately — it does not silently do the wrong thing."
- **Direction:** Return these conflict/FK paths as structured 4xx errors (tRPC `CONFLICT`/`PRECONDITION_FAILED`) rather than 500s, so "5xx in the dev log" stops being the happy-path signal.

### AUDIT-DOC-6: Both R-UI-1 PR bodies mark manual browser verification as unchecked yet the roadmap is marked complete

- **Pattern:** contradicts-invariant
- **Severity:** High
- **Locus:** PR #31 body test plan; PR #32 body test plan; commit `5b12860` sub-commit `docs: mark R-UI-1 complete in roadmap`.
- **Doc that was skipped:** `docs/invariants.md:93` (Invariant 21: "No phase is complete without human verification.") and user memory `feedback_no_self_certification.md`.
- **Evidence:**
  - PR #31 Test plan: "- [ ] Manual browser verification of each journey on `http://192.168.54.101:3003` with `FLUXAOS_LAN_AUTH_BYPASS=1`"
  - PR #32 Test plan: "- [ ] Manual browser verification"
  - Invariant 21: "An agent saying 'this works' or 'tests pass' is not verification. The user must see the result in a running browser or confirm via API output. Self-certification is explicitly forbidden."
- **Direction:** Don't flip roadmap status to complete until the browser-verification checkbox in the PR body is ticked by the user.

### AUDIT-DOC-7: R-UI-1 touched `stage-runner.ts` but left a silent fallback `?? { instructionsFile: 'CLAUDE.md', contextFile: 'context.md' }` — even though the R-UI-1 design promised driver `contextLayout` drives this

- **Pattern:** contradicts-invariant
- **Severity:** Medium
- **Locus:** `src/core/orchestrator/stage-runner.ts:179-183` (commit `5b128608` edits adjacent lines 179-180 but leaves the `??` fallback intact).
- **Doc that was skipped:** `docs/invariants.md:63` (Invariant 9) and R-UI-1 design spec line 388.
- **Evidence:**
  - Code (stage-runner.ts:179-183): `// Read contextLayout from driver config\nconst contextLayout = (driverRow.contextLayout as ...) ?? { instructionsFile: 'CLAUDE.md', contextFile: 'context.md' };`
  - R-UI-1 design spec: "stage-runner consumes `contextLayout` to decide the instructions-file name, e.g. `CLAUDE.md` vs `AGENTS.md`. Omitting them from the UI silently locks those values at seed-time."
  - Invariant 9: "No fallback defaults. No silent degradation."
- **Direction:** Drop the `??` fallback and throw on a missing/malformed `driverRow.contextLayout` — config-driven per invariant 9.

### AUDIT-DOC-8: R-UI-2 plan Task 18 body (in commits it references) and Task 12 attempted implementation rely on prepending incoming rows while the service returns ascending by timestamp — product ordering decision unresolved

- **Pattern:** asks-answered-question
- **Severity:** Low
- **Locus:** Handoff doc lines 236 and 353-356 ("Row order: existing events are ordered ascending, but the plan prepends realtime rows. Verify intended order.").
- **Doc that was skipped:** R-UI-2 design spec §"Three subscription-site changes" (item 3) — the spec already states the semantics: the handler "appends to the existing `issue.event.list` query cache."
- **Evidence:**
  - Handoff: "`createIssueEventService.list()` orders events ascending by timestamp, but the plan snippet prepends realtime rows with `[row, ...old]`. Check whether new rows should append instead to preserve current order."
  - Spec line 237: "Handler appends to the existing `issue.event.list` query cache keyed by the current filter selection."
- **Direction:** Use append (`[...old, row]`), matching the spec, and fix the plan snippet to stop contradicting itself.

## Phase 2 candidates (out-of-scope observations)

- The R-UI-1 commit `5b12860` includes a sub-commit titled `fix(auth): simplify LAN bypass — remove spoofable header IP check`. The bypass exists in `src/lib/supabase/middleware.ts`, gated on `FLUXAOS_LAN_AUTH_BYPASS=1`. Security review (not doc-skim) should verify prod cannot accidentally set this env var.
- `src/core/services/skill.ts:15` introduces `type DbOrTx = Parameters<Parameters<Database['transaction']>[0]>[0] | Database;` and casts with `createCrudService<...>(db as Database, ...)`. The cast papers over a genuine generic-variance problem in the CRUD factory. Candidate for DRY-factory audit lane.
- R-UI-2 uses `@ts-expect-error` in `src/adapters/supabase/realtime.ts` around `postgres_changes` event name (per plan Task 4). Not doc-skim, but tight-coupling to imprecise SDK types should be re-reviewed if SDK version bumps.
- `schema.ts` is 1076 lines and has a standing invariant-10 exemption that predates R-UI-1. Out of this audit's scope but a standing debt.

## Blocked

None. All required docs read; all mechanical checks completed.
