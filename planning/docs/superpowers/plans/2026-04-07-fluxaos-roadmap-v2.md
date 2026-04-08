# fluxaOS — Implementation Roadmap v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Supersedes:** [v1](2026-04-07-fluxaos-roadmap.md)

**Goal:** Ship fluxaOS alpha on GitHub within 3-4 months — a general-purpose AI orchestration OS with configurable pipelines, routing, gates, personas, and observability.

**Architecture:** Full-stack TypeScript (Next.js 15 + tRPC + Drizzle + Supabase + BullMQ). Ports & adapters for all vendor integrations. Event-sourced execution model. See [design spec v2](2026-04-07-fluxaos-spec-v2.md) for full details.

**Tech Stack:** Next.js 15, React 19, tRPC, Drizzle ORM, Raw Postgres, Supabase Cloud (Auth + Realtime), BullMQ (Redis), Tailwind CSS 4, Vitest, Playwright

**Key change from v1:** Phases reordered so project management (issues, skills, CLI) comes before the pipeline engine. fluxaOS manages itself from Phase 2 onward.

**Approach:** This roadmap defines 7 phases. Each phase is a self-contained milestone that produces working, testable software. Each phase will get its own deep-dive planning session with task-by-task breakdowns before implementation begins.

---

## Pre-Flight: Open Questions — RESOLVED

- [x] **Repo name and GitHub org** — `fluxaOS/fluxaos` (org: fluxaOS, planning: `fluxaOS/fluxaos-planning`)
- [x] **License** — AGPLv3
- [x] **Supabase vs raw Postgres for alpha** — Supabase Cloud for auth + realtime, raw Postgres for data. Behind port interfaces (no Supabase imports outside `adapters/supabase/`). Self-hosted later.
- [x] **Worker in same process or separate container** — Same process for alpha, split into separate container later when needed

---

## Phase 1: Foundation & Skeleton (Week 1-3)

**Goal:** A running Next.js app with the complete project structure, database schema, adapter registry, and auth. No business logic yet — just the bones.

**Delivers:**
- New GitHub repo (`fluxaOS/fluxaos`) — single Next.js app with path aliases (`@/core`, `@/adapters`, etc.), no Turborepo
- `core/ports/` — all 10 port interfaces defined (TypeScript interfaces only, no implementations)
- `adapters/supabase/` — auth + realtime adapters (Supabase Cloud)
- `adapters/bullmq/` — queue adapter
- `config/` — adapter registry that reads env vars and resolves to implementations
- Drizzle schema with all core entities from [spec data model](2026-04-07-fluxaos-spec-v2.md#data-model) — migrations running against raw Postgres
- Seed script that creates default org, project, and pipeline config
- Auth flow (login/logout via Supabase Auth, behind AuthProvider port)
- Docker Compose with 3 local containers (fluxaos, postgres, redis) + Supabase Cloud
- tRPC router skeleton (empty routers for each domain)
- CI: lint (ESLint + Biome) + type-check + Vitest
- Basic app shell (Next.js App Router with layout, nav, empty pages)
- AGPLv3 license file

**Key decisions locked in this phase:**
- Exact Drizzle schema (column types, constraints, indexes)
- tRPC router structure
- Adapter registration pattern
- Project directory layout (final)

**Spec references:**
- [System Architecture](2026-04-07-fluxaos-spec-v2.md#system-architecture)
- [Data Model](2026-04-07-fluxaos-spec-v2.md#data-model)
- [Deployment](2026-04-07-fluxaos-spec-v2.md#deployment)

**Exit criteria:** `docker compose up` starts the app, you can log in via Supabase Cloud, the DB has all tables, tRPC health check returns OK.

---

## Phase 2: Project Management — Issues, Skills & CLI (Week 2-4)

**Goal:** fluxaOS can manage its own development. Issue CRUD, skill storage with disk materialization, GitHub sync, and a minimal CLI. After this phase, flux manages itself.

**This is the new Phase 2.** In v1, this was split across Phases 3 and 6. We're pulling it forward because flux needs to be self-managing before we build the pipeline engine.

**Delivers:**
- `core/issues/` — issue lifecycle (create, state transitions, activity log via IssueEvent)
- `core/skills/` — skill registry (CRUD, versioning, attach/detach from personas)
- `core/skills/materializer` — DB → disk sync (write skills to workspace before harness execution)
- `adapters/github/` — IssueProvider (sync issues bidirectionally with GitHub Issues)
- tRPC routes: full CRUD for issues, skills, providers, models
- **Minimal CLI** — `fluxaos` command using tRPC client:
  - `fluxaos issue list` — list issues (from DB, synced with GitHub)
  - `fluxaos issue create "title"` — create issue (writes to DB + GitHub)
  - `fluxaos issue view N` — view issue detail
  - `fluxaos skill list` — list skills
  - `fluxaos skill sync` — materialize skills from DB to workspace
  - `fluxaos status` — system health check
- Seed script: import existing skills from templates (one-time migration from fhc skill format)
- GitHub webhook handler for issue sync (or polling fallback)

**Why this order matters:** Once this phase is complete, all fluxaOS development issues live in GitHub, managed through the `fluxaos` CLI. Skills are DB-stored and materialized to disk. The project is self-hosting its own management tooling.

**Spec references:**
- [Skill Materialization](2026-04-07-fluxaos-spec-v2.md#skill-materialization-db--disk)
- [CLI Architecture](2026-04-07-fluxaos-spec-v2.md#cli-architecture)

**Exit criteria:** Can create/list/view issues via CLI, issues sync to GitHub, skills CRUD works, `fluxaos skill sync` writes skill files to a workspace directory. fluxaOS development is tracked in its own issue system.

---

## Phase 3: Personas & Configuration (Week 3-5)

**Goal:** CRUD for personas, routing profiles, brand identity. The config layer that drives the pipeline — everything except the pipeline itself.

**Delivers:**
- `core/agents/` — persona lifecycle (create, read, update, fork, hide, extend), inheritance resolution (global → project → override)
- Routing profiles: CRUD + binding to personas
- Provider/model registry: CRUD + health check endpoint
- Brand identity: CRUD for brand records (colors, fonts, tone of voice), link to org/project/persona
- tRPC routes: full CRUD for personas, routing profiles, providers, models, brands
- Seed script: default personas (researcher, implementer, reviewer, deployer) with routing rules
- CLI extensions:
  - `fluxaos persona list/view/create`
  - `fluxaos config set/get`

**Spec references:**
- [Persona & Knowledge System](2026-04-07-fluxaos-spec-v2.md#persona--knowledge-system)
- [Routing Engine](2026-04-07-fluxaos-spec-v2.md#routing-engine) (config only, not execution)

**Exit criteria:** Can create a persona with soul/identity/skills/routing, configure routing profiles, and see the full config tree via CLI and tRPC.

---

## Phase 4: Pipeline Engine (Week 4-6)

**Goal:** The core pipeline state machine — create a run, execute stages in order, evaluate gates, handle success/failure/rework. Driven via tRPC calls and tests.

**Delivers:**
- `core/pipeline/` — state machine (PipelineRun lifecycle: pending → running → completed/failed)
- `core/pipeline/` — stage runner (StageRun lifecycle: queued → running → completed/failed/cancelled/timed_out)
- `core/gates/` — rules engine (evaluate conditions, determine proceed/hold/rework/abort)
- `core/routing/` — routing resolver (match persona → filter by allowed_models × providers × harnesses → sort → select)
- `adapters/bullmq/` — queue adapter (enqueue stage jobs, process them)
- `adapters/node-exec/` — StageExecutor (execa-based subprocess spawning, stdout streaming, timeout/cancel)
- `core/observability/` — event store (append events to DB, typed event payloads)
- Skill materialization wired into stage execution (DB → disk before harness spawns)
- tRPC routes: `pipeline.start()`, `pipeline.status()`, `pipeline.cancel()`, `stageRun.approve()`, `stageRun.reject()`
- "Just Do It" flow — `pipeline.start({ prompt })` auto-creates ephemeral issue, picks default pipeline, auto-approves gates
- Integration test: create a pipeline config → start a run → watch stages execute → gates evaluate → run completes
- CLI extensions:
  - `fluxaos do "prompt"` — just do it mode
  - `fluxaos run --issue N` — structured mode

**This is the hardest phase.** The state machine, routing resolver, and gate rules engine are the brain of fluxaOS. Get this right and everything else is UI and adapters.

**Spec references:**
- [Pipeline Execution](2026-04-07-fluxaos-spec-v2.md#pipeline-execution)
- [Routing Engine](2026-04-07-fluxaos-spec-v2.md#routing-engine)
- [Gates & Rules Engine](2026-04-07-fluxaos-spec-v2.md#gates--rules-engine)

**Exit criteria:** A pipeline run with 3 stages completes end-to-end via test, with routing, gate evaluation, and event streaming all working. Rework loop (review rejects → back to implement) works. Subprocess output streams to event store in real-time. "Just Do It" mode works via CLI.

---

## Phase 5: Web UI — Core Pages (Week 5-7)

**Goal:** The web interface — dashboard, issues list, pipeline runs, live transcript, settings. Functional, not polished.

**Delivers:**
- **Dashboard** — project selector, recent runs with status/cost/duration, quick stats (success rate, total cost)
- **Issues page** — list with filters (state, priority, type), create issue form, issue detail with activity log
- **Pipeline runs page** — list of runs with status, click into run detail
- **Run detail** — stage-by-stage view with live transcript (Supabase Realtime subscription on events table), gate status, cost breakdown
- **Settings pages:**
  - Pipelines: stage configuration (add/remove/reorder), gate rules per stage
  - Personas: CRUD with soul, identity, skills tabs
  - Skills: CRUD with prompt template editor, version history
  - Routing: provider/model registry, routing profiles
  - Project: general settings, default pipeline
- "Just Do It" input — chat-style prompt box on dashboard that triggers `pipeline.start({ prompt })`
- Gate approval UI — when a gate holds, show approval/reject buttons in run detail

**Spec references:**
- All UI-related sections of [design spec v2](2026-04-07-fluxaos-spec-v2.md)

**Exit criteria:** A user can log in, create a project, configure a pipeline with personas and routing, create an issue (or use "just do it"), watch the pipeline execute in real-time, approve/reject gates, and see the result. All in the browser.

---

## Phase 6: AI Provider Adapters & Real Execution (Week 6-8)

**Goal:** Wire up real AI providers so the pipeline actually executes real work — claude-code, aider, etc. spawned as subprocesses with real API keys.

**Delivers:**
- `adapters/anthropic/` — AIProvider for Anthropic (API key management, model listing, health check)
- `adapters/openai/` — AIProvider for OpenAI
- `adapters/github/` — GitProvider (create branch, create PR, read PR status)
- Harness integration — StageExecutor spawns `claude-code` (or `aider`) with materialized persona prompt + skills, streams stdout, captures cost/token data from output
- Prompt assembly — combine persona soul + skill prompt template + issue context into the final prompt passed to the harness
- Cost parsing — extract token counts and cost from harness output
- Provider fallback — if primary provider/model fails, auto-select next candidate from routing chain

**This is where the "does Node.js subprocess management work?" question gets answered.** If execa fights us on streaming/signals, this is the phase where we swap to a Python worker.

**Spec references:**
- [Routing Engine](2026-04-07-fluxaos-spec-v2.md#routing-engine)
- [Adapter Architecture](2026-04-07-fluxaos-spec-v2.md#adapter-architecture-ports--adapters)

**Exit criteria:** A full pipeline run with claude-code executing real code changes against a real repo, streaming output to the UI in real-time, with accurate cost tracking. Provider fallback works when a provider returns an error.

---

## Phase 7: Observability, Polish & Ship (Week 7-10)

**Goal:** KPI dashboard, Docker Compose hardening, README, E2E tests, and alpha release.

**Delivers:**
- **KPI Dashboard** — new page in web UI:
  - Top-level metrics: pipeline runs, success rate, total cost, avg cost/run, tokens used
  - Breakdown charts: cost by provider, cost by stage, runs by persona
  - Date range filter, project filter
  - CSV/JSON export
- **Docker Compose hardening** — `docker compose up` from a fresh clone works with zero manual steps beyond setting env vars
- **README** — what fluxaOS is, screenshots, quick start, architecture overview
- **Install guide** — step-by-step for self-hosted deployment (Docker Compose)
- **Default seed data** — sensible defaults for a coding pipeline: default org, project, "Standard Dev" pipeline, researcher/implementer/reviewer personas, basic routing profile
- **E2E test suite** — Playwright tests covering the critical path: login → configure → run → observe → approve
- **Bug sweep** — fix all known issues from phases 1-6
- **GitHub release** — tag v0.1.0-alpha, create release with changelog
- **License file** — AGPLv3
- **.github/** — issue templates, contributing guide, CI workflow (lint + type-check + test)

**Spec references:**
- [Observability & KPIs](2026-04-07-fluxaos-spec-v2.md#observability--kpis)
- [Alpha MVP Scope](2026-04-07-fluxaos-spec-v2.md#alpha-mvp-scope)
- [Deployment](2026-04-07-fluxaos-spec-v2.md#deployment)

**Exit criteria:** Someone can clone the repo, run `docker compose up`, follow the README, and have a working fluxaOS instance running a real pipeline within 15 minutes. GitHub stars start coming in.

---

## Phase Summary

| Phase | Focus | Duration | Depends On |
|-------|-------|----------|------------|
| Pre-Flight | Open questions | DONE | — |
| 1. Foundation | Repo, schema, auth, Docker | Week 1-3 | Pre-Flight |
| 2. Project Management | Issues, skills, CLI, GitHub sync | Week 3-5 | Phase 1 |
| 3. Personas & Config | Persona CRUD, routing profiles, brands | Week 5-7 | Phase 2 |
| 4. Pipeline Engine | State machine, routing, gates, executor | Week 7-9 | Phase 3 |
| 5. Web UI | Dashboard, issues, runs, settings | Week 9-11 | Phase 4 |
| 6. AI Providers | Real execution, GitHub git adapter | Week 10-12 | Phase 4 |
| 7. Polish & Ship | KPIs, Docker, README, E2E tests, release | Week 12-14 | All phases |

**Parallelism:** Phases 5 and 6 can partially overlap (UI and provider adapters are independent). Phase 7 is the tail. Per DA review, phases are sequential for a solo developer — context-switching between parallel phases costs more than it saves.

**Self-hosting milestone:** After Phase 2, fluxaOS manages its own issues and skills. All subsequent development is tracked through flux itself. If Phase 2's issue system isn't reliable, fall back to GitHub Issues directly — dogfooding pride must not block velocity.

**Timeline:** 14 weeks (3.5 months) is the realistic target. 3 months is the stretch goal. Do not let timeline pressure erode the adapter boundaries.

---

## How to Use This Roadmap

**This is NOT the implementation plan.** This is the structure that organizes deep-dive planning sessions.

For each phase:
1. Open a new session
2. Reference this roadmap and the [design spec v2](2026-04-07-fluxaos-spec-v2.md)
3. Create the detailed task-by-task plan for that phase (with code, tests, exact file paths)
4. Execute the plan
5. Mark the phase complete

Each phase produces working software that can be tested independently. Don't start a phase's deep-dive until its dependencies are complete (except phases 2 and 3 which can run in parallel).
