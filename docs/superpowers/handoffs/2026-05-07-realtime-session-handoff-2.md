# fluxaOS Session Handoff
**Date:** 2026-05-07 | **Model:** Claude Sonnet 4.6 | **Branch:** main | **SHA:** 741effe

---

## What Was Accomplished

### FLX-196 — IssueWatcher Realtime 401 root cause found and fixed

The investigation from the previous session (empty `project_id` in Realtime payload despite `REPLICA IDENTITY FULL`) was resolved. Root cause: the `issue` table was enrolled in the `supabase_realtime` publication (migration 0021) but never granted `SELECT` to `anon`, `authenticated`, `service_role`. Supabase Realtime's `postgres_changes` authorization checks these grants before delivering row data, even when RLS is disabled — returning `Error 401: Unauthorized` and `new: {}` when they're absent.

All other Realtime-subscribed tables (`event`, `issue_event`, `pipeline_run`, `stage_run`) had the grant applied at project setup time outside Drizzle. Fix: migration `0022_flx_196_issue_realtime_grants.sql` — `GRANT SELECT ON issue TO anon, authenticated, service_role`.

Verified end-to-end: `issue_watcher.dispatched` fires, `db:runs` shows pipeline run at `running`, EventOrchestrator picks up and executes stages.

**Key investigative finding:** `REPLICA IDENTITY FULL` is NOT related to the 401. Both DEFAULT and FULL fail without the grant. The bug was purely a missing privilege on the table.

### FLX-195 — IssueWatcher startup sweep

Added `startupSweep()` to `IssueWatcher.start()`. On every daemon boot, it queries all open issues, batch-excludes any with active pipeline runs, and routes each eligible issue through the existing `handleIssueEvent()` path (reusing all guards and the `inFlight` dedup set). Logs `issue_watcher.startup_sweep_complete` with dispatched count.

Verified live: on container recreate with new image, issue #1 (no prior run) was auto-dispatched with `dispatched: 1`.

### run-detail.ts schema fix

`src/scripts/db/run-detail.ts` (pre-existing untracked file) referenced a removed `pipelineEvent` export from schema. Fixed to use `event` table with `stageRunId` FK — was blocking Docker builds.

---

## Session Boundary

Session start derived from previous handoff marker at `1810ff8` (2026-05-07 earlier session). No `--since` override used.

---

## Issues Closed This Session

- **FLX-196** — IssueWatcher auto-dispatch not firing despite Realtime subscription (REPLICA IDENTITY investigation) → **Done**
- **FLX-195** — IssueWatcher startup sweep: dispatch open issues with no active run on daemon boot → **Done**

---

## Issues Still In Progress

- **FLX-102** — Internal dev build dogfood notes (standing intake thread, never closes)

---

## Open PRs

None. Both PRs merged to main this session.

---

## Container State

- `fluxaos-daemon` running new image (`b2d6e67`) via `docker-compose up -d --force-recreate`
- `fluxaos-web` still on previous image — the web server was not changed this session, no rebuild needed

---

## Untracked Files (pre-existing, not this session's work)

```
src/scripts/db/check-project.ts
src/scripts/db/diagnose-watcher.ts
src/scripts/db/pipelines.ts
tests/results/brand-create-form.png  (modified)
```

These were present at session start. `diagnose-watcher.ts` and `check-project.ts` may have been created by the previous session investigating FLX-193/196. Consider committing or deleting next session.

## Locked Stale Worktrees

Three worktrees locked by pid 2358998 (a live process — do NOT remove):
- `agent-a47f9af268605bdaf` → `flx-193-auto-dispatch`
- `agent-a9e0e48deaf7a33cc` → `flx-187-routing-validation`
- `agent-ac2f4e9ff7be6c1da` → `flx-186-git-sha-version`

These branches are from earlier sessions. If pid 2358998 is still alive next session, check if they're orphaned.

---

## Context Decisions

- **Grant pattern established:** Any table added to `supabase_realtime` publication MUST also have `GRANT SELECT TO anon, authenticated, service_role`. Document this as an invariant for future migrations.
- **No integration test for startupSweep:** The project has no IssueWatcher test coverage. The daemon live log is the verification gate. This is acceptable per project policy (no unit tests; integration tests against real Supabase). A future issue could add an integration test covering the sweep path.

---

## Next Session

Main is clean at `741effe`. IssueWatcher is fully operational (Realtime events + startup sweep). The next natural work items:

1. **Add Realtime grant invariant to docs** — `docs/invariants.md` should document that `supabase_realtime` publication enrollment requires the SELECT grant. File a deferred fix if not doing it now.
2. **Clean up untracked scripts** — `check-project.ts`, `diagnose-watcher.ts`, `pipelines.ts` — commit or delete.
3. **Pick next Linear issue** — check `list_issues` in FLX team for next backlog item.

```
Branch: main @ 741effe
Next action: /session-start → pick next FLX issue from backlog
```
