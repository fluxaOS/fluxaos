# DEF-011 — LiveOutput consumes persisted TranscriptEntry payloads directly

**Status:** Design approved 2026-04-21 · awaiting implementation plan
**Scope:** Fix DEF-011 (LiveOutput re-parses orchestrator event payloads, dropping the `tool_call` kind discriminator so every tool use renders as plain text).
**Severity of bug:** Medium — no data loss, but the transcript pane is a wall of text and the `ToolCallEntry` / `ToolResultEntry` / `ResultEntry` renderers never fire in practice.
**Bug reference:** `docs/superpowers/deferred-fixes.md` DEF-011.

---

## Problem

The orchestrator parses each driver stdout line into a typed `TranscriptEntry` with a `kind` discriminator (`text`, `tool_call`, `tool_result`, `result`, `system`, `raw`), then persists it as the `event.payload` with a redundant projected `content` string:

```ts
// src/core/orchestrator/stage-runner.ts:300-308
const entries = lineParser(line, lineNumber);
for (const entry of entries) {
  runService.appendEvent(sRun.id, EVENT_TYPE.output, {
    ...entry,
    content: entry.text ?? entry.toolCommand ?? entry.toolOutput ?? '',
  });
}
```

`LiveOutput.tsx` ignores the typed fields, extracts only `payload.content`, and re-parses it through the same `stream-json` parser:

```ts
// src/components/pipeline/LiveOutput.tsx:96-131
const rawLines = (eventsQuery.data ?? []).map((e, idx) => ({
  lineNumber: idx,
  content: typeof e.payload === 'object' && e.payload !== null
    ? (e.payload as Record<string, unknown>).content as string ?? JSON.stringify(e.payload)
    : String(e.payload),
  type: e.type,
}));

for (const line of rawLines) {
  const results = parseLine(line.content, line.lineNumber);  // ← re-parse
  const promoted = results.map((entry) =>
    entry.kind === 'raw' ? { ...entry, kind: 'text' as EntryKind } : entry,
  );
  parsed.push(...promoted);
}
```

The extracted `content` is the tool command string (e.g., `"grep foo bar"`), not the original JSON line (e.g., `'{"type":"assistant","message":{...}}'`). `parseStreamJsonLine`'s fast-path at `src/adapters/subprocess/stdout-parser.ts:42-43` returns a `raw` entry for any string that doesn't start with `{`. LiveOutput then promotes `raw` → `text` "for readability." Net effect: the entry's persisted `kind` is discarded and everything renders as plain text.

The events ARE persisted correctly with `kind: 'tool_call'` in the DB (confirmed via `npm run db:events`). The UI rendering pipeline is the sole point of drift.

**Pairs with:** the `kind="tool_call"` vs `type="tool_use"` naming drift (Anthropic protocol term vs fluxaOS canonical term), already standardized at the DB/port layer.

**Journey-test workaround in place:** `e2e/real-anthropic-stage-run.spec.ts:95-115` asserts transcript-pane-populated instead of a specific `.text-soft-violet` span count. Removed as part of this fix.

---

## Design

### Chosen approach: consume payload as TranscriptEntry (DEF-011 option a)

LiveOutput stops re-parsing. Orchestrator output-event payloads ARE `TranscriptEntry` records — LiveOutput reads them directly. The client-side stream-json parser registration is no longer needed.

Option (b) from DEF-011 (persist both the raw stdout line and the parsed fields) was explicitly considered and rejected: it doubles the persisted payload size for no benefit now that the rendering contract is fixed at the port boundary.

### Section 1 — Payload contract change (orchestrator)

**File:** `src/core/orchestrator/stage-runner.ts`

Drop the redundant `content` projection. Normalize stderr and the invalid-signal error path to emit proper `TranscriptEntry` records.

```ts
// Before (line 300-308):
const entries = lineParser(line, lineNumber);
for (const entry of entries) {
  runService.appendEvent(sRun.id, EVENT_TYPE.output, {
    ...entry,
    content: entry.text ?? entry.toolCommand ?? entry.toolOutput ?? '',
  });
}

// After:
const entries = lineParser(line, lineNumber);
for (const entry of entries) {
  runService.appendEvent(sRun.id, EVENT_TYPE.output, entry);
}
```

```ts
// Before (line 312-321 — stderr path):
runService.appendEvent(sRun.id, EVENT_TYPE.output, {
  lineNumber,
  content: data.trim(),
  kind: 'raw',
  isStderr: true,
})

// After:
runService.appendEvent(sRun.id, EVENT_TYPE.output, {
  id: `stderr-${lineNumber}`,
  kind: 'raw',
  lineNumber,
  text: data.trim(),
  isStderr: true,
} satisfies TranscriptEntry)
```

```ts
// Before (line 287-296 — invalid signal error path):
runService.appendEvent(sRun.id, EVENT_TYPE.error, {
  lineNumber,
  content: err instanceof Error ? err.message : String(err),
  kind: 'system',
})

// After:
runService.appendEvent(sRun.id, EVENT_TYPE.error, {
  id: `sig-err-${lineNumber}`,
  kind: 'system',
  lineNumber,
  text: err instanceof Error ? err.message : String(err),
} satisfies TranscriptEntry)
```

**Contract:** for `EVENT_TYPE.output` events, `event.payload` is always a serialized `TranscriptEntry`. No redundant `content` field. The invalid-signal error path above is the one exception outside `output` that also normalizes to `TranscriptEntry` — it's the error path that logically pairs with the stdout stream (mid-stream parse failure). The other `EVENT_TYPE.error` call sites (e.g., `stage-runner.ts:113`, `:336`, `:401`, `:449`, `event-orchestrator.ts:366`) persist free-form lifecycle errors and keep their existing payload shapes. LiveOutput's non-`output` branch already handles arbitrary free-form payloads via the `content ?? message ?? JSON.stringify(payload)` fallback chain shown in Section 2.

### Section 2 — LiveOutput refactor (consumer)

**File:** `src/components/pipeline/LiveOutput.tsx`

**Remove:**
- The `parseLine` memo (lines 82-85).
- The `rawLines` intermediate memo (lines 96-106).
- The `entries` memo's `parseLine` call + "promote raw→text" logic (lines 109-131). Replaced.

**Replace `entries` memo with:**

```ts
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
        : JSON.stringify(payload);
      out.push({
        id: `sys-${e.id}`,
        kind: 'system',
        lineNumber: 0,
        text: `[${e.type}] ${text}`,
      });
    }
  }
  return verbose ? out : out.filter((x) => x.kind !== 'system');
}, [eventsQuery.data, verbose]);
```

**Keep unchanged:** entry renderers (`TextEntry`, `ToolCallEntry`, `ToolResultEntry`, `ResultEntry`) at lines 18-69 and the render dispatch map at lines 265-278. They already switch on `entry.kind`; they just never received a `tool_call` entry before.

**Imports cleanup:** remove `StdoutParser` and `EntryKind` (if unused post-refactor) from the import at line 8. The `registry.get<StdoutParser>('stdoutParser')` call goes away. Server-side orchestrator still uses the port — registry entry stays.

### Section 3 — Stderr visual styling

**File 1:** `src/core/ports/stdout-parser.ts`

Add `isStderr` to the `TranscriptEntry` interface. Optional boolean; default `undefined`.

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
  isStderr?: boolean;  // ← new
  cost?: number;
}
```

The `src/adapters/subprocess/stdout-parser.ts` parser never emits `isStderr` (stdout entries are never stderr by construction). The field is set only by the stage-runner's dedicated stderr path. No adapter change.

**File 2:** `src/components/pipeline/LiveOutput.tsx`

Style the `raw` kind renderer to distinguish stderr with an amber tint and left border:

```tsx
// Before (lines 274-276):
{entry.kind === 'raw' && (
  <div className="whitespace-pre-wrap py-0.5">{entry.text}</div>
)}

// After:
{entry.kind === 'raw' && (
  <div className={`whitespace-pre-wrap py-0.5 ${
    entry.isStderr ? 'text-amber-400 border-l-2 border-amber-400/40 pl-2' : ''
  }`}>
    {entry.text}
  </div>
)}
```

**Rationale:**
- Amber (not red) because stderr ≠ error. Drivers legitimately log progress and warnings to stderr. Red stays reserved for `isError` terminal failures (`ResultEntry`, `ToolResultEntry` error path).
- Left-border treatment matches `ToolResultEntry` styling (lines 47-53) for visual consistency with other secondary-lane entries.
- `isStderr` stays a boolean flag on the `raw` kind rather than a new `'stderr'` kind. Keeping the discriminator set small means fewer switch statements to maintain.

**Copy-text handling (lines 172-178):** already iterates entries and falls through for the `raw` kind via `return e.text ?? ''`. No change — stderr lines copy as plain text.

### Section 4 — Raw JSON toolbar pane

**File:** `src/components/pipeline/LiveOutput.tsx`

With `rawLines` deleted, the Raw JSON toggle's source of truth shifts to `eventsQuery.data` directly. Pane shows every persisted event (not just outputs), pretty-prints payloads, and prefixes the event type.

**Replace Raw JSON branch at lines 256-263:**

```tsx
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
```

**Line-count indicator (line 205):**
```tsx
rawJson
  ? `${(eventsQuery.data ?? []).length} events`
  : `${entries.length} entries`
```

**Empty-state (lines 253-254):** `rawLines.length === 0` becomes `(eventsQuery.data ?? []).length === 0`.

**Copy button in Raw JSON mode (lines 169-170):**
```tsx
text = (eventsQuery.data ?? [])
  .map((e) => `${e.type} ${JSON.stringify(e.payload)}`)
  .join('\n');
```
One event per line, compact (not pretty-printed — copy target is usually a grep or diff tool, not human-read).

### Section 5 — Journey test assertion tightening

**File:** `e2e/real-anthropic-stage-run.spec.ts`

**Replace lines 95-115:**

```ts
// ToolCallEntry renders the tool name in a <span class="text-soft-violet font-medium">
// (see LiveOutput.tsx:32). A live Claude Research run reliably invokes at least
// one tool (typically Read, Grep, or Glob), so the count must be >= 1.
const toolCallNames = page
  .locator('[aria-label="Run detail"]')
  .locator('.text-soft-violet.font-medium');

await expect(toolCallNames.first()).toBeVisible({ timeout: 10_000 });
expect(await toolCallNames.count()).toBeGreaterThanOrEqual(1);
```

**Why this assertion:**
- Proves `tool_call` kind made it from DB payload → `ToolCallEntry` renderer — the exact path DEF-011 fixes.
- `.text-soft-violet.font-medium` is only emitted by `ToolCallEntry` at `LiveOutput.tsx:32`; no other entry kind uses that class pair.
- Handles non-deterministic live Claude output — can't assert a specific tool name or count, but ≥ 1 tool invocation is near-certain for Research stage.

**Delete the DEF-011 workaround comment** at lines 100-110 — it rots once the workaround is gone.

### Section 6 — Verification plan

**Fresh state smoke:**
```
npx tsx src/scripts/db/nuke.ts && npm run db:seed && npm run verify:seed
```
Expect 10/10 PASS. Old-shape events persisted before this fix are a structural superset of the new shape (the extra `content` field is ignored by the new consumer), so they will render correctly under the new LiveOutput. A nuke isn't strictly required for the fix to visibly work, but it's the cleanest starting state for verifying the fix against a run that used the new persistence path on both ends.

**Live-Claude journey test:**
```
set -a && source .env.local && set +a
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test \
  e2e/real-anthropic-stage-run.spec.ts
```
Expected runtime ~50s–3min. Passes end-to-end including the tightened `text-soft-violet` assertion.

**Human browser verification (operator):**
Open `http://192.168.54.101:3003/acme/default/default/issues/1`, advance state to Research, click Run Stage, wait for completion. Confirm:
- At least one tool_call entry renders with violet tool-name + terminal icon.
- Text blocks still render with message-square icon (regression check).
- Toggle Verbose → tool_result entries appear under their tool_calls, indented with left border.
- Toggle Raw JSON → full event payloads visible, pretty-printed, with event type prefix; counter reads "M events."
- Copy button in both modes produces sensible clipboard text.

**Stderr styling:** hard to trigger deterministically in a live-Claude run. If no amber line appears during operator verification, the styling is in code but unverified against real pixels — documented in the PR verification matrix. Not a merge blocker; revisit if/when a driver emits stderr.

**Console check:** dev server console during operator verification emits no new errors. The removal of the client-side `stdoutParser` registry lookup removes one call; confirm no "Adapter not registered" errors for remaining registry calls.

---

## Files touched

| File | Change |
|---|---|
| `src/core/orchestrator/stage-runner.ts` | Three payloads normalized to `TranscriptEntry` shape; redundant `content` projection removed |
| `src/core/ports/stdout-parser.ts` | Add `isStderr?: boolean` to `TranscriptEntry` interface |
| `src/components/pipeline/LiveOutput.tsx` | Remove parser re-parse path; consume event payloads as `TranscriptEntry`; amber stderr styling; Raw JSON pane shows full event payloads |
| `e2e/real-anthropic-stage-run.spec.ts` | Tighten assertion to `.text-soft-violet.font-medium` count ≥ 1; remove workaround comment |
| `docs/superpowers/deferred-fixes.md` | Mark DEF-011 as RESOLVED (done during implementation, not this spec) |

No migrations. No schema changes. No adapter changes outside the port type. The payload-shape change is forward-compatible for *parsed* stdout events: old-shape records (the previous `{...entry, content}` superset) are still valid `TranscriptEntry` instances because the `...entry` spread already included every typed field; the extra `content` is ignored by the new consumer.

**Forward-compatibility caveat for stderr and invalid-signal-error events:** the pre-fix stderr payload was `{lineNumber, content, kind: 'raw', isStderr}` — no `text` field, no `id` field. Under the new LiveOutput consumer, *pre-existing* stderr records render as empty amber divs (the renderer reads `entry.text`, which is `undefined` on old rows). The pre-fix invalid-signal-error payload has the same shape problem. Pre-existing records would only surface in two scenarios: (i) the operator's browser holds an open LiveOutput against a run persisted before this fix ships; (ii) Realtime coexistence during a deploy. Neither is load-bearing in pre-alpha. Nuke-before-verify avoids both. Documented here because the spec should not overstate compatibility.

## Out of scope

- `event.payload` schema enforcement at the DB or Drizzle layer. Payload stays `jsonb` free-form; the typing contract is enforced at the port (`TranscriptEntry`) and honored by convention on both ends.
- Performance improvements for transcripts with thousands of entries. No change to the number of DOM nodes rendered.
- Deletion of the stdout-parser port or its registry entry. Orchestrator still uses it for server-side parsing.
- Any changes to non-`output` event types.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Some other consumer reads `payload.content` on output events | Audited. Three consumers exist: (1) LiveOutput — being rewritten. (2) `src/scripts/db/events.ts` — dumps `JSON.stringify(payload)` wholesale, no field-pick; unaffected. (3) `src/app/[org]/[user]/[project]/pipelines/[id]/page.tsx:314-322` (`formatEventPayload`) — renders the pipeline-detail page's per-stage-run event list. Reads `payload.from/to`, `payload.output`, `payload.error`, else truncates `JSON.stringify(payload)` to 100 chars. Does *not* read `payload.content`. The change's net effect on this page: the displayed 100-char slice shifts by a handful of characters because `content` is no longer in the stringified blob; no functional regression, but the page will continue to show a JSON truncation for output events (not a human-readable string). Out of scope for DEF-011; noted here so the claim "two consumers" is corrected to "three, one indirect." |
| Invalid-signal-error normalization is cosmetic | Task 2's normalization of the invalid-signal error path to `TranscriptEntry` shape has no consumer today — LiveOutput's non-output branch synthesizes a fresh `system` entry and ignores the payload's `id`/`kind`. The normalization is defensive shape-consistency, not render-path enablement. Kept because it's cheap and aligns the schema; not because it unlocks a renderer. |
| Verbose mode silently drops `gate_checked`/`heartbeat`/`timed_out`/`failed`/`cancelled` events | The plan's `entries` memo accepts only `output`/`launched`/`completed`/`error` (matching pre-fix behavior). `gate_checked` in particular is operationally meaningful (did the stage hold? approve?). Intentional scope limit: Raw JSON mode (rewritten in this design) DOES show all events including `gate_checked`, so operators retain visibility. Revisit post-alpha if verbose mode needs parity. |
| Tightened journey-test assertion is probabilistic | The new `.text-soft-violet.font-medium` count-≥-1 assertion assumes the Research stage's live Claude run invokes at least one tool. True for virtually every run (the prompt asks the model to read files before acting), but not guaranteed. If the test flakes, loosen to "≥ 1 `.font-mono > div` child AND no `.bg-red-400` result entry" — this would catch DEF-011 regression almost as well. |
| Journey test flake on slow live-Claude runs | Keep the existing 4-minute status poll; the tool-count assertion runs after status=completed so the transcript is fully rendered by then. |
| Stderr amber styling untested if subprocess doesn't emit stderr during verification | Documented as unverified-by-pixel in PR matrix; not a merge blocker. |

## Success criteria

- Live Claude journey test passes with the tightened `.text-soft-violet.font-medium` assertion.
- Operator confirms during human browser verification that tool_call entries render with the violet pill + terminal icon, and text / tool_result / result entries continue to render correctly.
- `npm run db:events` still produces readable output against the new payload shape (no `content` field, but `text` / `toolCommand` / `toolOutput` are present on the typed entry).
- DEF-011 moved to RESOLVED in `deferred-fixes.md` once merged.
