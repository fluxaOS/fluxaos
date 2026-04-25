# R-SMOKE — End-to-End Alpha Acceptance Test

**Phase:** R-SMOKE
**Status:** SPEC
**Created:** 2026-04-25
**Author:** Claude Opus 4.7 (1M)
**Depends on:** R-DAEMON (Done), R-EPIC (Done), R-RUNTIME (Done), R-ARTIFACTS (Done), R-MISSION-CONTROL (Done).

---

## 1. Problem

The alpha loop now has every individual piece shipped — daemon ownership, epic/child hierarchy, workspace isolation, deploy bridge, mission-control surface. Each phase has its own journey. None compose them together. The roadmap-stated alpha acceptance test is the proof that the assembled engine actually delivers the headline promise: "file an issue, get a PR."

Roadmap-stated scope: "Playwright journey: file an epic with one child issue, wait for the daemon to pick it up, confirm the worker ran in an isolated worktree, confirm a PR was opened, confirm the issue advanced to `review`, confirm the worktree gets cleaned up after the PR closes. This is the alpha acceptance test."

R-RUNTIME's `r-runtime-deploy-journey.spec.ts` is the closest existing thing, but: (a) was written before R-DAEMON so it relied on the now-removed inline executor path — under R-DAEMON the trigger is publish-only, the daemon must be running, and that journey fails today; (b) skips the epic/child step; (c) only verifies post-run cleanup (active → inactive on terminal), not post-PR-close cleanup.

## 2. Goals

- One Playwright spec, `e2e/r-smoke.spec.ts`, that runs the full alpha promise end-to-end.
- The journey:
  1. Nuke + reseed the DB.
  2. Spawn the daemon as a child process; wait for `daemon.started` sentinel.
  3. Through the UI, set up an epic + a single child issue. Use the existing seeded issue #1 as the parent and create child #2 (or N+1) via the "Create child issue" affordance from the parent's RelationshipsCard.
  4. Verify the parent's "Run Stage" button is disabled with the epic-rejection hint (R-EPIC guard surface check; cheap).
  5. On the child, advance state to `Implement`, click Run Stage. Trigger writes `pipeline_run:pending` + a seed `stage_run:pending`. Daemon owns from here.
  6. Wait for terminal: pipeline_run reaches `completed` AND `issue_pull_request` row exists for the child (DEF-020 fix from R-RUNTIME — terminal-with-PR is the true ready state).
  7. Assert: child issue's `state` is `review`. Branch row exists for the child with `fluxaos/issue-<child-N>-` prefix. PR is open on GitHub. Isolation environment marked inactive. Worktree dir removed (already done by terminal hook in R-RUNTIME).
  8. Close the child issue (transition to a terminal state via tRPC). Assert R-EPIC propagation: parent auto-closes, parent's activity feed renders the auto-close label.
  9. Invoke `cleanupService.onPrClosed(prNumber, { merged: false })` directly via tRPC (or a test-only entry point) to simulate the PR being closed. Assert: isolation_environment for the run goes `inactive`-with-removed-fs (or stays inactive — already removed at terminal-hook time; cleanup is idempotent), and the local clone shows the branch is gone after a `git fetch --prune`. The exact filesystem assertion depends on whether the worktree was already gone — see §7.
  10. Tear down: SIGTERM the daemon, close the PR on GitHub, delete the remote branch, end the DB connection.
- Cred-gated: `ANTHROPIC_API_KEY` + `FLUXAOS_GITHUB_TOKEN` + `FLUXAOS_TEST_TARGET_REPO` + `FLUXAOS_TARGET_REPO_PATH` + `DATABASE_URL` (or `DIRECT_URL`). Skip cleanly when any are missing.
- Total budget: 8 minutes. Real Claude + real GitHub round-trip + epic propagation.

## 3. Non-goals

- **No mocking.** No mock daemon, no mock GitHub, no mock executor. The whole point is to prove the assembled system works.
- **Not replacing R-RUNTIME or R-EPIC journeys.** Both keep their narrower coverage; R-SMOKE is the cross-cutting acceptance gate.
- **Not exercising failure paths** (gate-fail retry, daemon crash recovery, deploy-bridge GitHub error). Each has its own journey or integration test. R-SMOKE is the happy-path proof.
- **Not asserting mission-control rendering.** R-MISSION-CONTROL's own journey covers that; R-SMOKE's UI is the issue/Run-Stage flow already covered by R-RUNTIME shape.
- **Not testing GitHub webhooks.** Production has no webhook listener today; cleanup-after-PR-close is invoked by direct service call. Wiring a webhook listener is post-alpha.
- **Not writing a new mutation surface for `onPrClosed`.** The cleanup service is exposed in-process; the test invokes it through a small test helper that imports the service directly (no tRPC hop). Spec §7 details the seam.

## 4. Requirements

### R-SMOKE.R1 — Spec file

- New file `e2e/r-smoke.spec.ts`.
- `test.describe('@r-smoke @journey @alpha-acceptance')` with `test.skip(!HAS_ALL_CREDS, …)` mirroring R-RUNTIME.
- Single `test('alpha acceptance: epic + child → daemon → PR → review → close → parent auto-close → cleanup', …)`.
- `test.setTimeout(8 * 60_000)`.

### R-SMOKE.R2 — Daemon spawn boilerplate

- Reuse the spawn pattern from `e2e/r-daemon-autonomous-run.spec.ts` and `e2e/r-mission-control.spec.ts`. Lift it into `e2e/helpers/daemon.ts` (NEW) so all three spec files share the same boot/shutdown contract. Helper exports `spawnDaemon(): Promise<{ daemon: ChildProcess; shutdown: () => Promise<void>; stdout: string[] }>`.
- `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS=60`, shutdown wait timeout 90s (matches R-MISSION-CONTROL fix).
- All three existing specs (`r-daemon-autonomous-run`, `r-mission-control`, `r-smoke`) refactored to use the helper. The lift is in-scope here since R-SMOKE is the third caller; deduplicating is cheaper than copy-paste a third time.

### R-SMOKE.R3 — Epic + child setup via UI

- Navigate to `/issues/1`. Find the "Create child issue" button on RelationshipsCard. Click it; fill in title `R-SMOKE child` and minimum required fields. Submit. The new child appears in the parent's children list and gets number 2 (or N+1 — derive from the response).
- Verify Run Stage on parent #1 is disabled OR shows the `ISSUE_IS_EPIC` rejection. Two acceptable signals:
  1. `runStageButton.isDisabled() === true`, OR
  2. Click + assert toast/text matching `/cannot run stage on an epic|ISSUE_IS_EPIC/` AND no pipeline_run row was minted for issue #1 in the DB.

### R-SMOKE.R4 — Child run drives to PR

- On the child issue, advance state to `Implement` and click Run Stage.
- Poll for terminal-with-PR per R-RUNTIME T17's pattern (DEF-020 fix). Cap 5 minutes.
- Assert (DB): pipeline_run.status='completed', child_issue.state.key='review', issue_pull_request row exists with non-null `pr_url` and `pr_number`, state='open'. issue_branch row matches `fluxaos/issue-<childNumber>-`.
- Assert (GitHub via Octokit): branch reachable, PR open, head ref matches.
- Assert (filesystem): isolation_environment row's `working_path` does NOT exist on disk.

### R-SMOKE.R5 — Child close → parent auto-close

- After R4 succeeds, transition the child to a terminal state via tRPC (e.g. `done` or whatever the seeded terminal is). Use the same `transition()` helper pattern as `r-epic-hierarchy.spec.ts`.
- Assert: parent_issue.state moves to a terminal state (R-EPIC propagation).
- Optional: assert parent's activity feed renders the "Auto-closed — all child issues closed" label by visiting `/issues/1` and matching the text. Lightweight UI signal.

### R-SMOKE.R6 — PR-close cleanup

- Import `createCleanupService` directly in the spec, build it from the same `Database` + adapters context the daemon uses, and call `cleanupService.onPrClosed(prNumber, { merged: false })`.
- Assert: cleanup completes without throwing. The isolation_environment row is already `inactive` (terminal hook released it earlier) — `onPrClosed` is idempotent on already-released envs; spec asserts no error.
- Assert: an explicit cleanup-event log line written by `onPrClosed` is observable (or — if the cleanup-service signature is silent on already-released — assert the post-call DB state matches the pre-call DB state, proving idempotency).
- This is the alpha-shape "cleanup after PR closes" gate. Wiring an actual GitHub webhook listener that calls `onPrClosed` automatically is post-alpha.

### R-SMOKE.R7 — Console-error gate + teardown

- Console-error filter pattern matches R-RUNTIME (Adapter not registered / Missing env / Uncaught).
- Teardown: SIGTERM daemon (helper), close opened PRs via Octokit, delete remote branches, `sql.end()`.

### R-SMOKE.R8 — No new schema, no new daemon code

- Test-only changes plus the daemon-helper extraction from R2.
- The cleanup-after-PR-close path uses the existing `cleanupService.onPrClosed`. No new wiring, no new mutation, no new column.

### R-SMOKE.R9 — Verification

- `npx tsc --noEmit` clean.
- `npx vitest run` 249/249 (unchanged — no integration tests).
- `npx playwright test e2e/r-smoke.spec.ts` green when all creds present; skips cleanly otherwise.
- `npm run build` clean.
- Pre-commit lint + 500-line cap green on every commit.
- The two existing daemon-spawning specs (`r-daemon-autonomous-run`, `r-mission-control`) still pass after the helper extraction.

## 5. Risk and edge cases

- **Real Claude is variable in execution time.** Each stage is 30-90s; epic + child + 2-3 stages may approach the 5-min poll window. 8-min total budget gives 3 min of margin for daemon boot + UI + teardown.
- **GitHub rate limits.** Single test, ≤10 API calls. Within free-tier hourly budget.
- **DB connection during teardown.** R-RUNTIME pattern keeps `sql` open through the test body; R-SMOKE follows.
- **Daemon shutdown drains in-flight stage_runs.** With 60s grace + 90s test wait, this is comfortable.
- **`onPrClosed` race with terminal-hook cleanup.** The terminal hook releases the worktree on stage completion; by the time R6 runs, the env is already inactive. `onPrClosed` should be idempotent — verify.
- **Child issue numbering.** The seed creates issues #1 and #2 already (per recent seed verification). The child issue we create here would be #3. Spec must derive the child's number from the create response, not hardcode.
- **R-EPIC parent-state propagation.** R-EPIC's existing journey already proves this. R-SMOKE re-asserts because the journey shape demands it; if it fails, that's a new bug post-R-EPIC.

## 6. Schema verification

| Column | Table | Verified? |
|---|---|---|
| `pipeline_run.status` (pending → running → completed) | pipeline_run | yes (R-DAEMON regression fix) |
| `issue_pull_request.pr_url`, `pr_number`, `state` | issue_pull_request | yes (used by mission control) |
| `issue_branch.branch_name` | issue_branch | yes (used by R-RUNTIME journey) |
| `isolation_environment.status`, `working_path` | isolation_environment | yes (used by R-RUNTIME journey) |
| `issue.parent_issue_id` | issue | yes (R-EPIC) |

No migration. No new columns.

## 7. Cleanup-after-PR-close seam

The journey calls `cleanupService.onPrClosed` directly:

```ts
import { createCleanupService } from '@/core/cleanup/cleanup-service';
import { registry } from '@/config/registry';
// or assemble from registry + db + isolation + logger
const cleanup = createCleanupService({ db, isolation, logger, retentionDays, … });
await cleanup.onPrClosed(prRow.pr_number!, { merged: false });
```

Two acceptable assertions per §R6:

1. **Idempotency assertion (preferred):** the call resolves without throwing AND a post-call query of `isolation_environment` shows status='inactive' for the run AND `working_path` is gone from disk (already true after terminal hook).
2. **Log-line assertion (fallback):** if `onPrClosed` writes a structured log via the injected logger, capture stdout/stderr and grep for `cleanup.pr_closed_no_env` or `cleanup.removed`. Less robust because logger transport may not flush before the assertion.

Use #1.

## 8. Dependencies and integration points

- R-DAEMON — must be running.
- R-EPIC — drives parent/child propagation in §R5.
- R-RUNTIME — provides the deploy-bridge and the assertion pattern.
- R-ARTIFACTS — runs but isn't asserted; if a stage that reads/writes artifacts fails, the journey fails too.

## 9. Deferred / out-of-scope

- **GitHub webhook listener** that auto-invokes `onPrClosed` when a real PR is merged or closed — post-alpha. R-SMOKE simulates the call directly to prove the engine's response, not the integration with GitHub's event surface.
- **Multi-child epics.** R-SMOKE files one child. Multi-child fan-out is post-alpha.
- **Failure-mode coverage** (gate-fail retry, deploy-bridge GitHub error, daemon crash mid-run). Each has its own integration test or journey. R-SMOKE is happy-path acceptance.
- **Cross-project epics** (parent in project A, child in project B). Schema doesn't allow this; alpha is single-project anyway.
- **Auto-merge after review.** Operator-driven post-alpha.

## 10. What "Done" looks like

- The journey runs green end-to-end against a fresh-seeded DB + a disposable GitHub repo.
- The daemon-helper extraction is in place; the two prior specs still pass.
- Roadmap moves R-SMOKE to Done; "Next" becomes R-POLISH.
- An operator following the spec's preconditions (creds set, repo cloned at `FLUXAOS_TARGET_REPO_PATH`, dev server up) can `npx playwright test e2e/r-smoke.spec.ts` and watch the assembled engine deliver the alpha promise.
