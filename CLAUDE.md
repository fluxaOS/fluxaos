# fluxaOS

AI orchestration OS — a config-driven engine that runs pipelines of AI-powered stages against issues. The engine is agnostic: it never knows stage names, provider names, or harness names. It reads config from the database and executes whatever the user configured.

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
| `npx vitest` | Integration tests (real Supabase) |
| `tsx src/core/db/nuke.ts` | Drop all user data, keep schema |

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

- **Agnostic engine** — no stage/provider/harness/enum literals in app code (seed data and adapters only)
- **Config-driven** — fail fast on missing config, no silent defaults
- **DI everywhere** — services are factories receiving `Database`, zero vendor imports in `src/core/`
- **Orchestrator vs Workers** — systemd daemon manages pipeline state; AI workers are read-only executors that report via comments
- **No unit tests** — integration tests against real Supabase only; journey test is the real test
- **No self-certification** — every phase verified by human in running browser
- **Edit, never Write** — never overwrite existing files; build missing endpoints instead of deleting UI

## Workflow

- **First run:** `npm i` → set `.env` → `npm run db:migrate` → `npm run db:seed` → `npm run dev`
- **Reset state:** `tsx src/core/db/nuke.ts` → `npm run db:seed`
- **After schema changes:** `npm run db:generate` → `npm run db:migrate`

## Gotchas

- Requires `.env` with: `DATABASE_URL` (Supabase transaction pooler, port 6543), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Migrations need `DIRECT_URL` (Supabase direct connection, port 5432) — pooler (6543) won't work for DDL
- Optimistic concurrency required on all mutable entities (`WHERE version = $expected`)
- Events tables are append-only (immutable audit trail)
- Body HTML rendered at write time, never at read time
- Multi-tenancy: Org → User → Project. URL: `/[org]/[user]/[project]/issues/1`
- No production database — Supabase Cloud is the dev database. Nuke-and-seed freely.

## Reference

- [Invariants & Verification](docs/invariants.md) — 24 hard constraints + verification script
- [Session Protocol](docs/session-protocol.md) — 14-step checklist for implementation sessions
- [Roadmap](docs/roadmap.md) — phase status, plans, specs, RCAs
- [PAT reference](../pat/) — data models, seed data, API routes, frontend components
- [Design spec v2](docs/superpowers/specs/2026-04-07-fluxaos-spec-v2.md)
- [Rebuild spec](docs/superpowers/specs/2026-04-09-rebuild-spec.md)
- [Approved mockup](planning/mockups/dashboard-mockup.html)
