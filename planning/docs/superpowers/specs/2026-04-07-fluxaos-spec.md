# fluxaOS — Design Specification

**Date:** 2026-04-07
**Status:** Draft
**Author:** Joe Pierce + Claude

## Executive Summary

fluxaOS is a general-purpose AI orchestration operating system. It is a ground-up rewrite of PAT, built on a completely new tech stack with zero legacy coupling. The core engine is vendor-free and config-driven — it executes pipelines of configurable stages, evaluates gate rules, routes work to AI providers/models/harnesses, and tracks everything. The engine does not know what it's orchestrating. Users configure personas, pipelines, stages, gates, skills, and routing rules. fluxaOS puts the pieces together.

**Not a coding tool.** Not a chatbot. An OS for AI workflows — whatever those workflows are.

## Motivation

### Why rewrite?

1. **fh-commons coupling is a drag on velocity** — 42 imports, template syncing, shared CLI framework. Every change risks breaking the ecosystem.
2. **Python stack questioned for long-term** — two languages (Python backend + TypeScript frontend) means double the cognitive overhead for a solo developer.
3. **"v2" naming and Forgejo coupling** bake vendor assumptions into the codebase. Decoupling has consumed weeks of effort that could have gone into product.
4. **The vision outgrew the architecture.** PAT was built as a coding pipeline tool. fluxaOS is a general-purpose AI workflow OS. The architecture needs to match.

### What transfers from PAT?

**Domain knowledge, not code.** The proven concepts — staged pipelines, provider-agnostic routing, fallback chains, gate system, issue-driven execution, real-time observability, cost tracking, persona management — all survive as design patterns. The implementation is new.

## Founding Principles

These are non-negotiable. Every design decision flows from them.

1. **No vendor coupling.** Every external integration is behind an adapter interface. Core business logic imports from `core/ports/` only. Swap GitHub for GitLab, Supabase for raw Postgres, Anthropic for Ollama — via config, never touching core code.

2. **Everything is config.** Stages, personas, skills, gates, routing rules, pipelines — all DB records editable in the UI. The engine reads config and executes. Zero hardcoded behavior, zero hardcoded names, zero hardcoded URLs.

3. **One language.** Full-stack TypeScript. One build system, one type system, one set of patterns. Maximum leverage for a solo developer + Claude.

4. **The engine is generic.** It doesn't know if it's writing code, generating blog posts, running competitive analysis, or scheduling social media. Stages execute, gates evaluate, output streams. What the stages DO is defined by personas and skills.

5. **Scalable, flexible, modular.** Every component has a clean boundary. Every dependency is injectable. The system grows by adding adapters and config, not by rewriting core logic.

## Target User

**Phase 1:** Solo developers and vibe coders working across multiple projects who want AI-assisted workflows with more control and visibility than single-shot tools (Cursor, Copilot, Claude Code alone).

**Phase 2:** Engineering team leads (5-20 person teams) who want governance and observability over how AI is used in their org.

**Deployment:** Self-hosted Docker Compose first. Cloud-hosted option later when there's demand.

**GTM:** Open-source alpha on GitHub within 1-3 months.

## System Architecture

### Four-Layer Stack

```
┌─────────────────────────────────────────────────┐
│  Browser — React + Next.js App Router           │
│  Dashboard, Issues, Pipeline Runs, Settings,    │
│  Live Transcript, Cost Tracking, Routing Config │
└──────────────────┬──────────────────────────────┘
                   │ Supabase Realtime + tRPC
┌──────────────────┴──────────────────────────────┐
│  Next.js Server — API + SSR                     │
│  tRPC Router, Auth Middleware, Job Dispatcher,   │
│  Pipeline State Machine, Routing Engine          │
└──────────────────┬──────────────────────────────┘
                   │ BullMQ Job Queue (Redis)
┌──────────────────┴──────────────────────────────┐
│  Stage Executor Worker (TypeScript)             │
│  Process Spawner, Output Streamer, Lifecycle    │
│  Manager — behind StageExecutor interface       │
│  (swap to Python worker if subprocess mgmt      │
│   proves inadequate in Node.js)                 │
└──────────────────┬──────────────────────────────┘
         ┌─────────┴─────────┐
         │ Supabase (Postgres)│  Redis
         └───────────────────┘
```

### Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React 19 + Next.js 15 (App Router) | SSR + API routes in one deploy target |
| Styling | Tailwind CSS 4 | Utility-first, no CSS files to manage |
| API | tRPC | End-to-end type safety, zero codegen |
| Auth | Supabase Auth (adapter) | JWT-based, OAuth providers, self-hosted option |
| Database | Supabase Postgres + Drizzle ORM | Lightweight, SQL-first, type-safe ORM |
| Realtime | Supabase Realtime | Live transcript streaming via DB subscriptions |
| Job Queue | BullMQ (Redis) | Retries, concurrency control, Bull Board dashboard |
| Subprocess | execa (Node.js) | Process spawning with timeout/cancel/streaming |
| Monorepo | Turborepo | Shared types, parallel builds |
| Testing | Vitest + Playwright | Unit + E2E |
| Deployment | Docker Compose | Next.js + Supabase self-hosted + Redis = 3 containers |

### Adapter Architecture (Ports & Adapters)

Core business logic lives in `core/` and imports ONLY from `core/ports/` — TypeScript interfaces that define contracts. Adapter implementations live in `adapters/` and are selected via config.

**Port interfaces:**

| Port | Purpose | Alpha Adapter | Future Adapters |
|------|---------|---------------|-----------------|
| `GitProvider` | Git hosting operations (PRs, branches, webhooks) | GitHub | GitLab, Forgejo, Gitea |
| `IssueProvider` | External issue sync (optional) | GitHub Issues | GitLab Issues, Linear, Jira |
| `AIProvider` | LLM API calls | Anthropic, OpenAI | OpenRouter, Google, Ollama |
| `AuthProvider` | Authentication & authorization | Supabase Auth | NextAuth, Clerk |
| `DatabaseProvider` | Connection + config (Drizzle ORM is constant) | Supabase Postgres | Raw Postgres, Neon |
| `QueueProvider` | Job queue operations | BullMQ | pg-boss, Temporal |
| `RealtimeProvider` | Live update subscriptions | Supabase Realtime | WebSocket, SSE |
| `StageExecutor` | Subprocess execution | Node.js (execa) | Python worker, Container |
| `NotificationProvider` | Alerts & notifications | (none in alpha) | Slack, Discord, Email |
| `StorageProvider` | File/artifact storage | Local filesystem | S3, Supabase Storage |

**The rule:** If you find yourself typing a vendor name inside `core/`, you're doing it wrong.

### Project Structure

```
fluxaos/
├── src/
│   ├── core/                ← Business logic (ZERO vendor imports)
│   │   ├── ports/           ← TypeScript interfaces (contracts)
│   │   ├── pipeline/        ← State machine, stage transitions, gates
│   │   ├── routing/         ← Provider selection, fallback chains
│   │   ├── issues/          ← Issue lifecycle, activity tracking
│   │   ├── agents/          ← Persona management, team composition
│   │   ├── skills/          ← Skill registry, execution
│   │   ├── gates/           ← Rules engine, condition evaluation
│   │   └── observability/   ← Event store, cost tracking, audit
│   │
│   ├── adapters/            ← Vendor implementations (swappable)
│   │   ├── github/          ← GitProvider + IssueProvider
│   │   ├── supabase/        ← AuthProvider + DatabaseProvider + RealtimeProvider
│   │   ├── bullmq/          ← QueueProvider
│   │   ├── anthropic/       ← AIProvider
│   │   ├── openai/          ← AIProvider
│   │   └── node-exec/       ← StageExecutor (execa)
│   │
│   ├── app/                 ← Next.js App Router (pages + API routes)
│   ├── components/          ← React UI components
│   ├── cli/                 ← CLI entry point (thin wrapper over tRPC client)
│   └── config/              ← Config loading, env resolution, adapter registry
│
├── docker-compose.yml       ← Next.js + Supabase + Redis
├── drizzle/                 ← Database schema + migrations
└── tests/                   ← Vitest + Playwright
```

## Data Model

### Hierarchy

```
Organization (multi-tenant ready)
  └── Project (a repo/workspace)
       └── Pipeline (a configured workflow)
            └── Stage (a step in the pipeline)
                 └── Gate (rules for stage transitions)
```

### Core Entities

All tables include `id` (UUID), `created_at`, `updated_at` timestamps.

**Organization & Project:**

| Entity | Key Fields | Purpose |
|--------|-----------|---------|
| `Organization` | name, slug, settings | Multi-tenant boundary. Alpha has one org. |
| `Project` | org_id, name, slug, repo_url, default_pipeline_id, brand_id | A workspace that pipelines run against |

**Pipeline:**

| Entity | Key Fields | Purpose |
|--------|-----------|---------|
| `Pipeline` | project_id, name, description, is_default | A configured sequence of stages |
| `PipelineStage` | pipeline_id, name, sort_order, persona_id, harness, timeout_sec, max_retries, gate_mode, gate_rules | A step in the pipeline — fully configurable |
| `PipelineRun` | pipeline_id, issue_id, status, started_at, completed_at, total_cost_usd | A single execution triggered by an issue |
| `StageRun` | pipeline_run_id, pipeline_stage_id, status, provider, model, harness, cost_usd, tokens_in, tokens_out, started_at, completed_at | A single stage execution within a run |

**Event Store (append-only):**

| Entity | Key Fields | Purpose |
|--------|-----------|---------|
| `Event` | stage_run_id, type, payload, timestamp | Immutable event stream. Types: STAGE_STARTED, OUTPUT, TOOL_CALL, COST_UPDATE, STAGE_COMPLETED, GATE_EVALUATED, ERROR |

**Issues:**

| Entity | Key Fields | Purpose |
|--------|-----------|---------|
| `Issue` | project_id, title, description, state, priority, type, created_by, source | Work item — can be structured or auto-created from "just do it" |
| `IssueEvent` | issue_id, type, payload, timestamp | Activity log (state changes, comments, assignments) |

**Routing:**

| Entity | Key Fields | Purpose |
|--------|-----------|---------|
| `Provider` | org_id, name, type, base_url, api_key_ref, is_healthy | An AI service endpoint |
| `Model` | provider_id, name, identifier, capabilities, cost_per_1k_input, cost_per_1k_output | A model available through a provider |
| `RoutingProfile` | org_id, name, description, is_default | A named routing strategy |
| `RoutingRule` | profile_id, stage_name, allowed_models_pattern, preferred_harness, fallback_harness, sort_strategy, max_cost_usd | Per-stage routing configuration |

**Personas & Skills:**

| Entity | Key Fields | Purpose |
|--------|-----------|---------|
| `Persona` | scope (global/project), project_id, name, soul, identity, brand_id, routing_profile_id, parent_persona_id | An agent definition with personality, constraints, and routing |
| `Skill` | scope (global/project), project_id, name, description, prompt_template, input_schema, output_schema, tags, version | A reusable capability that personas can use |
| `PersonaSkill` | persona_id, skill_id, enabled, config_overrides | Junction: which skills a persona has, with per-persona config |
| `Team` | project_id, name, description | A named group of personas assigned to work together |
| `TeamMember` | team_id, persona_id, role | Junction: persona assignment to a team |

**Brand:**

| Entity | Key Fields | Purpose |
|--------|-----------|---------|
| `Brand` | org_id, project_id, name, colors, fonts, tone_of_voice, style_guide, logo_url | Visual and communication identity |

**Memory:**

| Entity | Key Fields | Purpose |
|--------|-----------|---------|
| `Memory` | scope (global/project/persona), project_id, persona_id, type, content, embedding, relevance_score | Long-term knowledge store |

**System:**

| Entity | Key Fields | Purpose |
|--------|-----------|---------|
| `ConfigEntry` | scope, key, value, previous_value, changed_by | Key-value config with audit trail |

## Pipeline Execution

### Two Entry Points, One Engine

**Structured Mode:**
```
fluxaos issue create "Add dark mode support"
fluxaos run --issue 42
```
User creates an issue with title, description, type, priority. Assigns to a pipeline. Configures stages and gates. Best for tracked work.

**Just Do It Mode:**
```
fluxaos do "Add dark mode support"
```
User types what they want in plain language (CLI or web UI chat box). System auto-creates an ephemeral issue, picks the default pipeline, and runs with gates set to auto-approve (except `block`-severity rules, which always hold regardless of mode). Best for quick tasks and vibe coding.

Both paths create an Issue + PipelineRun. From there, the engine is identical.

### Execution Flow

1. **Pipeline starts** — create PipelineRun, read stage config from DB
2. **For each stage** (in sort_order):
   a. **Route** — match persona → filter candidates (allowed_models × available providers × compatible harnesses) → sort by strategy → select
   b. **Enqueue** — dispatch job to BullMQ with stage config, persona prompt, routing selection
   c. **Execute** — StageExecutor spawns subprocess, streams output to Event store
   d. **Stream** — Supabase Realtime pushes events to browser in real-time
   e. **Complete** — stage finishes with exit code, cost, token counts
   f. **Evaluate gate** — rules engine checks conditions:
      - All rules pass → auto-proceed to next stage
      - Any required rule fails → hold for human (or rework/abort per rule action)
      - Block rule triggers → always hold regardless of other rules
3. **Pipeline completes** — aggregate costs, update issue state, emit completion event

### Stage Run Lifecycle

```
queued → running → completed | failed | cancelled | timed_out
```

### Event Types

All events are immutable, append-only, and streamed to the UI:

- `STAGE_STARTED` — stage begins with routing selection
- `OUTPUT` — line of stdout/stderr from subprocess
- `TOOL_CALL` — structured tool invocation by the AI
- `COST_UPDATE` — incremental cost tracking
- `GATE_EVALUATED` — gate rules checked with pass/fail per rule
- `STAGE_COMPLETED` — stage ends with exit code and summary
- `ERROR` — error during execution

## Routing Engine

### Three Dimensions

Every stage run is routed across three dimensions:

1. **Provider** — who hosts the model (Anthropic, OpenAI, OpenRouter, Ollama, any OpenAI-compatible endpoint)
2. **Model** — which LLM (claude-opus-4-6, gpt-4.1, etc.). Supports wildcard patterns: `anthropic/*`, `openai/gpt-4*`
3. **Harness** — what executes the work (claude-code, aider, codex, gemini-cli, custom script)

### Routing Resolution

1. Stage triggers → find persona bound to this stage
2. Load persona's routing rules (from routing profile)
3. Filter candidates: allowed_models pattern × available providers × compatible harnesses
4. Sort by strategy: `quality` (best model first), `speed` (fastest first), `cost` (cheapest first), `balanced` (weighted score)
5. Select top candidate
6. On failure → next candidate in chain → harness fallback

### Per-Persona Routing

Each persona has routing rules that control:
- `allowed_models` — wildcard patterns (e.g., `anthropic/*`, `openai/gpt-4o`)
- `preferred_harness` — first choice execution tool
- `fallback_harness` — backup if preferred unavailable
- `sort_strategy` — quality, speed, cost, or balanced
- `max_cost_usd` — cost ceiling per stage run

## Gates & Rules Engine

### Gate Modes

| Mode | Behavior |
|------|----------|
| `auto` | Always proceed. No human in the loop. |
| `rules` | Evaluate conditions. Auto-approve if all pass, hold if any fail. |
| `hold` | Always wait for human approval. |

### Rule Structure

Each gate has a list of rules. Each rule has:
- **Field** — what to check (e.g., `stage.exit_code`, `stage.cost_usd`, `issue.priority`)
- **Operator** — how to compare (`equals`, `less_than`, `contains`, `matches`, `in`, `exists`)
- **Value** — what to compare against
- **Severity** — `required` (must pass), `warn` (flags but doesn't block), `block` (always holds)
- **Action on failure** — `hold` (wait for human), `rework` (send back with feedback), `abort` (kill the run), `notify` (alert but continue), `escalate` (route to different persona)

Rules are AND by default. OR groups and nesting supported for complex logic. Named rule sets can be shared across pipelines.

### Gate Safety

Gate config changes are tracked via `ConfigEntry` audit trail (`previous_value`, `changed_by`, `created_at`). Every `GATE_EVALUATED` event records which rules fired, their inputs, and pass/fail results. This means:
- You can always see who weakened a gate and when
- You can replay any gate decision with the exact inputs it had
- Future: org-level gate policy constraints (e.g., "no pipeline may auto-approve deploy stages") to prevent misconfiguration

### Available Rule Fields

**Stage context:** exit_code, cost_usd, duration_sec, tokens_used, files_changed, lines_added, lines_removed, tests_passed, tests_failed, output, error_count

**Issue context:** priority, type, labels, project, created_by

**Pipeline context:** run_count, rework_count, total_cost_usd, total_duration_sec, provider, model, harness

## Persona & Knowledge System

### Everything From DB

No CLAUDE.md, no AGENTS.md, no template syncing, no skills directories. The DB is the single source of truth. The UI edits it. The pipeline reads it.

### Anatomy of a Persona

Each persona has six facets, all stored in the DB:

1. **Soul** — core truths, personality, boundaries, communication vibe, decision-making principles ("who you are")
2. **Identity** — name, avatar, emoji, role description, specialization tags, version history ("how you present")
3. **Skills** — attached skill definitions, enabled/disabled per persona, execution permissions ("what you can do")
4. **Memory** — long-term knowledge store, session learnings, cross-project connections ("what you know")
5. **Brand** — color palette, fonts, tone of voice, logo, content style rules ("how the human's brand looks & sounds")
6. **Routing Rules** — allowed models, preferred harness, fallback chain, cost limits, sort strategy ("how you execute")

### Inheritance Model

```
Global Scope → Project Scope → Override
```

- **Global personas/skills** are available to all projects
- **Projects inherit** everything from global scope, plus add their own
- **Override options:**
  - **Fork** — creates a project copy, breaks inheritance from global. The persona is now independent.
  - **Hide** — removes a global persona/skill from this project without deleting the global version.
  - **Extend** — adds project-specific config to a global persona without breaking the link. Global changes still flow through.

### Skills

A skill is a DB-stored capability with:
- Name, description, tags
- Prompt template (the instructions)
- Input/output schemas (typed)
- Scope (global or project)
- Version (for rollback)

Skills are not limited to coding. Categories include: development, research, social media, competitive intel, content creation, DevOps, and anything else a user defines.

### Memory & Dreaming

| Layer | Storage | Lifecycle |
|-------|---------|-----------|
| Short-term | In-memory (session) | Ephemeral — lives during execution |
| Long-term | Database | Persistent — learnings, decisions, patterns |
| Dreaming | Async background job | Scheduled — consolidation, pattern discovery, pruning |

Memory scopes: Global (cross-project) → Project (project-specific) → Persona (agent-specific).

### Brand Identity

A Brand record stores:
- Color palette and fonts
- Tone of voice guide
- Logo and visual identity
- Content style rules

Personas reference a Brand. When generating content, the persona knows the brand's visual identity and communication style. A coding persona might not need this. A social media persona absolutely does.

## CLI Architecture

The CLI and web UI share the exact same tRPC client. The CLI is a thin terminal renderer — not a separate implementation.

```
fluxaos do "Add dark mode"          → pipeline.start({ prompt })
fluxaos run --issue 42              → pipeline.start({ issueId })
fluxaos issue list                  → issues.list()
fluxaos issue create "Fix bug"      → issues.create({ title })
fluxaos config set routing.default  → config.update({ key, value })
fluxaos status                      → pipeline.status()
```

One API. Two interfaces. Zero duplication.

## Observability & KPIs

### Usage KPIs (table stakes)

- Tokens (in/out) by provider, model, persona, project
- Cost by provider, stage, project, time period
- Throughput (tokens/min, runs/day)
- Error rate by provider/model/harness
- Activity heatmaps (day/hour)

### Pipeline Intelligence KPIs (fluxaOS differentiator)

- Pipeline success rate (completed vs failed)
- Rework rate (how often review rejects)
- Time-to-close (idea → completed)
- Cost-per-issue-closed (ROI metric)
- Gate wait time (human bottleneck detection)
- Runs-to-close (efficiency per issue)
- Persona effectiveness (which agent config produces best outcomes)
- Provider reliability (uptime, latency, error rate)
- Harness comparison (same task, different execution tool)

The event-sourced data model captures all of this automatically. KPIs are aggregation queries over the event store.

## Deployment

### Docker Compose (self-hosted)

Three containers:
1. **fluxaos** — Next.js app (web UI + API + worker)
2. **supabase** — Postgres + Auth + Realtime (self-hosted Supabase)
3. **redis** — BullMQ job queue

```yaml
# Simplified docker-compose.yml
services:
  fluxaos:
    build: .
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: postgres://...
      REDIS_URL: redis://redis:6379
      SUPABASE_URL: http://supabase:8000
    depends_on: [supabase, redis]

  supabase:
    image: supabase/postgres
    ports: ["5432:5432"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
```

### Environment Configuration

All adapter selection via environment variables:
```
FLUXAOS_GIT_PROVIDER=github
FLUXAOS_AUTH_PROVIDER=supabase
FLUXAOS_AI_PROVIDERS=anthropic,openai
FLUXAOS_QUEUE_PROVIDER=bullmq
FLUXAOS_STAGE_EXECUTOR=node-exec
```

## Alpha MVP Scope

What ships in 1-3 months:

### Must Have
- [ ] Next.js app with tRPC API
- [ ] Supabase auth (login/logout)
- [ ] Drizzle schema with all core entities
- [ ] Pipeline engine (state machine, stage execution, gate evaluation)
- [ ] Stage executor (Node.js/execa with StageExecutor interface)
- [ ] Basic routing (manual provider/model/harness selection per persona)
- [ ] Fallback chains (ordered list, auto-fallback on failure)
- [ ] Wildcard model patterns
- [ ] Persona CRUD (soul, identity, skills, routing)
- [ ] Global + project scope with inheritance
- [ ] Skills stored in DB, editable in UI
- [ ] Issue CRUD (structured + "just do it" mode)
- [ ] Event-sourced stage runs with output streaming
- [ ] Live transcript view (Supabase Realtime)
- [ ] Basic dashboard (runs, costs, tokens, success rate)
- [ ] Gate rules engine (exit_code, cost, files_changed conditions)
- [ ] CLI (thin wrapper over tRPC)
- [ ] Docker Compose deployment
- [ ] GitHub adapter (git provider)
- [ ] Anthropic + OpenAI adapters (AI provider)
- [ ] README + install guide

### Nice to Have (if time permits)
- [ ] Bull Board dashboard (job queue visibility)
- [ ] Cost tracking dashboard with filters
- [ ] Pipeline templates ("Standard Dev", "Quick Fix")
- [ ] Gate presets (strict, relaxed, auto)
- [ ] Brand identity fields on org/project
- [ ] Basic long-term memory (per project)
- [ ] CSV/JSON export for KPIs

### Explicitly NOT in Alpha
- Dreaming / memory consolidation
- Skill marketplace / registry
- Smart routing (BridgeBench integration)
- Non-code pipeline templates (content, social, intel)
- Multi-org support (one org in alpha)
- Provider health monitoring
- Webhook-based external gate approval
- Mobile-responsive UI
- Cost forecasting / budget alerts

## Competitive Positioning

| Product | What It Is | fluxaOS Difference |
|---------|-----------|-------------------|
| OpenHands | Single-agent interactive coding assistant | fluxaOS is multi-stage, multi-agent, multi-project with observability |
| OpenClaw | Agent runtime with memory/dreaming | fluxaOS adds pipeline orchestration, gates, routing engine, KPIs |
| Cursor/Copilot | In-editor AI assistance | fluxaOS orchestrates full workflows, not just code completion |
| Devin/Factory | Autonomous coding agents | fluxaOS is provider-agnostic, self-hosted, config-driven |

**fluxaOS is the operating system for AI workflows.** Users configure everything. The engine puts the pieces together.

## Open Questions

1. **Supabase self-hosted complexity** — Supabase's self-hosted setup is non-trivial (multiple containers). For alpha, consider starting with raw Postgres + a simple JWT auth adapter, then adding Supabase Realtime as a separate concern. The adapter architecture supports this pivot.

2. **Worker separation** — Should the BullMQ worker run in the same Next.js process or as a separate container? Same process is simpler for alpha. Separate container scales better.

3. **Python escape hatch timing** — When do we decide Node.js subprocess management isn't good enough? Proposal: build the executor in TypeScript first. If we spend more than 2 days fighting streaming/signals, swap to Python worker behind the same interface.

4. **Repo name and GitHub org** — fluxaos? fluxaos-engine? Need to decide before creating the repo.

5. **License** — AGPLv3 (strong copyleft, prevents SaaS competitors) vs BSL (source-available with time-delayed open source) vs MIT (maximum adoption, minimum protection).
