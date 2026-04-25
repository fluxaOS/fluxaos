# R-SMOKE — Implementation plan

**Date:** 2026-04-25
**Spec:** [`../specs/2026-04-25-r-smoke-design.md`](../specs/2026-04-25-r-smoke-design.md)

---

## Plan-phase reconciliation

1. **Daemon spawn boilerplate is already duplicated across two specs** (`r-daemon-autonomous-run.spec.ts`, `r-mission-control.spec.ts`). ✅ Confirmed — both have ~50 LoC of identical spawn/wait-for-sentinel/SIGTERM logic. Lifting it now (third caller arriving) is the right time.
2. **R-RUNTIME journey is the closest precedent for the deploy-bridge assertions.** ✅ Already inspected; lines 100-241 cover repo-pointing, terminal-with-PR poll, DB assertions, GitHub Octokit assertions, and worktree-removed assertion. Most of R-SMOKE R4 is a near-port of that block.
3. **R-EPIC journey already drives parent/child setup.** ✅ `r-epic-hierarchy.spec.ts` uses `tRPC issue.transition` directly via `page.request.post` to walk states. R-SMOKE reuses the same `transition()` helper pattern for the parent auto-close step.
4. **Cleanup service assembly is daemon-internal but reproducible from the test.** ✅ `src/scripts/daemon.ts` lines 159-173 show the exact dependency wiring: `db`, `isolation`, `logger`, `git: { hasUncommittedChanges, isBranchMerged, getCanonicalRepoPath, listArtifactDirs }`. The test builds the same shape.
5. **Seed already creates issue #1 (and a verified second issue #2 for the already-complete test case).** ✅ Seed-verify shows 2 issues. R-SMOKE creates a NEW child issue for #1 — that child becomes #3 (numeric sequence is per-project).
6. **`pipeline.runs.trigger` rejects parents-with-open-children with `ISSUE_IS_EPIC` per R-EPIC.** ✅ Confirmed `src/server/routers/pipeline.ts` lines 130-133. The journey can either click + assert toast or hit tRPC directly + assert error.
7. **`onPrClosed` is exposed in-process and idempotent on already-released envs.** ✅ Per `src/core/cleanup/cleanup-service.ts` lines 401-440 — it logs `cleanup.pr_closed_no_env` when the env is already inactive and exits cleanly.
8. **Issue creation via `issue.create` tRPC.** ✅ Used elsewhere; the journey's child-issue creation can either click the UI affordance or hit the tRPC mutation. UI-first per R-EPIC pattern; falls back to tRPC if the affordance is fragile.

**Plan-phase decisions on open questions (defaulted per AGENT_BEHAVIOR.md — no questions during a session):**

- **Daemon helper file path:** `e2e/helpers/daemon.ts`. Exports `spawnDaemon(): Promise<DaemonHandle>` with `daemon`, `stdout`, `shutdown()`. Two existing specs migrate first, then R-SMOKE consumes.
- **Child-issue creation: UI-first.** R-SMOKE.R3 uses the RelationshipsCard "Create child issue" affordance via the page. If the affordance changes shape and breaks the test, fall back to a direct `issue.create` tRPC POST.
- **Parent rejection assertion: prefer `runStageButton.isDisabled()`.** If the button isn't disabled (UI shows the message via toast/state instead), fall back to clicking and matching toast text. Both are R-EPIC-correct outcomes.
- **Child terminal state for R-SMOKE.R5:** the journey transitions the child through to whatever the seed marks `isTerminal: true` AND a status with `isClosed: true` config. Per seed.ts, the terminal state is `done` (or whatever the seed names it). Test queries for `isTerminal=true` to find the target.
- **`onPrClosed` invocation: build cleanup service in-test.** Mirror daemon.ts's wiring (lines 159-173). No tRPC mutation needed.
- **Console-error filter:** verbatim from R-RUNTIME (`Adapter ".*" is not registered|Missing required environment variable|Missing Supabase config|Uncaught`).
- **Test budget: 8 min total, 5 min poll for terminal-with-PR.** Same caps as R-RUNTIME.

---

## Task breakdown

### Wave 1 — Daemon helper extraction

**T1.** Create `e2e/helpers/daemon.ts`:
- Export `spawnDaemon(opts?: { graceSeconds?: number; recoveryIntervalMin?: number }): Promise<DaemonHandle>`.
- `DaemonHandle` exposes `daemon: ChildProcess`, `stdout: string[]`, `shutdown(): Promise<void>`.
- Defaults: `graceSeconds=60`, `recoveryIntervalMin=5`. Boot timeout 30s, shutdown timeout 90s (matches R-MISSION-CONTROL fix). Boot regex: `/daemon\.started /`.
- The `shutdown` function sends SIGTERM, races against the 90s timeout, throws on miss.

**T2.** Refactor `e2e/r-daemon-autonomous-run.spec.ts` to use the helper. Trim the boilerplate; keep the test body identical. Re-run live (Case A) to verify.

**T3.** Refactor `e2e/r-mission-control.spec.ts` Case B to use the helper. Re-run combined cases live.

**Commit:** `R-SMOKE W1: extract e2e/helpers/daemon.ts; migrate r-daemon and r-mission-control journeys`.

### Wave 2 — R-SMOKE journey

**T4.** Create `e2e/r-smoke.spec.ts`:
- Header docstring per R-RUNTIME pattern: cred preconditions, what's asserted.
- Cred guards (`HAS_ALL_CREDS`).
- `test.describe('@r-smoke @journey @alpha-acceptance')`.
- `test.setTimeout(8 * 60_000)`.
- Single test block with these phases:
  1. **Setup:** `tsx src/scripts/db/nuke.ts` + `npm run db:seed` via `execSync` (R-RUNTIME pattern).
  2. **Spawn daemon** via the W1 helper.
  3. **Point project at sandbox repo** via direct `UPDATE project` (R-RUNTIME shape).
  4. **Visit parent #1**, assert RelationshipsCard renders.
  5. **Create child** via the UI affordance; capture child issue number from the response.
  6. **Verify parent rejection:** `runStageButton.isDisabled() === true` on parent. If not disabled, click + assert toast/error.
  7. **Walk child:** advance state to Implement, click Run Stage.
  8. **Poll for terminal-with-PR** (DEF-020 fix, R-RUNTIME pattern), 5-min cap.
  9. **Assert DB state** for the child: pipeline_run.status='completed', issue.state='review', issue_pull_request row exists, issue_branch row prefix matches `fluxaos/issue-<childN>-`.
  10. **Assert GitHub state** via Octokit: branch reachable, PR open, head ref matches.
  11. **Assert filesystem:** isolation_environment.working_path does NOT exist on disk.
  12. **Transition child to terminal state** via `transition()` tRPC helper (R-EPIC pattern).
  13. **Assert parent auto-close:** parent's state moves to terminal.
  14. **Build cleanup service in-test** (daemon.ts lines 159-173 wiring); call `onPrClosed(prNumber, { merged: false })`.
  15. **Assert idempotency:** call resolves without throwing; isolation_environment row stays inactive; working_path remains gone.
  16. **Console-error gate:** R-RUNTIME pattern.
  17. **Track PR for teardown:** push `{ owner, repo, prNumber, branchName }` onto the openedPRs array.
- `test.afterAll(...)`: SIGTERM via helper, close PRs via Octokit, delete remote refs.

**T5.** Smoke-validate against the live sandbox. Operator preconditions:
- `set -a; source .env.local; set +a`
- `npm run dev -- -p 3013` (or whichever port — set `PLAYWRIGHT_BASE_URL`)
- Disposable repo cloned at `FLUXAOS_TARGET_REPO_PATH`, on `main`, clean
- `FLUXAOS_TEST_TARGET_REPO=jdpierce21/fluxaos-alpha-e2e-sandbox` (matches existing operator env)

Run: `PLAYWRIGHT_BASE_URL=http://192.168.54.101:3013 npx playwright test e2e/r-smoke.spec.ts --reporter=line`. Expected: green in 4-7 min. If it times out at the terminal-with-PR poll, inspect daemon stdout (helper exposes it) — most likely Claude is slow or the deploy bridge tripped on a GitHub auth issue.

**Commit:** `R-SMOKE W2: e2e/r-smoke.spec.ts — alpha acceptance journey`.

### Wave 3 — Roadmap + handoff

**T6.** Update `docs/superpowers/roadmap.md`:
- Move R-SMOKE to Done with spec + plan links in the Done table.
- Update Alpha "Next" to R-POLISH.
- Append one sentence to current-engine-state paragraph: "The full alpha acceptance journey (epic + child → daemon → PR → review → close → parent auto-close → cleanup) is captured in `e2e/r-smoke.spec.ts` and runs green against a disposable sandbox repo."

**Commit:** `R-SMOKE W3: roadmap`.

---

## Verification matrix per wave

| Gate | W1 | W2 | W3 |
|---|---|---|---|
| `tsc --noEmit` | required | required | required |
| `vitest run` | required (no test changes; just refactor side-effect check) | required | required |
| Existing daemon-spawning specs (`r-daemon-autonomous-run`, `r-mission-control`) green | required | required | required |
| `playwright test e2e/r-smoke.spec.ts` against live creds | n/a | required | required |
| `npm run build` | n/a | required | required |
| Pre-commit lint + 500-line cap | required | required | required |

---

## Rollback strategy

Each wave is one atomic commit:
- W1 revert removes the helper and restores boilerplate (touches 3 files).
- W2 revert removes the journey file (1 file).
- W3 revert reverses the roadmap update (1 file).

No code paths in `src/` change. No DB migrations. Pure test-surface delta.

---

## Goal-backward verification

**Phase goal:** "Playwright journey: file an epic with one child issue, wait for the daemon to pick it up, confirm the worker ran in an isolated worktree, confirm a PR was opened, confirm the issue advanced to `review`, confirm the worktree gets cleaned up after the PR closes. This is the alpha acceptance test."

| Goal element | Delivered by |
|---|---|
| Playwright journey | W2 — `e2e/r-smoke.spec.ts` |
| File an epic with one child | W2 step 4-5 |
| Wait for daemon pickup | W1 helper boots daemon; W2 step 8 polls terminal-with-PR |
| Worker ran in isolated worktree | W2 step 11 — isolation_environment.working_path was real, then removed |
| PR was opened | W2 step 9-10 — DB + Octokit assertions |
| Issue advanced to `review` | W2 step 9 — `issue.state.key='review'` |
| Worktree cleaned up after PR closes | W2 step 14-15 — `onPrClosed` + idempotency assertion |

Every goal element traces to a step + a verification gate.
