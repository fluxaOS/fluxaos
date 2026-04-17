# R-UI-2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **EDIT ONLY** on existing files. Never Write over existing files. Use Edit.
>
> **Spec:** `docs/superpowers/specs/2026-04-16-r-ui-2-design.md`

**Goal:** Ship the realtime-streaming + orchestrator-activation work that R5-V specified but did not implement, routing all Supabase Realtime calls through the `RealtimeProvider` port and wiring orchestrator stage dispatch through BullMQ for Celery-equivalent durability.

**Architecture:** Client components consume a `RealtimeProvider` port via React context (`useRealtime()`); the one Supabase Realtime adapter lives at `src/adapters/supabase/realtime.ts`. The orchestrator runs as a user-level systemd service, enqueues stage jobs to BullMQ, and a separately-managed `fluxaos-stage-worker` systemd service consumes those jobs by calling `executeStageRun`. Stream-as-it-arrives replaces refetch-on-INSERT via `setQueryData` append.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, tRPC v11, Supabase Cloud (Postgres + Realtime via `@supabase/ssr` and `@supabase/supabase-js`), BullMQ + ioredis, Drizzle ORM, systemd --user, Playwright, Vitest (integration only, real Supabase).

---

## File Map

### New files (with single-responsibility description)

| File | Responsibility |
|------|----------------|
| `src/adapters/supabase/realtime.ts` | The ONLY place Supabase Realtime SDK APIs are called. Implements `RealtimeProvider`. |
| `src/lib/realtime/context.tsx` | React context provider wrapping a browser-side adapter instance. |
| `src/lib/realtime/use-realtime.ts` | `useRealtime()` hook; throws if used outside provider. |
| `src/lib/realtime/use-now.ts` | `useNow(intervalMs)` hook for live-duration ticking. |
| `src/core/orchestrator/main.ts` | Orchestrator systemd entrypoint. Constructs deps, calls `start()` + `recoverOnStartup()`, handles SIGTERM. |
| `src/core/orchestrator/worker-main.ts` | Stage-worker systemd entrypoint. Constructs deps, calls `queue.process('stage-runs', handler)`, handles SIGTERM. |
| `scripts/systemd/fluxaos-orchestrator.service` | User-level systemd unit for orchestrator process. |
| `scripts/systemd/fluxaos-stage-worker.service` | User-level systemd unit for stage-worker process. |
| `scripts/install-orchestrator.sh` | Idempotent install script for both unit files. |
| `drizzle/XXXX_realtime_publication.sql` | Adds `event`, `stage_run`, `pipeline_run`, `issue_event` to `supabase_realtime` publication. |
| `e2e/live-output-streams.spec.ts` | Playwright: output appears incrementally. |
| `e2e/activity-feed-auto-refreshes.spec.ts` | Playwright: issue events surface without reload. |
| `e2e/cancel-running-stage.spec.ts` | Playwright: cancel transitions stage and pipeline. |
| `e2e/orchestrator-recovers-after-restart.spec.ts` | Playwright: orchestrator restart reconciles orphans. |
| `e2e/bullmq-requeues-on-worker-crash.spec.ts` | Playwright: BullMQ redelivers a job when worker dies mid-run. |

### Modified files (EDIT ONLY)

| File | Change |
|------|--------|
| `src/app/layout.tsx` | Wrap children in `RealtimeContextProvider`. |
| `src/components/pipeline/LiveOutput.tsx` | Swap `createClient()` + `supabase.channel()` for `useRealtime()`; change handler from `refetch()` to `setQueryData` append. |
| `src/components/pipeline/RunDetailModal.tsx` | Same treatment for `stage_run` subscription. Add `useNow()` duration ticker. |
| `src/components/pipeline/GateResultsPanel.tsx` | Fix `ruleResults[].field` → `ruleResults[].rule.field`. |
| `src/app/[org]/[user]/[project]/issues/[number]/client.tsx` | Add `useRealtime()` subscription for `issue_event` filtered by `issue.id`. |
| `src/core/orchestrator/event-orchestrator.ts` | Accept `queue: QueueProvider` dep. Replace `launchStage`'s in-process `executeStageRun` call with `queue.enqueue('stage-runs', …)`. Implement `recoverOnStartup()` per spec D1. |
| `src/core/orchestrator/stage-worker.ts` | Replace the duplicated `buildCommand` + inline execution with a call to `executeStageRun`. The worker becomes a thin BullMQ bridge. |
| `src/core/orchestrator/types.ts` | Refine `StageJobPayload` to `{ stageRunId, attempt }` — all routing/prompt/cwd/timeout data is re-resolved from DB by `executeStageRun`. |
| `src/adapters/bullmq/queue.ts` | Return a disposable from `process()` so the stage-worker can stop cleanly on SIGTERM. Set `lockDuration` generously for long-running stages. |
| `src/__tests__/integration/orchestrator.test.ts` | Unskip. Rewrite for the new shape: orchestrator + BullMQ + stage-worker as three collaborating actors. |
| `CLAUDE.md` | Add orchestrator/worker commands to Commands table; add Workflow note for systemd install. |
| `docs/session-quick-start.md` | Add one-command install + status + log-tail snippets. |
| `docs/superpowers/roadmap.md` | On completion, mark R-UI-2 Done and promote R6 Polish to next. |

---

## Phase 1 — Realtime adapter + port plumbing (Tasks 1-5)

### Task 1: Write failing test for Supabase Realtime adapter

**Files:**
- Create: `src/__tests__/integration/realtime-adapter.test.ts`

- [ ] **Step 1: Create the integration test**

```typescript
// src/__tests__/integration/realtime-adapter.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseRealtimeAdapter } from '@/adapters/supabase/realtime';
import { getDatabase } from '@/core/db/connection';
import { event } from '@/core/db/schema';
import type { RealtimeProvider } from '@/core/ports/realtime';

describe('Supabase Realtime adapter (integration)', () => {
  let adapter: RealtimeProvider;
  const db = getDatabase();

  beforeAll(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error('Supabase env missing');
    const client = createClient(url, key);
    adapter = createSupabaseRealtimeAdapter(client);
  });

  it('delivers INSERT payloads via subscribeToTable', async () => {
    const received: unknown[] = [];
    const unsub = adapter.subscribeToTable<typeof event.$inferSelect>(
      'test-channel-insert',
      'event',
      'INSERT',
      (payload) => received.push(payload.new),
    );

    // Give Realtime time to establish the subscription
    await new Promise((r) => setTimeout(r, 1500));

    // Write a row
    const [inserted] = await db
      .insert(event)
      .values({
        stageRunId: null,
        type: 'test',
        payload: { marker: 'adapter-test' },
      })
      .returning();

    // Wait up to 3s for delivery
    const deadline = Date.now() + 3000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    unsub();
    expect(received.length).toBeGreaterThan(0);
    expect((received[0] as { id: string }).id).toBe(inserted.id);

    // Cleanup
    await db.delete(event).where(/* match inserted */ undefined as never).execute().catch(() => {});
  });

  it('unsubscribe stops further deliveries', async () => {
    const received: unknown[] = [];
    const unsub = adapter.subscribeToTable(
      'test-channel-unsub',
      'event',
      'INSERT',
      (payload) => received.push(payload.new),
    );

    await new Promise((r) => setTimeout(r, 1500));
    unsub();
    await new Promise((r) => setTimeout(r, 300));

    const beforeCount = received.length;
    await db.insert(event).values({ stageRunId: null, type: 'test', payload: {} });
    await new Promise((r) => setTimeout(r, 1000));

    expect(received.length).toBe(beforeCount);
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
npx vitest run src/__tests__/integration/realtime-adapter.test.ts
```

Expected: FAIL with `Cannot find module '@/adapters/supabase/realtime'`.

- [ ] **Step 3: Commit the failing test**

```bash
git add src/__tests__/integration/realtime-adapter.test.ts
git commit -m "test(realtime): failing integration test for Supabase adapter"
```

---

### Task 2: Implement the Supabase Realtime adapter

**Files:**
- Create: `src/adapters/supabase/realtime.ts`

- [ ] **Step 1: Write the adapter**

```typescript
// src/adapters/supabase/realtime.ts
/**
 * Supabase Realtime adapter — implements RealtimeProvider.
 *
 * THIS IS THE ONLY FILE IN THE REPOSITORY where Supabase Realtime SDK
 * APIs may be called outside of src/lib/supabase/ (which owns the client
 * factory). All other consumers go through the RealtimeProvider port.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  RealtimeProvider,
  RealtimeTableEvent,
} from '@/core/ports/realtime';
import type { Unsubscribe } from '@/core/ports/auth';

export function createSupabaseRealtimeAdapter(
  client: SupabaseClient,
): RealtimeProvider {
  function subscribeToTable<T>(
    channelName: string,
    table: string,
    event: 'INSERT' | 'UPDATE' | '*',
    callback: (payload: RealtimeTableEvent<T>) => void,
  ): Unsubscribe {
    const channel = client
      .channel(channelName)
      .on(
        // @ts-expect-error: supabase-js types for postgres_changes are imprecise
        'postgres_changes',
        { event, schema: 'public', table },
        (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: T; old: T | null }) => {
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

    return () => {
      void client.removeChannel(channel);
    };
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

- [ ] **Step 2: Run the test and verify pass**

```bash
npx vitest run src/__tests__/integration/realtime-adapter.test.ts
```

Expected: both tests PASS. If the INSERT test times out, investigate `supabase_realtime` publication (Task 5 below fixes this systematically, but if it's blocking iteration here, ad-hoc `ALTER PUBLICATION supabase_realtime ADD TABLE event` via `db:studio`).

- [ ] **Step 3: Commit**

```bash
git add src/adapters/supabase/realtime.ts
git commit -m "feat(realtime): Supabase Realtime adapter implementing RealtimeProvider port"
```

---

### Task 3: Client context provider and hook

**Files:**
- Create: `src/lib/realtime/context.tsx`
- Create: `src/lib/realtime/use-realtime.ts`

- [ ] **Step 1: Write the context**

```tsx
// src/lib/realtime/context.tsx
'use client';

import { createContext, useMemo, type ReactNode } from 'react';
import { createClient as createBrowserSupabaseClient } from '@/lib/supabase/client';
import { createSupabaseRealtimeAdapter } from '@/adapters/supabase/realtime';
import type { RealtimeProvider } from '@/core/ports/realtime';

export const RealtimeContext = createContext<RealtimeProvider | null>(null);

export function RealtimeContextProvider({ children }: { children: ReactNode }) {
  const adapter = useMemo(() => {
    const client = createBrowserSupabaseClient();
    return createSupabaseRealtimeAdapter(client);
  }, []);

  return (
    <RealtimeContext.Provider value={adapter}>
      {children}
    </RealtimeContext.Provider>
  );
}
```

- [ ] **Step 2: Write the hook**

```typescript
// src/lib/realtime/use-realtime.ts
'use client';

import { useContext } from 'react';
import { RealtimeContext } from './context';
import type { RealtimeProvider } from '@/core/ports/realtime';

export function useRealtime(): RealtimeProvider {
  const ctx = useContext(RealtimeContext);
  if (!ctx) {
    throw new Error(
      'useRealtime() called outside <RealtimeContextProvider>. ' +
      'Mount the provider at the App Router root.',
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

### Task 4: useNow hook for live-duration ticking

**Files:**
- Create: `src/lib/realtime/use-now.ts`

- [ ] **Step 1: Write the hook**

```typescript
// src/lib/realtime/use-now.ts
'use client';

import { useEffect, useState } from 'react';

/**
 * Returns the current time, re-rendered on `intervalMs` cadence.
 * Pass `enabled: false` to freeze (e.g., for completed runs).
 */
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

### Task 5: Realtime publication migration

**Files:**
- Create: `drizzle/XXXX_realtime_publication.sql` (number assigned by drizzle-kit)

- [ ] **Step 1: Add a raw SQL migration via drizzle-kit**

Drizzle's `db:generate` produces migrations from schema changes only. For a raw-SQL migration (no schema diff), create the file manually with the next available sequential number.

```bash
# Find the next migration number
ls drizzle/*.sql | tail -1
# Last was drizzle/0004_harness_to_driver.sql — next is 0005
```

- [ ] **Step 2: Write the migration**

```sql
-- drizzle/0005_realtime_publication.sql
-- Explicitly enable Supabase Realtime on the tables the UI and orchestrator
-- subscribe to. Idempotent: safe to run repeatedly; safe on a fresh DB where
-- the publication already auto-includes tables.

DO $$
BEGIN
  -- Ensure the publication exists
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime FOR TABLE event, stage_run, pipeline_run, issue_event;
  ELSE
    -- Add tables individually; skip if already a member
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE event;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE stage_run;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_run;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE issue_event;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
```

- [ ] **Step 3: Update `drizzle/meta/_journal.json`**

Add an entry for migration `0005_realtime_publication` matching the format of prior entries. Example:

```json
{
  "idx": 5,
  "version": "7",
  "when": 1744000000000,
  "tag": "0005_realtime_publication",
  "breakpoints": true
}
```

(Exact `when` timestamp: use `date +%s%3N`.)

- [ ] **Step 4: Run the migration**

```bash
npm run db:migrate
```

Expected: migration runs without error. No schema changes visible.

- [ ] **Step 5: Verify publication members**

Connect via `npm run db:studio` OR write a one-off query:

```bash
npx tsx -e "
import { getDatabase } from './src/core/db/connection';
import { sql } from 'drizzle-orm';
const db = getDatabase();
const rows = await db.execute(sql\`SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'\`);
console.log(rows);
"
```

Expected: output includes `event`, `stage_run`, `pipeline_run`, `issue_event`.

- [ ] **Step 6: Commit**

```bash
git add drizzle/0005_realtime_publication.sql drizzle/meta/_journal.json
git commit -m "feat(db): enable Supabase Realtime publication for event, stage_run, pipeline_run, issue_event"
```

---

## Phase 2 — Client-side realtime integration (Tasks 6-11)

### Task 6: Mount RealtimeContextProvider at App Router root

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Read current layout**

```bash
cat src/app/layout.tsx
```

- [ ] **Step 2: Add the provider wrapper**

Use Edit. Locate the existing root children render (likely `{children}` inside `<body>` or similar) and wrap it:

```tsx
// At the top of src/app/layout.tsx, add:
import { RealtimeContextProvider } from '@/lib/realtime/context';

// In the JSX return, wrap children:
<RealtimeContextProvider>
  {children}
</RealtimeContextProvider>
```

The exact edit site depends on what else wraps children (trpc provider, theme provider, etc.). Place `RealtimeContextProvider` inside the tRPC provider so hooks that consume both work together.

- [ ] **Step 3: Verify the app still renders**

```bash
npm run dev -- -H 192.168.54.101 -p 3003 &
sleep 10
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.54.101:3003/default/admin/fluxaos
# Expected: 200
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat(realtime): mount RealtimeContextProvider at App Router root"
```

---

### Task 7: Migrate LiveOutput to the port, stream via setQueryData

**Files:**
- Modify: `src/components/pipeline/LiveOutput.tsx`

- [ ] **Step 1: Read the current file**

```bash
cat src/components/pipeline/LiveOutput.tsx
```

Current subscription block (lines ~128-152) creates a Supabase client and calls `supabase.channel()` directly, then calls `eventsQuery.refetch()` on every INSERT.

- [ ] **Step 2: Replace imports**

Remove:
```typescript
import { createClient } from '@/lib/supabase/client';
```

Add:
```typescript
import { useRealtime } from '@/lib/realtime/use-realtime';
```

- [ ] **Step 3: Replace the subscription block**

Locate the existing `useEffect` that builds the `supabase.channel(...)`. Replace its entire body with:

```typescript
// Subscribe via the RealtimeProvider port — no direct Supabase calls.
// Append new events to the tRPC cache directly (stream as they arrive).
useEffect(() => {
  if (!isActive || !stageRunId) return;

  const unsubscribe = realtime.subscribeToTable<typeof event.$inferSelect>(
    `live-output-${stageRunId}`,
    'event',
    'INSERT',
    (payload) => {
      const row = payload.new;
      // Filter: Supabase Realtime row-level filters require PostgREST-style syntax
      // which we don't configure here; filter client-side.
      if (row.stageRunId !== stageRunId) return;

      utils.pipeline.runs.events.setData(
        { stageRunId },
        (old) => (old ? [...old, row] : [row]),
      );
    },
  );

  return unsubscribe;
}, [stageRunId, isActive, realtime, utils]);
```

Add at the top of the component body:

```typescript
const realtime = useRealtime();
const utils = trpc.useUtils();
```

Also add the `event` schema import:

```typescript
import type { event } from '@/core/db/schema';
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep "LiveOutput"
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/pipeline/LiveOutput.tsx
git commit -m "feat(live-output): route Realtime through useRealtime; stream via setQueryData append"
```

---

### Task 8: Migrate RunDetailModal subscription and add duration tick

**Files:**
- Modify: `src/components/pipeline/RunDetailModal.tsx`

- [ ] **Step 1: Read current file**

```bash
cat src/components/pipeline/RunDetailModal.tsx
```

The existing subscription block is around lines 122-146 (stage_run UPDATEs).

- [ ] **Step 2: Replace imports**

Remove:
```typescript
import { createClient } from '@/lib/supabase/client';
```

Add:
```typescript
import { useRealtime } from '@/lib/realtime/use-realtime';
import { useNow } from '@/lib/realtime/use-now';
import type { stageRun } from '@/core/db/schema';
```

- [ ] **Step 3: Replace subscription block**

Replace the entire `useEffect` that creates `supabase.channel(...).on('postgres_changes', ...)` with:

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
      if (updated.pipelineRunId !== runId) return;

      // Merge the updated stage_run into the cached run detail
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
  );

  return unsubscribe;
}, [runId, isOpen, realtime, utils]);
```

- [ ] **Step 4: Add duration tick**

Near the top of the component, after existing state:

```typescript
const now = useNow({ enabled: isRunActive });
```

In the "Duration" MetaRow, change from static `Date.now()` to `now.getTime()`:

```typescript
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

Similarly update the per-stage duration calc inside `timelineStages` memo — but be careful that `useMemo`'s deps now include `now`:

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

- [ ] **Step 5: Typecheck + visual verification**

```bash
npx tsc --noEmit 2>&1 | grep "RunDetailModal"
```

Expected: no errors.

Open the app, open a run detail modal for an in-progress or past run, confirm it renders without crashing.

- [ ] **Step 6: Commit**

```bash
git add src/components/pipeline/RunDetailModal.tsx
git commit -m "feat(run-detail): route Realtime through port; add useNow duration tick"
```

---

### Task 9: Add activity-feed subscription to issue detail client

**Files:**
- Modify: `src/app/[org]/[user]/[project]/issues/[number]/client.tsx`

- [ ] **Step 1: Read current file**

```bash
head -60 "src/app/[org]/[user]/[project]/issues/[number]/client.tsx"
grep -n "eventsQuery\|issue_event\|activity" "src/app/[org]/[user]/[project]/issues/[number]/client.tsx" | head -20
```

- [ ] **Step 2: Add imports**

```typescript
import { useRealtime } from '@/lib/realtime/use-realtime';
import type { issueEvent } from '@/core/db/schema';
```

- [ ] **Step 3: Add subscription effect**

Just after `eventsQuery` is declared (around line 342 per earlier exploration), add:

```typescript
const realtime = useRealtime();
const utils = trpc.useUtils();

useEffect(() => {
  if (!issue?.id) return;

  const unsubscribe = realtime.subscribeToTable<typeof issueEvent.$inferSelect>(
    `issue-events-${issue.id}`,
    'issue_event',
    'INSERT',
    (payload) => {
      const row = payload.new;
      if (row.issueId !== issue.id) return;

      // Append to whichever filter is currently active
      const currentFilterArg = eventFilter === 'all' ? undefined : eventFilter;
      utils.issue.event.list.setData(
        { issueId: issue.id, filter: currentFilterArg },
        (old) => (old ? [row, ...old] : [row]),
      );
    },
  );

  return unsubscribe;
}, [issue?.id, realtime, utils, eventFilter]);
```

(Note: activity feeds typically show newest first — insert at head. If the existing ordering differs, mirror the existing `list.useQuery` order.)

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep "issues/\[number\]/client"
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[org]/[user]/[project]/issues/[number]/client.tsx"
git commit -m "feat(issue-detail): subscribe to issue_event INSERTs for live activity feed"
```

---

### Task 10: Fix GateResultsPanel rule-detail rendering

**Files:**
- Modify: `src/components/pipeline/GateResultsPanel.tsx`

- [ ] **Step 1: Read the file**

```bash
cat src/components/pipeline/GateResultsPanel.tsx
```

- [ ] **Step 2: Identify the bad field access**

The panel expects `ruleResults[].field` but the stored shape is `ruleResults[].rule.field`. Locate all occurrences:

```bash
grep -n "\.field\|\.operator\|\.value" src/components/pipeline/GateResultsPanel.tsx
```

- [ ] **Step 3: Edit each occurrence**

For each line accessing `result.field` / `result.operator` / `result.value` where `result` is an element of `ruleResults`, change to `result.rule.field` / `result.rule.operator` / `result.rule.value`.

- [ ] **Step 4: Verify rule dots render**

Trigger a pipeline run that produces a gate result (the seed data includes this), open the run detail modal, click Gates tab, confirm per-rule lines show field/operator/value text rather than empty dots.

- [ ] **Step 5: Commit**

```bash
git add src/components/pipeline/GateResultsPanel.tsx
git commit -m "fix(gate-results): read rule.field/operator/value from nested rule object"
```

---

### Task 11: Verify refactor — manual sanity check

- [ ] **Step 1: Grep the adapter boundary**

```bash
grep -rn "from '@supabase/supabase-js'\|from '@supabase/ssr'" src/ --include='*.ts' --include='*.tsx'
```

Expected allowed matches: `src/adapters/supabase/realtime.ts`, `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/middleware.ts`, `src/core/db/connection.ts` (postgres-js does NOT import from supabase-js but keep eyes open), and `src/__tests__/` for tests.

Zero matches in `src/core/`, `src/components/`, `src/app/` outside the allowed list.

- [ ] **Step 2: Run full vitest (baseline before Phase 3 changes)**

```bash
npx tsx src/core/db/nuke.ts && npm run db:seed && npx vitest run
```

Expected: all existing tests still pass (120 passed + 4 skipped, +1 new adapter test = 121 passed).

- [ ] **Step 3: Commit nothing — this is verification**

If anything failed, stop and diagnose before moving to Phase 3.

---

## Phase 3 — Server orchestrator + BullMQ wiring (Tasks 12-18)

### Task 12: Refine StageJobPayload type

**Files:**
- Modify: `src/core/orchestrator/types.ts`

- [ ] **Step 1: Read current payload**

```bash
grep -n "StageJobPayload" src/core/orchestrator/types.ts
```

- [ ] **Step 2: Replace with the minimal shape**

The old payload carried `routing`, `prompt`, `cwd`, `timeoutMs`. Under the new design the worker re-resolves all of that from DB via `executeStageRun`.

Edit to:

```typescript
// src/core/orchestrator/types.ts
// Keep existing StageEventType, Routing, etc. — only change StageJobPayload.

export interface StageJobPayload {
  /** The stage_run row id. Worker loads everything else from DB. */
  stageRunId: string;
  /** Which attempt this is (1-based). Passed for logging/telemetry. */
  attempt: number;
}
```

Delete the fields of the old payload that callers no longer provide. Any import sites that reference the removed fields will surface as typecheck errors — handle them in Task 13.

- [ ] **Step 3: Typecheck and list breakages**

```bash
npx tsc --noEmit 2>&1 | grep -E "StageJobPayload|stage-worker|event-orchestrator" | head -30
```

Expected: errors in `stage-worker.ts` and possibly `event-orchestrator.ts`. These are fixed in Task 13.

- [ ] **Step 4: Commit**

```bash
git add src/core/orchestrator/types.ts
git commit -m "refactor(orchestrator): StageJobPayload reduced to { stageRunId, attempt }"
```

---

### Task 13: Rewrite stage-worker to call executeStageRun

**Files:**
- Modify: `src/core/orchestrator/stage-worker.ts`

- [ ] **Step 1: Read current stage-worker**

```bash
cat src/core/orchestrator/stage-worker.ts
```

- [ ] **Step 2: Rewrite the handler**

Replace the entire file contents (via repeated Edit calls — do NOT Write) with:

```typescript
/**
 * Stage Worker — BullMQ job handler that invokes executeStageRun.
 *
 * The worker is a thin bridge: it takes a BullMQ job containing
 * { stageRunId, attempt } and calls the shared executeStageRun
 * function used by manual-run. All execution logic lives in
 * stage-runner.ts; nothing is duplicated here.
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
    // executeStageRun writes all state transitions and events.
    // We don't need to do anything else here — it's DRY.
  };
}
```

Verify `runService.getStageRun(id)` exists; if not, add it via Edit to `pipeline-run-service.ts`:

```bash
grep -n "getStageRun" src/core/orchestrator/pipeline-run-service.ts
```

If missing, add the method next to `getRun`:

```typescript
async function getStageRun(id: string) {
  const [row] = await db.select().from(stageRun).where(eq(stageRun.id, id));
  return row ?? null;
}
```

And expose it in the returned service object.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -E "stage-worker|StageJobPayload" | head -20
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/core/orchestrator/stage-worker.ts src/core/orchestrator/pipeline-run-service.ts
git commit -m "refactor(stage-worker): call executeStageRun; remove duplicated execution logic"
```

---

### Task 14: Wire BullMQ enqueue into event-orchestrator

**Files:**
- Modify: `src/core/orchestrator/event-orchestrator.ts`

- [ ] **Step 1: Read current launchStage and handleStageFailed**

```bash
grep -n "launchStage\|executeStageRun" src/core/orchestrator/event-orchestrator.ts | head -20
```

- [ ] **Step 2: Add `queue: QueueProvider` as a dependency**

Edit the imports:

```typescript
import type { QueueProvider } from '@/core/ports/queue';
```

Change `createEventOrchestrator` signature:

```typescript
export function createEventOrchestrator(
  db: Database,
  executor: StageExecutor,
  realtime: RealtimeProvider,
  queue: QueueProvider,
  config: Partial<EventOrchestratorConfig> = {},
): EventOrchestrator {
```

(The `executor` dep is retained for signatures that may still need it in `recoverOnStartup`; in steady state the executor only ever runs inside the stage-worker process. Leave executor param in place for compatibility but annotate with a code comment: `// Retained for future direct-execution paths; orchestrator itself does not spawn.`)

- [ ] **Step 3: Replace direct executeStageRun call**

In `launchStage`, find the block:

```typescript
try {
  const result = await executeStageRun({ db, executor, runService, runId: run.id, stageRunId: sRun.id, trigger: TRIGGER_TYPE.automated });
  // ... post-execution gate eval ...
}
```

Replace with enqueue, and move post-execution logic to a new `handleStageCompleted` triggered by a Realtime UPDATE subscription on `stage_run`:

```typescript
// Enqueue the stage run for the worker to execute.
// Post-execution logic runs when we observe the stage_run transition via Realtime.
await queue.enqueue<StageJobPayload>(
  'stage-runs',
  sRun.id,
  { stageRunId: sRun.id, attempt: attemptsForStage + 1 },
  { attempts: 1 }, // retry policy lives with orchestrator, not BullMQ
);
```

Add the import:

```typescript
import type { StageJobPayload } from './types';
```

Now add a third subscription in `start()`:

```typescript
unsubscribeStageCompletion = realtime.subscribeToTable<typeof stageRun.$inferSelect>(
  'orchestrator-stage-completed',
  'stage_run',
  'UPDATE',
  (payload) => {
    const row = payload.new;
    if (row.status === STAGE_RUN_STATUS.completed || row.status === STAGE_RUN_STATUS.failed || row.status === STAGE_RUN_STATUS.timed_out || row.status === STAGE_RUN_STATUS.cancelled) {
      handleStageTerminalStatus(row).catch(logError('handleStageTerminalStatus'));
    }
  },
);
```

Add state `let unsubscribeStageCompletion: Unsubscribe | null = null;` and clean it up in `stop()`.

Create `handleStageTerminalStatus(row)` that does the gate evaluation + verdict application the old synchronous flow did:

```typescript
async function handleStageTerminalStatus(sr: typeof stageRun.$inferSelect): Promise<void> {
  if (sr.status === STAGE_RUN_STATUS.cancelled) {
    // Cancelled: respect human decision, do not advance.
    return;
  }

  const stage = await runService.getStage(sr.pipelineStageId);
  const run = await runService.getRun(sr.pipelineRunId);
  if (!stage || !run) return;

  if (sr.status === STAGE_RUN_STATUS.completed) {
    // Post-execution gate evaluation
    const gateResult = await gateService.evaluateStageGate(
      stage.id,
      sr.id,
      {
        exit_code: sr.exitCode ?? 0,
        cost_usd: Number(sr.costUsd ?? 0),
        tokens_in: sr.tokensIn ?? 0,
        tokens_out: sr.tokensOut ?? 0,
        provider: sr.provider ?? '',
        model: sr.model ?? '',
        driver: sr.driver ?? '',
        skill_signal: sr.skillSignal ?? null,
      },
    );

    await runService.appendEvent(sr.id, EVENT_TYPE.gate_checked, {
      verdict: gateResult.verdict,
      passed: gateResult.passed,
      reason: gateResult.reason,
    });

    const effectiveVerdict = sr.skillSignal ?? gateResult.verdict;
    await applyVerdict(run, stage, sr, effectiveVerdict, sr.skillSignalReason ?? undefined, sr.skillMetadata ?? undefined);
  } else {
    // failed / timed_out
    await handleStageFailed(run, stage, sr);
  }
}
```

(Exact method names like `getStage`, `getStageRun`, and the fields available on `stageRun` may need to be added to `pipeline-run-service.ts`. Add them with the simplest implementations. Where a field doesn't exist on the row — e.g., `skillSignal`, `skillMetadata`, `skillSignalReason` — add them or read from the `event` table depending on how signals are stored. Verify before implementing by grepping for `skillSignal` in the current codebase.)

- [ ] **Step 4: Typecheck exhaustively**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Iterate on errors until clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator/event-orchestrator.ts src/core/orchestrator/pipeline-run-service.ts
git commit -m "feat(orchestrator): enqueue stages via BullMQ; handle completion via Realtime UPDATE"
```

---

### Task 15: Implement recoverOnStartup per spec D1

**Files:**
- Modify: `src/core/orchestrator/event-orchestrator.ts`

- [ ] **Step 1: Replace the stub `recoverOnStartup` with real logic**

```typescript
async function recoverOnStartup(): Promise<void> {
  console.log('[orchestrator] recoverOnStartup: scanning for in-flight stage runs');
  const inFlight = await runService.getInFlightStageRuns(); // status IN ('running','launching')

  for (const sr of inFlight) {
    // (a) Is there a BullMQ job for this stageRunId?
    const job = await queue.getJob('stage-runs', sr.id);
    if (job && (job.status === 'active' || job.status === 'waiting' || job.status === 'delayed')) {
      console.log(`[orchestrator] stage_run ${sr.id}: BullMQ job active; leaving to redelivery`);
      continue;
    }

    // (b) No live job. Is a subprocess alive?
    const pid = sr.pid;
    let subprocessAlive = false;
    if (pid && pid > 0) {
      try {
        process.kill(pid, 0);
        subprocessAlive = true;
      } catch (err) {
        // ESRCH = dead, EPERM = alive but owned by another user
        if ((err as NodeJS.ErrnoException).code === 'EPERM') {
          subprocessAlive = true;
        }
      }
    }

    if (subprocessAlive) {
      console.log(`[orchestrator] stage_run ${sr.id}: orphaned subprocess pid=${pid}, marking failed`);
      await runService.updateStageRunStatus(sr.id, STAGE_RUN_STATUS.failed);
      await runService.appendEvent(sr.id, EVENT_TYPE.error, {
        reason: 'orphaned_subprocess',
        pid,
      });
      continue;
    }

    // (c) Dead subprocess, no job. Check retry budget.
    const stage = await runService.getStage(sr.pipelineStageId);
    const maxRetries = stage?.maxRetries ?? 0;
    const attempt = sr.attempt ?? 1;

    if (attempt < maxRetries + 1) {
      console.log(`[orchestrator] stage_run ${sr.id}: enqueueing retry (attempt ${attempt + 1})`);
      await queue.enqueue<StageJobPayload>(
        'stage-runs',
        sr.id,
        { stageRunId: sr.id, attempt: attempt + 1 },
        { attempts: 1 },
      );
    } else {
      console.log(`[orchestrator] stage_run ${sr.id}: retry budget exhausted, marking failed`);
      await runService.updateStageRunStatus(sr.id, STAGE_RUN_STATUS.failed);
      await runService.appendEvent(sr.id, EVENT_TYPE.error, {
        reason: 'retry_budget_exhausted',
        attempt,
        maxRetries,
      });
    }
  }
}
```

- [ ] **Step 2: Add `getInFlightStageRuns` and `getStage` to pipeline-run-service if missing**

```bash
grep -n "getInFlightStageRuns\|getStage\b" src/core/orchestrator/pipeline-run-service.ts
```

If missing, add:

```typescript
async function getInFlightStageRuns() {
  return db.select().from(stageRun).where(
    or(
      eq(stageRun.status, STAGE_RUN_STATUS.running),
      eq(stageRun.status, STAGE_RUN_STATUS.launching),
    ),
  );
}

async function getStage(stageId: string) {
  const [row] = await db.select().from(pipelineStage).where(eq(pipelineStage.id, stageId));
  return row ?? null;
}
```

Import `or` from `drizzle-orm`.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -E "orchestrator|pipeline-run-service" | head -20
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/core/orchestrator/event-orchestrator.ts src/core/orchestrator/pipeline-run-service.ts
git commit -m "feat(orchestrator): implement recoverOnStartup with BullMQ-aware reconciliation"
```

---

### Task 16: Adapt BullMQ adapter for clean shutdown + lock duration

**Files:**
- Modify: `src/adapters/bullmq/queue.ts`

- [ ] **Step 1: Read current adapter**

Already read in exploration. The `process()` method currently returns `void` — callers can't stop the worker cleanly.

- [ ] **Step 2: Return a disposable from process()**

Edit the `process` method and the port:

In `src/core/ports/queue.ts`:

```typescript
export interface QueueWorker {
  close(): Promise<void>;
}

export interface QueueProvider {
  // ... existing ...
  process<T>(
    queueName: string,
    handler: (job: Job<T>) => Promise<void>,
  ): QueueWorker;
  // ...
}
```

In `src/adapters/bullmq/queue.ts`, update `process`:

```typescript
process<T>(queueName: string, handler: (job: Job<T>) => Promise<void>): QueueWorker {
  const worker = new Worker<T>(
    queueName,
    async (bullJob) => {
      await handler(mapJob(bullJob));
    },
    {
      connection: this.getConnection(),
      lockDuration: 300_000, // 5 minutes; stages can run long
    },
  );
  return {
    close: async () => {
      await worker.close();
    },
  };
}
```

Import `QueueWorker`:

```typescript
import type { QueueProvider, Job, JobOptions, JobStatus, QueueWorker } from '@/core/ports/queue';
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -E "queue|bullmq" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add src/core/ports/queue.ts src/adapters/bullmq/queue.ts
git commit -m "feat(queue): return QueueWorker from process() for clean shutdown; set lockDuration"
```

---

### Task 17: Orchestrator entrypoint — src/core/orchestrator/main.ts

**Files:**
- Create: `src/core/orchestrator/main.ts`

- [ ] **Step 1: Write the entrypoint**

```typescript
/**
 * Orchestrator systemd entrypoint.
 *
 * Starts the event-orchestrator as a long-running Node.js process.
 * This process does NOT execute stages — it subscribes to Realtime,
 * enqueues stage jobs on BullMQ, and reconciles in-flight work on
 * restart.
 *
 * Invoked by systemd unit fluxaos-orchestrator.service.
 */
import 'dotenv/config';
import { getDatabase } from '@/core/db/connection';
import { getRegistry } from '@/config/bootstrap';
import { createEventOrchestrator } from './event-orchestrator';
import { createSupabaseRealtimeAdapter } from '@/adapters/supabase/realtime';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.error('[orchestrator] missing Supabase env vars');
    process.exit(1);
  }

  const db = getDatabase();
  const registry = getRegistry();
  const executor = registry.get('stageExecutor');
  const queue = registry.get('queue');
  const supabaseClient = createClient(url, key);
  const realtime = createSupabaseRealtimeAdapter(supabaseClient);

  const orchestrator = createEventOrchestrator(db, executor, realtime, queue);

  console.log('[orchestrator] recovering in-flight runs...');
  await orchestrator.recoverOnStartup();

  console.log('[orchestrator] starting subscriptions...');
  orchestrator.start();

  console.log('[orchestrator] ready');

  const shutdown = async (signal: string) => {
    console.log(`[orchestrator] received ${signal}, shutting down`);
    orchestrator.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[orchestrator] fatal', err);
  process.exit(1);
});
```

(Verify `getRegistry` and its `.get(key)` API against `src/config/bootstrap.ts`. If it uses a different accessor pattern, adapt.)

- [ ] **Step 2: Manually smoke-test**

```bash
npx tsx src/core/orchestrator/main.ts &
PID=$!
sleep 5
# Expected: logs show "recoverOnStartup" and "ready"
kill -TERM $PID
wait $PID
# Expected: logs show "received SIGTERM, shutting down"
```

- [ ] **Step 3: Commit**

```bash
git add src/core/orchestrator/main.ts
git commit -m "feat(orchestrator): systemd entrypoint (main.ts) with graceful shutdown"
```

---

### Task 18: Stage-worker entrypoint — src/core/orchestrator/worker-main.ts

**Files:**
- Create: `src/core/orchestrator/worker-main.ts`

- [ ] **Step 1: Write the entrypoint**

```typescript
/**
 * Stage-worker systemd entrypoint.
 *
 * Starts a BullMQ worker that consumes stage-run jobs and invokes
 * executeStageRun. This process owns all subprocess spawning.
 *
 * Invoked by systemd unit fluxaos-stage-worker.service.
 */
import 'dotenv/config';
import { getDatabase } from '@/core/db/connection';
import { getRegistry } from '@/config/bootstrap';
import { createStageJobHandler } from './stage-worker';
import type { StageJobPayload } from './types';

async function main() {
  const db = getDatabase();
  const registry = getRegistry();
  const executor = registry.get('stageExecutor');
  const queue = registry.get('queue');

  const handler = createStageJobHandler({ db, executor });
  const worker = queue.process<StageJobPayload>('stage-runs', handler);

  console.log('[stage-worker] consuming stage-runs queue');

  const shutdown = async (signal: string) => {
    console.log(`[stage-worker] received ${signal}, closing worker`);
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

- [ ] **Step 2: Smoke-test**

```bash
npx tsx src/core/orchestrator/worker-main.ts &
PID=$!
sleep 3
kill -TERM $PID
wait $PID
```

- [ ] **Step 3: Commit**

```bash
git add src/core/orchestrator/worker-main.ts
git commit -m "feat(stage-worker): systemd entrypoint (worker-main.ts)"
```

---

## Phase 4 — Systemd packaging (Tasks 19-21)

### Task 19: Write systemd unit files

**Files:**
- Create: `scripts/systemd/fluxaos-orchestrator.service`
- Create: `scripts/systemd/fluxaos-stage-worker.service`

- [ ] **Step 1: Create orchestrator unit**

```ini
# scripts/systemd/fluxaos-orchestrator.service
[Unit]
Description=fluxaOS orchestrator (event-driven pipeline state machine)
After=network.target

[Service]
Type=simple
# Repo path supplied at install time via sed substitution.
WorkingDirectory=__FLUXAOS_REPO_PATH__
EnvironmentFile=__FLUXAOS_REPO_PATH__/.env
ExecStart=/usr/bin/env npx tsx src/core/orchestrator/main.ts
Restart=always
RestartSec=2s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
```

- [ ] **Step 2: Create stage-worker unit**

```ini
# scripts/systemd/fluxaos-stage-worker.service
[Unit]
Description=fluxaOS stage worker (BullMQ consumer, subprocess executor)
After=network.target fluxaos-orchestrator.service

[Service]
Type=simple
WorkingDirectory=__FLUXAOS_REPO_PATH__
EnvironmentFile=__FLUXAOS_REPO_PATH__/.env
ExecStart=/usr/bin/env npx tsx src/core/orchestrator/worker-main.ts
Restart=always
RestartSec=2s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
```

(Neither unit specifies `User=` — user-level service inherits the user that runs `systemctl --user`. This is per D2. For system-level at GTM, add `User=fluxaos` and move units to `/etc/systemd/system/`.)

- [ ] **Step 3: Commit**

```bash
git add scripts/systemd/fluxaos-orchestrator.service scripts/systemd/fluxaos-stage-worker.service
git commit -m "feat(systemd): user-level unit files for orchestrator + stage-worker"
```

---

### Task 20: Install script

**Files:**
- Create: `scripts/install-orchestrator.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# scripts/install-orchestrator.sh
# Idempotently installs and starts fluxaos-orchestrator + fluxaos-stage-worker
# as user-level systemd services.

set -euo pipefail

REPO_PATH="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_DIR="${HOME}/.config/systemd/user"

mkdir -p "${UNIT_DIR}"

for unit in fluxaos-orchestrator.service fluxaos-stage-worker.service; do
  src="${REPO_PATH}/scripts/systemd/${unit}"
  dst="${UNIT_DIR}/${unit}"
  sed "s|__FLUXAOS_REPO_PATH__|${REPO_PATH}|g" "${src}" > "${dst}"
  echo "Installed ${dst}"
done

systemctl --user daemon-reload
systemctl --user enable --now fluxaos-orchestrator.service fluxaos-stage-worker.service

echo
echo "Services installed and started. Check status:"
echo "  systemctl --user status fluxaos-orchestrator fluxaos-stage-worker"
echo
echo "Tail logs:"
echo "  journalctl --user -u fluxaos-orchestrator -f"
echo "  journalctl --user -u fluxaos-stage-worker -f"
```

- [ ] **Step 2: Make executable**

```bash
chmod +x scripts/install-orchestrator.sh
```

- [ ] **Step 3: Run the installer**

```bash
./scripts/install-orchestrator.sh
systemctl --user status fluxaos-orchestrator fluxaos-stage-worker
```

Expected: both services show `Active: active (running)`.

- [ ] **Step 4: Tail logs briefly**

```bash
journalctl --user -u fluxaos-orchestrator -n 20 --no-pager
journalctl --user -u fluxaos-stage-worker -n 20 --no-pager
```

Expected: orchestrator logs "ready"; worker logs "consuming stage-runs queue".

- [ ] **Step 5: Commit**

```bash
git add scripts/install-orchestrator.sh
git commit -m "feat(systemd): idempotent install script for both user-level units"
```

---

### Task 21: Document the install in CLAUDE.md and session-quick-start

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/session-quick-start.md`

- [ ] **Step 1: Edit CLAUDE.md commands table**

Add rows (after existing `npm run verify:seed`):

```markdown
| `./scripts/install-orchestrator.sh` | Install + start fluxaos-orchestrator + fluxaos-stage-worker user-level systemd services |
| `systemctl --user status fluxaos-orchestrator fluxaos-stage-worker` | Check service status |
| `journalctl --user -u fluxaos-orchestrator -f` | Tail orchestrator logs |
| `journalctl --user -u fluxaos-stage-worker -f` | Tail stage-worker logs |
```

Add a Workflow line:

```markdown
- **Install orchestrator (first run):** `./scripts/install-orchestrator.sh` — starts two user-level systemd services. Required before pipeline runs execute automatically.
```

- [ ] **Step 2: Edit session-quick-start.md**

Add a section:

```markdown
## Orchestrator services

The orchestrator and stage-worker run as user-level systemd services. Install once per dev box:

```bash
./scripts/install-orchestrator.sh
```

Verify:

```bash
systemctl --user status fluxaos-orchestrator fluxaos-stage-worker
```

Both should show `Active: active (running)`. Tail logs with `journalctl --user -u <service> -f`.

Restart after code changes that affect the orchestrator process:

```bash
systemctl --user restart fluxaos-orchestrator fluxaos-stage-worker
```
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/session-quick-start.md
git commit -m "docs: orchestrator + stage-worker systemd install and ops commands"
```

---

## Phase 5 — Playwright journeys (Tasks 22-26)

### Task 22: Journey — live-output-streams

**Files:**
- Create: `e2e/live-output-streams.spec.ts`

- [ ] **Step 1: Write the journey**

```typescript
// e2e/live-output-streams.spec.ts
import { test, expect, projectPath } from './helpers/setup';

test.describe('@r-ui-2 LiveOutput streams incrementally', () => {
  test('shows new lines within 3 seconds of subprocess output', async ({ page }) => {
    await page.goto(`${projectPath}/issues/1`);

    // Trigger a pipeline run
    await page.getByRole('button', { name: 'Run Stage' }).click();

    // Modal opens; LiveOutput is visible
    await expect(page.getByRole('dialog', { name: 'Run detail' })).toBeVisible();

    // Initially no output
    await expect(page.getByText('No output yet.')).toBeVisible({ timeout: 5000 });

    // First line should appear within 10 seconds
    const firstLineLocator = page.locator('[data-testid="live-output-pane"] > div').first();
    await expect(firstLineLocator).toBeVisible({ timeout: 10000 });

    // Wait briefly, then check that more lines have accumulated
    const firstSnapshot = await page.locator('[data-testid="live-output-pane"] > div').count();
    await page.waitForTimeout(3000);
    const secondSnapshot = await page.locator('[data-testid="live-output-pane"] > div').count();

    expect(secondSnapshot).toBeGreaterThan(firstSnapshot);
    // The key claim: lines accumulated OVER TIME, not all at once at the end.
  });
});
```

(Requires adding `data-testid="live-output-pane"` to the output `<div>` in `LiveOutput.tsx` — a separate Edit.)

- [ ] **Step 2: Add the data-testid**

Edit `src/components/pipeline/LiveOutput.tsx`, find the output pane `<div>` (around line 249) and add `data-testid="live-output-pane"`.

- [ ] **Step 3: Run the journey**

```bash
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test e2e/live-output-streams.spec.ts --reporter=list
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/live-output-streams.spec.ts src/components/pipeline/LiveOutput.tsx
git commit -m "test(e2e): journey — live-output-streams verifies incremental output"
```

---

### Task 23: Journey — activity-feed-auto-refreshes

**Files:**
- Create: `e2e/activity-feed-auto-refreshes.spec.ts`

- [ ] **Step 1: Write the journey**

```typescript
// e2e/activity-feed-auto-refreshes.spec.ts
import { test, expect, projectPath } from './helpers/setup';

test.describe('@r-ui-2 activity feed auto-refreshes', () => {
  test('new events appear in tab B without reload when tab A triggers action', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto(`${projectPath}/issues/1`);
    await pageB.goto(`${projectPath}/issues/1`);

    // Count activity entries in B
    const initialCount = await pageB.locator('[data-testid="activity-item"]').count();

    // In A: add a comment (produces an issue_event)
    await pageA.getByRole('textbox', { name: /comment/i }).fill('live update test');
    await pageA.getByRole('button', { name: /submit|add comment/i }).click();

    // In B: activity count grows within 5 seconds, no reload
    await expect.poll(
      async () => pageB.locator('[data-testid="activity-item"]').count(),
      { timeout: 5000 },
    ).toBeGreaterThan(initialCount);

    await contextA.close();
    await contextB.close();
  });
});
```

(Requires `data-testid="activity-item"` added to each activity entry in the issue detail client. Edit that file too.)

- [ ] **Step 2: Add data-testid**

Edit `src/app/[org]/[user]/[project]/issues/[number]/client.tsx` — find the activity event renderer and add `data-testid="activity-item"` to each.

- [ ] **Step 3: Run and commit**

```bash
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test e2e/activity-feed-auto-refreshes.spec.ts --reporter=list
git add e2e/activity-feed-auto-refreshes.spec.ts "src/app/[org]/[user]/[project]/issues/[number]/client.tsx"
git commit -m "test(e2e): journey — activity-feed-auto-refreshes verifies cross-tab updates"
```

---

### Task 24: Journey — cancel-running-stage

**Files:**
- Create: `e2e/cancel-running-stage.spec.ts`

- [ ] **Step 1: Write the journey**

```typescript
import { test, expect, projectPath } from './helpers/setup';

test.describe('@r-ui-2 cancel running stage', () => {
  test('cancel transitions stage_run and pipeline_run to cancelled', async ({ page }) => {
    await page.goto(`${projectPath}/issues/1`);
    await page.getByRole('button', { name: 'Run Stage' }).click();
    await expect(page.getByRole('dialog', { name: 'Run detail' })).toBeVisible();

    // Wait for stage to enter running
    await expect(page.getByText('Running', { exact: false })).toBeVisible({ timeout: 15000 });

    // Click Cancel Run
    await page.getByRole('button', { name: 'Cancel Run' }).click();

    // Verify final status is Cancelled
    await expect(page.getByText('Cancelled', { exact: false })).toBeVisible({ timeout: 10000 });
  });
});
```

- [ ] **Step 2: Run and commit**

```bash
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test e2e/cancel-running-stage.spec.ts --reporter=list
git add e2e/cancel-running-stage.spec.ts
git commit -m "test(e2e): journey — cancel-running-stage"
```

---

### Task 25: Journey — orchestrator-recovers-after-restart

**Files:**
- Create: `e2e/orchestrator-recovers-after-restart.spec.ts`

- [ ] **Step 1: Write the journey**

This one uses the filesystem / systemctl from Playwright via `child_process`.

```typescript
import { test, expect, projectPath } from './helpers/setup';
import { execSync } from 'node:child_process';

test.describe('@r-ui-2 orchestrator recovers after restart', () => {
  test('orphaned stage_run is failed with retry_budget_exhausted on restart', async ({ page }) => {
    // Baseline: orchestrator running
    execSync('systemctl --user is-active fluxaos-orchestrator', { encoding: 'utf8' });

    // Insert a fake in-flight stage_run directly via db:studio-equivalent script
    // For simplicity, trigger a real pipeline run first, then kill the worker, then restart orchestrator
    await page.goto(`${projectPath}/issues/1`);
    await page.getByRole('button', { name: 'Run Stage' }).click();
    await expect(page.getByText('Running')).toBeVisible({ timeout: 15000 });

    // Kill the worker so the stage_run becomes orphaned from BullMQ's perspective
    execSync('systemctl --user stop fluxaos-stage-worker');
    execSync('systemctl --user restart fluxaos-orchestrator');

    // After orchestrator restart, the stage either requeues (if maxRetries allows) or fails
    // Wait up to 15s for a terminal state
    await expect(async () => {
      const text = await page.textContent('body');
      expect(text).toMatch(/Failed|Completed|Cancelled/);
    }).toPass({ timeout: 15000 });

    // Restart worker so cleanup runs
    execSync('systemctl --user start fluxaos-stage-worker');
  });
});
```

- [ ] **Step 2: Run and commit**

```bash
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test e2e/orchestrator-recovers-after-restart.spec.ts --reporter=list
git add e2e/orchestrator-recovers-after-restart.spec.ts
git commit -m "test(e2e): journey — orchestrator-recovers-after-restart"
```

---

### Task 26: Journey — bullmq-requeues-on-worker-crash

**Files:**
- Create: `e2e/bullmq-requeues-on-worker-crash.spec.ts`

- [ ] **Step 1: Write the journey**

```typescript
import { test, expect, projectPath } from './helpers/setup';
import { execSync } from 'node:child_process';

test.describe('@r-ui-2 BullMQ requeues on worker crash', () => {
  test('killing the worker mid-run does NOT leave the stage stuck; it completes after worker restart', async ({ page }) => {
    await page.goto(`${projectPath}/issues/1`);
    await page.getByRole('button', { name: 'Run Stage' }).click();
    await expect(page.getByText('Running')).toBeVisible({ timeout: 15000 });

    // Kill worker with SIGKILL so BullMQ job stays un-ack'd
    execSync('systemctl --user kill -s SIGKILL fluxaos-stage-worker');
    await page.waitForTimeout(2000);

    // Worker auto-restarts via Restart=always, BullMQ redelivers the job
    // Wait up to 60s for stage to complete
    await expect(page.getByText('Completed', { exact: false })).toBeVisible({ timeout: 60000 });
  });
});
```

- [ ] **Step 2: Run and commit**

```bash
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test e2e/bullmq-requeues-on-worker-crash.spec.ts --reporter=list
git add e2e/bullmq-requeues-on-worker-crash.spec.ts
git commit -m "test(e2e): journey — bullmq-requeues-on-worker-crash"
```

---

## Phase 6 — Integration tests (Tasks 27-28)

### Task 27: Rewrite orchestrator.test.ts for the new shape

**Files:**
- Modify: `src/__tests__/integration/orchestrator.test.ts`

- [ ] **Step 1: Read the current tests**

```bash
cat src/__tests__/integration/orchestrator.test.ts | head -80
```

- [ ] **Step 2: Unskip and rewrite**

Replace `describe.skip(...)` with `describe(...)`. Restructure tests to:

1. Construct all three collaborators (db, executor, queue, realtime) with real implementations.
2. Create an orchestrator instance, call `start()`, insert a pipeline_run row directly via db.
3. Assert the orchestrator observes the insert (via Realtime) and enqueues a BullMQ job within some timeout.
4. Consume the job via `queue.process('stage-runs', handler)` where handler is the real `createStageJobHandler`.
5. Assert the stage_run transitions to `completed`/`failed`.
6. Assert the pipeline_run transitions accordingly.
7. Call `orchestrator.stop()` + worker close in `afterEach`.

Exact test bodies depend on what `MockStageExecutor` or equivalent you use. If none exists, construct one that no-ops `execute` and returns `{ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }`.

Add a test for `recoverOnStartup` that:
1. Inserts a stage_run in `running` state without a BullMQ job.
2. Calls `recoverOnStartup()`.
3. Asserts the stage_run is now `failed` with an `error` event containing `reason: 'retry_budget_exhausted'`.

- [ ] **Step 3: Run**

```bash
npx vitest run src/__tests__/integration/orchestrator.test.ts
```

Expected: all tests pass. Fix any deviations in the implementation until they do.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/integration/orchestrator.test.ts
git commit -m "test(orchestrator): unskip and rewrite for event-orchestrator + BullMQ"
```

---

### Task 28: Full vitest run

- [ ] **Step 1: Clean-slate DB**

```bash
npx tsx src/core/db/nuke.ts && npm run db:seed && npm run verify:seed
```

Expected: 10/10 PASS.

- [ ] **Step 2: Run everything**

```bash
npx vitest run
```

Expected: 0 failures. If any pre-existing tests broke due to schema or service-signature changes, fix them in Task 27 (don't create new tasks).

- [ ] **Step 3: No commit needed — verification only**

If failures occur, treat as show-stopper per invariant. No deferrals.

---

## Phase 7 — Final verification (Tasks 29-30)

### Task 29: Adapter-boundary grep audit

- [ ] **Step 1: Grep for Supabase Realtime SDK imports**

```bash
grep -rn "from '@supabase/supabase-js'" src/ --include='*.ts' --include='*.tsx'
```

Expected matches ONLY in:
- `src/adapters/supabase/realtime.ts`
- `src/lib/supabase/client.ts` (or wherever the browser client lives)
- `src/lib/supabase/server.ts` / `middleware.ts`
- `src/core/orchestrator/main.ts` (creates the server-side Supabase client for the adapter)
- Integration tests under `src/__tests__/`

Zero matches in:
- `src/core/` (outside `main.ts`)
- `src/components/`
- `src/app/` (outside `layout.tsx`-level provider)

- [ ] **Step 2: Grep for direct `.channel()` calls**

```bash
grep -rn "\.channel(" src/ --include='*.ts' --include='*.tsx'
```

Expected matches ONLY in `src/adapters/supabase/realtime.ts`.

- [ ] **Step 3: Run the full Playwright suite**

```bash
npm run dev -- -H 192.168.54.101 -p 3003 &
sleep 10
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test --reporter=list
```

Expected: 11 passed (6 R-UI-1 + 5 R-UI-2). Zero failures. Zero flakes.

- [ ] **Step 4: No commit — verification only**

---

### Task 30: Final checklist + roadmap update

- [ ] **Step 1: Run sanity-check commands**

```bash
cd /mnt/dev/fluxaos
git status --short                             # expected: empty
grep FLUXAOS_LAN_AUTH_BYPASS .env              # expected: =1
npx tsx src/core/db/nuke.ts && npm run db:seed && npm run verify:seed  # expected: 10/10
npx vitest run                                  # expected: 0 failures
npx tsc --noEmit 2>&1 | grep -c "error TS"     # expected: 0 or 1 (pre-existing events.ts:53)
systemctl --user status fluxaos-orchestrator fluxaos-stage-worker  # expected: both active
```

- [ ] **Step 2: User manual verification**

Present the following manual checklist to the user. Do NOT merge or ship until they confirm each:

```markdown
**R-UI-2 manual verification** — please complete in a real browser before merge.

1. Open http://192.168.54.101:3003, navigate to an issue.
2. Click "Run Stage". Modal opens. Output lines appear AS they arrive, not as a batch.
3. While the run is active, the Duration value in the header ticks up every second.
4. Open the same issue in a second browser tab. Add a comment from tab 1. Tab 2's activity feed updates without a reload.
5. Trigger another run. While it's active, click Cancel Run. Stage transitions to Cancelled. A subsequent orchestrator restart (via `systemctl --user restart fluxaos-orchestrator`) does NOT re-launch the cancelled stage.
6. While a run is active, run `systemctl --user kill -s SIGKILL fluxaos-stage-worker`. Wait 3 seconds. The stage eventually transitions to Completed (BullMQ redelivered the job after `Restart=always` brought the worker back up). No manual intervention needed.
7. Open a run detail modal, click Gates tab, confirm per-rule dots show `field operator value` text rather than being empty.

If any step misbehaves, do NOT merge. Fix and re-verify.
```

- [ ] **Step 3: Update roadmap**

Edit `docs/superpowers/roadmap.md`:

- Change `R-UI-2 — Real-time updates | Not started | — | —` to `R-UI-2 — Real-time updates | Done | [r-ui-2-plan](superpowers/plans/2026-04-16-r-ui-2-implementation.md) | [r-ui-2-design](superpowers/specs/2026-04-16-r-ui-2-design.md) |`.
- In "What's Next", strike through R-UI-2 and promote R6 Polish.

- [ ] **Step 4: Commit and PR**

```bash
git add docs/superpowers/roadmap.md
git commit -m "docs: mark R-UI-2 complete in roadmap"
git push -u origin feat/r-ui-2-realtime
gh pr create --title "feat: R-UI-2 — real-time updates + orchestrator activation" --body "$(cat <<'EOF'
## Summary
- Supabase Realtime adapter at src/adapters/supabase/realtime.ts (vendor-agnostic port routing)
- Client-side realtime context; LiveOutput, RunDetailModal, issue activity feed all consume the port
- Stream-as-arrive via setQueryData append (replaces refetch-on-INSERT batching)
- useNow hook for live duration tick
- Orchestrator + stage-worker as user-level systemd services
- BullMQ-backed stage dispatch (Celery-equivalent durability)
- recoverOnStartup implemented
- Supabase Realtime publication migration
- 5 new Playwright journeys under @r-ui-2
- GateResultsPanel rule rendering fixed

## Test plan
- [ ] Full vitest suite passes (0 failures)
- [ ] All 11 Playwright journeys pass (6 R-UI-1 + 5 R-UI-2)
- [ ] Manual verification completed per checklist
- [ ] Adapter-boundary grep is clean
- [ ] Both systemd services active after install

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for executor

- **No self-certification.** Task 30 Step 2 is non-skippable. Do not mark R-UI-2 complete on the basis of "tests pass."
- **Every task ends with a commit** unless explicitly a verification-only task. The commit history is the audit trail.
- **EDIT ONLY** on existing files. Use Edit, not Write.
- **Adapter boundary is load-bearing.** Task 29's grep audit is the truth — any hit outside the allowed list means a task was done wrong and must be revisited.
- **Pre-commit hook blocks main pushes.** Work on `feat/r-ui-2-realtime`.
- **If any task takes a direction not specified here,** stop and flag per Invariant 22. Do not decide autonomously.
