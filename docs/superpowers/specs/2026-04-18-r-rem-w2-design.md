# R-REM-W2 — Architecture Remediation Design (Revised)

**Date:** 2026-04-18
**Phase:** R-REM-W2 (follows R-REM-W1, which shipped 2026-04-18)
**Source audit:** [2026-04-17-audit-triage.md](../audits/2026-04-17-audit-triage.md) — Wave 2 section
**Status:** Design — revised 2026-04-18 after ground-truth reconciliation. Pending implementation plan.
**Revision note:** Initial draft scoped 6 items from the triage doc. Pre-plan codebase inspection surfaced that three of those items were already done (optimistic concurrency on `issue` / `issueComment`), out-of-scope by construction (`pipelineRun` / `stageRun` have a single writer and no concurrent-write risk), or misclassified (`src/lib/supabase/` is Next.js SSR cookie glue, not a core invariant-7 violation). Revised spec narrows to the three items that are real, shippable, and still matter.

---

## Goal

Pay down the architecture-level invariant-7 debt that actually exists: route realtime and Anthropic wire-format knowledge through the adapter registry so `src/core/` has zero knowledge of specific pluggable vendors. Also close the one genuine data-integrity gap in the issue-comment soft-delete path.

---

## Scope

Three items shipped as **one bundled PR**. Each concern lands as its own commit or small commit group so review can walk them in order.

### 1. Realtime through adapter registry

`RealtimeProvider` port already exists at `src/core/ports/realtime.ts`. It is *not* registered in `src/config/bootstrap.ts`, and its only consumers (`src/components/pipeline/LiveOutput.tsx`, `src/components/pipeline/RunDetailModal.tsx`) call `createClient()` from `@/lib/supabase/client` and use `.channel(...)` directly. Bypasses the port entirely.

Task:
- Build `src/adapters/supabase/realtime.ts` implementing `RealtimeProvider` with `subscribe` / `subscribeToTable` / `broadcast`.
- Register in `bootstrap.ts` as `'realtime'`. Add to `REQUIRED_ADAPTERS`.
- Migrate `LiveOutput.tsx` and `RunDetailModal.tsx` to `registry.get<RealtimeProvider>('realtime').subscribeToTable(...)` / `.subscribe(...)`.
- Result: zero `@/lib/supabase/client` imports for realtime-only concerns in these components; zero `.channel(` calls outside `src/adapters/supabase/`.

Accept: `feat/r-ui-2-impl` (paused) will need a rebase when it resumes.

### 2. Anthropic protocol parser through port

`src/core/orchestrator/output-parser.ts` (189 lines) encodes Anthropic's Messages streaming wire format (`message_start`, `content_block_delta`, etc.) inside `src/core/`. Direct invariant-7 violation — core should not know Anthropic's wire format.

Task:
- New port `src/core/ports/ai-protocol.ts` exporting `AIProtocolParser` interface. Public shape derived from `output-parser.ts`'s current public API (the plan pins it exactly).
- New adapter `src/adapters/anthropic/protocol-parser.ts` implementing the port. All wire-format string literals live here. Initial implementation is a literal relocation of `output-parser.ts` logic — no behavior changes.
- Register in `bootstrap.ts` as `'aiProtocol'`. Decide during plan whether to add to `REQUIRED_ADAPTERS` — the parser is only needed when the orchestrator runs a stage, so `validate` may want to be more nuanced than "always required." Plan to decide.
- Migrate orchestrator consumers (whichever files in `src/core/orchestrator/` import from `./output-parser`) to resolve via `registry.get<AIProtocolParser>('aiProtocol')`.
- Delete `src/core/orchestrator/output-parser.ts`.
- Result: zero Anthropic wire-format strings (e.g., `'message_start'`, `'content_block_delta'`, `'message_stop'`) outside `src/adapters/anthropic/`.

### 3. Transactional issue-comment soft-delete

`src/core/services/issue-comment.ts` hand-rolls optimistic concurrency (`version` arg, manual `WHERE id = ? AND version = ?`) and emits an event capturing the original body before clearing. The version check, body-capture event insert, and `deleted_at` update are three separate statements today — no transaction. A crash between statements leaves the comment half-deleted.

Task:
- Wrap `issueCommentService.softDelete` in `db.transaction(async tx => { ... })`.
- All three writes (event insert, body-clear update, `deleted_at` set) run inside the same transaction.
- Version mismatch throws → transaction rolls back cleanly.
- Same treatment for `update` if it has a comparable multi-statement sequence (plan confirms during implementation).

No API change; existing hand-rolled versioning stays as-is — this is a durability fix, not a refactor.

---

## Out of scope (from original triage, consciously deferred)

- **CRUD factory migration audit.** W1 already moved most services onto the factory; the rest (`issue`, `issueComment`) hand-roll versioning for sound reasons (business logic interleaved with version check). Leaving as-is.
- **Optimistic concurrency on `issue` / `issueComment`.** Already implemented by hand. Working, tested, no concurrency bugs reported. Refactoring onto `createVersionedCrudService` risks regressions in substantial business logic (event emission, state transitions, body-clearing) for DRY's sake. YAGNI.
- **Optimistic concurrency on `pipelineRun` / `stageRun`.** Single writer (orchestrator in `src/core/orchestrator/pipeline-run-service.ts`). No concurrent-write risk. Revisit if a second writer is introduced (e.g., manual-intervention API in W3).
- **Routing auth through `AuthProvider` port / deleting `src/lib/supabase/`.** `src/lib/supabase/` is Next.js SSR cookie glue using `@supabase/ssr`, which solves a different problem (cookie-based session continuity across server components and middleware) than the existing `SupabaseAuthProvider` adapter (which uses plain `@supabase/supabase-js`). Not an invariant-7 violation — invariant 7 is about pluggable-vendor seams inside core, and `src/lib/` is app-layer infrastructure, not core. See "Invariant clarification" below.
- **Entity migrations, OpenAI adapter, UI conflict UX** — unchanged from original spec.

### Invariant clarification

The audit triage flagged `src/lib/supabase/` as an invariant-7 violation. After inspection, that is a misread. Invariant 7 separates core (`src/core/`) from pluggable integrations (`src/adapters/`). `src/lib/` is neither — it is Next.js-specific infrastructure (middleware wiring, server-component helpers, browser client setup) that bridges the framework and the auth adapter. A thin note will land in `docs/invariants.md` as part of item 3's commit group, clarifying that `src/lib/` is framework glue and exempt from the core-vs-adapter rule. No code moves.

---

## Architecture

### Realtime

**Port** (already exists, unchanged):

```ts
// src/core/ports/realtime.ts
interface RealtimeProvider {
  subscribe<T>(channel: string, event: string, cb: (payload: T) => void): Unsubscribe;
  subscribeToTable<T>(channelName: string, table: string, event: 'INSERT' | 'UPDATE' | '*', cb: (payload: RealtimeTableEvent<T>) => void): Unsubscribe;
  broadcast<T>(channel: string, event: string, payload: T): Promise<void>;
}
```

**Adapter** (new):

```ts
// src/adapters/supabase/realtime.ts
export class SupabaseRealtimeProvider implements RealtimeProvider { /* ... */ }
```

Internally uses `@supabase/supabase-js`'s `createClient(...).channel(...)`. On `subscribeToTable`, builds the `postgres_changes` filter. Returns an `Unsubscribe` that calls `channel.unsubscribe()`.

**Bootstrap:**

```ts
registry.register('realtime', () => {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const key = requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  return new SupabaseRealtimeProvider({ url, key });
});
```

**Consumer shape** (both LiveOutput and RunDetailModal follow the same pattern):

```ts
const realtime = registry.get<RealtimeProvider>('realtime');
const unsubscribe = realtime.subscribeToTable('live-output-<id>', 'event', '*', (payload) => { /* ... */ });
return () => unsubscribe();
```

### AI Protocol Parser

**Port** (new):

```ts
// src/core/ports/ai-protocol.ts
export interface ParsedMessage {
  // Shape derived from output-parser.ts's current return type.
  // Plan pins the exact fields after reading the file.
}

export interface AIProtocolParser {
  parse(chunk: string): ParsedMessage[];
  // Additional methods match the current public API of output-parser.ts.
}
```

**Adapter** (new):

```ts
// src/adapters/anthropic/protocol-parser.ts
export class AnthropicProtocolParser implements AIProtocolParser { /* relocated logic */ }
```

**Bootstrap:**

```ts
registry.register('aiProtocol', () => new AnthropicProtocolParser());
```

**Consumer shape:**

```ts
const parser = registry.get<AIProtocolParser>('aiProtocol');
const messages = parser.parse(chunk);
```

### Transactional soft-delete

Drizzle's `Database` type (from `src/core/db/connection.ts`) exposes `.transaction(async tx => { ... })`. The soft-delete wraps the existing three writes (event insert, body-clear update, `deleted_at`) in a single transaction. Version mismatch throws inside the transaction → automatic rollback. No schema change; no API change.

---

## Components

| File | Change |
|---|---|
| `src/adapters/supabase/realtime.ts` | **New** — implements `RealtimeProvider` |
| `src/config/bootstrap.ts` | Register `'realtime'` and `'aiProtocol'` adapters. Add `'realtime'` to `REQUIRED_ADAPTERS`. Decide on `'aiProtocol'` requirement during plan. |
| `src/components/pipeline/LiveOutput.tsx` | Replace direct `.channel(...)` with `registry.get<RealtimeProvider>('realtime').subscribeToTable(...)`. Remove `@/lib/supabase/client` import if realtime was the only use. |
| `src/components/pipeline/RunDetailModal.tsx` | Same as LiveOutput |
| `src/core/ports/ai-protocol.ts` | **New** — `AIProtocolParser` interface |
| `src/adapters/anthropic/protocol-parser.ts` | **New** — logic relocated from `src/core/orchestrator/output-parser.ts` |
| `src/core/orchestrator/output-parser.ts` | **Deleted** |
| `src/core/orchestrator/*` (whichever files import `./output-parser`) | Switch to `registry.get<AIProtocolParser>('aiProtocol')` |
| `src/core/services/issue-comment.ts` | Wrap `softDelete` (and `update` if similarly multi-statement) in `db.transaction(...)` |
| `docs/invariants.md` | Thin note clarifying that `src/lib/` is framework glue, exempt from invariant 7's core-vs-adapter rule |
| `src/__tests__/integration/realtime.test.ts` | **New** — smoke test that the adapter registers and resolves, and `subscribeToTable` accepts a valid config. Real Supabase, per testing policy. |
| `src/__tests__/integration/ai-protocol.test.ts` | **New** — relocated / supplemented tests for the parser. Covers existing behavior plus port-contract tests. |
| `src/__tests__/integration/issue-comment.test.ts` | Add test asserting `softDelete` rolls back atomically on injected version mismatch |

---

## Data flow

### Realtime event (post-migration)

1. `LiveOutput` component mounts for `stageRunId = "abc"`.
2. Component calls `registry.get<RealtimeProvider>('realtime').subscribeToTable('live-output-abc', 'event', '*', onEvent)`.
3. Adapter opens a Supabase channel internally using `postgres_changes` filter on `event` table.
4. Events arrive → adapter invokes `onEvent(payload)`.
5. Component updates UI.
6. On unmount, the `unsubscribe()` returned by the adapter closes the channel.
7. The component file never imports `@/lib/supabase/client` or `@supabase/*` for realtime purposes.

### Orchestrator parsing Anthropic output (post-migration)

1. Orchestrator receives a stream chunk from a subprocess AI worker.
2. Orchestrator calls `registry.get<AIProtocolParser>('aiProtocol').parse(chunk)`.
3. Adapter matches wire-format events, returns `ParsedMessage[]`.
4. Orchestrator acts on the parsed messages (emits events, updates stage state, etc.).
5. `src/core/orchestrator/` contains zero `'message_start'` / `'content_block_delta'` / `'message_stop'` string literals.

### Issue-comment soft-delete (post-fix)

1. Router calls `issueCommentService.softDelete(commentId, { deletedBy, version })`.
2. Service opens `db.transaction(async tx => { ... })`.
3. Inside the transaction:
   a. Insert pre-delete event capturing original body.
   b. Update `issue_comment` set `body_md = null`, `body_html = null`, `version = version + 1` with `WHERE id = ? AND version = ?`.
   c. Set `deleted_at`, `deleted_by`.
4. Version mismatch → throws → transaction rolls back. No partial state.
5. Router returns success or re-throws as appropriate.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Realtime adapter behaves differently than direct `supabase.channel(...)` calls today | Adapter is a thin passthrough; integration test registers and resolves; browser verification watches LiveOutput + RunDetailModal working against a real pipeline run. |
| `output-parser.ts` has subtle behavior not captured by its public API | Plan includes reading the file and identifying all consumer call sites before moving. Relocation is literal (no logic changes). Existing tests for `output-parser` re-run against the adapter to confirm zero regression. |
| `aiProtocol` required-at-startup decision gets made wrong | Plan includes explicit decision step with documented reasoning. Default: not in `REQUIRED_ADAPTERS` (parser is only needed when orchestrator runs), revisit if lazy resolution surprises. |
| `feat/r-ui-2-impl` rebase is larger than expected | Accepted per brainstorm. R-UI-2 was already paused for other reasons. Rebase cost paid when R-UI-2 resumes. |
| `issue-comment.ts` transaction exposes a bug in hand-rolled versioning | Bug-find is a win, not a regression. Existing tests pass before and after. |

---

## Testing

- `npx tsc --noEmit` — zero errors
- `npx vitest run` — existing 115 tests pass, plus new tests:
  - Realtime adapter smoke test (registers, resolves, accepts valid config)
  - AI protocol parser port-contract tests (existing parser behaviors preserved)
  - Issue-comment transactional soft-delete test (rollback on version mismatch, atomicity)
  - Projected: ~4-6 new tests total
- `npm run verify` — 10/10 (seed structure unaffected)
- **Invariant grep sweep** (automated, added to verification pass):
  - Zero `.channel(` calls in `src/components/` and `src/app/` (outside `src/adapters/supabase/`)
  - Zero Anthropic wire-format strings (`'message_start'`, `'content_block_delta'`, `'message_stop'`, `'content_block_start'`, `'content_block_stop'`, `'message_delta'`) outside `src/adapters/anthropic/`
- **Browser verification (invariant 21):** open a project, run a pipeline stage, confirm LiveOutput streams events, confirm RunDetailModal updates as the pipeline progresses. Zero console errors.

---

## Downstream effects

- **R-UI-2 (paused):** `feat/r-ui-2-impl` needs rebase against main after W2. Realtime consumer code on that branch will conflict with the registry-routed versions. Expected.
- **W3 (alpha-critical build):** Anthropic adapter in W3 can import from `src/adapters/anthropic/protocol-parser.ts` if it wants to share parsing. GitHub / OpenAI adapters follow the same port-and-adapter pattern.
- **Invariant 7 note in `docs/invariants.md`** clarifies that `src/lib/` is framework glue — prevents future audits from re-flagging the same false positive.

---

## Implementation sequencing within the PR

Suggested commit order (review-friendly):

1. `SupabaseRealtimeProvider` adapter + bootstrap registration (tests pass, nothing uses it yet)
2. Migrate `LiveOutput.tsx` to registry
3. Migrate `RunDetailModal.tsx` to registry
4. Realtime adapter integration test
5. `AIProtocolParser` port + `AnthropicProtocolParser` adapter (literal relocation of `output-parser.ts` logic)
6. Migrate orchestrator consumers to registry; delete `src/core/orchestrator/output-parser.ts`
7. AI protocol parser integration tests (confirm behavior preserved)
8. Transactional `issueCommentService.softDelete` (+ `update` if applicable) + test
9. `docs/invariants.md` note about `src/lib/` being framework glue
10. Invariant grep-sweep additions to verification / handoff doc

Each commit passes `npx tsc --noEmit` and `npx vitest run`. Pre-commit hook stays enforced throughout.

---

## How this revision differs from the initial spec

- **Dropped:** CRUD factory audit, full optimistic-concurrency rollout for `issue` / `pipelineRun` / `stageRun` / `issueComment` (first three: already done or out-of-scope by construction; last one: working hand-rolled code we shouldn't risk).
- **Dropped:** Routing auth through `AuthProvider` port / deleting `src/lib/supabase/` (not an invariant-7 violation).
- **Retained + sharpened:** Realtime registry routing, Anthropic protocol parser port.
- **Added:** Transactional issue-comment soft-delete (genuine durability gap, surfaced during pre-plan codebase inspection).
- **Added:** `docs/invariants.md` clarification on `src/lib/` scope.

Result: a tighter, honest W2 that ships the real architectural wins without busywork on already-solved problems.
