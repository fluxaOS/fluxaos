# Phase 2 — Lane 1 Invariants — Area: src/adapters/ + src/lib/ + src/config/ + src/proxy.ts

## Required-reading proof

- **invariants.md:** "Zero vendor imports in src/core/..."
- **spec v2:** "No vendor coupling. Every external integration is behind an adapter interface. Core business logic imports from `core/ports/` only."
- **rebuild-spec:** "Zero vendor imports in `core/`. The adapter registry is the only way to resolve implementations. Services receive dependencies via injection."
- **CLAUDE.md:** "DI everywhere — services are factories receiving `Database`, zero vendor imports in `src/core/`"
- **session-quick-start.md:** "The dev server runs at `http://192.168.54.101:3000` (or next available port if 3000 is busy — check the startup output)."

## Mechanical-check output

**1. Files > 500 lines in area:** (none — largest is auth.ts at 106 lines)
```
src/adapters/subprocess/executor.ts: 85
src/adapters/supabase/auth.ts: 106
src/adapters/supabase/database.ts: 47
src/config/bootstrap.ts: 64
src/config/registry.ts: 84
src/lib/resolve-context.ts: 33
src/lib/supabase/client.ts: 18
src/lib/supabase/server.ts: 37
src/lib/trpc/client.ts: 6
src/lib/trpc/provider.tsx: 40
src/proxy.ts: 23
```

**2. `as any`/`@ts-*` in listed files:** (none — the only match is in `src/adapters/supabase/realtime.ts` which is not in this area)

**3. Adapter → core imports NOT via `@/core/ports`:**
```
src/adapters/subprocess/executor.ts:13: import { KILL_GRACE_PERIOD_MS } from '@/core/constants';
src/adapters/supabase/database.ts:13: import * as schema from '@/core/db/schema';
src/adapters/supabase/database.ts:15: import type { Database } from '@/core/db/connection';
src/lib/resolve-context.ts:13: '@/core/services' (createOrganizationService, createUserService, createProjectService)
```

**4. `process.env` usage:**
```
src/adapters/subprocess/executor.ts:32
src/config/bootstrap.ts:17 (requireEnv — throws if missing)
src/lib/supabase/client.ts:8-9 (throws if missing)
src/lib/supabase/server.ts:9-10 (throws if missing)
```

## Findings

### AUDIT-P2-INV-ADAPT-1: Middleware file misnamed — `src/proxy.ts` never invoked by Next.js
- **Invariant:** #9 and rebuild-spec "Auth — Wired into Next.js middleware from day one"
- **Severity:** High
- **File:line:** `src/proxy.ts:1-23`
- **Evidence:** Next.js 16 only invokes `middleware.ts` exporting `middleware`/`default`. `src/proxy.ts` exporting `proxy` is never run. No `middleware.ts` anywhere in the tree. No Supabase session refresh, no auth redirects.
- **Direction:** Rename file to `src/middleware.ts` and export `middleware`.

### AUDIT-P2-INV-ADAPT-2: `SubprocessExecutor` silently defaults timeout to 5 minutes
- **Invariant:** #9
- **Severity:** Medium
- **File:line:** `src/adapters/subprocess/executor.ts:33`
- **Evidence:** `timeout: params.timeoutMs ?? 300_000,` — silent magic default for orchestration-critical parameter.
- **Direction:** Require `timeoutMs` or resolve from stage config; no fallback.

### AUDIT-P2-INV-ADAPT-3: `SubprocessExecutor.cancel` returns before SIGKILL fires
- **Invariant:** #9
- **Severity:** Medium
- **File:line:** `src/adapters/subprocess/executor.ts:72-84`
- **Evidence:** Function resolves synchronously after `kill('SIGTERM')`; SIGKILL is fire-and-forget via `setTimeout`; callers `await cancel()` before subprocess actually terminates.
- **Direction:** Await race between process exit and grace timeout.

### AUDIT-P2-INV-ADAPT-4: `TRPCProvider` hardcodes `http://localhost:3000`
- **Invariant:** #9
- **Severity:** Medium
- **File:line:** `src/lib/trpc/provider.tsx:8-11`
- **Evidence:** Server-side branch returns hardcoded localhost:3000; contradicts homelab URL and port-pick behaviour.
- **Direction:** Derive from env var (`NEXT_PUBLIC_APP_URL`) and throw on missing (or remove if unreachable).

### AUDIT-P2-INV-ADAPT-5: Health route typed against concrete adapter classes, not ports
- **Invariant:** #6
- **Severity:** Medium
- **File:line:** `src/app/api/health/route.ts:77,80` (wiring is in bootstrap.ts)
- **Evidence:** `registry.get<SupabaseAuthProvider>('auth')` and `registry.get<BullMQAdapter>('queue')` pin callers to vendor-specific class symbols.
- **Direction:** Type `registry.get<T>` sites against `@/core/ports/*`.

### AUDIT-P2-INV-ADAPT-6: `subprocess/executor.ts` imports from `@/core/constants` (not ports)
- **Invariant:** #7 corollary (adapter → ports-only discipline)
- **Severity:** Low
- **File:line:** `src/adapters/subprocess/executor.ts:13`
- **Evidence:** `import { KILL_GRACE_PERIOD_MS } from '@/core/constants';`
- **Direction:** Move constant into port module or pass via constructor.

### AUDIT-P2-INV-ADAPT-7: `lib/resolve-context.ts` pulls service factories into a lib helper
- **Invariant:** #8
- **Severity:** Low
- **File:line:** `src/lib/resolve-context.ts:9-13`
- **Evidence:** `import { createOrganizationService, createUserService, createProjectService } from '@/core/services';`
- **Direction:** Return services alongside `{ db, org, user, project }` or have resolveContext own the wiring.

## Phase 2 overflow candidates

- `src/adapters/supabase/realtime.ts:36` — `@ts-expect-error` on postgres_changes
- `new SupabaseDatabaseProvider(url)` called directly in `src/core/db/seed.ts:41`, `src/core/db/nuke.ts:19`, `src/core/db/scripts/connection.ts:18`, `src/core/gates/demo.ts:23`, `src/core/orchestrator/demo.ts:42` — invariant 7 violations
- Integration tests bypass the registry and instantiate adapters directly
- `src/lib/supabase/middleware.ts` is dead because `proxy.ts` is not Next's entry — once renamed, needs a verification pass

## Blocked

None.
