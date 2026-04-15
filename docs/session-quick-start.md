# Session Quick-Start

**Read this before doing anything.** These are conventions that every session must follow.

## Deferred Issues

Issues found during verification go to `docs/superpowers/deferred-fixes.md` — NOT Forgejo tickets. The database gets nuked regularly so Forgejo issue state would be lost. Format:

```markdown
## UI: Brief description

**Found:** YYYY-MM-DD during <context>
**Severity:** High/Medium/Low
**Location:** `src/path/to/file.tsx`
**What's needed:** What to fix
```

## Database Access

Use npm scripts to query the app's Supabase database:

- `npm run db:issues` — issues with state/status/priority
- `npm run db:runs` — pipeline runs with stage details and signals
- `npm run db:gates` — gate results with verdicts
- `npm run db:events` — events (all recent, or filtered by `--run <id>` / `--issue <id>`)
- `npm run db:studio` — Drizzle Studio (visual DB browser)

Note: These scripts are being built (R-INFRA-2). Until then, use `npm run db:studio`.

## Dev Server

This is a headless box. The dev server runs at `http://192.168.54.101:3000` (or next available port if 3000 is busy — check the startup output). Browser verification requires a machine that can reach that IP.

## CLI Tools

This is a standalone TypeScript project. Use npm scripts for all development tasks — see the Commands table in CLAUDE.md.

## Gotchas

- Requires `.env` with: `DATABASE_URL` (Supabase transaction pooler, port 6543), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Migrations need `DIRECT_URL` (Supabase direct connection, port 5432) — pooler (6543) won't work for DDL
- Optimistic concurrency required on all mutable entities (`WHERE version = $expected`)
- Events tables are append-only (immutable audit trail)
- Body HTML rendered at write time, never at read time
- Multi-tenancy: Org → User → Project. URL: `/[org]/[user]/[project]/issues/1`
- No production database — Supabase Cloud is the dev database. Nuke-and-seed freely.
