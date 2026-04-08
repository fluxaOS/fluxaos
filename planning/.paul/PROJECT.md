# fluxaOS

## What This Is

fluxaOS is a general-purpose AI orchestration operating system — a ground-up rewrite of PAT on a completely new TypeScript stack with zero legacy coupling. The core engine is vendor-free and config-driven: it executes pipelines of configurable stages, evaluates gate rules, routes work to AI providers/models/harnesses, and tracks everything. Users configure personas, pipelines, stages, gates, skills, and routing rules. The engine puts the pieces together. Not a coding tool. Not a chatbot. An OS for AI workflows — whatever those workflows are.

## Core Value

Developers can orchestrate any AI workflow end-to-end — with configurable pipelines, provider-agnostic routing, gate-controlled quality, and full observability — without coupling to any vendor or stitching together separate tools.

## Current State

| Attribute | Value |
|-----------|-------|
| Type | Application |
| Version | 0.0.1 |
| Status | Phase 2 complete — project management built |
| Last Updated | 2026-04-08 |

**Repos:**
- Planning: `fluxaOS/fluxaos-planning` (this repo)
- Source: `fluxaOS/fluxaos` (to be created at Phase 1 start)

## Requirements

### Core Features

- **Pipeline engine** — config-driven state machine: stages in order, gate evaluation, rework loops, full event-sourced observability
- **Provider-agnostic routing** — route any stage to any AI provider/model/harness via routing profiles; fallback chains; wildcard model patterns
- **Persona & skill system** — DB-stored personas (soul, identity, skills, routing, brand, memory); skills materialized from DB to disk at execution time
- **Issue-driven execution** — structured mode (issue → pipeline) and "just do it" mode (plain prompt → auto-pipeline)
- **Ports & adapters architecture** — every vendor integration behind a TypeScript interface; swap GitHub for GitLab, Supabase for Postgres, Anthropic for Ollama via config

### Validated (Shipped)
- Repository scaffold with Next.js 16, TypeScript, Tailwind CSS 4 — Phase 1
- Drizzle ORM schema (21 tables) with migrations applied to Postgres — Phase 1
- Ports-and-adapters architecture (10 port interfaces, adapter registry) — Phase 1
- Supabase AuthProvider adapter proving containment pattern — Phase 1
- tRPC server with 8 domain routers (health working, 7 stubs) — Phase 1
- GitHub Actions CI (biome + tsc + vitest) — Phase 1
- App shell with dark theme, sidebar nav, 4 route pages — Phase 1
- Issue lifecycle service with CRUD, state machine transitions, event logging — Phase 2
- GitHub IssueProvider adapter (native fetch, no Octokit) — Phase 2
- Skill registry with CRUD, version auto-increment, DB-to-disk materializer — Phase 2
- tRPC issue router (5 endpoints) and skill router (6 endpoints) with Zod validation — Phase 2
- CLI with standalone tRPC client: issue list/create/view, skill list/sync, status — Phase 2

### Active (In Progress)
- Phase 3: Personas & Configuration

### Planned (Next)
- Phase 4: Pipeline Engine

### Out of Scope (Alpha)

- Dreaming / memory consolidation
- Skill marketplace / registry
- Smart routing (BridgeBench integration)
- Non-code pipeline templates (content, social, intel)
- Multi-org support
- Provider health monitoring
- Webhook-based external gate approval
- Mobile-responsive UI
- Cost forecasting / budget alerts

## Target Users

**Alpha:** Solo developers and vibe coders working across multiple projects who want AI-assisted workflows with more control and visibility than single-shot tools (Cursor, Copilot, Claude Code alone).

**Post-Alpha:** Engineering team leads (5-20 person teams) who want governance and observability over how AI is used in their org.

## Constraints

### Technical Constraints

- Full-stack TypeScript only — one language, one build system, one type system
- No vendor coupling — every external integration behind an adapter interface; core imports only from `core/ports/`
- No Supabase imports outside `adapters/supabase/` — non-negotiable containment rule
- No Turborepo — single Next.js app with path aliases (`@/core`, `@/adapters`, etc.)
- Alpha: Supabase Cloud for auth + realtime; raw Postgres for data (3 local containers)
- Worker co-located in same process for alpha; separate container later
- Node.js subprocess management (execa) — Python escape hatch budgeted for Phase 6 if needed

### Business Constraints

- Solo developer — phases are sequential, no parallel execution
- 14-week timeline (3.5 months) to alpha; 3 months is stretch goal
- AGPLv3 license (protects against cloud providers repackaging)
- 100% GitHub — source, issues, PRs, CI all under `fluxaOS` org; no fhc dependency
- fhc stays around until flux is proven — no formal sunset

## Key Decisions

| Decision | Rationale | Date | Status |
|----------|-----------|------|--------|
| Ground-up TypeScript rewrite (no PAT code) | Domain knowledge transfers, implementation does not. One language for solo dev. | 2026-04-07 | Active |
| 100% GitHub, no Forgejo | Clean break from legacy; enables cloud compute tools | 2026-04-07 | Active |
| AGPLv3 license | Protects against repackaging; compatible with open-source → managed → acquisition strategy | 2026-04-07 | Active |
| Supabase Cloud for auth + realtime (alpha) | Avoids 12-15 container self-hosted complexity; behind adapters so swappable | 2026-04-07 | Active |
| Adapter boundaries are NON-NEGOTIABLE | Lesson from PAT/Forgejo: extracting interfaces from coupled code is the exact problem this rewrites solves | 2026-04-07 | Active |
| No Turborepo | Monorepo complexity not warranted for a single application; path aliases achieve same type sharing | 2026-04-07 | Active |
| Project management built FIRST (Phase 2) | flux manages itself from day one; avoids retrofitting | 2026-04-07 | Active |
| Skills stored in DB, materialized to disk at execution | DB is CRUD source of truth; harnesses read from filesystem | 2026-04-07 | Active |
| Worker co-located (alpha) | Simplicity for single user; DA recommended split — noted for post-alpha | 2026-04-07 | Active |
| Sequential phases | Context-switching cost exceeds parallelism gains for solo dev | 2026-04-07 | Active |

## Success Metrics

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Alpha ship date | 14 weeks from Phase 1 start | Not started | Not started |
| Docker Compose cold start | <15 min from clone to working instance | - | Not started |
| Pipeline E2E test | 3-stage run completes with routing + gates | - | Not started |
| Real AI execution | claude-code runs against a real repo via pipeline | - | Not started |
| Open-source release | v0.1.0-alpha tagged on GitHub | - | Not started |

## Tech Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| Frontend | React 19 + Next.js 15 (App Router) | SSR + API routes in one deploy target |
| Styling | Tailwind CSS 4 | Utility-first |
| API | tRPC | End-to-end type safety, zero codegen |
| Auth | Supabase Auth (adapter) | Cloud for alpha; self-hosted later |
| Database | Raw Postgres + Drizzle ORM | Lightweight, SQL-first; no Supabase Postgres dependency |
| Realtime | Supabase Realtime (adapter) | Live transcript streaming; replaceable |
| Job Queue | BullMQ (Redis) | Retries, concurrency, Bull Board |
| Subprocess | execa (Node.js) | Process spawning with timeout/cancel/streaming |
| Testing | Vitest + Playwright | Unit + E2E |
| Deployment | Docker Compose | 3 containers: Next.js app, Postgres, Redis |

## Links

| Resource | URL |
|----------|-----|
| Planning Repo | https://github.com/fluxaOS/fluxaos-planning |
| Source Repo | https://github.com/fluxaOS/fluxaos (to be created) |
| Design Spec v2 | docs/superpowers/specs/2026-04-07-fluxaos-spec-v2.md |
| Roadmap v2 | docs/superpowers/plans/2026-04-07-fluxaos-roadmap-v2.md |
| DA Review | da/2026-04-07-v2-da-review.md |

---
*PROJECT.md — Updated when requirements or context change*
*Last updated: 2026-04-08 after Phase 2*
