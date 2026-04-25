# fluxaOS

AI orchestration OS — a config-driven engine that runs pipelines of AI-powered stages against issues. File an issue, the daemon picks it up, the worker runs in an isolated git worktree, and a PR opens on your repo.

> **Status:** Alpha. Single operator, single project, single git provider (GitHub). Anthropic-only.

## What is fluxaOS?

fluxaOS reads its configuration from the database and executes whatever the operator configured — pipeline stages, skills, drivers, gates, routing rules. The engine is agnostic: it doesn't know stage names, provider names, or driver names. It runs whatever's in the seed.

The alpha pipeline is three stages: `research` → `implement` → `review`. Each stage runs Claude in an isolated worktree, hands off intermediate findings via per-run artifact directories, and gates the proceed/rework verdict on rules or skill signals. When `review` proceeds, the deploy bridge commits the worktree, pushes the branch, and opens a PR via the GitHub adapter.

The daemon owns execution end-to-end. tRPC triggers are publish-only — they write a `pipeline_run` row at status `pending` and wait for the daemon's Realtime subscription to pick it up.

## Quick Start

Prerequisites: Node.js 22+, a Supabase project (Postgres + Auth + Realtime), an Anthropic API key, a GitHub PAT, and a local clone of the repo you want fluxaOS to deploy against.

```bash
# 1. Clone
git clone https://github.com/fluxaOS/fluxaos.git
cd fluxaos

# 2. Install
npm install

# 3. Configure
cp .env.example .env
# Edit .env — set DATABASE_URL, DIRECT_URL, NEXT_PUBLIC_SUPABASE_URL,
# NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY.
#
# Then create .env.local with the operational keys. Required:
#   ANTHROPIC_API_KEY=sk-ant-...
#   FLUXAOS_GITHUB_TOKEN=ghp_...                  # repo scope
#   FLUXAOS_TARGET_REPO_PATH=/abs/path/to/clone   # local checkout on main, clean
#   FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS=60
#   FLUXAOS_CLEANUP_SWEEP_INTERVAL_MIN=15
#   FLUXAOS_CLEANUP_STALE_DAYS=7
#   FLUXAOS_CLEANUP_SESSION_RETENTION_DAYS=14
#   FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS=14

# 4. Set up the database
npm run db:migrate
npm run db:seed
npm run verify:seed       # 10/10 PASS expected

# 5. Start the dev server (terminal 1)
npm run dev

# 6. Start the daemon (terminal 2)
npm run daemon
# Or use the systemd user-unit at ops/systemd/fluxaos-daemon.service
# and `systemctl --user enable --now fluxaos-daemon`.

# 7. Open the UI
open http://localhost:3000
# File an issue, advance state to `Implement`, click Run Stage.
# Watch the daemon log + the mission-control page (/mission-control)
# until the run reaches `completed` and a PR appears on your target repo.
```

For an end-to-end smoke test, see `e2e/r-smoke.spec.ts` — the alpha-acceptance journey that drives the full flow against a disposable sandbox repo.

## Architecture

```
┌────────────────────────────────────────────────┐
│              Web UI (Next.js)                  │
│   Dashboard · Issues · Pipelines · Mission     │
│   Control · Settings (Pipelines / Projects)    │
└──────────────────┬─────────────────────────────┘
                   │ tRPC (publish-only triggers)
┌──────────────────┴─────────────────────────────┐
│                 Core Engine                     │
│   Pipeline state machine · Gate engine          │
│   Stage runner · Skills materializer            │
│   Issue lifecycle · Artifacts handoff           │
└─────────┬─────────────────────────────┬─────────┘
          │                             │
   ┌──────┴──────┐               ┌──────┴──────┐
   │   Daemon    │  Realtime     │  Supabase   │
   │ (tsx +      │  pipeline_run │  Postgres + │
   │  systemd)   │  subscription │  Auth + RT  │
   └──────┬──────┘               └─────────────┘
          │
   ┌──────┴──────┐    ┌──────────┐    ┌──────────┐
   │  GitHub     │    │ Worktree │    │ Anthropic│
   │  adapter    │    │ isolation│    │  AI      │
   └─────────────┘    └──────────┘    └──────────┘
```

**Ports & Adapters:** Every external integration lives behind a TypeScript interface in `src/core/ports/`. Adapters in `src/adapters/` implement them. The agnostic engine never imports a vendor SDK directly.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Next.js 16 (App Router) |
| Styling | Tailwind CSS 4 |
| API | tRPC v11 |
| Auth | Supabase Auth |
| Database | PostgreSQL (Supabase Cloud) + Drizzle ORM |
| Realtime | Supabase Realtime |
| AI Provider | Anthropic SDK (`@anthropic-ai/sdk`) |
| Subprocess | `node:child_process` |
| Daemon | tsx + systemd user-unit |
| Integration tests | Vitest (real Supabase, no mocks) |
| Journey tests | Playwright |
| Linting | ESLint + Biome (formatter) |

## Project Structure

```
src/
├── adapters/           # Vendor implementations of the ports
│   ├── github/         # GitProvider (Octokit-based)
│   ├── git/            # Worktree + cleanup helpers
│   ├── fs/             # Artifacts filesystem helpers
│   ├── subprocess/     # StageExecutor (node:child_process)
│   ├── bullmq/         # QueueProvider (in-tree, alpha-unused)
│   └── supabase/       # Database + Auth + Realtime
├── app/                # Next.js App Router pages
│   └── [org]/[user]/[project]/  # Project-scoped routes
├── components/         # React components
├── config/             # Bootstrap + adapter registry
├── core/               # Domain logic (zero vendor imports)
│   ├── cleanup/        # Worktree + artifacts cleanup
│   ├── db/             # Drizzle schema + connection
│   ├── deploy/         # Deploy bridge (commit → push → PR)
│   ├── gates/          # Gate rules engine
│   ├── orchestrator/   # Pipeline-run service, event-orchestrator,
│   │                   #   stage-runner, terminal hook
│   ├── ports/          # 8 adapter interfaces
│   ├── services/       # Issue, project, skill, persona, etc.
│   └── skills/         # Skill registry + materializer
├── lib/                # tRPC client, Supabase client, context
├── scripts/            # CLI scripts (db, daemon, demos)
├── server/             # tRPC routers
└── __tests__/          # Vitest integration tests
e2e/                    # Playwright journey tests
ops/                    # systemd user-unit + ops runbook
docs/                   # Specs, plans, handoffs, RCAs
tests/verify/           # Verification scripts (seed-check, run-all)
drizzle/                # Migrations + meta snapshots
```

## Configuration

All operational config lives in `.env.local` (gitignored). See `.env.example` for the Supabase + base set; the operational vars below are documented in `CLAUDE.md` (R-RUNTIME env vars block).

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | yes | Postgres pooler URL (port 6543) |
| `DIRECT_URL` | yes | Postgres direct URL (port 5432, migrations) |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role (server-only) |
| `ANTHROPIC_API_KEY` | yes | Anthropic SDK key |
| `FLUXAOS_GITHUB_TOKEN` | yes | PAT with `repo` scope |
| `FLUXAOS_TARGET_REPO_PATH` | yes | Absolute path to a clean local checkout of the target repo on `main` |
| `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS` | yes | Positive int, drain window after SIGTERM |
| `FLUXAOS_CLEANUP_SWEEP_INTERVAL_MIN` | yes | Cleanup scheduler cadence |
| `FLUXAOS_CLEANUP_STALE_DAYS` | yes | Stale worktree threshold |
| `FLUXAOS_CLEANUP_SESSION_RETENTION_DAYS` | yes | Session retention |
| `FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS` | yes | Artifacts retention |
| `FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN` | optional | Periodic recovery sweep cadence |
| `FLUXAOS_WORKSPACE_ROOT` | optional | Override `<repo>/.fluxaos-worktrees/` |
| `FLUXAOS_ARTIFACTS_ROOT` | optional | Override `<repo>/.fluxaos-artifacts/` |
| `FLUXAOS_TEST_TARGET_REPO` | optional (e2e only) | `owner/repo` for journey tests |
| `FLUXAOS_LAN_AUTH_BYPASS` | optional (homelab only) | Skip auth middleware (`=1`) |

## Development

```bash
# Type check
npx tsc --noEmit

# Lint
npm run lint
# Or: npx biome check .  (format)

# Vitest integration tests (real Supabase)
npx vitest run

# Verification suite (seed correctness, etc.)
npm run verify

# Playwright journeys (require dev server + creds)
npx playwright test

# Alpha-acceptance smoke
npx playwright test e2e/r-smoke.spec.ts

# Database scripts
npm run db:issues   # list issues with state/status
npm run db:runs     # list pipeline + stage runs
npm run db:gates    # list gate results
npm run db:events   # list events (filter: -- --run <id>)
tsx src/scripts/db/nuke.ts   # drop all user data, keep schema
```

## Operator runbook

See `ops/README.md` for the systemd user-unit setup. tl;dr:

```bash
# Enable lingering so the user-unit survives logout
loginctl enable-linger

# Copy the unit and start
cp ops/systemd/fluxaos-daemon.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now fluxaos-daemon

# Tail logs
journalctl --user -u fluxaos-daemon -f
```

## Documentation

- `docs/session-quick-start.md` — conventions, gotchas, env vars, ports.
- `docs/invariants.md` — hard constraints + issue lifecycle.
- `docs/superpowers/roadmap.md` — phase status, plans, specs, RCAs.
- `docs/superpowers/specs/` — design contracts per phase.
- `docs/superpowers/plans/` — implementation plans per phase.
- `docs/superpowers/handoffs/` — session-by-session continuity.
- `docs/superpowers/research/2026-04-22-archon-prior-art.md` — patterns lifted from Archon (attribution).

## License

AGPLv3 — see [LICENSE](LICENSE).
