# Phase 2 — Lane 2 Spec Compliance — Full Surface

## Required-reading proof

- **invariants.md** (line 59): "Zero vendor imports in src/core/..."
- **spec v2** §Adapter Architecture: "Core business logic lives in `core/` and imports ONLY from `core/ports/` — TypeScript interfaces that define contracts. Adapter implementations live in `adapters/` and are selected via config."
- **rebuild-spec** §Phase R2 Scope: "Rewrite adapter registry so `registry.get<T>()` is the only resolution path"
- **CLAUDE.md** §Key Principles: "DI everywhere — services are factories receiving Database, zero vendor imports in src/core/"
- **session-quick-start.md** §Gotchas: "No production database — Supabase Cloud is the dev database. Nuke-and-seed freely."

## Mechanical-check output

**1. src/core/ports/:** `ai.ts auth.ts database.ts git.ts index.ts issue.ts notification.ts queue.ts realtime.ts stage-executor.ts storage.ts` — 10 port modules + index. Spec lists 10 ports; all present as interfaces.

**2. src/adapters/:** `bullmq/`, `subprocess/`, `supabase/` (with auth.ts, database.ts, realtime.ts, server-client.ts). 3 of 6 expected directories per V2 spec. **Missing: `github/`, `anthropic/`, `openai/`.**

**3. Schema pgTable count:** 37 (rebuild spec verified 20; current is a superset for rich issue model — not a violation).

**4. src/config/:** `bootstrap.ts`, `registry.ts`. Registry called at runtime in 5 places. **R2 goal met for 4 adapters** (database, auth, queue, executor).

**5. src/cli/:** **No src/cli/ directory.**

**6. src/core/ subdirectories:**
```
agents/       (empty)
brands/       (types.ts only)
gates/        (populated)
observability/ (empty)
organizations/ (empty)
pipeline/     (types.ts only — dead)
personas/     (types.ts only)
projects/     (empty)
providers/    (empty)
routing/      (empty)
skills/       (materializer.ts, types.ts)
```
Most spec-mandated core subdirs are empty shells.

## Findings

### AUDIT-P2-SPEC-1: No AIProvider adapters despite ports + vendor SDKs in deps
- **Spec reference:** V2 §Adapter Architecture; §Project Structure; §Alpha MVP "Must Have" — "Anthropic + OpenAI adapters"
- **Severity:** High
- **Locus:** `src/core/ports/ai.ts` defines `AIProvider`; no implementing file in `src/adapters/`. `package.json` declares `@anthropic-ai/sdk` and `openai` dependencies.
- **Evidence:** `ls src/adapters/` → `bullmq/ subprocess/ supabase/`. No `registry.register('ai', …)` in bootstrap.
- **Direction:** Implement Anthropic/OpenAI adapters or defer formally.

### AUDIT-P2-SPEC-2: GitHub adapter absent; GitProvider + IssueProvider ports unimplemented
- **Spec reference:** V2 §Ecosystem Strategy "100% GitHub from day one"; Alpha MVP "Must Have" — "Issue CRUD with GitHub sync", "GitHub adapter"
- **Severity:** High
- **Locus:** `src/core/ports/git.ts`, `src/core/ports/issue.ts`. No `src/adapters/github/`.
- **Evidence:** No `registry.register('git', …)` or `registry.register('issue', …)`.
- **Direction:** Implement `src/adapters/github/` or formally flag deferral.

### AUDIT-P2-SPEC-3: RealtimeProvider not registered via adapter registry
- **Spec reference:** V2 §Adapter Architecture; rebuild spec §R2 "registry.get<T>() is the only resolution path"; invariants 7-8
- **Severity:** High
- **Locus:** `src/config/bootstrap.ts` registers only database/auth/queue/executor. `src/lib/realtime/context.tsx:14-17` constructs `createSupabaseRealtimeAdapter` directly.
- **Evidence:** `REQUIRED_ADAPTERS = ['database', 'auth', 'queue']`. `grep` for `registry.register\(.*realtime` → empty.
- **Direction:** Register `realtime` in bootstrap; resolve via `registry.get<RealtimeProvider>('realtime')` everywhere.

### AUDIT-P2-SPEC-4: No CLI exists despite spec requiring CLI/UI parity
- **Spec reference:** V2 §Project Structure (`src/cli/`); §CLI Architecture; Alpha MVP "Must Have" — "Minimal CLI"; invariant 19
- **Severity:** High
- **Locus:** No `src/cli/` directory. `package.json` scripts have no `fluxaos` CLI entrypoint.
- **Evidence:** Rebuild-spec §Full Journey Test items 55-58 (CLI parity) unreachable. Invariant 19: "CLI must pass the same journey."
- **Direction:** Build `src/cli/` (thin tRPC-client wrapper) or formally defer post-alpha.

### AUDIT-P2-SPEC-5: "Just Do It" mode UI wired but backend mutation missing
- **Spec reference:** V2 §Two Entry Points; Alpha MVP "Must Have"
- **Severity:** High
- **Locus:** `src/app/[org]/[user]/[project]/dashboard-client.tsx:126-148`
- **Evidence:** `onSubmit` body: `// pipeline.justDoIt not yet implemented`. No `justDoIt` procedure in `src/server/routers/pipeline.ts`.
- **Direction:** Implement `pipeline.justDoIt` tRPC mutation.

### AUDIT-P2-SPEC-6: Empty core domain directories listed in spec as business-logic homes
- **Spec reference:** V2 §Project Structure
- **Severity:** Medium
- **Locus:** `src/core/agents/`, `routing/`, `observability/`, `organizations/`, `projects/`, `providers/` all empty; `pipeline/` only `types.ts`.
- **Evidence:** Actual business logic lives under `src/core/orchestrator/` (event-orchestrator, routing-resolver, pipeline-run-service).
- **Direction:** Relocate logic into spec-mandated dirs or update spec to document consolidation; do not leave stub dirs.

### AUDIT-P2-SPEC-7: Rebuild-spec Settings Tabs largely unimplemented
- **Spec reference:** Rebuild spec §Settings Tabs
- **Severity:** Medium
- **Locus:** `src/app/[org]/[user]/[project]/settings/` has page.tsx + personas/providers/routing/skills/drivers/. **Absent:** Cron Jobs, Teams, Users, System, Stages tab, Projects tab.
- **Evidence:** Rebuild spec lists 10 tabs; journey test items 33, 36, 38, 41, 46-48 have no UI.
- **Direction:** Build missing tabs or mark deferred.

### AUDIT-P2-SPEC-8: Mission Control page absent
- **Spec reference:** Rebuild spec §Sidebar Navigation
- **Severity:** Medium
- **Locus:** No Mission Control route or component.
- **Evidence:** `grep MissionControl|mission.control` → 0 matches. Sidebar has Dashboard, Issues, Pipelines, KPIs, Settings.
- **Direction:** Add Mission Control route backed by existing pipeline-run-service queries.

### AUDIT-P2-SPEC-9: NotificationProvider + StorageProvider ports dormant
- **Spec reference:** V2 §Adapter Architecture
- **Severity:** Low
- **Locus:** `src/core/ports/notification.ts`, `storage.ts`.
- **Evidence:** No adapter registration, no consumer. Skill materializer writes directly to `tmpdir()` bypassing StorageProvider.
- **Direction:** Implement local-filesystem StorageProvider or delete the dead port.

### AUDIT-P2-SPEC-10: Orchestrator is Realtime-driven, not "systemd daemon" as invariant text claims
- **Spec reference:** invariants §Two Actors; V2 spec "BullMQ Worker (same process for alpha)"
- **Severity:** Low
- **Locus:** `src/core/orchestrator/event-orchestrator.ts:72-100` subscribes to Realtime. No heartbeat timer. `OrchestratorConfig.heartbeatIntervalMs` in types.ts:63-72 is unused.
- **Evidence:** Invariant: "Wakes up on its heartbeat interval / Checks the database". Code uses Supabase Realtime callbacks.
- **Direction:** Reconcile invariants doc with chosen event-driven model.

### AUDIT-P2-SPEC-11: docker-compose.yml builds `target: dev` — Phase R6 "fresh clone → docker compose up" not yet met
- **Spec reference:** Rebuild spec §Infrastructure (2 containers, no Postgres); V2 §Deployment (Phase R6 goal)
- **Severity:** Low
- **Locus:** `/mnt/dev/fluxaos/docker-compose.yml`
- **Evidence:** Current compose: fluxaos + redis (correct, 2 containers). But `target: dev` and source bind-mount mean `docker compose up` doesn't produce a working fluxaOS for a new user.
- **Direction:** No action for compliance; note for Phase R6.

### AUDIT-P2-SPEC-12: RoutingResolver accepts free-text driver via `pipelineStage.driver` (string) alongside `driverId` (FK)
- **Spec reference:** invariants §Agnosticism 3; rebuild spec §Terminology Mapping
- **Severity:** Low
- **Locus:** `src/core/orchestrator/routing-resolver.ts:41-44, 62-68, 140-147`; `src/server/routers/pipeline.ts:71-95`
- **Evidence:** Two mechanisms coexist: free-text `driver` column and FK to `driver` table. Resolver prefers `stage.driver ?? rule?.preferredDriver ?? rule?.fallbackDriver`.
- **Direction:** Collapse to FK path; remove free-text column + resolver branch.

## Phase 2 overflow candidates

- Gate engine rules-vs-spec delta (action weights, "warn always proceeds") warrants rules-engine lens.
- Schema has 37 tables vs V2's ~20 core entities; reachability audit is Phase 3 material.
- `src/proxy.ts` is stray-utility suspect.
- Full Journey Test (58 items) vs current integration test coverage — coverage map is a distinct deliverable.
- `src/core/observability/` empty — cost/event/KPI logic scattered; deserves own audit.

## Blocked

None.
