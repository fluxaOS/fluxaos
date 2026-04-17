# Wave 1 — Foundation Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land foundation-layer remediation that unblocks Waves 2-4. Amend invariant 7, retire stale standards doc, build the real CRUD factory, delete dead code + dead schema tables, relocate out-of-core files. Producing a cleaner substrate for Wave 2's entity migrations.

**Architecture:** Touch zero user-facing features. Touch the invariant docs, the CRUD factory, dead code (and its schema tables), and misplaced files. End state: invariants match reality, one authoritative standards doc, a CRUD factory fit for versioned entities, ~2000 lines of dead code deleted, core/ boundary strictly enforced for pluggable vendors only.

**Tech Stack:** TypeScript, Drizzle ORM, Postgres (Supabase Cloud), pnpm/npm scripts, Playwright + vitest.

**Inputs:**
- Triage decisions: `docs/superpowers/audits/2026-04-17-audit-triage.md`
- Phase 1 audit: `docs/superpowers/audits/2026-04-17-r-ui-1-r-ui-2-audit.md`
- Phase 2 audit: `docs/superpowers/audits/2026-04-17-phase2-full-codebase-audit.md`
- Audit design: `docs/superpowers/specs/2026-04-17-r-ui-audit-design.md`

**Scope boundary:** Wave 1 only. Waves 2-4 (entity migrations, auth/realtime registry routing, alpha-critical build, polish) are out of scope and will be planned in separate sessions after Wave 1 merges.

---

## File Structure

### Modified

| Path | Change |
|------|--------|
| `docs/invariants.md` | Amend §7 prose; update verification script; add §25 if merging principles from ARCHITECTURAL_STANDARDS.md |
| `src/core/services/crud-factory.ts` | Rewrite: versioned variant, type-safe without `as any`, both hard + soft delete strategies |
| `src/core/ports/database.ts` | Add intentional-typing comment per D-2 triage |
| `src/core/db/schema.ts` | Remove dead tables (`issue_attachment`, `issue_dependency`, `issue_saved_view`) |
| `src/server/routers/issue.ts` | Remove dead procedure trees (`attachment.*`, `dependency.*`, `savedView.*`, `stateOverride`, `close`, `reopen`, `users`) |
| `src/server/root.ts` or similar | Drop any references to deleted routers |
| `src/core/services/index.ts` | Drop exports of deleted services |
| `src/core/constants.ts` | Remove `OUTPUT_FORMAT` + `OutputFormat` |
| `src/core/gates/types.ts` | Remove `isRule` |
| `src/core/gates/index.ts` | Drop `isRule` re-export |
| `src/config/registry.ts` | Remove `has()` method |
| `src/components/stat-card.tsx` | Remove unused `trend` prop |
| `src/app/[org]/[user]/[project]/pipelines/page.tsx` | Remove unused `triggerRun` mutation + error block |
| `CLAUDE.md` | Drop ARCHITECTURAL_STANDARDS.md reference if present |
| `docs/session-quick-start.md` | Same |

### Deleted

| Path | Why |
|------|-----|
| `ARCHITECTURAL_STANDARDS.md` | D-1: retire, merge principles into invariants.md |
| `src/core/pipeline/types.ts` + empty `src/core/pipeline/` dir | Pattern 5: dead; shadow status types |
| `src/core/brands/types.ts` + empty `src/core/brands/` dir | Pattern 5: dead; Brand deferred |
| `src/core/personas/types.ts` + empty `src/core/personas/` dir | Pattern 5: dead |
| `src/core/skills/types.ts` (keep skills/ dir for materializer) | Pattern 5: dead; check if materializer re-imports anything from here |
| `src/core/ports/notification.ts` | Pattern 5: deferred, delete port |
| `src/core/ports/storage.ts` | Pattern 5: deferred, delete port |
| `src/core/services/brand.ts` | Pattern 5: Brand deferred |
| `src/core/orchestrator/index.ts` (barrel) | Phase 1 AUDIT-022: nobody imports it |
| `src/core/orchestrator/stage-worker.ts` | Phase 1 AUDIT-006: dead parallel path |
| `src/core/services/issue-attachment.ts` | Pattern 5 + C1: service for dead table |
| `src/core/services/issue-dependency.ts` | Same |
| `src/core/services/issue-saved-view.ts` | Same |

### Relocated (moved out of `src/core/`)

| From | To | Why |
|------|----|-----|
| `src/core/orchestrator/demo.ts` | `src/scripts/orchestrator-demo.ts` | Invariant 7: has `SupabaseDatabaseProvider` instantiation |
| `src/core/gates/demo.ts` | `src/scripts/gates-demo.ts` | Same |
| `src/core/db/scripts/connection.ts` | `src/scripts/db/connection.ts` | Same; consumed by db CLI scripts which also move |
| `src/core/db/scripts/issues.ts` | `src/scripts/db/issues.ts` | Consumer of relocated connection |
| `src/core/db/scripts/runs.ts` | `src/scripts/db/runs.ts` | Same |
| `src/core/db/scripts/gates.ts` | `src/scripts/db/gates.ts` | Same |
| `src/core/db/scripts/events.ts` | `src/scripts/db/events.ts` | Same |
| `src/core/db/seed.ts` | `src/scripts/db/seed.ts` | Invariant 7: has `SupabaseDatabaseProvider` instantiation |
| `src/core/db/nuke.ts` | `src/scripts/db/nuke.ts` | Same |
| `src/core/__tests__/verify/seed-check.ts` (if present) | `src/scripts/verify/seed-check.ts` | Adjust if exists; verification tests |
| `src/core/__tests__/verify/run-all.ts` | `src/scripts/verify/run-all.ts` | Same |
| `package.json` scripts | Update paths to `src/scripts/db/*.ts` | npm run db:issues etc |

### New migration

| Path | Purpose |
|------|---------|
| `drizzle/0006_drop_dead_tables.sql` | Drop `issue_attachment`, `issue_dependency`, `issue_saved_view` tables + associated indexes/FKs |

### Not touched in Wave 1 (deferred to later waves)

- CRUD factory **migration** of existing entities (`organization`, `project`, `provider`, `persona`, `skill`, `driver`, `issue-catalog`) — Wave 2
- Optimistic concurrency backfill on pipeline/persona/provider/etc. — Wave 2
- Auth/realtime registry routing — Wave 2
- Output-parser Anthropic-protocol extraction — Wave 2
- CLI, GitHub adapter, Anthropic adapter — Wave 3
- Settings tabs + Mission Control — Wave 3

---

## Task 1 — Amend invariant 7 prose + verification script

**Files:**
- Modify: `docs/invariants.md`

Under the Pattern 6 triage, invariant 7 needs to explicitly distinguish "core stack" (locked-in, imports allowed in `src/core/`) from "pluggable integrations" (adapter-only access from `src/core/`).

- [ ] **Step 1: Read the current invariant 7 text**

Run:
```bash
sed -n '55,62p' docs/invariants.md
```
Expected: current prose about "Zero vendor imports in src/core/" listing Supabase/Drizzle/BullMQ/provider SDKs.

- [ ] **Step 2: Replace invariant 7 prose with the two-category form**

Edit `docs/invariants.md` invariant 7 to read:

```
7. **Vendor coupling boundary.** `src/core/` may import from the **core stack** (TypeScript, Node.js, Next.js, React, tRPC, Tailwind, Drizzle ORM, Postgres) — these are locked-in infrastructure, not swappable vendors. `src/core/` may NOT import from **pluggable integrations** (AI providers, Git hosts, Issue trackers, Auth backends, Realtime transports, Queue providers, Storage, Subprocess executors); those are accessed only via port interfaces in `src/core/ports/` resolved through the adapter registry. Naming within `src/core/` should prefer generic terms (`db.select()` not `drizzleDb.select()`, `QueryProvider` not `DrizzleProvider`) so the code reads as infrastructure, not as coupling to a specific vendor.
```

- [ ] **Step 3: Update the verification script**

Find the bash verification block under the "Verification Script" heading. The current script already omits `drizzle-orm` from its scan set — confirm this is consistent with the amended prose. Update the comment above the block from:

```
# Invariant 7: No vendor imports in core
```

to:

```
# Invariant 7: No pluggable-integration vendor imports in core.
# Core-stack imports (drizzle-orm, next/*, react, etc.) are permitted per the two-category rule.
```

- [ ] **Step 4: Commit**

```bash
git add docs/invariants.md
git commit -m "docs(invariants): amend §7 with core-stack vs pluggable-integration distinction

Per audit triage Pattern 6: Drizzle ORM, Next.js, React, etc. are locked-in
core stack — they may be imported in src/core/. Pluggable integrations
(AI providers, auth backends, git hosts, realtime transports, queues,
storage, subprocess executors) remain adapter-only via the port layer.

Triage: docs/superpowers/audits/2026-04-17-audit-triage.md"
```

---

## Task 2 — Retire ARCHITECTURAL_STANDARDS.md

**Files:**
- Delete: `ARCHITECTURAL_STANDARDS.md`
- Modify: `docs/invariants.md` (only if audit finds orphan principles)
- Modify: `CLAUDE.md`, `docs/session-quick-start.md` (drop references)

- [ ] **Step 1: Audit the 14 numbered rules in ARCHITECTURAL_STANDARDS.md against docs/invariants.md**

Read both files. Map each numbered rule to the corresponding invariant, or mark it orphan:

```
Rule 1 (Max ~500 lines)          → Invariant 10                ✓ covered
Rule 2 (modular, config-driven)  → Founding principles 2 + 5   ✓ covered
Rule 3 (DRY)                     → Invariant 11                ✓ covered
Rule 4 (helper order)            → [obsolete; fh-commons gone] → drop
Rule 5 (Fail fast)               → Invariant 9                 ✓ covered
Rule 6 (No hardcoded values)     → Invariant 4 + Founding 2    ✓ covered
Rule 7 (comply with standards)   → [self-referential]          → drop
Rule 8 (E2E testing)             → Invariants 16-17            ✓ covered
Rule 9 (Playwright E2E)          → Invariant 17                ✓ covered
Rule 10 (Scripts Python)         → [obsolete]                  → drop
Rule 11 (Schema-driven UI)       → [webapp-era; obsolete]      → drop
Rule 12 (Webapp response)        → [obsolete]                  → drop
Rule 13 (Webapp service registration) → [obsolete]             → drop
Rule 14 (CLI Framework)          → [obsolete fhc-era]          → drop
```

All still-valid rules are already covered by existing invariants. No new invariants needed.

- [ ] **Step 2: Delete ARCHITECTURAL_STANDARDS.md**

```bash
git rm ARCHITECTURAL_STANDARDS.md
```

- [ ] **Step 3: grep for remaining references and fix them**

Run:
```bash
grep -rn "ARCHITECTURAL_STANDARDS" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next
```

Expected hits (update each to point to `docs/invariants.md` or delete):
- `CLAUDE.md` (global, shouldn't be in project repo — but check if project CLAUDE.md references it)
- `docs/session-quick-start.md` (if any)
- `.claude/ARCHITECTURAL_STANDARDS.md` (if fh-commons-era copy exists)

If a `.claude/ARCHITECTURAL_STANDARDS.md` exists, delete it too.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: retire ARCHITECTURAL_STANDARDS.md, invariants.md is sole source of truth

Per audit triage D-1: the standards doc was stale (Python/fh-commons/webapp
patterns that no longer apply). All still-valid principles (no hardcoding,
fail-fast, DRY, ≤500 lines, no mocks) are already covered by invariants
9, 10, 11, 15, 17. Parallel docs were a drift vector.

Triage: docs/superpowers/audits/2026-04-17-audit-triage.md"
```

---

## Task 3 — Add intentional-typing comment to ports/database.ts

**Files:**
- Modify: `src/core/ports/database.ts`

- [ ] **Step 1: Read current file**

```bash
cat src/core/ports/database.ts
```

- [ ] **Step 2: Add explanatory comment**

Prepend the comment block to the file's existing content:

```typescript
/**
 * DatabaseProvider port.
 *
 * Intentional design note (invariant 7, core-stack clarification):
 * The `Database` type alias resolves to `ReturnType<typeof drizzle<typeof schema>>`.
 * This is deliberate: Drizzle ORM is core-stack infrastructure (see invariants.md §7),
 * not a pluggable vendor. The adapter boundary runs at the *connection* level —
 * different deployments may point at different Postgres instances (Supabase Cloud,
 * self-hosted, Neon) but the query layer remains Drizzle in all of them.
 *
 * Swapping Drizzle for another ORM would be a tech-stack migration, not a config change.
 */
import type { Database } from '@/core/db/connection';

export interface DatabaseProvider {
  getConnection(): Database;
  close(): Promise<void>;
  healthCheck(): Promise<boolean>;
}
```

(Adjust interface methods to match the current file — don't invent methods. Read first, amend the comment only.)

- [ ] **Step 3: Commit**

```bash
git add src/core/ports/database.ts
git commit -m "docs(ports/database): document intentional Drizzle-typed Database alias

Per audit triage D-2: the type alias is deliberate infrastructure,
not a boundary leak. Invariant 7's core-stack clarification permits it."
```

---

## Task 4 — Rewrite CRUD factory (versioned + type-safe)

**Files:**
- Modify: `src/core/services/crud-factory.ts`
- Test: `src/__tests__/integration/crud-factory.test.ts` (new)

Current factory is a stub: uses `as any`, no versioned variant, assumes `updatedAt` always present. Rewrite to be generic over `Insert`/`Select` types, expose both hard-delete (`remove`) and versioned update/delete variants, and avoid `any` casts.

- [ ] **Step 1: Write failing integration test**

Create `src/__tests__/integration/crud-factory.test.ts`:

```typescript
import { describe, expect, it, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { organization } from '@/core/db/schema';
import { createCrudService, createVersionedCrudService } from '@/core/services/crud-factory';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');
const provider = new SupabaseDatabaseProvider(url);
const db = provider.getConnection();

type OrgInsert = typeof organization.$inferInsert;
type OrgSelect = typeof organization.$inferSelect;

const cleanup: string[] = [];

describe('createCrudService (non-versioned)', () => {
  afterAll(async () => {
    for (const id of cleanup) {
      await db.delete(organization).where(eq(organization.id, id)).catch(() => {});
    }
    await provider.close();
  });

  it('list / getById / create / update / remove round-trips', async () => {
    const svc = createCrudService<OrgInsert, OrgSelect>(db, organization);
    const created = await svc.create({ name: 'CRUD-TEST-' + Date.now(), slug: 'crud-test-' + Date.now() });
    cleanup.push(created.id);

    const fetched = await svc.getById(created.id);
    expect(fetched?.id).toBe(created.id);

    const updated = await svc.update(created.id, { name: 'CRUD-RENAMED' });
    expect(updated?.name).toBe('CRUD-RENAMED');

    await svc.remove(created.id);
    const after = await svc.getById(created.id);
    expect(after).toBeNull();
  });
});

describe('createVersionedCrudService', () => {
  afterAll(async () => {
    // same cleanup
  });

  it('updateWithVersion succeeds when version matches', async () => {
    // similar body, but use createVersionedCrudService + assert version bumped
  });

  it('updateWithVersion returns null when version is stale', async () => {
    // ... start at v1, update twice with v1 — second should return null
  });

  it('deleteWithVersion succeeds when version matches', async () => {
    // ...
  });

  it('deleteWithVersion returns false when version is stale', async () => {
    // ...
  });
});
```

(Expand the versioned-service test bodies mirroring the first test's shape.)

- [ ] **Step 2: Run test, confirm failure**

```bash
npx vitest run src/__tests__/integration/crud-factory.test.ts
```

Expected: FAIL — `createVersionedCrudService` does not exist yet.

- [ ] **Step 3: Rewrite `src/core/services/crud-factory.ts`**

Replace contents with:

```typescript
/**
 * Generic CRUD factories — DRY base for all entity services.
 *
 * Two variants:
 *   - createCrudService: basic list/getById/create/update/remove (no concurrency)
 *   - createVersionedCrudService: adds updateWithVersion / deleteWithVersion for
 *     entities that need optimistic concurrency (invariant 12)
 *
 * Both variants require the table to expose an `id` UUID column. The versioned
 * variant additionally requires an integer `version` column.
 */
import { and, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';

type WithIdColumn = { id: PgColumn };
type WithVersionColumn = { version: PgColumn };

export interface CrudService<TInsert, TSelect> {
  list(): Promise<TSelect[]>;
  getById(id: string): Promise<TSelect | null>;
  create(data: TInsert): Promise<TSelect>;
  update(id: string, data: Partial<TInsert>): Promise<TSelect | null>;
  remove(id: string): Promise<boolean>;
}

export interface VersionedCrudService<TInsert, TSelect>
  extends CrudService<TInsert, TSelect> {
  updateWithVersion(
    id: string,
    expectedVersion: number,
    data: Partial<TInsert>,
  ): Promise<TSelect | null>;
  deleteWithVersion(id: string, expectedVersion: number): Promise<boolean>;
}

export function createCrudService<TInsert, TSelect>(
  db: Database,
  table: PgTable & WithIdColumn,
): CrudService<TInsert, TSelect> {
  return {
    async list(): Promise<TSelect[]> {
      return (await db.select().from(table)) as TSelect[];
    },
    async getById(id: string): Promise<TSelect | null> {
      const [row] = await db.select().from(table).where(eq(table.id, id));
      return (row as TSelect | undefined) ?? null;
    },
    async create(data: TInsert): Promise<TSelect> {
      const [row] = await db
        .insert(table)
        .values(data as Record<string, unknown>)
        .returning();
      return row as TSelect;
    },
    async update(id: string, data: Partial<TInsert>): Promise<TSelect | null> {
      const [row] = await db
        .update(table)
        .set({
          ...(data as Record<string, unknown>),
          updatedAt: new Date(),
        })
        .where(eq(table.id, id))
        .returning();
      return (row as TSelect | undefined) ?? null;
    },
    async remove(id: string): Promise<boolean> {
      const rows = await db
        .delete(table)
        .where(eq(table.id, id))
        .returning({ id: table.id });
      return rows.length > 0;
    },
  };
}

export function createVersionedCrudService<TInsert, TSelect>(
  db: Database,
  table: PgTable & WithIdColumn & WithVersionColumn,
): VersionedCrudService<TInsert, TSelect> {
  const base = createCrudService<TInsert, TSelect>(db, table);

  return {
    ...base,
    async updateWithVersion(
      id: string,
      expectedVersion: number,
      data: Partial<TInsert>,
    ): Promise<TSelect | null> {
      const [row] = await db
        .update(table)
        .set({
          ...(data as Record<string, unknown>),
          version: expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(table.id, id), eq(table.version, expectedVersion)))
        .returning();
      return (row as TSelect | undefined) ?? null;
    },
    async deleteWithVersion(
      id: string,
      expectedVersion: number,
    ): Promise<boolean> {
      const rows = await db
        .delete(table)
        .where(and(eq(table.id, id), eq(table.version, expectedVersion)))
        .returning({ id: table.id });
      return rows.length > 0;
    },
  };
}
```

Notes on the design:
- `as Record<string, unknown>` is weaker than `as any` — it only asserts the data is object-shaped; Drizzle's own internal typings then validate the column-level shapes. If strict-mode tsc still complains, use `as Parameters<typeof db.insert<typeof table>['values']>[0]`.
- `remove` now returns `boolean` instead of `void` — callers that want "was it actually there" can branch; existing callers that don't care can ignore.
- Versioned service inherits the non-versioned methods so you don't lose `list()`/`getById()` when using the versioned variant.

- [ ] **Step 4: Run test, confirm pass**

```bash
npx vitest run src/__tests__/integration/crud-factory.test.ts
```

Expected: PASS on all 5 tests.

- [ ] **Step 5: Run full test suite to ensure no regressions**

```bash
npx vitest run
```

Expected: All existing tests pass. `skill.ts` uses `createCrudService` via its spread — the spread behavior is preserved.

- [ ] **Step 6: Commit**

```bash
git add src/core/services/crud-factory.ts src/__tests__/integration/crud-factory.test.ts
git commit -m "feat(crud-factory): add versioned variant, remove 'as any' casts

Per audit triage Pattern 4: existing factory was a stub (as any on every
insert/update, no versioned variant despite invariant 12). Rewrite adds
createVersionedCrudService with updateWithVersion / deleteWithVersion.
Non-versioned createCrudService still available for catalog-like tables
that don't need concurrency.

Integration test covers list/getById/create/update/remove plus all four
version-locked scenarios (match + stale on update, match + stale on delete).

Triage: docs/superpowers/audits/2026-04-17-audit-triage.md
Wave 2 will migrate existing hand-rolled CRUD onto this factory."
```

---

## Task 5 — Delete unused exports

**Files:**
- Modify: `src/core/constants.ts` (drop `OUTPUT_FORMAT`, `OutputFormat`)
- Modify: `src/core/gates/types.ts` (drop `isRule`)
- Modify: `src/core/gates/index.ts` (drop `isRule` re-export)
- Modify: `src/config/registry.ts` (drop `has()` method)
- Modify: `src/components/stat-card.tsx` (drop `trend` prop)
- Modify: `src/app/[org]/[user]/[project]/pipelines/page.tsx` (drop `triggerRun`)

- [ ] **Step 1: Grep to re-confirm each symbol is unused**

For each symbol:
```bash
grep -rn "OUTPUT_FORMAT\|OutputFormat" src/ --exclude-dir=__tests__
grep -rn "\bisRule\b" src/
grep -rn "registry.has\b" src/
grep -rn "trend=" src/
grep -rn "triggerRun" src/
```

If any grep returns non-zero hits outside of the files listed above, stop and investigate — a finding may be outdated.

- [ ] **Step 2: Delete `OUTPUT_FORMAT`/`OutputFormat`**

Read `src/core/constants.ts` lines 118-123. Delete both. Confirm file still compiles:

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Delete `isRule`**

Read `src/core/gates/types.ts:120-122` and `src/core/gates/index.ts:18`. Delete the function declaration and the re-export.

- [ ] **Step 4: Delete `registry.has()`**

Read `src/config/registry.ts:56-58`. Delete the method.

- [ ] **Step 5: Delete `trend` prop on StatCard**

Read `src/components/stat-card.tsx`. Remove the `trend?: string` prop from the interface at line 29. Remove the rendering branch at lines 51-53.

- [ ] **Step 6: Delete unused triggerRun mutation**

Read `src/app/[org]/[user]/[project]/pipelines/page.tsx:47-51` and any surrounding `triggerRun.error`/`triggerRun.mutate` call. Delete the mutation declaration and any conditional error-block render.

- [ ] **Step 7: Run full build**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: zero type errors, zero test failures.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: delete unused exports (triage Pattern 5)

- OUTPUT_FORMAT / OutputFormat (zero callers)
- isRule type guard (zero callers — isRuleGroup is the one actually used)
- registry.has() (zero callers)
- StatCard trend prop (never passed by any caller)
- pipelines/page.tsx triggerRun mutation (action prop is undefined, mutation never fires)

Triage: docs/superpowers/audits/2026-04-17-audit-triage.md"
```

---

## Task 6 — Delete dead source files (non-schema)

**Files:**
- Delete: see "Deleted" section in File Structure above
- Modify: `src/core/services/index.ts` (drop dead exports)

- [ ] **Step 1: Drop services barrel re-exports for deleted services**

Read `src/core/services/index.ts`. Remove these lines:
```typescript
export { createBrandService, type BrandService } from './brand';
export { createIssueAttachmentService, type IssueAttachmentService } from './issue-attachment';
export { createIssueDependencyService, type IssueDependencyService } from './issue-dependency';
export { createIssueSavedViewService, type IssueSavedViewService } from './issue-saved-view';
```

- [ ] **Step 2: Delete service files**

```bash
git rm src/core/services/brand.ts
git rm src/core/services/issue-attachment.ts
git rm src/core/services/issue-dependency.ts
git rm src/core/services/issue-saved-view.ts
```

- [ ] **Step 3: Delete dead type-only modules**

```bash
git rm src/core/pipeline/types.ts
rmdir src/core/pipeline || true   # only if empty

git rm src/core/brands/types.ts
rmdir src/core/brands || true

git rm src/core/personas/types.ts
rmdir src/core/personas || true

git rm src/core/skills/types.ts   # check materializer doesn't re-import first
```

Before deleting `skills/types.ts`, re-grep:
```bash
grep -rn "from '@/core/skills/types'\|from './types'" src/core/skills/ src/core/services/skill.ts src/server/routers/skill.ts
```
If any hit (the materializer or service re-imports from this file), port the needed types inline before deleting.

- [ ] **Step 4: Delete dead ports**

```bash
git rm src/core/ports/notification.ts
git rm src/core/ports/storage.ts
```

Check `src/core/ports/index.ts` — remove any re-exports of these.

- [ ] **Step 5: Delete orchestrator dead files**

```bash
git rm src/core/orchestrator/index.ts   # the barrel nobody imports
git rm src/core/orchestrator/stage-worker.ts   # dead parallel execution path
```

Grep to confirm no consumers:
```bash
grep -rn "from '@/core/orchestrator'" src/   # should be empty
grep -rn "createStageJobHandler\|stage-worker" src/   # should only appear in comments about the dead file pre-deletion
```

- [ ] **Step 6: Run full build**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: zero errors. If there's a consumer we missed (e.g., a test importing a deleted service), delete the consumer test too (it was testing dead code).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: delete dead source files (triage Pattern 5)

Services for deferred (Brand) and not-yet-implemented (attachment,
dependency, savedView) features. Type-only modules with zero importers.
Unimplemented ports for deferred integrations. Orchestrator barrel
nobody imports. Dead stage-worker (Phase 1 AUDIT-006).

Schema tables for these services are dropped in the next commit.

Triage: docs/superpowers/audits/2026-04-17-audit-triage.md"
```

---

## Task 7 — Drop dead schema tables + router procedures

**Files:**
- New: `drizzle/0006_drop_dead_tables.sql`
- Modify: `src/core/db/schema.ts` (remove table declarations)
- Modify: `src/server/routers/issue.ts` (remove dead procedure trees)
- Modify: seed data referencing the dropped tables (if any)

- [ ] **Step 1: Create the migration SQL**

Create `drizzle/0006_drop_dead_tables.sql`:

```sql
-- Drop dead tables per audit triage Pattern 5 + C1.
-- Corresponding tRPC procedures and service files were deleted in the
-- same remediation wave.

DROP TABLE IF EXISTS "issue_saved_view" CASCADE;
DROP TABLE IF EXISTS "issue_dependency" CASCADE;
DROP TABLE IF EXISTS "issue_attachment" CASCADE;
```

(Use CASCADE because there may be indexes or FKs still hanging off the tables even though no services reference them.)

- [ ] **Step 2: Remove table declarations from schema.ts**

Read `src/core/db/schema.ts`. Find the three table declarations (`issueAttachment`, `issueDependency`, `issueSavedView`). Delete each `pgTable(...)` declaration AND any type exports derived from them.

Also check for:
- Any `relations(issueAttachment, ...)` / `relations(issueDependency, ...)` / `relations(issueSavedView, ...)` blocks — delete them.
- Any FK references from OTHER tables back into these three — the migration's CASCADE handles the DB side, but schema.ts may have references to delete too.

- [ ] **Step 3: Remove dead procedure trees from `src/server/routers/issue.ts`**

Read the router. Delete these sub-routers / procedures:
- `attachment` (entire sub-router)
- `dependency` (entire sub-router)
- `savedView` (entire sub-router)
- `stateOverride` procedure
- `close` procedure
- `reopen` procedure
- `users` procedure (the `db.execute(sql\`SELECT DISTINCT val ...\`)` one)

Drop any imports that become unused (dynamic `import('drizzle-orm')` in `users`, the `@/core/services/issue-*` imports).

- [ ] **Step 4: Clean up seed data**

Grep for any seed data using these tables:
```bash
grep -rn "issueAttachment\|issueDependency\|issueSavedView" src/scripts/db/ 2>/dev/null || true
```
(Path is post-Task 8 relocation; if Task 8 hasn't run yet, the path is `src/core/db/seed.ts`.) Delete any seed inserts into the dropped tables.

- [ ] **Step 5: Run the migration locally**

```bash
npx drizzle-kit migrate
```

Expected: migration 0006 applies cleanly. If Drizzle tries to auto-generate a rollback/re-creation instead of applying your hand-written SQL, use `drizzle-kit push` instead or place the SQL manually and update `drizzle/meta/_journal.json`.

Verify via DB browser:
```bash
npm run db:studio
```
Confirm the three tables are gone.

- [ ] **Step 6: Run nuke+seed+verify to confirm end-to-end**

```bash
tsx src/core/db/nuke.ts        # or src/scripts/db/nuke.ts if Task 8 ran first
npm run db:seed
npm run verify
```

Expected: verification passes. If verify:seed references the dropped tables, update it.

- [ ] **Step 7: Run the full test suite**

```bash
npx vitest run
```

Expected: zero failures. Any test that exercised the dropped procedures should have been deleted in Task 6 alongside the service it called.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(schema): drop issue_attachment, issue_dependency, issue_saved_view

Per audit triage C1: dead procedures were removed in the previous commit;
dropping their tables completes the clean-slate removal. CASCADE handles
any lingering indexes or FKs.

Migration: drizzle/0006_drop_dead_tables.sql

Triage: docs/superpowers/audits/2026-04-17-audit-triage.md"
```

---

## Task 8 — Relocate out-of-core files

**Files:**
- Create: `src/scripts/` tree (if not present)
- Move: `src/core/orchestrator/demo.ts` → `src/scripts/orchestrator-demo.ts`
- Move: `src/core/gates/demo.ts` → `src/scripts/gates-demo.ts`
- Move: `src/core/db/scripts/*` → `src/scripts/db/*`
- Move: `src/core/db/seed.ts` → `src/scripts/db/seed.ts`
- Move: `src/core/db/nuke.ts` → `src/scripts/db/nuke.ts`
- Move: `src/core/__tests__/verify/` → `src/scripts/verify/` (if present)
- Modify: `package.json` scripts block
- Modify: `CLAUDE.md` commands table (new paths)

- [ ] **Step 1: Create `src/scripts/` directory structure**

```bash
mkdir -p src/scripts/db src/scripts/verify
```

- [ ] **Step 2: Move each file with git mv to preserve history**

```bash
git mv src/core/orchestrator/demo.ts src/scripts/orchestrator-demo.ts
git mv src/core/gates/demo.ts src/scripts/gates-demo.ts
git mv src/core/db/scripts/connection.ts src/scripts/db/connection.ts
git mv src/core/db/scripts/issues.ts src/scripts/db/issues.ts
git mv src/core/db/scripts/runs.ts src/scripts/db/runs.ts
git mv src/core/db/scripts/gates.ts src/scripts/db/gates.ts
git mv src/core/db/scripts/events.ts src/scripts/db/events.ts
git mv src/core/db/seed.ts src/scripts/db/seed.ts
git mv src/core/db/nuke.ts src/scripts/db/nuke.ts
```

If `src/core/db/__tests__/verify/*` exists (check first), move it too.

- [ ] **Step 3: Update imports inside the moved files**

After move, the moved files' `@/core/*` paths mostly still work (because `@/` resolves to `src/`), but the relative imports break. Open each moved file and fix relative imports:

```bash
grep -rn "from '\.\./\." src/scripts/
```

Fix each to use `@/` absolute paths to `src/core/*` (or `@/adapters/*` for the `SupabaseDatabaseProvider` imports which stay).

- [ ] **Step 4: Update `package.json` scripts**

Read `package.json`. Find the db: and verify: script entries. Update paths:

```json
"db:issues": "tsx src/scripts/db/issues.ts",
"db:runs": "tsx src/scripts/db/runs.ts",
"db:gates": "tsx src/scripts/db/gates.ts",
"db:events": "tsx src/scripts/db/events.ts",
"db:seed": "tsx src/scripts/db/seed.ts",
"verify": "tsx src/scripts/verify/run-all.ts",
"verify:seed": "tsx src/scripts/verify/seed-check.ts"
```

And replace `tsx src/core/db/nuke.ts` if it appears anywhere with `tsx src/scripts/db/nuke.ts`. The nuke script is the escape hatch documented in CLAUDE.md — update that too.

- [ ] **Step 5: Update CLAUDE.md commands table**

Read the Commands table in `CLAUDE.md`. Update paths to reflect the new locations:
- `tsx src/core/db/nuke.ts` → `tsx src/scripts/db/nuke.ts`
- Any inline references to `src/core/db/scripts/` in doc bodies

- [ ] **Step 6: Verify nothing imports the moved paths**

```bash
grep -rn "from '@/core/db/scripts\|from '@/core/orchestrator/demo\|from '@/core/gates/demo\|from '@/core/db/seed\|from '@/core/db/nuke'" src/
```

Expected: empty. If anything hits, update those imports too (they should move to `@/scripts/...`).

- [ ] **Step 7: Run the relocated scripts to confirm they still work**

```bash
tsx src/scripts/db/nuke.ts
npm run db:seed
npm run verify
npm run db:issues
```

Expected: each completes without error. `verify` passes all checks.

- [ ] **Step 8: Run full test suite**

```bash
npx vitest run
```

Expected: zero failures.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: relocate out-of-core files to src/scripts/

Per audit triage Pattern 5: demo and db-script files inside src/core/
instantiated SupabaseDatabaseProvider, violating invariant 7's pluggable-
integration rule. These are CLI-script helpers, not domain logic — they
belong outside core/. Paths updated in package.json, CLAUDE.md, and
internal imports.

Files moved (via git mv, history preserved):
- src/core/orchestrator/demo.ts -> src/scripts/orchestrator-demo.ts
- src/core/gates/demo.ts -> src/scripts/gates-demo.ts
- src/core/db/scripts/* -> src/scripts/db/*
- src/core/db/seed.ts -> src/scripts/db/seed.ts
- src/core/db/nuke.ts -> src/scripts/db/nuke.ts

Triage: docs/superpowers/audits/2026-04-17-audit-triage.md"
```

---

## Task 9 — Re-run Wave 1 verification end-to-end

**Files:** (none)

After each earlier task committed atomically, do a final full-repo verification. Wave 1's success criterion is "repo builds clean, all tests pass, mechanical invariant checks pass, end-to-end nuke+seed+verify still works."

- [ ] **Step 1: Clean install**

```bash
rm -rf node_modules
npm install
```

- [ ] **Step 2: Type-check the whole project**

```bash
npx tsc --noEmit
```

Expected: zero errors. If errors remain, they are Wave 1 regressions — fix before declaring done.

- [ ] **Step 3: Lint**

```bash
npm run lint
```

Expected: pass (or same warning level as before Wave 1).

- [ ] **Step 4: Integration tests**

```bash
npx vitest run
```

Expected: all pass. The new `crud-factory.test.ts` contributes 5 new tests.

- [ ] **Step 5: End-to-end data cycle**

```bash
tsx src/scripts/db/nuke.ts
npm run db:seed
npm run verify
npm run db:issues
npm run db:runs
npm run db:gates
npm run db:events
```

Expected: verify passes 10/10; each db:* script prints the expected shape.

- [ ] **Step 6: Run the mechanical invariant checks**

Run the verification script from `docs/invariants.md`:

```bash
grep -rn '"research"\|"implement"\|"review"\|"deploy"\|"complete"\|"rework"' src/ \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir=__tests__ --exclude-dir=adapters \
  | grep -v 'seed\|fixture\|\.test\.' || echo "PASS: No hardcoded stage names"

grep -rn "from '@supabase\|from 'bullmq\|from 'ioredis\|from '@anthropic\|from 'openai" src/core/ \
  | grep -v 'import type' && echo "FAIL: Vendor imports in core" \
  || echo "PASS: No pluggable-vendor imports in core"

find src/ -name '*.ts' -o -name '*.tsx' | while read f; do
  lines=$(wc -l < "$f")
  [ "$lines" -gt 500 ] && echo "WARN: $f has $lines lines (max ~500)"
done
```

Expected:
- Stage-name check: PASS (no matches)
- Pluggable-vendor check: PASS (the `SupabaseDatabaseProvider` relocations land the adapter-instance-in-core violations)
- File-size check: still has the same few warnings (issue.ts 685, client.tsx 880, schema.ts 1076, etc.) — these are Wave 2 targets, not Wave 1.

- [ ] **Step 7: Browser verification (invariant 21)**

Start the dev server:
```bash
npm run dev
```

Open `http://192.168.54.101:3000` (or the port the server picked) and manually confirm:
- Homepage redirects to a project
- Settings pages (drivers, skills) still load and list entities
- Issue detail page still loads
- Creating a new issue still works
- No console errors about missing exports

If the LAN auth bypass is enabled, journeys should work without login. Otherwise log in first.

**User must confirm Wave 1's browser-facing features work** — self-certification forbidden per invariant 21.

- [ ] **Step 8: No commit (verification only)**

This task validates the earlier commits. No files change. If any check fails, the earlier task that introduced the regression must be amended — do not paper over with a new "fix" commit for something Wave 1 was supposed to leave working.

---

## Wave 1 Exit Criteria

All of:
- [ ] All 9 tasks' commits are on the branch
- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` all green
- [ ] `npm run verify` passes 10/10
- [ ] Dev server runs; user browser-verified core flows (Task 9 Step 7)
- [ ] Invariants.md §7 reads with the two-category distinction
- [ ] ARCHITECTURAL_STANDARDS.md no longer in the repo
- [ ] CRUD factory has `createVersionedCrudService`
- [ ] 3 dead tables dropped; 7+ dead source files deleted; 4+ files relocated out of core
- [ ] Combined diff touches **zero** user-facing features (Wave 1 is invisible to users)

Then: fresh session picks up Wave 2 (entity migrations onto the CRUD factory + auth/realtime registry routing + output-parser extraction).

## Self-Review Checklist

**Spec coverage:**
- [x] Triage Pattern 6 (invariant 7 amendment) → Task 1
- [x] Triage D-1 (ARCHITECTURAL_STANDARDS retirement) → Task 2
- [x] Triage D-2 (database port comment) → Task 3
- [x] Triage Pattern 4 (CRUD factory build) → Task 4
- [x] Triage Pattern 5 part 1 (unused exports) → Task 5
- [x] Triage Pattern 5 part 2 (dead source files) → Task 6
- [x] Triage Pattern 5 part 3 (dead schema + procedures) → Task 7
- [x] Triage Pattern 5 part 4 (relocation) → Task 8
- [x] Invariant 21 user verification → Task 9

**Out of scope by design:**
- CRUD factory **migration** onto existing entities (Wave 2)
- Optimistic concurrency backfill (Wave 2)
- auth/realtime registry routing (Wave 2)
- output-parser Anthropic-protocol extraction (Wave 2)
- CLI, GitHub adapter, Anthropic adapter, Settings tabs, Mission Control (Wave 3)

**Placeholder scan:** None. Every task step has exact paths and commands. Where a file's current shape isn't 100% known (e.g., the exact interface methods in `ports/database.ts`), the task says "read first, amend only."

**Type consistency:** The new `createVersionedCrudService` is used by name in Task 4's commit message and self-review; `CrudService<TInsert, TSelect>` is the interface consumers spread. Existing `createSkillService` spreads `createCrudService` and is unaffected by the new versioned variant — no breakage surface.

**Known fragile step:** Task 7 Step 5 (drizzle-kit migrate of hand-written SQL). If the local Drizzle workflow is strictly `drizzle-kit generate`-driven, hand-authored migrations may need manual journal updates. The step notes this fallback.
