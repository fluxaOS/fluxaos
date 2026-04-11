# fluxaOS — High-Level Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship fluxaOS alpha on GitHub within 1-3 months — a general-purpose AI orchestration OS with configurable pipelines, routing, gates, personas, and observability.

**Architecture:** Full-stack TypeScript (Next.js 15 + tRPC + Drizzle + Supabase + BullMQ). Ports & adapters for all vendor integrations. Event-sourced execution model. See [design spec](../specs/2026-04-07-fluxaos-rewrite-design.md) for full details.

**Tech Stack:** Next.js 15, React 19, tRPC, Drizzle ORM, Supabase (Postgres + Auth + Realtime), BullMQ (Redis), Tailwind CSS 4, Turborepo, Vitest, Playwright

**Approach:** This roadmap defines 7 phases. Each phase is a self-contained milestone that produces working, testable software. Each phase will get its own deep-dive planning session with task-by-task breakdowns before implementation begins.

---

## Pre-Flight: Open Questions (resolve before Phase 1)

These decisions from the [design spec](../specs/2026-04-07-fluxaos-rewrite-design.md#open-questions) must be answered before starting:

- [x] **Repo name and GitHub org** — `fluxaOS/fluxaos` (org: fluxaOS, planning: `fluxaOS/fluxaos-planning`)
- [x] **License** — AGPLv3
- [x] **Supabase vs raw Postgres for alpha** — Supabase self-hosted, behind port interfaces (auth + realtime only; all queries via Drizzle; no Supabase imports outside `adapters/supabase/`)
- [x] **Worker in same process or separate container** — Same process for alpha, split into separate container later when needed

---

## Phase 1: Foundation & Skeleton (Week 1-2)

**Goal:** A running Next.js app with the complete project structure, database schema, adapter registry, and auth. No business logic yet — just the bones.

**Delivers:**
- New GitHub repo with Turborepo monorepo structure
- `core/ports/` — all 10 port interfaces defined (TypeScript interfaces only, no implementations)
- `adapters/` — Supabase auth, Supabase DB, BullMQ queue adapters wired up
- `config/` — adapter registry that reads env vars and resolves to implementations
- Drizzle schema with all core entities from [spec data model](../specs/2026-04-07-fluxaos-rewrite-design.md#data-model) — migrations running
- Seed script that creates default org, project, and pipeline config
- Auth flow (login/logout via Supabase Auth)
- Docker Compose with all 3 containers running
- tRPC router skeleton (empty routers for each domain)
- CI: lint (ESLint + Biome) + type-check + Vitest
- Basic app shell (Next.js App Router with layout, nav, empty pages)

**Key decisions locked in this phase:**
- Exact Drizzle schema (column types, constraints, indexes)
- tRPC router structure
- Adapter registration pattern
- Project directory layout (final)

**Spec references:**
- [System Architecture](../specs/2026-04-07-fluxaos-rewrite-design.md#system-architecture)
- [Data Model](../specs/2026-04-07-fluxaos-rewrite-design.md#data-model)
- [Deployment](../specs/2026-04-07-fluxaos-rewrite-design.md#deployment)

**Exit criteria:** `docker compose up` starts the app, you can log in, the DB has all tables, tRPC health check returns OK.

---

## Phase 2: Pipeline Engine (Week 2-4)

**Goal:** The core pipeline state machine — create a run, execute stages in order, evaluate gates, handle success/failure/rework. No UI yet, all driven via tRPC calls and tests.

**Delivers:**
- `core/pipeline/` — state machine (PipelineRun lifecycle: pending → running → completed/failed)
- `core/pipeline/` — stage runner (StageRun lifecycle: queued → running → completed/failed/cancelled/timed_out)
- `core/gates/` — rules engine (evaluate conditions, determine proceed/hold/rework/abort)
- `core/routing/` — routing resolver (match persona → filter by allowed_models × providers × harnesses → sort → select)
- `adapters/bullmq/` — queue adapter (enqueue stage jobs, process them)
- `adapters/node-exec/` — StageExecutor (execa-based subprocess spawning, stdout streaming, timeout/cancel)
- `core/observability/` — event store (append events to DB, typed event payloads)
- tRPC routes: `pipeline.start()`, `pipeline.status()`, `pipeline.cancel()`, `stageRun.approve()`, `stageRun.reject()`
- Integration test: create a pipeline config → start a run → watch stages execute → gates evaluate → run completes

**This is the hardest phase.** The state machine, routing resolver, and gate rules engine are the brain of fluxaOS. Get this right and everything else is UI and adapters.

**Spec references:**
- [Pipeline Execution](../specs/2026-04-07-fluxaos-rewrite-design.md#pipeline-execution)
- [Routing Engine](../specs/2026-04-07-fluxaos-rewrite-design.md#routing-engine)
- [Gates & Rules Engine](../specs/2026-04-07-fluxaos-rewrite-design.md#gates--rules-engine)

**Exit criteria:** A pipeline run with 3 stages completes end-to-end via test, with routing, gate evaluation, and event streaming all working. Rework loop (review rejects → back to implement) works. Subprocess output streams to event store in real-time.

---

## Phase 3: Personas, Skills & Issues (Week 3-5)

**Goal:** CRUD for all the config that drives the pipeline — personas, skills, issues, routing profiles. DB-stored, API-accessible, with inheritance model.

**Delivers:**
- `core/agents/` — persona lifecycle (create, read, update, fork, hide, extend), inheritance resolution (global → project → override)
- `core/skills/` — skill registry (CRUD, versioning, attach/detach from personas)
- `core/issues/` — issue lifecycle (create, state transitions, activity log via IssueEvent)
- "Just Do It" flow — `pipeline.start({ prompt })` auto-creates ephemeral issue, picks default pipeline, auto-approves gates
- tRPC routes: full CRUD for personas, skills, issues, routing profiles, providers, models
- Routing profiles: CRUD + binding to personas
- Provider/model registry: CRUD + health check endpoint
- Brand identity: CRUD for brand records (colors, fonts, tone of voice), link to org/project/persona
- Seed script: default "Standard Dev" pipeline with research → implement → review → deploy stages, default personas bound to each

**Spec references:**
- [Persona & Knowledge System](../specs/2026-04-07-fluxaos-rewrite-design.md#persona--knowledge-system)
- [CLI Architecture](../specs/2026-04-07-fluxaos-rewrite-design.md#cli-architecture) (the tRPC routes the CLI will call)

**Exit criteria:** Can create a persona with soul/identity/skills/routing, create an issue, and trigger a pipeline run that uses the persona's routing rules. "Just Do It" mode works end-to-end via tRPC.

---

## Phase 4: Web UI — Core Pages (Week 4-6)

**Goal:** The web interface — dashboard, issues list, pipeline runs, live transcript, settings. Functional, not polished.

**Delivers:**
- **Dashboard** — project selector, recent runs with status/cost/duration, quick stats (success rate, total cost)
- **Issues page** — list with filters (state, priority, type), create issue form, issue detail with activity log
- **Pipeline runs page** — list of runs with status, click into run detail
- **Run detail** — stage-by-stage view with live transcript (Supabase Realtime subscription on events table), gate status, cost breakdown
- **Settings pages:**
  - Pipelines: stage configuration (add/remove/reorder), gate rules per stage
  - Personas: CRUD with soul, identity, skills tabs
  - Routing: provider/model registry, routing profiles
  - Project: general settings, default pipeline
- "Just Do It" input — chat-style prompt box on dashboard that triggers `pipeline.start({ prompt })`
- Gate approval UI — when a gate holds, show approval/reject buttons in run detail

**Spec references:**
- All UI-related sections of [design spec](../specs/2026-04-07-fluxaos-rewrite-design.md)
- Visual mockups in `.superpowers/brainstorm/642024-1775569874/content/`

**Exit criteria:** A user can log in, create a project, configure a pipeline with personas and routing, create an issue (or use "just do it"), watch the pipeline execute in real-time, approve/reject gates, and see the result. All in the browser.

---

## Phase 5: AI Provider Adapters & Real Execution (Week 5-7)

**Goal:** Wire up real AI providers so the pipeline actually executes real work — claude-code, aider, etc. spawned as subprocesses with real API keys.

**Delivers:**
- `adapters/anthropic/` — AIProvider for Anthropic (API key management, model listing, health check)
- `adapters/openai/` — AIProvider for OpenAI
- Harness integration — StageExecutor spawns `claude-code` (or `aider`) with the persona's prompt, streams stdout, captures cost/token data from output
- Prompt assembly — combine persona soul + skill prompt template + issue context into the final prompt passed to the harness
- Cost parsing — extract token counts and cost from harness output (claude-code outputs cost data, aider outputs token counts)
- Provider fallback — if primary provider/model fails, auto-select next candidate from routing chain
- GitHub adapter — `adapters/github/` with GitProvider (create branch, create PR, read PR status) and IssueProvider (sync issues from GitHub)

**This is where the "does Node.js subprocess management work?" question gets answered.** If execa fights us on streaming/signals, this is the phase where we swap to a Python worker.

**Spec references:**
- [Routing Engine](../specs/2026-04-07-fluxaos-rewrite-design.md#routing-engine)
- [Adapter Architecture](../specs/2026-04-07-fluxaos-rewrite-design.md#adapter-architecture-ports--adapters)

**Exit criteria:** A full pipeline run with claude-code executing real code changes against a real repo, streaming output to the UI in real-time, with accurate cost tracking. Provider fallback works when a provider returns an error.

---

## Phase 6: CLI & Observability (Week 6-8)

**Goal:** The CLI tool and the KPI dashboard. Two interfaces, one API.

**Delivers:**
- **CLI** — `fluxaos` command using the same tRPC client as the web UI:
  - `fluxaos do "prompt"` — just do it mode
  - `fluxaos run --issue N` — structured mode
  - `fluxaos issue list/create/view`
  - `fluxaos status` — current pipeline status
  - `fluxaos config set/get` — configuration
  - Terminal-based output renderer (live stage output, status indicators)
- **KPI Dashboard** — new page in web UI:
  - Top-level metrics: pipeline runs, success rate, total cost, avg cost/run, tokens used
  - Breakdown charts: cost by provider, cost by stage, runs by persona
  - Date range filter, project filter
  - Per-run cost breakdown (already exists in run detail, but aggregated here)
- **Export** — CSV/JSON export for KPI data

**Spec references:**
- [CLI Architecture](../specs/2026-04-07-fluxaos-rewrite-design.md#cli-architecture)
- [Observability & KPIs](../specs/2026-04-07-fluxaos-rewrite-design.md#observability--kpis)

**Exit criteria:** Can do everything from the CLI that you can do from the web UI. KPI dashboard shows accurate pipeline intelligence metrics. Export works.

---

## Phase 7: Polish & Ship (Week 7-10)

**Goal:** Docker Compose works out of the box, README is clear, install guide is tested, known bugs are fixed, alpha is tagged and pushed to GitHub.

**Delivers:**
- **Docker Compose hardening** — `docker compose up` from a fresh clone works with zero manual steps beyond setting env vars
- **README** — what fluxaOS is, screenshots, quick start, architecture overview
- **Install guide** — step-by-step for self-hosted deployment (Docker Compose)
- **Default seed data** — sensible defaults for a coding pipeline: default org, project, "Standard Dev" pipeline, researcher/implementer/reviewer personas, basic routing profile
- **E2E test suite** — Playwright tests covering the critical path: login → configure → run → observe → approve
- **Bug sweep** — fix all known issues from phases 1-6
- **GitHub release** — tag v0.1.0-alpha, create release with changelog
- **License file** — per decision from pre-flight
- **.github/** — issue templates, contributing guide, CI workflow (lint + type-check + test)

**Spec references:**
- [Alpha MVP Scope](../specs/2026-04-07-fluxaos-rewrite-design.md#alpha-mvp-scope)
- [Deployment](../specs/2026-04-07-fluxaos-rewrite-design.md#deployment)

**Exit criteria:** Someone can clone the repo, run `docker compose up`, follow the README, and have a working fluxaOS instance running a real pipeline within 15 minutes. GitHub stars start coming in.

---

## Phase Summary

| Phase | Focus | Duration | Depends On |
|-------|-------|----------|------------|
| Pre-Flight | Open questions | Day 1 | — |
| 1. Foundation | Repo, schema, auth, Docker | Week 1-2 | Pre-Flight |
| 2. Pipeline Engine | State machine, routing, gates, executor | Week 2-4 | Phase 1 |
| 3. Personas & Issues | CRUD, inheritance, "just do it" | Week 3-5 | Phase 1 (parallel with 2) |
| 4. Web UI | Dashboard, issues, runs, settings | Week 4-6 | Phases 2 + 3 |
| 5. AI Providers | Real execution, GitHub adapter | Week 5-7 | Phase 2 |
| 6. CLI & KPIs | CLI tool, observability dashboard | Week 6-8 | Phases 3 + 4 |
| 7. Polish & Ship | Docker, README, E2E tests, release | Week 7-10 | All phases |

**Parallelism:** Phases 2 and 3 can run in parallel (different domains, same DB). Phases 4 and 5 can partially overlap. Phase 6 depends on the API being stable (phases 2-4). Phase 7 is the tail.

---

## How to Use This Roadmap

**This is NOT the implementation plan.** This is the structure that organizes deep-dive planning sessions.

For each phase:
1. Open a new session
2. Reference this roadmap and the [design spec](../specs/2026-04-07-fluxaos-rewrite-design.md)
3. Create the detailed task-by-task plan for that phase (with code, tests, exact file paths)
4. Execute the plan
5. Mark the phase complete

Each phase produces working software that can be tested independently. Don't start a phase's deep-dive until its dependencies are complete (except phases 2 and 3 which can run in parallel).
