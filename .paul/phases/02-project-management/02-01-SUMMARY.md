---
phase: 02-project-management
plan: 01
subsystem: issues
tags: [issue-lifecycle, trpc-crud, github-api, state-machine, drizzle]

requires:
  - phase: 01-foundation/01-04
    provides: tRPC router stubs, adapter registry pattern
provides:
  - Issue service with CRUD + state transitions + event logging
  - tRPC issue router with 5 real endpoints
  - GitHub IssueProvider adapter (native fetch)
affects: [02-02 skill service, 02-03 CLI, phase-4 pipeline issue integration, phase-5 issues UI]

tech-stack:
  added: []
  patterns: [service-layer CRUD, state machine transitions, event logging, native fetch adapter]

key-files:
  created:
    - src/core/issues/types.ts
    - src/core/issues/service.ts
    - src/core/issues/index.ts
    - src/adapters/github/issues.ts
    - src/adapters/github/index.ts
    - src/__tests__/issues.test.ts
  modified:
    - src/server/routers/issue.ts

key-decisions:
  - "Native fetch for GitHub API — no Octokit dependency for alpha"
  - "State machine via lookup map (VALID_TRANSITIONS) — simple and explicit"

patterns-established:
  - "Service layer pattern: core/{domain}/service.ts exports async functions taking typed inputs"
  - "Event logging pattern: every mutation logs an IssueEvent with typed payload"
  - "Adapter pattern confirmed: GitHubIssueProvider implements IssueProvider port with native fetch"

duration: ~10min
started: 2026-04-08T07:25:00Z
completed: 2026-04-08T07:35:00Z
---

# Phase 2 Plan 01: Issue Core + tRPC Routes + GitHub Adapter Summary

**Issue lifecycle service with CRUD, state transitions, event logging, 5 tRPC endpoints, and GitHub IssueProvider adapter using native fetch**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~10min |
| Started | 2026-04-08T07:25:00Z |
| Completed | 2026-04-08T07:35:00Z |
| Tasks | 3 completed |
| Files created | 6 |
| Files modified | 1 |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Issue CRUD works against database | Pass | createIssue, getIssue, listIssues, updateIssue all typed and working |
| AC-2: State transitions enforced and logged | Pass | VALID_TRANSITIONS map, IssueEvent logged on every transition |
| AC-3: tRPC issue router has full CRUD | Pass | 5 endpoints with Zod validation: create, list, getById, update, transition |
| AC-4: GitHub adapter implements port | Pass | GitHubIssueProvider registered as issue:github, tsc confirms interface satisfaction |

## Accomplishments

- Created issue service layer in core/issues/ with 5 functions covering full lifecycle
- Implemented state machine with explicit transition map (open/in_progress/blocked/closed) and event logging
- Replaced tRPC issue router stub with 5 real endpoints using Zod input validation
- Built GitHub IssueProvider adapter using native fetch — no new dependencies added
- 6 tests passing (5 state transition + 1 health from Phase 1)

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/core/issues/types.ts` | Created | IssueState, IssuePriority, IssueType, VALID_TRANSITIONS map |
| `src/core/issues/service.ts` | Created | createIssue, getIssue, listIssues, updateIssue, transitionIssue |
| `src/core/issues/index.ts` | Created | Barrel export for types + service functions |
| `src/adapters/github/issues.ts` | Created | GitHubIssueProvider — native fetch against GitHub API |
| `src/adapters/github/index.ts` | Created | Registry registration for issue:github |
| `src/__tests__/issues.test.ts` | Created | State transition validation tests |
| `src/server/routers/issue.ts` | Modified | Replaced stub with 5 real endpoints |

## Deviations from Plan

None — plan executed exactly as written.

## Next Phase Readiness

**Ready:**
- Issue service available for CLI integration (Plan 02-03)
- Service layer pattern established for Skill service (Plan 02-02)
- tRPC router pattern proven for remaining domain routers

**Concerns:**
- None

**Blockers:**
- None

---
*Phase: 02-project-management, Plan: 01*
*Completed: 2026-04-08*
