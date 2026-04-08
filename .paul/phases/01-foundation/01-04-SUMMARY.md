---
phase: 01-foundation
plan: 04
subsystem: api, infra, ui
tags: [trpc, github-actions, ci, app-shell, next-app-router, tailwind]

requires:
  - phase: 01-foundation/01-03
    provides: Port interfaces and adapter registry for future router integration
provides:
  - tRPC server with 8 domain routers (health + 7 stubs)
  - GitHub Actions CI pipeline (biome + tsc + vitest)
  - App shell with sidebar nav and 4 route pages
  - TRPCProvider wrapping React app with TanStack Query
affects: [phase-2 issue/skill CRUD routes, phase-3 persona/routing routes, phase-5 UI pages]

tech-stack:
  added: []
  patterns: [tRPC router stubs, createCallerFactory for testing, route groups for layout]

key-files:
  created:
    - src/server/trpc.ts
    - src/server/root.ts
    - src/server/routers/health.ts
    - src/server/routers/organization.ts
    - src/server/routers/project.ts
    - src/server/routers/pipeline.ts
    - src/server/routers/issue.ts
    - src/server/routers/persona.ts
    - src/server/routers/skill.ts
    - src/server/routers/provider.ts
    - src/app/api/trpc/[trpc]/route.ts
    - src/lib/trpc/client.ts
    - src/lib/trpc/provider.tsx
    - src/app/(dashboard)/layout.tsx
    - src/app/(dashboard)/page.tsx
    - src/app/(dashboard)/issues/page.tsx
    - src/app/(dashboard)/pipelines/page.tsx
    - src/app/(dashboard)/settings/page.tsx
    - src/components/nav.tsx
    - src/__tests__/health.test.ts
    - .github/workflows/ci.yml
  modified:
    - src/app/layout.tsx
    - src/app/globals.css
    - tsconfig.json
    - biome.json
    - vitest.config.ts
    - drizzle.config.ts

key-decisions:
  - "Biome migrated from v1.9 to v2.4.10 schema with Tailwind directive support"
  - "Root page.tsx removed — route group (dashboard) handles / directly"

patterns-established:
  - "tRPC router pattern: one file per domain in server/routers/, merged in root.ts"
  - "Testing pattern: createCallerFactory for server-side tRPC testing without HTTP"
  - "App shell pattern: (dashboard) route group with shared sidebar layout"
  - "CSS custom properties for brand colors in globals.css, exposed via @theme inline"

duration: ~20min
started: 2026-04-08T07:10:00Z
completed: 2026-04-08T07:30:00Z
---

# Phase 1 Plan 04: tRPC Skeleton + CI Pipeline + App Shell Summary

**tRPC server with 8 domain routers, GitHub Actions CI (biome + tsc + vitest), and dark-themed app shell with sidebar navigation — completing Phase 1 Foundation**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~20min |
| Started | 2026-04-08T07:10:00Z |
| Completed | 2026-04-08T07:30:00Z |
| Tasks | 3 completed |
| Files created | 21 |
| Files modified | 6 |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: tRPC health check returns OK | Pass | `health.check` returns `{ status: "ok", timestamp }`, verified via createCallerFactory test |
| AC-2: All domain routers on appRouter | Pass | 8 routers: health, organization, project, pipeline, issue, persona, skill, provider |
| AC-3: CI pipeline passes | Pass | biome check + tsc --noEmit + vitest run all pass clean |
| AC-4: App shell renders with navigation | Pass | Dark theme, violet accents, sidebar with 4 nav links, next build succeeds |

## Accomplishments

- Created tRPC v11 server with initTRPC, fetchRequestHandler, and 8 domain routers (health with working query, 7 stubs with list placeholder)
- Wired TRPCProvider into React app via TanStack Query + httpBatchLink client
- Created GitHub Actions CI workflow running biome lint, TypeScript type-check, and vitest on push/PR to main
- Built dark-themed app shell using Next.js route groups with sidebar navigation and 4 placeholder pages
- First passing test: health router verified via createCallerFactory (no HTTP required)

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/server/trpc.ts` | Created | tRPC initialization — router, publicProcedure, createCallerFactory |
| `src/server/root.ts` | Created | appRouter merging all 8 domain routers, exports AppRouter type |
| `src/server/routers/health.ts` | Created | Health check query returning status + timestamp |
| `src/server/routers/organization.ts` | Created | Stub router with list placeholder |
| `src/server/routers/project.ts` | Created | Stub router with list placeholder |
| `src/server/routers/pipeline.ts` | Created | Stub router with list placeholder |
| `src/server/routers/issue.ts` | Created | Stub router with list placeholder |
| `src/server/routers/persona.ts` | Created | Stub router with list placeholder |
| `src/server/routers/skill.ts` | Created | Stub router with list placeholder |
| `src/server/routers/provider.ts` | Created | Stub router with list placeholder |
| `src/app/api/trpc/[trpc]/route.ts` | Created | Next.js App Router handler for tRPC (GET + POST) |
| `src/lib/trpc/client.ts` | Created | createTRPCReact client typed to AppRouter |
| `src/lib/trpc/provider.tsx` | Created | TRPCProvider with QueryClient + httpBatchLink |
| `src/app/(dashboard)/layout.tsx` | Created | Route group layout — sidebar + main content area |
| `src/app/(dashboard)/page.tsx` | Created | Dashboard placeholder page |
| `src/app/(dashboard)/issues/page.tsx` | Created | Issues placeholder page |
| `src/app/(dashboard)/pipelines/page.tsx` | Created | Pipelines placeholder page |
| `src/app/(dashboard)/settings/page.tsx` | Created | Settings placeholder page |
| `src/components/nav.tsx` | Created | Client-side sidebar nav with active state highlighting |
| `src/__tests__/health.test.ts` | Created | Health router test via createCallerFactory |
| `.github/workflows/ci.yml` | Created | CI: biome check, tsc --noEmit, vitest run |
| `src/app/layout.tsx` | Modified | Added TRPCProvider wrapper, updated metadata to fluxaOS |
| `src/app/globals.css` | Modified | Dark theme with brand colors (violet accent, dark backgrounds) |
| `tsconfig.json` | Modified | Added @/server/* and @/lib/* path aliases |
| `biome.json` | Modified | Migrated to v2.4.10, added Tailwind directives + .next ignore |
| `vitest.config.ts` | Modified | Fixed node: protocol import |
| `drizzle.config.ts` | Modified | Replaced non-null assertion with nullish coalescing |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 3 | Essential fixes, no scope creep |
| Scope additions | 0 | - |
| Deferred | 0 | - |

**Total impact:** Pre-existing lint issues fixed during CI verification — biome schema migration, node: protocol, non-null assertion.

### Auto-fixed Issues

**1. Biome schema migration (v1.9 → v2.4.10)**
- **Found during:** Task 2 (CI pipeline)
- **Issue:** biome.json referenced v1.9 schema, biome v2.4.10 installed
- **Fix:** Ran `biome migrate --write`, added Tailwind directive support, .next ignore
- **Files:** biome.json
- **Verification:** `npx biome check .` passes clean

**2. Node.js import protocol**
- **Found during:** Task 2 (CI pipeline)
- **Issue:** vitest.config.ts used `import path from 'path'` without node: protocol
- **Fix:** Changed to `import path from 'node:path'`
- **Files:** vitest.config.ts
- **Verification:** biome check passes

**3. Non-null assertion in drizzle config**
- **Found during:** Task 2 (CI pipeline)
- **Issue:** `process.env.DATABASE_URL!` flagged by biome noNonNullAssertion
- **Fix:** Changed to `process.env.DATABASE_URL ?? ''`
- **Files:** drizzle.config.ts
- **Verification:** biome check passes

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Removed boilerplate root page.tsx | Route group (dashboard)/page.tsx handles / directly; dual page.tsx was ambiguous | Clean routing, no conflicts |
| Migrated biome to v2.4.10 | Pre-existing schema version mismatch; CI would fail without migration | All lint checks pass clean |

## Next Phase Readiness

**Ready:**
- Phase 1 complete: all 4 plans executed — repo scaffold, Drizzle schema, port interfaces, tRPC + CI + app shell
- tRPC routers ready for business logic (Phase 2 will add CRUD to issue/skill routers)
- CI pipeline catches regressions from Phase 2 onward
- App shell provides navigation structure for Phase 5 UI pages

**Concerns:**
- None

**Blockers:**
- None

---
*Phase: 01-foundation, Plan: 04*
*Completed: 2026-04-08*
