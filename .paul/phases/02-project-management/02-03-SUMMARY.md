---
phase: 02-project-management
plan: 03
subsystem: cli
tags: [cli, trpc-client, issue-commands, skill-commands, arg-parsing]

requires:
  - phase: 02-project-management/02-01
    provides: Issue service + tRPC issue router
  - phase: 02-project-management/02-02
    provides: Skill service + materializer + tRPC skill router
provides:
  - Standalone tRPC client (non-React)
  - CLI with issue list/create/view, skill list/sync, status commands
  - Bin entry for fluxaos command
affects: [phase-3 CLI extensions (persona/config), phase-4 CLI extensions (do/run)]

tech-stack:
  added: []
  patterns: [standalone tRPC client, flag parsing without deps, table formatting with padEnd]

key-files:
  created:
    - src/cli/client.ts
    - src/cli/commands/issue.ts
    - src/cli/commands/skill.ts
    - src/cli/commands/status.ts
    - src/__tests__/cli.test.ts
  modified:
    - src/cli/index.ts
    - package.json

key-decisions:
  - "No external CLI dependencies — process.argv + parseFlag helper, zero packages"
  - "FLUXAOS_URL env var for configurable server endpoint"
  - "Bin entry points to tsx — relies on devDependency for alpha"

patterns-established:
  - "CLI command pattern: each command file exports async handler(client, args)"
  - "Flag parsing: simple parseFlag(args, '--name') helper, no framework"
  - "Table output: padEnd() alignment, no chalk/cli-table dependency"

duration: ~5min
started: 2026-04-08T08:16:00Z
completed: 2026-04-08T08:21:00Z
---

# Phase 2 Plan 03: CLI — Thin tRPC Client Wrapper Summary

**Minimal CLI with standalone tRPC client, issue list/create/view, skill list/sync, status check, and zero new dependencies**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~5min |
| Started | 2026-04-08T08:16:00Z |
| Completed | 2026-04-08T08:21:00Z |
| Tasks | 3 completed |
| Files created | 5 |
| Files modified | 2 |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Standalone tRPC client connects | Pass | createTRPCClient<AppRouter> with httpBatchLink, no React deps |
| AC-2: Issue commands work | Pass | list (--project), create (--project, --title, --type, --priority), view (<id>) |
| AC-3: Skill commands work | Pass | list (--project optional), sync (--project, --dir → materialize) |
| AC-4: Status shows health | Pass | health.check.query() with connection error handling |
| AC-5: Entry point and bin config | Pass | Shebang, arg dispatch, package.json bin entry, help text |

## Accomplishments

- Created standalone tRPC client using vanilla createTRPCClient (no React hooks)
- Built 3 command groups with 6 total subcommands: issue (list/create/view), skill (list/sync), status
- Added bin entry to package.json for `fluxaos` command
- 9 new tests covering arg parsing, table formatting, and command routing
- Zero new dependencies — process.argv parsing, padEnd formatting

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/cli/client.ts` | Created | Standalone tRPC client with configurable baseUrl |
| `src/cli/commands/issue.ts` | Created | Issue list/create/view handlers |
| `src/cli/commands/skill.ts` | Created | Skill list/sync handlers |
| `src/cli/commands/status.ts` | Created | Health check handler |
| `src/__tests__/cli.test.ts` | Created | Arg parsing + table formatting + routing tests |
| `src/cli/index.ts` | Modified | Empty stub → full CLI dispatcher with shebang |
| `package.json` | Modified | Added bin entry for fluxaos |

## Deviations from Plan

Biome auto-formatted template literals and function signatures — cosmetic only, no behavioral changes.

## Next Phase Readiness

**Ready:**
- Phase 2 complete — all 3 plans delivered (issues, skills, CLI)
- CLI extensible for Phase 3 (persona/config commands) and Phase 4 (do/run)
- Service layer pattern proven across 2 domains

**Concerns:**
- None

**Blockers:**
- None

---
*Phase: 02-project-management, Plan: 03*
*Completed: 2026-04-08*
