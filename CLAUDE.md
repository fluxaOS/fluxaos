# fluxaOS

AI orchestration OS — a config-driven engine that runs pipelines of AI-powered stages against issues. The engine is agnostic: it never knows stage names, provider names, or driver names. It reads config from the database and executes whatever the user configured.

> **New session?** Read [Session Quick-Start](docs/session-quick-start.md) first — conventions, gotchas, and database access rules.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run db:generate` | Drizzle schema codegen |
| `npm run db:migrate` | Run migrations |
| `npm run db:seed` | Seed catalog data + default org/user/project |
| `npm run db:studio` | Drizzle Studio (DB browser) |
| `npm run db:issues` | List issues with state/status |
| `npm run db:runs` | List pipeline and stage runs |
| `npm run db:gates` | List gate results |
| `npm run db:events` | List events (all, or `-- --run <id>`) |
| `npm run verify` | Run all verification checks |
| `npm run verify:seed` | Verify seed data is correct |
| `npx vitest` | Integration tests (real Supabase) |
| `tsx src/scripts/db/nuke.ts` | Drop all user data, keep schema |

## Architecture

```
src/
  core/         # Domain logic — services, ports, DB schema, gates, pipeline, orchestrator
  server/       # tRPC routers (root.ts, trpc.ts, routers/)
  adapters/     # Vendor integrations (supabase, bullmq, subprocess)
  app/          # Next.js App Router pages ([org]/[user]/[project]/...)
  components/   # React components (gates/, dashboard/, shared)
  lib/          # Client helpers (supabase client, tRPC client, context resolution)
  config/       # Bootstrap + adapter registry
  __tests__/    # Integration tests (real Supabase, no unit tests)
```

## Tech Stack

Next.js 16, React 19, TypeScript 5, tRPC v11, Drizzle ORM, Supabase Cloud (Postgres/Auth/Realtime), BullMQ + Redis, Tailwind CSS 4, Playwright E2E, Vitest integration tests.

## Key Principles

- **Agnostic engine** — no stage/provider/driver/enum literals in app code (seed data and adapters only)
- **Config-driven** — fail fast on missing config, no silent defaults
- **DI everywhere** — services are factories receiving `Database`, zero vendor imports in `src/core/`
- **Orchestrator vs Workers** — systemd daemon manages pipeline state; AI workers are read-only executors that report via comments
- **No unit tests** — integration tests against real Supabase only; see Agent Behavior
- **Edit, never Write** — never overwrite existing files; build missing endpoints instead of deleting UI

## Agent Behavior

@.claude/AGENT_BEHAVIOR.md

**Project-specific verification:** UI work uses Playwright journey tests in `e2e/`. Reference pattern: `e2e/real-anthropic-stage-run.spec.ts`.

## Workflow

- **First run:** `npm i` → set `.env` → `npm run db:migrate` → `npm run db:seed` → `npm run dev`
- **Reset state:** `tsx src/scripts/db/nuke.ts` → `npm run db:seed`
- **After schema changes:** `npm run db:generate` → `npm run db:migrate`

## R-RUNTIME env vars

Runtime deploy loop (file-issue → PR) requires these in `.env.local`:

- `FLUXAOS_GITHUB_TOKEN` — PAT with `repo` scope. Deploy bridge fails fast if unset when it needs to open a PR.
- `FLUXAOS_TARGET_REPO_PATH` — absolute path to a local clone of the target repo on `main`. Stage-runner refuses to acquire an isolation env without it.
- `FLUXAOS_CLEANUP_SWEEP_INTERVAL_MIN` / `FLUXAOS_CLEANUP_STALE_DAYS` / `FLUXAOS_CLEANUP_SESSION_RETENTION_DAYS` — cleanup-scheduler thresholds. Scheduler refuses to start if any are unset (logged warning, no crash — the rest of the app boots).
- `FLUXAOS_WORKSPACE_ROOT` (optional) — override for where worktrees live. Default is in-project `<repo>/.fluxaos-worktrees/` (NFS/Docker friendly); auto-added to target repo's `.gitignore` on first acquire.
- `FLUXAOS_TEST_TARGET_REPO` (e2e only) — `owner/repo` for the E2E journey's disposable sandbox PR target.

## Reference

- **[Session Quick-Start](docs/session-quick-start.md) — READ FIRST: conventions, gotchas, env vars, ports, autonomy details**
- [Invariants](docs/invariants.md) — hard constraints + issue lifecycle + verification script
- [Roadmap](docs/superpowers/roadmap.md) — phase status, plans, specs, RCAs
- [Approved mockup](docs/planning/mockups/dashboard-mockup.html) — visual target
- All other planning docs: `docs/superpowers/{specs,plans,handoffs,deferred-fixes.md}`
