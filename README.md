# fluxaOS
2026.04.08

AI orchestration operating system — configurable pipelines, provider-agnostic routing, gate-controlled quality, and full observability. No vendor lock-in.

## What is fluxaOS?

fluxaOS is a ground-up TypeScript application that orchestrates AI workflows end-to-end. You define pipelines of stages, assign personas with skills, configure routing rules for AI providers, and set gate conditions for quality control. The engine executes your configuration — routing work to the right provider/model, streaming output in real time, evaluating gates, and tracking costs.

**Core concepts:**
- **Pipelines** — ordered sequences of stages (research, implement, review, deploy)
- **Personas** — AI characters with souls, skills, and routing profiles
- **Routing** — rules that match stages to providers/models based on patterns
- **Gates** — conditions evaluated after each stage (auto, manual, rules-based)
- **Skills** — prompt templates stored in DB, materialized to disk at execution time

## Quick Start

```bash
# 1. Clone
git clone https://github.com/fluxaOS/fluxaos.git
cd fluxaos

# 2. Configure
cp .env.example .env
# Edit .env — set your Supabase, GitHub, and AI provider keys

# 3. Start
docker compose up -d

# 4. Set up database
npm run db:migrate
npm run db:seed

# 5. Open
open http://localhost:3000
```

The seed script creates a default organization, project, pipeline (Standard Dev with 4 stages), and 4 personas (Researcher, Implementer, Reviewer, Deployer).

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Web UI (Next.js)                   │
│  Dashboard · Issues · Pipelines · KPIs · Settings    │
└──────────────────────┬───────────────────────────────┘
                       │ tRPC (end-to-end type-safe)
┌──────────────────────┴───────────────────────────────┐
│                   Core Engine                         │
│  Pipeline State Machine · Gate Rules Engine           │
│  Routing Resolver · Prompt Assembler · Cost Parser    │
│  Issues · Skills · Personas · Brands                  │
└──────────────────────┬───────────────────────────────┘
                       │ Ports & Adapters
┌──────────┬───────────┼───────────┬───────────────────┐
│ Anthropic│  OpenAI   │  GitHub   │  BullMQ  │Supabase│
│ AI       │  AI       │  Git+Issue│  Queue   │  Auth  │
└──────────┴───────────┴───────────┴──────────┴────────┘
```

**Ports & Adapters:** Every external integration lives behind a TypeScript interface in `src/core/ports/`. Swap GitHub for GitLab, Anthropic for Ollama, Supabase for raw Postgres — change an env var, register a new adapter.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Next.js 16 (App Router) |
| Styling | Tailwind CSS 4 |
| API | tRPC v11 |
| Auth | Supabase Auth (adapter) |
| Database | PostgreSQL 16 + Drizzle ORM |
| Queue | BullMQ (Redis) |
| AI Providers | Anthropic SDK, OpenAI SDK |
| Subprocess | execa |
| Testing | Vitest |
| Linting | Biome |

## Project Structure

```
src/
├── app/              # Next.js App Router pages
│   └── dashboard/    # Dashboard, issues, pipelines, KPIs, settings
├── components/       # Shared React components
├── core/             # Business logic (zero vendor imports)
│   ├── pipeline/     # State machine, prompt assembly, cost parsing
│   ├── gates/        # Rules engine
│   ├── routing/      # Provider/model resolver
│   ├── issues/       # Issue lifecycle
│   ├── skills/       # Skill registry + materializer
│   ├── personas/     # Persona CRUD + inheritance
│   ├── providers/    # Provider/model registry
│   ├── brands/       # Brand identity
│   ├── observability/# Event store
│   ├── db/           # Drizzle schema + seed
│   └── ports/        # 10 adapter interfaces
├── adapters/         # Adapter implementations
│   ├── anthropic/    # AIProvider (Anthropic SDK)
│   ├── openai/       # AIProvider (OpenAI SDK)
│   ├── github/       # IssueProvider + GitProvider
│   ├── bullmq/       # QueueProvider + Worker
│   ├── node-exec/    # StageExecutor (execa)
│   └── supabase/     # AuthProvider
├── server/           # tRPC routers
├── config/           # Adapter registry
├── cli/              # CLI commands
└── lib/              # tRPC client setup
```

## Configuration

All adapter selection is env-var driven. See `.env.example` for the full list.

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `REDIS_URL` | — | Redis connection string |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `GITHUB_TOKEN` | — | GitHub personal access token |
| `FLUXAOS_AI_PROVIDERS` | `anthropic` | Active AI provider |
| `FLUXAOS_GIT_PROVIDER` | `github` | Git provider |
| `FLUXAOS_QUEUE_PROVIDER` | `bullmq` | Job queue |

## Development

```bash
# Prerequisites: Node.js 22+, PostgreSQL 16+, Redis 7+

# Install dependencies
npm install

# Run locally (requires running postgres + redis)
npm run dev

# Type check
npx tsc --noEmit

# Lint
npx biome check src/

# Test
npx vitest run

# Database
npm run db:migrate    # Apply migrations
npm run db:seed       # Seed default data
```

## License

AGPLv3 — see [LICENSE](LICENSE).
