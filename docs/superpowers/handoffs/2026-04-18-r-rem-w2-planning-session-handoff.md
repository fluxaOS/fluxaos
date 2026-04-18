# R-REM-W2 Planning Session Handoff (Wave 1 Shipped, W2 Scoped / Specced / Planned, Awaiting Execution)

**Date:** 2026-04-18
**Session type:** Multi-phase (finish + brainstorm + spec revision + plan authoring)
**Branches left behind:**
- `main` at `525d2ef` — Wave 1 complete, W2 spec merged, roadmap flipped
- `feat/r-rem-w2` (local + remote) — carries the plan doc, awaits implementation
- `feat/r-ui-2-impl` — paused, unchanged (not touched this session)

**Prior handoffs (read in order if you need history):**
1. `docs/superpowers/handoffs/2026-04-17-audit-session-full-handoff.md` — audit origin
2. `docs/superpowers/handoffs/2026-04-17-audit-triage-and-wave-1-plan.md` — triage decisions
3. `docs/superpowers/handoffs/2026-04-17-wave-1-midsession-handoff.md` — mid-session Task 6 scope expansion
4. `docs/superpowers/handoffs/2026-04-18-wave-1-tasks-1-6-session-handoff.md` — PR #37 shipment handoff
5. `docs/superpowers/handoffs/2026-04-18-wave-1-finish-session-handoff.md` — W1 Tasks 7-9 finish handoff
6. **This doc** — W1 shipped, W2 planned

---

## Status one-liner

Wave 1 Foundation (R-REM-W1) is fully shipped and merged to `main` via PR #38. Roadmap flipped to Done via PR #39. Wave 2 (R-REM-W2) has been brainstormed, spec-written, spec-revised after ground-truth reconciliation (PR #40 initial, PR #41 revised), and implementation plan authored on `feat/r-rem-w2`. **Next session picks up `feat/r-rem-w2` and executes the 9-task implementation plan via `superpowers:subagent-driven-development`.**

---

## Why this is a fresh session (context-transfer note)

This session packed a lot into one window: the W1 close-out (PR + merge + roadmap flip), a full brainstorm on W2, spec v1, a ground-truth reconciliation pass that invalidated three of the original six W2 items, spec v2, and a detailed 9-task implementation plan (1279 lines). By the time the plan was committed the main conversation had consumed enough context that dispatching 9 tasks × (implementer + 2 reviewers) worth of subagents — roughly 27 dispatches plus review loops — risked running dry mid-implementation. Better to checkpoint cleanly here and let a fresh session drive execution with full context for review work.

---

## What shipped today

### To `main` (3 merges)

```
525d2ef Merge pull request #41 from fluxaOS/docs/r-rem-w2-spec-v2  (revised W2 spec)
d9a2dce docs(spec): revise R-REM-W2 after ground-truth reconciliation
92274c5 Merge pull request #40 from fluxaOS/docs/r-rem-w2-spec  (initial W2 spec)
f6b551d docs(spec): R-REM-W2 architecture remediation design
eaf78b9 Merge pull request #39 from fluxaOS/docs/roadmap-wave-1-done  (W1 roadmap flip)
c8c66d7 docs(roadmap): mark R-REM-W1 Wave 1 Foundation as Done
9adb9a8 Merge pull request #38 from fluxaOS/feat/wave-1-finish  (W1 Tasks 7-9)
30267c8 docs(handoff): Wave 1 finish session handoff — Tasks 7-9 shipped, awaiting PR
84c2f41 docs(deferred-fixes): update DEF-007 exemption path after Task 8 relocation
eae7fef chore: relocate out-of-core files to src/scripts/
185e86e feat(schema): drop issue_attachment, issue_dependency, issue_saved_view
ddebd6e Merge pull request #37 from fluxaOS/feat/wave-1-foundation  (W1 Tasks 1-6, pre-session)
```

Four PRs shipped this session: **#38** (W1 finish — code), **#39** (W1 roadmap flip — doc), **#40** (W2 spec v1 — doc), **#41** (W2 spec v2 — doc).

### To `feat/r-rem-w2` (pushed to remote)

```
0fbff59 docs(plan): R-REM-W2 architecture remediation implementation plan
```

One commit: the 1,279-line implementation plan. Built on top of `main` at `525d2ef`, so rebase is trivial if more changes land on `main` before execution.

---

## Chronology of the session

### Phase 1 — Wave 1 finish (tasks 7-9 already coded pre-session; close-out only)

1. Read the finish-session handoff (`2026-04-18-wave-1-finish-session-handoff.md`) — it explicitly requested: open PR, merge, flip roadmap, no code changes.
2. Stashed unstaged work-tree noise (handoff expansion + untracked `docs/superpowers/research/`) so the PR reflected only the 4 verified commits.
3. Re-verified: `npx tsc --noEmit` clean, `npx vitest run` 115/115 PASS.
4. Pushed `feat/wave-1-finish`, opened PR #38 with the handoff-provided title and body.
5. Merged via `gh pr merge 38 --merge --delete-branch` (merge commit, matching PR #37's style).
6. Attempted direct commit to `main` for roadmap flip — blocked by pre-commit hook (expected; handoff warned). Fell back to tiny PR: `docs/roadmap-wave-1-done` → PR #39 → merge.
7. Popped stash to restore pre-session working-tree state.

### Phase 2 — W2 brainstorm

Invoked `superpowers:brainstorming`. Five rounds of one-question-at-a-time:

- **Q1 (PR structure):** bundled PR (all 6 items) vs. multiple PRs vs. split concurrency into W2b. **Chose: A — bundled PR.**
- **Q2 (concurrency rollout):** strict (all entities) vs. pragmatic (real concurrency risk only) vs. minimal (only already-versioned tables). **Chose: B — pragmatic, target `issue` / `pipelineRun` / `stageRun` / `issueComment`.**
- **Q3 (Anthropic protocol parser):** new dedicated port vs. fold into AIProvider vs. skip port and just move file. **Chose: A — new AIProtocolParser port + adapter.**
- **Q4 (realtime migration):** full (all consumers) vs. server-only vs. register but don't migrate. **Chose: A — full migration, accepting `feat/r-ui-2-impl` rebase cost.**
- **Q5 (verification bar):** W1 baseline + grep sweep vs. add concurrency tests vs. add concurrent-user browser test. **Chose: B — W1 bar + grep sweep + concurrency integration tests.**

Spec written to `docs/superpowers/specs/2026-04-18-r-rem-w2-design.md` with all six items. Self-reviewed, user-approved, landed on main via PR #40.

### Phase 3 — Ground-truth reconciliation (critical pivot)

Pre-plan codebase inspection surfaced that the spec's scope was significantly wrong:

1. **Optimistic concurrency on `issue` + `issueComment` already exists** — hand-rolled in the services, substantial business logic interleaved with version checks. Not missing. Refactoring onto `createVersionedCrudService` would risk regressions in working code.
2. **`pipelineRun` / `stageRun` have a single writer** — the orchestrator in `src/core/orchestrator/pipeline-run-service.ts`. No concurrent-write risk today. Adding versioning is speculative.
3. **`src/lib/supabase/` is Next.js SSR cookie glue** using `@supabase/ssr` — solves a different problem than the existing `SupabaseAuthProvider` adapter which uses plain `@supabase/supabase-js` (no cookie bridge). The audit's "invariant 7 violation" flag was a misread: invariant 7 is about core-vs-adapter pluggable-vendor seams; `src/lib/` is framework glue, neither core nor adapter.

User was informed of the three findings and asked to pick A/B/C for each. User chose **A/A/A** (drop each as out-of-scope).

Revised spec written. Self-reviewed. User-approved. Landed on `main` via PR #41. Revised W2 now ships three items:

1. Realtime through adapter registry (2 consumers: LiveOutput, RunDetailModal)
2. Anthropic protocol parser port (renamed to "stdout parser" — see below)
3. Transactional issue-comment soft-delete (genuine durability gap surfaced during inspection)

Plus a doc-only invariants clarification about `src/lib/` scope.

### Phase 4 — Plan authoring

Invoked `superpowers:writing-plans`. Before writing, read the actual `output-parser.ts` file and discovered a **third** ground-truth correction:

**The file parses generic subprocess stdout**, not Anthropic Messages API wire format. Recognizes `type: 'assistant' | 'user' | 'result' | 'system'` which is the Claude Code CLI transcript format, not Anthropic's `message_start` / `content_block_delta` events. Driver output format is selected per-driver via `driver.outputFormat`. Architecturally this is a **subprocess output parser**, not an Anthropic-specific one.

Correction applied inline in the plan: adapter lives at `src/adapters/subprocess/stdout-parser.ts` (alongside `SubprocessExecutor`), not `src/adapters/anthropic/`. Port named neutrally `StdoutParser`. Grep sweeps updated accordingly. Plan documented the correction at the top.

Plan written to `docs/superpowers/plans/2026-04-18-r-rem-w2-implementation.md` — 9 tasks, 1,279 lines, per-task TDD shape, exact file paths, exact code blocks, expected test output. Self-reviewed for placeholders, type consistency, and scope coverage. Committed to `feat/r-rem-w2`.

---

## Current state of `feat/r-rem-w2`

**Base:** `main` at `525d2ef`.
**Commits:** 1 (`0fbff59` — plan doc only).
**Pushed:** yes (`origin/feat/r-rem-w2`).
**Code changes:** zero. Pure planning work.
**Ready for execution:** yes.

---

## The 9-task plan — one-page summary

| # | Task | Shape | Expected test count delta |
|---|------|-------|---------------------------|
| 1 | Realtime adapter + bootstrap registration | New `SupabaseRealtimeProvider` in `src/adapters/supabase/realtime.ts`; register as `'realtime'`; add to `REQUIRED_ADAPTERS` | +2 |
| 2 | Migrate LiveOutput to registry-resolved realtime | Replace `createClient().channel(...)` with `registry.get<RealtimeProvider>('realtime').subscribeToTable(...)` | 0 |
| 3 | Migrate RunDetailModal to registry-resolved realtime | Same pattern; may require splitting one channel into per-table subscriptions | 0 |
| 4 | Invariant grep sweep for realtime | Verification only, no commit | 0 |
| 5 | StdoutParser port + adapter | New port `src/core/ports/stdout-parser.ts`; new adapter `src/adapters/subprocess/stdout-parser.ts`; register as `'stdoutParser'` (NOT in REQUIRED_ADAPTERS — lazy-resolved when orchestrator runs) | +6 |
| 6 | Migrate orchestrator consumers + delete output-parser.ts | `stage-runner.ts` and `LiveOutput.tsx` switch to registry; old file deleted | 0 |
| 7 | Transactional issue-comment soft-delete | Wrap `softDelete` (and `update` if similarly multi-statement) in `db.transaction`; test asserts rollback on version mismatch | +1 to +2 |
| 8 | Invariants note on `src/lib/` scope | Append paragraph to invariant 7 in `docs/invariants.md` | 0 |
| 9 | Verification matrix + handoff | Run tsc / vitest / verify / lint / grep sweeps / browser; write handoff | 0 |

Projected final test count: **115 + ~9-10 = ~124-125 tests**. Exact number depends on whether Task 7 adds 1 or 2 tests.

---

## Human UI tests required for next session (after implementation)

Per spec Testing section and Task 9 Step 3. Code-only changes — run in a real browser (invariant 21) on the homelab address `http://192.168.54.101:<dev-port>`.

### Pre-flight

1. Start dev server: `npm run dev`
2. Open browser. Navigate to the dev server URL.
3. Open DevTools console. Keep it visible throughout — **any console error invalidates the test**.

### Golden path (must all pass)

4. **Login** — use a seeded user or the LAN auth bypass if `FLUXAOS_LAN_AUTH_BYPASS=1`. Confirm redirect to project list.
5. **Open a project** — pick the seeded project. Confirm dashboard loads.
6. **Create an issue** — click New Issue, fill title / type / priority, submit. Confirm the issue appears in the list and the detail page loads.
7. **Edit the issue** — change title / body / priority. Submit. Confirm the update persists on reload.
8. **Add a comment** — write a comment, post. Confirm it appears in the timeline.
9. **Delete the comment (soft-delete)** — click delete on the comment. Confirm it's marked deleted (body cleared, deletion event shown) and the timeline still renders correctly. **This exercises Task 7's transactional wrap.**
10. **Navigate to a pipeline run** — either start a new one or open an in-progress one from the seed.
11. **Observe LiveOutput streaming** — confirm stdout lines appear in real-time as the pipeline runs. Text / tool_call / tool_result / result entries should render correctly. **This exercises Tasks 2 + 6.**
12. **Open RunDetailModal** — confirm the modal opens and updates as stage states change (running → completed). **This exercises Task 3.**
13. **Logout** — confirm redirect back to login.

### Negative / edge cases (confirm non-regression)

14. **Concurrent issue edit (optional)** — open two tabs, edit the same issue in both, submit from both. Second submit should produce a `CONFLICT` error (already worked pre-W2 via hand-rolled versioning; confirming non-regression).
15. **Concurrent comment delete (optional)** — open two tabs, delete the same comment in both. Second delete should also produce a `CONFLICT` error — **this confirms Task 7's transaction correctly rolls back on version mismatch rather than leaving half-applied state**.

### Fail criteria

- **Any red console error** in DevTools → task failed, investigate.
- **LiveOutput stops streaming mid-run** → realtime migration regressed (Task 2 / 6).
- **RunDetailModal doesn't update** → Task 3 regressed.
- **Soft-deleted comment shows partial state** (body still visible but deletion event recorded, or vice versa) → Task 7's transaction isn't working.

Report results in the next session's handoff in a table matching the W1 finish handoff's structure.

---

## Environment / state

- `main`: `525d2ef`
- `feat/r-rem-w2`: `0fbff59` (1 commit ahead of main)
- `feat/r-ui-2-impl`: untouched; paused
- Working tree on `main` has unstaged handoff edits (older expansion of the W1 finish handoff) + untracked `docs/superpowers/research/` — carried from prior session, left as-is; not part of any PR. Next session can either discard, commit separately, or ignore.
- No stashes.
- No worktrees beyond the main clone.

---

## Next session instructions

### Start here

```bash
cd /mnt/dev/fluxaos
git fetch --all --prune
git checkout feat/r-rem-w2
git pull
git log main..HEAD --oneline    # should show: 0fbff59
```

### Read, then execute

1. Read the implementation plan: `docs/superpowers/plans/2026-04-18-r-rem-w2-implementation.md` — particularly the "One-time correction from the spec" section at the top, which explains why the adapter path is `src/adapters/subprocess/stdout-parser.ts` (not Anthropic).
2. Read the spec: `docs/superpowers/specs/2026-04-18-r-rem-w2-design.md` — the approved source of truth for scope.
3. Verify state before starting: `npx tsc --noEmit` (clean), `npx vitest run` (115 pass).
4. Invoke `superpowers:subagent-driven-development`. Execute the 9 tasks in order. Per-task loop: implementer subagent → spec compliance reviewer → code quality reviewer → mark complete.
5. After Task 9 commits the handoff, invoke `superpowers:finishing-a-development-branch`. That handles PR → merge → cleanup.
6. After merge, flip roadmap: set R-REM-W2 to **Done** on `docs/superpowers/roadmap.md:21` and update the "What's Next" section at line 65. Use the tiny-PR pattern (direct commits to main are blocked by the pre-commit hook).

### Surprises to watch for

- **Task 6 Step 3 (LiveOutput parser migration)** — the plan hardcodes `getParser('stream-json')`. Before committing, grep the component for any dynamic format selection. If LiveOutput handles multiple formats, thread `driver.outputFormat` through instead of hardcoding.
- **Task 7 Step 2 (softDelete test)** — the plan's test body has inline placeholders (`/* ... create an issue, then a comment at version 1 ... */`). Read the existing `src/__tests__/integration/issue-comment.test.ts` for seed helper patterns and match them. Fill in actual assertions based on `softDelete`'s current return-contract (null vs. throw).
- **Task 7 Step 5 (update method assessment)** — read `issue-comment.ts`'s `update` method. If it's single-statement, skip the wrap. If multi-statement, wrap identically to `softDelete`.
- **RequiredAdapters decision** for `stdoutParser` is documented in Task 5 Step 6 as "not required, lazy-resolve." Stick with that unless you find a startup-time consumer.
- **Commit hook edge cases** — if `services.test.ts` gets touched during the work (shouldn't), the pre-existing 6× `no-explicit-any` + file-size issues (DEF-008) will block the commit. Avoid touching unless necessary. If forced, document with `--no-verify` per the W1 precedent.

### Projected execution cost

9 tasks × 3 subagents each = ~27 subagent dispatches baseline, plus review-loop iterations if reviewers find issues. Realistically 35-45 subagent dispatches for a clean run. Fresh session should have plenty of context for this.

### Projected test deltas at completion

- `npx tsc --noEmit` — zero errors (should stay that way)
- `npx vitest run` — 124-125 pass (up from 115)
- `npm run verify` — 10/10 (unchanged)
- `npm run lint` — same count as `main` (baseline preserved)

---

## Loose ends (not blocking, carried from prior sessions)

1. **DEF-007, DEF-008** in `docs/superpowers/deferred-fixes.md` — pre-existing size / `any` issues in `services.test.ts` and hook exemption path. Don't let Task 7 inadvertently grow `services.test.ts`.
2. **`src/core/pipeline/.gitkeep`** — untracked empty-dir marker from W1 Task 6. Harmless.
3. **Downstream docs with stale "zero vendor imports" wording** — `CLAUDE.md:49`, `README.md:86`, various spec docs. Doc-polish branch someday.
4. **Code-audit skill templates** reference retired `ARCHITECTURAL_STANDARDS.md` — runtime-only impact if the skill runs.
5. **Unstaged handoff edits + untracked `docs/superpowers/research/`** currently in the working tree of `main`. From an earlier session. Next session can commit, discard, or continue to ignore.
6. **Optimistic concurrency on `issue` / `issueComment` is hand-rolled** and working. Consider a future "consolidation" phase that introduces a factory primitive which composes business logic around the version check — but only if another versioned entity joins the codebase and a pattern emerges worth DRY-ing. YAGNI until then.

---

## Invariant commitments carried into W2

- **Invariant 7** — the whole point of W2.
- **Invariant 12 (optimistic concurrency)** — the scope narrowing clarified that `issue` and `issueComment` already honor it via hand-rolled code. `pipelineRun` / `stageRun` explicitly exempt because single-writer. Document in any future invariant-12 audit.
- **Invariant 21 (browser verification)** — mandatory for Task 9. Section "Human UI tests required" above is the concrete checklist.

---

## Decisions log (for future me)

| Decision | Reason |
|---|---|
| Drop original W2 items #1 (CRUD audit) + #2 parts (issue/issueComment versioning) | Already done, hand-rolled, working; refactoring risks regressions in business logic for DRY's sake. YAGNI. |
| Drop `pipelineRun` / `stageRun` versioning | Single writer (orchestrator). No concurrent-write risk. Revisit if W3 introduces a second writer. |
| Drop auth port migration / `src/lib/supabase/` deletion | `src/lib/` is framework glue (Next.js SSR cookies), not a core-vs-adapter invariant-7 violation. Audit finding was a misread. |
| Correct "Anthropic protocol parser" to "Subprocess stdout parser" | File parses generic subprocess JSON-per-line, not Anthropic Messages API. Claude Code CLI transcript format is one of several shapes. |
| Put stdout adapter under `src/adapters/subprocess/` | Sits next to `SubprocessExecutor`. Correct architectural home. |
| `'stdoutParser'` NOT in `REQUIRED_ADAPTERS` | Parser only needed when orchestrator runs a stage. Lazy-resolve is correct. |
| Commit the transactional soft-delete as-is (not a refactor-to-factory) | Preserves hand-rolled business logic. Minimal change, maximum durability win. |

---

## If something has changed since this handoff was written

Run before starting work:

```bash
git fetch --all --prune
git checkout feat/r-rem-w2
git log main..HEAD --oneline   # expect: 0fbff59 (plan doc)
npx tsc --noEmit               # expect: 0 errors
npx vitest run                 # expect: 115/115 pass
```

If any of these fail, STOP. Either (a) main has advanced and needs rebasing in (`git rebase main`), or (b) something broke baseline. Investigate before executing the plan.
