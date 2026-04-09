# fluxaOS Rebuild Specification

**Date:** 2026-04-09
**Status:** Approved
**Context:** Post-audit rebuild after forensic review revealed 8 phases of unverified work with critical architecture deviations from the approved spec.

## Why This Exists

A forensic audit found that the original implementation:
- Switched from Supabase Postgres to local psql without user approval
- Never wired Supabase Auth or Realtime
- Built an adapter registry that was never called at runtime
- Leaked vendor imports into core/
- Labeled unit tests as "E2E" (zero database, zero browser, zero HTTP)
- Self-certified all 8 phases as complete without human verification

This spec defines the rebuild. The original design spec v2 (`planning/docs/superpowers/specs/2026-04-07-fluxaos-spec-v2.md`) remains the source of truth for what fluxaOS is. This document defines how we rebuild it correctly.

## What We Keep

Verified against the spec — these survive the rebuild:

- **Drizzle schema** (`src/core/db/schema.ts`) — all 20 tables verified, fields and relationships correct
- **Port interfaces** (`src/core/ports/*.ts`) — 8 of 10 verified (AuthProvider needs authorization methods, GitProvider needs webhook methods)
- **Issue types** — states, priorities, transitions verified
- **Pipeline run status types** — PipelineRunStatus verified (StageRunStatus needs cancelled/timed_out added)

## What Gets Gutted

- All service files in `core/` (bypass port system, hardwire to pg)
- `core/db/index.ts` (pg singleton — vendor in core)
- All adapter implementations (wrong database, dead registry)
- Adapter registry (decorative — never called at runtime)
- All tRPC routers (coupled to broken services)
- Gate engine (hardcoded conditions, not declarative rules engine)
- All tests (test mocks, not real services)
- UI components (built on broken tRPC layer)
- docker-compose.yml (wrong infrastructure)

## Infrastructure (Non-Negotiable)

| Service | Provider | Notes |
|---------|----------|-------|
| Database | Supabase Cloud Postgres | Transaction pooler (port 6543), `postgres-js` driver |
| Auth | Supabase Cloud Auth | Wired into Next.js middleware from day one |
| Realtime | Supabase Cloud Realtime | No polling substitutes |
| Job Queue | Redis + BullMQ | Only local service |
| Containers | fluxaos + redis | 2 containers. No local postgres. Ever. |

## Code Standards (Non-Negotiable)

1. **Max ~500 lines per file.** Split into multiple files as needed.
2. **Modular, config-driven code.** Everything is config per the original spec.
3. **DRY strictly enforced.** No exceptions without prior discussion. No copy-paste between adapters, routers, or services.
4. **No hardcoded values.** No fallback defaults. Fail fast on missing config. If a value should be configurable, it comes from the database or environment — never a magic string in code.
5. **Zero vendor imports in `core/`.** The adapter registry is the only way to resolve implementations. Services receive dependencies via injection.
6. **True E2E testing.** Tests hit real Supabase Postgres, real auth, real browser (Playwright). Unit tests supplement but do not substitute.

## Rebuild Phases

### Phase R1: Infrastructure + Proof of Life

**Goal:** Supabase connected, auth working, app shell renders in browser.

**Scope:**
- Replace `pg.Pool` with `postgres-js` (Supabase-compatible driver)
- Wire Drizzle to Supabase Postgres via transaction pooler
- Push existing schema to Supabase (`drizzle-kit push`)
- Wire Supabase Auth into Next.js middleware
- docker-compose.yml: 2 containers (fluxaos + redis)
- `.env` with real Supabase credentials
- Seed script runs against Supabase

**User verification:** Open browser → login page → authenticate via Supabase → see authenticated app shell. `docker compose up` works.

### Phase R2: Adapter Registry That Works

**Goal:** The ports-and-adapters pattern actually functions at runtime.

**Scope:**
- Rewrite adapter registry so `registry.get<T>()` is the only resolution path
- Wire DatabaseProvider, AuthProvider, QueueProvider through registry
- All core services receive dependencies via injection (no singleton imports)
- Remove all vendor imports from `core/`
- Shared utilities: GitHub client base, cost estimation from DB

**User verification:** Health check endpoint shows all adapters resolved through registry, database connected via Supabase.

### Phase R3: Core Services + tRPC

**Goal:** CRUD for issues, skills, personas works end-to-end through the UI.

**Scope:**
- Rewrite service layer with DI
- tRPC routers calling real services against real Supabase Postgres
- Integration tests hitting real Supabase
- UI pages: issues, skills, personas — functional CRUD

**User verification:** Open browser → create/read/update/delete issues, skills, personas. Data persists in Supabase dashboard.

### Phase R4: Gate Engine Rebuild

**Goal:** Declarative rules engine per the original spec.

**Scope:**
- Field/operator/value rule evaluation (not hardcoded condition names)
- Operators: equals, less_than, greater_than, contains, matches, in, exists
- Severity levels: required, warn, block
- Gate modes: auto (always proceed), rules (evaluate), hold (always wait)
- Actions: proceed, hold, rework, abort, notify, escalate
- OR groups and named rule sets
- Worst-verdict-wins for AND logic (existing 6-line skeleton)

**User verification:** Configure gate rules in UI → trigger evaluation → see correct verdict.

### Phase R5: Pipeline Engine + Real Execution

**Goal:** A real pipeline runs end-to-end with live streaming.

**Scope:**
- Pipeline state machine (with cancelled/timed_out states)
- Routing resolver (single implementation, no duplication)
- BullMQ worker wired through adapter registry
- Supabase Realtime for live event streaming
- Real AI provider execution (claude-code subprocess)
- Skill materialization (DB → disk, not env vars)
- Cost tracking from real provider output

**User verification:** Trigger pipeline from UI → watch live execution → see output stream → see cost tracked → see gates evaluate.

### Phase R6: Polish + Ship

**Goal:** Production-ready alpha release.

**Scope:**
- CLI wired to real tRPC endpoints
- Playwright E2E test suite
- Full journey test (see below)
- KPI dashboard with full spec KPIs
- Docker Compose hardened
- README, CONTRIBUTING, GitHub release v0.1.0-alpha

**User verification:** Fresh clone → `docker compose up` → follow README → working fluxaOS in 15 minutes.

## Terminology Mapping

PAT concepts carry forward into fluxaOS with these names:

| PAT Term | fluxaOS Term | What It Is |
|----------|-------------|------------|
| Routines | Cron Jobs | Scheduled recurring tasks |
| Prompts | Skills | Reusable prompt templates / slash commands |
| Agents | Workers | The execution instances that run jobs |
| Personas | Personas | Soul, purpose, identity, constraints of an agent |
| Tools | Harnesses | Execution environments (claude-code, aider, etc.) |
| Manager / Orchestrator | Mission Control | System status, health, active jobs, queue state |

Note: Personas and workers may be combined into a single entity if separation adds no value. Flag to user for decision during Phase R3.

## UI Structure

Informed by PAT's proven layout. fluxaOS UI follows the same navigation pattern:

### Sidebar Navigation

**WORK section:**
- Dashboard — project overview, recent runs, quick stats, real-time KPIs
- Issues — list/filter/create, issue detail with activity timeline
- Mission Control — orchestrator view (active stages, pipelines, workers, queue health, why work isn't happening)

**STAGES section (dynamic):**
- Live pipeline stages rendered from current pipeline config

**WORKSPACE section:**
- Reports — analytics, cost breakdown, historical data
- Costs — per-provider, per-model, per-project cost tracking
- Settings — tabbed settings page (see below)

### Settings Tabs

| Tab | Contents |
|-----|----------|
| Stages | Stage settings, stage transitions (rules-engine driven, not hardcoded), stage gates |
| Cron Jobs | Scheduled task management (add/edit/delete/enable/disable) |
| Routing | Routing rules, routing profiles, provider/model/harness catalog, overrides per stage |
| Skills | Prompt templates / slash commands (add/edit/delete, version history) |
| Projects | Project CRUD, project switcher, default pipeline per project |
| Workers | Worker/agent management (add/edit/delete, parallel task limits per stage) |
| Teams | Team composition, persona assignments |
| Personas | Soul, identity, brand, routing rules per persona |
| Users | User management, role assignment (if RBAC exists in alpha) |
| System | DB connection status, reset to defaults, load/delete fake data |

### Key UI Features

- **Project switcher** in sidebar header (not hardcoded first project)
- **Run detail modal** accessible from dashboard, issues, and mission control
- **Live output streaming** via Supabase Realtime (not polling)
- **Collapsible sidebar** with mobile responsive overlay
- **Dark/light mode toggle**

## Full Journey Test

End-to-end verification that exercises the complete system. This is not optional — the rebuild is not complete until this passes.

### Authentication & Navigation
1. Log into the app via Supabase Auth
2. Log out of the app
3. Switch between dark/light mode
4. Switch between projects

### Issue Lifecycle
5. Submit an issue (UI + API)
6. Issue enters pipeline, stages begin executing
7. Watch live execution streaming (Supabase Realtime, not polling)
8. Stop a job midway (cancel)
9. Restart the stopped job
10. Change issue state manually while pipeline is running
11. Verify comments are added to the issue automatically (stage events)
12. Verify all timestamps are valid and ordered
13. Delete a comment
14. Edit a comment
15. Add a manual comment

### Pipeline & Gates
16. Verify gate holds when conditions fail
17. Verify gate auto-proceeds when conditions pass
18. Verify rework loop (review rejects → back to implementation)
19. Verify cost accumulation across stages
20. Verify KPI dashboard reflects the run accurately
21. See live job run output
22. See historical job run output

### Settings CRUD (every entity: add/edit/delete)
23. Stage
24. Gate (rules on a stage)
25. Provider
26. Harness (tool)
27. Model
28. Routing rule on provider/harness/model
29. Routing rule on gates
30. Routing rule on stages
31. Reorder routing rule line items
32. Persona
33. Cron job (routine)
34. Skill (prompt)
35. Worker (agent)
36. Team
37. Project
38. User
39. Role assignment (if RBAC exists)
40. Stage transitions (rules-engine driven, add/edit/delete)
41. Worker parallelism (max workers per stage)

### System Operations
42. Start, stop, drain, restart the orchestrator
43. Start, stop, restart the web UI
44. Start, stop, restart the DB connection to Supabase
45. Simulate server reboot while jobs are running — verify recovery
46. Load fake data
47. Delete fake data
48. Reset settings to defaults
49. Are all settings present in the web UI
50. Are stats updating on dashboard in real time and correct

### Mission Control (Orchestrator View)
51. View active stages and their status
52. View active pipelines
53. View max workers vs active workers per stage
54. See why work is not happening (queue empty, workers busy, gate held, etc.)

### CLI Parity
55. Verify the same core flows work via CLI
56. `fluxaos status` shows system health
57. `fluxaos issue create/list/view`
58. `fluxaos do "prompt"` triggers pipeline

## Process Rules

1. **No phase is complete until the user verifies it** against a running system (UI or CLI).
2. **Architecture deviations are flagged to the user**, not decided autonomously.
3. **Integration tests hit real Supabase**, not mocks.
4. **DRY from the start** — shared utilities, no copy-paste.
5. **Fail fast** — missing config crashes the app with a clear error, not a silent fallback.
