# fluxaOS Session Handoff — 2026-05-07 (FLX-199 CAS)

**Session end:** 2026-05-07  
**Model:** Claude Opus 4.7 (1M context)  
**Branch:** main  
**HEAD:** 4aa5250

---

## What Was Accomplished

### FLX-199 — Pipeline-run concurrency CAS (PR #322, merged `4aa5250`)

The orchestrator had a classic TOCTOU race: `handleNewRun` read `getRunningRuns()` count across one await, then called `updateRunStatus('running')` across a second. Under concurrent Realtime INSERTs, N callers could all read the same stale MVCC snapshot and all pass the limit check, causing more than `maxConcurrentRuns` to flip to `running` simultaneously.

**Fix:** Postgres advisory transaction lock (`pg_advisory_xact_lock(8731442001)`) serializes all concurrent slot acquisitions through a single global mutex. The count check and status flip are combined into one conditional UPDATE:

```sql
UPDATE pipeline_run
   SET status = 'running', started_at = NOW(), updated_at = NOW()
 WHERE id = $runId
   AND status = 'pending'
   AND (SELECT COUNT(*)::int FROM pipeline_run WHERE status = 'running') < $max
RETURNING id
```

Returns 0 rows → limit already met or run no longer pending. New `tryAcquireRunningSlot(runId, maxConcurrent)` method added to `PipelineRunService` interface and implementation. `handleNewRun` and `drainPending` both simplified — all concurrency enforcement delegated to this single atomic gate.

**Test:** `src/__tests__/integration/orchestrator-concurrency.test.ts` — fires 12 parallel acquisitions with MAX=2 against real Supabase; asserts `acquiredCount <= MAX` (upper-bound safety, not exact count, because ambient dev-DB activity makes exact slot counts non-deterministic). 30s timeout to accommodate advisory-lock serialization (~330ms/tx × 12 sequential).

**Lock key note:** `8731442001` is a single global key — single-tenant assumption. FLX-148 tracks sharding by orgId for multi-tenant deployments.

### FLX-106 — Operator docs alignment (PR #321, merged `4febc86`)

Held from previous session waiting for Vercel rate limit reset. Merged cleanly at session start.

### FLX-191 / FLX-192 / FLX-88 — Blocked label applied

Three issues labeled `blocked` in Linear to signal they need external prerequisites:

- **FLX-191** — Pre-push Playwright gate depends on FLX-192
- **FLX-192** — fhc verify rollout: `cli_command: null` in projects.json and `sync_exclude_categories: ["git-hooks"]` prevent auto-sync; architecture decision needed
- **FLX-88** — Post-alpha brainstorm, labeled blocked to keep queue clean

---

## UAT Status

UAT healthy at `4aa5250`. Deployed via `./flux server uat build` after FLX-199 merged.

---

## Queue State

| Issue | Status | Notes |
|-------|--------|-------|
| FLX-199 | Done | Shipped this session |
| FLX-191 | Blocked | Waiting on FLX-192 |
| FLX-192 | Blocked | Architecture decision needed |
| FLX-88 | Blocked | Post-alpha brainstorm |

No unblocked issues remain. Queue is empty until FLX-192 is resolved or new issues are filed.

---

## Context Decisions Made This Session

- Advisory lock key `8731442001` is a stable constant; single-tenant assumption documented inline with FLX-148 reference.
- `drainPending` simplified to pure iteration — correctness owned entirely by `tryAcquireRunningSlot`. The drain loop is not a safety gate.
- Integration test asserts `<= MAX` not `=== MAX` — correct invariant for a shared dev DB with ambient activity.
- `hippo memory` skipped — fluxaOS is decoupled from fh-commons CLI.

---

## Next Session: Recommended Starting Point

1. Run `/session-start` to orient.
2. Check Linear for any new issues filed since this handoff.
3. If FLX-192 resolved, pick up FLX-191.
4. Otherwise file new FLX issues or pull from the post-alpha roadmap.

No open PRs, no stale branches, working tree clean.
