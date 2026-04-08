---
phase: 01-foundation
plan: 03
subsystem: architecture
tags: [ports-and-adapters, interfaces, registry, supabase, auth]

requires:
  - phase: 01-foundation/01-02
    provides: Drizzle Database type for DatabaseProvider port
provides:
  - 10 port interfaces defining all external integration contracts
  - Adapter registry with env-based provider resolution
  - Supabase AuthProvider — first real adapter proving the pattern
affects: [01-04 tRPC skeleton, phase-2 issue/skill adapters, phase-3 persona routing, phase-4 pipeline engine, phase-6 AI adapters]

tech-stack:
  added: []
  patterns: [ports-and-adapters, lazy singleton registry, type-safe adapter resolution]

key-files:
  created:
    - src/core/ports/auth.ts
    - src/core/ports/git.ts
    - src/core/ports/issue.ts
    - src/core/ports/ai.ts
    - src/core/ports/database.ts
    - src/core/ports/queue.ts
    - src/core/ports/realtime.ts
    - src/core/ports/stage-executor.ts
    - src/core/ports/notification.ts
    - src/core/ports/storage.ts
    - src/core/ports/index.ts
    - src/config/registry.ts
    - src/config/index.ts
    - src/adapters/supabase/auth.ts
    - src/adapters/supabase/index.ts
  modified: []

key-decisions:
  - "Shared Unsubscribe type defined in auth.ts, imported by realtime.ts — single source"
  - "Registry uses lazy singleton pattern — factory registered, instance created on first get()"

patterns-established:
  - "Port interface pattern: one file per port in core/ports/, interface keyword, full typing"
  - "Adapter pattern: implements port interface, lives in adapters/{vendor}/, registers via registry.register()"
  - "Containment enforcement: grep for vendor names in core/ — zero tolerance"
  - "Barrel export: core/ports/index.ts re-exports all types"

duration: ~15min
started: 2026-04-08T06:50:00Z
completed: 2026-04-08T07:05:00Z
---

# Phase 1 Plan 03: Port Interfaces + Adapter Registry + Supabase Auth Summary

**10 port interfaces defining all external contracts, env-driven adapter registry, and Supabase AuthProvider proving the ports-and-adapters pattern end-to-end**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~15min |
| Started | 2026-04-08T06:50:00Z |
| Completed | 2026-04-08T07:05:00Z |
| Tasks | 3 completed |
| Files created | 15 |
| Files modified | 0 |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: All 10 port interfaces defined and exported | Pass | All importable from `@/core/ports`, tsc clean |
| AC-2: Adapter registry resolves providers from env vars | Pass | `registry.get('auth')` resolves Supabase when FLUXAOS_AUTH_PROVIDER=supabase |
| AC-3: Supabase AuthProvider implements AuthProvider port | Pass | Full interface satisfaction verified by tsc |
| AC-4: Zero vendor imports in core/ | Pass | grep confirms zero results for all vendor names |

## Accomplishments

- Defined 10 port interfaces covering every external integration point: auth, git, issues, AI, database, queue, realtime, stage execution, notifications, storage
- Created AdapterRegistry with lazy singleton pattern — factories registered, instances created on first access, env vars drive selection
- Implemented SupabaseAuthProvider as proof of the pattern — maps all Supabase auth types to port types, contained entirely within adapters/supabase/
- Established enforceable containment boundary: zero vendor imports in core/, verified by grep

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/core/ports/auth.ts` | Created | AuthProvider interface + User, Session, AuthResult types |
| `src/core/ports/git.ts` | Created | GitProvider interface + PullRequest, CreatePRParams types |
| `src/core/ports/issue.ts` | Created | IssueProvider interface + ExternalIssue types |
| `src/core/ports/ai.ts` | Created | AIProvider interface + CompletionParams/Result/Chunk types |
| `src/core/ports/database.ts` | Created | DatabaseProvider interface (wraps Drizzle connection) |
| `src/core/ports/queue.ts` | Created | QueueProvider interface + Job, JobOptions types |
| `src/core/ports/realtime.ts` | Created | RealtimeProvider interface (subscribe/broadcast) |
| `src/core/ports/stage-executor.ts` | Created | StageExecutor interface + ExecuteParams/Result types |
| `src/core/ports/notification.ts` | Created | NotificationProvider interface |
| `src/core/ports/storage.ts` | Created | StorageProvider interface (upload/download/list) |
| `src/core/ports/index.ts` | Created | Barrel export — all 10 ports + supporting types |
| `src/config/registry.ts` | Created | AdapterRegistry class + env var mapping + singleton export |
| `src/config/index.ts` | Created | Config exports + getConfig() debug helper |
| `src/adapters/supabase/auth.ts` | Created | SupabaseAuthProvider — maps Supabase auth to port types |
| `src/adapters/supabase/index.ts` | Created | Registry registration for supabase auth adapter |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Shared Unsubscribe type in auth.ts | Both auth and realtime ports need unsubscribe; single source prevents drift | realtime.ts imports from auth.ts |
| Lazy singleton registry | Adapters shouldn't instantiate until first use; avoids startup cost for unused adapters | Factories registered eagerly, instances created lazily on get() |

## Deviations from Plan

None — plan executed exactly as written.

## Next Phase Readiness

**Ready:**
- All 10 port interfaces available for any core/ module to import
- Adapter registry ready for additional adapters (GitHub, BullMQ, node-exec, etc.)
- Pattern proven end-to-end: port → registry → adapter
- Containment boundary enforced and verifiable

**Concerns:**
- None

**Blockers:**
- None

---
*Phase: 01-foundation, Plan: 03*
*Completed: 2026-04-08*
