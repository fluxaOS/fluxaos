# Session Handoff — Post-Alpha Hardening Sweep

**Date:** 2026-04-27 22:44 PDT → 2026-04-28 02:52 PDT  
**Branch at start:** `main` at `6f0434a`  
**Branch at end:** `main` at `671397c`  
**Mode:** autonomous non-interactive execution  
**PRs merged:** #139, #140, #141, #142, #143, #144, #145, #146, #147

---

## Session Scope

Picked up after alpha backlog zeroed, with Linear as the source of truth. The initial request was FLX-83, then FLX-84, then continued autonomously through the remaining bounded hardening tickets. This session closed the highest-value FLX-76 splits, cleaned up several deferred runtime/UI bugs, and kept Linear updated as each item moved through In Progress → Done.

The only intentionally ignored failing external status was Vercel's private-org Hobby-plan deployment failure. Every PR waited for the required GitHub `check` to pass before merge.

---

## What Shipped

### PR #139 — `fix(orchestrator): fail fast on missing stage-runner config`

Merged as `5f3ac38`. **FLX-83 Done.** Removed the two real DB-driven config violations from FLX-74:

- No fallback prompt when `driver.issuePromptTemplate` is missing.
- No empty-string fallback when routing cannot resolve a model.

Added coverage to `stage-runner-config.test.ts`.

### PR #140 — `test(orchestrator): cover daemon rework verdict journey`

Merged as `dbad71d`. **FLX-84 Done.** Added a daemon journey for stage failure → rework verdict. The test asserts rework handling, issue state/status effects, and terminal behavior.

### PR #141 — `test(daemon): cover SIGTERM graceful drain`

Merged as `bc86ef0`. **FLX-85 Done.** Added a daemon SIGTERM drain journey proving in-flight stage runs can finish during the configured shutdown grace window.

### PR #142 — `test(e2e): align edit skill journey with seeded skills`

Merged as `fe46c5f`. **FLX-58 Done.** Removed the stale `deploy` skill assertion from `e2e/edit-a-skill.spec.ts`; the seeded catalog now contains research/implement/review/rework.

### PR #143 — `fix(orchestrator): keep materialized instructions out of target worktree`

Merged as `2f4a900`. **FLX-82 Done.** Stage materialization now writes instructions/context under the run artifacts path, not the target worktree root, preserving target repo files like `CLAUDE.md`. Added integration coverage.

### PR #144 — `test(e2e): cover issue deletion during daemon run`

Merged as `b6cc341`. **FLX-86 Done.** Added a daemon journey where the issue is deleted mid-stage; the daemon fails the run, kills/cleans up correctly, and stays alive.

### PR #145 — `fix(orchestrator): cancel running stage processes from UI`

Merged as `3ca23fa`. **FLX-22 Done.** This started as missing UI coverage but exposed a real cancellation bug:

- `SubprocessExecutor` reports spawned child PIDs.
- `stage_run.pid` is persisted.
- UI cancel routes send SIGTERM to the child and cancel both stage and pipeline run.
- The orchestrator preserves cancelled terminal state across subprocess failure races.
- Added `e2e/cancel-stage-button.spec.ts`.

### PR #146 — `fix(daemon): fail runs when deploy push conflicts`

Merged as `56de6f1`. **FLX-87 Done.** Added deterministic deploy-conflict journey:

- A separate clone creates the target branch on the bare remote while the daemon stage is running.
- Deploy bridge later hits non-fast-forward push rejection.
- Terminal hook marks latest stage and run failed, records an informative error, releases the worktree, and leaves the remote branch unchanged.

### PR #147 — `fix(pipeline): append live output realtime events`

Merged as `671397c`. **FLX-25 Done. FLX-28 Done by same fix.**

`LiveOutput` now appends matching Supabase Realtime `event` INSERT payloads directly into the tRPC events cache instead of waiting for a refetch. The payload is filtered by `stageRunId`, and the pane auto-scrolls as new events arrive. Added `e2e/live-output-streaming.spec.ts`, proving stdout lines appear while the pipeline is still `running`.

FLX-28 was closed with rationale because Raw JSON renders from the same `eventsQuery.data` collection fixed by PR #147.

---

## Linear State

Moved to Done this session:

- FLX-83 — drop hardcoded fallbacks in stage-runner
- FLX-84 — Stage failure → rework verdict journey
- FLX-85 — SIGTERM graceful drain journey
- FLX-58 — edit skill spec seeded-skill mismatch
- FLX-59 — resolved by retest/no repro on current main
- FLX-82 — materialized instruction/context files pollute target repo
- FLX-23 — stale skipped orchestrator test reference no longer exists
- FLX-86 — issue deleted mid-pipeline journey
- FLX-22 — UI cancel buttons now verified and fixed
- FLX-87 — deploy push conflict journey
- FLX-25 — LiveOutput streaming
- FLX-28 — Raw JSON streaming, resolved by FLX-25

No new Linear tickets were filed.

---

## Incidents & Root Causes

### FLX-22 was a real cancellation race

The UI already had cancel buttons, but cancelling a running stage did not signal the daemon-owned subprocess. After adding PID persistence and SIGTERM, the first fix still let a subprocess error overwrite `stage_run.status='cancelled'` with `failed`. Root cause was an async write race: stage-runner constructed a failed completion update before the cancel route committed, then committed after it. The final fix guards non-cancel stage completion writes from overwriting cancelled rows.

### FLX-87 conflict setup must use a separate clone

The first deploy-conflict fixture created the competing branch inside the same repository that owned the daemon worktree. Git worktrees share branch refs, so that moved the local branch under the running worktree and avoided the intended conflict. The final fixture creates the competing branch from a separate clone of the bare remote.

### Long-lived Next dev server can show adapter re-registration noise after hot reload

The dev server used for FLX-22/FLX-25 browser specs eventually printed `Adapter "database" is already registered` during hot reload after branch/DB churn. It did not affect shipped verification; the server was stopped during session-end. If this appears in future UI work, restart the dev server before diagnosing application behavior.

---

## Verification Matrix

Representative commands run across the shipped PRs:

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Passed on changed code before PRs |
| `npm run lint` | Passed; warning count reduced from 34 to 32 by FLX-25 cleanup |
| `npx tsx src/scripts/db/nuke.ts && npm run db:seed && npm run verify` | Passed after each merge on `main` |
| `npx vitest run src/__tests__/integration/orchestrator-e2e.test.ts` | Passed for FLX-23 triage |
| `npx vitest run src/__tests__/integration/pipeline-terminal-hook.test.ts` | Passed for FLX-87 |
| `PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test e2e/cancel-stage-button.spec.ts` | Passed |
| `npx playwright test e2e/deploy-conflict-journey.spec.ts` | Passed |
| `PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test e2e/live-output-streaming.spec.ts` | Passed |
| GitHub PR `check` | Passed for PRs #139-#147 |
| Vercel | Failed for known private-org Hobby-plan limitation; explicitly ignored |

---

## Current State

- HEAD: `671397c` on `main`
- Branches: `main` only locally after post-merge pruning
- Working tree: clean before session-end handoff write
- Stashes: none
- Worktrees: one (`/mnt/dev/fluxaos`)
- Dev server: was running on port 3003 for FLX-25; stopped during session-end
- Linear: active hardening tickets from the pickup batch are closed

---

## Files Touched

Key shipped files:

- `src/core/orchestrator/stage-runner.ts`
- `src/core/orchestrator/event-orchestrator.ts`
- `src/core/orchestrator/pipeline-run-service.ts`
- `src/core/orchestrator/pipeline-terminal-hook.ts`
- `src/core/ports/stage-executor.ts`
- `src/adapters/subprocess/executor.ts`
- `src/scripts/daemon.ts`
- `src/server/routers/pipeline.ts`
- `src/components/pipeline/LiveOutput.tsx`
- `e2e/cancel-stage-button.spec.ts`
- `e2e/deploy-conflict-journey.spec.ts`
- `e2e/issue-deleted-mid-pipeline.spec.ts`
- `e2e/live-output-streaming.spec.ts`
- `e2e/edit-a-skill.spec.ts`

---

## Suggested Next Session

Remaining backlog is now mostly product/post-alpha scope. Good bounded next options:

1. FLX-21 — previous run details not visible after new run (Medium, UI/history bug).
2. FLX-26 — pipeline detail modal duration does not update live (Low, likely small).
3. FLX-42 — tag input accepts only single tag (Low, contained UI bug).
4. FLX-38 — structured JSON editor for driver jsonb fields (Medium, larger UI/validation feature).

Copy/paste prompt:

```text
Continue fluxaOS post-alpha hardening from main at 671397c. Read docs/superpowers/handoffs/2026-04-28-post-alpha-hardening-session-handoff.md. Linear is up to date: FLX-83/84/85/58/59/82/23/86/22/87/25/28 are Done. Vercel private-org Hobby-plan failures are ignorable; GitHub `check` must pass before merge. Suggested next bounded ticket: FLX-21, FLX-26, or FLX-42.
```
