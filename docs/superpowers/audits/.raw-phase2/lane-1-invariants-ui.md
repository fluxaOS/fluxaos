# Phase 2 — Lane 1 Invariants — Area: src/server/ + src/app/ + src/components/

## Required-reading proof

- **invariants.md** (line 59): "Zero vendor imports in src/core/..."
- **spec v2** (line 51): "Everything is config. Stages, personas, skills, gates, routing rules, pipelines — all DB records editable in the UI."
- **rebuild-spec** (line 195): "Project switcher in sidebar header (not hardcoded first project)."
- **CLAUDE.md** (line 47): "Agnostic engine — no stage/provider/driver/enum literals in app code (seed data and adapters only)."
- **session-quick-start.md** (line 42): "Optimistic concurrency required on all mutable entities (`WHERE version = $expected`)."

## Mechanical-check output

1. Hardcoded stage names: PASS (no matches)
2. Hardcoded provider/driver names: PASS (no matches)
3. Vendor imports in server/app/components: PASS (no matches)
4. File size > 500 lines: `src/app/[org]/[user]/[project]/issues/[number]/client.tsx: 880 lines`
5. Status literals leaking outside constants.ts:
   - `src/app/[org]/[user]/[project]/dashboard-client.tsx:165`
   - `src/app/[org]/[user]/[project]/issues/[number]/client.tsx:601-634`
   - `src/components/status-badge.tsx:3-22`

## Findings

### AUDIT-P2-INV-UI-1: File exceeds 500-line limit
- **Invariant:** #10
- **Severity:** High
- **File:line:** `src/app/[org]/[user]/[project]/issues/[number]/client.tsx:880`
- **Evidence:** 880 lines mixing `EditableTitle`, `EditableBody`, `CatalogSelect`, `CommentCard`, `IssueDetailClient`, `formatEvent` helper.
- **Direction:** Extract sub-components into sibling files.

### AUDIT-P2-INV-UI-2: Hardcoded catalog keys in StatusBadge
- **Invariant:** #4
- **Severity:** High
- **File:line:** `src/components/status-badge.tsx:3-22`
- **Evidence:** `colorMap` hardcodes user-configurable issue states (`open/in_progress/blocked/closed`) and priorities (`low/medium/high/critical`) as color keys, ignoring DB `color` column.
- **Direction:** Route catalog-backed values through `CatalogBadge`; restrict this to pipeline/stage statuses via constants.

### AUDIT-P2-INV-UI-3: Missing optimistic concurrency on persona/provider/organization/project routers
- **Invariant:** #12
- **Severity:** High
- **File:line:** `src/server/routers/persona.ts:43-61`, `provider.ts:27-43`, `organization.ts:28-39`, `project.ts:34-50`
- **Evidence:** Update mutations have no `version` field in input schemas, no conflict detection path.
- **Direction:** Add `version: z.number().int()` to update/delete inputs.

### AUDIT-P2-INV-UI-4: Root redirect hardwires first org/user/project
- **Invariant:** #9 and rebuild-spec line 195
- **Severity:** Medium
- **File:line:** `src/app/page.tsx:12-39`
- **Evidence:** `select().from(organization).limit(1)` picks whatever comes back first instead of resolving authenticated user's default project.
- **Direction:** Resolve current user from Supabase Auth session; error fast if no default project.

### AUDIT-P2-INV-UI-5: KPIs/Pipelines/Personas/Providers pages auto-select first org
- **Invariant:** #9 and rebuild-spec line 195
- **Severity:** Medium
- **File:line:** `kpis/page.tsx:12-22`, `pipelines/page.tsx:12-23`, `settings/personas/page.tsx:83-89`, `settings/providers/page.tsx:13-19`
- **Evidence:** `orgsQuery.data?.[0]?.id` → `projectsQuery.data?.[0]?.id` pattern ignoring URL-resolved context.
- **Direction:** Use `resolveContext()` and pass IDs as props.

### AUDIT-P2-INV-UI-6: Random chart heights in dashboard
- **Invariant:** #9
- **Severity:** Medium
- **File:line:** `src/app/[org]/[user]/[project]/dashboard-client.tsx:166`
- **Evidence:** `const h = 20 + Math.random() * 36;` — bar heights unrelated to real runs.
- **Direction:** Drive from real field or remove chart.

### AUDIT-P2-INV-UI-7: `setState` during render in IssueCreateClient
- **Invariant:** #9
- **Severity:** Medium
- **File:line:** `src/app/[org]/[user]/[project]/issues/new/client.tsx:34-39`
- **Evidence:** `setTypeId`/`setPriorityId` invoked in component body.
- **Direction:** Move to `useEffect`.

### AUDIT-P2-INV-UI-8: Status literals leak in UI files instead of using constants
- **Invariant:** #11
- **Severity:** Medium
- **File:line:** `issues/[number]/client.tsx:601,602,634`; `dashboard-client.tsx:165`
- **Evidence:** Hardcoded `'completed'|'running'|'launching'|'pending'|'queued'` comparisons.
- **Direction:** Import `STAGE_RUN_STATUS` / `PIPELINE_RUN_STATUS` constants.

### AUDIT-P2-INV-UI-9: `(run as any).pipelineName` silent cast
- **Invariant:** #9
- **Severity:** Medium
- **File:line:** `pipelines/page.tsx:114`
- **Evidence:** Ad-hoc `pipelineName` field hidden by `as any` + UUID slice fallback.
- **Direction:** Extend router return type; drop the cast.

### AUDIT-P2-INV-UI-10: `git rev-parse` shelled out from health route at runtime
- **Invariant:** Founding principle 1
- **Severity:** Low
- **File:line:** `src/app/api/health/route.ts:7,17-25`
- **Evidence:** `execSync('git rev-parse HEAD')` in HTTP handler.
- **Direction:** Require `NEXT_PUBLIC_GIT_SHA` at build time.

### AUDIT-P2-INV-UI-11: CRUD router boilerplate duplicated across routers
- **Invariant:** #11
- **Severity:** Medium
- **File:line:** `organization.ts`, `project.ts`, `provider.ts`, `persona.ts`
- **Evidence:** Identical list/getById/create/update/delete shape repeated per router; no shared `createCrudRouter` helper.
- **Direction:** Introduce generic CRUD router factory.

### AUDIT-P2-INV-UI-12: Health route stringifies adapter errors as "not true"
- **Invariant:** #9
- **Severity:** Low
- **File:line:** `src/app/api/health/route.ts:40-50`
- **Evidence:** `withTimeout` converts errors to strings; endpoint masks misconfig vs transient.
- **Direction:** Return 500 body distinguishing misconfiguration from transient outage.

## Phase 2 overflow candidates

- `src/components/status-badge.tsx` conflates three domains — worth a full rebuild.
- `src/app/[org]/[user]/[project]/issues/[number]/client.tsx` — full decomposition beyond invariant-10 split.
- CRUD router factory + version field enforcement is a coordinated fix.

## Blocked

None.
