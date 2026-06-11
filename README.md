# fluxaOS

AI orchestration OS — a config-driven engine that runs pipelines of AI-powered stages against issues. File an issue, the daemon picks it up, the worker runs in an isolated git worktree, and a PR opens on your repo.

> **Status:** Alpha is **not shipped**. The engine is assembled and the project is in alpha-verification / post-alpha-roadmap triage: code for the file-issue → daemon-run → PR-open loop exists, but the alpha label waits on the verification matrix going fully green. Current scope remains one operator, one project, one git provider (GitHub), Anthropic-only.

## What is fluxaOS?

fluxaOS reads its configuration from the database and executes whatever the operator configured — pipeline stages, skills, drivers, gates, routing rules. The engine is agnostic: it doesn't know stage names, provider names, or driver names. It runs DB-owned configuration, not file-backed pipeline definitions.

The seeded alpha lifecycle is `research` → `implement` → `review` → `rework` → `deploy`. Those names are configured data, not engine literals: `review` can route to `rework`, `rework` resubmits to `review`, and a proceed verdict from `review` routes to `deploy`. Each stage runs Claude in an isolated worktree, hands off intermediate findings via per-run artifact directories, and gates routing on DB-configured rules or skill signals. When `deploy` proceeds, the deploy bridge commits the worktree, pushes the branch, opens a PR via the GitHub adapter, and records the deploy run outcome.

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
# Then create .env.local with the operational keys. Required for the daemon/deploy loop:
#   ANTHROPIC_API_KEY=sk-ant-...
#   FLUXAOS_GITHUB_TOKEN=ghp_...                  # repo scope
#   FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS=60
#
# Runtime deploy paths and cleanup knobs are DB-backed now, not env-backed:
#   project.target_repo_path                      # Settings → Projects
#   runtime.workspace_root / runtime.artifacts_root
#   cleanup.sweep_interval_min / cleanup.stale_days / cleanup.session_retention_days
#   cleanup.artifacts_retention_days / cleanup.scheduler_enabled

# 4. Set up the database
npm run db:migrate
npm run db:seed
npm run verify:seed       # 10/10 PASS expected

# 5. Configure DB-backed runtime rows
# In Settings → Projects, set project.target_repo_path to an absolute local clone on main.
# In Settings → System, keep the seeded runtime/cleanup defaults or edit them intentionally.

# 6. Start the dev server (terminal 1)
npm run dev -- -H 0.0.0.0 -p 3004

# 7. Start the daemon (terminal 2)
npm run daemon
# Local/dev-only durable option: use ops/systemd/fluxaos-daemon.service.
# Do not enable this on titan for UAT/prod; Docker Compose owns fluxaos-daemon there.

# 8. Open the UI
open http://localhost:3004
# File an issue, advance state to `Implement`, click Run Stage.
# Watch the daemon log + the mission-control page (/p/<project-uuid>/mission-control)
# until the run reaches `completed` and a PR appears on your target repo.
```

For an end-to-end smoke test, see `e2e/r-smoke.spec.ts` — the alpha-acceptance journey that drives the full flow against a disposable sandbox repo.

## flux CLI

`./flux` is the operator lifecycle helper at the repo root. It manages the dev server, the UAT Docker web+daemon services, and local/dev orchestrator systemd units without requiring you to remember `docker compose` paths or `systemctl` invocations.

```
flux server dev start|stop|restart|reset|status [--root <path>] [--port <port>]
flux server uat start|stop|restart|status|build
flux daemon list
flux daemon orchestrator start|stop|restart|status|install|uninstall
flux orchestrator ...        # alias for flux daemon orchestrator
```

| Command | What it does |
|---------|-------------|
| `flux server dev start` | Starts Next.js on port 3004 (`-H 0.0.0.0`), PID/log under `.flux/` |
| `flux server dev stop` | Kills the dev server |
| `flux server dev restart` | Stop + start |
| `flux server dev reset` | Stop → nuke DB → reseed → start (use after `nuke.ts` or bad state) |
| `flux server dev status` | Shows PID, port, and endpoint (`dev-flux.jdp21.com = 192.168.54.101:3004`) |
| `--root <path>` | Serve a different directory (e.g. a worktree) instead of the repo root |
| `--port <port>` | Override the default port (3004) |
| `flux server uat start` | `docker compose up -d fluxaos-web fluxaos-daemon` in `/mnt/stacks/docker/fluxaos` |
| `flux server uat stop` | `docker compose stop fluxaos-web fluxaos-daemon` |
| `flux server uat restart` | `docker compose restart fluxaos-web fluxaos-daemon` |
| `flux server uat status` | `docker compose ps fluxaos-web fluxaos-daemon` + endpoint |
| `flux server uat build` | Runs `/mnt/stacks/docker/fluxaos/build.sh` |
| `flux daemon list` | Lists registered daemons (`orchestrator fluxaos-daemon`) |
| `flux daemon orchestrator install` | Local/dev only: copies + patches the systemd user-unit, enables it |
| `flux daemon orchestrator uninstall` | Local/dev only: disables + removes the unit |
| `flux daemon orchestrator start\|stop\|restart\|status` | Local/dev only: `systemctl --user` pass-through |

Set `FLUX_DRY_RUN=1` to print every shell command without executing it — useful for verifying what a reset or uninstall would do before committing.

## Production Docker

The checked-in `docker-compose.yml` is a development convenience. Production Docker uses the homelab template in `ops/docker/homelab/`.

The first production profile is a homelab rehearsal for the future public install path:

- web and daemon run as separate services from the same image
- Supabase Cloud remains the database/auth/realtime provider
- Redis is the shared `central_redis` service on the external `homelab` Docker network
- runtime data lives under `/mnt/stacks/docker/fluxaos/`
- deploys run through `/mnt/stacks/docker/fluxaos/build.sh`

See `ops/README.md` for the operator runbook.

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
   │ (Docker in  │  pipeline_run │  Postgres + │
   │  UAT/prod)  │  subscription │  Auth + RT  │
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
| Daemon | `tsx` for foreground dev; Docker Compose service for UAT/prod; systemd user-unit is local/dev-only |
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
│   └── p/[projectUuid]/  # Project-scoped routes (UUID-only tenancy, FLX-239)
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
ops/                    # Docker homelab template, local/dev systemd unit, ops runbook
docs/                   # Specs, plans, handoffs, RCAs
tests/verify/           # Verification scripts (seed-check, run-all)
drizzle/                # Migrations + meta snapshots
```

## Configuration

Configuration is split on purpose: credentials and process boot knobs live in env files; runtime deploy paths and cleanup policy live in the database. That prevents one global `.env.local` value from silently driving every project.

### Environment variables

See `.env.example` for the Supabase + base set and `website/docs-site/docs/reference/env-vars.md` for the full `FLUXAOS_*` reference.

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | yes | Postgres pooler URL (port 6543) |
| `DIRECT_URL` | yes | Postgres direct URL (port 5432, migrations) |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role (server-only) |
| `NEXT_PUBLIC_APP_URL` | yes | Absolute app base URL for SSR tRPC calls |
| `ANTHROPIC_API_KEY` | yes | Anthropic SDK key |
| `FLUXAOS_GITHUB_TOKEN` | yes for deploy | PAT with `repo` scope; deploy bridge fails fast when it needs to open a PR and this is unset |
| `FLUXAOS_INIT_RESULT_DOC_SCRIPT` | yes | Path to the bundled init-result-doc script (`.next/daemon/init-result-doc.mjs`) |
| `FLUXAOS_INGEST_RESULT_DOC_SCRIPT` | yes | Path to the bundled ingest-result-doc script (`.next/daemon/ingest-result-doc.mjs`) |
| `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS` | yes for daemon | Positive int, drain window after SIGTERM |
| `FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN` | optional | Periodic recovery sweep cadence; unset means startup sweep only |
| `FLUXAOS_TEST_TARGET_REPO` | optional (e2e only) | `owner/repo` deploy-touching journeys open PRs against |
| `FLUXAOS_LAN_AUTH_BYPASS` | optional (homelab only) | Skip auth middleware (`=1`); never set on an internet-reachable host |

### DB-backed runtime config

These are the authoritative runtime knobs after FLX-221..224. They are seeded by `npm run db:seed` and edited through Settings, not `.env.local`.

| DB key / column | Required | Purpose |
|-----------------|----------|---------|
| `project.target_repo_path` | yes for deploy | Absolute path to each project's local target-repo clone on `main`; `NULL` makes stage acquisition fail fast with `MissingProjectTargetRepoPathError` |
| `runtime.workspace_root` | seeded global `config_entry` | Optional worktree root override; JSON `null` means use `<repo>/.fluxaos-worktrees/` |
| `runtime.artifacts_root` | seeded global `config_entry` | Optional artifact root override; JSON `null` means use `<repo>/.fluxaos-artifacts/` |
| `cleanup.sweep_interval_min` | seeded global `config_entry` | Cleanup scheduler cadence in minutes |
| `cleanup.stale_days` | seeded global `config_entry` | Worktree stale threshold |
| `cleanup.session_retention_days` | seeded global `config_entry` | Terminal session retention |
| `cleanup.artifacts_retention_days` | seeded global `config_entry` | Artifact directory retention |
| `cleanup.scheduler_enabled` | seeded global `config_entry` | Boolean boot gate; restart the daemon after changing it |

Legacy env names `FLUXAOS_TARGET_REPO_PATH`, `FLUXAOS_WORKSPACE_ROOT`, `FLUXAOS_ARTIFACTS_ROOT`, and `FLUXAOS_CLEANUP_*` are not the runtime configuration surface. If you find one in local scripts, treat it as migration/test scaffolding and verify the matching DB row before trusting it.

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

See `ops/README.md` for the operator runbook. UAT/prod on titan is Docker-owned:

```bash
./flux server uat status
./flux server uat restart
```

The systemd user-unit in `ops/systemd/` is for local/dev daemon durability only. Do not run it beside the Docker `fluxaos-daemon` service on titan.

### `flux` operator helper

The repo root includes `./flux` as a small lifecycle helper. See the [flux CLI](#flux-cli) section for the full command reference.

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
