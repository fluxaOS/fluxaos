# fluxaOS — Session Handoff
**Date:** 2026-05-07  
**Model:** claude-sonnet-4-6  
**Branch:** main  
**Commit:** a3ef820  

---

## What Was Accomplished

### FLX-186 — Replace hardcoded version in nav (merged PR #307)
Replaced the static `v0.1.0-alpha` string in `src/components/nav.tsx:142` with `{process.env.NEXT_PUBLIC_GIT_SHA?.slice(0, 7) ?? 'dev'}`. Build pipeline now injects the git SHA at build time.

### FLX-187 — Write-time routing field validation (merged PR #308)
Added `assertRoutingFieldsValid()` in `src/server/routers/pipeline.ts` — called on stage create and update. Validates that `onPass`, `onFail`, and `fallback` are either a sentinel (`__complete__`, `__blocked__`) or the name of a real sibling stage in the same pipeline. Replaced freeform text inputs in `StageEditor` with a `RoutingSelect` component populated from live sibling stage names.

### FLX-193 — IssueWatcher auto-dispatch (merged PR #309)
Implemented `createIssueWatcher` in `src/core/orchestrator/issue-watcher.ts`. Subscribes to Supabase Realtime INSERT+UPDATE on the `issue` table. When an open issue with a `defaultPipelineId` has no active run, inserts a `pipeline_run` at `pending` — EventOrchestrator picks it up automatically. Wired into daemon startup/shutdown lifecycle.

### FLX-194 — Bundle pipeline scripts for Docker (merged PR #310)
`scripts/build-daemon.mjs` now bundles `init-result-doc.ts` and `ingest-result-doc.ts` into `.next/daemon/` as `.mjs` files. Default script paths in `src/config/env.ts` updated from `src/scripts/pipeline/*.ts` → `.next/daemon/*.mjs`. Invocation changed from `npx tsx` → `node` in `langgraph-stage-runner.ts`. Stage runner in Docker no longer fails with `ERR_MODULE_NOT_FOUND`.

### FLX-193 Realtime follow-up (two additional commits on main)
- `9aa7528` — Migration `0021_flx_193_issue_realtime.sql`: enrolls `issue` table in `supabase_realtime` publication. Applied and confirmed working (Realtime events now arrive at daemon).
- `a3ef820` — Applied `ALTER TABLE issue REPLICA IDENTITY FULL` and added warn-level diagnostic logging to `resolveOpenStatusId` in `issue-watcher.ts`.

---

## Session Boundary
Used `2026-05-07T00:00:00` (session date). No hippo memory marker available in this environment.

---

## Issues Still In Progress

**FLX-196** (High, In Progress) — IssueWatcher auto-dispatch not firing: Realtime events arrive, but `project_id` in payload is empty string. Root cause investigation ongoing. `REPLICA IDENTITY FULL` confirmed set (`relreplident = 'f'`). The failing event at `09:01:14` may have been captured in WAL before the identity change took effect — a fresh UPDATE after the daemon restart should confirm or rule this out.

**FLX-195** (filed this session) — IssueWatcher startup sweep: query and dispatch existing open issues on daemon boot (covers restarts and seeded issues without requiring a DB event).

---

## Open PRs
None — all PRs merged.

---

## Known Blockers / Unfinished Work

- **FLX-196 needs one more test**: Trigger a fresh `UPDATE` against the `issue` table after the current UAT daemon (SHA `a3ef820`) is running and confirm that daemon logs show `issue_watcher.dispatched` (not `resolve_status_error`). If still empty, deeper Supabase Realtime payload investigation is needed.
- **Diagnostic scripts not committed**: `src/scripts/db/diagnose-watcher.ts`, `check-project.ts`, `pipelines.ts`, `run-detail.ts` are untracked. `diagnose-watcher.ts` was useful; the others are debug artifacts. Clean up before next feature branch.

---

## Context Decisions

- `REPLICA IDENTITY FULL` applied directly (not via migration re-run) because the migration had already been applied without it. The migration SQL file was updated to include it for future clean installs.
- `issue` Realtime enrollment confirmed working — the `09:01:14` daemon log shows the subscription IS receiving events. The payload column issue is the remaining blocker.

---

## Next Session

**Start with `/debugging` skill.**

```
Branch: main @ a3ef820
Next action: /debugging FLX-196

FLX-196 — IssueWatcher: project_id empty in Realtime payload despite REPLICA IDENTITY FULL
  1. Trigger: npx tsx -e "..." to UPDATE issue #1 (use the inline pattern from diagnose-watcher.ts)
  2. Watch: docker logs fluxaos-daemon 2>&1 | grep issue_watcher
  3. If project_id still empty: investigate whether Supabase Realtime column filtering
     is at play, or check if the Supabase project has column-level security on `issue`.
  4. If resolved: confirm issue_watcher.dispatched + npm run db:runs shows pending run.

FLX-195 — IssueWatcher startup sweep (implement after FLX-196 resolved)
```
