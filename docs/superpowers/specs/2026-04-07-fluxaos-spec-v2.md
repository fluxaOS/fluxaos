# fluxaOS — Design Specification v2

**Date:** 2026-04-07
**Status:** Approved
**Author:** Joe Pierce + Claude
**Supersedes:** [v1](2026-04-07-fluxaos-spec.md)

## Changes from v1

- Pre-flight questions resolved (org, license, Supabase, worker architecture)
- Ecosystem strategy locked: 100% GitHub, no fhc dependency, clean break
- Added skill materialization pattern (DB → disk for harness execution)
- Updated open questions section (resolved items removed)
- Platform-agnostic adapter requirement strengthened throughout

## Alpha Scope Reconciliation (2026-04-22)

This section supersedes the Alpha MVP Scope checklist below where they conflict. The original alpha scope was written against the old R-REM-W3 "four-slice" framing. Tonight's session (2026-04-22) reshaped alpha around ten concrete items that collectively close the "file an issue → get a PR" loop for a single user against a single project and a single repo.

**Alpha scope constraint: one user, one project, one repo.** The schema supports multi-tenancy but alpha does not build the UI or flows for multi-anything. Post-alpha layers multi on top.

**Architectural borrowing:** fluxaOS borrows workspace isolation, worktree lifecycle, cleanup service, forge-adapter structure, headless runtime discipline, and stage-to-stage artifact handoff patterns from [Archon](https://github.com/coleam00/Archon) (MIT). See [`research/2026-04-22-archon-prior-art.md`](../research/2026-04-22-archon-prior-art.md) for the pattern catalog and file pointers.

**Ports retired:** `IssueProvider` is retired entirely (same precedent as `AIProvider` deletion in R-REM-W3-a PR #50). fluxaOS's issue model is native and not synced to external trackers. The port file and its exports will be removed as part of R-RUNTIME cleanup.

**Authoritative alpha phases:** see the [roadmap](../roadmap.md) "Phases — Alpha" section for the current phase list. The roadmap is the source of truth for what's next.

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

### Ecosystem Strategy

- **100% GitHub from day one.** Source code, issues, PRs, CI — all on GitHub under the `fluxaOS` org.
- **No fhc dependency.** No Forgejo. No template syncing from fh-commons. Clean break.
- **fhc stays around as long as needed.** Existing projects stay on fhc/Forgejo. No formal sunset until flux is proven and can absorb them.
- **Self-managing from Phase 2.** fluxaOS builds its own project management first, then uses it to manage the rest of its own development.
- **Platform-agnostic always.** GitHub is primary NOW, but every platform interaction is behind an adapter. Switching to GitLab, Gitea, or anything else is a config change.

**Why platform-agnostic matters:** The AI landscape changes daily. As a solo developer, the ability to shift gears fast is a competitive advantage. Coupling to any single platform eliminates that advantage.

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

**GTM:** Open-source alpha on GitHub within 3-4 months.

## System Architecture

### Four-Layer Stack

```
┌─────────────────────────────────────────────────┐
│  Browser — React + Next.js App Router           │
│  Dashboard, Issues, Pipeline Runs, Settings,    │
│  Live Transcript, Cost Tracking, Routing Config │
└──────────────────┬──────────────────────────────┘
                   │ RealtimeProvider + tRPC
┌──────────────────┴──────────────────────────────┐
│  Next.js Server — API + SSR + Worker            │
│  tRPC Router, Auth Middleware, Job Dispatcher,   │
│  Pipeline State Machine, Routing Engine,         │
│  BullMQ Worker (same process for alpha)          │
└──────┬───────────────────┬──────────────────────┘
       │                   │
  ┌────┴────┐    ┌─────────┴─────────┐
  │ Postgres │    │ Supabase Cloud    │  Redis
  │ (data)   │    │ (Auth + Realtime) │
  └──────────┘    └───────────────────┘
```

### Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React 19 + Next.js 15 (App Router) | SSR + API routes in one deploy target |
| Styling | Tailwind CSS 4 | Utility-first, no CSS files to manage |
| API | tRPC | End-to-end type safety, zero codegen |
| Auth | Supabase Auth (adapter) | JWT-based, OAuth providers; cloud for alpha, self-hosted later |
| Database | Raw Postgres + Drizzle ORM | Lightweight, SQL-first, type-safe ORM; no Supabase Postgres dependency |
| Realtime | Supabase Realtime (adapter) | Live transcript streaming; cloud for alpha, replaceable via RealtimeProvider |
| Job Queue | BullMQ (Redis) | Retries, concurrency control, Bull Board dashboard |
| Subprocess | execa (Node.js) | Process spawning with timeout/cancel/streaming |
| Testing | Vitest + Playwright | Unit + E2E |
| Deployment | Docker Compose | Next.js + Postgres + Redis = 3 containers (Supabase cloud for auth/realtime) |

### Supabase Strategy

**Alpha:** Supabase Cloud for auth and realtime. Raw Postgres (self-hosted) for the database. This avoids the 12-15 container complexity of Supabase self-hosted while still getting auth + realtime out of the box.

**Later:** Migrate to Supabase self-hosted or swap auth/realtime providers entirely — the adapter layer makes either possible.

**Containment rule (NON-NEGOTIABLE):** No Supabase client imports outside of `adapters/supabase/`. All database queries go through Drizzle ORM against raw Postgres. Auth and realtime go through their respective port interfaces. This is not optional — the lesson from PAT/Forgejo coupling is that "we'll extract the interface later" never happens. The boundary exists from day one, even if the first implementation is simple.

**DA pushback addressed:** The DA review recommended skipping adapters for alpha and extracting them later. We reject this. Revising an adapter interface is cheap. Extracting one from a codebase that never had boundaries is the exact problem that motivated this rewrite. The adapters may need revision — that's fine. Their existence is non-negotiable.

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
│   │   ├── skills/          ← Skill registry, materialization
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

## Skill Materialization (DB → Disk)

Skills are stored in the database as the single source of truth — CRUD via web UI, API, and CLI. But AI harnesses (Claude Code, aider, etc.) read skills from the filesystem. They don't query Postgres.

### The Pattern

1. **Source of truth:** Postgres `Skill` table (CRUD via tRPC)
2. **At execution time:** flux materializes skills to a workspace directory before spawning the harness
3. **Harness reads files** as it always has — it doesn't know or care where they came from
4. **After execution:** workspace files are ephemeral — the DB remains the authority

This is analogous to how Docker builds an image from a registry. The runtime doesn't talk to the registry — it uses a local materialized copy.

### What Gets Materialized

- Persona prompt → `CLAUDE.md` or equivalent harness config file
- Attached skills → skill files in the workspace
- Project context → relevant config and instructions

### Materialization Scope

Only the skills and config relevant to the current stage run get written. Each execution gets a clean workspace — no stale state from previous runs.

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
   b. **Materialize** — write persona prompt, skills, and context to workspace directory
   c. **Enqueue** — dispatch job to BullMQ with stage config, workspace path, routing selection
   d. **Execute** — StageExecutor spawns subprocess, streams output to Event store
   e. **Stream** — Supabase Realtime pushes events to browser in real-time
   f. **Complete** — stage finishes with exit code, cost, token counts
   g. **Evaluate gate** — rules engine checks conditions:
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

No CLAUDE.md, no AGENTS.md, no template syncing, no skills directories as source of truth. The DB is the single source of truth. The UI edits it. The pipeline reads it. Skills are materialized to disk at execution time (see [Skill Materialization](#skill-materialization-db--disk)).

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

### Alpha Deployment (Supabase Cloud + Docker Compose)

Three containers locally + Supabase Cloud:
1. **fluxaos** — Next.js app (web UI + API + worker, same process)
2. **postgres** — Raw Postgres (data only, no Supabase services)
3. **redis** — BullMQ job queue
4. **Supabase Cloud** — Auth + Realtime (external service, behind adapters)

```yaml
# docker-compose.yml (alpha)
services:
  fluxaos:
    build: .
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/fluxaos
      REDIS_URL: redis://redis:6379
      SUPABASE_URL: ${SUPABASE_URL}        # Supabase Cloud project URL
      SUPABASE_ANON_KEY: ${SUPABASE_ANON_KEY}
      SUPABASE_SERVICE_KEY: ${SUPABASE_SERVICE_KEY}
    depends_on: [postgres, redis]

  postgres:
    image: postgres:16-alpine
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: fluxaos
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

volumes:
  pgdata:
```

### Future: Fully Self-Hosted Deployment

When ready to self-host everything (post-alpha), swap Supabase Cloud for self-hosted Supabase (or alternative auth/realtime providers). The adapter layer makes this a config change — swap `FLUXAOS_AUTH_PROVIDER` and `FLUXAOS_REALTIME_PROVIDER` and provide the new adapter implementations.

### Environment Configuration

All adapter selection via environment variables:
```
FLUXAOS_GIT_PROVIDER=github
FLUXAOS_AUTH_PROVIDER=supabase
FLUXAOS_REALTIME_PROVIDER=supabase
FLUXAOS_AI_PROVIDERS=anthropic,openai
FLUXAOS_QUEUE_PROVIDER=bullmq
FLUXAOS_STAGE_EXECUTOR=node-exec
```

## Alpha MVP Scope

> **Superseded by the 2026-04-22 scope reconciliation above.** This section is preserved for historical context. The authoritative alpha phase list is the [roadmap](../roadmap.md) "Phases — Alpha" section.

Original framing (April 2026): "what ships in 1-3 months." Below retained as the original intent record. Items inconsistent with the reconciled scope are marked with a strikethrough explanation.

### Originally Must Have
- [x] Next.js app with tRPC API — **Done (R1)**
- [x] Supabase auth (login/logout) behind AuthProvider interface — **Done**
- [x] Drizzle schema with all core entities — **Done (R3)**
- [ ] ~~Issue CRUD with GitHub sync (IssueProvider adapter)~~ — **Scope changed:** Issue CRUD done (R3); GitHub sync cut, `IssueProvider` retired, fluxaOS issues are native-only
- [x] Skill CRUD with DB storage and disk materialization — **Done (R5-V, R5.5)**
- [ ] ~~Minimal CLI (`fluxaos issue list/create`, `fluxaos sync`)~~ — **Post-alpha;** web UI covers all alpha workflows
- [x] Pipeline engine (state machine, stage execution, gate evaluation) — **Done (R4-V, R5-V)**
- [x] Stage executor (Node.js/execa with StageExecutor interface) — **Done**
- [x] Basic routing (manual provider/model/harness selection per persona) — **Done**
- [x] Fallback chains (ordered list, auto-fallback on failure) — **Done**
- [x] Wildcard model patterns — **Done**
- [x] Persona CRUD (soul, identity, skills, routing) — **Done (R-UI-1)**
- [ ] ~~Global + project scope with inheritance~~ — **Simplified for alpha:** single project, no multi-scope inheritance UI
- [x] Event-sourced stage runs with output streaming — **Done**
- [x] Live transcript view (Supabase Realtime) — **Done (R-UI-2.5)**
- [ ] Basic dashboard (runs, costs, tokens, success rate) — **In scope as R-MISSION-CONTROL**
- [x] Gate rules engine (exit_code, cost, files_changed conditions) — **Done (R4-V)**
- [ ] ~~"Just Do It" mode~~ — **Deferred post-alpha** per R-AUDIT triage
- [ ] Docker Compose deployment — **In scope as part of R-POLISH**
- [ ] GitHub adapter (git provider) — **In scope as part of R-RUNTIME;** minimum 2 methods (`createBranch`, `createPullRequest`)
- [ ] ~~Anthropic + OpenAI adapters (AI provider)~~ — **Anthropic only for alpha;** OpenAI post-alpha. Adapter shape is subprocess-based (R-REM-W3-a), not direct-SDK; `AIProvider` port retired
- [ ] README + install guide — **In scope as part of R-POLISH**

### Alpha-required items not captured in the original list

Added by the 2026-04-22 reconciliation (the "ten-item alpha list"):

- [ ] **Workspace isolation** — worktree-per-run, isolation-environments DB table, gitignored-file copy, cleanup service. **In scope as R-RUNTIME.**
- [ ] **Deploy bridge** — orchestrator commits uncommitted worktree state, pushes branch, opens PR via the forge adapter, records PR reference on the issue. **In scope as R-RUNTIME.**
- [ ] **Stage-to-stage artifacts directory** — `$ARTIFACTS_DIR` pattern from Archon for findings/plans/verdicts flowing between stages. **In scope as R-ARTIFACTS.**
- [ ] **Epic / child-issue hierarchy** — `parent_issue_id` schema + orchestrator's work queue filters out epics + auto-close-parent when last child closes. **In scope as R-EPIC.**
- [ ] **Systemd orchestrator daemon** — the manual orchestrator wrapped as a long-running process consuming from the BullMQ queue. **In scope as R-DAEMON.**
- [ ] **Minimum Settings tabs** — Projects + Pipelines, using the R-UI-1 CRUD factory. Four other tabs (Teams, Users, System, Cron Jobs) deferred post-alpha. **In scope as R-SETTINGS-ALPHA.**
- [ ] **End-to-end smoke test** — Playwright journey proving the full file-epic → worker runs → PR opened → issue advanced loop. **In scope as R-SMOKE.**

### Nice to Have (if time permits)
- [ ] Bull Board dashboard (job queue visibility)
- [ ] Cost tracking dashboard with filters
- [ ] Pipeline templates ("Standard Dev", "Quick Fix") — partially seeded already
- [ ] Gate presets (strict, relaxed, auto)
- [ ] Brand identity fields on org/project
- [ ] Basic long-term memory (per project)
- [ ] CSV/JSON export for KPIs

### Explicitly NOT in Alpha
- Multi-user / multi-project / multi-repo UI flows (schema supports this; UI flows deferred)
- CLI (`src/cli/`)
- Dreaming / memory consolidation
- Skill marketplace / registry
- Smart routing (BridgeBench integration)
- Non-code pipeline templates (content, social, intel)
- Provider health monitoring
- Webhook-based external gate approval
- Mobile-responsive UI
- Cost forecasting / budget alerts
- GitLab / Gitea / Forgejo forge adapters (same port pattern as alpha GitHub; community-contributable post-alpha)
- OpenAI adapter
- `IssueProvider` port (retired)
- `AIProvider`-as-direct-SDK (retired in R-REM-W3-a)
- Dogfooding (fluxaOS managing its own dev through its own pipelines) — philosophically attractive but carries bootstrap-fragility risk; revisit post-alpha
- Brand service
- OpenClaw preview gate, role-based permissions, version history for skills/drivers, subscription tier model (DEF-001 through DEF-004)

## Competitive Positioning

| Product | What It Is | fluxaOS Difference |
|---------|-----------|-------------------|
| OpenHands | Single-agent interactive coding assistant | fluxaOS is multi-stage, multi-agent, multi-project with observability |
| OpenClaw | Agent runtime with memory/dreaming | fluxaOS adds pipeline orchestration, gates, routing engine, KPIs |
| Cursor/Copilot | In-editor AI assistance | fluxaOS orchestrates full workflows, not just code completion |
| Devin/Factory | Autonomous coding agents | fluxaOS is provider-agnostic, self-hosted, config-driven |

**fluxaOS is the operating system for AI workflows.** Users configure everything. The engine puts the pieces together.

## Open Questions

1. **Python escape hatch timing** — When do we decide Node.js subprocess management isn't good enough? Proposal: build the executor in TypeScript first. If we spend more than 2 days fighting streaming/signals, swap to Python worker behind the same interface.
