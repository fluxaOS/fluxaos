# Session Handoff — fluxaOS
**Date:** 2026-05-07 06:40 PDT  
**Model:** Claude Sonnet 4.6  
**Branch:** main  
**HEAD:** d28048c

---

## What Was Accomplished

### FLX-198 — Orchestrator starvation fix (shipped)

The orchestrator was silently dropping `pending` pipeline_runs when `runningCount >= maxConcurrentRuns`. Because Realtime only fires on DB changes, those dropped runs sat forever — never recovered until the optional recovery sweep (which isn't always enabled).

**Fix:** Added `drainPending()` to `event-orchestrator.ts`:
- Walks all `pending` pipeline_runs FIFO, fills concurrency slots
- Called from `finishRun()` (slot freed), `start()` (startup gap), `recoverOnStartup()` (post-crash)
- `inFlight` Set guards against concurrent double-processing of the same runId
- `getPendingRuns()` added to `PipelineRunService`

**Verification:** `e2e/full-issue-lifecycle.spec.ts` passed in 40.8s with 20 pending fast-fail runs in the backlog.

**Merged:** PR #320 → d28048c. FLX-198 → Done in Linear.

---

## Session Boundary

Previous session ended with handoff at `docs/superpowers/handoffs/2026-05-07-flx-197-pipeline-truth-session-handoff.md` (FLX-197 shipped). This session started from that point.

---

## Issues Closed

- **FLX-198** — Orchestrator starves pipeline runs when many are dispatched at once → Done

---

## Open PRs Awaiting Action

- **PR #314** — Doc alignment changes (`.github/`, `website/docs-site/`, `CLAUDE.md`, `.gitignore`)
  - Vercel build rate limit hit at ~13:08 UTC; retry after ~24h (May 8 ~13:00 UTC)
  - Changes are in the working tree (unstaged) — see "Unfinished Work" below

---

## Working Tree State

Unstaged changes — PR #314 in-progress, safe to leave:
- `.claude/skills/session-end/SKILL.md` (deleted)
- `.claude/skills/session-start/SKILL.md` (deleted)
- `.gitignore` (modified)
- `.github/doc-drift-map.yml`, `.github/scripts/doc-drift.mjs`
- `CLAUDE.md`
- `docs/superpowers/plans/2026-05-04-user-docs-implementation.md`
- `e2e/playbook-pipeline-smoke.spec.ts` (deleted)
- `website/docs-site/` — multiple doc pages updated
- Untracked: `e2e/pipeline-result-doc-scripts.spec.ts`, `src/scripts/db/seed-backlog-test.ts`

These are PR #314 changes that stalled on the Vercel rate limit. They need a fresh PR once the limit resets.

---

## Known Issues / Follow-ups

- **FLX-199** (Medium, Deferred Fixes) — Concurrent INSERT overshoot: `getRunningRuns()` read and `updateRunStatus(running)` write have an `await` gap. Under burst load, N concurrent handlers all see the same stale running count and all proceed, causing `runningCount > maxConcurrentRuns`. The fix requires an atomic compare-and-swap or a DB-level advisory lock. Pre-existing, not introduced by FLX-198.

---

## Diagnostics Learned This Session

- **`npm run build:daemon` required before daemon stage execution** — `node .next/daemon/init-result-doc.mjs` is called during stage prep; if `.next/daemon/` doesn't exist, every stage fails silently. Run `npm run build:daemon` (33ms, esbuild) before starting the daemon.
- **Restart dev server after nuke+seed** — stale dev server returns 500 on all app pages after nuke because old org/user/project UUIDs no longer exist.
- **Fast-fail backlog for AC #3 testing** — `seed-fast-fail-backlog.ts` creates a no-driver pipeline + N pending runs; they fail in <1s each without Claude API calls. Used to verify drain behavior without timeout risk.

---

## Next Session Recommended Start

1. Check if Vercel rate limit has reset (24h from 13:08 UTC May 7)
2. If reset: push PR #314 doc changes, verify Vercel passes, merge
3. Otherwise: pick next FLX issue from the Alpha Release project queue
4. FLX-199 (concurrent overshoot) is the next meaningful orchestrator improvement
