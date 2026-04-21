# DEF-011 LiveOutput Payload-Consumer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `LiveOutput.tsx` consume persisted `TranscriptEntry` payloads directly instead of re-parsing `payload.content` through the stream-json parser, so `tool_call` / `tool_result` / `result` entries render with their dedicated UI instead of collapsing into plain text.

**Architecture:** The orchestrator already emits typed `TranscriptEntry` records and persists them to `event.payload`. This plan (a) drops the redundant `content` projection in the orchestrator, (b) normalizes the stderr and invalid-signal-error payloads to `TranscriptEntry` shape, (c) rewrites LiveOutput to consume `event.payload` as a `TranscriptEntry` with no re-parse, (d) adds `isStderr` to the port type and amber styling for it, (e) redesigns the Raw JSON toggle to show every persisted event payload pretty-printed, and (f) tightens the journey test to assert ≥ 1 `tool_call` span rendered.

**Tech Stack:** TypeScript 5, Next.js 16 App Router, React 19, tRPC v11, Drizzle ORM, Tailwind CSS 4, Playwright (e2e), Vitest (integration). No unit tests — see `feedback_no_unit_tests.md`.

**Spec:** `docs/superpowers/specs/2026-04-21-def-011-liveoutput-payload-consumer-design.md`
**Bug:** `docs/superpowers/deferred-fixes.md` — DEF-011
**Branch:** `spec/def-011-liveoutput-payload-consumer` (spec already committed on this branch; implementation continues here or cut a fresh branch per operator preference).

---

## File Structure

Files touched (exact paths):

| File | Responsibility | Change type |
|---|---|---|
| `src/core/ports/stdout-parser.ts` | `TranscriptEntry` interface — canonical entry shape | Modify (add one optional field) |
| `src/core/orchestrator/stage-runner.ts` | Spawn subprocess, parse stdout, persist events | Modify (normalize 3 `appendEvent` payloads) |
| `src/components/pipeline/LiveOutput.tsx` | Render transcript pane in RunDetailModal | Modify (remove re-parse pipeline; consume payloads directly; stderr styling; Raw JSON pane rewrite) |
| `e2e/real-anthropic-stage-run.spec.ts` | Live-Claude journey test | Modify (tighten assertion; delete workaround comment) |
| `docs/superpowers/deferred-fixes.md` | Deferred-findings log | Modify (mark DEF-011 RESOLVED) |

No new files. No deletions. No migrations. No adapter changes outside the port type.

---

## Task 1: Add `isStderr` to the `TranscriptEntry` port type

**Files:**
- Modify: `src/core/ports/stdout-parser.ts` (the `TranscriptEntry` interface around lines 16-26)

Why first: later tasks rely on this field existing on the type. Without it, the `satisfies TranscriptEntry` assertions in Task 2 and the `entry.isStderr` access in Task 4 will fail `npm run lint` with TypeScript errors.

- [ ] **Step 1: Add the `isStderr` field to the interface**

Modify `src/core/ports/stdout-parser.ts`. Replace the existing `TranscriptEntry` interface (currently lines 16-26):

```ts
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
```

With:

```ts
export interface TranscriptEntry {
  id: string;
  kind: EntryKind;
  lineNumber: number;
  text?: string;
  toolName?: string;
  toolCommand?: string;
  toolOutput?: string;
  isError?: boolean;
  isStderr?: boolean;
  cost?: number;
}
```

- [ ] **Step 2: Run the TypeScript compiler to confirm the port type still compiles**

Run: `npx tsc --noEmit`
Expected: exits 0 with no errors. If it errors, the only possible cause is a stale file in the workspace; re-read `src/core/ports/stdout-parser.ts` and re-apply the change.

- [ ] **Step 3: Commit**

```bash
git add src/core/ports/stdout-parser.ts
git commit -m "feat(ports): add isStderr field to TranscriptEntry

Optional boolean on TranscriptEntry so the stage-runner can flag
stderr lines without drifting from the port contract. Used in the
LiveOutput raw-kind renderer to style stderr amber (DEF-011)."
```

---

## Task 2: Normalize orchestrator event payloads to `TranscriptEntry`

**Files:**
- Modify: `src/core/orchestrator/stage-runner.ts` at three call sites:
  - The invalid-signal error path (currently lines 287-296)
  - The normal stdout-output path (currently lines 298-308)
  - The stderr path (currently lines 311-321)

The imports at the top of this file already include `EVENT_TYPE` and `StdoutParser`, but NOT `TranscriptEntry`. Step 1 adds the missing import.

- [ ] **Step 1: Add `TranscriptEntry` to the stdout-parser import**

Find (at line 30):

```ts
import type { StdoutParser } from '@/core/ports/stdout-parser';
```

Replace with:

```ts
import type { StdoutParser, TranscriptEntry } from '@/core/ports/stdout-parser';
```

- [ ] **Step 2: Normalize the invalid-signal error payload**

Find (currently lines 287-296 — the `catch (err) { ... }` block inside the stdout processing loop):

```ts
          } catch (err) {
            // Invalid signal — store the error as an event and continue
            lineNumber++;
            runService
              .appendEvent(sRun.id, EVENT_TYPE.error, {
                lineNumber,
                content: err instanceof Error ? err.message : String(err),
                kind: 'system',
              })
              .catch(logError);
            continue;
          }
```

Replace with:

```ts
          } catch (err) {
            // Invalid signal — store the error as an event and continue
            lineNumber++;
            runService
              .appendEvent(sRun.id, EVENT_TYPE.error, {
                id: `sig-err-${lineNumber}`,
                kind: 'system',
                lineNumber,
                text: err instanceof Error ? err.message : String(err),
              } satisfies TranscriptEntry)
              .catch(logError);
            continue;
          }
```

- [ ] **Step 3: Drop the redundant `content` projection on output events**

Find (currently lines 298-308):

```ts
          // Normal output — parse and store immediately
          lineNumber++;
          const entries = lineParser(line, lineNumber);
          for (const entry of entries) {
            runService
              .appendEvent(sRun.id, EVENT_TYPE.output, {
                ...entry,
                content: entry.text ?? entry.toolCommand ?? entry.toolOutput ?? '',
              })
              .catch(logError);
          }
```

Replace with:

```ts
          // Normal output — parse and store immediately
          lineNumber++;
          const entries = lineParser(line, lineNumber);
          for (const entry of entries) {
            runService
              .appendEvent(sRun.id, EVENT_TYPE.output, entry)
              .catch(logError);
          }
```

- [ ] **Step 4: Normalize the stderr payload to a `TranscriptEntry`**

Find (currently lines 311-321):

```ts
      onStderr: (data: string) => {
        lineNumber++;
        runService
          .appendEvent(sRun.id, EVENT_TYPE.output, {
            lineNumber,
            content: data.trim(),
            kind: 'raw',
            isStderr: true,
          })
          .catch(logError);
      },
```

Replace with:

```ts
      onStderr: (data: string) => {
        lineNumber++;
        runService
          .appendEvent(sRun.id, EVENT_TYPE.output, {
            id: `stderr-${lineNumber}`,
            kind: 'raw',
            lineNumber,
            text: data.trim(),
            isStderr: true,
          } satisfies TranscriptEntry)
          .catch(logError);
      },
```

- [ ] **Step 5: Run the TypeScript compiler**

Run: `npx tsc --noEmit`
Expected: exits 0. Any error here means the `satisfies TranscriptEntry` constraint caught a mismatch — re-read the three blocks and confirm every required field (`id`, `kind`, `lineNumber`) is present and no unknown fields slipped in.

- [ ] **Step 6: Commit**

```bash
git add src/core/orchestrator/stage-runner.ts
git commit -m "refactor(orchestrator): persist output events as TranscriptEntry

Drop the redundant content projection; normalize the stderr and
invalid-signal-error paths to TranscriptEntry shape. LiveOutput will
now consume event.payload as-is without re-parsing (DEF-011).

No schema change: event.payload stays jsonb free-form. The contract
is enforced at the port layer and honored by convention on both ends."
```

---

## Task 3: Rewrite `LiveOutput.tsx` to consume payloads directly

**Files:**
- Modify: `src/components/pipeline/LiveOutput.tsx`

This is the biggest task. Three logical blocks change: imports, the `parseLine` / `rawLines` / `entries` pipeline (replaced with a single `entries` memo), and the `handleCopy` raw-mode branch. The render map and the Raw JSON pane itself are touched in Task 5 — this task leaves them compiling but with stubbed data sources.

- [ ] **Step 1: Update the imports at the top of the file**

Find (currently line 8):

```ts
import type { TranscriptEntry, EntryKind, StdoutParser } from '@/core/ports/stdout-parser';
```

Replace with:

```ts
import type { TranscriptEntry, EntryKind } from '@/core/ports/stdout-parser';
```

Note: `StdoutParser` is no longer needed on the client side. `EntryKind` is still used by the `system` entry synthesis below.

- [ ] **Step 2: Delete the `parseLine` memo and the `rawLines` intermediate memo**

Find (currently lines 81-106):

```ts
  // Resolve the stdout parser once per mount via the adapter registry
  const parseLine = useMemo(
    () => registry.get<StdoutParser>('stdoutParser').getParser('stream-json'),
    [],
  );

  // Fetch existing events
  const eventsQuery = trpc.pipeline.runs.events.useQuery(
    { stageRunId },
    {
      enabled: !!stageRunId,
      refetchInterval: isActive ? 2000 : false,
    },
  );

  const rawLines = useMemo(() => {
    return (eventsQuery.data ?? [])
      .filter((e) => e.type === EVENT_TYPE.output || e.type === EVENT_TYPE.launched || e.type === EVENT_TYPE.completed || e.type === EVENT_TYPE.error)
      .map((e, idx) => ({
        lineNumber: idx,
        content: typeof e.payload === 'object' && e.payload !== null
          ? (e.payload as Record<string, unknown>).content as string ?? JSON.stringify(e.payload)
          : String(e.payload),
        type: e.type,
      }));
  }, [eventsQuery.data]);
```

Replace with:

```ts
  // Fetch existing events
  const eventsQuery = trpc.pipeline.runs.events.useQuery(
    { stageRunId },
    {
      enabled: !!stageRunId,
      refetchInterval: isActive ? 2000 : false,
    },
  );
```

(i.e., delete the `parseLine` memo entirely and delete the `rawLines` memo entirely — keep only the `eventsQuery`.)

- [ ] **Step 3: Replace the `entries` memo with a payload-consumer version**

Find (currently lines 108-131 — the memo block starting with `// Parse into transcript entries`):

```ts
  // Parse into transcript entries
  const entries = useMemo(() => {
    const parsed: TranscriptEntry[] = [];
    for (const line of rawLines) {
      if (line.type === EVENT_TYPE.output) {
        // Try JSON parsing first (streaming driver output)
        const results = parseLine(line.content, line.lineNumber);
        // If parseLine only produced raw entries, promote to text for readability
        const promoted = results.map((entry) =>
          entry.kind === 'raw' ? { ...entry, kind: 'text' as EntryKind } : entry,
        );
        parsed.push(...promoted);
      } else {
        // Non-output events (launched, completed, etc.) become system entries
        parsed.push({
          id: `sys-${line.lineNumber}`,
          kind: 'system' as EntryKind,
          lineNumber: line.lineNumber,
          text: `[${line.type}] ${line.content}`,
        });
      }
    }
    return verbose ? parsed : parsed.filter((e) => e.kind !== 'system');
  }, [rawLines, verbose, parseLine]);
```

Replace with:

```ts
  // Consume event payloads as already-typed TranscriptEntry records.
  // Output events carry a TranscriptEntry in payload directly (see
  // stage-runner.ts). Non-output events (launched/completed/error)
  // synthesize a 'system' entry so verbose mode can surface them.
  const entries = useMemo<TranscriptEntry[]>(() => {
    const out: TranscriptEntry[] = [];
    for (const e of eventsQuery.data ?? []) {
      if (e.type === EVENT_TYPE.output) {
        out.push(e.payload as TranscriptEntry);
      } else if (
        e.type === EVENT_TYPE.launched ||
        e.type === EVENT_TYPE.completed ||
        e.type === EVENT_TYPE.error
      ) {
        const payload = (e.payload ?? {}) as Record<string, unknown>;
        const text = typeof payload.content === 'string'
          ? payload.content
          : typeof payload.message === 'string'
          ? payload.message
          : typeof payload.text === 'string'
          ? payload.text
          : JSON.stringify(payload);
        out.push({
          id: `sys-${e.id}`,
          kind: 'system' as EntryKind,
          lineNumber: 0,
          text: `[${e.type}] ${text}`,
        });
      }
    }
    return verbose ? out : out.filter((x) => x.kind !== 'system');
  }, [eventsQuery.data, verbose]);
```

Note: the non-output fallback chain also checks `payload.text` because Task 2 made the invalid-signal error payload use `text` (not `content`). Without that, the new normalized payload would fall through to `JSON.stringify(payload)` and render noisy.

- [ ] **Step 4: Update the `handleCopy` raw-mode branch**

Find (currently lines 167-179 — the `handleCopy` function's `rawJson` branch):

```ts
  const handleCopy = () => {
    let text: string;
    if (rawJson) {
      text = rawLines.map((l) => l.content).join('\n');
    } else {
      text = entries.map((e) => {
```

Replace with:

```ts
  const handleCopy = () => {
    let text: string;
    if (rawJson) {
      text = (eventsQuery.data ?? [])
        .map((e) => `${e.type} ${JSON.stringify(e.payload)}`)
        .join('\n');
    } else {
      text = entries.map((e) => {
```

(The `else` branch and everything after it stays unchanged in this task — it already iterates `entries` and handles every kind.)

- [ ] **Step 5: Run the TypeScript compiler and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exits 0 for both. Any error at this step means the new `entries` memo's type inference disagrees with the renderers — re-read the render dispatch map at the bottom of the file and confirm every branch still compiles. `StdoutParser` being removed from the import should drop cleanly; if lint complains about an unused `registry` import, leave `registry` alone — it's still used by the Realtime subscription `useEffect` below.

- [ ] **Step 6: Commit**

```bash
git add src/components/pipeline/LiveOutput.tsx
git commit -m "refactor(LiveOutput): consume event payloads as TranscriptEntry

Delete the stream-json re-parse path. The orchestrator persists typed
TranscriptEntry records directly to event.payload, so LiveOutput can
read them as-is. Non-output events (launched/completed/error) synthesize
a 'system' entry for verbose mode.

Part of DEF-011. Raw JSON pane and stderr styling follow in separate
commits; this one leaves the Raw JSON branch temporarily referencing
entries via the existing render path."
```

---

## Task 4: Add amber stderr styling to the `raw` renderer

**Files:**
- Modify: `src/components/pipeline/LiveOutput.tsx` at the `entry.kind === 'raw'` branch of the render dispatch map (currently lines 274-276).

- [ ] **Step 1: Update the raw renderer to switch on `isStderr`**

Find (currently lines 274-276 — the `raw` branch of the render map):

```tsx
              {entry.kind === 'raw' && (
                <div className="whitespace-pre-wrap py-0.5">{entry.text}</div>
              )}
```

Replace with:

```tsx
              {entry.kind === 'raw' && (
                <div className={`whitespace-pre-wrap py-0.5 ${
                  entry.isStderr ? 'text-amber-400 border-l-2 border-amber-400/40 pl-2' : ''
                }`}>
                  {entry.text}
                </div>
              )}
```

- [ ] **Step 2: Run lint + tsc**

Run: `npx tsc --noEmit && npm run lint`
Expected: exits 0 for both.

- [ ] **Step 3: Commit**

```bash
git add src/components/pipeline/LiveOutput.tsx
git commit -m "feat(LiveOutput): style stderr entries amber in raw renderer

Stderr rows get a left-border amber treatment (matches ToolResultEntry's
secondary-lane styling). Amber — not red — because stderr != error;
drivers legitimately log progress/warnings to stderr and red stays
reserved for isError terminal failures.

Part of DEF-011."
```

---

## Task 5: Redesign the Raw JSON toolbar pane

**Files:**
- Modify: `src/components/pipeline/LiveOutput.tsx` in four places: the line-count indicator (~line 205), the empty-state check (~line 253), and the Raw JSON render branch (~lines 256-263).

- [ ] **Step 1: Update the line-count indicator in the toolbar**

Find (currently lines 204-206):

```tsx
        <span className="text-xs text-slate-500">
          {rawJson ? `${rawLines.length} lines` : `${entries.length} entries`}
        </span>
```

Replace with:

```tsx
        <span className="text-xs text-slate-500">
          {rawJson
            ? `${(eventsQuery.data ?? []).length} events`
            : `${entries.length} entries`}
        </span>
```

- [ ] **Step 2: Update the empty-state and the Raw JSON render branch in the output pane**

Find (currently lines 253-263 — the beginning of the output-pane body):

```tsx
        {rawLines.length === 0 ? (
          <span className="text-slate-600">No output yet.</span>
        ) : rawJson ? (
          rawLines.map((line) => (
            <div key={line.lineNumber} className="leading-relaxed whitespace-pre-wrap">
              <span className="text-slate-600 select-none mr-3">
                {String(line.lineNumber + 1).padStart(4, ' ')}
              </span>
              {line.content}
            </div>
          ))
        ) : (
```

Replace with:

```tsx
        {(eventsQuery.data ?? []).length === 0 ? (
          <span className="text-slate-600">No output yet.</span>
        ) : rawJson ? (
          (eventsQuery.data ?? []).map((e, idx) => (
            <div key={e.id ?? idx} className="leading-relaxed whitespace-pre-wrap mb-2">
              <span className="text-slate-600 select-none mr-3">
                {String(idx + 1).padStart(4, ' ')}
              </span>
              <span className="text-soft-violet">{e.type}</span>
              <pre className="inline-block ml-2 text-slate-400">
                {JSON.stringify(e.payload, null, 2)}
              </pre>
            </div>
          ))
        ) : (
```

- [ ] **Step 3: Run tsc + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exits 0 for both.

- [ ] **Step 4: Commit**

```bash
git add src/components/pipeline/LiveOutput.tsx
git commit -m "feat(LiveOutput): Raw JSON pane shows full event payloads

Raw JSON toggle now renders every persisted event (not just outputs)
with a violet event-type prefix and pretty-printed JSON payload.
Counter reads 'M events' instead of 'N lines'. Copy in raw mode
emits 'type JSON' per line (Task 3 already handled the copy path).

Closes the DEF-011 refactor surface for LiveOutput."
```

---

## Task 6: Tighten the live-Claude journey test assertion

**Files:**
- Modify: `e2e/real-anthropic-stage-run.spec.ts` at the post-completion assertions (currently lines 95-115).

- [ ] **Step 1: Replace the transcript-populated assertion and delete the workaround comment**

Find (currently lines 95-115 — the block starting `// Assert the transcript pane rendered at least one entry.` and ending with `await expect(transcriptEntries.first()).toBeVisible({ timeout: 10_000 });`):

```ts
    // Assert the transcript pane rendered at least one entry. The output-pane
    // container (`.font-mono` inside the dialog) is the element that holds
    // every parsed transcript entry. Non-zero child count proves the run
    // streamed real output from the subprocess into the UI.
    //
    // NOTE: the plan initially called for asserting a `tool_call` entry
    // specifically (e.g. a `.text-soft-violet` span), but LiveOutput's parser
    // re-parses the event payloads as stream-json and the orchestrator
    // pre-extracts the tool command into the event's `content` field — so
    // the re-parse falls back to `raw` → `text` for every tool_use event and
    // no `ToolCallEntry` actually renders today. The events ARE persisted
    // with kind="tool_call" in the DB (`npm run db:events` confirms), but
    // the UI rendering pipeline collapses them to text entries. That's a
    // separate drift to fix post-alpha; for R-REM-W3-a's "engine observed
    // to work" unlock, asserting the pane populated is sufficient corroboration
    // alongside the terminal-completed status above.
    const transcriptEntries = page
      .locator('[aria-label="Run detail"]')
      .locator('.font-mono > div');

    await expect(transcriptEntries.first()).toBeVisible({ timeout: 10_000 });
```

Replace with:

```ts
    // Assert at least one tool_call entry rendered. `ToolCallEntry` emits
    // the tool name in a <span class="text-soft-violet font-medium"> (see
    // LiveOutput.tsx). A live Claude Research run reliably invokes at least
    // one tool (typically Read, Grep, or Glob), so the count must be >= 1.
    // This proves the tool_call kind made it from DB payload -> renderer,
    // which is the DEF-011 regression surface.
    const toolCallNames = page
      .locator('[aria-label="Run detail"]')
      .locator('.text-soft-violet.font-medium');

    await expect(toolCallNames.first()).toBeVisible({ timeout: 10_000 });
    expect(await toolCallNames.count()).toBeGreaterThanOrEqual(1);
```

- [ ] **Step 2: Run the journey test against the live endpoint**

Run (from the project root, with `.env.local` containing `ANTHROPIC_API_KEY` and `FLUXAOS_LAN_AUTH_BYPASS=1`; dev server running on `192.168.54.101:3003`):

```bash
set -a && source .env.local && set +a
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test e2e/real-anthropic-stage-run.spec.ts
```

Expected: 1 passed. Runtime typically 50s–3min. If it fails with "`.text-soft-violet.font-medium` not visible within 10s", the most likely causes are (a) the live Claude run completed with zero tool calls — rare for Research, retry once; (b) the RunDetailModal closed before the assertion — check the terminal-status poll timed out (its own 4-minute timeout).

- [ ] **Step 3: Commit**

```bash
git add e2e/real-anthropic-stage-run.spec.ts
git commit -m "test(e2e): tighten DEF-011 journey assertion to tool_call count

Assert >= 1 .text-soft-violet.font-medium span (the ToolCallEntry
tool-name pill) rendered, instead of the looser 'transcript pane has
children' check. This proves the tool_call kind survived the
DB-to-renderer path end-to-end.

Removes the DEF-011 workaround comment that described the re-parse bug."
```

---

## Task 7: Close DEF-011 in `deferred-fixes.md`

**Files:**
- Modify: `docs/superpowers/deferred-fixes.md` at the DEF-011 entry (currently starting at line 191).

- [ ] **Step 1: Mark DEF-011 as RESOLVED**

Find (currently line 191):

```markdown
## DEF-011 — `ToolCallEntry` never renders in `LiveOutput` because orchestrator/parser payload shapes disagree
```

Replace with:

```markdown
## DEF-011 [RESOLVED 2026-04-21] — `ToolCallEntry` never renders in `LiveOutput` because orchestrator/parser payload shapes disagree
```

Then append a "Resolution:" block immediately before the next heading (`## DEF-012 ...`). The full block to add, placed between the existing DEF-011 body and the `## DEF-012` heading:

```markdown

**Resolution (2026-04-21):** Option (a) shipped — LiveOutput stops re-parsing. Orchestrator's `EVENT_TYPE.output` payloads are now persisted as plain `TranscriptEntry` records (redundant `content` projection dropped). LiveOutput consumes `event.payload` directly; `stdout-parser` port gained an `isStderr?: boolean` field that stage-runner's stderr path sets and LiveOutput's `raw` renderer styles amber. Raw JSON toolbar rewritten to show all persisted events pretty-printed. Journey test assertion tightened to `.text-soft-violet.font-medium` count ≥ 1. Spec: `docs/superpowers/specs/2026-04-21-def-011-liveoutput-payload-consumer-design.md`. Plan: `docs/superpowers/plans/2026-04-21-def-011-liveoutput-payload-consumer.md`.

```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/deferred-fixes.md
git commit -m "docs(deferred-fixes): mark DEF-011 RESOLVED

LiveOutput now consumes event payloads as TranscriptEntry directly.
Tool_call / tool_result / result entries render with their dedicated
UI; stderr styled amber; Raw JSON pane rewritten; journey test
tightened. See spec and plan for details."
```

---

## Task 8: Fresh-state smoke verification

**Files:** none modified. Verification only.

- [ ] **Step 1: Nuke and re-seed the dev database**

Run:

```bash
npx tsx src/scripts/db/nuke.ts && npm run db:seed && npm run verify:seed
```

Expected: 10/10 PASS. If fewer pass, one of the earlier orchestrator changes silently broke seed or verify — re-read the failure and diagnose before proceeding. A common failure mode would be an error thrown during event insertion if the new payload shape is somehow invalid under the Drizzle schema; the `event.payload` column is `jsonb` so this shouldn't happen, but verify.

- [ ] **Step 2: Start the dev server**

Run (in a separate shell):

```bash
npm run dev -- -p 3003
```

Leave it running for the operator's browser verification (Task 9).

---

## Task 9: Live-Claude journey test end-to-end run

**Files:** none modified. Verification only.

- [ ] **Step 1: Source env vars and run the journey test**

Run (from the project root; dev server from Task 8 Step 2 must be running):

```bash
set -a && source .env.local && set +a
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test e2e/real-anthropic-stage-run.spec.ts
```

Expected: 1 passed. If it fails, capture the full Playwright trace and stop — do not retry without understanding the failure. Live-Claude flakes are rare at the Research stage, but when they happen they usually signal a real regression introduced earlier.

- [ ] **Step 2: If the test passed, move on to human browser verification (Task 10).**

If it failed, diagnose before touching the browser. The test is more decisive than a visual inspection.

---

## Task 10: Human browser verification (operator)

**Files:** none modified. Visual verification only.

This is where the operator (not the implementing agent) confirms the fix with their own eyes, per `feedback_no_self_certification.md`. The agent prepares the state; the operator drives.

- [ ] **Step 1: Prepare the browser session**

Operator navigates to `http://192.168.54.101:3003/acme/default/default/issues/1` in Chrome. Confirms the "Add health check endpoint with build metadata" issue is visible and state = "New".

- [ ] **Step 2: Drive a stage through the UI**

Operator:
1. Changes state dropdown from "New" to "Research" and waits for the change to persist.
2. Clicks "Run Stage" when the button appears.
3. Waits for the RunDetailModal to show terminal "Completed — research" status (typically 50s–3min).

- [ ] **Step 3: Verify the transcript pane (non-verbose, non-raw)**

Operator confirms in the transcript pane:
- At least one tool_call entry renders with a violet tool-name pill (`text-soft-violet`) and a terminal icon to its left.
- At least one text entry renders with a message-square icon to its left (regression check — `TextEntry` still works).
- A final `ResultEntry` renders at the bottom with `Done` and a cost in dollars (e.g., `$0.0234`).
- No entry appears as plain text that should be a tool_call (the specific DEF-011 regression).

If any of these fail, DEF-011 is not actually fixed. Stop and diagnose.

- [ ] **Step 4: Verify Verbose mode**

Operator toggles "Verbose" on. Confirms:
- Tool_result entries now appear below their matching tool_calls, indented with a left border (slate or, if an error occurred, red).
- System entries (e.g., `[launched] ...`, `[completed] ...`) appear faintly.

- [ ] **Step 5: Verify Raw JSON mode**

Operator toggles "Raw JSON" on. Confirms:
- Every persisted event renders with a violet event-type prefix (`output`, `launched`, `completed`, etc.) followed by a pretty-printed JSON payload.
- Line numbers start at 1 and increment.
- Counter in the toolbar reads "M events" (where M is ≥ 5 for a typical Research run).

- [ ] **Step 6: Verify Copy behavior**

Operator:
1. With non-raw mode: clicks Copy, pastes into a text editor. Confirms the output reads as semantic entries (one per line, tool_calls prefixed with `> `, text as-is, ResultEntry as `[done]`).
2. With Raw JSON mode: clicks Copy, pastes into a text editor. Confirms the output is `<type> <JSON>` one per line, compact.

- [ ] **Step 7: Verify no new console errors**

Operator opens DevTools Console. Confirms no new errors during the run beyond known dev-mode noise (HMR warnings, React dev warnings). In particular: no "Adapter 'stdoutParser' is not registered" errors — the client-side lookup was deleted, so that error would indicate a stale build.

- [ ] **Step 8: Stderr check (best-effort)**

If any amber-colored raw line appears in the transcript at any point during verification, the stderr styling is pixel-verified. If none appears (likely — Claude Code subprocess rarely emits stderr on a clean run), document stderr styling as "in code, unverified by pixel" in the PR verification matrix. Not a merge blocker.

---

## Task 11: PR and merge

**Files:** none modified. Workflow only.

- [ ] **Step 1: Push the branch**

Run (from the project root):

```bash
git push -u origin spec/def-011-liveoutput-payload-consumer
```

- [ ] **Step 2: Open the PR**

Run:

```bash
gh pr create --title "fix(LiveOutput): consume TranscriptEntry payloads directly (DEF-011)" --body "$(cat <<'EOF'
## Summary
- Drop the redundant `content` projection in orchestrator event payloads; normalize stderr and invalid-signal-error payloads to `TranscriptEntry` shape.
- Rewrite `LiveOutput.tsx` to consume `event.payload` as `TranscriptEntry` directly — no more re-parse through `stream-json`.
- Add `isStderr?: boolean` to the `TranscriptEntry` port; style stderr amber in the raw renderer.
- Redesign the Raw JSON toolbar pane: shows every persisted event with a violet type prefix and pretty-printed payload.
- Tighten the live-Claude journey test to assert ≥ 1 `.text-soft-violet.font-medium` span (the `ToolCallEntry` tool-name pill).

## Verification
- [x] `npx tsc --noEmit && npm run lint` — 0 errors
- [x] `npx tsx src/scripts/db/nuke.ts && npm run db:seed && npm run verify:seed` — 10/10 PASS
- [x] `npx playwright test e2e/real-anthropic-stage-run.spec.ts` against live Claude — 1 passed
- [x] Operator browser verification: tool_call / text / result entries render distinctly; verbose + raw modes behave as designed; copy works in both modes; no new console errors
- [?] Stderr amber styling: in code, pixel-verified only if stderr fires during operator verification (otherwise documented as unverified)

## Spec & Plan
- Spec: `docs/superpowers/specs/2026-04-21-def-011-liveoutput-payload-consumer-design.md`
- Plan: `docs/superpowers/plans/2026-04-21-def-011-liveoutput-payload-consumer.md`
- DEF-011 marked RESOLVED in `docs/superpowers/deferred-fixes.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Operator reviews the PR**

Operator confirms the PR diff matches the committed spec and that the verification matrix is accurate before merging.

- [ ] **Step 4: Squash-merge to main**

Run (only after operator approval):

```bash
gh pr merge --squash --delete-branch
git checkout main
git pull
git fetch --prune origin
```

Expected: `git branch` shows only `main`; `git branch -r` shows only `origin/main`.

---

## Self-Review (done during plan authoring)

Scanned the plan against the spec:

1. **Spec Section 1 (orchestrator payload contract)** → Task 2. Covered.
2. **Spec Section 2 (LiveOutput refactor)** → Task 3. Covered.
3. **Spec Section 3 (stderr styling)** → Task 1 (port type) + Task 4 (renderer). Split across two tasks so the port change lands first and the type is available for Task 2's `satisfies`. Covered.
4. **Spec Section 4 (Raw JSON pane)** → Task 5. Covered.
5. **Spec Section 5 (journey test)** → Task 6. Covered.
6. **Spec Section 6 (verification plan)** → Tasks 8, 9, 10. Covered.
7. **Spec "Files touched" table — DEF-011 resolution in deferred-fixes.md** → Task 7. Covered.

No placeholder language. No "TBD"s. Every code-emitting step has the actual code. File line references are all concrete to the current state of `main` (verified via `grep` during authoring).

One subtle consistency check: Task 3 Step 3's new fallback chain adds a `payload.text` branch that the spec's Section 2 didn't explicitly spell out. This is required because Task 2 made the invalid-signal-error payload use `text` (not `content`) — the spec shows that payload but doesn't trace it through to the LiveOutput synthesis. The plan catches this and documents the reason inline. No drift; spec and plan agree on end-state behavior.
