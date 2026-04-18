# R-REM-W2 — Architecture Remediation Design

**Date:** 2026-04-18
**Phase:** R-REM-W2 (follows R-REM-W1, which shipped 2026-04-18)
**Source audit:** [2026-04-17-audit-triage.md](../audits/2026-04-17-audit-triage.md) — Wave 2 section
**Status:** Design — pending implementation plan

---

## Goal

Pay down the architecture-level invariant-7 debt surfaced by R-AUDIT: close the seams between core and pluggable integrations (auth, realtime, Anthropic wire format), and give mutation-heavy entities optimistic-concurrency protection so concurrent writers cannot silently clobber each other.

---

## Scope

Six items shipped as **one bundled PR**. Within the PR, each concern lands as its own commit so review can walk them in order.

1. **CRUD factory audit + cleanup.** Verify every service module in `src/core/services/` uses `createCrudService` / `createVersionedCrudService` consistently. Tidy leftover drift from W1. Mostly a polish pass — no new factory code.
2. **Optimistic concurrency.** Wire `createVersionedCrudService` for `issue`, `pipelineRun`, `stageRun`, `issueComment`. Add version columns where missing; reconcile against the 4 `version: integer` columns already in `src/core/db/schema.ts`. Update tRPC routers and call sites to pass `expectedVersion`. Catalog tables (`skill`, `driver`, `persona`, `provider`, etc.) stay unversioned — they have a single writer (admin via Settings UI) and no concurrent-write risk.
3. **Transactional issue-comment soft-delete.** Wrap `issueCommentService.softDelete` in `db.transaction(...)` so the `deleted_at` write and any dependent updates are atomic. Optimistic concurrency check runs inside the transaction so a failed version match rolls back the whole thing.
4. **Auth through port.** Move `@supabase/ssr` usage out of `src/lib/supabase/` and into `src/adapters/supabase/auth.ts`. Everything that currently imports from `src/lib/supabase/{client,server,middleware}` switches to `registry.get<AuthProvider>()`. Registry bootstrap wires the adapter at startup.
5. **Realtime through registry.** Register `RealtimeProvider` in the adapter registry. Migrate every `supabase.channel(...)` consumer — server and client — to `registry.get<RealtimeProvider>().subscribe(...)`. Accept the merge-conflict cost on the paused `feat/r-ui-2-impl` branch.
6. **Anthropic protocol parser port.** New `AIProtocolParser` port in `src/core/ports/`. Relocate `src/core/orchestrator/output-parser.ts` into `src/adapters/anthropic/protocol-parser.ts`. Orchestrator consumes via registry. Removes the last Anthropic wire-format knowledge from `src/core/`.

### Out of scope (explicitly deferred)

- Versioning on catalog tables (no concurrent-write risk).
- UI-layer conflict resolution (the "two tabs editing" UX). W2 returns a stale-version error from the mutation; how the UI surfaces that to the user is a later focused UX pass.
- OpenAI protocol parser — waits for the actual OpenAI adapter in W3.
- Entity migrations beyond the four targeted (`issue`, `pipelineRun`, `stageRun`, `issueComment`).

---

## Architecture

### 1. Optimistic concurrency (data layer)

- **Factory already exists.** `createVersionedCrudService` in `src/core/services/crud-factory.ts` (line 78) and is already exercised by `src/__tests__/integration/crud-factory.test.ts`. No new factory code.
- **Schema reconciliation.** Four `version: integer().notNull().default(1)` columns already exist in `src/core/db/schema.ts` (lines 193, 403, 440, 582). Step one of implementation is to confirm which tables those are and which of the 4 targeted entities still need one. Missing columns land via `drizzle/0007_add_version_columns.sql` with `DEFAULT 1` backfill. Project is pre-alpha / nuke-and-reseed, so no live-data concern.
- **Service layer.** Target entity services swap `createCrudService` → `createVersionedCrudService`. After the swap, unversioned `update`/`remove` become the exception, not the default, for these entities.
- **Router layer.** tRPC procedures that mutate these entities accept `expectedVersion` in their input schema and call `updateWithVersion(id, expectedVersion, fields)`. On version mismatch the factory throws `StaleVersionError`; the router catches it and re-throws as `TRPCError({ code: 'CONFLICT', ... })`. The UI sees a typed tRPC error it can render.
- **Read-modify-write contract.** Every read of a versioned entity returns `version`. Every mutation sends it back. UI components doing partial patches must plumb the version field through their forms.

### 2. Registry-routed integrations (auth + realtime + AI protocol)

Three separate ports, same pattern:

- **Port** lives in `src/core/ports/` — `auth.ts` and `realtime.ts` already exist; `ai-protocol.ts` is new.
- **Adapter** lives in `src/adapters/<vendor>/` — `supabase/auth.ts`, `supabase/realtime.ts` (new file), `anthropic/protocol-parser.ts` (new file).
- **Registry bootstrap** in `src/config/` registers each adapter at app startup.
- **Consumers** call `registry.get<AuthProvider>()` / `registry.get<RealtimeProvider>()` / `registry.get<AIProtocolParser>()`. By the end of W2:
  - Zero `@supabase/ssr` imports outside `src/adapters/supabase/`
  - Zero `supabase.channel(` calls outside `src/adapters/supabase/`
  - Zero Anthropic wire-format knowledge outside `src/adapters/anthropic/`

### 3. Transaction boundary

- `issueCommentService.softDelete(id, expectedVersion)` runs inside `db.transaction(...)`.
- The optimistic concurrency check happens **inside** the transaction, so a version mismatch rolls the whole transaction back — including any dependent updates the future adds.
- This is a small change but paired with the versioned-factory swap so the two land together in one commit.

---

## Components

| File | Change |
|---|---|
| `drizzle/0007_add_version_columns.sql` | **New** — adds `version` columns to whichever of `{issue, pipeline_run, stage_run, issue_comment}` don't already have one. Default 1. |
| `drizzle/meta/_journal.json` | New idx-5 entry for migration 0007 |
| `src/core/db/schema.ts` | Add `version: integer().notNull().default(1)` to target tables missing it |
| `src/core/services/issue.ts` | Use `createVersionedCrudService`; update direct `update`/`remove` call sites |
| `src/core/services/issue-comment.ts` | Versioned factory; wrap `softDelete` in `db.transaction(...)` |
| `src/core/services/pipeline.ts` | Versioned factory for pipeline-run / stage-run (whichever tables hold mutable runtime state — confirm during implementation) |
| `src/server/routers/issue.ts` | Accept `expectedVersion` in mutation input; call versioned methods; map `StaleVersionError` → `TRPCError('CONFLICT')` |
| `src/server/routers/*` | Same pattern for any router touching the 4 targeted entities |
| `src/core/ports/ai-protocol.ts` | **New** — `AIProtocolParser` interface: `parse(chunk: string): ParsedMessage[]` |
| `src/adapters/anthropic/protocol-parser.ts` | **New** — relocated logic from `src/core/orchestrator/output-parser.ts` |
| `src/core/orchestrator/output-parser.ts` | **Deleted** |
| `src/core/orchestrator/*` (parser consumers) | Switch to `registry.get<AIProtocolParser>()` |
| `src/adapters/supabase/auth.ts` | **New** — implements `AuthProvider` using `@supabase/ssr` |
| `src/lib/supabase/{client,server,middleware}.ts` | Content relocated into the adapter; files deleted or reduced to thin re-exports of registry lookup (prefer delete + update call sites) |
| `src/adapters/supabase/realtime.ts` | **New** — implements `RealtimeProvider` |
| `src/config/*` (registry bootstrap) | Register `auth`, `realtime`, `aiProtocol` adapters at startup |
| Consumer sites — pages, client components, server routes | Replace direct `createClient` / `supabase.channel` with registry lookups |
| `src/__tests__/integration/concurrency.test.ts` | **New** — races two `updateWithVersion` calls on each of the 4 targeted entities; asserts second fails with `StaleVersionError` |
| `src/__tests__/integration/issue-comment.test.ts` | Add transactional soft-delete test: assert rollback on version mismatch |

---

## Data flow (the interesting paths)

### Issue edit with concurrency

1. UI reads issue via `trpc.issue.getByNumber` → response includes `version: 3`.
2. User edits, submits via `trpc.issue.updateFields({ id, version: 3, fields })`.
3. Router calls `issueService.updateWithVersion(id, 3, fields)`.
4. Factory runs: `UPDATE issue SET ..., version = 4 WHERE id = ? AND version = 3`.
5. If `rowCount === 0` (someone else incremented), factory throws `StaleVersionError`.
6. Router catches → re-throws as `TRPCError({ code: 'CONFLICT', message: 'Issue was modified by another user' })`.
7. UI receives typed error. How it surfaces to the user is out of W2 scope; the contract is what matters.

### Realtime event (post-migration)

1. Client component (e.g., `LiveOutput`) on mount calls `registry.get<RealtimeProvider>().subscribe({ channel, onEvent })`.
2. Adapter opens the Supabase channel under the hood.
3. Events arrive → callback fires → component updates.
4. On unmount, adapter closes the channel.
5. No `@supabase/*` import anywhere in the component.

### Issue-comment soft-delete

1. Router calls `issueCommentService.softDelete(id, expectedVersion)`.
2. Service opens `db.transaction(async tx => { ... })`.
3. Inside the transaction: `UPDATE issue_comment SET deleted_at = NOW(), version = version + 1 WHERE id = ? AND version = ?`.
4. Any future dependent updates (decrement counts, emit events) land inside the same transaction.
5. Version mismatch → transaction throws → rollback → router returns `CONFLICT`.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Version-column backfill races with live writes | Project is pre-alpha; DB is nuke-and-reseed. No live-data concern. |
| UI forms don't round-trip `version` → every update becomes `CONFLICT` | Concurrency integration tests catch the factory behavior. Manual browser verification catches UI plumbing. Browser check is required, not optional. |
| Realtime migration breaks the paused `feat/r-ui-2-impl` branch | Accepted cost per Q4 brainstorm. Rebase when R-UI-2 resumes. |
| Auth adapter subtly changes SSR session semantics | `@supabase/ssr` has specific cookie-handling requirements for SSR. The adapter must preserve semantics exactly — no API cleanup while we're at it. Concrete verification: login + protected-route access + logout across a server/client boundary. |
| "One bundled PR" grows too big to review | Commit hygiene: one commit per concern, ordered for review (see Implementation sequencing below — 10 commits, each independently verifiable). Reviewer walks them in order. |
| Catalog tables surprisingly do have concurrent writers | Revisit scope if the W3 Settings-tabs work surfaces contention. For W2, unversioned is the call. |

---

## Testing

- `npx tsc --noEmit` — zero errors
- `npx vitest run` — existing 115 tests pass, plus new concurrency + transaction tests. Projected ~8-10 new tests (one race per targeted entity + transactional rollback test).
- `npm run verify` — 10/10 (seed structure unaffected)
- **Invariant grep sweep** (automated, enforced in W2 verification pass):
  - Zero `@supabase/ssr` imports outside `src/adapters/supabase/`
  - Zero `supabase.channel(` outside `src/adapters/supabase/`
  - Zero Anthropic wire-format strings (e.g., `"message_start"`, `"content_block_delta"`) outside `src/adapters/anthropic/`
- **Browser verification (invariant 21):** login → create issue → edit issue → run pipeline with live output streaming → logout. Zero console errors.

---

## Downstream effects

- **R-UI-2 (paused):** `feat/r-ui-2-impl` will need rebase against main after W2 merges. Realtime consumer code on that branch will conflict with the registry-routed versions. Rebase is expected and accepted.
- **W3 (alpha-critical build):** CLI, GitHub adapter, Anthropic adapter, Settings tabs, Mission Control — all consume the CRUD factory + registry seams that W2 completes. W3 can start immediately after W2 merges.
- **UI conflict UX:** W2 ships the `CONFLICT` error; a later focused UX pass defines how the UI responds (toast, refresh prompt, field-level diff, etc.).

---

## Implementation sequencing within the PR

Suggested commit order (review-friendly, each commit independently verifiable):

1. Schema migration + `version` column additions (`drizzle/0007_add_version_columns.sql`, schema.ts update)
2. CRUD factory audit + cleanup (polish pass from W1)
3. Versioned factory adoption for `issue` + router `expectedVersion` plumbing
4. Versioned factory for `pipelineRun` + `stageRun` + router plumbing
5. Versioned factory for `issueComment` + transactional soft-delete
6. `AIProtocolParser` port + `src/adapters/anthropic/protocol-parser.ts` adapter + orchestrator migration
7. `supabase/auth.ts` adapter + consumer migration + `src/lib/supabase/` deletion
8. `supabase/realtime.ts` adapter + consumer migration + registry bootstrap
9. Concurrency integration tests + transactional soft-delete test
10. Invariant grep sweep + verification matrix (docs/handoff)

Each commit passes `npx tsc --noEmit` and `npx vitest run`. Pre-commit hook stays enforced throughout.
