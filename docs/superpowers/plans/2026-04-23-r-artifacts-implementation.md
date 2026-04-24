# R-ARTIFACTS — Implementation plan

**Date:** 2026-04-23
**Spec:** [`../specs/2026-04-23-r-artifacts-design.md`](../specs/2026-04-23-r-artifacts-design.md)
**Prior art:** [Archon](https://github.com/coleam00/Archon) — `$ARTIFACTS_DIR` convention, shape-only borrow.

---

## Plan phase reconciliation

Before task breakdown, the plan phase verifies three spec claims against the live codebase:

1. **`pipeline_run` has no `artifacts_path` column.** ✅ Confirmed via `grep -n "artifactsPath\|artifacts_path" src/core/db/schema.ts` → no hits. T1 adds it.
2. **`isolation_environment` has no `artifacts_path` column.** ✅ Confirmed — `src/core/db/schema.ts` lines 483-515 show 10 columns, none artifact-related. T1 adds it.
3. **`AcquireEnvironmentParams` has no `artifactsPath` field.** ✅ Confirmed — `src/core/ports/isolation.ts:14-22`. T2 extends it.

**DEF-019 (drizzle meta drift) still active.** Migration 0008 must be hand-written the same way 0007 was. T1 includes the manual journal entry step.

**DEF-020 (journey test race) integration.** Per spec open question #5, fix DEF-020 alongside R-ARTIFACTS because the new assertions (`research-findings.md` exists, `plan.md` referenced in transcript) require a reliable terminal signal. T18 lands the fix.

**Plan-phase decisions on open questions (defaulted per AGENT_BEHAVIOR.md "no questions during a session"):**

- **Retention default:** seed as 30 days. Archon reference in prior-art doc uses similar; no user-set number to override.
- **Compute owner for artifacts_path:** isolation provider owns. Orchestrator reads the returned `env.artifactsPath` and writes it to `pipeline_run.artifacts_path` for observability.
- **Journey test:** new file `e2e/r-artifacts-chain.spec.ts`. Keeps R-RUNTIME journey focused; the new one inherits the same env-var gating.
- **Seed scope:** all five skills get prompt amendments. Partial rollout trains operators to distrust the feature.
- **DEF-020:** fixed in this phase (T18).

---

## Task breakdown (20 tasks, 8 waves)

### Wave 1 — Schema + ports (no runtime impact)

**T1 — Migration 0008 (hand-written)**
- Author `drizzle/0008_r_artifacts.sql` with:
  - `ALTER TABLE "pipeline_run" ADD COLUMN "artifacts_path" text;`
  - `ALTER TABLE "isolation_environment" ADD COLUMN "artifacts_path" text;`
- Extend `drizzle/meta/_journal.json` with a hand-authored 0008 entry (same pattern as 0007).
- Update `src/core/db/schema.ts` to add `artifactsPath: text('artifacts_path')` on both tables.
- Apply locally via `npm run db:migrate` and verify via `information_schema.columns` query.
- Commit-scoped: migration + schema + journal only. No runtime changes yet.

**T2 — Port extensions**
- `src/core/ports/isolation.ts`:
  - `AcquireEnvironmentParams` gains optional `artifactsPath?: string`.
  - `IsolationEnvironment` gains `artifactsPath: string | null`.
- `src/core/ports/index.ts` — no re-export change (already barrels the whole file).
- Zero runtime impact yet; consumers default `artifactsPath` to `null` on the return type.

### Wave 2 — Path resolver + FS helpers (pure shell-outs, parallel-safe)

**T3 — Artifacts path resolver**
- New `src/adapters/git/artifacts-path.ts`:
  - `getArtifactsBase(repoPath: string): string` — mirrors `getWorktreeBase()` logic. Default `<repoPath>/.fluxaos-artifacts/`, override via `FLUXAOS_ARTIFACTS_ROOT` or `FLUXAOS_WORKSPACE_ROOT`. Matches R-RUNTIME precedent exactly.
  - `getArtifactsPath(repoPath: string, runId: string): string` — joins base + runId.
- Barrel in `src/adapters/git/index.ts`.
- 6 integration tests against tmpdir (similar shape to `path-resolver.test.ts`).

**T4 — Artifacts FS helpers**
- New `src/adapters/fs/artifacts.ts` (new directory; artifacts are not git-specific):
  - `ensureArtifactsDir(path: string): Promise<void>` — mkdir -p, idempotent.
  - `removeArtifactsDir(path: string): Promise<void>` — rm -rf, tolerates ENOENT.
  - `listArtifactDirs(base: string): Promise<string[]>` — returns absolute paths.
  - `getArtifactsDirAge(path: string): Promise<Date>` — stats dir mtime.
- Barrel via new `src/adapters/fs/index.ts`.
- 7 integration tests against tmpdir.

**T5 — Auto-gitignore for artifacts**
- Extend existing `ensureGitignoreEntry()` helper (R-RUNTIME shipped this; grep confirms location) to take a pattern arg OR add a second helper `ensureArtifactsGitignored(repoPath: string)`.
- Called from isolation provider T6 on first artifacts dir creation in the in-project layout only (no-op when `FLUXAOS_WORKSPACE_ROOT` or `FLUXAOS_ARTIFACTS_ROOT` points outside the repo).
- 4 integration tests: entry present (no change), entry missing (appended), FLUXAOS_ARTIFACTS_ROOT set (no-op), `.gitignore` file missing (created).

### Wave 3 — Isolation provider (DB + FS aware)

**T6 — Extend `worktree-isolation-provider.ts`**
- On every `acquire()` path (3 branches: existing-row+worktree → reuse; existing-row-no-worktree → repair; fresh mint):
  - Compute `artifactsPath = getArtifactsPath(repoPath, runId)`.
  - `ensureArtifactsDir(artifactsPath)` (idempotent — stage 2+ gets the same dir).
  - Write `artifacts_path` to the `isolation_environment` row.
  - Call `ensureArtifactsGitignored(repoPath)` on fresh-mint only (in-project layout only).
  - Return `artifactsPath` on the `IsolationEnvironment` object.
- On `release()`: **do not remove artifactsPath.** Artifacts outlive worktrees; cleanup service owns reap.
- 3 new integration tests: fresh mint creates dir + records path, repair preserves existing path, gitignore line is present after first acquire.

### Wave 4 — Cleanup service (subagent: T7+T8)

**T7 — Cleanup-service artifacts reaping**
- Extend `CleanupGitHelpers` DI bag with `artifactsFs: { listArtifactDirs, removeArtifactDir, getArtifactsDirAge }`.
- New safety check `isArtifactsSafeToRemove(runId, ageMs)` returns `'stale' | 'active-run' | 'retention-not-reached'`. Joins filesystem dir against `pipeline_run` by `run_id` (dir name).
- `runScheduledSweep()` gains a second pass: list artifact dirs under each known workspace root, reap each where the pipeline_run is terminal AND age > `FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS`.
- `onPrClosed()`: no-op for artifacts (retention-window based, not PR-state based).
- `cleanupToMakeRoom()`: artifacts are a second-tier reap target (only if worktree pass didn't free enough — tracked via a `freedBytes` accumulator or a `needsMoreRoom` boolean, plan-phase pick).
- `removeEnvironment(envId, { force: true })`: removes the artifactsPath recorded on the env row.
- 5 integration tests: scheduled sweep reaps stale, leaves non-terminal, leaves too-young terminal; force-remove reaps artifacts dir; onPrClosed leaves artifacts alone.

**T8 — Cleanup-scheduler env-var extension**
- Read `FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS` alongside the existing three.
- Refuse to start if any of the 4 are unset/unparseable (single `cleanup_scheduler.disabled_missing_env` warning — same style as R-RUNTIME T8).
- 2 scheduler tests: starts when all 4 env vars set; skips when any one is missing.

### Wave 5 — Orchestrator wiring

**T9 — Derive helper**
- New `src/core/orchestrator/artifacts-derivation.ts`:
  - `deriveArtifactsPath({ repoPath, runId })` — thin wrapper around `getArtifactsPath()` so the orchestrator doesn't import adapters directly (invariant 7).
- Actually, simpler: inject an `ArtifactsHelpers` DI bag (like `CleanupGitHelpers`) into `manual-run.ts` / `event-orchestrator.ts`. Plan-phase note: pick DI-bag pattern — no core → adapter imports.
- No tests; trivial wrapper.

**T10 — Pipeline-run creation writes artifactsPath**
- In `src/core/orchestrator/pipeline-run-service.ts` (grep to find the `create`/`start` function), at pipeline-run insert time:
  - Resolve artifactsPath from the DI bag (or from env returned by the first stage's acquire — decided below).
  - Write to the `pipeline_run.artifacts_path` column.
- **Resolution order:** artifactsPath is *computed* in T3 (resolver), *recorded* on isolation_environment by T6 (provider), *read-back and persisted* on pipeline_run in T10 (orchestrator). The orchestrator writes the field AFTER the first `acquire()` call returns, not before — no race risk.
- 2 integration tests: pipeline_run row has artifacts_path after first stage acquires; second stage reuses the same path (observed via both the env row and the pipeline_run row agreeing).

**T11 — Stage-runner threads artifacts_path into materialize + template**
- `src/core/orchestrator/stage-runner.ts`:
  - Line ~206-229: pass `artifactsPath: env.artifactsPath` into `materialize({...})` options (materializer ignores if undefined — see T12).
  - Line ~235-241: extend `renderTemplate` params with `artifacts_path: env.artifactsPath`.
- Zero behavior change for templates that don't reference `{{artifacts_path}}`.
- 1 integration test: a stub skill template containing `{{artifacts_path}}` interpolates to the actual path.

**T12 — Materializer optional artifactsPath**
- `src/core/skills/materializer.ts` gains optional `artifactsPath?: string` on its options.
- If provided: write a line to the end of `CLAUDE.md` (or the `instructionsFile` per driver config) stating the artifacts path. Stage prompts read from `CLAUDE.md`, so this ensures the skill sees it even if the raw prompt template lacks the token.
- Actually simpler: materializer ignores `artifactsPath`; the prompt template is the single injection point. **Decision: drop T12, keep materializer unchanged.** The seed skill templates (T13) already use `{{artifacts_path}}`.

*(T12 removed from final count — 19 tasks.)*

### Wave 6 — Seed data

**T13 — Amend seed skill promptTemplates**
- `src/scripts/db/seed.ts`:
  - Research skill: append artifact-write instruction.
  - Implement skill: append artifact-read + plan-write instructions.
  - Review skill: append plan-read + verdict-write instructions.
  - Rework skill: append review-findings-read instruction.
  - Deploy skill: unchanged.
- Update `src/__tests__/integration/seed.test.ts` (or the existing verify suite) to assert each amended skill's promptTemplate contains `{{artifacts_path}}`.
- Re-run `npm run verify` locally (expect 10/10 still).

### Wave 7 — E2E journey (subagent: T14+T15 parallel-safe)

**T14 — Research → Implement chain journey**
- New `e2e/r-artifacts-chain.spec.ts` (based on structure of `r-runtime-deploy-journey.spec.ts`):
  - Same env-var gating (`ANTHROPIC_API_KEY`, `FLUXAOS_GITHUB_TOKEN`, `FLUXAOS_TEST_TARGET_REPO`, `FLUXAOS_TARGET_REPO_PATH`, `DATABASE_URL`).
  - Nuke+seed+patch-project same as R-RUNTIME journey.
  - **Key change from R-RUNTIME:** use a pipeline with *two* stages (Research → Implement), not the single-stage default. Journey test patches/seeds this if needed.
  - Drive issue #1 through Research → Implement via UI; wait for terminal.
  - Assertions:
    - `<workspace_root>/.fluxaos-artifacts/<runId>/research-findings.md` exists and is non-empty.
    - Stage 2's stage_run transcript contains a tool-call entry with `toolCommand` matching `research-findings.md` (proves consumption).
    - After release, worktree dir is gone but artifacts dir persists.
    - PR #N on sandbox (R-RUNTIME assertions still hold — deploy bridge fires on pipeline terminal).
    - `pipeline_run.artifacts_path` in DB matches the on-disk dir.
- Teardown: close PR + delete branch + force-remove artifacts dir (so the next run starts fresh).

**T15 — Cleanup sweep journey (integration test, not E2E)**
- New `src/__tests__/integration/artifacts-cleanup.test.ts`:
  - Create a fake terminal pipeline_run row + fake artifacts dir with backdated mtime.
  - Run `cleanupService.runScheduledSweep()`.
  - Assert dir is reaped, DB pipeline_run.artifacts_path is left as-is (historical record), and the isolation_environment row's `artifacts_path` is optionally nulled (plan-phase decide: nulling makes "where was this?" lookups harder for post-hoc debug, so leave as-is).
- 4 assertions: stale reaped, young preserved, non-terminal preserved, sweep touches multiple dirs in one run.

### Wave 8 — Docs + verification + cleanup

**T16 — Bootstrap registration + docs**
- `src/config/bootstrap.ts`: no new adapter registrations needed (artifacts-fs is in `src/adapters/fs/` but consumed via DI bag, not the registry). Double-check and confirm.
- `CLAUDE.md`: add `FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS` and `FLUXAOS_ARTIFACTS_ROOT` to the env-vars section.
- `docs/session-quick-start.md`: note the artifacts dir convention for operator debugging.

**T17 — Roadmap + DEF-019 + DEF-020 close notes**
- Move R-ARTIFACTS from `Next` → `Done — PR #XX` in `docs/superpowers/roadmap.md`.
- DEF-019 still active (migration 0008 hand-written). No close.
- DEF-020 fixed in T18 below — add `[RESOLVED 2026-04-23]` marker in `deferred-fixes.md`.

**T18 — Fix DEF-020 (journey test race)**
- Update `e2e/r-runtime-deploy-journey.spec.ts` poll loop: terminate when `issue_pull_request` row exists for the issue AND `pipeline_run.status` is terminal, not just on `pipeline_run.status`.
- Apply the same change to T14's new journey test (it inherits the pattern from R-RUNTIME).
- Mark DEF-020 `[RESOLVED 2026-04-23]` in `deferred-fixes.md`.

**T19 — Lint + typecheck cleanup**
- `npx tsc --noEmit` clean.
- `npm run lint` — zero net-new problems (baseline 52 after R-RUNTIME; accept same or fewer).
- `npm run build` passes.
- `npm run verify` — 10/10 still.

**T20 — Operator sign-off checkpoint**
- Same structure as R-RUNTIME T20: operator drives the two-stage journey from the UI, observes PR opens, `research-findings.md` exists at the artifacts path, Implement stage's transcript references it.
- Playwright journey passing is the mechanical proof; operator sign-off is the browser observation.

---

## Wave dependency graph

```
W1 ──► W2 ──► W3 ──┐
                   ├──► W5 ──► W6 ──► W7 ──► W8
        W1 ──► W4 ─┘
```

- W1 (schema + ports) must land before anything else.
- W2 (path resolver + FS) depends only on W1.
- W3 (provider wiring) depends on W1 + W2.
- W4 (cleanup service) depends on W1 + W2 (not W3 — cleanup queries the DB and FS directly, not the provider).
- W5 (orchestrator wiring) depends on W3 (provider returns artifactsPath).
- W6 (seed data) depends on W5 (templates interpolate artifacts_path).
- W7 (journey + integration tests) depends on W5 + W6.
- W8 (docs + cleanup) depends on W7 passing.

## Subagent delegation suggestions

Two rounds of parallel dispatch, copying the R-RUNTIME pattern that kept context lean:

- **Round 1** after T1+T2 land inline:
  - Agent A: T3 + T4 + T5 (path resolver + FS helpers + gitignore). All three are pure adapters, parallel-safe.
  - Agent B: T7 + T8 (cleanup service + scheduler). Parallel-safe with A; no shared state.
- **Round 2** after T6 + W5 land inline:
  - Agent C: T13 (seed amendments) + T14 (E2E journey). Seed flows into journey.
  - Agent D: T15 (cleanup integration test) + T16 (docs). Independent.

T18 (DEF-020 fix) lands inline as the last task of W8 since it touches journey code co-edited with T14.

---

## Verification matrix (per AGENT_BEHAVIOR.md)

| Gate | Expected outcome |
|---|---|
| `npx tsc --noEmit` | ✅ zero errors |
| `npm run lint` | ✅ ≤52 problems (baseline) |
| `npx vitest` (full suite) | ✅ 192 + ~25 new = ~217 pass, 1 skipped (GitHub adapter live test without creds) |
| `npm run verify` | ✅ 10/10 PASS |
| `npm run build` | ✅ compiled, warnings allowed |
| `npx playwright test e2e/r-artifacts-chain.spec.ts` | ✅ pass with live creds, skip clean without |
| `npx playwright test e2e/r-runtime-deploy-journey.spec.ts` | ✅ still passes after DEF-020 fix |
| Operator browser sign-off (T20) | ⏳ pending post-PR |

## Out-of-scope explicit list

(Same as spec non-goals, restated here so no agent invents them during execution:)

- No typed artifact schema. Stages agree on file names informally.
- No cross-run artifact sharing.
- No artifact browsing UI.
- No encryption / access control on artifact files.
- No rehydration after cleanup reaps.

---

## Rollback plan

If any wave breaks R-RUNTIME's green journey:

1. Revert the wave's commits via `git revert`.
2. Schema rollback: `ALTER TABLE pipeline_run DROP COLUMN artifacts_path; ALTER TABLE isolation_environment DROP COLUMN artifacts_path;` in a hand-written `drizzle/0009_rollback.sql`.
3. Roadmap rolls R-ARTIFACTS back to `Next`.
4. File an RCA at `docs/superpowers/rca/2026-04-XX-r-artifacts-rollback-rca.md`.

Rollback is per-wave, not per-task — W1 alone (schema + ports) is safe to leave in place even if W2+ are reverted.
