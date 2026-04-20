> **Status (2026-04-20) — SUPERSEDED.** Tasks 1–11 shipped via R-REM-W1/W2 against a different file structure. Tasks 12–32 superseded by R-UI-2.5 (`docs/superpowers/specs/2026-04-20-r-ui-2-disposition-and-w3-decomposition-design.md`, `docs/superpowers/plans/2026-04-20-r-ui-2-5-implementation.md`). Orchestrator-rewire tasks (14–22) are permanently deferred — their target files (`stage-worker.ts`, `orchestrator/index.ts`, `output-parser.ts`) were deleted or relocated in W1/W2. Branch `feat/r-ui-2-impl` archived; do not resume.

---

# R-UI-2 Implementation Plan (v2 — post-DA review)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **EDIT ONLY** on existing files. Never Write over existing files. Use Edit.
>
> **Spec:** `docs/superpowers/specs/2026-04-16-r-ui-2-design.md`
>
> **This plan is v2.** v1 was reviewed by two DA subagents; 8 findings were CRITICAL. All are addressed here. See commit `bc86dcd` for v1 if you need the diff.

**Goal:** Finish the realtime-streaming + orchestrator-activation work R5-V specified but did not implement. Route all Supabase Realtime calls through the `RealtimeProvider` port, wire orchestrator stage dispatch through BullMQ for Celery-equivalent durability, ship the orchestrator as a systemd-managed service.

**Architecture:** Client components consume a `RealtimeProvider` port via React context (`useRealtime()`); the one Supabase Realtime adapter lives at `src/adapters/supabase/realtime.ts`. A server-side Supabase factory lives at `src/adapters/supabase/server-client.ts` — the entrypoint scripts in `src/core/orchestrator/` have zero direct vendor imports. The orchestrator runs as a user-level systemd service, enqueues stage jobs to BullMQ (configured with `attempts: 3` + exponential backoff), and a separately-managed `fluxaos-stage-worker` systemd service consumes those jobs by calling `executeStageRun`. Stream-as-it-arrives replaces refetch-on-INSERT via tRPC `setData` append.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, tRPC v11, Supabase Cloud (Postgres + Realtime via `@supabase/ssr` and `@supabase/supabase-js`), BullMQ + ioredis, Drizzle ORM, systemd --user, Playwright, Vitest (integration only, real Supabase).

---

## File Map

### New files

| File | Responsibility |
|------|----------------|
| `src/adapters/supabase/realtime.ts` | The ONLY place Supabase Realtime SDK APIs are called. Implements `RealtimeProvider`. |
| `src/adapters/supabase/server-client.ts` | Server-side Supabase client factory. The ONLY place `@supabase/supabase-js` is imported for server-side use. |
| `src/lib/realtime/context.tsx` | React context provider. Construction is lazy — no WebSocket until first `subscribeToTable` call. |
| `src/lib/realtime/use-realtime.ts` | `useRealtime()` hook; throws if used outside provider. |
| `src/lib/realtime/use-now.ts` | `useNow({ intervalMs, enabled })` hook for live-duration ticking. |
| `src/core/orchestrator/main.ts` | Orchestrator systemd entrypoint. NO direct vendor imports. |
| `src/core/orchestrator/worker-main.ts` | Stage-worker systemd entrypoint. NO direct vendor imports. |
| `scripts/systemd/fluxaos-orchestrator.service` | Unit template with `__FLUXAOS_REPO_PATH__` / `__FLUXAOS_ENV_PATH__` placeholders. |
| `scripts/systemd/fluxaos-stage-worker.service` | Same. |
| `scripts/install-orchestrator.sh` | Idempotent install script — substitutes placeholders, installs, starts. |
| `drizzle/0005_realtime_publication.sql` | Hand-written raw-SQL migration. No schema change; adds publication membership. |
| `e2e/live-output-streams.spec.ts` | Playwright: output appears incrementally. |
| `e2e/activity-feed-auto-refreshes.spec.ts` | Playwright: issue events surface without reload. |
| `e2e/cancel-running-stage.spec.ts` | Playwright: cancel transitions stage and pipeline. |
| `e2e/orchestrator-recovers-after-restart.spec.ts` | Playwright: orchestrator restart reconciles orphans. |
| `e2e/bullmq-requeues-on-worker-restart.spec.ts` | Playwright: BullMQ redelivers job on graceful worker restart (lockDuration-safe). |

### Modified files (EDIT ONLY)

| File | Change |
|------|--------|
| `src/core/ports/realtime.ts` | Add `filter?: string` to `subscribeToTable`. |
| `src/core/ports/queue.ts` | `process()` returns `QueueWorker` (with `close()`). |
| `src/app/layout.tsx` | Wrap children in `RealtimeContextProvider`. |
| `src/components/pipeline/LiveOutput.tsx` | Swap direct Supabase for `useRealtime()` (5-arg form); switch refetch → `setData` append. Add `data-testid`. |
| `src/components/pipeline/RunDetailModal.tsx` | Same treatment for `stage_run` subscription. Add `useNow` duration ticker. |
| `src/components/pipeline/GateResultsPanel.tsx` | Fix `ruleResults[].field` → `ruleResults[].rule.field`. |
| `src/app/[org]/[user]/[project]/issues/[number]/client.tsx` | Add `useRealtime()` subscription. Add `data-testid` to activity items. |
| `src/core/orchestrator/event-orchestrator.ts` | Accept `queue: QueueProvider` dep. Replace in-process `executeStageRun` with BullMQ enqueue. Add `stage_run` UPDATE subscription with idempotency guard. REPLACE `recoverOnStartup()` (not extend — v1 was synchronous-execution-era code). |
| `src/core/orchestrator/stage-worker.ts` | Replace duplicated `buildCommand` + inline execution with `executeStageRun` call. |
| `src/core/orchestrator/types.ts` | Reduce `StageJobPayload` to `{ stageRunId, attempt }`. |
| `src/core/orchestrator/pipeline-run-service.ts` | Add `getStageRun`, `getInFlightStageRuns`, `getStage`, `tryClaimStageForTerminalHandling`. |
| `src/adapters/bullmq/queue.ts` | Return `QueueWorker` from `process()`. Set `lockDuration: 300_000`. Support `attempts` + `backoff` in enqueue options. |
| `src/__tests__/integration/orchestrator.test.ts` | Unskip. Rewrite with Redis precondition. Three `recoverOnStartup` tests (one per branch). |
| `CLAUDE.md` | Add orchestrator + worker commands; document DBUS_SESSION_BUS for systemctl-invoking tests. |
| `docs/session-quick-start.md` | Add orchestrator install + status + log commands. |
| `docs/superpowers/roadmap.md` | On completion, mark R-UI-2 Done. |

---

## Phase 1 — Port extensions + Realtime adapter (Tasks 1-6)

### Task 1: Extend RealtimeProvider port with optional filter

**Files:**
- Modify: `src/core/ports/realtime.ts`

- [ ] **Step 1: Read current port**

```bash
cat src/core/ports/realtime.ts
```

- [ ] **Step 2: Add filter parameter**

Edit the `subscribeToTable` signature to:

```typescript
/** Subscribe to INSERT/UPDATE/DELETE on a specific table, optionally row-filtered. */
subscribeToTable<T>(
  channelName: string,
  table: string,
  event: 'INSERT' | 'UPDATE' | '*',
  callback: (payload: RealtimeTableEvent<T>) => void,
  filter?: string,
): Unsubscribe;
```

The `filter` is a PostgREST-style row filter (`column=operator.value`, e.g. `stage_run_id=eq.<uuid>`). Port remains vendor-agnostic — the filter grammar is a simple DSL, not a Supabase type.

- [ ] **Step 3: Typecheck — existing call sites break**

```bash
npx tsc --noEmit 2>&1 | grep "subscribeToTable" | head -10
```

Expected: existing 2 call sites in `event-orchestrator.ts` (lines 77, 89) continue to compile because `filter` is optional. No immediate breakage.

- [ ] **Step 4: Commit**

```bash
git add src/core/ports/realtime.ts
git commit -m "feat(port): add optional filter param to RealtimeProvider.subscribeToTable"
```

---

### Task 2: Extend QueueProvider port with QueueWorker return

**Files:**
- Modify: `src/core/ports/queue.ts`

- [ ] **Step 1: Read current port**

- [ ] **Step 2: Add QueueWorker type + change process return**

```typescript
export interface QueueWorker {
  close(): Promise<void>;
}

// And change:
process<T>(
  queueName: string,
  handler: (job: Job<T>) => Promise<void>,
): QueueWorker;
```

- [ ] **Step 3: BullMQ adapter ALSO needs update (same commit)**

Edit `src/adapters/bullmq/queue.ts`:

```typescript
import type { QueueProvider, Job, JobOptions, JobStatus, QueueWorker } from '@/core/ports/queue';

// In process method:
process<T>(queueName: string, handler: (job: Job<T>) => Promise<void>): QueueWorker {
  const worker = new Worker<T>(
    queueName,
    async (bullJob) => { await handler(mapJob(bullJob)); },
    {
      connection: this.getConnection(),
      lockDuration: 300_000, // 5 min — accommodates long-running stages
    },
  );
  return { close: async () => { await worker.close(); } };
}
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -E "queue|bullmq" | head -10
```

Expected: clean (the existing test mock-queue may break, fixed in Task 28).

- [ ] **Step 5: Commit**

```bash
git add src/core/ports/queue.ts src/adapters/bullmq/queue.ts
git commit -m "feat(queue): return QueueWorker from process() for clean shutdown; set lockDuration"
```

---

### Task 3: Write failing test for Supabase Realtime adapter

**Files:**
- Create: `src/__tests__/integration/realtime-adapter.test.ts`

- [ ] **Step 1: Create the test**

**IMPORTANT — v3 correction:** `event.stageRunId` is `NOT NULL` per `schema.ts:158`. The test MUST create a real `stage_run` FK first. Use the existing seed (1 pipeline, 4 stages) and create a `pipeline_run` + `stage_run` row to hang events off.

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseRealtimeAdapter } from '@/adapters/supabase/realtime';
import { getDatabase } from '@/core/db/connection';
import { event, pipelineRun, stageRun, pipelineStage, pipeline } from '@/core/db/schema';
import type { RealtimeProvider } from '@/core/ports/realtime';
import { eq } from 'drizzle-orm';

describe('Supabase Realtime adapter (integration)', () => {
  let adapter: RealtimeProvider;
  let testStageRunId: string;
  let testPipelineRunId: string;
  const db = getDatabase();

  beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error('Supabase env missing');
    adapter = createSupabaseRealtimeAdapter(createClient(url, key));

    // Create a real pipeline_run + stage_run to satisfy event.stageRunId FK.
    const [pipe] = await db.select().from(pipeline).limit(1);
    if (!pipe) throw new Error('Seed missing: no pipeline');
    const [stage] = await db.select().from(pipelineStage).where(eq(pipelineStage.pipelineId, pipe.id)).limit(1);
    if (!stage) throw new Error('Seed missing: no pipeline_stage');

    const [run] = await db
      .insert(pipelineRun)
      .values({ pipelineId: pipe.id, status: 'pending' })
      .returning();
    testPipelineRunId = run.id;

    const [sr] = await db
      .insert(stageRun)
      .values({ pipelineRunId: run.id, pipelineStageId: stage.id, status: 'queued' })
      .returning();
    testStageRunId = sr.id;
  });

  afterAll(async () => {
    // Clean up in reverse FK order.
    await db.delete(event).where(eq(event.stageRunId, testStageRunId));
    await db.delete(stageRun).where(eq(stageRun.id, testStageRunId));
    await db.delete(pipelineRun).where(eq(pipelineRun.id, testPipelineRunId));
  });

  it('delivers INSERT payloads via subscribeToTable (unfiltered)', async () => {
    const received: Array<{ id: string }> = [];
    const unsub = adapter.subscribeToTable<typeof event.$inferSelect>(
      'test-unfiltered',
      'event',
      'INSERT',
      (p) => received.push(p.new as { id: string }),
    );
    await new Promise((r) => setTimeout(r, 1500));

    const [inserted] = await db
      .insert(event)
      .values({ stageRunId: testStageRunId, type: 'test', payload: { marker: 'unfiltered' } })
      .returning();

    const deadline = Date.now() + 3000;
    while (!received.find((r) => r.id === inserted.id) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    unsub();
    expect(received.find((r) => r.id === inserted.id)).toBeDefined();
  });

  it('respects filter — only delivers matching rows', async () => {
    const received: Array<{ id: string }> = [];
    const unsub = adapter.subscribeToTable<typeof event.$inferSelect>(
      'test-filtered',
      'event',
      'INSERT',
      (p) => received.push(p.new as { id: string }),
      'type=eq.test-filter-match',
    );
    await new Promise((r) => setTimeout(r, 1500));

    await db.insert(event).values({ stageRunId: testStageRunId, type: 'test-filter-miss', payload: {} });
    const [matched] = await db.insert(event).values({
      stageRunId: testStageRunId, type: 'test-filter-match', payload: {},
    }).returning();

    const deadline = Date.now() + 3000;
    while (!received.find((r) => r.id === matched.id) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    unsub();

    expect(received.find((r) => r.id === matched.id)).toBeDefined();
    // Non-matching inserts should not arrive. We can't prove absence, but if any
    // 'test-filter-miss' row is in received, the filter is broken.
    expect(received.every((r) => r.id === matched.id)).toBe(true);
  });

  it('unsubscribe stops further deliveries', async () => {
    const received: unknown[] = [];
    const unsub = adapter.subscribeToTable(
      'test-unsub', 'event', 'INSERT', (p) => received.push(p.new),
    );
    await new Promise((r) => setTimeout(r, 1500));
    unsub();
    await new Promise((r) => setTimeout(r, 300));
    const before = received.length;
    await db.insert(event).values({ stageRunId: testStageRunId, type: 'test', payload: {} });
    await new Promise((r) => setTimeout(r, 1000));
    expect(received.length).toBe(before);
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
npx vitest run src/__tests__/integration/realtime-adapter.test.ts
```

Expected: FAIL with `Cannot find module '@/adapters/supabase/realtime'`.

- [ ] **Step 3: Commit failing test**

```bash
git add src/__tests__/integration/realtime-adapter.test.ts
git commit -m "test(realtime): failing integration test for Supabase adapter (3 cases)"
```

---

### Task 4: Implement Supabase Realtime adapter

**Files:**
- Create: `src/adapters/supabase/realtime.ts`

- [ ] **Step 1: Write the adapter**

```typescript
/**
 * Supabase Realtime adapter — implements RealtimeProvider.
 *
 * THIS IS THE ONLY FILE IN THE REPOSITORY where Supabase Realtime SDK
 * APIs may be called outside of src/lib/supabase/ and src/adapters/supabase/.
 * All other consumers go through the RealtimeProvider port.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RealtimeProvider, RealtimeTableEvent } from '@/core/ports/realtime';
import type { Unsubscribe } from '@/core/ports/auth';

export function createSupabaseRealtimeAdapter(
  client: SupabaseClient,
): RealtimeProvider {
  function subscribeToTable<T>(
    channelName: string,
    table: string,
    event: 'INSERT' | 'UPDATE' | '*',
    callback: (payload: RealtimeTableEvent<T>) => void,
    filter?: string,
  ): Unsubscribe {
    const config: {
      event: 'INSERT' | 'UPDATE' | '*';
      schema: string;
      table: string;
      filter?: string;
    } = { event, schema: 'public', table };
    if (filter) config.filter = filter;

    const channel = client
      .channel(channelName)
      .on(
        // @ts-expect-error — supabase-js types for postgres_changes are imprecise
        'postgres_changes',
        config,
        (payload: {
          eventType: 'INSERT' | 'UPDATE' | 'DELETE';
          new: T;
          old: T | null;
        }) => {
          callback({
            eventType: payload.eventType,
            new: payload.new,
            old: payload.old,
          });
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }

  function subscribe<T>(
    channelName: string,
    event: string,
    callback: (payload: T) => void,
  ): Unsubscribe {
    const channel = client
      .channel(channelName)
      .on('broadcast', { event }, (msg) => callback(msg.payload as T))
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }

  async function broadcast<T>(
    channelName: string,
    event: string,
    payload: T,
  ): Promise<void> {
    const channel = client.channel(channelName);
    await channel.send({ type: 'broadcast', event, payload });
    await client.removeChannel(channel);
  }

  return { subscribeToTable, subscribe, broadcast };
}
```

- [ ] **Step 2: Run test**

```bash
npx vitest run src/__tests__/integration/realtime-adapter.test.ts
```

Expected: all 3 tests PASS. If an INSERT test times out, the likely cause is the publication (Task 5 fixes systematically).

- [ ] **Step 3: Commit**

```bash
git add src/adapters/supabase/realtime.ts
git commit -m "feat(realtime): Supabase Realtime adapter with filter support"
```

---

### Task 5: Raw-SQL Realtime publication migration

**Files:**
- Create: `drizzle/0005_realtime_publication.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Confirm current journal state**

```bash
cat drizzle/meta/_journal.json
```

Expected: 4 entries with `idx` 0, 1, 2, 3. Last `tag` = `0004_harness_to_driver`. **Note:** the journal `idx` is sequential (0,1,2,3) but `tag` numbers have gaps (0000, 0001, 0003, 0004 — idx 2 maps to tag `0003_ipc_signal_columns`). Drizzle tracks the two independently. Next entry needs `idx: 4`, `tag: "0005_realtime_publication"`.

- [ ] **Step 2: Write the SQL migration**

This migration does TWO things (v3 update): (1) enables Supabase Realtime publication on the four tables the UI and orchestrator subscribe to, and (2) adds a partial unique index enforcing exactly-once gate evaluation per stage_run. Both are DDL-only, no schema change. Together in one migration because they're both infrastructure-reliability concerns for R-UI-2.

```sql
-- drizzle/0005_realtime_publication.sql
-- Two DDL changes:
--   (1) enable Supabase Realtime on event, stage_run, pipeline_run, issue_event
--   (2) partial unique index for exactly-once gate-eval idempotency
-- Both idempotent; safe on fresh DB and on re-apply.

-- ─── (1) Realtime publication ──────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime FOR TABLE event, stage_run, pipeline_run, issue_event;
  ELSE
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE event;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE stage_run;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_run;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE issue_event;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- ─── (2) Gate-eval idempotency index ──────────────────────────────────────
-- Partial unique index on event(stage_run_id) WHERE type='gate_checked'.
-- Ensures exactly-once terminal-state handling across orchestrator instances
-- and across restarts. The INSERT of a second gate_checked event will fail
-- with unique_violation (SQLSTATE 23505), which handleStageTerminalStatus
-- catches and treats as "another instance handled this."
CREATE UNIQUE INDEX IF NOT EXISTS event_gate_checked_per_stage_run
  ON event (stage_run_id)
  WHERE type = 'gate_checked';
```

- [ ] **Step 3: Append journal entry**

Use Edit to add a 5th entry to `drizzle/meta/_journal.json`. The entries array becomes:

```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    { "idx": 0, "version": "7", "when": 1775629999714, "tag": "0000_good_malice",       "breakpoints": true },
    { "idx": 1, "version": "7", "when": 1744502400000, "tag": "0001_r5v_harness_catalog", "breakpoints": true },
    { "idx": 2, "version": "7", "when": 1776083056945, "tag": "0003_ipc_signal_columns",  "breakpoints": true },
    { "idx": 3, "version": "7", "when": 1776377142687, "tag": "0004_harness_to_driver",   "breakpoints": true },
    { "idx": 4, "version": "7", "when": <NOW_UNIX_MS>, "tag": "0005_realtime_publication", "breakpoints": true }
  ]
}
```

Replace `<NOW_UNIX_MS>` with the output of `date +%s%3N`.

**No snapshot `.json` file needed** — this is a raw-SQL migration with no schema delta. Future `npm run db:generate` will not produce a spurious diff for this migration, but it also won't roundtrip it. This is expected for publication-only migrations.

- [ ] **Step 4: Run migration**

```bash
npm run db:migrate
```

Expected: migration runs without error. No schema change visible.

- [ ] **Step 5: Verify publication membership**

```bash
npx tsx -e "
import { getDatabase } from './src/core/db/connection';
import { sql } from 'drizzle-orm';
const db = getDatabase();
const rows = await db.execute(sql\`SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY tablename\`);
console.log(rows);
process.exit(0);
"
```

Expected: output includes `event`, `issue_event`, `pipeline_run`, `stage_run`.

- [ ] **Step 6: Re-run the realtime adapter test**

```bash
npx vitest run src/__tests__/integration/realtime-adapter.test.ts
```

Expected: all 3 tests PASS (in case Task 4 failed due to publication not being set).

- [ ] **Step 7: Commit**

```bash
git add drizzle/0005_realtime_publication.sql drizzle/meta/_journal.json
git commit -m "feat(db): enable Supabase Realtime publication for event, stage_run, pipeline_run, issue_event"
```

---

### Task 6: Server-side Supabase client factory

**Files:**
- Create: `src/adapters/supabase/server-client.ts`

- [ ] **Step 1: Write the factory**

```typescript
/**
 * Server-side Supabase client factory.
 *
 * THIS IS THE ONLY FILE where @supabase/supabase-js is imported for
 * server-side use. src/core/orchestrator/main.ts and worker-main.ts
 * import this factory, not @supabase/* directly, to satisfy invariant 7.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function createServerSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL. Required for server-side Supabase client.',
    );
  }
  if (!key) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    );
  }
  return createClient(url, key);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/adapters/supabase/server-client.ts
git commit -m "feat(supabase): server-side client factory (invariant-7 boundary)"
```

---

## Phase 2 — Client-side realtime integration (Tasks 7-13)

### Task 7: RealtimeContextProvider + hook

**Files:**
- Create: `src/lib/realtime/context.tsx`
- Create: `src/lib/realtime/use-realtime.ts`

- [ ] **Step 1: context.tsx**

```tsx
'use client';
import { createContext, useMemo, type ReactNode } from 'react';
import { createClient as createBrowserSupabaseClient } from '@/lib/supabase/client';
import { createSupabaseRealtimeAdapter } from '@/adapters/supabase/realtime';
import type { RealtimeProvider } from '@/core/ports/realtime';

export const RealtimeContext = createContext<RealtimeProvider | null>(null);

export function RealtimeContextProvider({ children }: { children: ReactNode }) {
  // Adapter is constructed once per provider mount. The underlying Supabase
  // client is singleton per browser context. No WebSocket is opened until
  // the first subscribeToTable() call from a downstream component.
  const adapter = useMemo(() => {
    const client = createBrowserSupabaseClient();
    return createSupabaseRealtimeAdapter(client);
  }, []);

  return <RealtimeContext.Provider value={adapter}>{children}</RealtimeContext.Provider>;
}
```

- [ ] **Step 2: use-realtime.ts**

```typescript
'use client';
import { useContext } from 'react';
import { RealtimeContext } from './context';
import type { RealtimeProvider } from '@/core/ports/realtime';

export function useRealtime(): RealtimeProvider {
  const ctx = useContext(RealtimeContext);
  if (!ctx) {
    throw new Error(
      'useRealtime() called outside <RealtimeContextProvider>. Mount the provider at the App Router root.',
    );
  }
  return ctx;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/realtime/context.tsx src/lib/realtime/use-realtime.ts
git commit -m "feat(realtime): client-side context and useRealtime hook"
```

---

### Task 8: useNow hook

**Files:**
- Create: `src/lib/realtime/use-now.ts`

- [ ] **Step 1: Write the hook**

```typescript
'use client';
import { useEffect, useState } from 'react';

export function useNow({
  intervalMs = 1000,
  enabled = true,
}: { intervalMs?: number; enabled?: boolean } = {}): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/realtime/use-now.ts
git commit -m "feat(realtime): useNow hook for live-duration re-renders"
```

---

### Task 9: Mount RealtimeContextProvider inside project-scoped layout

**NOT the root layout.** `src/app/layout.tsx` is a pure Server Component (exports `metadata`). The tRPC client provider lives at `src/app/[org]/[user]/[project]/layout.tsx` — a Client Component wrapper (`TRPCProvider`). `RealtimeContextProvider` must be mounted there, inside `TRPCProvider`, so (a) both providers are in a client-component boundary, and (b) realtime is scoped to authenticated project pages (pages outside that tree don't need it).

**Files:**
- Modify: `src/app/[org]/[user]/[project]/layout.tsx`

- [ ] **Step 1: Read current project-scoped layout**

```bash
cat "src/app/[org]/[user]/[project]/layout.tsx"
```

Expected shape (pre-edit):

```tsx
import { TRPCProvider } from '@/lib/trpc/provider';
// ... other imports ...

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <TRPCProvider>
      {/* ... existing children render ... */}
      {children}
      {/* ... */}
    </TRPCProvider>
  );
}
```

- [ ] **Step 2: Add the RealtimeContextProvider import and wrap children**

Add:

```typescript
import { RealtimeContextProvider } from '@/lib/realtime/context';
```

Wrap `{children}` INSIDE `TRPCProvider`:

```tsx
<TRPCProvider>
  <RealtimeContextProvider>
    {children}
  </RealtimeContextProvider>
</TRPCProvider>
```

If there are other client-side wrappers between `TRPCProvider` and `{children}` (theme, layout chrome, etc.), place `RealtimeContextProvider` immediately wrapping `{children}` — its position doesn't matter for correctness, as long as it's somewhere between `TRPCProvider` and `{children}`.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit 2>&1 | grep "\[org\]/\[user\]/\[project\]/layout.tsx" | head -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[org]/[user]/[project]/layout.tsx"
git commit -m "feat(realtime): mount RealtimeContextProvider inside TRPCProvider at project-scoped layout"
```

---

### Task 10: LiveOutput — port migration + stream append + testid

**Files:**
- Modify: `src/components/pipeline/LiveOutput.tsx`

- [ ] **Step 1: Read current file**

```bash
cat src/components/pipeline/LiveOutput.tsx
```

Note the existing block at lines ~128-152 uses `createClient()` + `supabase.channel()` + `eventsQuery.refetch()`.

- [ ] **Step 2: Remove Supabase import, add realtime imports**

Remove:
```typescript
import { createClient } from '@/lib/supabase/client';
```

Add:
```typescript
import { useRealtime } from '@/lib/realtime/use-realtime';
// Value import — `event` is a Drizzle table constant, not a type.
// We use it as `typeof event.$inferSelect` below; `import type` would erase it.
import { event } from '@/core/db/schema';
```

- [ ] **Step 3: Replace subscription block**

Locate the `useEffect` with the Supabase channel. Replace ENTIRE body of that hook with:

```typescript
const realtime = useRealtime();
const utils = trpc.useUtils();

useEffect(() => {
  if (!isActive || !stageRunId) return;

  const unsubscribe = realtime.subscribeToTable<typeof event.$inferSelect>(
    `live-output-${stageRunId}`,
    'event',
    'INSERT',
    (payload) => {
      const row = payload.new;
      utils.pipeline.runs.events.setData(
        { stageRunId },
        (old) => (old ? [...old, row] : [row]),
      );
    },
    `stage_run_id=eq.${stageRunId}`,
  );
  return unsubscribe;
}, [stageRunId, isActive, realtime, utils]);
```

(Move `const realtime = useRealtime(); const utils = trpc.useUtils();` to live alongside other hook calls at the top of the component body.)

- [ ] **Step 4: Add data-testid to the output pane**

Find the output `<div>` (around line 249 per v1 plan):

```tsx
<div
  ref={containerRef}
  onScroll={handleScroll}
  data-testid="live-output-pane"
  className="font-mono text-xs rounded-lg p-4 h-96 overflow-y-auto bg-slate-950 text-slate-300 border border-slate-700/40"
>
```

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep "LiveOutput"
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/pipeline/LiveOutput.tsx
git commit -m "feat(live-output): route Realtime through useRealtime; stream via setData append; add testid"
```

---

### Task 11: RunDetailModal — port migration + useNow duration tick

**Files:**
- Modify: `src/components/pipeline/RunDetailModal.tsx`

- [ ] **Step 1: Read current file**

- [ ] **Step 2: Swap imports**

Remove:
```typescript
import { createClient } from '@/lib/supabase/client';
```

Add:
```typescript
import { useRealtime } from '@/lib/realtime/use-realtime';
import { useNow } from '@/lib/realtime/use-now';
// Value import — `stageRun` is a Drizzle table constant, not a type.
import { stageRun } from '@/core/db/schema';
```

- [ ] **Step 3: Replace subscription block**

Replace the existing `useEffect` that builds `supabase.channel(...).on('postgres_changes', ...)` with:

```typescript
const realtime = useRealtime();
const utils = trpc.useUtils();

useEffect(() => {
  if (!isOpen || !runId) return;

  const unsubscribe = realtime.subscribeToTable<typeof stageRun.$inferSelect>(
    `run-detail-${runId}`,
    'stage_run',
    'UPDATE',
    (payload) => {
      const updated = payload.new;
      utils.pipeline.runs.get.setData({ id: runId }, (old) => {
        if (!old) return old;
        return {
          ...old,
          stageRuns: old.stageRuns.map((sr) =>
            sr.id === updated.id ? { ...sr, ...updated } : sr,
          ),
        };
      });
    },
    `pipeline_run_id=eq.${runId}`,
  );
  return unsubscribe;
}, [runId, isOpen, realtime, utils]);
```

- [ ] **Step 4: Add duration tick**

Near the existing state:

```typescript
const now = useNow({ enabled: isRunActive });
```

Update the "Duration" `MetaRow` value:

```tsx
<MetaRow
  label="Duration"
  value={
    detail.startedAt
      ? formatDuration(
          detail.completedAt
            ? (new Date(detail.completedAt).getTime() - new Date(detail.startedAt).getTime()) / 1000
            : (now.getTime() - new Date(detail.startedAt).getTime()) / 1000,
        )
      : null
  }
/>
```

Update `timelineStages` memo to include `now` in deps:

```typescript
const timelineStages = useMemo(() => {
  return stageRuns.map((sr) => {
    const durationSec = sr.startedAt
      ? sr.completedAt
        ? (new Date(sr.completedAt).getTime() - new Date(sr.startedAt).getTime()) / 1000
        : (now.getTime() - new Date(sr.startedAt).getTime()) / 1000
      : null;
    return { id: sr.id, name: sr.pipelineStage?.name ?? 'Unknown', status: sr.status, attempt: sr.attempt ?? 1, durationSec };
  });
}, [stageRuns, now]);
```

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit 2>&1 | grep "RunDetailModal"
git add src/components/pipeline/RunDetailModal.tsx
git commit -m "feat(run-detail): route Realtime through port; add useNow duration tick"
```

---

### Task 12: Issue activity feed — add subscription + testid

**Files:**
- Modify: `src/app/[org]/[user]/[project]/issues/[number]/client.tsx`

- [ ] **Step 1: Read the file**

```bash
head -350 "src/app/[org]/[user]/[project]/issues/[number]/client.tsx"
grep -n "activity-item\|eventsQuery\|events\.map" "src/app/[org]/[user]/[project]/issues/[number]/client.tsx" | head -10
```

- [ ] **Step 2: Add imports**

```typescript
import { useEffect } from 'react';  // if not already imported
import { useRealtime } from '@/lib/realtime/use-realtime';
// Value import — `issueEvent` is a Drizzle table constant, not a type.
import { issueEvent } from '@/core/db/schema';
```

- [ ] **Step 3: Add subscription after eventsQuery**

```typescript
const realtime = useRealtime();
const utils = trpc.useUtils();

useEffect(() => {
  if (!issue?.id) return;

  const currentFilterArg = eventFilter === 'all' ? undefined : eventFilter;
  const unsubscribe = realtime.subscribeToTable<typeof issueEvent.$inferSelect>(
    `issue-events-${issue.id}`,
    'issue_event',
    'INSERT',
    (payload) => {
      const row = payload.new;
      utils.issue.event.list.setData(
        { issueId: issue.id, filter: currentFilterArg },
        (old) => (old ? [row, ...old] : [row]),
      );
    },
    `issue_id=eq.${issue.id}`,
  );
  return unsubscribe;
}, [issue?.id, realtime, utils, eventFilter]);
```

- [ ] **Step 4: Add data-testid to activity items**

Find the `events.map(...)` rendering around line 720. Wrap each rendered event in an element with `data-testid="activity-item"`:

```tsx
{events.map((event) => (
  <div key={event.id} data-testid="activity-item">
    {/* existing renderer */}
  </div>
))}
```

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit 2>&1 | grep "issues/\[number\]/client"
git add "src/app/[org]/[user]/[project]/issues/[number]/client.tsx"
git commit -m "feat(issue-detail): subscribe to issue_event INSERTs; add activity-item testid"
```

---

### Task 13: GateResultsPanel — fix rule-field access

**Files:**
- Modify: `src/components/pipeline/GateResultsPanel.tsx`

**Verified data shape (v3 update):** the stored `ruleResults` JSON is an array of `RuleResult` — see `src/core/gates/types.ts:87`: `{ rule: Rule, passed: boolean, ... }`. The `Rule` object carries `field`, `operator`, `value`, `expected`, `label`. So a result row at `ruleResults[i]` has shape `{ rule: { field, operator, value, label }, passed, actual, ... }`. The current component (lines 30-37) declares a flat type `{ field?, operator?, expected?, passed?, label? }` and reads `rule.field` / `rule.operator` / `rule.expected` — this is BROKEN because it reads from the `RuleResult`, not its nested `rule`. That's why the dots render empty in prod. The fix: update both the TypeScript cast AND the accessors.

- [ ] **Step 1: Read the current file**

```bash
cat src/components/pipeline/GateResultsPanel.tsx
```

Note the cast at line 30-37 and the accessors at lines 62-66.

- [ ] **Step 2: Update the TypeScript cast**

Replace the flat cast:

```typescript
const ruleResults = (g.ruleResults ?? []) as Array<{
  field?: string;
  operator?: string;
  expected?: unknown;
  actual?: unknown;
  passed?: boolean;
  label?: string;
}>;
```

with the nested cast matching the actual RuleResult shape:

```typescript
const ruleResults = (g.ruleResults ?? []) as Array<{
  rule: {
    field?: string;
    operator?: string;
    value?: unknown;
    label?: string;
  };
  passed?: boolean;
  actual?: unknown;
}>;
```

- [ ] **Step 3: Update accessors at lines ~62-66**

Change:

```tsx
<span className="font-mono">
  {rule.field} {rule.operator} {String(rule.expected ?? '')}
</span>
{rule.label && (
  <span className="text-slate-500">&mdash; {rule.label}</span>
)}
```

to:

```tsx
<span className="font-mono">
  {rule.rule.field} {rule.rule.operator} {String(rule.rule.value ?? '')}
</span>
{rule.rule.label && (
  <span className="text-slate-500">&mdash; {rule.rule.label}</span>
)}
```

Note: the original code used `expected` but the `Rule` type has `value`. Use `value`.

- [ ] **Step 4: Visual verification**

Trigger a pipeline run that produces gate results (seed includes a gate). Open run detail modal → Gates tab → confirm each rule row shows `field operator value` text with optional label, instead of empty dots.

- [ ] **Step 5: Commit**

```bash
git add src/components/pipeline/GateResultsPanel.tsx
git commit -m "fix(gate-results): read rule.field/operator/value from nested RuleResult shape"
```

---

## Phase 3 — Orchestrator service rewiring (Tasks 14-22)

### Task 14: Refine StageJobPayload

**Files:**
- Modify: `src/core/orchestrator/types.ts`

- [ ] **Step 1: Read types.ts, find StageJobPayload**

- [ ] **Step 2: Reduce to minimal shape**

```typescript
/** Job data enqueued onto BullMQ for stage execution. Worker loads the rest from DB. */
export interface StageJobPayload {
  stageRunId: string;
  attempt: number;
}
```

Delete old fields. Typecheck will surface breakages; these are fixed in Tasks 15–16.

- [ ] **Step 3: Commit**

```bash
git add src/core/orchestrator/types.ts
git commit -m "refactor(orchestrator): StageJobPayload reduced to { stageRunId, attempt }"
```

---

### Task 15: Add service helpers for orchestrator's new needs

**Files:**
- Modify: `src/core/orchestrator/pipeline-run-service.ts`

**v3 design note:** Idempotency for gate-evaluation is enforced by a partial unique index on `event(stage_run_id) WHERE type = 'gate_checked'` (added by the migration in Task 5). `hasGateBeenEvaluated` is a cheap pre-flight check; the index is the real atomicity guarantee. `handleStageTerminalStatus` (Task 17) wraps the `appendEvent(gate_checked, ...)` in try/catch — on unique-violation, treat as "already handled" and return cleanly.

- [ ] **Step 1: Read current service**

```bash
grep -n "^export\|^  async function\|^  function\|return {" src/core/orchestrator/pipeline-run-service.ts | head -40
grep -n "^import" src/core/orchestrator/pipeline-run-service.ts | head -10
```

Note the existing Drizzle imports — likely `{ eq, and, asc, sql }`. You will need to add `or`.

- [ ] **Step 2: Add `or` to the Drizzle import**

Edit the existing import line:

```typescript
import { eq, and, or, asc, sql } from 'drizzle-orm';
```

(Keep whatever else is in the existing list — just add `or`.)

- [ ] **Step 3: Add four helper methods**

Add the following methods (adapt to the service's factory style — see existing methods like `getRun`, `appendEvent` for the pattern):

```typescript
// Returns a single stage_run row by id, or null.
async function getStageRun(id: string) {
  const [row] = await db.select().from(stageRun).where(eq(stageRun.id, id));
  return row ?? null;
}

// Returns all stage_runs that look in-flight for reconciliation.
async function getInFlightStageRuns() {
  return db.select().from(stageRun).where(
    or(
      eq(stageRun.status, STAGE_RUN_STATUS.running),
      eq(stageRun.status, STAGE_RUN_STATUS.launching),
    ),
  );
}

// Returns a single pipeline_stage row by id, or null.
async function getStage(stageId: string) {
  const [row] = await db.select().from(pipelineStage).where(eq(pipelineStage.id, stageId));
  return row ?? null;
}

// Cheap pre-flight check — is there already a gate_checked event for this
// stage_run? Used by handleStageTerminalStatus to avoid an unnecessary gate
// evaluation + insert round-trip. The REAL idempotency guarantee is the
// partial unique index on event(stage_run_id) WHERE type='gate_checked'
// (see migration 0005). The insert will throw on race; the caller must
// handle that in try/catch.
async function hasGateBeenEvaluated(stageRunId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: event.id })
    .from(event)
    .where(and(eq(event.stageRunId, stageRunId), eq(event.type, EVENT_TYPE.gate_checked)))
    .limit(1);
  return !!row;
}
```

- [ ] **Step 4: Export new methods**

Add to the returned service object:

```typescript
return {
  // ... existing ...
  getStageRun,
  getInFlightStageRuns,
  getStage,
  hasGateBeenEvaluated,
};
```

Update the exported `PipelineRunService` type to include the new method signatures.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit 2>&1 | grep "pipeline-run-service"
git add src/core/orchestrator/pipeline-run-service.ts
git commit -m "feat(pipeline-run-service): add getStageRun, getInFlightStageRuns, getStage, hasGateBeenEvaluated"
```

---

### Task 16: Rewrite stage-worker to call executeStageRun

**Files:**
- Modify: `src/core/orchestrator/stage-worker.ts`

- [ ] **Step 1: Read current file**

- [ ] **Step 2: Rewrite handler — delete duplicated buildCommand + inline execution**

Use Edit to replace the file contents:

```typescript
/**
 * Stage Worker — BullMQ job handler. Thin bridge to executeStageRun.
 *
 * Invoked by worker-main.ts via queue.process('stage-runs', handler).
 */
import type { Job } from '@/core/ports/queue';
import type { StageExecutor } from '@/core/ports/stage-executor';
import type { Database } from '@/core/db/connection';
import { createPipelineRunService } from './pipeline-run-service';
import { executeStageRun } from './stage-runner';
import { TRIGGER_TYPE } from '@/core/constants';
import type { StageJobPayload } from './types';

export interface StageWorkerDeps {
  db: Database;
  executor: StageExecutor;
}

export function createStageJobHandler(deps: StageWorkerDeps) {
  const { db, executor } = deps;
  const runService = createPipelineRunService(db);

  return async function handleStageJob(job: Job<StageJobPayload>): Promise<void> {
    const { stageRunId } = job.data;
    const stageRun = await runService.getStageRun(stageRunId);
    if (!stageRun) {
      throw new Error(`stage_run ${stageRunId} not found when processing job`);
    }
    await executeStageRun({
      db,
      executor,
      runService,
      runId: stageRun.pipelineRunId,
      stageRunId,
      trigger: TRIGGER_TYPE.automated,
    });
  };
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep "stage-worker" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add src/core/orchestrator/stage-worker.ts
git commit -m "refactor(stage-worker): call executeStageRun; remove duplicated execution logic"
```

---

### Task 16b: Add re-entry guard to executeStageRun (v3 CRITICAL)

**Files:**
- Modify: `src/core/orchestrator/stage-runner.ts`

**Why:** BullMQ with `attempts: 3` may redeliver the same stageRunId on worker crash. Today `executeStageRun` has no guard — it re-marks the row `running`, re-materializes workspace, re-spawns subprocess. This produces duplicate `launched`/`completed` events and corrupts audit trail on any redelivery.

Fix: at the top of `executeStageRun`, after loading `sRun`, check status. If not `queued` or `launching`, return a zero-duration empty result and log.

- [ ] **Step 1: Read current stage-runner**

```bash
grep -n "const \[sRun\]\|stageRun.status\|STAGE_RUN_STATUS" src/core/orchestrator/stage-runner.ts | head -10
```

Current loading block is at lines ~90-94 (per earlier exploration).

- [ ] **Step 2: Add the guard**

Immediately after the `const [sRun] = ...; if (!sRun) throw ...` block at line ~90-94, insert:

```typescript
// v3 re-entry guard. BullMQ redelivery (attempts: 3) can invoke executeStageRun
// multiple times on the same stageRunId. Only fresh jobs (queued/launching)
// may proceed; anything else is a stale redelivery — return cleanly as no-op.
if (
  sRun.status !== STAGE_RUN_STATUS.queued &&
  sRun.status !== STAGE_RUN_STATUS.launching
) {
  console.log(
    `[stage-runner] skipping stale redelivery for ${stageRunId} (status=${sRun.status})`,
  );
  return {
    exitCode: 0,
    durationMs: 0,
    stageName: '',
    driverName: '',
    providerName: null,
    modelIdentifier: null,
    issueId: null,
    stageId: sRun.pipelineStageId,
    skillSignal: null,
    skillSignalReason: null,
    skillMetadata: null,
  };
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep "stage-runner" | head -10
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/core/orchestrator/stage-runner.ts
git commit -m "feat(stage-runner): re-entry guard for BullMQ redelivery (v3 crash-safety)"
```

---

### Task 17: Wire BullMQ dispatch into event-orchestrator + add terminal-status subscription

**Files:**
- Modify: `src/core/orchestrator/event-orchestrator.ts`

This is the heaviest task. Do it in small edits, testing after each.

- [ ] **Step 1: Add `queue` constructor param**

```typescript
import type { QueueProvider } from '@/core/ports/queue';
import type { StageJobPayload } from './types';

export function createEventOrchestrator(
  db: Database,
  executor: StageExecutor,
  realtime: RealtimeProvider,
  queue: QueueProvider,
  config: Partial<EventOrchestratorConfig> = {},
): EventOrchestrator {
```

(`executor` is retained in the signature. Currently used by `launchStage` for fallback paths that will be removed. Check Task 18 to see if it can drop out entirely.)

- [ ] **Step 2: Replace in-process execution in `launchStage`**

Find the block around line 180:

```typescript
try {
  const result = await executeStageRun({ db, executor, runService, runId: run.id, stageRunId: sRun.id, trigger: TRIGGER_TYPE.automated });
  // ... gate eval ... applyVerdict ...
}
```

Replace with:

```typescript
// Enqueue — worker consumes and runs executeStageRun.
// Terminal-state handling triggered by Realtime UPDATE on stage_run (see handleStageTerminalStatus below).
await queue.enqueue<StageJobPayload>(
  'stage-runs',
  sRun.id,
  { stageRunId: sRun.id, attempt: attemptsForStage + 1 },
  {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
);
```

- [ ] **Step 3: Add third Realtime subscription for stage_run UPDATE**

In `start()`:

```typescript
let unsubscribeStageCompletion: Unsubscribe | null = null;
// ... (after existing subscriptions)

unsubscribeStageCompletion = realtime.subscribeToTable(
  'orchestrator-stage-completed',
  'stage_run',
  'UPDATE',
  (payload) => {
    const row = payload.new as typeof stageRun.$inferSelect;
    if (
      row.status === STAGE_RUN_STATUS.completed ||
      row.status === STAGE_RUN_STATUS.failed ||
      row.status === STAGE_RUN_STATUS.timed_out
    ) {
      handleStageTerminalStatus(row).catch(logError('handleStageTerminalStatus'));
    }
  },
);
```

Clean up in `stop()`:

```typescript
unsubscribeStageCompletion?.();
unsubscribeStageCompletion = null;
```

- [ ] **Step 4: Implement handleStageTerminalStatus with two-layer idempotency guard**

**v3 update:** cross-instance safety is enforced by the partial unique index on `event(stage_run_id) WHERE type='gate_checked'` (added in Task 5 migration). `hasGateBeenEvaluated` is a CHEAP pre-flight; the index is the atomicity guarantee. The `appendEvent(gate_checked, ...)` INSERT is wrapped in try/catch — unique-violation means another instance won the race, so return cleanly.

```typescript
async function handleStageTerminalStatus(
  sr: typeof stageRun.$inferSelect,
): Promise<void> {
  // Layer 1: cheap pre-flight. Avoid gate eval if already done.
  if (await runService.hasGateBeenEvaluated(sr.id)) return;

  // Cancelled stages do not advance.
  if (sr.status === STAGE_RUN_STATUS.cancelled) return;

  const stage = await runService.getStage(sr.pipelineStageId);
  const run = await runService.getRun(sr.pipelineRunId);
  if (!stage || !run) return;

  if (sr.status === STAGE_RUN_STATUS.completed) {
    // Gate evaluation (safe to call multiple times — evaluateStageGate is a pure
    // read of current DB state + writes a stage_gate_result row. The race is
    // specifically around the 'gate_checked' event insert below.)
    const gateResult = await gateService.evaluateStageGate(stage.id, sr.id, {
      exit_code: sr.exitCode ?? 0,
      cost_usd: Number(sr.costUsd ?? 0),
      tokens_in: sr.tokensIn ?? 0,
      tokens_out: sr.tokensOut ?? 0,
      provider: sr.provider ?? '',
      model: sr.model ?? '',
      driver: sr.driver ?? '',
      skill_signal: sr.skillSignal ?? null,
    });

    // Layer 2: atomic claim. Partial unique index on event(stage_run_id)
    // WHERE type='gate_checked' enforces exactly-once. Unique-violation means
    // another instance beat us to it — return cleanly without applying verdict.
    try {
      await runService.appendEvent(sr.id, EVENT_TYPE.gate_checked, {
        verdict: gateResult.verdict,
        passed: gateResult.passed,
        reason: gateResult.reason,
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        // Postgres unique_violation. Another instance handled this stage.
        console.log(`[orchestrator] stage_run ${sr.id}: terminal-handling claimed elsewhere`);
        return;
      }
      throw err;
    }

    // If we got here, this instance won the claim. Proceed to verdict.
    const skillSignalReason = await getSkillSignalReason(sr.id);
    const effectiveVerdict = sr.skillSignal ?? gateResult.verdict;
    await applyVerdict(
      run,
      stage,
      sr,
      effectiveVerdict,
      skillSignalReason,
      sr.skillMetadata as Record<string, unknown> | undefined,
    );
  } else {
    // failed / timed_out → retry budget check via existing handleStageFailed.
    // Note: handleStageFailed also needs idempotency. For v3 R-UI-2 we rely on
    // the same pre-flight + the fact that handleStageFailed's primary write is
    // a new stage_run creation (which is not idempotent, but the hasGateBeenEvaluated
    // check at the top of this function provides the same guard because a
    // failed stage_run reaching handleStageFailed also writes a 'gate_checked'
    // event via this path's first run).
    //
    // If handleStageFailed does NOT write a gate_checked event, add a manual
    // idempotency write here: appendEvent(sr.id, EVENT_TYPE.gate_checked, ...)
    // with a synthetic payload indicating "failure — retry logic only."
    try {
      await runService.appendEvent(sr.id, EVENT_TYPE.gate_checked, {
        verdict: 'failed-path',
        passed: false,
        reason: `stage ${sr.status}`,
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') return;
      throw err;
    }

    await handleStageFailed(run, stage, sr);
  }
}

// Helper — read skillSignalReason from the most recent event payload.
// (Alternative: accept that it's undefined under this path — most gates don't use it.)
async function getSkillSignalReason(stageRunId: string): Promise<string | undefined> {
  const [evt] = await db
    .select()
    .from(event)
    .where(and(eq(event.stageRunId, stageRunId), eq(event.type, EVENT_TYPE.completed)))
    .orderBy(desc(event.createdAt))
    .limit(1);
  const payload = evt?.payload as { summary?: string } | undefined;
  return payload?.summary;
}
```

Import `desc` from `drizzle-orm` and add `event` to the schema imports if missing.

- [ ] **Step 5: Remove the old synchronous gate-evaluation code from `launchStage`**

The old `launchStage` called gate eval + `applyVerdict` immediately after `executeStageRun`. Now the BullMQ worker does `executeStageRun`, the stage_run status transitions via DB write, Realtime UPDATE triggers `handleStageTerminalStatus`, which does gate eval + `applyVerdict`. Delete the old inline logic.

Also delete the `try { ... } catch { handleStageFailed(...) }` block around the old `executeStageRun` call — the worker catches and the UPDATE subscription handles it.

- [ ] **Step 6: Typecheck (iterate until clean)**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 7: Commit**

```bash
git add src/core/orchestrator/event-orchestrator.ts
git commit -m "feat(orchestrator): enqueue via BullMQ; handle stage completion via Realtime + idempotency guard"
```

---

### Task 18: REPLACE recoverOnStartup per spec D1

**Files:**
- Modify: `src/core/orchestrator/event-orchestrator.ts`

- [ ] **Step 1: Delete the current recoverOnStartup body**

It's at lines 345-391 per earlier exploration. Current logic calls `runService.completeStageRun(...)` + `launchStage(...)`. Delete ENTIRE body.

- [ ] **Step 2: Implement the new algorithm**

```typescript
async function recoverOnStartup(): Promise<void> {
  console.log('[orchestrator] recoverOnStartup: scanning in-flight stage_runs');
  const inFlight = await runService.getInFlightStageRuns();

  for (const sr of inFlight) {
    // (a) BullMQ has an active/waiting/delayed job? Leave it alone.
    const job = await queue.getJob('stage-runs', sr.id);
    if (job && (job.status === 'active' || job.status === 'waiting' || job.status === 'delayed')) {
      console.log(`[orchestrator] stage_run ${sr.id}: BullMQ job ${job.status}; leaving`);
      continue;
    }

    // (b/c) No live job. Determine subprocess state.
    const pid = sr.pid;
    let subprocessAlive = false;
    if (pid && pid > 0) {
      try {
        process.kill(pid, 0);
        subprocessAlive = true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EPERM') subprocessAlive = true;
      }
    }

    if (subprocessAlive) {
      // (c) Orphaned subprocess. Mark failed, no re-attach.
      console.log(`[orchestrator] stage_run ${sr.id}: orphaned subprocess pid=${pid}, marking failed`);
      await runService.completeStageRun(sr.id, STAGE_RUN_STATUS.failed, {});
      await runService.appendEvent(sr.id, EVENT_TYPE.error, {
        reason: 'orphaned_subprocess',
        pid,
      });
      continue;
    }

    // (b) Dead subprocess, no job. Check retry budget.
    const stage = await runService.getStage(sr.pipelineStageId);
    const maxRetries = stage?.maxRetries ?? 0;
    const attempt = sr.attempt ?? 1;

    if (attempt < maxRetries + 1) {
      // v3 fix: use a fresh jobId to avoid BullMQ deduplication against the
      // prior (now in failed set) job with id=sr.id. BullMQ's Queue.add()
      // treats jobId as a dedup key — re-adding the same jobId is silently
      // rejected if the job exists in ANY state, including the failed set.
      // A recovery-scoped jobId guarantees a brand-new entry is created.
      const recoveryJobId = `${sr.id}-recovery-${Date.now()}`;
      console.log(`[orchestrator] stage_run ${sr.id}: requeuing as ${recoveryJobId} (attempt ${attempt + 1})`);
      await queue.enqueue<StageJobPayload>(
        'stage-runs',
        recoveryJobId,
        { stageRunId: sr.id, attempt: attempt + 1 },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
      // Bump stage_run.attempt on the row so downstream observers see the new count.
      await db
        .update(stageRun)
        .set({ attempt: attempt + 1, updatedAt: new Date() })
        .where(eq(stageRun.id, sr.id));
    } else {
      console.log(`[orchestrator] stage_run ${sr.id}: retry budget exhausted`);
      await runService.completeStageRun(sr.id, STAGE_RUN_STATUS.failed, {});
      await runService.appendEvent(sr.id, EVENT_TYPE.error, {
        reason: 'retry_budget_exhausted',
        attempt,
        maxRetries,
      });
    }
  }
}
```

- [ ] **Step 3: Keep the `isProcessAlive` helper** (reused above via inline `process.kill`).

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit 2>&1 | grep "event-orchestrator"
git add src/core/orchestrator/event-orchestrator.ts
git commit -m "feat(orchestrator): REPLACE recoverOnStartup with BullMQ-aware algorithm (3-branch)"
```

---

### Task 19: Orchestrator entrypoint — src/core/orchestrator/main.ts

**Files:**
- Create: `src/core/orchestrator/main.ts`

- [ ] **Step 1: Verify registry API**

```bash
cat src/config/bootstrap.ts src/config/registry.ts | head -80
```

Confirm:
- Import is `import { bootstrap } from '@/config/bootstrap'; import { registry } from '@/config/registry';`
- Registered keys: `'database'`, `'auth'`, `'queue'`, `'executor'` (NOT `'stageExecutor'`).
- `bootstrap()` is idempotent and must be called before `registry.get()`.

- [ ] **Step 2: Write the entrypoint — zero direct vendor imports**

```typescript
/**
 * Orchestrator systemd entrypoint.
 *
 * Runs as a long-lived Node.js process under fluxaos-orchestrator.service.
 * Subscribes to Realtime. Enqueues stage jobs. Does NOT spawn subprocesses.
 *
 * Invariant 7: No direct vendor imports. Supabase client construction lives
 * in @/adapters/supabase/server-client. Realtime adapter factory lives in
 * @/adapters/supabase/realtime. DB / executor / queue come through the
 * registry from @/config/bootstrap.
 */
import 'dotenv/config';
import { bootstrap } from '@/config/bootstrap';
import { registry } from '@/config/registry';
import { getDatabase } from '@/core/db/connection';
import { createEventOrchestrator } from './event-orchestrator';
import { createSupabaseRealtimeAdapter } from '@/adapters/supabase/realtime';
import { createServerSupabaseClient } from '@/adapters/supabase/server-client';
import type { StageExecutor } from '@/core/ports/stage-executor';
import type { QueueProvider } from '@/core/ports/queue';

async function main() {
  bootstrap();

  const db = getDatabase();
  const executor = registry.get<StageExecutor>('executor');
  const queue = registry.get<QueueProvider>('queue');
  const realtime = createSupabaseRealtimeAdapter(createServerSupabaseClient());

  const orchestrator = createEventOrchestrator(db, executor, realtime, queue);

  console.log('[orchestrator] recovering in-flight runs...');
  await orchestrator.recoverOnStartup();

  console.log('[orchestrator] starting subscriptions...');
  orchestrator.start();

  console.log('[orchestrator] ready');

  const shutdown = (signal: string) => {
    console.log(`[orchestrator] received ${signal}, stopping`);
    orchestrator.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[orchestrator] fatal', err);
  process.exit(1);
});
```

- [ ] **Step 3: Verify adapter-boundary compliance**

```bash
grep -n "from '@supabase/" src/core/orchestrator/main.ts
```

Expected: zero matches.

- [ ] **Step 4: Smoke test**

```bash
npx tsx src/core/orchestrator/main.ts &
PID=$!
sleep 5
# Expected logs: "recovering", "starting subscriptions", "ready"
kill -TERM $PID
wait $PID
# Expected: "received SIGTERM, stopping"
```

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator/main.ts
git commit -m "feat(orchestrator): systemd entrypoint (main.ts) — invariant-7 compliant"
```

---

### Task 20: Stage-worker entrypoint — worker-main.ts

**Files:**
- Create: `src/core/orchestrator/worker-main.ts`

- [ ] **Step 1: Write the entrypoint**

```typescript
/**
 * Stage-worker systemd entrypoint.
 *
 * Runs as fluxaos-stage-worker.service. Consumes BullMQ 'stage-runs' jobs
 * and delegates to executeStageRun.
 */
import 'dotenv/config';
import { bootstrap } from '@/config/bootstrap';
import { registry } from '@/config/registry';
import { getDatabase } from '@/core/db/connection';
import { createStageJobHandler } from './stage-worker';
import type { StageJobPayload } from './types';
import type { StageExecutor } from '@/core/ports/stage-executor';
import type { QueueProvider } from '@/core/ports/queue';

async function main() {
  bootstrap();

  const db = getDatabase();
  const executor = registry.get<StageExecutor>('executor');
  const queue = registry.get<QueueProvider>('queue');

  const handler = createStageJobHandler({ db, executor });
  const worker = queue.process<StageJobPayload>('stage-runs', handler);

  console.log('[stage-worker] consuming stage-runs');

  const shutdown = async (signal: string) => {
    console.log(`[stage-worker] received ${signal}, closing`);
    await worker.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[stage-worker] fatal', err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify adapter-boundary**

```bash
grep -n "from '@supabase/\|from 'bullmq\|from 'ioredis" src/core/orchestrator/worker-main.ts
```

Expected: zero matches.

- [ ] **Step 3: Smoke test**

```bash
npx tsx src/core/orchestrator/worker-main.ts &
PID=$!
sleep 3
kill -TERM $PID
wait $PID
```

- [ ] **Step 4: Commit**

```bash
git add src/core/orchestrator/worker-main.ts
git commit -m "feat(stage-worker): systemd entrypoint (worker-main.ts)"
```

---

### Task 21: Systemd unit templates

**Files:**
- Create: `scripts/systemd/fluxaos-orchestrator.service`
- Create: `scripts/systemd/fluxaos-stage-worker.service`

- [ ] **Step 1: Write orchestrator unit**

```ini
# scripts/systemd/fluxaos-orchestrator.service
[Unit]
Description=fluxaOS orchestrator
After=network.target

[Service]
Type=simple
WorkingDirectory=__FLUXAOS_REPO_PATH__
EnvironmentFile=__FLUXAOS_ENV_PATH__
ExecStart=/usr/bin/env npx tsx src/core/orchestrator/main.ts
Restart=always
RestartSec=2s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
```

- [ ] **Step 2: Write stage-worker unit**

```ini
# scripts/systemd/fluxaos-stage-worker.service
[Unit]
Description=fluxaOS stage worker
After=network.target fluxaos-orchestrator.service

[Service]
Type=simple
WorkingDirectory=__FLUXAOS_REPO_PATH__
EnvironmentFile=__FLUXAOS_ENV_PATH__
ExecStart=/usr/bin/env npx tsx src/core/orchestrator/worker-main.ts
Restart=always
RestartSec=2s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
```

Both unit files use `__FLUXAOS_REPO_PATH__` and `__FLUXAOS_ENV_PATH__` placeholders (substituted at install time). No `%h`, no `$HOME`, no `$USER`.

- [ ] **Step 3: Commit**

```bash
git add scripts/systemd/
git commit -m "feat(systemd): orchestrator + stage-worker unit templates (GTM-portable placeholders)"
```

---

### Task 22: Install script

**Files:**
- Create: `scripts/install-orchestrator.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_PATH="$(cd "$(dirname "$0")/.." && pwd)"
ENV_PATH="${FLUXAOS_ENV_PATH:-${REPO_PATH}/.env}"
# Install target parameterized via env var. Defaults to user-level systemd
# for dev; override with FLUXAOS_SYSTEMD_DIR=/etc/systemd/system for GTM.
# The $HOME reference here is install-time only; application code never
# touches $HOME (per D2 in the spec).
UNIT_DIR="${FLUXAOS_SYSTEMD_DIR:-${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user}"

mkdir -p "${UNIT_DIR}"

for unit in fluxaos-orchestrator.service fluxaos-stage-worker.service; do
  src="${REPO_PATH}/scripts/systemd/${unit}"
  dst="${UNIT_DIR}/${unit}"
  sed -e "s|__FLUXAOS_REPO_PATH__|${REPO_PATH}|g" \
      -e "s|__FLUXAOS_ENV_PATH__|${ENV_PATH}|g" \
      "${src}" > "${dst}"
  echo "Installed ${dst}"
done

systemctl --user daemon-reload
systemctl --user enable --now fluxaos-orchestrator.service fluxaos-stage-worker.service

echo
echo "Status:"
systemctl --user status fluxaos-orchestrator fluxaos-stage-worker --no-pager -n 0
echo
echo "Tail: journalctl --user -u fluxaos-orchestrator -f"
echo "Tail: journalctl --user -u fluxaos-stage-worker -f"
```

- [ ] **Step 2: Make executable, run, verify**

```bash
chmod +x scripts/install-orchestrator.sh
./scripts/install-orchestrator.sh
```

Expected: both services show `Active: active (running)`.

- [ ] **Step 3: Confirm logs**

```bash
journalctl --user -u fluxaos-orchestrator -n 20 --no-pager
journalctl --user -u fluxaos-stage-worker -n 20 --no-pager
```

- [ ] **Step 4: Commit**

```bash
git add scripts/install-orchestrator.sh
git commit -m "feat(systemd): install script — placeholder substitution, idempotent"
```

---

### Task 23: Docs — CLAUDE.md + session-quick-start

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/session-quick-start.md`

- [ ] **Step 1: Edit CLAUDE.md**

Add rows under Commands table:

```markdown
| `./scripts/install-orchestrator.sh` | Install + start fluxaos-orchestrator + fluxaos-stage-worker user-level systemd services |
| `systemctl --user status fluxaos-orchestrator fluxaos-stage-worker` | Check orchestrator + worker status |
| `journalctl --user -u fluxaos-orchestrator -f` | Tail orchestrator logs |
| `journalctl --user -u fluxaos-stage-worker -f` | Tail stage-worker logs |
```

Add a Workflow note:

```markdown
- **First-time setup:** `./scripts/install-orchestrator.sh` — installs two user-level systemd services. Required before pipelines run automatically.
- **Playwright tests that kill systemd services** (e.g., `@r-ui-2` journeys 25-26) require a shell with `DBUS_SESSION_BUS_ADDRESS` set. Launch Playwright from an interactive terminal on the homelab, or export `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus` before invoking `npx playwright test`.
```

- [ ] **Step 2: Edit session-quick-start.md**

Add section (see v1 plan Task 21 for shape).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/session-quick-start.md
git commit -m "docs: orchestrator + stage-worker install/ops commands; DBUS requirement for tests"
```

---

## Phase 4 — Playwright journeys (Tasks 24-28)

All journey commits assume `npm run dev` is already running. Task 24 Step 0 starts it.

### Task 24: Journey — live-output-streams

**Files:**
- Create: `e2e/live-output-streams.spec.ts`

- [ ] **Step 0: Ensure dev server is running**

```bash
# In a separate terminal (or background job):
npm run dev -- -H 192.168.54.101 -p 3003 &
DEV_PID=$!
sleep 10
# Sanity check:
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.54.101:3003/default/admin/fluxaos
# Expected: 200
```

**Dev-server lifecycle (v3 update):** Leave running for all of Phase 4 (journeys 24-28). **Kill before Phase 5 Task 29** — the vitest rewrite runs `nuke.ts && npm run db:seed`, which will drop rows the dev server's tRPC queries had cached. Kill the dev server BEFORE the nuke; if Phase 5 needs a re-run of any journey, restart the dev server manually at that point.

```bash
# After Phase 4 completes, before Phase 5 Task 29 starts:
kill $DEV_PID 2>/dev/null; wait $DEV_PID 2>/dev/null
```

- [ ] **Step 1: Write journey**

```typescript
import { test, expect } from './helpers/setup';

test.describe('@r-ui-2 LiveOutput streams incrementally', () => {
  test('new lines accumulate over time, not as a single batch', async ({ page }) => {
    await page.goto('/default/admin/fluxaos/issues/1');
    await page.getByRole('button', { name: /run stage/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const pane = page.locator('[data-testid="live-output-pane"]');
    await expect(pane).toBeVisible({ timeout: 10000 });

    // First snapshot
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="live-output-pane"]')?.childElementCount ?? 0) > 0,
      { timeout: 20000 },
    );
    const firstCount = await pane.locator('> div').count();

    // Wait for accumulation
    await page.waitForTimeout(3000);
    const secondCount = await pane.locator('> div').count();

    expect(secondCount).toBeGreaterThan(firstCount);
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test e2e/live-output-streams.spec.ts --reporter=list
git add e2e/live-output-streams.spec.ts
git commit -m "test(e2e): @r-ui-2 live-output-streams"
```

---

### Task 25: Journey — activity-feed-auto-refreshes

**Files:**
- Create: `e2e/activity-feed-auto-refreshes.spec.ts`

Follows v1 plan Task 23 pattern — two browser contexts, add comment in A, observe tab B's activity list grows without reload, using `[data-testid="activity-item"]` selector.

- [ ] **Step 1: Write journey** (per v1 Task 23 shape, unchanged)

- [ ] **Step 2: Run + commit**

```bash
git add e2e/activity-feed-auto-refreshes.spec.ts
git commit -m "test(e2e): @r-ui-2 activity-feed-auto-refreshes"
```

---

### Task 26: Journey — cancel-running-stage

**Files:**
- Create: `e2e/cancel-running-stage.spec.ts`

Standard Playwright — click Cancel during Running state, assert Cancelled terminal state. No systemctl needed.

- [ ] **Step 1: Write + run + commit** (per v1 plan Task 24)

---

### Task 27: Journey — orchestrator-recovers-after-restart

**Files:**
- Create: `e2e/orchestrator-recovers-after-restart.spec.ts`

**Uses systemctl. Must guard for DBUS availability.**

- [ ] **Step 1: Write the journey**

```typescript
import { test, expect } from './helpers/setup';
import { execSync } from 'node:child_process';

// Skip if systemd user session is not available (CI, non-interactive shell)
const hasSystemdUser = (() => {
  try {
    execSync('systemctl --user is-active fluxaos-orchestrator', { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

test.describe('@r-ui-2 orchestrator recovers after restart', () => {
  test.skip(!hasSystemdUser, 'systemctl --user unavailable — run from interactive shell on homelab');

  test('orphaned stage_run is failed with retry_budget_exhausted after orchestrator restart', async ({ page }) => {
    await page.goto('/default/admin/fluxaos/issues/1');
    await page.getByRole('button', { name: /run stage/i }).click();
    await expect(page.getByText(/running/i)).toBeVisible({ timeout: 15000 });

    // Stop worker to orphan the stage from BullMQ's perspective, then restart orchestrator
    execSync('systemctl --user stop fluxaos-stage-worker');
    execSync('systemctl --user restart fluxaos-orchestrator');

    // Terminal state appears within 15s
    await expect(async () => {
      const text = await page.textContent('body');
      expect(text).toMatch(/Failed|Completed|Cancelled/);
    }).toPass({ timeout: 15000 });

    // Restore worker
    execSync('systemctl --user start fluxaos-stage-worker');
  });
});
```

- [ ] **Step 2: Run (from interactive shell) + commit**

```bash
# Must run from interactive terminal (DBUS_SESSION_BUS_ADDRESS must be set)
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test e2e/orchestrator-recovers-after-restart.spec.ts --reporter=list
git add e2e/orchestrator-recovers-after-restart.spec.ts
git commit -m "test(e2e): @r-ui-2 orchestrator-recovers-after-restart (systemctl-gated)"
```

---

### Task 28: Journey — bullmq-requeues-on-worker-restart

**v3 change:** Renamed from `bullmq-requeues-on-worker-crash`. The test uses `systemctl --user restart` (graceful shutdown) NOT `kill -SIGKILL` (unclean). Reason: SIGKILL leaves the BullMQ job lock held until `lockDuration` expires (5 min); a test with <60s window would time out. Graceful restart closes the BullMQ worker cleanly, returning the lock immediately for redelivery. This exercises the COMMON-CASE restart scenario, which is what exit criterion 8 actually tests. The SIGKILL+lock-expiry path remains a manual-testing exercise only.

**Files:**
- Create: `e2e/bullmq-requeues-on-worker-restart.spec.ts`

Same DBUS guard as Task 27.

- [ ] **Step 1: Write the journey**

```typescript
import { test, expect } from './helpers/setup';
import { execSync } from 'node:child_process';

const hasSystemdUser = (() => {
  try {
    execSync('systemctl --user is-active fluxaos-stage-worker', { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

test.describe('@r-ui-2 BullMQ redelivers on worker restart', () => {
  test.skip(!hasSystemdUser, 'systemctl --user unavailable — run from interactive shell on homelab');

  test('graceful worker restart mid-run → stage completes via BullMQ redelivery', async ({ page }) => {
    await page.goto('/default/admin/fluxaos/issues/1');
    await page.getByRole('button', { name: /run stage/i }).click();
    await expect(page.getByText(/running/i)).toBeVisible({ timeout: 15000 });

    // Graceful restart — the worker's SIGTERM handler closes BullMQ cleanly,
    // which returns the job lock to the queue. Restart=always brings it back
    // within RestartSec (2s). The new worker picks up the un-ack'd job.
    execSync('systemctl --user restart fluxaos-stage-worker');

    // Stage completes within 60s (typical test stage runs in well under this).
    await expect(page.getByText(/completed/i)).toBeVisible({ timeout: 60000 });
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test e2e/bullmq-requeues-on-worker-restart.spec.ts --reporter=list
git add e2e/bullmq-requeues-on-worker-restart.spec.ts
git commit -m "test(e2e): @r-ui-2 bullmq-requeues-on-worker-restart (graceful, lockDuration-safe)"
```

---

## Phase 5 — Integration tests (Tasks 29-30)

### Task 29: Rewrite orchestrator.test.ts

**Files:**
- Modify: `src/__tests__/integration/orchestrator.test.ts`

- [ ] **Step 1: Redis availability precondition**

At top of file:

```typescript
import { BullMQAdapter } from '@/adapters/bullmq/queue';

let redisAvailable = false;
beforeAll(async () => {
  if (!process.env.REDIS_URL) return;
  const adapter = new BullMQAdapter(process.env.REDIS_URL);
  redisAvailable = await adapter.healthCheck();
});
```

Every BullMQ-dependent test: `test.skipIf(!redisAvailable, ...)` or `if (!redisAvailable) return;` guard.

- [ ] **Step 2: Unskip `describe`**

Change `describe.skip(...)` → `describe(...)`.

- [ ] **Step 3: Rewrite test bodies**

Three classes of tests:

A. **End-to-end: orchestrator observes new pipeline_run and enqueues.**
   - Construct db, real `BullMQAdapter`, real `createSupabaseRealtimeAdapter`, mock executor.
   - `const orchestrator = createEventOrchestrator(db, executor, realtime, queue);`
   - `orchestrator.start();`
   - Insert a `pipeline_run` row in `pending` status. Attach existing `pipeline_stage`.
   - Assert within 5s that a BullMQ job exists on `stage-runs` queue for the expected stageRunId.
   - Tear down: `orchestrator.stop();`

B. **Worker-consumes-job: stage-worker executes and transitions stage_run.**
   - Construct handler via `createStageJobHandler({ db, executor })`.
   - `const worker = queue.process<StageJobPayload>('stage-runs', handler);`
   - Insert a `pipeline_run` + `stage_run` rows directly (bypass orchestrator for this test).
   - Enqueue a job manually.
   - Assert within 10s that the `stage_run` transitions to `completed` or `failed`.
   - Tear down: `await worker.close();`

C. **recoverOnStartup — three branches.**

   1. **Branch (a) — BullMQ has live job, recovery leaves it alone.**
      - Seed stage_run in `running` status.
      - Enqueue a BullMQ job for it (don't process — leave waiting).
      - Call `orchestrator.recoverOnStartup()`.
      - Assert stage_run is STILL `running` (not transitioned).

   2. **Branch (b) — no job, no subprocess, budget-exhausted → failed.**
      - Seed stage_run in `running` status with `attempt = 1`, stage's `maxRetries = 0`.
      - Ensure no BullMQ job exists for that stageRunId.
      - Call `recoverOnStartup`.
      - Assert stage_run is `failed`, and an `error` event with `reason: 'retry_budget_exhausted'` exists.

   3. **Branch (c) — no job, subprocess alive → orphaned_subprocess failure.**
      - Seed stage_run in `running` status with `pid = process.pid` (this test's own pid, guaranteed alive).
      - No BullMQ job.
      - Call `recoverOnStartup`.
      - Assert stage_run is `failed`, and an `error` event with `reason: 'orphaned_subprocess'` exists.

- [ ] **Step 4: Run with Redis**

```bash
# Verify REDIS_URL is set:
echo $REDIS_URL
npx tsx src/core/db/nuke.ts && npm run db:seed
npx vitest run src/__tests__/integration/orchestrator.test.ts
```

If `REDIS_URL` is absent or Redis unreachable, all BullMQ-dependent tests should skip cleanly (not fail).

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/integration/orchestrator.test.ts
git commit -m "test(orchestrator): unskip + rewrite for BullMQ + 3-branch recoverOnStartup"
```

---

### Task 30: Full vitest run

- [ ] **Step 1: Clean baseline**

```bash
npx tsx src/core/db/nuke.ts && npm run db:seed && npm run verify:seed
```

Expected: 10/10 PASS.

- [ ] **Step 2: Full run**

```bash
npx vitest run
```

Expected: 0 failures. If any pre-existing tests broke due to port-signature changes (QueueWorker return type), fix them in this task — do not defer.

- [ ] **Step 3: No commit — verification only**

---

## Phase 6 — Final verification (Tasks 31-32)

### Task 31: Adapter-boundary audit

- [ ] **Step 1: Grep Supabase SDK imports**

```bash
grep -rn "from '@supabase/supabase-js'\|from '@supabase/ssr'\|from '@supabase/realtime-js'" \
  src/ --include='*.ts' --include='*.tsx'
```

Expected matches — only in these files:
- `src/adapters/supabase/realtime.ts`
- `src/adapters/supabase/server-client.ts`
- `src/adapters/supabase/database.ts` (existing)
- `src/adapters/supabase/auth.ts` (existing)
- `src/lib/supabase/client.ts`, `server.ts`, `middleware.ts` (existing)
- `src/__tests__/` (integration tests — allowed)

ZERO matches in:
- `src/core/` (ALL of it — including `src/core/orchestrator/main.ts`, `worker-main.ts`)
- `src/components/`
- `src/app/` (except `layout.tsx` imports from `@/lib/realtime/context`, NOT `@supabase/*` directly)

If any match appears outside the allow-list, fix before proceeding.

- [ ] **Step 2: Grep direct `.channel(` calls**

```bash
grep -rn "\.channel(" src/ --include='*.ts' --include='*.tsx' | grep -v "src/adapters/supabase/realtime.ts"
```

Expected: zero matches.

- [ ] **Step 3: Run full Playwright suite**

```bash
# Dev server still running from Phase 4
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test --reporter=list
```

Expected: 11 passed (6 @r-ui-1 + 5 @r-ui-2). Tasks 27, 28 may skip if running from non-interactive shell — that's OK; document for manual run.

- [ ] **Step 4: No commit — verification only**

---

### Task 32: Manual verification + roadmap update

- [ ] **Step 1: Sanity-check commands**

```bash
cd /mnt/dev/fluxaos
git status --short                                 # empty
grep FLUXAOS_LAN_AUTH_BYPASS .env                  # =1
npx tsx src/core/db/nuke.ts && npm run db:seed && npm run verify:seed  # 10/10
npx vitest run                                      # 0 failures
npx tsc --noEmit 2>&1 | grep -c "error TS"          # 0 or 1 (pre-existing)
systemctl --user status fluxaos-orchestrator fluxaos-stage-worker  # both active
```

- [ ] **Step 2: Present manual checklist to user**

```markdown
**R-UI-2 manual verification — please complete in a real browser before merge.**

1. Navigate to an issue, click Run Stage. Output appears LINE BY LINE (not batched at end).
2. Duration ticks up every second during the run.
3. Open same issue in tab 2. Add comment in tab 1. Tab 2's activity feed updates without reload.
4. Trigger another run. Click Cancel Run during execution. Stage + pipeline transition to Cancelled. Restart orchestrator: cancelled stage does NOT re-launch.
5. While a run is active, `systemctl --user restart fluxaos-stage-worker` (graceful). Within seconds the revived worker picks up the un-ack'd BullMQ job and the stage completes. Also test the uncommon SIGKILL path manually (not automated — 5-minute `lockDuration` wait is impractical for CI): `systemctl --user kill -s SIGKILL fluxaos-stage-worker; sleep 310` → stage eventually completes via lock-expiry redelivery.
6. Run detail → Gates tab → per-rule dots show field/operator/value text.

If any step misbehaves, do NOT merge. Fix and re-verify.
```

- [ ] **Step 3: Only after user confirms**, update roadmap:

Edit `docs/superpowers/roadmap.md`:

- Change `R-UI-2 — Real-time updates | Not started | — | —` to `R-UI-2 — Real-time updates | Done | [r-ui-2-plan](...) | [r-ui-2-design](...) |`
- Promote R6 in "What's Next"

- [ ] **Step 4: Commit + PR**

```bash
git add docs/superpowers/roadmap.md
git commit -m "docs: mark R-UI-2 complete in roadmap"
git push -u origin feat/r-ui-2-realtime
gh pr create --title "feat: R-UI-2 — real-time updates + orchestrator activation" --body "..."
```

---

## Executor notes

- **No self-certification.** Task 32 Step 2 is non-skippable.
- **Every task ends in a commit** unless explicitly verification-only.
- **EDIT ONLY** on existing files.
- **Pre-commit blocks main** — work on `feat/r-ui-2-realtime`.
- **Invariant 7 is load-bearing.** Task 31's grep is the truth — any hit outside the allow-list means a task was executed wrong.
- **Deviations flagged, not decided.** If a task takes a direction not specified, stop and ask per invariant 22.
- **v1 vs v2 of this plan.** v1 (`bc86dcd`) had CRITICAL flaws found by DA review. This is v2. If anything in the commit history references v1 task numbers, they don't map 1:1 — v2 renumbered across phases.
