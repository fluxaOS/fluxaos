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
- **No unit tests** — integration tests against real Supabase only; see Verification below
- **Edit, never Write** — never overwrite existing files; build missing endpoints instead of deleting UI

## Verification

UI work requires a passing Playwright journey test in `e2e/`. The journey test simulates a user end-to-end (clicks buttons, opens modals, asserts rendered DOM) and captures `pageerror` + `console.error`. **No human checkpoint replaces it.** If a journey test doesn't cover the surface you're touching, write one before claiming done. Reference pattern: `e2e/real-anthropic-stage-run.spec.ts` (skips cleanly without `ANTHROPIC_API_KEY`; with it, drives a live-Claude run and asserts terminal status + tool-call rendering + zero unexpected errors).

## AI Authority

**Decide without consulting:** implementation choices (libraries, patterns, file layout, algorithms), design specs and plans for slices already on the roadmap, bug-fix architecture, test strategy within the integration-test rule, commit messages, PR titles, branch names, brainstorming outcomes (pick the recommendation, document the rejected alternatives in the spec).

**Require approval first:** schema migrations (anything in `migrations/` or `db:generate`), new dependencies, roadmap changes (adding/removing/reordering phases), pushes to public-facing services, production deploys.

**Default to action, not consultation.** When in doubt, pick the option you'd defend in code review and ship it. If the human disagrees they'll say so.

## Workflow

- **First run:** `npm i` → set `.env` → `npm run db:migrate` → `npm run db:seed` → `npm run dev`
- **Reset state:** `tsx src/scripts/db/nuke.ts` → `npm run db:seed`
- **After schema changes:** `npm run db:generate` → `npm run db:migrate`

## Reference

- **[Session Quick-Start](docs/session-quick-start.md) — READ FIRST: conventions, gotchas, env vars, ports, autonomy details**
- [Invariants](docs/invariants.md) — hard constraints + issue lifecycle + verification script
- [Roadmap](docs/superpowers/roadmap.md) — phase status, plans, specs, RCAs
- [Approved mockup](docs/planning/mockups/dashboard-mockup.html) — visual target
- All other planning docs: `docs/superpowers/{specs,plans,handoffs,deferred-fixes.md}`
