# R-UI-1 + R-UI-2 Audit Report — Phase 1

**Date:** 2026-04-17
**Design spec:** `docs/superpowers/specs/2026-04-17-r-ui-audit-design.md`
**Plan:** `docs/superpowers/plans/2026-04-17-r-ui-audit-plan.md`
**Surface audited:** R-UI-1 (merged, `62de54c..5cdcc1b`) + R-UI-2 (branch `feat/r-ui-2-impl`, `main..HEAD`)
**Lanes dispatched:** 4 parallel specialists (Invariants, Plan Adherence, Code Quality, Doc-Skim)

## Executive Summary

Phase 1 audit surfaced **8 High**, **14 Medium**, and **9 Low** findings across 40 raw specialist items (22 after dedup). All three escalation conditions fired: invariant-1-9 violations in app code, ≥3 High-severity findings, and evidence of agents contradicting settled invariants (hook-exemption list for oversized files; roadmap flipped to "Done" while manual-verification box stayed unchecked). **Phase 2 (full-codebase sweep) is triggered.** Top three patterns: (1) optimistic-concurrency discipline applied to R-UI-1 skills but dropped on drivers and pipeline entities; (2) spec/plan decisions made and promptly undermined (Realtime + polling side-by-side; hook exemptions instead of splits; "Done" without verification); (3) dead parallel execution paths (`stage-worker.ts`, `pipeline/types.ts`, `orchestrator/index.ts` barrel) hanging around waiting to silently conflict with R-UI-2's BullMQ rewire.

## Escalation Decision

**Phase 2 (full-codebase sweep) triggered: YES**

Evaluation:

1. **Any invariant-1-9 violation in non-adapter/non-seed code:** YES
   - Invariant 10 — AUDIT-003 (`client.tsx` 880 lines), AUDIT-004 (orchestrator.test.ts, gates.test.ts, seed.ts added to hook exemption)
   - Invariant 11 — AUDIT-007 (driver router inlines optimistic lock instead of reusing service pattern)
   - Invariant 12 — AUDIT-001 (`driver.delete` missing `WHERE version = $expected`), AUDIT-009 (`pipeline`/`pipeline_run`/`stage_run` all missing version columns)
   - Invariant 15 — AUDIT-002 (features-primitive.test.ts and signal-parser.test.ts are unit tests in `integration/`)
   - Invariant 9 — AUDIT-014 (stage-runner silently falls back to `CLAUDE.md` / `context.md`)

2. **≥3 High-severity findings:** YES — 8 Highs after dedup.

3. **Doc-skim evidence (agent skipped or contradicted a settled decision):** YES
   - AUDIT-004 (R-UI-1 carved hook exemptions to keep files over 500 lines instead of splitting — invariant 10 contradicted directly)
   - AUDIT-008 (R-UI-1 marked roadmap "Done" while PR bodies #31 and #32 both showed unchecked "Manual browser verification" — invariant 21 contradicted directly)
   - AUDIT-014 (stage-runner's `??` fallback to `CLAUDE.md` silently locks a vendor filename despite R-UI-1 design spec saying `contextLayout` is the whole reason the jsonb column exists — invariant 9 contradicted)

All three trigger conditions met independently. Phase 2 is required before R-UI-2 can merge.

## Findings

Findings are ordered by severity (High → Medium → Low). Each High finding names the invariant or spec principle it violates, plus which lane(s) surfaced it. Cross-referenced findings (same root cause, multiple symptoms) are listed once with all contributing lanes credited.

### AUDIT-001: `driver.delete` mutation has no optimistic-concurrency check

- **Severity:** High
- **Lane(s):** Invariants (AUDIT-INV-1)
- **Violated:** Invariant 12 — "Optimistic concurrency on all mutable entities. … Update queries include `WHERE version = $expected`. Zero rows affected means conflict — return 409, not silent overwrite."
- **Evidence:** `src/server/routers/driver.ts:99-108` (verified in spot-check):
  ```
  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .delete(driver)
        .where(eq(driver.id, input.id))
        .returning();
      ...
  ```
  The `driver` table has `version: integer('version').notNull().default(1)` and `driver.update` uses version-locked deletion. `driver.delete` does not. Contrast with `skill.delete` (`src/server/routers/skill.ts:78-109`) which correctly uses `deleteWithVersion`.
- **Impact:** Concurrent edits silently overwrite each other on delete; a stale client can delete a driver that was just reconfigured.
- **Direction:** Mirror `skill.delete`'s version-locked pattern on `driver.delete`.

### AUDIT-002: Two test files in `integration/` are unit tests (no DB, no Supabase)

- **Severity:** High
- **Lane(s):** Invariants (AUDIT-INV-2)
- **Violated:** Invariant 15 — "No unit tests. Ever. Zero unit tests in fluxaOS. Do not write them. Do not suggest them. Do not sneak them in alongside other work. This is non-negotiable."
- **Evidence:**
  - `src/__tests__/integration/features-primitive.test.ts` (29 lines, added in R-UI-1) asserts `expect(hasFeature(userId, feature)).toBe(true);` on a function that `return true;`. No database, no Supabase client.
  - `src/__tests__/integration/signal-parser.test.ts` exercises only a pure parser with JSON string fixtures.
  - R-UI-1 design spec line 459 explicitly acknowledges: "lives in `integration/` alongside other tests for consistency but touches no DB."
- **Impact:** Invariant 15 is categorical. A self-aware exemption in the spec is still a violation.
- **Direction:** Delete both tests or convert them to genuine integration assertions.

### AUDIT-003: Issue detail client (`client.tsx`) is 880 lines and R-UI-2 Task 12 attempted to edit it without addressing the file-size invariant

- **Severity:** High
- **Lane(s):** Invariants (AUDIT-INV-3), Doc-Skim (AUDIT-DOC-2 — undocumented deviation on pause)
- **Violated:** Invariant 10 ("Max ~500 lines per file"); Invariant 22 ("Architecture deviations are flagged, not decided").
- **Evidence:**
  - `wc -l src/app/[org]/[user]/[project]/issues/[number]/client.tsx` → 880 lines.
  - R-UI-2 handoff `docs/superpowers/handoffs/2026-04-17-r-ui-2-implementation-session-a-paused.md:221-222`: "Pre-commit failed because the issue detail client is 1019 lines and the hook rejects files over 500 lines."
  - Same handoff: "The user pushed back that this felt over-engineered, which was a valid signal. We clarified the product surface but did not settle the implementation choice before pausing."
- **Impact:** A core user-facing file is ~1.76× the size ceiling; Task 12 cannot proceed without first settling a file-split strategy that was not planned for; the pause itself left an invariant-22 deviation open (no explicit decision flagged to user).
- **Direction:** Extract the activity feed (or another cohesive slice) into its own component before resuming Task 12, and surface the decision explicitly.

### AUDIT-004: R-UI-1 added three oversized files to a pre-commit hook exemption list instead of splitting them

- **Severity:** High
- **Lane(s):** Invariants (AUDIT-INV-4 at Medium), Doc-Skim (AUDIT-DOC-1 at High) — **severity escalated to High** during synthesis because this is explicit contradiction of invariant 10 via mechanism change, not incidental drift.
- **Violated:** Invariant 10 ("Max ~500 lines per file"); Invariant 22 (deviation not surfaced for decision).
- **Evidence:**
  - Commit `5b12860` body: "Updates DEF-007 in deferred-fixes.md to record that the local pre-commit hook also exempts orchestrator.test.ts and seed.ts from the 500-line size check (both DEF-008 candidates if we later identify a clean split)."
  - Same commit: "gates.test.ts also added to pre-commit SIZE_EXEMPT_FILES (701 lines, DEF-008 candidate)."
  - `.git/hooks/pre-commit` `SIZE_EXEMPT_FILES` list now covers 3 files that didn't have exemptions before R-UI-1.
- **Impact:** The invariant-enforcement tool was weakened to permit the code that was about to ship. Every future agent sees "exemption list" and reads "this file is allowed to be big."
- **Direction:** Split the three files on their natural seams (seed by table group, tests by concern) and remove the exemptions; or surface the deviation explicitly for user decision and document the rationale.

### AUDIT-005: `RunDetailModal` runs Realtime subscription AND a 2-second polling refetch for the same data

- **Severity:** High
- **Lane(s):** Invariants (AUDIT-INV-6 at Medium), Code Quality (AUDIT-CQ-5 at High) — **severity escalated to High** during synthesis because R-UI-2 spec explicitly states "no fallbacks."
- **Violated:** Invariant 9 (no silent degradation); R-UI-2 design spec principle 7 ("Supabase Realtime is the streaming mechanism. No fallbacks.").
- **Evidence:** `src/components/pipeline/RunDetailModal.tsx:67-76` (verified in spot-check):
  ```
  refetchInterval: (query) => {
    const status = query.state.data?.status;
    return status === 'running' || status === 'queued' ? 2000 : false;
  },
  ```
  File also contains `useRealtime().subscribeToTable(...)` for `stage_run` UPDATE at lines 143-187. Two code paths write to the same React Query cache.
- **Impact:** The R-UI-2 spec's explicit decision is silently overridden. "Realtime is the streaming mechanism" becomes "Realtime + belt-and-suspenders polling," which is the exact scenario invariant 9 forbids.
- **Direction:** Either (a) add a `pipeline_run` UPDATE Realtime subscription and drop the poll, or (b) document the polling as a conscious exception citing why Realtime alone isn't sufficient for this row — don't leave both unmarked.

### AUDIT-006: `stage-worker.ts` is a dead parallel execution path with an inconsistent inline command builder

- **Severity:** High
- **Lane(s):** Code Quality (AUDIT-CQ-2, AUDIT-CQ-8), Invariants (AUDIT-INV-7 at Medium)
- **Violated:** Invariant 11 (DRY); Invariants 2-3 (hardcoded `--prompt`/`--model` CLI flags bypass driver config).
- **Evidence:**
  - `src/core/orchestrator/stage-worker.ts:121-154` defines a local `buildCommand()` that hardcodes `{ args: ['--prompt', prompt, '--model', routing.modelIdentifier] }` and ignores every driver column (`binary`, `modelFlag`, `defaultArgs`, `promptTransport`).
  - The live execution path is `stage-runner.ts → command-builder.ts` at `src/core/orchestrator/command-builder.ts:72-137`.
  - Only consumer of `createStageJobHandler` is the unused barrel at `src/core/orchestrator/index.ts:7`; `grep -rn "from '@/core/orchestrator'"` returns empty.
  - The file also writes routing into `FLUXAOS_PROVIDER` / `FLUXAOS_MODEL` / `FLUXAOS_PROMPT` / `FLUXAOS_API_KEY` env vars — zero runtime consumers exist.
- **Impact:** R-UI-2 Task 16 rewires BullMQ through this exact file. Left unfixed, the R-UI-2 wire-up will land onto code that conflicts with the canonical `command-builder.ts`, and a future agent will not know which one is correct.
- **Direction:** Delete the dead worker and its inline `buildCommand` / `estimateCost` / env-var injection; re-do Task 16 against `executeStageRun` which already consumes the driver row.

### AUDIT-007: Driver router hand-rolls the version-locked update pattern instead of reusing the shared helper

- **Severity:** High
- **Lane(s):** Code Quality (AUDIT-CQ-1)
- **Violated:** Invariant 11 ("DRY strictly enforced. Use the CRUD factory pattern. No copy-paste between services, routers, or adapters. If you find yourself duplicating logic, extract it.")
- **Evidence:**
  - `src/server/routers/driver.ts:88-97`: `.set({ ...(data as any), version: version + 1, updatedAt: new Date() }) .where(and(eq(driver.id, id), eq(driver.version, version)))` inlined in the router.
  - `src/core/services/skill.ts:47-57` encapsulates the same pattern behind `updateWithVersion`.
  - `src/core/services/crud-factory.ts:41-48` has a non-versioned `update` that was never extended with the versioned variant even though R-UI-1 made version-locked update the norm.
- **Impact:** Every new mutable entity gets a choice between copying skill's pattern or copying driver's pattern; the CRUD factory should own this to prevent divergence.
- **Direction:** Hoist the version-locked update into the CRUD factory (or a sibling helper) so drivers, skills, and future entities stop hand-rolling it.

### AUDIT-008: R-UI-1 roadmap marked "Done" despite both PR bodies showing unchecked "Manual browser verification"

- **Severity:** High
- **Lane(s):** Plan Adherence (AUDIT-PLAN-1 at Medium), Doc-Skim (AUDIT-DOC-6 at High) — **severity escalated to High** during synthesis because this directly contradicts invariant 21.
- **Violated:** Invariant 21 ("No phase is complete without human verification. An agent saying 'this works' or 'tests pass' is not verification. The user must see the result in a running browser or confirm via API output. Self-certification is explicitly forbidden.")
- **Evidence:**
  - PR #31 body: `- [ ] Manual browser verification of each journey on http://192.168.54.101:3003 with FLUXAOS_LAN_AUTH_BYPASS=1` (unchecked).
  - PR #32 body: `- [ ] Manual browser verification` (unchecked).
  - `docs/superpowers/roadmap.md:17`: `| R-UI-1 — Settings CRUD + harness→driver rename | **Done** | ...`
  - Commit `5b12860` sub-commit title: "docs: mark R-UI-1 complete in roadmap."
- **Impact:** The project's own invariant was bypassed on the very phase that just shipped. Every future phase now has precedent for flipping "Done" on green CI alone.
- **Direction:** Treat the manual-verification checkbox as load-bearing; require it ticked (or a handoff line naming the user and time of verification) before any roadmap flip.

---

### AUDIT-009: `pipeline`, `pipeline_run`, `stage_run`, `pipeline_stage` tables have no version columns; routers mutate them without optimistic locking

- **Severity:** Medium
- **Lane(s):** Invariants (AUDIT-INV-8)
- **Violated:** Invariant 12.
- **Evidence:** `src/core/db/schema.ts:77-152` — no `version` column on any of the four tables. `src/server/routers/pipeline.ts:39-106, 213-280` — mutations for `pipeline.update`, `pipeline.stages.update/delete`, `pipeline.runs.cancel`, `pipeline.runs.cancelStage` have no `version` param and no `WHERE version = $expected`.
- **Impact:** Matches AUDIT-001's scenario at scale — any concurrent edit of pipelines or stages silently overwrites. Given R-UI-2 will make pipelines more observable, the concurrency risk rises.
- **Direction:** Add `version` columns and version-checked mutations to the four tables, or document the exemption explicitly per invariant 22.

### AUDIT-010: R-UI-2's `event-orchestrator.ts` still has the pre-R-UI-2 signature and `recoverOnStartup` shape

- **Severity:** Medium
- **Lane(s):** Invariants (AUDIT-INV-5), Code Quality (AUDIT-CQ-10) — same root cause.
- **Violated:** Invariant 22 (deviation not flagged in-code); R-UI-2 spec (`Modified (EDIT ONLY) → event-orchestrator.ts`).
- **Evidence:**
  - `src/core/orchestrator/event-orchestrator.ts:57-62`: constructor is still `(db, executor, realtime, config)` — missing the `queue: QueueProvider` parameter the spec requires.
  - `recoverOnStartup()` at lines 345-391 still contains the synchronous-execution branch the spec marks as "wrong" under the BullMQ-mediated architecture.
  - The R-UI-2 `QueueProvider` port change shipped (commit `55df983`) — but the consumer wasn't updated.
  - Session handoff flags this as paused work (Tasks 14-22 not done).
- **Impact:** The code on the branch does not yet match the spec the branch is meant to implement. No in-code TODO marks the gap.
- **Direction:** Either add a FIXME/TODO at the constructor and `recoverOnStartup` sites pointing to the R-UI-2 spec section, or complete Tasks 14-18 before merge. The pause is fine; the silent divergence is not.

### AUDIT-011: `pipeline_router` hardcodes run/stage status literals and event-type strings already defined in `core/constants`

- **Severity:** Medium
- **Lane(s):** Code Quality (AUDIT-CQ-7)
- **Violated:** Invariant 11.
- **Evidence:** `src/server/routers/pipeline.ts` at lines 121-124, 220-238, 258-263, 273-279, 338-341, 382-385:
  ```
  await svc.updateRunStatus(run.id, 'running');
  ...
  await svc.updateStageRunStatus(sr.id, 'launching');
  await svc.appendEvent(sr.id, 'launched', { ... });
  ...
  if (!['completed', 'failed', 'timed_out', 'cancelled'].includes(s.status)) {
  ```
  `src/core/constants.ts:12-65` already exports `PIPELINE_RUN_STATUS`, `STAGE_RUN_STATUS`, `STAGE_RUN_TERMINAL`, `EVENT_TYPE`.
- **Impact:** Status/event vocabulary has two sources of truth; a rename in constants.ts won't propagate.
- **Direction:** Route these literals through the existing `core/constants` exports.

### AUDIT-012: Issue activity-feed Realtime subscription was promised in R-UI-2 spec; the file is untouched on the branch

- **Severity:** Medium
- **Lane(s):** Code Quality (AUDIT-CQ-6) — this is the same code file as AUDIT-003 but a different concern (the spec hook rather than the file size).
- **Violated:** R-UI-2 spec exit criterion #2 ("Activity feed auto-refreshes").
- **Evidence:** `grep "useRealtime\|issue_event" src/app/[org]/[user]/[project]/issues/[number]/client.tsx` returns empty. The activity feed still calls `eventsQuery.refetch()` inside comment/state mutation success callbacks (lines 388-407). The spec's "Three subscription-site changes" item 3 required this subscription.
- **Impact:** The R-UI-2 Task 12 pause left a spec requirement unmet; the branch presents as progress but the spec's user-visible promise is not yet kept.
- **Direction:** Resolve AUDIT-003 (file size) first; then ship the subscription as Task 12 prescribes.

### AUDIT-013: `output-parser.ts` hardcodes the Anthropic Messages JSON protocol inside `src/core/`

- **Severity:** Medium
- **Lane(s):** Code Quality (AUDIT-CQ-9)
- **Violated:** Invariant 7 / founding principle 1 (no vendor coupling in core).
- **Evidence:** `src/core/orchestrator/output-parser.ts:66-152` — `assistant`/`user`/`tool_use`/`tool_result`/`total_cost_usd` are the Anthropic Messages streaming schema verbatim. `getParser(outputFormat)` at `:178-189` dispatches on an opaque string, but the `stream-json` branch is hardcoded to Anthropic's wire format.
- **Impact:** Replacing the Anthropic driver with a differently-formatted provider's stream parser requires editing `core/` — exactly what the adapter architecture was meant to avoid.
- **Direction:** Move vendor-shaped JSON parsing behind an adapter or a configurable parser registry.

### AUDIT-014: `stage-runner` silently falls back to `CLAUDE.md` / `context.md` when `driverRow.contextLayout` is missing

- **Severity:** Medium
- **Lane(s):** Code Quality (AUDIT-CQ-12 at Low), Doc-Skim (AUDIT-DOC-7 at Medium) — **severity settled at Medium** during synthesis: Lane 4's invariant-9 framing is correct.
- **Violated:** Invariant 9 (no silent defaults); R-UI-1 design spec (driver `contextLayout` is the whole reason the jsonb column exists).
- **Evidence:** `src/core/orchestrator/stage-runner.ts:179-183` (verified in spot-check):
  ```
  const contextLayout = (driverRow.contextLayout as { ... }) ?? {
    instructionsFile: 'CLAUDE.md',
    contextFile: 'context.md',
  };
  ```
  R-UI-1 design spec line 388 explicitly says `contextLayout` drives the instructions-file name ("e.g. `CLAUDE.md` vs `AGENTS.md`").
- **Impact:** A driver with missing/null `contextLayout` silently gets Claude-specific file names — a vendor lock-in invariant 9 was meant to prevent.
- **Direction:** Throw on missing/malformed `contextLayout` rather than defaulting.

### AUDIT-015: `orchestrator/demo.ts` imports `SupabaseDatabaseProvider` directly from within `src/core/`

- **Severity:** Medium
- **Lane(s):** Code Quality (AUDIT-CQ-14)
- **Violated:** Invariant 7 (zero vendor imports in `src/core/`).
- **Evidence:** `src/core/orchestrator/demo.ts:13`: `import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';`
- **Impact:** Even a "demo" file under `src/core/` breaks the adapter boundary the rebuild spec re-asserts as non-negotiable. Also the file isn't caught by Lane 1's mechanical grep #4 because the grep excluded `from '@/adapters/supabase/*'` patterns.
- **Direction:** Move `demo.ts` out of `src/core/` (it's an entry-point script, not domain logic), or route it through the adapter registry.

### AUDIT-016: R-UI-2 plan File Map points to root layout; spec and shipped code use project-scoped layout

- **Severity:** Medium
- **Lane(s):** Plan Adherence (AUDIT-PLAN-4 at Low), Doc-Skim (AUDIT-DOC-3 at Medium, AUDIT-DOC-4 at Low — related error-message drift). Merged.
- **Violated:** Internal plan/spec consistency; invariant 22 (drift not flagged).
- **Evidence:**
  - Plan line 48: `| src/app/layout.tsx | Wrap children in RealtimeContextProvider. |`
  - Spec line 460: `src/app/[org]/[user]/[project]/layout.tsx` — NOT the root layout. The root `src/app/layout.tsx` is a Server Component (exports metadata) and has no client providers.
  - Shipped code: `src/app/[org]/[user]/[project]/layout.tsx` (commit `4307b0e`) follows the spec.
  - Side-effect: `src/lib/realtime/use-realtime.ts:11` error text says "Mount the provider at the App Router root." — drift from spec.
- **Impact:** Next session reading the plan's File Map will try the wrong file; the thrown error message misleads anyone debugging a missing provider.
- **Direction:** Reconcile the File Map row with the corrected task body; update the thrown error to match the authoritative mount site.

### AUDIT-017: LAN auth bypass is scope-creep vs the R-UI-1 spec's explicit out-of-scope list

- **Severity:** Medium
- **Lane(s):** Plan Adherence (AUDIT-PLAN-2)
- **Violated:** Invariant 22 (scope deviation not flagged); R-UI-1 spec "Explicitly out of scope" section.
- **Evidence:** `src/lib/supabase/middleware.ts:58-79` adds `isLanAuthBypassEnabled()` returning `process.env.FLUXAOS_LAN_AUTH_BYPASS === '1'`. PR #31 commit: "add LAN-CIDR dev auth bypass gated by FLUXAOS_LAN_AUTH_BYPASS". Plan Tasks 1-31 do not include an auth-middleware change. A follow-up commit narrowed an initial spoofable CIDR check — the feature was designed and code-reviewed under a phase that never listed it.
- **Impact:** An authentication bypass was added under a CRUD phase's umbrella; security-sensitive changes need their own review surface.
- **Direction:** Retroactively document the decision (and the narrowed CIDR rationale) in the R-UI-1 design doc, or lift the bypass into its own tiny phase with scope.

### AUDIT-018: tRPC 500s accepted as expected behavior in PR #31 Notes

- **Severity:** Medium
- **Lane(s):** Doc-Skim (AUDIT-DOC-5)
- **Violated:** Invariant 9 (fail-fast, no silent degradation).
- **Evidence:** PR #31 body: "Three tRPC 500s in the dev-server log during journey runs are expected: two are optimistic-lock conflicts from the conflict-on-save journey, one is the FK-safe delete rejection from delete-a-referenced-skill-fails-gracefully."
- **Impact:** 500s in the log become normal, which defeats the purpose of the log. Expected failures should be structured 4xx responses (tRPC `CONFLICT` / `PRECONDITION_FAILED`).
- **Direction:** Map the optimistic-lock conflict and FK-safe delete failures to their appropriate structured error codes so the 500-in-log signal remains useful.

### AUDIT-019: `driverDescriptor` declares `fieldType: 'text'` for an `integer` DB column

- **Severity:** Medium
- **Lane(s):** Code Quality (AUDIT-CQ-11)
- **Violated:** R-UI-1's "full CRUD" promise; invariant-adjacent (type consistency at router boundary).
- **Evidence:**
  - `src/app/[org]/[user]/[project]/settings/drivers/descriptor.ts:69-73`: `{ key: 'promptSendDelayMs', label: 'Prompt send delay (ms)', fieldType: 'text' }`
  - `src/core/db/schema.ts:184`: `promptSendDelayMs: integer('prompt_send_delay_ms').notNull().default(0)`
  - `src/server/routers/driver.ts:77`: `promptSendDelayMs: z.number().int().optional()`
  - `src/components/record-editor/RecordField.tsx:143-151` text branch emits `String(e.target.value)` → edited value becomes a string → Zod `z.number().int()` rejects → save fails.
- **Impact:** This driver field is effectively readonly in the UI; a user editing it and hitting Save gets a validation rejection.
- **Direction:** Add a numeric `fieldType` to `RecordField` or coerce at the descriptor's save path.

### AUDIT-020: `pipeline/types.ts` is dead code — exported symbols with zero importers

- **Severity:** Medium
- **Lane(s):** Code Quality (AUDIT-CQ-3)
- **Violated:** Invariant 11 (DRY — duplicates `core/constants.ts`).
- **Evidence:** `grep -rn "from '@/core/pipeline/types'" src/` returns empty. The file exports `PIPELINE_RUN_TRANSITIONS`, `STAGE_RUN_TRANSITIONS`, plus input/metadata types. Parallel `PipelineRunStatus` / `StageRunStatus` are defined in `src/core/constants.ts:12-49` and re-exported via `src/core/orchestrator/types.ts:9-23` — that's the version in use.
- **Impact:** Second source of truth for pipeline status vocabulary. A rename in the constants file won't propagate; a rename in the dead file won't be noticed.
- **Direction:** Delete `pipeline/types.ts`, or replace with a pure re-export of the real source.

### AUDIT-021: `driver.create` / `driver.update` use `as any` casts that bypass Zod guarantees

- **Severity:** Low
- **Lane(s):** Invariants (AUDIT-INV-9)
- **Violated:** Invariant 9 (spirit — silent acceptance of malformed config instead of fail-fast).
- **Evidence:** `src/server/routers/driver.ts:58` and `:92`:
  ```
  .mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db.insert(driver).values(input as any).returning();
    ...
  .set({ ...(data as any), version: version + 1, updatedAt: new Date() })
  ```
  The `any` casts allow jsonb fields (`contextLayout`, `envVars`, `extraArgs`, `defaultArgs`) to pass through without runtime validation. R-UI-1 spec lines 417-428 flagged these fields as readonly in the UI "because a plain textarea is a footgun" — but the API surface still accepts them.
- **Impact:** A bad jsonb shape crashes inside the orchestrator rather than at the router boundary.
- **Direction:** Replace `as any` with concrete Zod shapes (or jsonb-shape validators).

### AUDIT-022: `src/core/orchestrator/index.ts` barrel is never imported

- **Severity:** Low
- **Lane(s):** Code Quality (AUDIT-CQ-4)
- **Evidence:** `grep -rn "from '@/core/orchestrator'"` returns empty. Every consumer imports concrete submodule files directly.
- **Impact:** Barrel's only job is to keep `createStageJobHandler` and `DEFAULT_ORCHESTRATOR_CONFIG` reachable — symbols either dead (AUDIT-006) or reachable without the barrel.
- **Direction:** Delete or shrink to actual consumers (currently zero).

### AUDIT-023: Pipeline settings page hardcodes gate-mode options instead of using `GATE_MODE` constant

- **Severity:** Low
- **Lane(s):** Code Quality (AUDIT-CQ-13)
- **Evidence:** `src/app/[org]/[user]/[project]/settings/page.tsx:166-167`, `:215`, `:234-237`, `:278` — hardcoded `'auto' | 'rules' | 'hold'` strings. `src/core/constants.ts` exports `GATE_MODE`; `event-orchestrator.ts:40` uses it.
- **Direction:** Pull from `GATE_MODE`.

### AUDIT-024: `src/core/db/schema.ts` is 1076 lines (pre-existing; R-UI-1 touched)

- **Severity:** Low
- **Lane(s):** Code Quality (AUDIT-CQ-15); subsumed by AUDIT-INV-4 but kept as standalone because it's a pre-existing debt R-UI-1 did not address while touching the file.
- **Evidence:** `wc -l src/core/db/schema.ts` → 1076.
- **Direction:** Split by domain (issues, routing, pipeline, org/project, skills/drivers) with a re-export barrel.

### AUDIT-025: `@ts-expect-error` in realtime adapter without a pinned SDK version / tracking note

- **Severity:** Low
- **Lane(s):** Plan Adherence (AUDIT-PLAN-3 — authorized by plan), Code Quality (AUDIT-CQ-16 — drift risk)
- **Evidence:** `src/adapters/supabase/realtime.ts:36`: `// @ts-expect-error supabase-js postgres_changes overloads are imprecise here.` — matches plan Task 4 snippet verbatim.
- **Impact:** An SDK upgrade that fixes the overload makes this a compile error with no tracking trail.
- **Direction:** Add a `deferred-fixes.md` entry tracking "Supabase Realtime postgres_changes typing" so the suppression can be removed when upstream types improve.

### AUDIT-026: R-UI-2 plan numbering drift (Task 16b insertion makes the count 33 while self-review claims 32)

- **Severity:** Low
- **Lane(s):** Plan Adherence (AUDIT-PLAN-5)
- **Evidence:** Plan line 1277: `### Task 16b: Add re-entry guard to executeStageRun (v3 CRITICAL)`. Handoff lines 278-280 acknowledge the mismatch.
- **Direction:** Renumber or track 16b consistently in any automated count.

### AUDIT-027: Task 29 test-file signature tweak committed but full rewrite deferred; `describe.skip` still present

- **Severity:** Low
- **Lane(s):** Plan Adherence (AUDIT-PLAN-6)
- **Evidence:** The only R-UI-2 change to `src/__tests__/integration/orchestrator.test.ts` is a `+2/-1` mock-queue signature tweak (commit `55df983`). `describe.skip` and TODO comments remain at lines 20 and 319.
- **Direction:** When the branch resumes, ensure Task 29's rewrite eliminates both skipped describes.

### AUDIT-028: R-UI-2 spec says activity-feed handler should append rows; plan snippet prepends

- **Severity:** Low
- **Lane(s):** Doc-Skim (AUDIT-DOC-8)
- **Evidence:**
  - Spec line 237: "Handler appends to the existing `issue.event.list` query cache."
  - Handoff lines 353-356: "existing events are ordered ascending, but the plan prepends realtime rows with `[row, ...old]`. Verify intended order."
- **Direction:** Use append (`[...old, row]`), matching the spec; fix the plan snippet to stop contradicting itself.

## Patterns

### Pattern A: Spec decisions undermined at the point of implementation

The phases set clean rules, then the implementation softened them.

- Invariant 10 says 500 lines; R-UI-1 added a hook exemption (AUDIT-004).
- R-UI-2 spec principle 7 says "Realtime, no fallbacks"; RunDetailModal kept polling alongside (AUDIT-005).
- Invariant 21 says human verification; roadmap flipped Done with unchecked boxes (AUDIT-008).
- Invariant 9 says fail-fast; stage-runner's `??` fallback hides a missing contextLayout (AUDIT-014).
- Invariant 22 says flag deviations; `event-orchestrator.ts` diverges from the R-UI-2 spec with no in-code marker (AUDIT-010).

**Findings:** AUDIT-004, AUDIT-005, AUDIT-008, AUDIT-010, AUDIT-014.

### Pattern B: Optimistic concurrency applied inconsistently

R-UI-1 introduced version-locked update/delete for skills but didn't carry the discipline through.

- `driver.delete` is missing it (AUDIT-001).
- `pipeline`, `pipeline_run`, `stage_run`, `pipeline_stage` don't have version columns at all (AUDIT-009).
- Driver router inlines the version-lock update instead of using a shared helper, inviting further divergence (AUDIT-007).

**Findings:** AUDIT-001, AUDIT-007, AUDIT-009.

### Pattern C: Dead parallel execution paths waiting to conflict with R-UI-2's rewire

Three files define types or handlers that nobody imports.

- `stage-worker.ts` has a dead `createStageJobHandler` + inline `buildCommand` + dead `FLUXAOS_*` env vars (AUDIT-006).
- `pipeline/types.ts` duplicates `core/constants` (AUDIT-020).
- `orchestrator/index.ts` barrel has zero consumers (AUDIT-022).

R-UI-2 Task 16 is slated to rewire BullMQ through `stage-worker.ts`. If the dead file isn't cleaned up first, the rewire lands onto code that silently conflicts with `command-builder.ts`.

**Findings:** AUDIT-006, AUDIT-020, AUDIT-022.

### Pattern D: Scope decisions made but not surfaced

Both phases added work that wasn't in their spec without flagging the addition to the user.

- LAN auth bypass (AUDIT-017).
- Pre-commit hook exemption list extension (AUDIT-004).
- event-orchestrator.ts divergence left unmarked (AUDIT-010).
- Spec-vs-plan-vs-code drift on the layout mount site (AUDIT-016).

**Findings:** AUDIT-004, AUDIT-010, AUDIT-016, AUDIT-017.

## What I Can't Audit

The specialists flagged these as needing human judgment, not mechanical findings:

- **The R-UI-1 spec explicitly accepts that `features-primitive.test.ts` lives in `integration/` as a pure-logic test** (spec line 459). The spec author chose to exempt the invariant; the audit records the invariant violation but cannot decide whether the spec's exemption should stand.
- **PR #31 acknowledges 3 tRPC 500s as expected** — the audit flags this as contradicting invariant 9, but whether these should be 4xx or 5xx is a product-behavior decision the user owns.
- **Whether `RunDetailModal`'s polling is "belt-and-suspenders" or a forgotten leftover** (AUDIT-005) — the handoff Risk #5 explicitly deferred the decision; the audit cannot call it either way without your input.
- **Whether the LAN auth bypass is acceptable scope creep or should be retroactively reified as its own phase** (AUDIT-017).
- **Whether the pipeline-entity version columns (AUDIT-009) deserve an invariant-22 exemption or a schema migration** — both are valid paths per the invariant; the audit only observes that neither has been chosen.

## Synthesis Notes

- **Required-reading gate**: all four lanes produced five verbatim quotes each, spot-checked and confirmed present in the cited docs.
- **Mechanical-check re-run**: I independently re-ran Lane 1's grep 1, grep 4, grep 5 and Lane 3's harness-term grep. Output matched the lanes' pasted output (empty for stage names, vendor imports in core, harness leakage; file-size list matched exactly).
- **Hallucination spot-checks**: I opened the cited evidence for four findings (`driver.ts:99-108`, `RunDetailModal.tsx:67-76`, `use-realtime.ts:11`, `stage-runner.ts:179-183`) and confirmed each quoted excerpt. No hallucinations found.
- **Severity re-verification on High findings**: three findings were escalated from Medium → High during synthesis (AUDIT-004, AUDIT-005, AUDIT-008) based on the stricter framing from cross-lane overlaps. No Highs were demoted.
- **Zero-finding lane flag**: none of the four lanes returned zero findings, so no manual backstop pass was needed.
- **Dedup**: 40 raw specialist findings reduced to 28 unique findings after merging cross-surfaced items with single root causes.

## Appendix: Raw Specialist Outputs

- Lane 1 (Invariants): `docs/superpowers/audits/.raw/lane-1-invariants.md`
- Lane 2 (Plan Adherence): `docs/superpowers/audits/.raw/lane-2-plan-adherence.md`
- Lane 3 (Code Quality): `docs/superpowers/audits/.raw/lane-3-code-quality.md`
- Lane 4 (Doc-Skim): `docs/superpowers/audits/.raw/lane-4-doc-skim.md`
- File lists snapshots: `docs/superpowers/audits/.raw/r-ui-1-files.txt`, `docs/superpowers/audits/.raw/r-ui-2-files.txt`
