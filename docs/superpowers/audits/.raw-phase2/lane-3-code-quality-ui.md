# Phase 2 — Lane 3 Code Quality — Area: src/server/ + src/app/ + src/components/

## Required-reading proof

- **invariants.md** (line 67): "DRY strictly enforced. Use the CRUD factory pattern."
- **spec v2** (line 51): "Everything is config."
- **rebuild-spec** (line 53): "DRY strictly enforced."
- **CLAUDE.md** (line 47): "Agnostic engine — no stage/provider/driver/enum literals in app code"
- **session-quick-start.md** (line 43): "Optimistic concurrency required on all mutable entities"

## Mechanical-check output

```
# publicProcedure usage across routers (partial):
pipeline.ts, skill.ts, organization.ts, persona.ts, project.ts, driver.ts
all declare list/create/update/delete routinely.

# refetchInterval (polling):
pipelines/[id]/page.tsx:31
RunDetailModal.tsx:71

# Hardcoded status literals (20+):
pipeline.ts (many), dashboard-client.tsx:165
pipelines/[id]/page.tsx:33,81,186-188
issues/[number]/client.tsx:601,602,634
RunDetailModal.tsx:73,89,121,194,195,422,427

# as any / as unknown:
driver.ts:58,92 (Phase 1)
issue.ts:136
pipelines/page.tsx:114
issues/[number]/client.tsx:598

# Hardcoded ms: 2000, 5000
pipelines/[id]/page.tsx:33; RunDetailModal.tsx:73
LiveOutput.tsx:240,252; api/health/route.ts:59
```

## Findings

### AUDIT-P2-CQ-UI-1: No CRUD factory despite invariant 11 mandating one
- **Category:** DRY
- **Severity:** High
- **File:line:** `organization.ts`, `project.ts`, `provider.ts`, `persona.ts`, `skill.ts`, `driver.ts`, `issue-catalog.ts`
- **Evidence:** Invariant 11: "Use the CRUD factory pattern." Every router hand-rolls list/get/create/update/delete; `issue-catalog.ts` alone repeats identical blocks 5 times (130+ boilerplate lines). No `createCrudRouter`/`crudFactory` helper exists.
- **Direction:** Extract `createCrudRouter<Entity>(service)` factory.

### AUDIT-P2-CQ-UI-2: Issue detail client exceeds 500-line invariant by 380 lines
- **Category:** over-eng
- **Severity:** High
- **File:line:** `src/app/[org]/[user]/[project]/issues/[number]/client.tsx` (880 lines)
- **Evidence:** 880 lines containing 5 sub-components + helper block.
- **Direction:** Split into sibling files.

### AUDIT-P2-CQ-UI-3: status-badge.tsx hardcodes user-configurable enums
- **Category:** magic-value
- **Severity:** High
- **File:line:** `src/components/status-badge.tsx:1-23`
- **Evidence:** `colorMap` hardcodes user-configurable issue states and priorities; `CatalogBadge` already does DB-driven colors.
- **Direction:** Restrict StatusBadge to pipeline/stage statuses; route catalog-bound badges through CatalogBadge.

### AUDIT-P2-CQ-UI-4: Two overlapping status-badge components
- **Category:** DRY / indirection
- **Severity:** Medium
- **File:line:** `status-badge.tsx` (39 lines) vs `pipeline/PipelineStatusBadge.tsx` (34 lines)
- **Evidence:** Near-identical pill+dot rendering; StatusBadge uses magic strings, PipelineStatusBadge uses constants.
- **Direction:** Converge on one badge using constants.

### AUDIT-P2-CQ-UI-5: Pipeline router hardcodes status strings instead of constants
- **Category:** magic-value
- **Severity:** High
- **File:line:** `src/server/routers/pipeline.ts:121,123,221-225,234,258,274-276,338,382-385`
- **Evidence:** Inlined `'running'|'launching'|'cancelled'|'completed'|'failed'|'queued'`; line 221 inline-reimplements `STAGE_RUN_TERMINAL` as `.includes`.
- **Direction:** Import constants; replace literals.

### AUDIT-P2-CQ-UI-6: Duplicate `useBasePath` + hand-rolled useProjectId / org+project lookup
- **Category:** DRY
- **Severity:** Medium
- **File:line:** `nav.tsx:18-22`; `pipelines/[id]/page.tsx:13-17`; `pipelines/page.tsx:12-29`; `dashboard-client.tsx:64-69`; `kpis/page.tsx:11-17`; `settings/page.tsx:15-21`; `settings/personas/page.tsx:83-89`; `settings/providers/page.tsx:13-19`; `settings/routing/page.tsx:13-17`
- **Evidence:** `usePathname().split('/').filter(Boolean)` inlined 3x; `listOrgs→[0]→listByOrg→[0]` inlined in ≥8 files, while `resolveContext` helper already exists server-side.
- **Direction:** Export one `useBasePath` + one `useProjectContext` client hook from `src/lib/`.

### AUDIT-P2-CQ-UI-7: Dead UI-facing tRPC procedures (never called from src/app or src/components)
- **Category:** dead
- **Severity:** Medium
- **File:line:** `issue-catalog.ts` (much of it), `issue.ts` (attachment.*/dependency.*/savedView.*/stateOverride/close/reopen/users), `organization.ts` (getById/getBySlug/create/update/delete), `project.ts` (list/getById/create/update/delete), `provider.ts` (getById/update/delete), `persona.ts` (listByProject/listGlobal/update/delete), `gate.ts` (evaluate)
- **Evidence:** `grep trpc.<path>` in src/app + src/components returns nothing.
- **Direction:** Wire into UI or delete.

### AUDIT-P2-CQ-UI-8: Unsafe `as any` casts mask type errors
- **Category:** any-cast
- **Severity:** High
- **File:line:** `driver.ts:58,92`; `issues/[number]/client.tsx:598`; `pipelines/page.tsx:114`
- **Evidence:** Casts around Drizzle schema and TRPC payload types.
- **Direction:** Fix underlying types; remove casts.

### AUDIT-P2-CQ-UI-9: Duplicate polling-refetch logic with hardcoded 2000ms
- **Category:** DRY / magic-value
- **Severity:** Medium
- **File:line:** `pipelines/[id]/page.tsx:31-35`; `RunDetailModal.tsx:71-75`
- **Evidence:** Same block; hardcoded 2000 + status literals; Realtime already wired so polling shouldn't exist.
- **Direction:** Remove polling or extract helper.

### AUDIT-P2-CQ-UI-10: Duplicated `formatDuration` helper
- **Category:** DRY
- **Severity:** Low
- **File:line:** `StageTimeline.tsx:30-35`; `RunDetailModal.tsx:38`
- **Evidence:** Same function twice.
- **Direction:** Extract.

### AUDIT-P2-CQ-UI-11: setState during render in IssueCreateClient
- **Category:** over-eng / unused (React anti-pattern)
- **Severity:** Medium
- **File:line:** `issues/new/client.tsx:34-39`
- **Direction:** Use useEffect.

### AUDIT-P2-CQ-UI-12: Unused `trend` prop on StatCard
- **Category:** unused
- **Severity:** Low
- **File:line:** `src/components/stat-card.tsx:29,51-53`
- **Direction:** Delete or pass real data.

### AUDIT-P2-CQ-UI-13: `projectId: projectId!` non-null assertion repeated 10+ times
- **Category:** DRY
- **Severity:** Low
- **File:line:** kpis/pipelines/settings pages
- **Direction:** Consolidate into context hook.

### AUDIT-P2-CQ-UI-14: RuleBuilder duplicates GATE constant enums
- **Category:** DRY / magic-value
- **Severity:** Medium
- **File:line:** `components/gates/RuleBuilder.tsx:15-39`; `server/routers/gate.ts:14-25`
- **Evidence:** Operator/severity/action/mode lists defined in 3 places.
- **Direction:** Single source in constants.ts or gates/types.ts.

### AUDIT-P2-CQ-UI-15: `rules: z.lazy(...)` typed as `z.ZodType<any>`
- **Category:** any-cast
- **Severity:** Low
- **File:line:** `gate.ts:27,36`
- **Direction:** Use typed ZodType<Rule>/ZodType<RuleGroup>.

### AUDIT-P2-CQ-UI-16: `issue.users` uses raw SQL + `as unknown` + no UI caller
- **Category:** indirection
- **Severity:** Low
- **File:line:** `src/server/routers/issue.ts:125-137`
- **Direction:** Move to service with typed selects or delete.

### AUDIT-P2-CQ-UI-17: Dynamic `import(...)` inside resolvers
- **Category:** indirection
- **Severity:** Low
- **File:line:** `pipeline.ts:141,191,286,360`; `issue-catalog.ts:238-239`; `issue.ts:128`
- **Direction:** Hoist to top-level imports.

### AUDIT-P2-CQ-UI-18: KPI dashboard fetches all runs twice (waterfall)
- **Category:** over-eng
- **Severity:** Low
- **File:line:** `dashboard-client.tsx:56-57`
- **Direction:** Fold KPIs into listByProject or aggregate via SQL.

### AUDIT-P2-CQ-UI-19: Dashboard random chart heights
- **Category:** unused / over-eng
- **Severity:** Low
- **File:line:** `dashboard-client.tsx:164-174`
- **Evidence:** `Math.random() * 36` for bars that look like real data.
- **Direction:** Use real metric or remove.

### AUDIT-P2-CQ-UI-20: Unused triggerRun mutation on pipelines list page
- **Category:** unused
- **Severity:** Low
- **File:line:** `pipelines/page.tsx:47-51`
- **Evidence:** Mutation + error block present; `action` prop is `undefined`, mutation never fires.
- **Direction:** Delete or wire.

## Phase 2 overflow candidates

- RunDetailModal 483 lines — approaching limit.
- Settings pages not deeply read; similar patterns likely.
- `dashboard-client.tsx:50-53` inProgressCount arithmetic is brittle.

## Blocked

None.
