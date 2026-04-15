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

**`flu db query fluxaos` hits the WRONG database.** It queries a local Postgres instance registered in fh-commons, NOT the Supabase Cloud database that the app uses. These are completely different databases.

To query the app's actual database, use the TS scripts in `src/core/db/scripts/` (TODO: being built). Until then, use Drizzle Studio: `npm run db:studio`.

## Dev Server

This is a headless box. The dev server runs at `http://192.168.54.101:3000` (or next available port if 3000 is busy — check the startup output). Browser verification requires a machine that can reach that IP.

## fh-commons Integration

The `flu` CLI wrapper exists but is a Python shim for a TypeScript project. It provides `flu issue`, `flu memory`, `flu pr` commands that talk to Forgejo and local Postgres — useful for issue tracking but NOT for app database queries. The fh-commons decoupling is in progress (see roadmap R-INFRA).

## Gotchas

- Requires `.env` with: `DATABASE_URL` (Supabase transaction pooler, port 6543), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Migrations need `DIRECT_URL` (Supabase direct connection, port 5432) — pooler (6543) won't work for DDL
- Optimistic concurrency required on all mutable entities (`WHERE version = $expected`)
- Events tables are append-only (immutable audit trail)
- Body HTML rendered at write time, never at read time
- Multi-tenancy: Org → User → Project. URL: `/[org]/[user]/[project]/issues/1`
- No production database — Supabase Cloud is the dev database. Nuke-and-seed freely.
