# fluxaOS Session Handoff — 2026-05-11 (Wave 3 + Test Debt)

**Model:** claude-sonnet-4-6 (1M context)
**Branch:** main
**Commit:** f3ee98b
**Session end:** 2026-05-11 ~12:30 PDT

---

## What Was Accomplished

### FLX-209 Wave 3 — Operational Config → DB (4 PRs)

The complete set of env-var-to-DB migrations landed sequentially:

| PR | Issue | What moved |
|----|-------|-----------|
| #346 | FLX-222 | `FLUXAOS_WORKSPACE_ROOT` → `config_entry: runtime.workspace_root` |
| #347 | FLX-223 | `FLUXAOS_ARTIFACTS_ROOT` → `config_entry: runtime.artifacts_root` |
| #348 | FLX-224 | `FLUXAOS_CLEANUP_*` + `FLUXAOS_RUN_CLEANUP_SCHEDULER` (5 vars) → `config_entry: cleanup.*` |
| #349 | FLX-221 | `FLUXAOS_TARGET_REPO_PATH` → `project.targetRepoPath` column |

**New pattern (reusable):** `src/core/services/runtime-config.ts` — `readGlobalConfigValue(db, key)` + `MissingGlobalConfigError` + `InvalidGlobalConfigError` + per-key typed accessors. Constants in `GLOBAL_CONFIG_KEY` (src/core/constants.ts). Each migration follows: Drizzle schema/data migration → seed default → `loadFluxaosConfig()` removal → env-file strip. FLX-221 is the per-project column variant (different shape).

**System.env.getPublic deleted** — the entire `src/server/routers/system.ts` was removed as part of FLX-221; its only consumer was the `FLUXAOS_TARGET_REPO_PATH` whitelist, which no longer exists.

### Test Debt Clearance — FLX-231 + FLX-234 (PR #350)

8 integration test files fixed:
- 5 `schema.issue` inserts missing `author: 'system'` (DB NOT NULL, no migration-level default)
- 14 `isolationProvider.acquire()` calls missing `baseBranch: 'main'` (hard guard added, fixture never updated)

29/30 tests in the affected suite now pass. The lone remaining case (`cleanup-service stale-detection`) is tracked as FLX-237.

---

## Session Boundary

`SESSION_START = 2026-05-11T03:00:00` (session-start marker written at session open).

---

## Issues Closed This Session

| Issue | Title |
|-------|-------|
| FLX-222 | Migrate FLUXAOS_WORKSPACE_ROOT to config_entry |
| FLX-223 | Migrate FLUXAOS_ARTIFACTS_ROOT to config_entry |
| FLX-224 | Migrate FLUXAOS_CLEANUP_* env vars to DB |
| FLX-221 | Migrate FLUXAOS_TARGET_REPO_PATH to project.targetRepoPath column |
| FLX-231 | deploy-bridge.test.ts fixture missing author column |
| FLX-234 | Two integration test files fail on main (pre-existing) |

---

## Issues Still Open (FLX-209 epic)

| Issue | Title | Notes |
|-------|-------|-------|
| FLX-207 | Projects form: every visible field editable | **Now unblocked** — FLX-221 landed the targetRepoPath column |
| FLX-226 | Slug rename safety | Unblocked |
| FLX-227 | Validate repoUrl at save | Unblocked |
| FLX-228 | Pipeline dropdown → setDefaultPipeline | Unblocked |
| FLX-229 | Kill brandId side-channel | Unblocked |
| FLX-233 | Parallel worktrees share git stash namespace | Backlog |
| FLX-237 | cleanup-service stale-detection returns safe=false | New, filed this session |

---

## Open PRs Awaiting Action

None. All session PRs merged.

---

## Known Environment Notes

- Three locked worktrees remain in `.claude/worktrees/` (agents aeb01e23, ac38899d, a4db3927) — all on merged branches. Harness sweep will reap them. Do NOT force-remove; the PIDs may still be attached.
- The shared git index occasionally ends up with spurious staged deletions of `.claude/AGENT_BEHAVIOR.md` and `ARCHITECTURAL_STANDARDS.md`. These files exist on disk and match HEAD — just run `git restore --staged .claude/AGENT_BEHAVIOR.md ARCHITECTURAL_STANDARDS.md` to clear. Root cause: one of the Wave 3 agents staged these during its worktree operations and the index contamination persists. FLX-233 (parallel stash collision) is related.
- `hippo memory list` fails with `column memory_entries.project does not exist` — hippo schema out of sync with its query layer. Workaround: read project memory directly from `~/.claude/projects/-mnt-dev-fluxaos/memory/` and the `$CMEM` banner in system-reminder.

---

## Context Decisions Made This Session

1. **Wave 3 dispatched sequentially** (not in parallel): FLX-222/223/224 share `src/config/env.ts`, `worktree-isolation-provider.ts`, `artifacts-path.ts`. Spec's own migration-order rubric also mandates this.
2. **config_entry vs project column**: global operational config → `config_entry` (scope='global'); per-project config → column on `project`. FLX-222/223/224 are the former; FLX-221 is the latter.
3. **system.env.getPublic** was the only place `FLUXAOS_TARGET_REPO_PATH` was surfaced to the Projects UI. After FLX-221 moved it to a real DB column, the entire router endpoint became dead and was deleted.
4. **FLX-234 stale-detection test** — the `stale (threshold=1, env aged 2 days) → safe` test was unblocked by the fixture fix but then hit a cross-test config_entry contamination bug. Filed as FLX-237 rather than including fix in FLX-231/234 scope.

---

## Next Session: Recommended Starting Point

```
Branch: main @ f3ee98b
Next: FLX-207 (Projects form redesign) — now unblocked by FLX-221

FLX-207 is the parent for FLX-226/227/228/229. These five issues all touch
the same Projects form files:
  src/app/[org]/[user]/[project]/settings/projects/descriptor.ts
  src/app/[org]/[user]/[project]/settings/projects/page.tsx
  src/server/routers/project.ts

Recommend: brainstorm/plan for FLX-207 + 226-229 as one coordinated slice
before dispatching — they'll conflict if parallelized naively. Then FLX-237
(cleanup stale-detection) after that.

Run before starting: ./flux env audit (should show PASS for both envs)
```
