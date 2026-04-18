# R-REM-W2 Architecture Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route realtime and subprocess-output parsing through the adapter registry, and wrap the issue-comment soft-delete in a transaction.

**Architecture:** Three independent commits. Each introduces a port or adapter, migrates consumers, adds an integration test. Net: zero `.channel(` calls outside `src/adapters/supabase/`, zero subprocess-output parsing logic inside `src/core/`, atomic soft-delete.

**Tech Stack:** TypeScript 5, tRPC v11, Drizzle ORM, Supabase JS SDK, Vitest integration tests, Next.js 16.

**Source spec:** `docs/superpowers/specs/2026-04-18-r-rem-w2-design.md`

---

## One-time correction from the spec

The spec calls item 2 "Anthropic protocol parser." Reading `src/core/orchestrator/output-parser.ts` in detail reveals it parses driver subprocess stdout (generic stream-JSON and plaintext formats), with the Claude Code CLI's transcript shape as one of the shapes it recognizes. It is NOT Anthropic Messages API wire format. Correct classification: **subprocess output parser**, not Anthropic-specific.

Adapter path therefore changes from `src/adapters/anthropic/protocol-parser.ts` to **`src/adapters/subprocess/stdout-parser.ts`** — same directory as the existing `SubprocessExecutor`, where it belongs architecturally. Port name stays neutral: `StdoutParser` (not `AIProtocolParser`).

All three invariant grep sweeps and downstream references in this plan reflect the correction.

---

## File Structure

```
src/
  adapters/
    supabase/
      realtime.ts              # NEW — SupabaseRealtimeProvider
    subprocess/
      stdout-parser.ts         # NEW — SubprocessStdoutParser (relocated from core)
  core/
    orchestrator/
      output-parser.ts         # DELETE
      stage-runner.ts          # MODIFY — resolve parser via registry
    ports/
      stdout-parser.ts         # NEW — StdoutParser interface
      realtime.ts              # unchanged (already exists)
    services/
      issue-comment.ts         # MODIFY — wrap softDelete in transaction
  components/
    pipeline/
      LiveOutput.tsx           # MODIFY — registry-resolved parser + realtime
      RunDetailModal.tsx       # MODIFY — registry-resolved realtime
  config/
    bootstrap.ts               # MODIFY — register 'realtime' and 'stdoutParser'
  __tests__/
    integration/
      realtime.test.ts         # NEW
      stdout-parser.test.ts    # NEW
      issue-comment.test.ts    # MODIFY — add transactional test
docs/
  invariants.md                # MODIFY — note that src/lib/ is framework glue
```

---

## Task 1: Realtime adapter + bootstrap registration

**Files:**
- Create: `src/adapters/supabase/realtime.ts`
- Modify: `src/config/bootstrap.ts`
- Test: `src/__tests__/integration/realtime.test.ts`

- [ ] **Step 1: Read the existing RealtimeProvider port**

Run: `cat src/core/ports/realtime.ts`

Confirm the interface shape (already seen in spec):

```ts
export interface RealtimeProvider {
  subscribe<T>(channel: string, event: string, callback: (payload: T) => void): Unsubscribe;
  subscribeToTable<T>(channelName: string, table: string, event: 'INSERT' | 'UPDATE' | '*', callback: (payload: RealtimeTableEvent<T>) => void): Unsubscribe;
  broadcast<T>(channel: string, event: string, payload: T): Promise<void>;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/__tests__/integration/realtime.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { registry } from '@/config/registry';
import { bootstrap } from '@/config/bootstrap';
import type { RealtimeProvider } from '@/core/ports/realtime';

describe('realtime adapter', () => {
  beforeAll(() => {
    bootstrap();
  });

  it('registers and resolves the realtime adapter', () => {
    const rt = registry.get<RealtimeProvider>('realtime');
    expect(rt).toBeDefined();
    expect(typeof rt.subscribe).toBe('function');
    expect(typeof rt.subscribeToTable).toBe('function');
    expect(typeof rt.broadcast).toBe('function');
  });

  it('returns an unsubscribe function from subscribeToTable', () => {
    const rt = registry.get<RealtimeProvider>('realtime');
    const unsub = rt.subscribeToTable('test-channel', 'event', '*', () => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/integration/realtime.test.ts`

Expected: FAIL — `Adapter "realtime" is not registered`

- [ ] **Step 4: Implement SupabaseRealtimeProvider**

Create `src/adapters/supabase/realtime.ts`:

```ts
/**
 * Supabase RealtimeProvider adapter.
 *
 * Implements the RealtimeProvider port using @supabase/supabase-js
 * Realtime channels. Resolved via the registry — never imported directly.
 */
import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import type {
  RealtimeProvider,
  RealtimeTableEvent,
} from '@/core/ports/realtime';
import type { Unsubscribe } from '@/core/ports/auth';

export class SupabaseRealtimeProvider implements RealtimeProvider {
  private client: SupabaseClient;

  constructor(config: { supabaseUrl: string; supabaseKey: string }) {
    this.client = createClient(config.supabaseUrl, config.supabaseKey);
  }

  subscribe<T>(
    channel: string,
    event: string,
    callback: (payload: T) => void,
  ): Unsubscribe {
    const ch: RealtimeChannel = this.client
      .channel(channel)
      .on('broadcast', { event }, ({ payload }) => callback(payload as T))
      .subscribe();
    return () => { ch.unsubscribe(); };
  }

  subscribeToTable<T>(
    channelName: string,
    table: string,
    event: 'INSERT' | 'UPDATE' | '*',
    callback: (payload: RealtimeTableEvent<T>) => void,
  ): Unsubscribe {
    const ch: RealtimeChannel = this.client
      .channel(channelName)
      .on(
        'postgres_changes' as never,
        { event, schema: 'public', table } as never,
        (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: T; old: T | null }) => {
          callback({
            eventType: payload.eventType,
            new: payload.new,
            old: payload.old,
          });
        },
      )
      .subscribe();
    return () => { ch.unsubscribe(); };
  }

  async broadcast<T>(channel: string, event: string, payload: T): Promise<void> {
    const ch = this.client.channel(channel);
    await ch.send({ type: 'broadcast', event, payload });
    await ch.unsubscribe();
  }
}
```

- [ ] **Step 5: Register the adapter in bootstrap**

Modify `src/config/bootstrap.ts`:

Add import near the existing adapter imports:

```ts
import { SupabaseRealtimeProvider } from '@/adapters/supabase/realtime';
```

Update the `REQUIRED_ADAPTERS` constant:

```ts
const REQUIRED_ADAPTERS = ['database', 'auth', 'queue', 'realtime'] as const;
```

Add the registration block inside `bootstrap()`, after the `auth` registration and before `queue`:

```ts
  // Realtime — Supabase Realtime channels
  registry.register('realtime', () => {
    const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
    const supabaseKey = requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    return new SupabaseRealtimeProvider({ supabaseUrl, supabaseKey });
  });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/__tests__/integration/realtime.test.ts`

Expected: PASS (2 tests)

- [ ] **Step 7: Run full test suite to confirm no regressions**

Run: `npx vitest run`

Expected: all green (115 + 2 = 117 tests passing)

- [ ] **Step 8: Commit**

```bash
git add src/adapters/supabase/realtime.ts src/config/bootstrap.ts src/__tests__/integration/realtime.test.ts
git commit -m "feat(adapters): add SupabaseRealtimeProvider and register in bootstrap

Implements the RealtimeProvider port using @supabase/supabase-js channels.
Adds 'realtime' to REQUIRED_ADAPTERS. Nothing consumes it yet — next tasks
migrate LiveOutput and RunDetailModal to resolve via the registry."
```

---

## Task 2: Migrate LiveOutput to registry-resolved realtime

**Files:**
- Modify: `src/components/pipeline/LiveOutput.tsx`

- [ ] **Step 1: Read LiveOutput to understand current realtime usage**

Run: `grep -n 'supabase\|channel\|realtime\|createClient' src/components/pipeline/LiveOutput.tsx`

Note the three things in play:
- `createClient` from `@/lib/supabase/client` (line ~5)
- `.channel('live-output-<id>')` (line ~133)
- Any other uses of `createClient` — if realtime is its only use, the import is removed

- [ ] **Step 2: Replace realtime setup with registry resolution**

In `LiveOutput.tsx`:

Replace the import line:

```ts
import { createClient } from '@/lib/supabase/client';
```

with:

```ts
import { registry } from '@/config/registry';
import type { RealtimeProvider } from '@/core/ports/realtime';
```

Find the `useEffect` that sets up the realtime subscription (around line 125-140). Replace the body pattern. The current shape is approximately:

```ts
const supabase = createClient();
const channel = supabase
  .channel(`live-output-${stageRunId}`)
  .on('postgres_changes', { /* config */ }, (payload) => { /* handler */ })
  .subscribe();
return () => { supabase.removeChannel(channel); };
```

Replace with:

```ts
const realtime = registry.get<RealtimeProvider>('realtime');
const unsubscribe = realtime.subscribeToTable<EventRow>(
  `live-output-${stageRunId}`,
  'event',
  '*',
  (payload) => { /* handler — same body, operates on payload.new */ },
);
return () => { unsubscribe(); };
```

`EventRow` is the row shape consumed today (look at the current handler for the exact fields). If the handler destructures `payload.new`, the shape transfers directly.

- [ ] **Step 3: Confirm no other references to createClient remain in this file**

Run: `grep -n 'createClient\|@/lib/supabase' src/components/pipeline/LiveOutput.tsx`

Expected: no matches. If matches remain, the file has a non-realtime Supabase use; stop and investigate. (Likely safe to remove because LiveOutput is realtime-only, but verify.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors. If the handler's destructuring typed against the old `{ new, old }` payload, it should still work — `subscribeToTable` delivers the same shape per the port.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`

Expected: all green.

- [ ] **Step 6: Browser smoke check (quick)**

Start dev server in one terminal: `npm run dev`

Load a project with an in-progress run. Confirm LiveOutput still receives events and the live stream updates. Close dev server.

- [ ] **Step 7: Commit**

```bash
git add src/components/pipeline/LiveOutput.tsx
git commit -m "refactor(pipeline): route LiveOutput realtime through adapter registry

Replaces direct @/lib/supabase/client + .channel() usage with
registry.get<RealtimeProvider>('realtime').subscribeToTable(...).
No behavior change — adapter is a thin passthrough."
```

---

## Task 3: Migrate RunDetailModal to registry-resolved realtime

**Files:**
- Modify: `src/components/pipeline/RunDetailModal.tsx`

- [ ] **Step 1: Read RunDetailModal for current realtime usage**

Run: `grep -n 'supabase\|channel\|realtime\|createClient' src/components/pipeline/RunDetailModal.tsx`

Confirm similar shape to LiveOutput: `createClient` import (~line 10) + `.channel(`run-detail-${runId}`)` (~line 128).

- [ ] **Step 2: Replace import**

Same swap as Task 2 Step 2:

```ts
// Remove
import { createClient } from '@/lib/supabase/client';

// Add
import { registry } from '@/config/registry';
import type { RealtimeProvider } from '@/core/ports/realtime';
```

- [ ] **Step 3: Replace the realtime setup**

Find the `useEffect` subscribing to the `run-detail-<runId>` channel. The current shape subscribes to one or more tables (likely `pipeline_run` and `stage_run`). For each table, use `subscribeToTable` and collect unsubscribe functions:

```ts
const realtime = registry.get<RealtimeProvider>('realtime');
const unsubscribes: Array<() => void> = [];

unsubscribes.push(
  realtime.subscribeToTable<PipelineRunRow>(
    `run-detail-${runId}`,
    'pipeline_run',
    '*',
    (payload) => { /* existing handler for pipeline_run */ },
  ),
);

unsubscribes.push(
  realtime.subscribeToTable<StageRunRow>(
    `run-detail-${runId}-stages`,
    'stage_run',
    '*',
    (payload) => { /* existing handler for stage_run */ },
  ),
);

return () => { unsubscribes.forEach((u) => u()); };
```

Preserve the channel naming convention (must be unique per subscription). If the current code uses one channel for both tables via the Supabase API's filter chaining, split into two channels here — `subscribeToTable` is one-table-per-channel by design.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/components/pipeline/RunDetailModal.tsx
git commit -m "refactor(pipeline): route RunDetailModal realtime through adapter registry

Replaces direct @/lib/supabase/client + .channel() usage with
registry.get<RealtimeProvider>('realtime').subscribeToTable(...).
Splits the previous combined channel into per-table subscriptions per
the RealtimeProvider port contract."
```

---

## Task 4: Invariant grep sweep for realtime

**Files:**
- Inspection only; no modifications expected unless a consumer was missed

- [ ] **Step 1: Search for any remaining `.channel(` outside the adapter**

Run: `grep -rn '\.channel(' src/ --include='*.ts' --include='*.tsx' | grep -v 'src/adapters/supabase/' | grep -v '__tests__'`

Expected: zero matches. If any appear, a consumer was missed — add a task to migrate it.

- [ ] **Step 2: Search for direct Supabase realtime imports in app code**

Run: `grep -rn 'removeChannel\|RealtimeChannel\|realtime' src/ --include='*.ts' --include='*.tsx' | grep -v 'src/adapters/supabase/' | grep -v 'src/core/ports/realtime.ts' | grep -v '__tests__' | grep -v '// '`

Expected: zero matches outside the adapter and port.

- [ ] **Step 3: Confirm LiveOutput and RunDetailModal don't import from @/lib/supabase for realtime**

Run: `grep -n '@/lib/supabase' src/components/pipeline/LiveOutput.tsx src/components/pipeline/RunDetailModal.tsx`

Expected: zero matches.

- [ ] **Step 4: No commit — this task is verification only**

If Steps 1-3 all clear, move on to Task 5. If any finding, remediate before proceeding.

---

## Task 5: StdoutParser port + SubprocessStdoutParser adapter

**Files:**
- Create: `src/core/ports/stdout-parser.ts`
- Create: `src/adapters/subprocess/stdout-parser.ts`
- Test: `src/__tests__/integration/stdout-parser.test.ts`

- [ ] **Step 1: Read the existing output-parser.ts (full content)**

Run: `cat src/core/orchestrator/output-parser.ts`

Note the public API that must be preserved:
- `type EntryKind`
- `interface TranscriptEntry`
- `function parseLine(line, lineNumber): TranscriptEntry[]`
- `function parseTextLine(line, lineNumber): TranscriptEntry[]`
- `function getParser(outputFormat): (line, lineNumber) => TranscriptEntry[]`

- [ ] **Step 2: Define the port**

Create `src/core/ports/stdout-parser.ts`:

```ts
/**
 * StdoutParser port — converts subprocess stdout lines into typed transcript entries.
 *
 * Implementations live in src/adapters/. The orchestrator resolves a parser
 * factory from the registry based on a driver's output_format field.
 */

export type EntryKind =
  | 'text'
  | 'tool_call'
  | 'tool_result'
  | 'result'
  | 'system'
  | 'raw';

export interface TranscriptEntry {
  id: string;
  kind: EntryKind;
  lineNumber: number;
  text?: string;
  toolName?: string;
  toolCommand?: string;
  toolOutput?: string;
  isError?: boolean;
  cost?: number;
}

export type LineParser = (line: string, lineNumber: number) => TranscriptEntry[];

export interface StdoutParser {
  /**
   * Select a line parser by driver output format.
   * Throws `Error('unknown output format: <format>')` on unknown formats.
   */
  getParser(outputFormat: string): LineParser;
}
```

- [ ] **Step 3: Write the failing test**

Create `src/__tests__/integration/stdout-parser.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { registry } from '@/config/registry';
import { bootstrap } from '@/config/bootstrap';
import type { StdoutParser } from '@/core/ports/stdout-parser';

describe('stdout parser adapter', () => {
  beforeAll(() => {
    bootstrap();
  });

  it('registers and resolves the stdoutParser adapter', () => {
    const p = registry.get<StdoutParser>('stdoutParser');
    expect(p).toBeDefined();
    expect(typeof p.getParser).toBe('function');
  });

  it('stream-json parser produces TranscriptEntries from an assistant text event', () => {
    const p = registry.get<StdoutParser>('stdoutParser');
    const parse = p.getParser('stream-json');
    const line = JSON.stringify({
      type: 'assistant',
      message: { id: 'msg_1', content: [{ type: 'text', text: 'hello' }] },
    });
    const entries = parse(line, 1);
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe('text');
    expect(entries[0].text).toBe('hello');
  });

  it('stream-json parser produces a tool_call entry', () => {
    const p = registry.get<StdoutParser>('stdoutParser');
    const parse = p.getParser('stream-json');
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg_2',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'bash', input: { command: 'ls' } }],
      },
    });
    const entries = parse(line, 1);
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe('tool_call');
    expect(entries[0].toolName).toBe('bash');
    expect(entries[0].toolCommand).toBe('ls');
  });

  it('text parser produces a single text entry', () => {
    const p = registry.get<StdoutParser>('stdoutParser');
    const parse = p.getParser('text');
    const entries = parse('plain output', 1);
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe('text');
    expect(entries[0].text).toBe('plain output');
  });

  it('unknown output format throws', () => {
    const p = registry.get<StdoutParser>('stdoutParser');
    expect(() => p.getParser('does-not-exist')).toThrow(/unknown output format/);
  });

  it('non-JSON stream-json line becomes raw entry', () => {
    const p = registry.get<StdoutParser>('stdoutParser');
    const parse = p.getParser('stream-json');
    const entries = parse('not json', 5);
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe('raw');
    expect(entries[0].text).toBe('not json');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/__tests__/integration/stdout-parser.test.ts`

Expected: FAIL — `Adapter "stdoutParser" is not registered`

- [ ] **Step 5: Implement the adapter**

Create `src/adapters/subprocess/stdout-parser.ts`. Copy the full logic from `src/core/orchestrator/output-parser.ts`, changing only:

- File-level docstring references from "driver output" framing (preserve) but note relocation.
- Replace standalone `export function getParser` with a class method.
- Re-import the types from the new port instead of defining them locally.

Content:

```ts
/**
 * Subprocess StdoutParser adapter.
 *
 * Parses subprocess stdout lines into typed transcript entries. Supports:
 * - 'stream-json' — one JSON event per line (Claude Code CLI transcript shape)
 * - 'text' — plain text, one entry per line
 *
 * This is the adapter-layer implementation of the StdoutParser port.
 * Resolved via the registry — never imported directly by orchestrator code.
 */
import type {
  StdoutParser,
  LineParser,
  TranscriptEntry,
} from '@/core/ports/stdout-parser';

function parseStreamJsonLine(line: string, lineNumber: number): TranscriptEntry[] {
  // ─── Full body copied verbatim from the old parseLine in output-parser.ts ───
  const trimmed = line.trim();
  if (!trimmed) return [];

  if (!trimmed.startsWith('{')) {
    return [{ id: `raw-${lineNumber}`, kind: 'raw', lineNumber, text: trimmed }];
  }

  let evt: Record<string, unknown>;
  try {
    evt = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return [{ id: `raw-${lineNumber}`, kind: 'raw', lineNumber, text: trimmed }];
  }

  const type = String(evt.type ?? '');
  const entries: TranscriptEntry[] = [];

  if (type === 'assistant') {
    const msg = (evt.message ?? {}) as Record<string, unknown>;
    const msgId = String(msg.id ?? evt.uuid ?? lineNumber);
    const parts = (msg.content as unknown[]) ?? [];

    for (const part of parts) {
      const p = part as Record<string, unknown>;
      if (p.type === 'text') {
        const text = String(p.text ?? '').trim();
        if (text) {
          entries.push({
            id: `${msgId}-text-${entries.length}`,
            kind: 'text',
            lineNumber,
            text,
          });
        }
      } else if (p.type === 'tool_use') {
        const input = (p.input ?? {}) as Record<string, unknown>;
        const cmd = String(
          input.command ?? input.description ?? JSON.stringify(input),
        ).slice(0, 300);
        entries.push({
          id: String(p.id ?? `${msgId}-tool-${entries.length}`),
          kind: 'tool_call',
          lineNumber,
          toolName: String(p.name ?? ''),
          toolCommand: cmd,
        });
      }
    }
    return entries;
  }

  if (type === 'user') {
    const msg = (evt.message ?? {}) as Record<string, unknown>;
    const parts = (msg.content as unknown[]) ?? [];

    for (const part of parts) {
      const p = part as Record<string, unknown>;
      if (p.type === 'tool_result') {
        const toolUseId = String(p.tool_use_id ?? '');
        const isError = Boolean(p.is_error);
        let output = '';
        const raw = p.content;
        if (typeof raw === 'string') {
          output = raw;
        } else if (Array.isArray(raw)) {
          output = (raw as unknown[])
            .map((c) => String((c as Record<string, unknown>).text ?? ''))
            .join('');
        }
        entries.push({
          id: `result-${toolUseId}-${lineNumber}`,
          kind: 'tool_result',
          lineNumber,
          toolOutput: output.trim(),
          isError,
        });
      }
    }
    return entries;
  }

  if (type === 'result') {
    const isError = Boolean(evt.is_error);
    const text = String(evt.result ?? '').trim();
    const cost = typeof evt.total_cost_usd === 'number' ? evt.total_cost_usd : undefined;
    return [{
      id: `result-${lineNumber}`,
      kind: 'result',
      lineNumber,
      text,
      isError,
      cost,
    }];
  }

  if (type === 'system') {
    const subtype = String(evt.subtype ?? '');
    const text = String(evt.message ?? evt.text ?? subtype).trim();
    return [{
      id: `system-${lineNumber}`,
      kind: 'system',
      lineNumber,
      text: text || subtype,
    }];
  }

  return [{ id: `raw-${lineNumber}`, kind: 'raw', lineNumber, text: trimmed }];
}

function parseTextLine(line: string, lineNumber: number): TranscriptEntry[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  return [{ id: `text-${lineNumber}`, kind: 'text', lineNumber, text: trimmed }];
}

export class SubprocessStdoutParser implements StdoutParser {
  getParser(outputFormat: string): LineParser {
    switch (outputFormat) {
      case 'stream-json':
        return parseStreamJsonLine;
      case 'text':
        return parseTextLine;
      default:
        throw new Error(`unknown output format: ${outputFormat}`);
    }
  }
}
```

- [ ] **Step 6: Register in bootstrap**

Modify `src/config/bootstrap.ts`:

Add import:

```ts
import { SubprocessStdoutParser } from '@/adapters/subprocess/stdout-parser';
```

Add registration (place with the other subprocess-related adapter, `executor`):

```ts
  // Stdout Parser — subprocess output line parser
  registry.register('stdoutParser', () => {
    return new SubprocessStdoutParser();
  });
```

**Decision: do NOT add `'stdoutParser'` to `REQUIRED_ADAPTERS`.** The parser is only used when the orchestrator runs a stage, which is not every app start. Lazy resolution is correct. (Matches how `executor` is registered but not required.)

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/__tests__/integration/stdout-parser.test.ts`

Expected: PASS (6 tests).

- [ ] **Step 8: Run full test suite**

Run: `npx vitest run`

Expected: all green (117 + 6 = 123 tests passing).

- [ ] **Step 9: Commit**

```bash
git add src/core/ports/stdout-parser.ts src/adapters/subprocess/stdout-parser.ts src/config/bootstrap.ts src/__tests__/integration/stdout-parser.test.ts
git commit -m "feat(adapters): add SubprocessStdoutParser port + adapter

Defines the StdoutParser port in core/ports/ and implements it in
adapters/subprocess/. Logic is a literal relocation of
core/orchestrator/output-parser.ts — no behavior changes.

Registered in bootstrap as 'stdoutParser'. Not in REQUIRED_ADAPTERS
because the parser is only used when the orchestrator runs a stage."
```

---

## Task 6: Migrate orchestrator consumers and delete output-parser.ts

**Files:**
- Modify: `src/core/orchestrator/stage-runner.ts`
- Modify: `src/components/pipeline/LiveOutput.tsx`
- Delete: `src/core/orchestrator/output-parser.ts`

- [ ] **Step 1: Find all consumers of the old module**

Run: `grep -rn "from '@/core/orchestrator/output-parser'\|from './output-parser'" src/`

Confirmed consumers (from spec reconciliation): `src/core/orchestrator/stage-runner.ts`, `src/components/pipeline/LiveOutput.tsx`.

- [ ] **Step 2: Migrate stage-runner.ts**

In `src/core/orchestrator/stage-runner.ts`:

Replace:

```ts
import { getParser } from './output-parser';
```

with:

```ts
import { registry } from '@/config/registry';
import type { StdoutParser } from '@/core/ports/stdout-parser';
```

Find the line (around L262):

```ts
const lineParser = getParser(driverRow.outputFormat as string);
```

Replace with:

```ts
const lineParser = registry
  .get<StdoutParser>('stdoutParser')
  .getParser(driverRow.outputFormat as string);
```

- [ ] **Step 3: Migrate LiveOutput.tsx (type import + parseLine usage)**

In `src/components/pipeline/LiveOutput.tsx`:

Replace:

```ts
import type { TranscriptEntry, EntryKind } from '@/core/orchestrator/output-parser';
import { parseLine } from '@/core/orchestrator/output-parser';
```

with:

```ts
import type { TranscriptEntry, EntryKind } from '@/core/ports/stdout-parser';
import { registry } from '@/config/registry';
import type { StdoutParser } from '@/core/ports/stdout-parser';
```

Find the `parseLine(line.content, line.lineNumber)` call (around L108). Replace it. The parser is resolved once per effect; hoist resolution outside the render hot path:

```ts
// Near the top of the component body, after hooks:
const parseLine = useMemo(
  () => registry.get<StdoutParser>('stdoutParser').getParser('stream-json'),
  [],
);

// At the call site (unchanged):
const results = parseLine(line.content, line.lineNumber);
```

`useMemo` import must be present — add `useMemo` to the existing React import if missing.

If LiveOutput is used by drivers whose `output_format` is not `'stream-json'`, this hardcode is wrong. Verify: `grep -n 'output_format\|outputFormat' src/components/pipeline/LiveOutput.tsx`. If there is already dynamic format selection, pass that value to `getParser` instead of hardcoding. If the component only ever handled `stream-json` historically (the old `parseLine` was the stream-json parser), hardcoding is preserving behavior.

- [ ] **Step 4: Delete the old file**

```bash
git rm src/core/orchestrator/output-parser.ts
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors. If any import still references `@/core/orchestrator/output-parser`, a consumer was missed — grep again and migrate.

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`

Expected: all green. Prior tests that imported from `output-parser.ts` (if any) must have been migrated to import from the port. Check with: `grep -rn 'output-parser' src/__tests__/`. If any remain, update imports to `@/core/ports/stdout-parser` and/or remove if superseded by the new `stdout-parser.test.ts`.

- [ ] **Step 7: Invariant grep sweep**

Run: `grep -rn "from '@/core/orchestrator/output-parser'\|from './output-parser'" src/`

Expected: zero matches.

Run: `grep -rn 'parseLine\|parseTextLine' src/ --include='*.ts' --include='*.tsx' | grep -v 'stdout-parser' | grep -v '__tests__' | grep -v 'registry.get'`

Expected: zero matches outside the adapter (call sites now go through `getParser` off the registry-resolved instance).

- [ ] **Step 8: Browser smoke check**

Start: `npm run dev`

Run a pipeline stage that streams output. Confirm LiveOutput renders entries correctly (text, tool_call, tool_result, result). Close dev server.

- [ ] **Step 9: Commit**

```bash
git add src/core/orchestrator/stage-runner.ts src/components/pipeline/LiveOutput.tsx
git rm src/core/orchestrator/output-parser.ts
git commit -m "refactor(orchestrator): route stdout parser through adapter registry

Replaces direct imports of core/orchestrator/output-parser.ts with
registry.get<StdoutParser>('stdoutParser').getParser(format).

- stage-runner.ts resolves the parser from driver.outputFormat
- LiveOutput.tsx memoizes the stream-json parser once per mount
- core/orchestrator/output-parser.ts deleted — logic lives in
  src/adapters/subprocess/stdout-parser.ts

Invariant 7: src/core/ no longer contains subprocess-output parsing
logic."
```

---

## Task 7: Transactional issue-comment soft-delete

**Files:**
- Modify: `src/core/services/issue-comment.ts`
- Test: `src/__tests__/integration/issue-comment.test.ts`

- [ ] **Step 1: Read the current softDelete implementation**

Run: `cat src/core/services/issue-comment.ts`

Identify the existing `softDelete` method. Note the three writes it currently performs (event insert capturing pre-delete body, body-clear update, `deleted_at` set). Note the `update` method for the same pattern assessment.

- [ ] **Step 2: Write the failing test**

Add to `src/__tests__/integration/issue-comment.test.ts` (create new describe block if needed):

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { registry } from '@/config/registry';
import { bootstrap } from '@/config/bootstrap';
import type { DatabaseProvider } from '@/core/ports/database';
import { createIssueCommentService } from '@/core/services/issue-comment';
import { issueComment, issueEvent } from '@/core/db/schema';
import { eq } from 'drizzle-orm';
// Plus whatever imports exist in the existing test file for seed helpers

describe('softDelete — transactional atomicity', () => {
  beforeAll(() => {
    bootstrap();
  });

  it('rolls back all writes when the version check fails', async () => {
    const db = registry.get<DatabaseProvider>('database').db();
    const svc = createIssueCommentService(db);

    // Seed a comment (use existing helpers or inline — reuse the pattern
    // from the existing tests in this file)
    const seeded = /* ... create an issue, then a comment at version 1 ... */;

    // Attempt soft-delete with wrong version
    const result = await svc.softDelete(seeded.commentId, {
      deletedBy: 'test-user',
      version: 999, // deliberately wrong
    });

    // Assert the call indicated failure (null return, error thrown, or
    // whatever the current contract is — confirm from step 1 reading)
    expect(result).toBe(null); // adjust to match the current contract

    // Verify the DB state is untouched:
    const [row] = await db
      .select()
      .from(issueComment)
      .where(eq(issueComment.id, seeded.commentId));
    expect(row.deletedAt).toBeNull();
    expect(row.bodyMd).not.toBeNull(); // body was not cleared
    expect(row.version).toBe(1); // version not bumped

    // Verify no pre-delete event was written:
    const events = await db
      .select()
      .from(issueEvent)
      .where(eq(issueEvent.issueId, seeded.issueId));
    // Count events related to deletion — there should be none beyond seed
    const deletionEvents = events.filter((e) => e.kind === 'comment_deleted'); // adjust to match real kind
    expect(deletionEvents.length).toBe(0);
  });

  it('commits all writes when the version check passes', async () => {
    // Happy-path mirror of the above — confirms the transaction commits
    // correctly. Omit if the existing suite already covers this.
  });
});
```

Adjust the assertion style, seed helpers, and field names to match what's in the existing `issue-comment.test.ts` file. The test's point is: on version mismatch, `deletedAt` stays null, `bodyMd` stays non-null, `version` stays 1, and no deletion event exists.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/integration/issue-comment.test.ts`

Expected: FAIL — current non-transactional implementation will either (a) half-apply writes before the version check catches it, or (b) apply nothing but in separate round-trips the assertion set still sees the wrong state. The exact failure mode reveals what's currently atomic by accident versus what isn't.

If the test unexpectedly passes, the current code is already atomic (perhaps Drizzle batches under the hood). In that case, still wrap in an explicit transaction for clarity — the wrap is a readability improvement even if the DB already behaves correctly.

- [ ] **Step 4: Wrap softDelete in db.transaction**

In `src/core/services/issue-comment.ts`, find the `softDelete` method. Wrap its body in `db.transaction(async tx => { ... })`. Replace all `db.*` calls inside with `tx.*`. The version check remains inside — a version mismatch throws (or returns null, matching current contract), and the transaction auto-rolls-back on throw.

Pseudocode shape:

```ts
async softDelete(
  commentId: string,
  input: SoftDeleteCommentInput,
): Promise<IssueCommentSelect | null> {
  return db.transaction(async (tx) => {
    // 1. Read the current comment (version check prep)
    const [current] = await tx
      .select()
      .from(issueComment)
      .where(eq(issueComment.id, commentId));
    if (!current || current.version !== input.version) {
      return null; // or throw — match existing contract from step 1
    }

    // 2. Insert the pre-delete event capturing original body
    await tx.insert(issueEvent).values({ /* ... */ });

    // 3. Update the comment: clear body, bump version, set deleted_at
    const [updated] = await tx
      .update(issueComment)
      .set({
        bodyMd: null,
        bodyHtml: null,
        deletedAt: new Date(),
        deletedBy: input.deletedBy,
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(issueComment.id, commentId), eq(issueComment.version, input.version)))
      .returning();

    return updated;
  });
}
```

The exact shape must match the pre-existing `softDelete` body — the only structural change is the `db.transaction` wrap and the `db.*` → `tx.*` substitution. Preserve all business logic.

- [ ] **Step 5: Consider the `update` method**

If `update` also has a multi-statement sequence (version check → edit event insert → body update), apply the same wrap. If it's a single statement, leave it alone.

Read criterion: does the method do more than one `db.*` call? If yes, wrap. If no, skip.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/__tests__/integration/issue-comment.test.ts`

Expected: PASS — version mismatch now leaves the DB completely untouched.

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run`

Expected: all green (123 + 2 = 125 tests, adjust for exact counts).

- [ ] **Step 8: Commit**

```bash
git add src/core/services/issue-comment.ts src/__tests__/integration/issue-comment.test.ts
git commit -m "fix(issue-comment): wrap softDelete in db.transaction for atomicity

The previous softDelete issued three separate statements (pre-delete
event insert, body-clear update, deleted_at set). A crash or version
mismatch between statements left the comment half-deleted.

Now wrapped in db.transaction(async tx => ...) with all writes going
through tx. Version mismatch throws inside the transaction; the
transaction rolls back cleanly. No API change.

Also applies same pattern to update() where it performs multiple writes."
```

(Adjust the commit message if `update` didn't need the wrap.)

---

## Task 8: Invariants note clarifying src/lib/ scope

**Files:**
- Modify: `docs/invariants.md`

- [ ] **Step 1: Read the existing invariant 7 text**

Run: `grep -n -A 5 'Invariant 7\|invariant 7\|^#.*7\.' docs/invariants.md | head -30`

Identify where invariant 7 is defined and the file-layout section.

- [ ] **Step 2: Add a short clarification**

Append to the invariant 7 section (not as a new invariant; as a scoping note) exact text:

```markdown
**Scope clarification:** Invariant 7 partitions `src/core/` (pure domain logic, depends only on ports) from `src/adapters/` (pluggable vendor implementations). `src/lib/` is **framework glue** — Next.js cookie bridging, React hooks, tRPC client wiring — and is exempt from this rule. Specifically, `src/lib/supabase/` using `@supabase/ssr` for SSR session handling is not a violation; the `@supabase/ssr` package solves a Next.js-framework problem (server-component cookie continuity) that the `AuthProvider` port does not and should not model.

Audit findings flagging `src/lib/` as a core-vs-adapter violation should be closed as false positives under this clarification.
```

If invariant 7 is laid out as numbered paragraphs, insert the clarification as the last paragraph of that invariant.

- [ ] **Step 3: Type/lint check passes (doc-only change)**

No code change; skip tsc.

- [ ] **Step 4: Commit**

```bash
git add docs/invariants.md
git commit -m "docs(invariants): clarify src/lib/ is framework glue, exempt from invariant 7

R-REM-W2 audit reconciliation revealed that src/lib/supabase/ using
@supabase/ssr was flagged as a core-vs-adapter violation. That's a
misread: src/lib/ is Next.js framework glue (cookie bridging, SSR
helpers), not core or adapter. Adds a short scope-clarification
paragraph to invariant 7."
```

---

## Task 9: Verification matrix + handoff

**Files:**
- Create: `docs/superpowers/handoffs/2026-04-<date>-r-rem-w2-session-handoff.md` (date set when executing)

- [ ] **Step 1: Run the full verification matrix**

Commands:

```bash
npx tsc --noEmit
```
Expected: zero errors.

```bash
npx vitest run
```
Expected: all green. Approximate total: pre-W2 115 + new tests from this plan.

```bash
npx tsx src/scripts/db/nuke.ts && npm run db:seed && npm run verify
```
Expected: 10/10 PASS.

```bash
npm run db:issues
npm run db:runs
npm run db:gates
npm run db:events
```
Expected: each runs without error.

```bash
npm run lint
```
Expected: same violation count as `main` (zero new violations). Compare by: checkout `main`, run lint, note count; checkout W2 branch, run lint, confirm equal.

- [ ] **Step 2: Run the invariant grep sweeps**

```bash
# No .channel( calls outside the realtime adapter
grep -rn '\.channel(' src/ --include='*.ts' --include='*.tsx' | grep -v 'src/adapters/supabase/' | grep -v '__tests__'
```
Expected: zero output.

```bash
# No direct imports of the deleted output-parser file
grep -rn "from '@/core/orchestrator/output-parser'\|from './output-parser'" src/
```
Expected: zero output.

```bash
# No subprocess-output parsing logic in core orchestrator
grep -rn 'parseLine\|parseTextLine' src/core/ --include='*.ts' | grep -v '__tests__' | grep -v 'registry.get'
```
Expected: zero output.

Record the results in the handoff doc.

- [ ] **Step 3: Browser verification (invariant 21)**

Start: `npm run dev`

Manual flow, recorded in the handoff:
1. Open the app at `http://192.168.54.101:<port>`.
2. Log in.
3. Open a project.
4. Create an issue.
5. Edit the issue (confirm update works).
6. Add a comment, delete the comment (confirm soft-delete works end-to-end).
7. Start a pipeline run (or navigate to an in-progress one).
8. Confirm LiveOutput streams entries.
9. Open RunDetailModal; confirm it updates as stages progress.
10. Open browser DevTools console — confirm zero errors throughout.

Close dev server. Record "user-confirmed ✅" in the handoff if everything passes.

- [ ] **Step 4: Write the handoff document**

Create `docs/superpowers/handoffs/2026-04-<date>-r-rem-w2-session-handoff.md` with the structure used by prior handoffs. Include:

- Status one-liner.
- Commits shipped (from `git log main..HEAD --oneline`).
- Verification matrix table (tsc / vitest / verify / lint / grep-sweeps / browser).
- Diff against `main` (line count summary).
- Any loose ends or follow-ups surfaced during implementation.
- Next-session instructions (open PR, merge, roadmap flip).

- [ ] **Step 5: Commit the handoff**

```bash
git add docs/superpowers/handoffs/2026-04-<date>-r-rem-w2-session-handoff.md
git commit -m "docs(handoff): R-REM-W2 architecture remediation — verified, awaiting PR

Realtime routed through adapter registry (2 consumers migrated).
StdoutParser port + adapter; output-parser.ts deleted from core.
Issue-comment softDelete wrapped in db.transaction.
invariants.md clarification on src/lib/ scope.

Verification: tsc clean, vitest all green, verify 10/10, lint baseline,
invariant grep sweeps clean, browser user-confirmed."
```

---

## Execution close

After Task 9 commits, hand off to `superpowers:finishing-a-development-branch` to open the PR, merge to main, and flip the roadmap (similar to the W1 close-out sequence).

---

## Self-Review

**Spec coverage:**

- Spec item 1 (realtime registry routing) → Tasks 1, 2, 3, 4.
- Spec item 2 (Anthropic protocol parser → corrected to stdout parser) → Tasks 5, 6.
- Spec item 3 (transactional issue-comment soft-delete) → Task 7.
- Spec item: `docs/invariants.md` clarification on `src/lib/` → Task 8.
- Spec testing (tsc, vitest, verify, invariant grep, browser) → Task 9.

All three spec items covered; no gaps.

**Placeholder scan:**

- Task 2 Step 2: "The current shape is approximately" — acceptable, because the exact lines vary slightly from what I read from grep output (I didn't read the full file). The step is prescriptive enough that a careful engineer will read the actual file and preserve behavior.
- Task 7 Step 2: test uses `/* ... create an issue, then a comment at version 1 ... */` — inline seed helper. Acceptable because the engineer is explicitly told to "reuse the pattern from the existing tests in this file" and the existing test file is a short read.
- Task 7 Step 4: pseudocode shape with explicit "exact shape must match pre-existing softDelete body." Acceptable because the plan tells the engineer to preserve business logic and shows the transaction-wrap structure.
- Task 9 Step 4: "include X, Y, Z" rather than a full template. Acceptable because the W1 handoff exists as a template to model on, and the structure is listed concretely.

No hidden TBDs or "implement later" anywhere.

**Type consistency:**

- `TranscriptEntry`, `EntryKind`, `LineParser`, `StdoutParser` used consistently across Tasks 5-6.
- `RealtimeProvider`, `subscribeToTable` used consistently across Tasks 1-3.
- `Unsubscribe` imported from `@/core/ports/auth` in Task 1 (matches the port's import pattern in `realtime.ts`).

All names consistent across tasks.

**Scope check:** three spec items + one doc clarification + verification. Focused. No drift into CRUD factory migration, pipelineRun versioning, or auth port work — all out-of-scope per the revised spec.
