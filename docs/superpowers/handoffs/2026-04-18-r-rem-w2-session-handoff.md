# R-REM-W2 Architecture Remediation — Execution Session Handoff

**Date:** 2026-04-18
**Session type:** Implementation (superpowers:subagent-driven-development) + verification
**Branch:** `feat/r-rem-w2` — 10 commits ahead of `main` (W2 code + plan + planning handoff)
**Parent branch:** `main` at `c4ccd35` (merge of PR #42 — W2 planned status flip)
**Plan:** `docs/superpowers/plans/2026-04-18-r-rem-w2-implementation.md`
**Spec:** `docs/superpowers/specs/2026-04-18-r-rem-w2-design.md`
**Prior handoff:** `docs/superpowers/handoffs/2026-04-18-r-rem-w2-planning-session-handoff.md`

---

## Status one-liner

All 9 plan tasks implemented through `superpowers:subagent-driven-development`. Every task passed spec compliance review + code quality review. tsc clean, vitest 122/122, verify 10/10, lint baseline preserved (54 problems, identical to `main`). Build succeeds. **Browser verification (invariant 21) is pending the user** — see the checklist below. Once the user confirms the browser flow, the branch is ready for `superpowers:finishing-a-development-branch` to open the PR, merge, and flip the roadmap.

---

## Commits shipped (10 on this branch, 8 code + 2 planning carry-over)

```
e89e0be docs(invariants): clarify src/lib/ is framework glue, exempt from invariant 7     [Task 8]
947833d fix(issue-comment): wrap softDelete and update in db.transaction for atomicity    [Task 7]
9cbdca2 fix(bootstrap): split client bootstrap to exclude Node-only adapters              [Task 6 follow-up]
3992d46 test(stdout-parser): restore tool_result, result, system, empty-line coverage     [Task 6 follow-up]
b79f576 refactor(orchestrator): route stdout parser through adapter registry              [Task 6]
d6cebdb feat(adapters): add SubprocessStdoutParser port + adapter                         [Task 5]
b7f4316 refactor(pipeline): route RunDetailModal realtime through adapter registry        [Task 3]
b7a307e fix(client-bootstrap): call bootstrap() in TRPCProvider to populate client registry [Task 2 follow-up]
6bb81f8 refactor(pipeline): route LiveOutput realtime through adapter registry            [Task 2]
2aff2c6 feat(adapters): add SupabaseRealtimeProvider and register in bootstrap            [Task 1]
```

Diff shape vs `main` (code only, excluding the plan + planning handoff from the prior session): **10 commits**, 18 files changed, 2,320 insertions / 255 deletions (net +2,065 lines). Most of the growth is the new test file (`issue-comment.test.ts` at 261 lines), the new ports (`stdout-parser.ts`), the new adapters (`realtime.ts`, `stdout-parser.ts`), and the new `bootstrap-client.ts`.

---

## What shipped per task

### Task 1 — `2aff2c6`: SupabaseRealtimeProvider adapter + bootstrap registration
- New `src/adapters/supabase/realtime.ts` (61 lines): `SupabaseRealtimeProvider` implementing `RealtimeProvider` port with `subscribe`, `subscribeToTable`, `broadcast`.
- Modified `src/config/bootstrap.ts`: added `'realtime'` to `REQUIRED_ADAPTERS`, registration block between `auth` and `queue`.
- New `src/__tests__/integration/realtime.test.ts` (26 lines): 2 registry-resolution tests.

### Task 2 — `6bb81f8`: Migrate LiveOutput realtime + `b7a307e`: client-bootstrap fix
- `src/components/pipeline/LiveOutput.tsx`: swapped direct `@/lib/supabase/client` + `.channel()` for `registry.get<RealtimeProvider>('realtime').subscribeToTable(...)`.
- **Disclosed deviation:** dropped the pre-existing `filter: stage_run_id=eq.${stageRunId}` postgres_changes row filter — port signature has no filter param yet. Behavior: `eventsQuery.refetch()` now fires for any `event` table INSERT while the component is active. No user-visible data change (tRPC query is still filtered by `stageRunId`). R-UI-2 will restore the filter when it extends the port contract.
- **Follow-up commit `b7a307e`:** wired `bootstrap()` into `TRPCProvider` via a `useState` initializer so the client registry is populated before any component mounts. Code quality reviewer caught this: `LiveOutput.tsx` is a `'use client'` component and Next.js ships client/server bundles separately → without this fix, `registry.get('realtime')` would throw `Adapter "realtime" is not registered` at runtime.

### Task 3 — `b7f4316`: Migrate RunDetailModal realtime
- Same pattern as Task 2. Original code used a single channel subscribed to one table (`stage_run`), not two as the plan speculated — so no channel split needed.
- Same disclosed deviation: dropped `filter: 'pipeline_run_id=eq.${runId}'` (port has no filter). Same rationale.

### Task 4 — no commit: invariant grep sweep (verification only)
Three sweeps all clean:
- `grep -rn '\.channel(' src/ | grep -v 'src/adapters/supabase/' | grep -v '__tests__'` → zero.
- `grep -rn 'removeChannel|RealtimeChannel|realtime' src/ ...` → only allowed refs (ports, bootstrap, port-type imports in migrated components).
- `grep -n '@/lib/supabase' src/components/pipeline/LiveOutput.tsx src/components/pipeline/RunDetailModal.tsx` → zero.

### Task 5 — `d6cebdb`: StdoutParser port + SubprocessStdoutParser adapter
- New `src/core/ports/stdout-parser.ts` (37 lines): `EntryKind`, `TranscriptEntry`, `LineParser`, `StdoutParser` types.
- New `src/adapters/subprocess/stdout-parser.ts` (177 lines): `SubprocessStdoutParser` class with `getParser(format)` switch. **Verbatim byte-level relocation** of `parseLine`/`parseTextLine` from the old `src/core/orchestrator/output-parser.ts` — only diffs: function rename (`parseLine` → `parseStreamJsonLine`), removed `export` keywords, types imported from the new port. Spec reviewer confirmed via `diff`.
- Modified `src/config/bootstrap.ts`: registration `'stdoutParser'` after `executor`. **NOT** in `REQUIRED_ADAPTERS` (lazy-resolve when orchestrator runs a stage — matches `executor` pattern).
- New `src/__tests__/integration/stdout-parser.test.ts`: 6 tests.
- Old `output-parser.ts` **not** deleted in this task (Task 6 handles that).

### Task 6 — `b79f576`: Migrate parser consumers + delete output-parser.ts; `3992d46`: test-coverage restoration; `9cbdca2`: client-bootstrap split
- `src/core/orchestrator/stage-runner.ts`: `getParser(...)` → `registry.get<StdoutParser>('stdoutParser').getParser(...)`.
- `src/components/pipeline/LiveOutput.tsx`: swapped parseLine + types imports; added `useMemo`-hoisted parser resolved once per mount (`getParser('stream-json')`, hardcoded because the component has never had dynamic format selection — verified via grep).
- Deleted `src/core/orchestrator/output-parser.ts`.
- Also removed the `describe('output parser')` block from `src/__tests__/integration/orchestrator-e2e.test.ts` (7 tests that imported the deleted `parseLine`).
- **Follow-up `3992d46`:** restored 4 of those test branches in `stdout-parser.test.ts` — tool_result, result-with-cost, system message, empty-line short-circuit. These were branches NOT already covered by the original 6 tests. Net test count: 120 (116 from Task 6 + 4 restored).
- **Follow-up `9cbdca2` (critical fix caught by code quality reviewer):** `npm run build` was failing because `TRPCProvider` imported `bootstrap()`, which transitively pulled `SubprocessExecutor` → `execa` → `node:child_process` into the client bundle. Split into `src/config/bootstrap-client.ts` that registers only browser-safe adapters (`auth`, `realtime`). `TRPCProvider` now calls `bootstrapClient()`. Server entry points continue to call the full `bootstrap()`. Build green post-fix.

### Task 7 — `947833d`: Transactional issue-comment soft-delete + update
- `src/core/services/issue-comment.ts`:
  - Wrapped `softDelete` in `db.transaction(async (tx) => ...)`. Load → version check (inlined) → event insert via `tx.insert` → comment update via `tx.update` → return updated row. Preserves DA Finding #18 ordering (event captures body BEFORE body is cleared).
  - Wrapped `update` in the same pattern (it has 4 statements — matches plan's multi-statement criterion).
  - Removed `loadComment` and `assertVersion` helpers (dead after inlining). `recordEvent` kept because `create` still uses it. `create` NOT wrapped (out of plan scope — has a separate `MAX(comment_number)+1` race that a simple transaction wouldn't solve; flagged as follow-up).
  - All VERSION_CONFLICT error messages preserved verbatim. Event payload fields preserved.
- New `src/__tests__/integration/issue-comment.test.ts` (261 lines): 2 self-contained integration tests (rollback on version mismatch + commit on happy path). Does NOT grow `services.test.ts` (DEF-008).

### Task 8 — `e89e0be`: Invariants doc clarification
- Appended a scope-clarification paragraph to invariant 7 in `docs/invariants.md` noting `src/lib/` is Next.js framework glue and exempt from the core-vs-adapter rule. Audit findings flagging `src/lib/supabase/` as a violation are now explicitly false positives.

### Task 9 — this handoff
Verification matrix (below), invariant grep sweeps, handoff doc. Awaits the user-browser confirmation.

---

## Verification matrix

| Check | Command | Expected | Actual |
|---|---|---|---|
| Type-check | `npx tsc --noEmit` | zero errors | ✅ zero errors |
| Integration tests | `npx vitest run` | all green | ✅ **122 / 122 passing** (12 test files) |
| DB reset + seed | `npx tsx src/scripts/db/nuke.ts && npm run db:seed` | no errors | ✅ 34 tables cleared, seed complete |
| Verification suite | `npm run verify` | 10/10 PASS | ✅ 10/10 PASS, 1 suite passed |
| Lint baseline | `npm run lint` | same count as `main` | ✅ **54 problems (20 err / 34 warn)** — identical to `main` at `c4ccd35` |
| Production build | `npm run build` | compiles | ✅ compiles, 19 routes generated, 7 static pages prerendered |
| Invariant sweep 1 | `.channel(` outside adapter | zero | ✅ zero |
| Invariant sweep 2 | `output-parser` imports | zero | ✅ zero |
| Invariant sweep 3 | `parseLine`/`parseTextLine` in `src/core/` | zero | ✅ zero |
| Browser verification | See checklist below | user-confirmed | ⏳ **Pending user** |

**Lint-count caveat:** `npm run lint` first-pass showed 3163 problems, but that was because `website/.next/` build artifacts from `npm run build` got crawled by ESLint. After `rm -rf website/.next .next`, the real count is 54 — identical to `main`. The Next.js build cache isn't tracked in git; any future `npm run build` followed by `npm run lint` will reproduce the noise. Consider updating `.eslintignore` to exclude `**/.next/**` as a post-W2 polish.

**Test count delta vs plan:** plan projected 124-125. Actual is 122. Reasons:
- Task 6 removed 7 duplicate tests from `orchestrator-e2e.test.ts` (post-deletion of old `output-parser.ts`). Follow-up commit `3992d46` restored 4 of those branches in `stdout-parser.test.ts`. Net −3 tests.
- Task 7 added 2 tests (plan projected 1-2). Same as plan.
- Net: 115 baseline − 7 + 2 (Task 1) + 6 (Task 5 initial) + 4 (Task 6 restore) + 2 (Task 7) = 122.
- Coverage is net-equivalent — all branches previously tested are still covered exactly once.

---

## Human UI tests required (invariant 21 — run these before PR merge)

Code-only changes; run in a real browser at `http://192.168.54.101:<dev-port>` with DevTools console open. **Any red console error invalidates the test.**

### Pre-flight

1. `npm run dev`
2. Open the app in a browser. Open DevTools console.

### Golden path

3. **Login** — seeded user or `FLUXAOS_LAN_AUTH_BYPASS=1`. Confirm redirect to project list.
4. **Open a project** — confirm dashboard loads without console errors.
5. **Create an issue** — title / type / priority → submit. Confirm list + detail render.
6. **Edit the issue** — title / body / priority → submit. Confirm update persists on reload. **This exercises Task 7's `update` transaction wrap.**
7. **Add a comment** — post a comment, confirm it appears in the timeline.
8. **Delete the comment (soft-delete)** — click delete. Confirm body is cleared + deletion event shown in the timeline + timeline renders cleanly. **This exercises Task 7's `softDelete` transaction wrap.**
9. **Navigate to a pipeline run** — start a new one or open an in-progress one from the seed.
10. **Observe LiveOutput streaming** — confirm stdout lines appear in real-time. text / tool_call / tool_result / result / system entries render correctly. **This exercises Tasks 2 + 6** (registry-resolved realtime + parser).
11. **Open RunDetailModal** — confirm modal updates as stage states change. **This exercises Task 3.**
12. **Logout** — confirm redirect back to login.

### Optional edge cases (confirm non-regression of pre-W2 behavior)

13. **Concurrent issue edit** — two tabs, edit the same issue in both, submit from both. Second submit should produce `VERSION_CONFLICT`. (Worked pre-W2 via hand-rolled versioning; confirming non-regression.)
14. **Concurrent comment delete** — two tabs, delete the same comment in both. Second delete should produce `VERSION_CONFLICT`. **This confirms Task 7's transaction correctly rolls back on version mismatch rather than leaving half-applied state.**

### Fail criteria

- Any red console error → investigate.
- LiveOutput stops streaming mid-run → Task 2 / 6 regression.
- RunDetailModal doesn't update → Task 3 regression.
- Soft-deleted comment shows partial state (body still visible but deletion event recorded, or vice versa) → Task 7 transaction isn't working.

Report results in a table matching this format for the post-verification commit / PR description.

---

## Key decisions made during execution

| Decision | Reason |
|---|---|
| Added `import 'dotenv/config'` to each new integration test | Without it, `bootstrap()` in `beforeAll` throws on missing env vars. Matches existing convention in `supabase-connection.test.ts`. |
| Dropped postgres_changes row filters in LiveOutput + RunDetailModal migrations | Port signature has no `filter` param. R-UI-2 will add it. Spec explicitly accepts unfiltered migration (lines 180-188). No user-visible data change because tRPC queries are still scoped server-side. |
| Used `<unknown>` generic for realtime handlers that ignore `payload.new` | Handlers just call `refetch()` — typing the payload would be dead weight. |
| Wired `bootstrap()` into `TRPCProvider` for client registry | Task 2 caught this as critical via code review: client bundle registry was empty without a client-side bootstrap call. Fix via `useState(() => bootstrapClient())` initializer. |
| Split `bootstrap()` into `bootstrap()` + `bootstrapClient()` | Task 6 caught this as critical via code review: original single bootstrap transitively imported `SubprocessExecutor` → `execa` → `node:child_process`, breaking the Next.js client bundle. `bootstrapClient()` registers only browser-safe adapters (`auth`, `realtime`). |
| Removed 7 duplicate tests from `orchestrator-e2e.test.ts` → restored 4 in `stdout-parser.test.ts` | Task 6 deletion of `output-parser.ts` orphaned the old direct-import tests. 4 of 7 branches weren't covered by the initial `stdout-parser.test.ts`. Restored to maintain coverage through the port. |
| Removed `loadComment` / `assertVersion` helpers in Task 7 | Dead after inlining into transactions. `recordEvent` retained because `create` still uses it. |
| Did NOT wrap `create` in a transaction (Task 7) | Out of plan scope. Has a worse race (`MAX(comment_number)+1` TOCTOU) that a simple transaction wouldn't solve. Noted as follow-up. |

---

## Loose ends / follow-ups (not blocking)

1. **`src/core/services/issue-comment.ts` has a pre-existing unused `IssueCommentInsert` type alias** on line 18. Pre-existing lint warning; not introduced by W2. Janitorial pass.
2. **`create` in `issue-comment.ts` is not atomic.** Two writes (INSERT comment + INSERT event). Wrapping in a transaction alone doesn't fix the `MAX(comment_number)+1` allocation race — that needs serializable isolation or a sequence. Follow-up phase suggested: "comment-number allocation race in issue-comment.create."
3. **`pipelineRun` / `stageRun` versioning remains deferred** — spec reconciliation determined they have a single writer (orchestrator) so no concurrent-write risk today. Revisit if a future phase introduces a second writer.
4. **`.eslintignore` could exclude `**/.next/**`** so `npm run lint` after `npm run build` doesn't crawl generated artifacts. Cosmetic; doesn't affect the actual lint baseline.
5. **R-UI-2 rebase cost** — R-UI-2 on `feat/r-ui-2-impl` touches the realtime port contract (adding `filter?`). When that branch resumes, the R-REM-W2 port shape must be extended to support row filters, and LiveOutput + RunDetailModal re-acquire the pipeline-run-scoped filter they lost in W2. Low churn, well-scoped.
6. **Deferred from prior sessions** — DEF-007, DEF-008 (services.test.ts size / `any`), `src/core/pipeline/.gitkeep` marker, various stale "zero vendor imports" docs references. None interact with W2.

---

## Next session instructions (if browser verification passes)

1. `git log main..HEAD --oneline` — confirm 10 commits plus 2 planning commits carried from the prior session.
2. Invoke `superpowers:finishing-a-development-branch` — that handles PR creation, merge, and cleanup.
3. After merge, flip roadmap: set R-REM-W2 to **Done** on `docs/superpowers/roadmap.md:21` and update the "What's Next" section at line 65. Use the tiny-PR pattern (direct commits to main are blocked by the pre-commit hook).
4. Delete the branch locally and remotely after merge.

---

## Projected PR title / body

**Title:** `feat(arch): R-REM-W2 — route realtime + stdout parser through adapter registry; transactional comment soft-delete`

**Body (summary):**
- Route realtime subscriptions through the adapter registry (2 consumers: LiveOutput, RunDetailModal).
- Introduce `StdoutParser` port + `SubprocessStdoutParser` adapter; delete `src/core/orchestrator/output-parser.ts` so `src/core/` contains zero subprocess-parsing logic.
- Wrap `softDelete` and `update` in `issue-comment.ts` in `db.transaction` for atomicity.
- Fix client/server bootstrap split so `registry.get` works in both environments without breaking the Next.js client bundle.
- Doc clarification: `src/lib/` is framework glue, exempt from invariant 7.
- 122/122 tests passing. tsc clean. Lint baseline preserved. Build succeeds. Browser user-confirmed.
