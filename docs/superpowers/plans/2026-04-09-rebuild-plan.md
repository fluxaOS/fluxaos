# fluxaOS Rebuild — High-Level Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **CRITICAL:** Each phase gets its own detailed plan before execution. This document is the roadmap — not the task list. Do NOT start implementing a phase without its detailed plan approved by the user.
>
> **PROCESS RULE:** No phase is complete until the user has verified it against a running system. "Tests pass" is never sufficient.

**Goal:** Rebuild fluxaOS from verified schema + port interfaces up through a fully working alpha, with real Supabase Cloud infrastructure and human verification at every phase.

**Architecture:** Full-stack TypeScript (Next.js 15 + tRPC + Drizzle ORM + Supabase Cloud + BullMQ). Ports & adapters with a registry that is actually called at runtime. All core services receive dependencies via injection. Config-driven, no hardcoded values, fail fast.

**Tech Stack:** Next.js 15, React 19, tRPC, Drizzle ORM, Supabase Cloud (Postgres + Auth + Realtime), BullMQ (Redis), Tailwind CSS 4, Vitest, Playwright, `postgres-js` driver

**Source of truth:** [Design Spec v2](../../planning/docs/superpowers/specs/2026-04-07-fluxaos-spec-v2.md) · [Rebuild Spec](../specs/2026-04-09-rebuild-spec.md)

---

## Phase Dependency Graph

```
R1: Infrastructure ──→ R2: Adapter Registry ──→ R3: Core Services + tRPC ──→ R4: Gate Engine
                                                          │                        │
                                                          ▼                        ▼
                                                  R5: Pipeline Engine ◀────────────┘
                                                          │
                                                          ▼
                                                  R6: Polish + Ship
```

Every phase depends on the previous. No parallel execution. No skipping ahead.

---

## Pre-Work: Gut the Codebase

Before Phase R1 begins, strip the codebase to its verified bones.

**Keep (verified against spec):**
- `src/core/db/schema.ts` — all 20 tables
- `src/core/ports/*.ts` — all 10 port interfaces
- `src/core/issues/types.ts` — issue state/priority/type enums + transitions
- `src/core/pipeline/types.ts` — pipeline/stage run status enums + transitions
- `src/core/gates/types.ts` — gate mode/verdict enums (NOT the rule structure — that gets rebuilt)
- `package.json`, `tsconfig.json`, `next.config.*`, `tailwind.config.*` — project config
- `planning/` — all planning docs
- `docs/` — rebuild specs and plans
- `website/` — marketing site (separate deploy)
- `.github/` — templates and CI

**Delete:**
- `src/core/db/index.ts` — pg singleton
- `src/core/db/seed.ts` — coupled to pg
- `src/core/*/service.ts` — all service files (brands, issues, observability, organizations, personas, pipeline, projects, providers, routing, skills)
- `src/core/*/index.ts` — barrel files that re-export deleted services
- `src/core/gates/engine.ts` — hardcoded gate engine
- `src/core/pipeline/cost-parser.ts` — coupled to wrong infrastructure
- `src/core/pipeline/just-do-it.ts` — coupled to deleted services
- `src/core/pipeline/prompt-assembler.ts` — coupled to deleted services
- `src/core/routing/resolver.ts` — duplicated logic, coupled to pg
- `src/adapters/**/*` — all adapter implementations
- `src/config/*` — dead registry
- `src/server/**/*` — all tRPC routers
- `src/lib/trpc/*` — tRPC client wiring
- `src/components/*` — all UI components
- `src/app/**/*` (except `src/app/layout.tsx` shell) — all pages
- `src/cli/**/*` — all CLI code
- `src/__tests__/**/*` — all tests
- `docker-compose.yml` — wrong infrastructure
- `drizzle.config.ts` — pg-specific config
- `.env.example` — wrong env vars

**Result:** A repo with the schema, port interfaces, type definitions, and project config. Nothing else.

---

## Phase R1: Infrastructure + Proof of Life

**Goal:** Supabase Cloud connected, auth working, app shell renders in browser after login.

**What gets built:**
- `src/core/db/connection.ts` — Drizzle + `postgres-js` connecting to Supabase transaction pooler. No `pg` package. This file lives in core but does NOT export a singleton — it exports a factory function that the adapter registry calls.
- `src/adapters/supabase/database.ts` — implements `DatabaseProvider` port using the Drizzle connection factory
- `src/adapters/supabase/auth.ts` — rewrite implementing `AuthProvider` port, wired into Next.js middleware
- `src/config/registry.ts` — new adapter registry (simple but functional — `register()`, `get<T>()`, `has()`)
- `src/config/bootstrap.ts` — startup file that registers all adapters and fails fast on missing env vars
- `src/app/layout.tsx` — root layout with auth check
- `src/app/page.tsx` — redirect to dashboard or login
- `src/app/login/page.tsx` — Supabase Auth login page
- `src/app/dashboard/page.tsx` — minimal authenticated app shell ("Welcome to fluxaOS")
- `src/middleware.ts` — Next.js middleware for Supabase Auth session management
- `docker-compose.yml` — 2 containers: fluxaos + redis
- `.env.example` — Supabase credentials template
- `.env` — real credentials (gitignored)
- `drizzle.config.ts` — pointing to Supabase direct connection (for migrations)
- `src/core/db/seed.ts` — seed script running against Supabase (default org, project, pipeline)

**Key decisions:**
- `postgres-js` driver (not `pg`) — Supabase recommends this for serverless/pooled connections
- Drizzle connection factory in core, but the factory is only called by the DatabaseProvider adapter. Core services never see the connection directly.
- Auth middleware checks Supabase session on every request to `/dashboard/*`
- Fail fast: if any Supabase env var is missing, the app crashes at startup with a clear error message listing what's missing

**Schema deployment:**
- `drizzle-kit push` against Supabase direct connection (port 5432) to create all 20 tables
- Verify tables exist in Supabase dashboard

**Integration test:**
- One test that connects to Supabase, inserts a row into `organization`, reads it back, deletes it
- Proves the full connection chain works (env vars → postgres-js → Drizzle → Supabase Cloud)

**User verification:**
1. `docker compose up` starts the app with only fluxaos + redis containers
2. Open `http://localhost:3000` → redirected to login page
3. Log in via Supabase Auth
4. See authenticated app shell (dashboard with "Welcome to fluxaOS")
5. Check Supabase dashboard → tables exist, seed data present

---

## Phase R2: Adapter Registry That Works

**Goal:** The ports-and-adapters pattern functions at runtime. Every vendor interaction goes through a resolved adapter. Zero vendor imports in `core/`.

**What gets built:**
- `src/config/registry.ts` — enhanced registry with typed resolution, health checks, and startup validation
- `src/config/bootstrap.ts` — expanded to register all adapters used in this phase
- `src/adapters/supabase/realtime.ts` — implements `RealtimeProvider` port
- `src/adapters/bullmq/queue.ts` — implements `QueueProvider` port
- `src/core/db/connection.ts` — refactored so core services receive a `Database` type (Drizzle instance) via function parameter, never import it directly
- Service factory pattern: `createIssueService(db: Database)` → returns service object with all methods. The factory is called once at startup, the result is passed to tRPC routers.
- `src/server/routers/health.ts` — health check endpoint that resolves each adapter via registry and reports status
- Shared utilities:
  - `src/adapters/github/client.ts` — shared HTTP client (used by both GitProvider and IssueProvider, eliminating the DRY violation from the old code)
  - `src/lib/cost.ts` — cost estimation from DB `model` table (not hardcoded rates)

**Key decisions:**
- The registry is the ONLY way to get an adapter instance. Direct imports of adapter files from outside `adapters/` are a lint error.
- Core services are pure functions that receive their dependencies. They do not import from `adapters/` or `config/`.
- The health endpoint calls `registry.get<DatabaseProvider>('database').healthCheck()`, `registry.get<AuthProvider>('auth').healthCheck()`, etc.

**Verification checkpoint:**
- `GET /api/trpc/health.check` returns JSON showing all registered adapters and their health status
- Supabase Postgres: connected
- Supabase Auth: configured
- Redis/BullMQ: connected
- No `import` from any vendor package exists in any file under `src/core/`

**User verification:**
1. Hit the health check endpoint in browser → see all adapters reporting healthy
2. Verify Supabase connection is live (not local postgres)

---

## Phase R3: Core Services + tRPC + UI

**Goal:** CRUD for all entities works end-to-end through the UI against real Supabase Postgres. This is the biggest phase.

**What gets built:**

*Service layer (all receiving `Database` via DI):*
- `src/core/organizations/service.ts` — org CRUD
- `src/core/projects/service.ts` — project CRUD with project switching
- `src/core/issues/service.ts` — issue CRUD, state transitions, comments, activity log
- `src/core/skills/service.ts` — skill CRUD, versioning
- `src/core/skills/materializer.ts` — DB → disk materialization
- `src/core/personas/service.ts` — persona CRUD, inheritance (global → project → override)
- `src/core/brands/service.ts` — brand CRUD
- `src/core/providers/service.ts` — provider + model CRUD
- `src/core/routing/service.ts` — routing profiles, routing rules CRUD
- `src/core/observability/service.ts` — event store (append-only)

*tRPC routers (one per domain, calling service factories):*
- health, organization, project, issue, skill, persona, brand, provider, routing

*UI pages (following PAT's layout pattern):*
- App shell with sidebar (WORK / STAGES / WORKSPACE sections)
- Project switcher in sidebar header
- Dashboard — project overview, recent activity
- Issues — list with filters, create form, detail page with activity timeline and comments
- Settings — tabbed page:
  - Stages tab (stage settings, transitions, gates — UI only, engine comes in R4)
  - Skills tab (CRUD with prompt template editor)
  - Routing tab (profiles, rules, provider/model/harness catalog)
  - Projects tab
  - Workers tab (placeholder until R5)
  - Teams tab
  - Personas tab
  - Users tab (if RBAC in alpha — flag to user)
  - System tab (DB status, fake data load/delete, reset defaults)
- Dark/light mode toggle
- Collapsible sidebar with mobile responsive overlay

*Integration tests:*
- Tests that create/read/update/delete each entity type against real Supabase
- Tests that verify state transitions (issue lifecycle)
- Tests that verify project switching

**Decision point for user:** Personas vs Workers — are these separate entities or combined? The schema has `Persona` but no `Worker` table. Options:
1. Workers are pipeline stage assignments of personas (no new table)
2. Workers are a new entity representing running instances (new table needed)
Flag to user before implementing.

**User verification:**
1. Open browser → log in → see sidebar with all navigation
2. Switch between projects
3. Create/edit/delete issues, skills, personas through the UI
4. See data persist in Supabase dashboard
5. Toggle dark/light mode
6. Verify on mobile (responsive sidebar)

---

## Phase R4: Gate Engine Rebuild

**Goal:** Declarative rules engine that evaluates field/operator/value conditions. Config-driven, no hardcoded conditions. Reused for stage transitions.

**What gets built:**
- `src/core/gates/engine.ts` — complete rewrite:
  - Generic `evaluate(rules, context)` function
  - Field resolver: reads values from stage context, issue context, pipeline context
  - Operators: `equals`, `not_equals`, `less_than`, `greater_than`, `contains`, `matches` (regex), `in` (array), `exists`
  - Severity levels: `required` (must pass), `warn` (flag, don't block), `block` (always hold)
  - Actions on failure: `proceed`, `hold`, `rework`, `abort`, `notify`, `escalate`
  - AND logic with worst-verdict-wins (keep existing skeleton)
  - OR groups (any rule in group passes → group passes)
  - Named rule sets (stored in DB, referenced by ID)
- `src/core/gates/types.ts` — rewrite rule structure:
  - `GateRule { field, operator, value, severity, onFail }`
  - `RuleGroup { operator: 'AND' | 'OR', rules: (GateRule | RuleGroup)[] }`
  - `GateConfig { mode, rules: RuleGroup }`
- `src/core/gates/fields.ts` — field registry mapping field names to value extractors
- `src/core/transitions/engine.ts` — stage transition engine reusing the same rules engine (not a separate hardcoded map)
- Settings UI updates:
  - Stage gates section — visual rule builder (field dropdown, operator dropdown, value input, severity picker, action picker)
  - Stage transitions section — rule-based transitions (not hardcoded state machine)
  - Reorderable rule list with drag-and-drop

*Integration tests:*
- Tests that create gate rules via API, evaluate them against mock stage contexts, verify correct verdicts
- Tests for every operator
- Tests for severity precedence (block > required > warn)
- Tests for OR groups
- Tests for named rule sets

**User verification:**
1. Open Settings → Stages → configure gate rules on a stage
2. Add rules with different severities and operators
3. Reorder rules
4. See the rule evaluation result when a mock context is tested (UI preview)

---

## Phase R5: Pipeline Engine + Real Execution

**Goal:** A real pipeline runs end-to-end. Live streaming via Supabase Realtime. Real AI provider execution.

**What gets built:**
- `src/core/pipeline/service.ts` — pipeline state machine:
  - PipelineRun: `pending → running → completed | failed | cancelled`
  - StageRun: `queued → running → completed | failed | cancelled | timed_out`
  - Rework loop: `completed → rework → queued` (via gate engine)
- `src/core/pipeline/orchestrator.ts` — the main execution loop:
  - Read pipeline config from DB
  - For each stage: resolve route → materialize skills → enqueue job → stream events
  - Gate evaluation between stages
  - Cancel/drain/restart support
- `src/core/routing/resolver.ts` — single implementation (no duplication):
  - `resolveRoutes(persona, stage)` returns ranked list of candidates
  - Filters by: allowed_models × available providers × compatible harnesses
  - Sorts by strategy: quality, speed, cost, balanced
  - Provider fallback: try each candidate in order
- `src/core/skills/materializer.ts` — DB → disk materialization (not env vars):
  - Writes persona prompt + skills to temp workspace directory
  - Harness reads from disk
  - Cleanup after execution
- `src/core/pipeline/cost-parser.ts` — extract real cost/token data from provider output
- `src/adapters/anthropic/provider.ts` — rewrite implementing `AIProvider` port:
  - Model listing from API (not hardcoded)
  - Cost rates from DB `model` table (not hardcoded)
  - Health check
- `src/adapters/openai/provider.ts` — rewrite implementing `AIProvider` port (same pattern, DRY with shared base)
- `src/adapters/github/git.ts` — rewrite implementing `GitProvider` port using shared client
- `src/adapters/github/issues.ts` — rewrite implementing `IssueProvider` port using shared client
- `src/adapters/node-exec/executor.ts` — rewrite implementing `StageExecutor` port
- `src/adapters/bullmq/worker.ts` — rewrite: resolves adapters via registry, processes jobs
- `src/adapters/supabase/realtime.ts` — full implementation of `RealtimeProvider`

*UI updates:*
- Mission Control page (orchestrator view):
  - Active stages and status
  - Active pipelines
  - Max workers vs active workers per stage
  - Why work isn't happening (queue empty, workers busy, gate held)
  - Start/stop/drain/restart controls
- Pipeline runs page + run detail modal:
  - Live output streaming via Supabase Realtime
  - Stage-by-stage progress
  - Cost breakdown per stage
  - Gate status (held/passed/failed)
- Dashboard updates:
  - Recent runs with real-time status
  - Quick stats (success rate, total cost)
- Issue detail updates:
  - Pipeline runs linked to issue
  - Auto-comments from stage events
- "Just Do It" mode:
  - Prompt box on dashboard
  - `pipeline.start({ prompt })` auto-creates issue + runs default pipeline
- Cron jobs settings tab (scheduled pipeline triggers)

*Integration tests:*
- Full pipeline run: create issue → start pipeline → stages execute → gates evaluate → run completes
- Cancel mid-run
- Restart cancelled run
- Provider fallback on failure
- Server reboot recovery (BullMQ job persistence)
- Live event streaming (subscribe → execute → verify events received)

**User verification:**
1. Submit an issue → watch it flow through the pipeline in real-time
2. See live output streaming in run detail modal
3. Stop a job midway → restart it
4. See gates hold and auto-proceed correctly
5. See cost accumulate across stages
6. Mission Control shows system state accurately
7. "Just Do It" mode works from dashboard

---

## Phase R6: Polish + Ship

**Goal:** Production-ready alpha. Full journey test passes. Fresh clone to working system in 15 minutes.

**What gets built:**
- CLI rewrite:
  - `fluxaos status` — system health via tRPC
  - `fluxaos issue create/list/view` — issue management
  - `fluxaos do "prompt"` — just do it mode
  - `fluxaos run --issue N` — structured mode
  - `fluxaos config set/get` — configuration
- KPI dashboard (Reports page):
  - Pipeline runs, success rate, total cost, avg cost/run
  - Cost by provider, model, stage, project
  - Persona effectiveness
  - Provider reliability
  - Rework rate, time-to-close, cost-per-issue
  - Date range and project filters
  - CSV/JSON export
- Costs page:
  - Per-provider, per-model, per-project cost breakdown
  - Time-series charts
- Playwright E2E test suite:
  - Full journey test (all 58 items from rebuild spec)
  - Browser-based: real login, real UI interaction, real data
- Docker Compose hardening:
  - `docker compose up` from fresh clone works with only env vars set
  - Health checks on both containers
  - Proper shutdown/restart behavior
- Fake data management:
  - Load fake data (realistic pipeline runs, issues, events)
  - Delete fake data
  - Reset to defaults
- README rewrite:
  - What fluxaOS is
  - Screenshots
  - Quick start (15 minutes)
  - Architecture overview
- CONTRIBUTING.md
- GitHub release: v0.1.0-alpha with changelog

**User verification:**
1. Fresh clone → `docker compose up` → follow README → working fluxaOS in 15 minutes
2. Full journey test passes (all 58 items)
3. CLI commands work
4. KPI dashboard shows accurate data from real pipeline runs
5. Load/delete fake data works
6. v0.1.0-alpha tagged on GitHub

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| `postgres-js` + Drizzle + Supabase pooler incompatibility | Test connection in Phase R1 before building anything on top |
| Supabase Auth middleware complexity in Next.js App Router | Use `@supabase/ssr` package, proven pattern |
| Supabase Realtime throughput under heavy streaming | Test with simulated high-volume events in Phase R5 |
| Gate engine complexity (OR groups, nesting, named sets) | Build incrementally: flat AND first, add OR groups, add nesting |
| BullMQ job recovery after server reboot | Test explicitly in Phase R5 integration tests |
| Rules engine reuse for stage transitions | Design generic in R4, validate reuse works before committing |

## Code Standards Enforcement

Every phase must pass these checks before user verification:

1. `grep -r "from 'pg'" src/core/` returns zero results (no vendor in core)
2. `grep -r "from '@supabase" src/core/` returns zero results (no vendor in core)  
3. No file in `src/` exceeds ~500 lines
4. `registry.get()` is the only way adapters are resolved (no direct imports)
5. Zero `any` types in port interfaces
6. All integration tests run against real Supabase (not mocks)
7. No hardcoded model names, URLs, prices, or fallback values

---

*Plan created: 2026-04-09*
*Each phase gets a detailed task-level plan before execution.*
*No phase is complete until the user verifies it.*
