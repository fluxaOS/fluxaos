# Phase 2 — Lane 3 Code Quality — Area: src/adapters/ + src/lib/ + src/config/ + src/proxy.ts

## Required-reading proof

- **invariants.md:** "Zero vendor imports in src/core/..."
- **spec v2:** "No vendor coupling. Every external integration is behind an adapter interface."
- **rebuild-spec:** "Rewrite adapter registry so `registry.get<T>()` is the only resolution path."
- **CLAUDE.md:** "DI everywhere — services are factories receiving Database, zero vendor imports in src/core/"
- **session-quick-start.md:** "Requires `.env` with: `DATABASE_URL`..."

## Mechanical-check output

Exports in area: 9 top-level (SubprocessExecutor, SupabaseAuthProvider, SupabaseDatabaseProvider, bootstrap, registry, createClient, trpc, TRPCProvider, config).

Magic vendor strings: only `'bullmq'` import in `adapters/bullmq/queue.ts:7` (legitimate).

`@ts-expect-error`: only `adapters/supabase/realtime.ts:36` (outside this area).

Hardcoded URLs: `src/lib/trpc/provider.tsx:10` returns `'http://localhost:3000'`.

## Findings

### AUDIT-P2-CQ-ADAPT-1: `lib/supabase/*` duplicates NEXT_PUBLIC_* env lookup
- **Category:** DRY
- **Severity:** Medium
- **File:line:** `client.ts:8-15`, `server.ts:9-16`, `middleware.ts:12-19`
- **Evidence:** Near-identical env lookup + throw pattern; same logic in `adapters/supabase/server-client.ts:11-25` and `config/bootstrap.ts:46-47`.
- **Direction:** Extract `requireSupabaseBrowserEnv()` helper; reuse `requireEnv()` from bootstrap.

### AUDIT-P2-CQ-ADAPT-2: `getBaseUrl()` hardcodes `http://localhost:3000`
- **Category:** magic-value
- **Severity:** High
- **File:line:** `src/lib/trpc/provider.tsx:8-11`
- **Evidence:** Session-quick-start says dev runs at `192.168.54.101:3000`; homelab literal is wrong.
- **Direction:** Read from env var; fail fast when absent.

### AUDIT-P2-CQ-ADAPT-3: SupabaseAuthProvider registered but real auth uses `@supabase/ssr` directly
- **Category:** dead / indirection
- **Severity:** High
- **File:line:** `src/adapters/supabase/auth.ts:39-106`; registered at `bootstrap.ts:45-49`
- **Evidence:** Only callers are bootstrap itself and `health/route.ts:77`. All real auth flows (middleware, client.ts, server.ts, login page, signout route, use-current-user) import `@supabase/ssr` directly.
- **Direction:** Route auth through the port or remove the adapter.

### AUDIT-P2-CQ-ADAPT-4: Two parallel Supabase client factories (lib/supabase/ vs adapters/supabase/server-client.ts)
- **Category:** DRY / vendor-leak
- **Severity:** High
- **File:line:** `lib/supabase/client.ts`, `server.ts`, `middleware.ts` + `adapters/supabase/server-client.ts`
- **Evidence:** `lib/supabase/*.ts` import `@supabase/ssr` directly; spec v2 forbids Supabase imports outside adapters. `server-client.ts` self-describes as "THE ONLY FILE", but three others exist.
- **Direction:** Collapse lib/supabase/ into adapters/supabase/.

### AUDIT-P2-CQ-ADAPT-5: `bootstrap()` module-scoped `bootstrapped` flag is a hidden singleton
- **Category:** over-eng / indirection
- **Severity:** Medium
- **File:line:** `src/config/bootstrap.ts:29-36`
- **Evidence:** `registry.register` already throws on duplicates (registry.ts:26-30); the flag duplicates idempotency and makes bootstrap untestable across imports.
- **Direction:** Rely on registry's duplicate detection OR expose `resetRegistry()` with flag on registry object.

### AUDIT-P2-CQ-ADAPT-6: `resolveContext` imports concrete service factories, bypassing port resolution
- **Category:** indirection
- **Severity:** Medium
- **File:line:** `src/lib/resolve-context.ts:9-22`
- **Evidence:** Registry consulted for `database` only; service factories stitched inline. Same pattern duplicates in `src/server/trpc.ts:19`.
- **Direction:** Extract `createServices(db)` helper.

### AUDIT-P2-CQ-ADAPT-7: `registry.has()` is dead
- **Category:** dead
- **Severity:** Low
- **File:line:** `src/config/registry.ts:56-58`
- **Evidence:** No call sites.
- **Direction:** Remove.

### AUDIT-P2-CQ-ADAPT-8: `REQUIRED_ADAPTERS` uses magic strings, drifts from actual registrations
- **Category:** magic-value
- **Severity:** Medium
- **File:line:** `src/config/bootstrap.ts:27,39-63`
- **Evidence:** `['database', 'auth', 'queue'] as const` — `'executor'` registered but not required; typos fail at runtime not compile time.
- **Direction:** Define `type AdapterName` union and parameterize register/get on it.

### AUDIT-P2-CQ-ADAPT-9: `SubprocessExecutor.cancel()` leaks setTimeout
- **Category:** over-eng
- **Severity:** Low
- **File:line:** `src/adapters/subprocess/executor.ts:72-84`
- **Evidence:** Timer is fire-and-forget; handle never cleared.
- **Direction:** Use execa's built-in `forceKillAfterTimeout` option.

### AUDIT-P2-CQ-ADAPT-10: `SupabaseDatabaseProvider` instantiated directly in 10+ call sites
- **Category:** indirection / vendor-leak
- **Severity:** High
- **File:line:** `adapter class at src/adapters/supabase/database.ts:17`; callers include `src/core/db/seed.ts:41`, `nuke.ts:19`, `db/scripts/connection.ts:18`, `gates/demo.ts:23`, `orchestrator/demo.ts:42`, and 6 integration tests.
- **Evidence:** Rebuild-spec: `registry.get<T>()` is "the only resolution path." Multiple core-path files reach directly into the adapter class.
- **Direction:** Provide `bootstrapForScripts()` so CLI/seed/nuke/demo files can `registry.get`.

### AUDIT-P2-CQ-ADAPT-11: `proxy.ts` matcher excludes `api/` so tRPC requests skip session refresh
- **Category:** magic-value
- **Severity:** Medium
- **File:line:** `src/proxy.ts:12-23`
- **Evidence:** `matcher: ['/((?!…|api/|…).*)']` — API routes bypass `updateSession`; tRPC routers see stale Supabase cookies despite middleware comment "MUST happen before any other Supabase calls."
- **Direction:** Include `/api/trpc/*` in matcher or document exclusion; extract regex to named constant.

### AUDIT-P2-CQ-ADAPT-12: `trpc/provider.tsx` hardcodes staleTime and refetchOnWindowFocus
- **Category:** magic-value
- **Severity:** Low
- **File:line:** `src/lib/trpc/provider.tsx:14-20`
- **Evidence:** `staleTime: 5_000, refetchOnWindowFocus: false` — magic number + silent behavior.
- **Direction:** Pull from named constant with rationale.

## Phase 2 overflow candidates

- `src/adapters/supabase/realtime.ts` — `@ts-expect-error` on postgres_changes.
- `src/adapters/bullmq/queue.ts` — same DI/registry audit due.
- `SupabaseDatabaseProvider` instantiations inside `src/core/` — invariant 7 risk (flagged via overflow in Adapter Lane 1 too).

## Blocked

None.
