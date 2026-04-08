# Roadmap: fluxaOS

## Overview

fluxaOS ships in 7 phases over 14 weeks. Phase 1 lays the bones (repo, schema, auth, Docker). Phase 2 makes it self-managing (issues, skills, CLI). Phases 3-4 build the config and execution engine. Phase 5-6 wire up the UI and real AI providers. Phase 7 hardens, polishes, and ships v0.1.0-alpha on GitHub. Every phase produces working, testable software.

## Current Milestone

**v0.1.0-alpha** (first open-source release)
Status: In progress
Phases: 4 of 7 complete

## Phases

| Phase | Name | Plans | Status | Completed |
|-------|------|-------|--------|-----------|
| 1 | Foundation & Skeleton | 4 | Complete | 2026-04-08 |
| 2 | Project Management (Issues, Skills, CLI) | 3 | Complete | 2026-04-08 |
| 3 | Personas & Configuration | 3 | Complete | 2026-04-08 |
| 4 | Pipeline Engine | 4 | Complete | 2026-04-08 |
| 5 | Web UI — Core Pages | 3 | Complete | 2026-04-08 |
| 6 | AI Provider Adapters & Real Execution | TBD | Not started | - |
| 7 | Observability, Polish & Ship | TBD | Not started | - |

## Phase Details

### Phase 1: Foundation & Skeleton

**Goal:** A running Next.js app with the complete project structure, database schema, adapter registry, and auth. No business logic yet — just the bones.
**Depends on:** Nothing (source repo creation is the first step)
**Research:** Unlikely (known stack)
**Duration estimate:** Week 1-3

**Scope:**
- New GitHub repo `fluxaOS/fluxaos` — single Next.js app, path aliases, no Turborepo
- `core/ports/` — all 10 port interfaces (TypeScript interfaces only)
- `adapters/supabase/` — auth + realtime adapters
- `adapters/bullmq/` — queue adapter
- `config/` — adapter registry (env vars → implementations)
- Drizzle schema with all core entities + migrations against raw Postgres
- Seed script (default org, project, pipeline config)
- Auth flow (login/logout via Supabase Cloud, behind AuthProvider port)
- Docker Compose: 3 containers (fluxaos, postgres, redis) + Supabase Cloud
- tRPC router skeleton (empty routers for each domain)
- CI: lint (ESLint + Biome) + type-check + Vitest
- Basic app shell (App Router layout, nav, empty pages)
- AGPLv3 license file

**Plans:**
- [x] 01-01: Repo scaffold, Next.js setup, path aliases, Docker Compose
- [x] 01-02: Drizzle schema — all core entities, migrations
- [x] 01-03: Port interfaces + adapter registry + Supabase auth
- [x] 01-04: tRPC skeleton, CI pipeline, app shell

**Exit criteria:** `docker compose up` starts the app, login via Supabase Cloud works, all DB tables exist, tRPC health check returns OK.

---

### Phase 2: Project Management — Issues, Skills & CLI

**Goal:** fluxaOS manages its own development. Issue CRUD, skill storage with disk materialization, GitHub sync, minimal CLI.
**Depends on:** Phase 1 (running app + schema)
**Research:** Unlikely (GitHub API well-known)
**Duration estimate:** Week 3-5

**Scope:**
- `core/issues/` — issue lifecycle, state transitions, IssueEvent activity log
- `core/skills/` — skill registry (CRUD, versioning, attach/detach)
- `core/skills/materializer` — DB → disk sync
- `adapters/github/` — IssueProvider (bidirectional sync with GitHub Issues)
- tRPC routes: full CRUD for issues, skills, providers, models
- Minimal CLI: `issue list/create/view`, `skill list/sync`, `status`
- GitHub webhook handler (or polling fallback)
- Seed script: import existing skills from fhc format (one-time migration)

**Plans:**
- [x] 02-01: Issue core + tRPC routes + GitHub IssueProvider adapter
- [x] 02-02: Skill core + materializer + tRPC routes
- [x] 02-03: CLI (thin tRPC client wrapper)

**Exit criteria:** Issues created/listed via CLI, synced to GitHub. Skills CRUD works. `fluxaos skill sync` writes skill files to workspace. fluxaOS development tracked in its own issue system.

---

### Phase 3: Personas & Configuration

**Goal:** CRUD for personas, routing profiles, brand identity. The config layer that drives the pipeline — everything except the pipeline itself.
**Depends on:** Phase 2 (skills system)
**Research:** Unlikely
**Duration estimate:** Week 5-7

**Scope:**
- `core/agents/` — persona lifecycle (CRUD, fork, hide, extend), inheritance resolution (global → project → override)
- Routing profiles: CRUD + binding to personas
- Provider/model registry: CRUD + health check endpoint
- Brand identity: CRUD (colors, fonts, tone of voice), link to org/project/persona
- tRPC routes: personas, routing profiles, providers, models, brands
- Seed script: default personas (researcher, implementer, reviewer, deployer)
- CLI extensions: `persona list/view/create`, `config set/get`

**Plans:**
- [x] 03-01: Persona core + inheritance model + tRPC routes
- [x] 03-02: Routing profiles + provider/model registry
- [x] 03-03: Brand identity + seed data + CLI extensions

**Exit criteria:** Create persona with soul/identity/skills/routing, configure routing profiles, see full config tree via CLI and tRPC.

---

### Phase 4: Pipeline Engine

**Goal:** The core pipeline state machine — create a run, execute stages in order, evaluate gates, handle success/failure/rework.
**Depends on:** Phase 3 (personas + routing config)
**Research:** Likely (state machine design, gate rules engine complexity)
**Research topics:** State machine libraries vs hand-rolled, BullMQ job lifecycle, gate rules evaluation patterns
**Duration estimate:** Week 7-9

**Scope:**
- `core/pipeline/` — state machine (PipelineRun + StageRun lifecycles)
- `core/gates/` — rules engine (conditions, proceed/hold/rework/abort)
- `core/routing/` — routing resolver (persona → filter candidates → sort → select)
- `adapters/bullmq/` — full queue adapter (enqueue, process, retry)
- `adapters/node-exec/` — StageExecutor (execa, streaming, timeout/cancel)
- `core/observability/` — event store (append-only, typed payloads)
- Skill materialization wired into stage execution
- tRPC routes: `pipeline.start/status/cancel`, `stageRun.approve/reject`
- "Just Do It" mode: `pipeline.start({ prompt })` auto-creates ephemeral issue
- Integration test: 3-stage pipeline run end-to-end with routing, gates, and rework loop
- CLI: `fluxaos do "prompt"`, `fluxaos run --issue N`

**Plans:**
- [x] 04-01: Pipeline + StageRun state machine + event store
- [x] 04-02: Routing resolver + gate rules engine
- [x] 04-03: BullMQ + node-exec adapters + skill materialization wire-up
- [x] 04-04: "Just Do It" mode + integration test + CLI extensions

**Exit criteria:** 3-stage pipeline completes end-to-end in test. Routing, gate evaluation, rework loop, subprocess streaming all work. "Just Do It" mode works via CLI.

---

### Phase 5: Web UI — Core Pages

**Goal:** The web interface — dashboard, issues, pipeline runs, live transcript, settings.
**Depends on:** Phase 4 (working pipeline engine)
**Research:** Unlikely (UI patterns established)
**Duration estimate:** Week 9-11

**Scope:**
- Dashboard (project selector, recent runs, quick stats)
- Issues page (list/filter, create form, detail with activity log)
- Pipeline runs page + run detail with live transcript (Supabase Realtime)
- Settings pages: Pipelines, Personas, Skills, Routing, Project
- "Just Do It" prompt box on dashboard
- Gate approval UI in run detail

**Plans:**
- [x] 05-01: Dashboard + issues pages
- [x] 05-02: Pipeline runs + run detail + live transcript
- [x] 05-03: Settings pages (pipelines, personas, skills, routing)

**Exit criteria:** Login → configure → run → observe → approve/reject, all in browser.

---

### Phase 6: AI Provider Adapters & Real Execution

**Goal:** Wire up real AI providers — claude-code, aider — spawned as subprocesses with real API keys.
**Depends on:** Phase 4 (pipeline engine)
**Research:** Likely (harness integration, streaming from claude-code, cost parsing)
**Research topics:** claude-code subprocess invocation patterns, token/cost extraction from output, execa streaming edge cases
**Duration estimate:** Week 10-12

**Scope:**
- `adapters/anthropic/` — AIProvider (key management, model listing, health check)
- `adapters/openai/` — AIProvider
- `adapters/github/` — GitProvider (create branch, create PR, read PR status)
- Harness integration: spawn claude-code/aider with materialized persona + skills, stream stdout
- Prompt assembly: soul + skill template + issue context → final harness prompt
- Cost parsing: extract token counts + cost from harness output
- Provider fallback: auto-select next candidate on failure

**Plans:**
- [ ] 06-01: Anthropic + OpenAI AIProvider adapters
- [ ] 06-02: GitHub GitProvider adapter
- [ ] 06-03: Harness integration (claude-code subprocess, prompt assembly, cost parsing)
- [ ] 06-04: Provider fallback + real end-to-end pipeline test

**Exit criteria:** Full pipeline run with claude-code executing real code changes against a real repo, streaming to UI, with accurate cost tracking. Provider fallback works.

---

### Phase 7: Observability, Polish & Ship

**Goal:** KPI dashboard, Docker Compose hardening, README, E2E tests, GitHub alpha release.
**Depends on:** All phases
**Research:** Unlikely
**Duration estimate:** Week 12-14

**Scope:**
- KPI dashboard (pipeline runs, success rate, cost breakdown, persona effectiveness)
- Docker Compose hardening (`docker compose up` from cold clone works with env vars only)
- README + install guide (15-minute cold start)
- Default seed data (Standard Dev pipeline, 4 default personas)
- E2E test suite: login → configure → run → observe → approve
- Bug sweep (all known issues from phases 1-6)
- GitHub release: v0.1.0-alpha with changelog
- AGPLv3 license file, .github/ (issue templates, contributing guide, CI)

**Plans:**
- [ ] 07-01: KPI dashboard
- [ ] 07-02: Docker Compose hardening + default seed data
- [ ] 07-03: README + install guide
- [ ] 07-04: E2E tests + bug sweep + GitHub release

**Exit criteria:** Clone → `docker compose up` → follow README → working fluxaOS in <15 minutes. v0.1.0-alpha tagged on GitHub.

---
*Roadmap created: 2026-04-07*
*Last updated: 2026-04-07*
