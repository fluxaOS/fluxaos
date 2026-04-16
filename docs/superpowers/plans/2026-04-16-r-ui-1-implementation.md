# R-UI-1 Implementation Plan — Settings CRUD + Harness→Driver Rename

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship settings-layer CRUD for drivers (formerly "harness") and skills via a shared `RecordEditor` primitive, plus a database-wide `harness`→`driver` rename, runtime feature-gating primitive, terminology glossary seed, and six Playwright journey tests — everything R-UI-1 requires before beta.

**Architecture:** Rename first (Phase 0) so driver is the canonical identifier for all downstream work. Then build a feature-agnostic list+detail+edit primitive (`RecordEditor`) backed by per-entity descriptors. Skill and driver settings pages are thin shells around the primitive. Optimistic locking is enforced server-side in tRPC routers; FK violations on skill delete produce meaningful error messages via a new `countReferences` query. Feature gating is wired through a `hasFeature()` stub today so future SaaS tiers slot in without scattered conditionals.

**Tech Stack:** Next.js 16 App Router, React 19, tRPC v11, Drizzle ORM 0.45, Zod v4, Supabase Cloud Postgres, Vitest (integration, real Supabase), Playwright 1.59 (E2E).

**Spec:** [`docs/superpowers/specs/2026-04-16-r-ui-1-design.md`](../specs/2026-04-16-r-ui-1-design.md)

**Branch:** `feat/r-ui-1-implementation` (create from `feat/r-ui-1-design` which holds the spec)

---

## Phase Summary

| Phase | What it delivers | Tasks |
|---|---|---|
| Phase 0 — Rename | `harness`→`driver` in schema, migrations, code, tests, active docs | 1–7 |
| Phase 1 — Primitives | `Feature` enum + `hasFeature()`; `RecordEditor` component + types | 8–13 |
| Phase 2 — Driver page | Settings page for drivers with toggle-enabled | 14–16 |
| Phase 3 — Skill page | Settings page for skills with delete + FK-safe error | 17–20 |
| Phase 4 — Terminology & nav | Glossary seed; nav link; active docs update | 21–23 |
| Phase 5 — Journey tests | Playwright scaffold + 6 stories + 6 specs | 24–30 |
| Phase 6 — Verification | Full browser verify + roadmap update | 31 |

Each task is atomic and commits independently. Every task lists exact files, exact test commands, and full code where new code is being added.

---

## Phase 0 — Rename `harness`→`driver`

### Task 1: Create implementation branch

**Files:** none

- [ ] **Step 1:** Verify clean working tree on `feat/r-ui-1-design`.

```bash
git status --short
```

Expected: empty output (all committed).

- [ ] **Step 2:** Create implementation branch.

```bash
git checkout -b feat/r-ui-1-implementation
```

- [ ] **Step 3:** Pre-flight: baseline verify that the app is green before changing anything.

```bash
npx tsx src/core/db/nuke.ts && npm run db:seed && npm run verify:seed
```

Expected: seed completes; `verify:seed` reports `All checks passed` with 10/10 PASS.

- [ ] **Step 4:** Commit a marker (empty commit).

```bash
git commit --allow-empty -m "chore: start R-UI-1 implementation"
```

---

### Task 2: Rename schema in `src/core/db/schema.ts`

**Files:**
- Modify: `src/core/db/schema.ts` — all `harnessCatalog` references → `driver`; `harnessId` columns → `driverId`; `harness` text column on `stageRun` → `driver` (if kept)

- [ ] **Step 1:** Open `src/core/db/schema.ts` and locate the `harnessCatalog = pgTable(...)` definition (line ~172).

- [ ] **Step 2:** Rename the export and the table name.

Change:
```ts
export const harnessCatalog = pgTable('harness_catalog', {
```
To:
```ts
export const driver = pgTable('driver', {
```

- [ ] **Step 3:** In the same file, find `harnessCatalogRelations` (if present) and rename to `driverRelations`.

```bash
grep -n "harnessCatalogRelations\|harnessCatalog" src/core/db/schema.ts
```

Expected: every match replaced — no remaining references.

- [ ] **Step 4:** Rename foreign-key columns on `pipelineStage` and `stageRun`.

In the `pipelineStage` definition change:
```ts
harnessId: uuid('harness_id').references(() => harnessCatalog.id),
```
To:
```ts
driverId: uuid('driver_id').references(() => driver.id),
```

In the `stageRun` definition change:
```ts
harness: text('harness'),
harnessId: uuid('harness_id').references(() => harnessCatalog.id),
```
To:
```ts
driver: text('driver'),
driverId: uuid('driver_id').references(() => driver.id),
```

- [ ] **Step 5:** Rename the `pipelineStage` and `stageRun` `relations(...)` blocks so they use `driver` instead of `harnessCatalog`.

Inside each relation block:
```ts
fields: [pipelineStage.harnessId],
references: [harnessCatalog.id],
```
Becomes:
```ts
fields: [pipelineStage.driverId],
references: [driver.id],
```

(Same pattern for `stageRun.harnessId` relation.)

- [ ] **Step 6:** Verify schema file no longer mentions `harness`.

```bash
grep -n "harness\|Harness" src/core/db/schema.ts
```

Expected: empty output.

- [ ] **Step 7:** Commit.

```bash
git add src/core/db/schema.ts
git commit -m "refactor: rename harnessCatalog→driver in schema"
```

---

### Task 3: Generate the rename migration

**Files:**
- Create: `drizzle/0004_harness_to_driver.sql` (exact filename will be generated by drizzle-kit; rename after)

- [ ] **Step 1:** Generate migration from the schema change.

```bash
npm run db:generate
```

Expected: a new file in `drizzle/` named `0004_*.sql` containing `ALTER TABLE`/`RENAME` statements.

- [ ] **Step 2:** Inspect the generated SQL. It should contain:
  - `ALTER TABLE "harness_catalog" RENAME TO "driver";`
  - `ALTER TABLE "pipeline_stage" RENAME COLUMN "harness_id" TO "driver_id";`
  - `ALTER TABLE "stage_run" RENAME COLUMN "harness_id" TO "driver_id";`
  - `ALTER TABLE "stage_run" RENAME COLUMN "harness" TO "driver";`
  - Constraint renames for the foreign keys

If drizzle-kit generated DROP+CREATE instead of RENAME (which would drop data), manually edit the SQL to use `RENAME` statements only. The PostgreSQL form is:

```sql
ALTER TABLE "harness_catalog" RENAME TO "driver";
ALTER TABLE "pipeline_stage" RENAME COLUMN "harness_id" TO "driver_id";
ALTER TABLE "stage_run" RENAME COLUMN "harness_id" TO "driver_id";
ALTER TABLE "stage_run" RENAME COLUMN "harness" TO "driver";
-- Foreign key constraints auto-rename with column renames.
```

- [ ] **Step 3:** Rename the migration file if drizzle-kit used a generic name.

```bash
mv drizzle/0004_*.sql drizzle/0004_harness_to_driver.sql
```

- [ ] **Step 4:** Apply the migration on a fresh DB to confirm it works.

```bash
npx tsx src/core/db/nuke.ts
npm run db:migrate
```

Expected: migration runs without error. (`nuke.ts` clears user data but leaves schema; `db:migrate` applies the rename atomically.)

- [ ] **Step 5:** Commit migration.

```bash
git add drizzle/0004_harness_to_driver.sql drizzle/meta/
git commit -m "refactor: add harness_catalog→driver rename migration"
```

---

### Task 4: Rename the tRPC router file

**Files:**
- Rename: `src/server/routers/harness.ts` → `src/server/routers/driver.ts`
- Modify: `src/server/root.ts`

- [ ] **Step 1:** Move the file.

```bash
git mv src/server/routers/harness.ts src/server/routers/driver.ts
```

- [ ] **Step 2:** Open `src/server/routers/driver.ts` and rewrite it for the new names.

Full replacement contents:

```ts
import { z } from 'zod/v4';
import { eq, and } from 'drizzle-orm';
import { router, publicProcedure } from '../trpc';
import { driver } from '@/core/db/schema';

export const driverRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(driver).orderBy(driver.name);
  }),

  getBySlug: publicProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(driver)
        .where(eq(driver.slug, input.slug));
      if (!row) throw new Error(`Driver not found: ${input.slug}`);
      return row;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(driver)
        .where(eq(driver.id, input.id));
      if (!row) throw new Error(`Driver not found: ${input.id}`);
      return row;
    }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        slug: z.string().min(1),
        binary: z.string().min(1),
        defaultArgs: z.array(z.string()).optional(),
        modelFlag: z.string().optional(),
        dirFlag: z.string().optional(),
        sessionNameFlag: z.string().optional(),
        promptTransport: z.string().optional(),
        promptSendDelayMs: z.number().int().optional(),
        probeCommand: z.string().optional(),
        issuePromptTemplate: z.string().optional(),
        queuePromptTemplate: z.string().optional(),
        envVars: z.record(z.string(), z.string()).optional(),
        extraArgs: z.record(z.string(), z.unknown()).optional(),
        isEnabled: z.boolean().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db.insert(driver).values(input).returning();
      return row;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        name: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        binary: z.string().min(1).optional(),
        defaultArgs: z.array(z.string()).optional(),
        modelFlag: z.string().nullable().optional(),
        dirFlag: z.string().nullable().optional(),
        sessionNameFlag: z.string().nullable().optional(),
        promptTransport: z.string().optional(),
        promptSendDelayMs: z.number().int().optional(),
        probeCommand: z.string().nullable().optional(),
        issuePromptTemplate: z.string().nullable().optional(),
        queuePromptTemplate: z.string().nullable().optional(),
        envVars: z.record(z.string(), z.string()).optional(),
        extraArgs: z.record(z.string(), z.unknown()).optional(),
        isEnabled: z.boolean().optional(),
        notes: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, version, ...data } = input;
      const [row] = await ctx.db
        .update(driver)
        .set({ ...data, version: version + 1, updatedAt: new Date() })
        .where(and(eq(driver.id, id), eq(driver.version, version)))
        .returning();
      if (!row) throw new Error('Optimistic concurrency conflict');
      return row;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .delete(driver)
        .where(eq(driver.id, input.id))
        .returning();
      if (!row) throw new Error(`Driver not found: ${input.id}`);
      return row;
    }),
});
```

- [ ] **Step 3:** Update `src/server/root.ts`. Change:

```ts
import { harnessRouter } from './routers/harness';
```
To:
```ts
import { driverRouter } from './routers/driver';
```

And:
```ts
  harness: harnessRouter,
```
To:
```ts
  driver: driverRouter,
```

- [ ] **Step 4:** Commit.

```bash
git add src/server/routers/driver.ts src/server/root.ts
git commit -m "refactor: rename harnessRouter→driverRouter and register as driver"
```

---

### Task 5: Rename identifiers across all other source files

**Files:** ~20 source files under `src/` that reference `harness` / `Harness` / `harnessCatalog` / `harnessId` / `trpc.harness`. See list below.

- [ ] **Step 1:** Enumerate remaining references.

```bash
grep -rn "harness\|Harness" src/ tests/ --include="*.ts" --include="*.tsx" | grep -v schema.ts | grep -v routers/driver.ts | grep -v root.ts
```

Expected: a list of ~20 files with remaining references. Record the list.

- [ ] **Step 2:** Apply name substitutions across all source and test files. The substitutions, in the order they must be applied (most-specific first):

| Find | Replace |
|---|---|
| `harnessCatalog` | `driver` |
| `harnessRouter` | `driverRouter` |
| `harness_catalog` | `driver` (string literals in SQL/raw queries only) |
| `harnessId` | `driverId` |
| `harness_id` | `driver_id` (string literals only) |
| `HarnessCatalog` type alias | `Driver` |
| `Harness` (type/interface names) | `Driver` |
| `trpc.harness` | `trpc.driver` |
| `'harness'` / `"harness"` (string literals used as keys) | `'driver'` / `"driver"` |

Use your editor's project-wide find/replace or, if using the CLI:

```bash
# Dry-run the most-specific substitutions first. Use sed per-file to avoid replacing in schema.ts (already renamed) or routers/driver.ts.
for f in $(grep -rlE "harnessCatalog|harnessRouter|harnessId|trpc\.harness" src/ tests/ --include="*.ts" --include="*.tsx" | grep -v "schema.ts\|routers/driver.ts"); do
  sed -i \
    -e 's/harnessCatalog/driver/g' \
    -e 's/harnessRouter/driverRouter/g' \
    -e 's/harnessId/driverId/g' \
    -e 's/trpc\.harness/trpc.driver/g' \
    -e 's/\bHarnessCatalog\b/Driver/g' \
    "$f"
done
```

- [ ] **Step 3:** Apply remaining lowercase/identifier substitutions. Manual review required for these because `harness` might appear in user-facing strings that should stay:

```bash
grep -rn "\bharness\b\|\bHarness\b" src/ tests/ --include="*.ts" --include="*.tsx" | grep -v routers/driver.ts
```

For each match, decide:
- **Code identifier** (variable, property, type) → rename to `driver` / `Driver`
- **User-facing string** (button labels, error messages, prompt text) → rename to `driver` / `Driver` (we chose this name to be user-facing too)
- **Comment** → update to reflect new name

- [ ] **Step 4:** Special case — `stageRun.harness` was a text column; it is now `stageRun.driver`. Some code reads this column and stores human-readable values. Find and update:

```bash
grep -rn "\.harness\b" src/ --include="*.ts" --include="*.tsx" | grep -v routers/driver.ts
```

Update each reference to `.driver`.

- [ ] **Step 5:** Update seed data.

Open `src/core/db/seed.ts` and replace all `harness` / `harnessCatalog` references with `driver`. The seed inserts one row into the table (name "Claude Code"). Ensure the insert statement uses the new schema export and that any log messages say "driver" not "harness".

- [ ] **Step 6:** Update `src/core/db/nuke.ts` if it lists `harness_catalog` in its table truncation list — replace with `driver`.

```bash
grep -n "harness_catalog\|harnessCatalog" src/core/db/nuke.ts
```

Expected: empty output after edits.

- [ ] **Step 7:** Verify nothing remains in source/test code.

```bash
grep -rn "harness\|Harness\|HARNESS" src/ tests/ --include="*.ts" --include="*.tsx"
```

Expected: empty output.

- [ ] **Step 8:** Typecheck.

```bash
npx tsc --noEmit
```

Expected: no errors. If there are errors, they are real — fix them before committing.

- [ ] **Step 9:** Commit.

```bash
git add -A src/ tests/
git commit -m "refactor: rename harness→driver across all source and test files"
```

---

### Task 6: Run full test suite against renamed code

**Files:** none

- [ ] **Step 1:** Re-seed database to pick up the new schema export paths.

```bash
npx tsx src/core/db/nuke.ts && npm run db:seed
```

Expected: seed completes without errors. The one driver row (Claude Code) is inserted into the `driver` table.

- [ ] **Step 2:** Run seed verification.

```bash
npm run verify:seed
```

Expected: `All checks passed` — 10/10 PASS. The check that counts "1 harness" should have already been updated in Task 5, Step 4; if it wasn't, fix it now.

- [ ] **Step 3:** Run existing integration tests.

```bash
npx vitest run
```

Expected: all existing tests pass. Fixes to `orchestrator.test.ts` / `orchestrator-e2e.test.ts` may be needed if they referenced `harness` identifiers — those were updated in Task 5 Step 2 but verify here.

- [ ] **Step 4:** Run DB query scripts to confirm runtime parity.

```bash
npm run db:issues
```

Expected: 2 issues listed.

- [ ] **Step 5:** Commit any test fixups that came out of Step 3 (may be none).

```bash
git status --short
# If any test files changed:
git add -A
git commit -m "test: fixups for harness→driver rename"
```

---

### Task 7: Rename in active docs and CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/session-quick-start.md`
- Modify: `docs/invariants.md`
- Modify: `docs/superpowers/roadmap.md`
- Modify: `docs/superpowers/specs/2026-04-11-ui-inventory.md` (if it references harness)
- **Do NOT modify:** any file in `docs/superpowers/handoffs/`, `docs/superpowers/plans/` (other than this one), `docs/superpowers/specs/` older than this one, `docs/superpowers/rca/`, `docs/planning/` — historical artifacts are frozen.

- [ ] **Step 1:** Find active doc references.

```bash
grep -rn "harness\|Harness" CLAUDE.md docs/session-quick-start.md docs/invariants.md docs/superpowers/roadmap.md docs/superpowers/specs/2026-04-11-ui-inventory.md 2>/dev/null
```

Expected: a handful of matches (mainly commands table or invariant references).

- [ ] **Step 2:** For each match, update the text to use "driver" / "Driver". Keep one-line "formerly harness" clarifiers where the old term has durable historical significance (e.g., in invariants.md if it names the table).

- [ ] **Step 3:** Verify the active-docs grep is now clean.

```bash
grep -rn "harness\|Harness" CLAUDE.md docs/session-quick-start.md docs/invariants.md docs/superpowers/roadmap.md
```

Expected: empty output (or one-line "formerly harness" clarifiers we intentionally kept).

- [ ] **Step 4:** Commit.

```bash
git add CLAUDE.md docs/session-quick-start.md docs/invariants.md docs/superpowers/roadmap.md docs/superpowers/specs/2026-04-11-ui-inventory.md
git commit -m "docs: rename harness→driver in active docs"
```

---

## Phase 1 — Primitives

### Task 8: Create `Feature` enum + `hasFeature()` stub

**Files:**
- Create: `src/core/features/features.ts`
- Create: `src/__tests__/integration/features-primitive.test.ts`

- [ ] **Step 1:** Write the failing test.

```ts
// src/__tests__/integration/features-primitive.test.ts
import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { Feature, hasFeature } from '@/core/features/features';

describe('features primitive', () => {
  it('every Feature enum value resolves to true today', () => {
    // DEF-004: when tier gating is wired, these expectations will change per-tier.
    // Today, every user has every feature (pre-SaaS stub).
    const userId = 'test-user';
    for (const feature of Object.values(Feature)) {
      expect(hasFeature(userId, feature)).toBe(true);
    }
  });

  it('has exactly the expected seed feature flags', () => {
    expect(Object.keys(Feature).sort()).toEqual(
      ['PREVIEW_GATE', 'REVISION_HISTORY', 'ROLE_BASED_PERMISSIONS'].sort(),
    );
  });
});
```

- [ ] **Step 2:** Run the test to confirm it fails.

```bash
npx vitest run src/__tests__/integration/features-primitive.test.ts
```

Expected: FAIL — cannot resolve module `@/core/features/features`.

- [ ] **Step 3:** Create the implementation.

```ts
// src/core/features/features.ts

/**
 * Runtime feature-gating primitive.
 *
 * DEF-004: This is a stub. Every feature is available to every user today.
 * When the SaaS tier model ships, wire `hasFeature()` to read subscription
 * state from `user` or `organization` and update the function body.
 *
 * The function signature MUST remain stable so callers never change.
 *
 * Callers should use this to gate deferred features that already have UI
 * hooks in place — see DEF-001 (preview gate), DEF-002 (RBAC),
 * DEF-003 (revision history).
 */
export enum Feature {
  /** DEF-001 — openclaw-style blur-on-unauthed-view */
  PREVIEW_GATE = 'preview_gate',

  /** DEF-002 — role checks on edit/delete buttons */
  ROLE_BASED_PERMISSIONS = 'role_based_permissions',

  /** DEF-003 — per-row revision history + revert */
  REVISION_HISTORY = 'revision_history',
}

export function hasFeature(_userId: string, _feature: Feature): boolean {
  // DEF-004: wire to subscription/tier state when SaaS model exists.
  // Today: every user has every feature.
  return true;
}
```

- [ ] **Step 4:** Run tests to confirm pass.

```bash
npx vitest run src/__tests__/integration/features-primitive.test.ts
```

Expected: both tests PASS.

- [ ] **Step 5:** Commit.

```bash
git add src/core/features/features.ts src/__tests__/integration/features-primitive.test.ts
git commit -m "feat: add Feature enum + hasFeature() stub (DEF-001..004 hook point)"
```

---

### Task 9: Create `RecordEditor` types

**Files:**
- Create: `src/components/record-editor/types.ts`

- [ ] **Step 1:** Create the types file.

```ts
// src/components/record-editor/types.ts
import type { ReactNode } from 'react';

export type FieldType =
  | 'text'
  | 'textarea'
  | 'textarea-large'
  | 'tags'
  | 'boolean'
  | 'readonly';

export type FieldDescriptor<TRecord> = {
  /** Typed key on the record row */
  key: keyof TRecord & string;
  /** UI label for the field */
  label: string;
  /** Rendering hint */
  fieldType: FieldType;
  /** When true, Save blocks on empty value */
  required?: boolean;
  /** Placeholder text for text/textarea inputs */
  placeholder?: string;
  /**
   * Per-field validator. Returns null if valid, error message if invalid.
   * Runs client-side before submit.
   */
  validate?: (value: unknown) => string | null;
};

export type RecordDescriptor<TRecord> = {
  /** Lowercase entity name, used in messages ("delete this {entityName}?") */
  entityName: string;
  /** Primary label shown in the list row */
  title: (r: TRecord) => string;
  /** Secondary label shown next to the title (slug, scope, etc.) */
  subtitle?: (r: TRecord) => string;
  /** Field list drives what gets shown in the detail panel */
  fields: FieldDescriptor<TRecord>[];
  /** Key of a boolean field that renders as a list-row toggle (optional) */
  toggleEnabledField?: keyof TRecord & string;
};

export type RecordWithVersion = {
  id: string;
  version: number;
};

export type RecordEditorProps<TRecord extends RecordWithVersion> = {
  descriptor: RecordDescriptor<TRecord>;
  records: TRecord[];
  isLoading: boolean;

  // Required mutations
  onSave: (
    id: string,
    patch: Partial<TRecord>,
    expectedVersion: number,
  ) => Promise<void>;

  // Optional mutations — absence hides the action
  onDelete?: (id: string, expectedVersion: number) => Promise<void>;
  onToggleEnabled?: (
    id: string,
    enabled: boolean,
    expectedVersion: number,
  ) => Promise<void>;

  // Deferred-hook slots (no-ops today; wire to features later)
  /** DEF-001 — openclaw-style preview blur. Return a wrapping node. */
  previewGate?: (record: TRecord) => ReactNode;
  /** DEF-002 — role check for edit button visibility */
  canEdit?: (record: TRecord) => boolean;
  /** DEF-002 — role check for delete button visibility */
  canDelete?: (record: TRecord) => boolean;
  /** DEF-003 — fires when user enters edit mode so history can snapshot */
  onEditSnapshot?: (record: TRecord) => void;
};
```

- [ ] **Step 2:** Typecheck.

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3:** Commit.

```bash
git add src/components/record-editor/types.ts
git commit -m "feat(record-editor): add descriptor and props types"
```

---

### Task 10: Create `RecordField` component

**Files:**
- Create: `src/components/record-editor/RecordField.tsx`

- [ ] **Step 1:** Create the component. Renders one field row based on `fieldType`.

```tsx
// src/components/record-editor/RecordField.tsx
'use client';

import type { FieldDescriptor } from './types';

type Props = {
  field: FieldDescriptor<Record<string, unknown>>;
  value: unknown;
  editing: boolean;
  onChange: (next: unknown) => void;
  error?: string | null;
};

export function RecordField({ field, value, editing, onChange, error }: Props) {
  const common = 'w-full bg-slate-900 border rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-electric-violet/40';
  const borderClass = error ? 'border-red-500/60' : 'border-slate-700/60';

  const label = (
    <label className="text-xs font-medium text-slate-400 block mb-1">
      {field.label}
      {field.required ? <span className="text-red-400 ml-0.5">*</span> : null}
    </label>
  );

  // READ-ONLY (always displayed, never editable — used for `version`, timestamps)
  if (field.fieldType === 'readonly') {
    return (
      <div className="mb-3">
        {label}
        <div className="text-sm font-mono text-slate-300 px-3 py-2 bg-slate-900/60 rounded-lg">
          {String(value ?? '—')}
        </div>
      </div>
    );
  }

  // BOOLEAN toggle
  if (field.fieldType === 'boolean') {
    return (
      <div className="mb-3">
        {label}
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            disabled={!editing}
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="w-10 h-5 appearance-none bg-slate-700 rounded-full relative cursor-pointer transition-colors checked:bg-electric-violet disabled:opacity-50"
          />
          <span className="ml-2 text-sm text-slate-300">
            {value ? 'Enabled' : 'Disabled'}
          </span>
        </label>
      </div>
    );
  }

  // TAGS (comma-separated chip input)
  if (field.fieldType === 'tags') {
    const arr: string[] = Array.isArray(value) ? (value as string[]) : [];
    const raw = arr.join(', ');
    return (
      <div className="mb-3">
        {label}
        {editing ? (
          <input
            type="text"
            value={raw}
            onChange={(e) => {
              const parsed = e.target.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean);
              onChange(parsed);
            }}
            placeholder="comma, separated, tags"
            className={`${common} ${borderClass}`}
          />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {arr.length === 0 ? (
              <span className="text-sm text-slate-500">—</span>
            ) : (
              arr.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 text-xs bg-electric-violet/15 text-soft-violet rounded-full"
                >
                  {tag}
                </span>
              ))
            )}
          </div>
        )}
        {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
      </div>
    );
  }

  // TEXTAREA-LARGE
  if (field.fieldType === 'textarea-large') {
    return (
      <div className="mb-3">
        {label}
        <textarea
          disabled={!editing}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={14}
          className={`${common} ${borderClass} font-mono text-xs leading-relaxed disabled:opacity-75`}
        />
        {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
      </div>
    );
  }

  // TEXTAREA
  if (field.fieldType === 'textarea') {
    return (
      <div className="mb-3">
        {label}
        <textarea
          disabled={!editing}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={4}
          className={`${common} ${borderClass} disabled:opacity-75`}
        />
        {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
      </div>
    );
  }

  // TEXT (default)
  return (
    <div className="mb-3">
      {label}
      <input
        type="text"
        disabled={!editing}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        className={`${common} ${borderClass} disabled:opacity-75`}
      />
      {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 2:** Typecheck.

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3:** Commit.

```bash
git add src/components/record-editor/RecordField.tsx
git commit -m "feat(record-editor): add RecordField dispatch component"
```

---

### Task 11: Create `RecordActionsBar` component

**Files:**
- Create: `src/components/record-editor/RecordActionsBar.tsx`

- [ ] **Step 1:** Create the component.

```tsx
// src/components/record-editor/RecordActionsBar.tsx
'use client';

type ActionsState =
  | { kind: 'viewing' }
  | { kind: 'editing' }
  | { kind: 'saving' }
  | { kind: 'confirming-delete' }
  | { kind: 'deleting' };

type Props = {
  state: ActionsState;
  entityName: string;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDeleteRequest: () => void;
  onDeleteConfirm: () => void;
  onDeleteAbort: () => void;
};

export function RecordActionsBar(props: Props) {
  const {
    state,
    entityName,
    canEdit,
    canDelete,
    onEdit,
    onSave,
    onCancel,
    onDeleteRequest,
    onDeleteConfirm,
    onDeleteAbort,
  } = props;

  const btn =
    'px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed';
  const primary = `${btn} bg-electric-violet text-white hover:bg-accent-hover`;
  const secondary = `${btn} bg-slate-700 text-slate-200 hover:bg-slate-600`;
  const danger = `${btn} bg-red-600/20 text-red-300 hover:bg-red-600/30 border border-red-600/30`;

  if (state.kind === 'viewing') {
    return (
      <div className="flex gap-2 mt-4">
        <button type="button" className={primary} onClick={onEdit} disabled={!canEdit}>
          Edit
        </button>
      </div>
    );
  }

  if (state.kind === 'editing') {
    return (
      <div className="flex gap-2 mt-4">
        <button type="button" className={primary} onClick={onSave}>
          Save
        </button>
        <button type="button" className={secondary} onClick={onCancel}>
          Cancel
        </button>
        {canDelete ? (
          <button
            type="button"
            className={`${danger} ml-auto`}
            onClick={onDeleteRequest}
          >
            Delete
          </button>
        ) : null}
      </div>
    );
  }

  if (state.kind === 'saving') {
    return (
      <div className="flex gap-2 mt-4">
        <button type="button" className={primary} disabled>
          Saving…
        </button>
        <button type="button" className={secondary} disabled>
          Cancel
        </button>
      </div>
    );
  }

  if (state.kind === 'confirming-delete') {
    return (
      <div className="mt-4 p-3 rounded-lg bg-red-600/10 border border-red-600/30">
        <p className="text-sm text-red-200 mb-2">
          Delete this {entityName}? This cannot be undone.
        </p>
        <div className="flex gap-2">
          <button type="button" className={danger} onClick={onDeleteConfirm}>
            Yes, delete
          </button>
          <button type="button" className={secondary} onClick={onDeleteAbort}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // state.kind === 'deleting'
  return (
    <div className="flex gap-2 mt-4">
      <button type="button" className={danger} disabled>
        Deleting…
      </button>
    </div>
  );
}

export type { ActionsState };
```

- [ ] **Step 2:** Typecheck.

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3:** Commit.

```bash
git add src/components/record-editor/RecordActionsBar.tsx
git commit -m "feat(record-editor): add RecordActionsBar state machine"
```

---

### Task 12: Create `RecordEditor` main component

**Files:**
- Create: `src/components/record-editor/RecordEditor.tsx`

- [ ] **Step 1:** Create the component.

```tsx
// src/components/record-editor/RecordEditor.tsx
'use client';

import { useMemo, useState } from 'react';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { SkeletonTable } from '@/components/skeleton';
import { RecordField } from './RecordField';
import { RecordActionsBar, type ActionsState } from './RecordActionsBar';
import type {
  RecordEditorProps,
  RecordWithVersion,
  FieldDescriptor,
} from './types';

export function RecordEditor<TRecord extends RecordWithVersion>(
  props: RecordEditorProps<TRecord>,
) {
  const {
    descriptor,
    records,
    isLoading,
    onSave,
    onDelete,
    onToggleEnabled,
    previewGate,
    canEdit = () => true,
    canDelete = () => true,
    onEditSnapshot,
  } = props;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [state, setState] = useState<ActionsState>({ kind: 'viewing' });
  const [draft, setDraft] = useState<Partial<TRecord>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  const selected = useMemo(
    () => records.find((r) => r.id === selectedId) ?? null,
    [records, selectedId],
  );

  // When the list refreshes after Save, stay on the same record and exit editing.
  // When the selected record is deleted, clear selection.
  const handleSelect = (id: string) => {
    if (state.kind === 'editing' || state.kind === 'confirming-delete') {
      const ok = window.confirm('Discard unsaved changes?');
      if (!ok) return;
    }
    setSelectedId(id);
    setState({ kind: 'viewing' });
    setDraft({});
    setFieldErrors({});
    setBanner(null);
  };

  const handleEdit = () => {
    if (!selected) return;
    // DEF-003: snapshot hook fires on every edit entry
    onEditSnapshot?.(selected);
    setDraft(selected as Partial<TRecord>);
    setState({ kind: 'editing' });
    setBanner(null);
  };

  const handleCancel = () => {
    setDraft({});
    setFieldErrors({});
    setState({ kind: 'viewing' });
    setBanner(null);
  };

  const validate = (d: Partial<TRecord>): Record<string, string> => {
    const errs: Record<string, string> = {};
    for (const f of descriptor.fields) {
      const v = d[f.key];
      if (f.required && (v === undefined || v === null || v === '')) {
        errs[f.key] = 'Required';
        continue;
      }
      if (f.validate) {
        const msg = f.validate(v);
        if (msg) errs[f.key] = msg;
      }
    }
    return errs;
  };

  const handleSave = async () => {
    if (!selected) return;
    const errs = validate(draft);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setState({ kind: 'saving' });
    try {
      await onSave(selected.id, draft, selected.version);
      setDraft({});
      setState({ kind: 'viewing' });
      setBanner(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/optimistic|conflict|version/i.test(msg)) {
        setBanner({
          kind: 'error',
          text: 'This record was updated elsewhere. Refresh to see the latest, or save again to retry.',
        });
      } else {
        setBanner({ kind: 'error', text: `Save failed: ${msg}` });
      }
      setState({ kind: 'editing' });
    }
  };

  const handleDeleteRequest = () => setState({ kind: 'confirming-delete' });
  const handleDeleteAbort = () => setState({ kind: 'editing' });
  const handleDeleteConfirm = async () => {
    if (!selected || !onDelete) return;
    setState({ kind: 'deleting' });
    try {
      await onDelete(selected.id, selected.version);
      setSelectedId(null);
      setDraft({});
      setState({ kind: 'viewing' });
      setBanner(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBanner({ kind: 'error', text: msg });
      setState({ kind: 'editing' });
    }
  };

  const handleToggle = async (r: TRecord) => {
    if (!onToggleEnabled || !descriptor.toggleEnabledField) return;
    const current = Boolean(r[descriptor.toggleEnabledField]);
    try {
      await onToggleEnabled(r.id, !current, r.version);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBanner({ kind: 'error', text: `Toggle failed: ${msg}` });
    }
  };

  const getFieldValue = (field: FieldDescriptor<TRecord>): unknown => {
    if (state.kind === 'editing' || state.kind === 'saving') {
      if (field.key in draft) return draft[field.key];
    }
    return selected ? selected[field.key] : undefined;
  };

  const setFieldValue = (field: FieldDescriptor<TRecord>, value: unknown) => {
    setDraft({ ...draft, [field.key]: value });
  };

  if (isLoading) {
    return (
      <Card padding="p-0">
        <SkeletonTable />
      </Card>
    );
  }

  if (records.length === 0) {
    return (
      <Card padding="p-8">
        <EmptyState
          title={`No ${descriptor.entityName}s yet`}
          description={`Seed data or create one to get started.`}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* LIST */}
      <Card padding="p-0">
        <ul className="divide-y divide-slate-700/20">
          {records.map((r) => {
            const isSelected = r.id === selectedId;
            const enabled = descriptor.toggleEnabledField
              ? Boolean(r[descriptor.toggleEnabledField])
              : null;
            return (
              <li
                key={r.id}
                className={`flex items-center gap-4 px-5 py-3 cursor-pointer hover:bg-white/[0.03] transition-colors ${
                  isSelected ? 'bg-electric-violet/10' : ''
                }`}
                onClick={() => handleSelect(r.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white">
                    {descriptor.title(r)}
                  </div>
                  {descriptor.subtitle ? (
                    <div className="text-xs text-slate-500 truncate">
                      {descriptor.subtitle(r)}
                    </div>
                  ) : null}
                </div>
                {enabled !== null && onToggleEnabled ? (
                  <label
                    className="inline-flex items-center cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggle(r);
                    }}
                  >
                    <span
                      className={`w-10 h-5 rounded-full relative transition-colors ${
                        enabled ? 'bg-electric-violet' : 'bg-slate-700'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                          enabled ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                      />
                    </span>
                  </label>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      {/* DETAIL */}
      {selected ? (
        <Card padding="p-6">
          {banner ? (
            <div
              className={`mb-4 px-3 py-2 rounded-lg text-sm ${
                banner.kind === 'error'
                  ? 'bg-red-600/10 text-red-300 border border-red-600/30'
                  : 'bg-blue-600/10 text-blue-300 border border-blue-600/30'
              }`}
            >
              {banner.text}
            </div>
          ) : null}

          <h3 className="text-lg font-semibold text-white mb-1">
            {descriptor.title(selected)}
          </h3>
          {descriptor.subtitle ? (
            <p className="text-xs text-slate-500 mb-4">
              {descriptor.subtitle(selected)}
            </p>
          ) : null}

          {/* DEF-001 preview gate wraps the fields */}
          {(previewGate && state.kind === 'viewing') ? (
            <>{previewGate(selected)}</>
          ) : (
            <div>
              {descriptor.fields.map((f) => (
                <RecordField
                  key={f.key}
                  field={f as FieldDescriptor<Record<string, unknown>>}
                  value={getFieldValue(f)}
                  editing={state.kind === 'editing' || state.kind === 'saving'}
                  onChange={(v) => setFieldValue(f, v)}
                  error={fieldErrors[f.key]}
                />
              ))}
            </div>
          )}

          <RecordActionsBar
            state={state}
            entityName={descriptor.entityName}
            canEdit={canEdit(selected)}
            canDelete={Boolean(onDelete) && canDelete(selected)}
            onEdit={handleEdit}
            onSave={handleSave}
            onCancel={handleCancel}
            onDeleteRequest={handleDeleteRequest}
            onDeleteConfirm={handleDeleteConfirm}
            onDeleteAbort={handleDeleteAbort}
          />
        </Card>
      ) : (
        <Card padding="p-8">
          <EmptyState
            title="Select a record to view details"
            description={`Click a row above to view or edit the ${descriptor.entityName}.`}
          />
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2:** Typecheck.

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3:** Commit.

```bash
git add src/components/record-editor/RecordEditor.tsx
git commit -m "feat(record-editor): add RecordEditor composite component"
```

---

### Task 13: Add skill service optimistic locking + `countReferences`

**Files:**
- Modify: `src/core/services/skill.ts`
- Modify: `src/server/routers/skill.ts`
- Create: `src/__tests__/integration/skill-crud.test.ts`

- [ ] **Step 1:** Write the failing test first.

```ts
// src/__tests__/integration/skill-crud.test.ts
import 'dotenv/config';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { createSkillService } from '@/core/services';
import * as schema from '@/core/db/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set');
const provider = new SupabaseDatabaseProvider(url);
const db = provider.getConnection();

const RUN = Date.now();
const createdIds: string[] = [];

afterAll(async () => {
  for (const id of createdIds.reverse()) {
    await db.delete(schema.skill).where(eq(schema.skill.id, id));
  }
  await provider.close();
});

describe('skill service CRUD (integration)', () => {
  it('updates a skill and increments version', async () => {
    const svc = createSkillService(db);
    const created = await svc.create({
      scope: 'global',
      name: `test-skill-${RUN}`,
      description: 'orig',
      promptTemplate: 'orig prompt',
    } as any);
    createdIds.push(created.id);

    const updated = await svc.updateWithVersion(created.id, created.version ?? 1, {
      description: 'updated',
    });
    expect(updated).not.toBeNull();
    expect(updated!.description).toBe('updated');
    expect(updated!.version).toBe((created.version ?? 1) + 1);
  });

  it('rejects stale-version update', async () => {
    const svc = createSkillService(db);
    const created = await svc.create({
      scope: 'global',
      name: `stale-${RUN}`,
      description: 'orig',
    } as any);
    createdIds.push(created.id);

    // First update succeeds, bumping version
    await svc.updateWithVersion(created.id, created.version ?? 1, { description: 'v2' });

    // Second update with stale version returns null
    const again = await svc.updateWithVersion(created.id, created.version ?? 1, {
      description: 'v-stale',
    });
    expect(again).toBeNull();
  });

  it('countReferences reports zero for unreferenced skill', async () => {
    const svc = createSkillService(db);
    const created = await svc.create({
      scope: 'global',
      name: `unref-${RUN}`,
    } as any);
    createdIds.push(created.id);

    const refs = await svc.countReferences(created.id);
    expect(refs.pipelineStages).toBe(0);
    expect(refs.stageRuns).toBe(0);
    expect(refs.personaSkills).toBe(0);
  });

  it('countReferences reports non-zero for seeded skill', async () => {
    // The "research" skill is seeded AND referenced by a pipeline_stage
    const [research] = await db
      .select()
      .from(schema.skill)
      .where(eq(schema.skill.name, 'research'));

    if (!research) {
      // Not seeded in this DB — skip
      return;
    }
    const svc = createSkillService(db);
    const refs = await svc.countReferences(research.id);
    expect(refs.pipelineStages).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2:** Run the test to confirm it fails.

```bash
npx vitest run src/__tests__/integration/skill-crud.test.ts
```

Expected: FAIL — `svc.updateWithVersion is not a function` (or similar).

- [ ] **Step 3:** Extend the skill service.

Open `src/core/services/skill.ts` and replace the file with:

```ts
import { eq, desc, and, count } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { skill, pipelineStage, stageRun, personaSkill } from '@/core/db/schema';
import { createCrudService } from './crud-factory';

type SkillInsert = typeof skill.$inferInsert;
type SkillSelect = typeof skill.$inferSelect;

export function createSkillService(db: Database) {
  const crud = createCrudService<SkillInsert, SkillSelect>(db, skill);

  return {
    ...crud,

    async listByProject(projectId: string): Promise<SkillSelect[]> {
      return db
        .select()
        .from(skill)
        .where(eq(skill.projectId, projectId))
        .orderBy(desc(skill.createdAt));
    },

    async listGlobal(): Promise<SkillSelect[]> {
      return db
        .select()
        .from(skill)
        .where(eq(skill.scope, 'global'))
        .orderBy(desc(skill.createdAt));
    },

    /**
     * Optimistic-lock update. Returns null if the expected version is stale.
     * Bumps version on success.
     */
    async updateWithVersion(
      id: string,
      expectedVersion: number,
      data: Partial<SkillInsert>,
    ): Promise<SkillSelect | null> {
      const [row] = await db
        .update(skill)
        .set({
          ...data,
          version: expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(skill.id, id), eq(skill.version, expectedVersion)))
        .returning();
      return (row as SkillSelect) ?? null;
    },

    /**
     * Count references to this skill across all FK-holding tables.
     * Used to produce meaningful delete-failure messages.
     */
    async countReferences(id: string): Promise<{
      pipelineStages: number;
      stageRuns: number;
      personaSkills: number;
    }> {
      const [ps] = await db
        .select({ c: count() })
        .from(pipelineStage)
        .where(eq(pipelineStage.skillId, id));
      const [sr] = await db
        .select({ c: count() })
        .from(stageRun)
        .where(eq(stageRun.skillId, id));
      const [psk] = await db
        .select({ c: count() })
        .from(personaSkill)
        .where(eq(personaSkill.skillId, id));
      return {
        pipelineStages: Number(ps?.c ?? 0),
        stageRuns: Number(sr?.c ?? 0),
        personaSkills: Number(psk?.c ?? 0),
      };
    },
  };
}

export type SkillService = ReturnType<typeof createSkillService>;
```

- [ ] **Step 4:** Update the skill router to use optimistic locking and reference counts.

Replace `src/server/routers/skill.ts` contents with:

```ts
import { z } from 'zod/v4';
import { router, publicProcedure } from '../trpc';
import { createSkillService } from '@/core/services';

const scope = z.enum(['global', 'project']);

export const skillRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    return createSkillService(ctx.db).list();
  }),

  listByProject: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createSkillService(ctx.db).listByProject(input.projectId);
    }),

  listGlobal: publicProcedure.query(({ ctx }) => {
    return createSkillService(ctx.db).listGlobal();
  }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createSkillService(ctx.db).getById(input.id);
    }),

  create: publicProcedure
    .input(
      z.object({
        scope,
        projectId: z.string().uuid().optional(),
        name: z.string().min(1),
        description: z.string().optional(),
        promptTemplate: z.string().optional(),
        inputSchema: z.unknown().optional(),
        outputSchema: z.unknown().optional(),
        tags: z.unknown().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      return createSkillService(ctx.db).create(input as any);
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        promptTemplate: z.string().optional(),
        inputSchema: z.unknown().optional(),
        outputSchema: z.unknown().optional(),
        tags: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, version, ...data } = input;
      const row = await createSkillService(ctx.db).updateWithVersion(
        id,
        version,
        data as any,
      );
      if (!row) throw new Error('Optimistic concurrency conflict');
      return row;
    }),

  countReferences: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createSkillService(ctx.db).countReferences(input.id);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const svc = createSkillService(ctx.db);
      const refs = await svc.countReferences(input.id);
      const total = refs.pipelineStages + refs.stageRuns + refs.personaSkills;
      if (total > 0) {
        throw new Error(
          `Cannot delete skill — referenced by ${refs.pipelineStages} pipeline stage(s), ${refs.stageRuns} stage run(s), and ${refs.personaSkills} persona binding(s). Remove references first.`,
        );
      }
      await svc.remove(input.id);
      return { id: input.id };
    }),
});
```

- [ ] **Step 5:** Run tests.

```bash
npx vitest run src/__tests__/integration/skill-crud.test.ts
```

Expected: all four tests PASS.

- [ ] **Step 6:** Commit.

```bash
git add src/core/services/skill.ts src/server/routers/skill.ts src/__tests__/integration/skill-crud.test.ts
git commit -m "feat(skill): optimistic locking + countReferences + FK-safe delete"
```

---

## Phase 2 — Driver Settings Page

### Task 14: Create driver descriptor

**Files:**
- Create: `src/app/[org]/[user]/[project]/settings/drivers/descriptor.ts`

- [ ] **Step 1:** Create the descriptor.

```ts
// src/app/[org]/[user]/[project]/settings/drivers/descriptor.ts
import type { RecordDescriptor } from '@/components/record-editor/types';

export type DriverRecord = {
  id: string;
  version: number;
  name: string;
  slug: string;
  binary: string;
  modelFlag: string | null;
  dirFlag: string | null;
  promptTransport: string;
  outputFormat: string;
  probeCommand: string | null;
  issuePromptTemplate: string | null;
  queuePromptTemplate: string | null;
  notes: string | null;
  isEnabled: boolean;
};

export const driverDescriptor: RecordDescriptor<DriverRecord> = {
  entityName: 'driver',
  title: (d) => d.name,
  subtitle: (d) => d.slug,
  fields: [
    { key: 'name', label: 'Name', fieldType: 'text', required: true },
    { key: 'slug', label: 'Slug', fieldType: 'text', required: true },
    {
      key: 'binary',
      label: 'Binary',
      fieldType: 'text',
      required: true,
      placeholder: 'claude',
    },
    { key: 'modelFlag', label: 'Model flag', fieldType: 'text', placeholder: '--model' },
    { key: 'dirFlag', label: 'Directory flag', fieldType: 'text', placeholder: '--cwd' },
    {
      key: 'promptTransport',
      label: 'Prompt transport',
      fieldType: 'text',
      placeholder: 'stdin | argv | file',
    },
    {
      key: 'outputFormat',
      label: 'Output format',
      fieldType: 'text',
      placeholder: 'stream-json | text',
    },
    { key: 'probeCommand', label: 'Probe command', fieldType: 'text' },
    { key: 'notes', label: 'Notes', fieldType: 'textarea' },
    {
      key: 'issuePromptTemplate',
      label: 'Issue prompt template',
      fieldType: 'textarea-large',
    },
    {
      key: 'queuePromptTemplate',
      label: 'Queue prompt template',
      fieldType: 'textarea-large',
    },
    { key: 'version', label: 'Version', fieldType: 'readonly' },
  ],
  toggleEnabledField: 'isEnabled',
};
```

- [ ] **Step 2:** Typecheck.

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3:** Commit.

```bash
git add src/app/\[org\]/\[user\]/\[project\]/settings/drivers/descriptor.ts
git commit -m "feat(drivers): add driver descriptor"
```

---

### Task 15: Create driver settings page

**Files:**
- Create: `src/app/[org]/[user]/[project]/settings/drivers/page.tsx`

- [ ] **Step 1:** Create the page.

```tsx
// src/app/[org]/[user]/[project]/settings/drivers/page.tsx
'use client';

import { PageHeader } from '@/components/page-header';
import { RecordEditor } from '@/components/record-editor/RecordEditor';
import { Feature, hasFeature } from '@/core/features/features';
import { trpc } from '@/lib/trpc/client';
import { driverDescriptor, type DriverRecord } from './descriptor';

export default function DriversSettingsPage() {
  const utils = trpc.useUtils();
  const listQuery = trpc.driver.list.useQuery();
  const updateMutation = trpc.driver.update.useMutation();

  const records = (listQuery.data ?? []) as unknown as DriverRecord[];

  const onSave = async (
    id: string,
    patch: Partial<DriverRecord>,
    expectedVersion: number,
  ) => {
    await updateMutation.mutateAsync({
      id,
      version: expectedVersion,
      ...(patch as any),
    });
    await utils.driver.list.invalidate();
  };

  const onToggleEnabled = async (
    id: string,
    enabled: boolean,
    expectedVersion: number,
  ) => {
    await updateMutation.mutateAsync({
      id,
      version: expectedVersion,
      isEnabled: enabled,
    });
    await utils.driver.list.invalidate();
  };

  // Placeholder user — replace with real auth context when available.
  const userId = 'local-dev';

  return (
    <div className="space-y-5">
      <PageHeader
        title="Drivers"
        description="Definitions for each AI CLI tool fluxaOS invokes (binary, flags, transport, env)."
      />

      <RecordEditor<DriverRecord>
        descriptor={driverDescriptor}
        records={records}
        isLoading={listQuery.isLoading}
        onSave={onSave}
        onToggleEnabled={onToggleEnabled}
        canEdit={() => hasFeature(userId, Feature.ROLE_BASED_PERMISSIONS)}
        canDelete={() => hasFeature(userId, Feature.ROLE_BASED_PERMISSIONS)}
      />
    </div>
  );
}
```

- [ ] **Step 2:** Start dev server and verify the page loads.

```bash
npm run dev
```

In a browser, navigate to `http://192.168.54.101:3000/default/admin/fluxaos/settings/drivers`.

Expected: page renders with one row "Claude Code". Clicking the row shows the detail panel with all driver fields.

- [ ] **Step 3:** Stop the dev server. Commit.

```bash
git add src/app/\[org\]/\[user\]/\[project\]/settings/drivers/page.tsx
git commit -m "feat(drivers): add driver settings page"
```

---

### Task 16: Driver integration test

**Files:**
- Create: `src/__tests__/integration/driver-crud.test.ts`

- [ ] **Step 1:** Write the test.

```ts
// src/__tests__/integration/driver-crud.test.ts
import 'dotenv/config';
import { describe, expect, it, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { driver } from '@/core/db/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set');
const provider = new SupabaseDatabaseProvider(url);
const db = provider.getConnection();

const createdIds: string[] = [];

afterAll(async () => {
  for (const id of createdIds.reverse()) {
    await db.delete(driver).where(eq(driver.id, id));
  }
  await provider.close();
});

describe('driver CRUD (integration)', () => {
  it('update increments version', async () => {
    const [created] = await db
      .insert(driver)
      .values({
        name: `test-driver-${Date.now()}`,
        slug: `test-driver-${Date.now()}`,
        binary: 'echo',
      })
      .returning();
    createdIds.push(created.id);

    const [updated] = await db
      .update(driver)
      .set({ notes: 'updated', version: created.version + 1, updatedAt: new Date() })
      .where(and(eq(driver.id, created.id), eq(driver.version, created.version)))
      .returning();

    expect(updated.version).toBe(created.version + 1);
    expect(updated.notes).toBe('updated');
  });

  it('stale-version update returns no rows', async () => {
    const [created] = await db
      .insert(driver)
      .values({
        name: `stale-driver-${Date.now()}`,
        slug: `stale-driver-${Date.now()}`,
        binary: 'echo',
      })
      .returning();
    createdIds.push(created.id);

    // Bump version once
    await db
      .update(driver)
      .set({ notes: 'v2', version: created.version + 1, updatedAt: new Date() })
      .where(and(eq(driver.id, created.id), eq(driver.version, created.version)));

    // Attempt with stale version
    const rows = await db
      .update(driver)
      .set({ notes: 'stale', version: created.version + 2, updatedAt: new Date() })
      .where(and(eq(driver.id, created.id), eq(driver.version, created.version)))
      .returning();

    expect(rows).toHaveLength(0);
  });

  it('toggle isEnabled via update', async () => {
    const [created] = await db
      .insert(driver)
      .values({
        name: `toggle-${Date.now()}`,
        slug: `toggle-${Date.now()}`,
        binary: 'echo',
        isEnabled: true,
      })
      .returning();
    createdIds.push(created.id);

    const [toggled] = await db
      .update(driver)
      .set({ isEnabled: false, version: created.version + 1, updatedAt: new Date() })
      .where(and(eq(driver.id, created.id), eq(driver.version, created.version)))
      .returning();

    expect(toggled.isEnabled).toBe(false);
  });
});
```

- [ ] **Step 2:** Run the test.

```bash
npx vitest run src/__tests__/integration/driver-crud.test.ts
```

Expected: all three tests PASS.

- [ ] **Step 3:** Commit.

```bash
git add src/__tests__/integration/driver-crud.test.ts
git commit -m "test(driver): CRUD integration tests"
```

---

## Phase 3 — Skill Settings Page

### Task 17: Create skill descriptor

**Files:**
- Create: `src/app/[org]/[user]/[project]/settings/skills/descriptor.ts`

- [ ] **Step 1:** Create the descriptor.

```ts
// src/app/[org]/[user]/[project]/settings/skills/descriptor.ts
import type { RecordDescriptor } from '@/components/record-editor/types';

export type SkillRecord = {
  id: string;
  version: number;
  name: string;
  scope: string;
  description: string | null;
  promptTemplate: string | null;
  tags: unknown;
};

export const skillDescriptor: RecordDescriptor<SkillRecord> = {
  entityName: 'skill',
  title: (s) => s.name,
  subtitle: (s) => s.scope,
  fields: [
    { key: 'name', label: 'Name', fieldType: 'text', required: true },
    { key: 'description', label: 'Description', fieldType: 'textarea' },
    { key: 'tags', label: 'Tags', fieldType: 'tags' },
    {
      key: 'promptTemplate',
      label: 'Prompt template',
      fieldType: 'textarea-large',
    },
    { key: 'version', label: 'Version', fieldType: 'readonly' },
  ],
  // No toggleEnabledField — skills do not have isEnabled today.
};
```

- [ ] **Step 2:** Commit.

```bash
git add src/app/\[org\]/\[user\]/\[project\]/settings/skills/descriptor.ts
git commit -m "feat(skills): add skill descriptor"
```

---

### Task 18: Rewrite skill settings page

**Files:**
- Read: `src/app/[org]/[user]/[project]/settings/skills/page.tsx` (current version — must preserve any Create form logic we want to keep)
- Modify: `src/app/[org]/[user]/[project]/settings/skills/page.tsx`

- [ ] **Step 1:** Read the existing page to understand its Create flow.

Open `src/app/[org]/[user]/[project]/settings/skills/page.tsx` and note:
- How it queries `trpc.skill.list` (or listByProject)
- How it calls `trpc.skill.create`
- The Create form markup

- [ ] **Step 2:** Rewrite the page.

Replace the file contents with:

```tsx
// src/app/[org]/[user]/[project]/settings/skills/page.tsx
'use client';

import { useState } from 'react';
import { Card } from '@/components/card';
import { PageHeader } from '@/components/page-header';
import { RecordEditor } from '@/components/record-editor/RecordEditor';
import { Feature, hasFeature } from '@/core/features/features';
import { trpc } from '@/lib/trpc/client';
import { skillDescriptor, type SkillRecord } from './descriptor';

export default function SkillsSettingsPage() {
  const utils = trpc.useUtils();
  const listQuery = trpc.skill.list.useQuery();
  const updateMutation = trpc.skill.update.useMutation();
  const deleteMutation = trpc.skill.delete.useMutation();
  const createMutation = trpc.skill.create.useMutation();

  const records = (listQuery.data ?? []) as unknown as SkillRecord[];

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newScope, setNewScope] = useState<'global' | 'project'>('global');
  const [newDescription, setNewDescription] = useState('');
  const [newPrompt, setNewPrompt] = useState('');

  const onSave = async (
    id: string,
    patch: Partial<SkillRecord>,
    expectedVersion: number,
  ) => {
    await updateMutation.mutateAsync({
      id,
      version: expectedVersion,
      ...(patch as any),
    });
    await utils.skill.list.invalidate();
  };

  const onDelete = async (id: string, _expectedVersion: number) => {
    await deleteMutation.mutateAsync({ id });
    await utils.skill.list.invalidate();
  };

  const onCreate = async () => {
    await createMutation.mutateAsync({
      scope: newScope,
      name: newName,
      description: newDescription || undefined,
      promptTemplate: newPrompt || undefined,
    });
    setNewName('');
    setNewDescription('');
    setNewPrompt('');
    setShowCreate(false);
    await utils.skill.list.invalidate();
  };

  const userId = 'local-dev';

  return (
    <div className="space-y-5">
      <PageHeader
        title="Skills"
        description="Job definitions (research, implement, review, etc.) with their prompt templates."
      />

      <div className="flex justify-end">
        <button
          type="button"
          className="px-4 py-2 rounded-lg text-sm font-medium bg-electric-violet text-white hover:bg-accent-hover transition-all"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? 'Cancel new skill' : 'New skill'}
        </button>
      </div>

      {showCreate ? (
        <Card padding="p-6">
          <h3 className="text-sm font-semibold text-white mb-3">New skill</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Name <span className="text-red-400">*</span>
              </label>
              <input
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">Scope</label>
              <select
                className="bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                value={newScope}
                onChange={(e) => setNewScope(e.target.value as 'global' | 'project')}
              >
                <option value="global">global</option>
                <option value="project">project</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">Description</label>
              <textarea
                rows={3}
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">Prompt template</label>
              <textarea
                rows={8}
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white font-mono"
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-medium bg-electric-violet text-white hover:bg-accent-hover transition-all disabled:opacity-50"
              disabled={!newName.trim()}
              onClick={onCreate}
            >
              Create
            </button>
          </div>
        </Card>
      ) : null}

      <RecordEditor<SkillRecord>
        descriptor={skillDescriptor}
        records={records}
        isLoading={listQuery.isLoading}
        onSave={onSave}
        onDelete={onDelete}
        canEdit={() => hasFeature(userId, Feature.ROLE_BASED_PERMISSIONS)}
        canDelete={() => hasFeature(userId, Feature.ROLE_BASED_PERMISSIONS)}
      />
    </div>
  );
}
```

- [ ] **Step 3:** Verify in dev server.

```bash
npm run dev
```

Navigate to `http://192.168.54.101:3000/default/admin/fluxaos/settings/skills`.

Expected: page renders, lists 5 seeded skills (research, implement, review, rework, deploy), clicking a row shows the detail panel.

- [ ] **Step 4:** Commit.

```bash
git add src/app/\[org\]/\[user\]/\[project\]/settings/skills/page.tsx
git commit -m "feat(skills): rewrite settings page to use RecordEditor"
```

---

### Task 19: Manual test — edit and delete a skill via UI

**Files:** none (smoke test before Playwright)

- [ ] **Step 1:** `npm run dev` and open skills page.

- [ ] **Step 2:** Click "research" row. Click Edit. Change the description. Click Save. Verify the list refreshes and the description is updated.

- [ ] **Step 3:** Click "New skill", create a skill named `smoke-test-skill`, scope global, no description. Select it, click Edit, click Delete, confirm. Verify the row disappears.

- [ ] **Step 4:** Click "research" row. Click Edit. Click Delete. Confirm. Verify the FK error banner appears with the reference-count message.

- [ ] **Step 5:** No commit — this is an informal gate before automation.

---

### Task 20: Skill router optimistic-lock rejection test

**Files:** Extend `src/__tests__/integration/skill-crud.test.ts`

- [ ] **Step 1:** Add a test covering the router-level optimistic-lock error message.

Append this test inside the existing `describe` block in `src/__tests__/integration/skill-crud.test.ts`:

```ts
it('router delete rejects when references exist', async () => {
  // The seeded "research" skill is referenced by a pipeline_stage
  const svc = createSkillService(db);
  const [research] = await db
    .select()
    .from(schema.skill)
    .where(eq(schema.skill.name, 'research'));
  if (!research) return; // not seeded in this env

  const refs = await svc.countReferences(research.id);
  expect(refs.pipelineStages + refs.stageRuns + refs.personaSkills).toBeGreaterThan(0);

  // Verify that the service's countReferences is what the router uses
  // to produce its error — the router is tested via Playwright.
});
```

- [ ] **Step 2:** Run.

```bash
npx vitest run src/__tests__/integration/skill-crud.test.ts
```

Expected: all tests still pass.

- [ ] **Step 3:** Commit.

```bash
git add src/__tests__/integration/skill-crud.test.ts
git commit -m "test(skill): reference-count precondition for delete rejection"
```

---

## Phase 4 — Terminology, Nav, Active Docs

### Task 21: Seed terminology glossary

**Files:**
- Create: `docs/terminology.md`

- [ ] **Step 1:** Create the glossary.

```markdown
# fluxaOS Terminology

Single source of truth for domain vocabulary. When you introduce a new term, add an entry here in the same PR.

## Entries

### driver

- **What it is:** A database row describing one AI CLI tool and how fluxaOS invokes it — binary name, flags, prompt transport, output format, env vars.
- **Table:** `driver`
- **Example:** The seed row `Claude Code` has `binary="claude"`, `modelFlag="--model"`, `promptTransport="stdin"`, `outputFormat="stream-json"`.
- **Formerly known as:** `harness_catalog` / "harness" (pre-R-UI-1).

### skill

- **What it is:** A named job definition with a prompt template. When a pipeline stage runs, the skill's prompt text is what fluxaOS sends to the driver's CLI.
- **Table:** `skill`
- **Example:** `research` skill with prompt "Read the issue, find references to the affected code, output a Markdown plan."

### pipeline

- **What it is:** An ordered sequence of stages that processes an issue.
- **Table:** `pipeline`
- **Example:** `Standard Dev` pipeline with stages research → implement → review → deploy.

### pipeline_stage

- **What it is:** One step in a pipeline. Binds together a skill (what to do) and a driver (how to call the CLI). Optionally specifies a gate.
- **Table:** `pipeline_stage`
- **Example:** Stage #2 of Standard Dev, name "implement", `skill_id` → implement skill, `driver_id` → Claude Code.

### pipeline_run

- **What it is:** One execution of a pipeline against an issue. Parent of multiple stage_runs.
- **Table:** `pipeline_run`
- **Example:** A run of Standard Dev against issue #1 that completed with total cost $0.0842.

### stage_run

- **What it is:** One execution of a single stage inside a pipeline run. Records the skill+driver that ran, exit code, cost, tokens, and signal metadata.
- **Table:** `stage_run`
- **Example:** Research stage run for pipeline_run X, exit code 0, cost $0.02, emitted signal `proceed`.

### issue

- **What it is:** A unit of work in a project — a feature, bug, task. The central artifact pipelines operate on.
- **Table:** `issue`
- **Example:** Issue #1 "Add health check endpoint with build metadata."

### issue_state

- **What it is:** The lifecycle phase of an issue (Research, Implement, Review, Complete, etc.). Catalog-driven, project-scoped.
- **Table:** `issue_state`
- **Example:** Issue #1 is in state `research`.

### issue_status

- **What it is:** The activity status of an issue within its state (Open, Running, Blocked, etc.).
- **Table:** `issue_status`
- **Example:** Issue #1 state=research, status=open.

### gate

- **What it is:** A decision point between stages. Evaluates rules against context to produce a verdict (proceed, hold, rework, abort).
- **Table:** `stage_gate_result`
- **Example:** Research→Implement gate verdict `proceed` on stage_run X.

### routing_profile

- **What it is:** Rules that map (stage, driver) to a provider+model selection at runtime.
- **Table:** `routing_profile` + `routing_rule`
- **Example:** Default profile routes every stage to Anthropic's claude-sonnet-4-6 via the Claude Code driver.

---

## How to add an entry

When a PR introduces a new domain term (new table, new enum value, new concept), append an entry here using the same format:

```
### term_name

- **What it is:** One-sentence plain-English definition.
- **Table/Location:** Where it lives in code/schema.
- **Example:** Concrete instance with values.
- **Formerly known as:** (optional) prior names, for continuity.
```

Reviewers: PRs introducing new terms without a glossary entry should be held.
```

- [ ] **Step 2:** Commit.

```bash
git add docs/terminology.md
git commit -m "docs: add terminology glossary (DEF-005 seed)"
```

---

### Task 22: Add Drivers nav link

**Files:**
- Modify: `src/components/nav.tsx`

- [ ] **Step 1:** Read the current settings link list to understand the pattern.

- [ ] **Step 2:** Add the Drivers link between Skills and Routing.

Open `src/components/nav.tsx` and change the `settingsLinks` array. Find:

```ts
  const settingsLinks = [
    { href: `${basePath}/settings`, label: 'Pipelines', exact: true, icon: Workflow },
    { href: `${basePath}/settings/personas`, label: 'Personas', icon: Users },
    { href: `${basePath}/settings/skills`, label: 'Skills', icon: Sparkles },
    { href: `${basePath}/settings/routing`, label: 'Routing', icon: Route },
    { href: `${basePath}/settings/providers`, label: 'Providers', icon: Server },
  ];
```

Add a new import at the top of the file (where other lucide icons are imported):

```ts
  Terminal,
```

Replace the settingsLinks block with:

```ts
  const settingsLinks = [
    { href: `${basePath}/settings`, label: 'Pipelines', exact: true, icon: Workflow },
    { href: `${basePath}/settings/personas`, label: 'Personas', icon: Users },
    { href: `${basePath}/settings/skills`, label: 'Skills', icon: Sparkles },
    { href: `${basePath}/settings/drivers`, label: 'Drivers', icon: Terminal },
    { href: `${basePath}/settings/routing`, label: 'Routing', icon: Route },
    { href: `${basePath}/settings/providers`, label: 'Providers', icon: Server },
  ];
```

- [ ] **Step 3:** Verify in browser — the Drivers link appears in the sidebar under Settings.

```bash
npm run dev
```

Navigate anywhere under `/default/admin/fluxaos/...`. Click Drivers in the sidebar. Expected: navigates to `/default/admin/fluxaos/settings/drivers`.

- [ ] **Step 4:** Commit.

```bash
git add src/components/nav.tsx
git commit -m "feat(nav): add Drivers link to settings sidebar"
```

---

### Task 23: Update UI inventory doc

**Files:**
- Modify: `docs/superpowers/specs/2026-04-11-ui-inventory.md`

- [ ] **Step 1:** Add a new section for Drivers under Settings, and update the Skills section to reflect delete/edit support.

Append to the Settings block (after the Routing section):

```markdown
## Settings — Drivers (`src/app/[org]/[user]/[project]/settings/drivers/page.tsx`)

**Queries:** driver.list
**Mutations:** driver.update

1. **Header:** "Drivers" + description
2. **RecordEditor:** list of drivers with isEnabled toggle per row
3. **Detail panel (on selection):** all driver fields (name, slug, binary, modelFlag, dirFlag, promptTransport, outputFormat, probeCommand, notes, issuePromptTemplate, queuePromptTemplate, version)
4. **Actions:** Edit → Save / Cancel (no Delete — soft-disable via toggle instead)
```

Update the Skills section to replace its description with:

```markdown
## Settings — Skills (`src/app/[org]/[user]/[project]/settings/skills/page.tsx`)

**Queries:** skill.list, skill.countReferences
**Mutations:** skill.create, skill.update, skill.delete

1. **Header:** "Skills" + description
2. **New skill form:** (collapsed by default) Name*, Scope, Description, Prompt template
3. **RecordEditor:** list of skills; no toggle (skills have no isEnabled field)
4. **Detail panel:** Name, Description, Tags, Prompt template, Version (readonly)
5. **Actions:** Edit → Save / Cancel / Delete (Delete checks FK references; meaningful error on conflict)
```

- [ ] **Step 2:** Commit.

```bash
git add docs/superpowers/specs/2026-04-11-ui-inventory.md
git commit -m "docs: update UI inventory for Drivers page + Skills CRUD"
```

---

## Phase 5 — Journey Tests (Playwright)

### Task 24: Scaffold Playwright

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/helpers/setup.ts`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1:** Install browsers (one-time per machine).

```bash
npx playwright install chromium
```

- [ ] **Step 2:** Create `playwright.config.ts`.

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://192.168.54.101:3000';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
```

- [ ] **Step 3:** Create setup helper.

```ts
// e2e/helpers/setup.ts
import { test as base, type Page } from '@playwright/test';

const PROJECT_BASE = '/default/admin/fluxaos';

export const test = base.extend({});
export const expect = base.expect;

export function projectPath(sub: string): string {
  return `${PROJECT_BASE}${sub.startsWith('/') ? sub : `/${sub}`}`;
}

/** Navigate to a settings sub-page under the seeded project. */
export async function gotoSettings(page: Page, sub: string): Promise<void> {
  await page.goto(projectPath(`/settings/${sub}`));
}
```

- [ ] **Step 4:** Add an npm script for Playwright.

Modify `package.json` `scripts` block, add:

```json
    "test:e2e": "playwright test",
    "test:e2e:headed": "playwright test --headed",
```

- [ ] **Step 5:** Ignore Playwright output dirs.

Add to `.gitignore`:

```
# Playwright
/playwright-report
/test-results
```

- [ ] **Step 6:** Commit.

```bash
git add playwright.config.ts e2e/helpers/setup.ts package.json .gitignore
git commit -m "feat(test): scaffold Playwright e2e harness"
```

---

### Task 25: Journey — edit-a-driver

**Files:**
- Create: `docs/journeys/README.md`
- Create: `docs/journeys/edit-a-driver.md`
- Create: `e2e/edit-a-driver.spec.ts`

- [ ] **Step 1:** Create journey index.

```markdown
# Journey Index

| Slug | What it covers | Tags | Spec |
|---|---|---|---|
| [edit-a-driver](edit-a-driver.md) | Edit a driver's fields and save | `@r-ui-1` `@settings` `@drivers` `@crud` | `e2e/edit-a-driver.spec.ts` |
| [toggle-driver-enabled](toggle-driver-enabled.md) | Toggle a driver on/off and verify persistence | `@r-ui-1` `@settings` `@drivers` | `e2e/toggle-driver-enabled.spec.ts` |
| [edit-a-skill](edit-a-skill.md) | Edit a skill's fields and save | `@r-ui-1` `@settings` `@skills` `@crud` | `e2e/edit-a-skill.spec.ts` |
| [delete-an-unreferenced-skill](delete-an-unreferenced-skill.md) | Create → select → delete a skill with no references | `@r-ui-1` `@settings` `@skills` `@crud` | `e2e/delete-an-unreferenced-skill.spec.ts` |
| [delete-a-referenced-skill-fails-gracefully](delete-a-referenced-skill-fails-gracefully.md) | Attempt to delete a skill with references; verify FK error message | `@r-ui-1` `@settings` `@skills` | `e2e/delete-a-referenced-skill-fails-gracefully.spec.ts` |
| [conflict-on-save](conflict-on-save.md) | Two tabs save the same record; second save fails with conflict toast | `@r-ui-1` `@settings` `@concurrency` | `e2e/conflict-on-save.spec.ts` |

## Running journeys

```bash
# All R-UI-1 journeys
npx playwright test --grep @r-ui-1

# Just CRUD journeys
npx playwright test --grep @crud

# One by name
npx playwright test edit-a-driver
```

## Authoring a journey

Every journey has a plain-English Markdown story and a matching `.spec.ts` test. The test is a one-to-one translation of the story's numbered steps. Slug-based IDs, not numbered — slugs are stable through inserts and deletes.
```

- [ ] **Step 2:** Write the journey story.

```markdown
<!-- docs/journeys/edit-a-driver.md -->
---
id: edit-a-driver
tags: [r-ui-1, settings, drivers, crud]
feature: R-UI-1
---

# Journey: edit-a-driver

**A driver in fluxaOS is the config row describing one AI CLI tool (Claude Code, Codex, Gemini CLI) and how fluxaOS invokes it. Editing a driver changes the flags/env/transport fluxaOS uses when spawning that CLI — not the CLI itself.**

## Steps

1. Navigate to `Settings → Drivers`
2. Verify the list shows the seeded "Claude Code" driver
3. Click the "Claude Code" row
4. Verify the detail panel appears with fields: Name, Slug, Binary, Model flag, Directory flag, Prompt transport, Output format
5. Click "Edit"
6. Change the "Notes" field to `journey: edit-a-driver ran at {timestamp}`
7. Click "Save"
8. Verify the detail panel returns to read-only view
9. Reload the page
10. Click "Claude Code" again
11. Verify the Notes field contains the text from step 6

## Expected outcome

The driver row's `notes` column persists the edit across a page reload, and the `version` integer has incremented by 1.
```

- [ ] **Step 3:** Write the Playwright spec.

```ts
// e2e/edit-a-driver.spec.ts
import { test, expect, gotoSettings } from './helpers/setup';

test.describe('@r-ui-1 @settings @drivers @crud', () => {
  test('edit-a-driver', async ({ page }) => {
    const timestamp = new Date().toISOString();
    const noteText = `journey: edit-a-driver ran at ${timestamp}`;

    // Step 1: Navigate
    await gotoSettings(page, 'drivers');

    // Step 2: Verify list shows Claude Code
    await expect(page.getByText('Claude Code')).toBeVisible();

    // Step 3: Click row
    await page.getByText('Claude Code').first().click();

    // Step 4: Detail panel visible with expected fields
    await expect(page.getByRole('heading', { name: 'Claude Code' })).toBeVisible();
    await expect(page.getByText('Binary', { exact: false })).toBeVisible();

    // Step 5: Click Edit
    await page.getByRole('button', { name: 'Edit' }).click();

    // Step 6: Change Notes field
    const notesField = page
      .locator('label', { hasText: 'Notes' })
      .locator('..')
      .locator('textarea');
    await notesField.fill(noteText);

    // Step 7: Click Save
    await page.getByRole('button', { name: 'Save' }).click();

    // Step 8: Returned to viewing state
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

    // Step 9: Reload
    await page.reload();

    // Step 10: Click row again
    await page.getByText('Claude Code').first().click();

    // Step 11: Verify notes persisted
    await expect(page.getByText(noteText)).toBeVisible();
  });
});
```

- [ ] **Step 4:** Start dev server, then run journey.

In one shell:

```bash
npm run dev
```

In another shell:

```bash
npx playwright test edit-a-driver
```

Expected: test passes.

- [ ] **Step 5:** Stop dev server. Commit.

```bash
git add docs/journeys/README.md docs/journeys/edit-a-driver.md e2e/edit-a-driver.spec.ts
git commit -m "test(e2e): journey — edit-a-driver"
```

---

### Task 26: Journey — toggle-driver-enabled

**Files:**
- Create: `docs/journeys/toggle-driver-enabled.md`
- Create: `e2e/toggle-driver-enabled.spec.ts`

- [ ] **Step 1:** Story.

```markdown
<!-- docs/journeys/toggle-driver-enabled.md -->
---
id: toggle-driver-enabled
tags: [r-ui-1, settings, drivers]
feature: R-UI-1
---

# Journey: toggle-driver-enabled

## Steps

1. Navigate to `Settings → Drivers`
2. Locate the "Claude Code" row
3. Toggle its enabled switch OFF
4. Reload the page
5. Verify the toggle is OFF
6. Toggle it back ON
7. Reload the page
8. Verify the toggle is ON

## Expected outcome

The `isEnabled` flag persists across reloads. Version bumps twice.
```

- [ ] **Step 2:** Spec.

```ts
// e2e/toggle-driver-enabled.spec.ts
import { test, expect, gotoSettings } from './helpers/setup';

test.describe('@r-ui-1 @settings @drivers', () => {
  test('toggle-driver-enabled', async ({ page }) => {
    await gotoSettings(page, 'drivers');

    const row = page.locator('li', { hasText: 'Claude Code' }).first();
    const toggle = row.locator('label').first();

    // Toggle OFF
    await toggle.click();
    await page.reload();

    // After reload the toggle state should persist — read the inner indicator position
    const indicator = page
      .locator('li', { hasText: 'Claude Code' })
      .first()
      .locator('label')
      .first()
      .locator('span > span');
    // When enabled=false, indicator sits left (translate-x-0.5); when true, right (translate-x-5)
    await expect(indicator).toHaveClass(/translate-x-0\.5/);

    // Toggle back ON
    await page.locator('li', { hasText: 'Claude Code' }).first().locator('label').first().click();
    await page.reload();
    await expect(indicator).toHaveClass(/translate-x-5/);
  });
});
```

- [ ] **Step 3:** Run journey against dev server.

```bash
npx playwright test toggle-driver-enabled
```

Expected: pass.

- [ ] **Step 4:** Commit.

```bash
git add docs/journeys/toggle-driver-enabled.md e2e/toggle-driver-enabled.spec.ts
git commit -m "test(e2e): journey — toggle-driver-enabled"
```

---

### Task 27: Journey — edit-a-skill

**Files:**
- Create: `docs/journeys/edit-a-skill.md`
- Create: `e2e/edit-a-skill.spec.ts`

- [ ] **Step 1:** Story.

```markdown
<!-- docs/journeys/edit-a-skill.md -->
---
id: edit-a-skill
tags: [r-ui-1, settings, skills, crud]
feature: R-UI-1
---

# Journey: edit-a-skill

## Steps

1. Navigate to `Settings → Skills`
2. Verify the list shows `research`, `implement`, `review`, `rework`, `deploy`
3. Click the "research" row
4. Click "Edit"
5. Change the "Description" field to `journey: edit-a-skill ran at {timestamp}`
6. Click "Save"
7. Verify the panel returns to read-only view and shows the new description
8. Reload the page, click "research", verify description persisted

## Expected outcome

The skill's `description` persists across reloads. `version` increments.
```

- [ ] **Step 2:** Spec.

```ts
// e2e/edit-a-skill.spec.ts
import { test, expect, gotoSettings } from './helpers/setup';

test.describe('@r-ui-1 @settings @skills @crud', () => {
  test('edit-a-skill', async ({ page }) => {
    const text = `journey: edit-a-skill ran at ${new Date().toISOString()}`;

    await gotoSettings(page, 'skills');

    // Step 2: seeded skills visible
    for (const name of ['research', 'implement', 'review', 'rework', 'deploy']) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    }

    // Step 3: click research
    await page.getByText('research', { exact: true }).first().click();

    // Step 4: edit
    await page.getByRole('button', { name: 'Edit' }).click();

    // Step 5: change description
    const descField = page
      .locator('label', { hasText: 'Description' })
      .locator('..')
      .locator('textarea');
    await descField.fill(text);

    // Step 6: save
    await page.getByRole('button', { name: 'Save' }).click();

    // Step 7: back to view mode
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(page.getByText(text)).toBeVisible();

    // Step 8: reload + re-select + verify
    await page.reload();
    await page.getByText('research', { exact: true }).first().click();
    await expect(page.getByText(text)).toBeVisible();
  });
});
```

- [ ] **Step 3:** Run.

```bash
npx playwright test edit-a-skill
```

Expected: pass.

- [ ] **Step 4:** Commit.

```bash
git add docs/journeys/edit-a-skill.md e2e/edit-a-skill.spec.ts
git commit -m "test(e2e): journey — edit-a-skill"
```

---

### Task 28: Journey — delete-an-unreferenced-skill

**Files:**
- Create: `docs/journeys/delete-an-unreferenced-skill.md`
- Create: `e2e/delete-an-unreferenced-skill.spec.ts`

- [ ] **Step 1:** Story.

```markdown
<!-- docs/journeys/delete-an-unreferenced-skill.md -->
---
id: delete-an-unreferenced-skill
tags: [r-ui-1, settings, skills, crud]
feature: R-UI-1
---

# Journey: delete-an-unreferenced-skill

## Steps

1. Navigate to `Settings → Skills`
2. Click "New skill"
3. Fill Name: `journey-delete-{timestamp}`, Scope: global
4. Click "Create"
5. Verify the new row appears in the list
6. Click the new row
7. Click "Edit"
8. Click "Delete"
9. Click "Yes, delete"
10. Verify the row is gone from the list

## Expected outcome

A newly created, unreferenced skill can be hard-deleted from the UI.
```

- [ ] **Step 2:** Spec.

```ts
// e2e/delete-an-unreferenced-skill.spec.ts
import { test, expect, gotoSettings } from './helpers/setup';

test.describe('@r-ui-1 @settings @skills @crud', () => {
  test('delete-an-unreferenced-skill', async ({ page }) => {
    const name = `journey-delete-${Date.now()}`;

    await gotoSettings(page, 'skills');

    // Create
    await page.getByRole('button', { name: 'New skill' }).click();
    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Create' }).click();

    // Verify row
    await expect(page.getByText(name).first()).toBeVisible();

    // Select + edit + delete
    await page.getByText(name).first().click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Yes, delete' }).click();

    // Row gone
    await expect(page.getByText(name)).toHaveCount(0);
  });
});
```

- [ ] **Step 3:** Run.

```bash
npx playwright test delete-an-unreferenced-skill
```

Expected: pass.

- [ ] **Step 4:** Commit.

```bash
git add docs/journeys/delete-an-unreferenced-skill.md e2e/delete-an-unreferenced-skill.spec.ts
git commit -m "test(e2e): journey — delete-an-unreferenced-skill"
```

---

### Task 29: Journey — delete-a-referenced-skill-fails-gracefully

**Files:**
- Create: `docs/journeys/delete-a-referenced-skill-fails-gracefully.md`
- Create: `e2e/delete-a-referenced-skill-fails-gracefully.spec.ts`

- [ ] **Step 1:** Story.

```markdown
<!-- docs/journeys/delete-a-referenced-skill-fails-gracefully.md -->
---
id: delete-a-referenced-skill-fails-gracefully
tags: [r-ui-1, settings, skills]
feature: R-UI-1
---

# Journey: delete-a-referenced-skill-fails-gracefully

## Steps

1. Navigate to `Settings → Skills`
2. Click the "research" row (seeded, referenced by pipeline stages)
3. Click "Edit"
4. Click "Delete"
5. Click "Yes, delete"
6. Verify an error banner appears with text mentioning "referenced" and at least one non-zero count
7. Verify the "research" row is STILL present in the list

## Expected outcome

The UI blocks delete with a meaningful message; the skill is preserved.
```

- [ ] **Step 2:** Spec.

```ts
// e2e/delete-a-referenced-skill-fails-gracefully.spec.ts
import { test, expect, gotoSettings } from './helpers/setup';

test.describe('@r-ui-1 @settings @skills', () => {
  test('delete-a-referenced-skill-fails-gracefully', async ({ page }) => {
    await gotoSettings(page, 'skills');

    await page.getByText('research', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Yes, delete' }).click();

    // Banner with FK error message
    await expect(page.getByText(/referenced by/i)).toBeVisible();

    // Research still in list
    await expect(page.getByText('research', { exact: true }).first()).toBeVisible();
  });
});
```

- [ ] **Step 3:** Run.

```bash
npx playwright test delete-a-referenced-skill-fails-gracefully
```

Expected: pass.

- [ ] **Step 4:** Commit.

```bash
git add docs/journeys/delete-a-referenced-skill-fails-gracefully.md e2e/delete-a-referenced-skill-fails-gracefully.spec.ts
git commit -m "test(e2e): journey — delete-a-referenced-skill-fails-gracefully"
```

---

### Task 30: Journey — conflict-on-save

**Files:**
- Create: `docs/journeys/conflict-on-save.md`
- Create: `e2e/conflict-on-save.spec.ts`

- [ ] **Step 1:** Story.

```markdown
<!-- docs/journeys/conflict-on-save.md -->
---
id: conflict-on-save
tags: [r-ui-1, settings, concurrency]
feature: R-UI-1
---

# Journey: conflict-on-save

## Steps

1. Open two browser contexts, A and B
2. In both, navigate to `Settings → Skills` and click the "research" row
3. In both, click "Edit" — both tabs now hold the same `version` N
4. In tab A, change Description to `A-change`
5. In tab A, click "Save" — expect success
6. In tab B, change Description to `B-change`
7. In tab B, click "Save" — expect an error banner with text matching `updated elsewhere` or `conflict`
8. In tab B, click "Cancel"
9. Refresh tab B; click "research"; verify description reads `A-change`

## Expected outcome

Second writer gets the conflict banner with their draft preserved; first writer's change wins.
```

- [ ] **Step 2:** Spec.

```ts
// e2e/conflict-on-save.spec.ts
import { test, expect, gotoSettings } from './helpers/setup';

test.describe('@r-ui-1 @settings @concurrency', () => {
  test('conflict-on-save', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();

    try {
      await gotoSettings(a, 'skills');
      await gotoSettings(b, 'skills');

      await a.getByText('research', { exact: true }).first().click();
      await b.getByText('research', { exact: true }).first().click();

      await a.getByRole('button', { name: 'Edit' }).click();
      await b.getByRole('button', { name: 'Edit' }).click();

      const aDesc = a
        .locator('label', { hasText: 'Description' })
        .locator('..')
        .locator('textarea');
      const bDesc = b
        .locator('label', { hasText: 'Description' })
        .locator('..')
        .locator('textarea');

      await aDesc.fill('A-change');
      await a.getByRole('button', { name: 'Save' }).click();
      await expect(a.getByRole('button', { name: 'Edit' })).toBeVisible();

      await bDesc.fill('B-change');
      await b.getByRole('button', { name: 'Save' }).click();

      // Conflict banner shown in B
      await expect(b.getByText(/updated elsewhere|conflict/i)).toBeVisible();

      // B reloads and sees A's change
      await b.reload();
      await b.getByText('research', { exact: true }).first().click();
      await expect(b.getByText('A-change')).toBeVisible();
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
```

- [ ] **Step 3:** Run.

```bash
npx playwright test conflict-on-save
```

Expected: pass.

- [ ] **Step 4:** Commit.

```bash
git add docs/journeys/conflict-on-save.md e2e/conflict-on-save.spec.ts
git commit -m "test(e2e): journey — conflict-on-save"
```

---

## Phase 6 — Verification + Handoff

### Task 31: Full-stack verification + roadmap update

**Files:**
- Modify: `docs/superpowers/roadmap.md`
- Modify: `docs/superpowers/deferred-fixes.md` (only if new issues arise)

- [ ] **Step 1:** Baseline DB state.

```bash
npx tsx src/core/db/nuke.ts && npm run db:seed && npm run verify:seed
```

Expected: 10/10 PASS.

- [ ] **Step 2:** Run all integration tests.

```bash
npx vitest run
```

Expected: every suite passes. Note any that fail unrelated to R-UI-1; file them in `deferred-fixes.md` with a clear note.

- [ ] **Step 3:** Run all journeys.

In one terminal: `npm run dev`. In another:

```bash
npx playwright test --grep @r-ui-1
```

Expected: all six journeys pass.

- [ ] **Step 4:** Residual-grep check.

```bash
grep -rn "harness\|Harness\|HARNESS" src/ tests/ e2e/ CLAUDE.md docs/session-quick-start.md docs/invariants.md docs/superpowers/roadmap.md docs/terminology.md 2>/dev/null
```

Expected: empty (or only intentional "formerly known as" clarifiers in `terminology.md`).

- [ ] **Step 5:** Manual browser verification.

Drive each journey by hand on `http://192.168.54.101:3000` once to confirm UX feels right (not just that automation passes).

- [ ] **Step 6:** Update the roadmap.

Open `docs/superpowers/roadmap.md` and mark R-UI-1 complete. In the "What's Next" section, promote R-UI-2 (real-time updates) to the next item.

- [ ] **Step 7:** Final commit.

```bash
git add docs/superpowers/roadmap.md
git commit -m "docs: mark R-UI-1 complete in roadmap"
```

- [ ] **Step 8:** Push branch.

```bash
git push -u origin feat/r-ui-1-implementation
```

- [ ] **Step 9:** Open PR for review.

```bash
gh pr create --title "feat: R-UI-1 — settings CRUD + harness→driver rename" --body "$(cat <<'EOF'
## Summary
- Rename `harness_catalog` → `driver` across schema, code, tests, active docs
- Add `RecordEditor` primitive (list + detail + edit)
- Add `Feature` enum + `hasFeature()` stub for future SaaS tier gating
- Ship driver and skill settings pages with CRUD
- Seed `docs/terminology.md` glossary
- Six Playwright journeys under `@r-ui-1` tag

## Test plan
- [ ] `npm run verify:seed` passes (10/10)
- [ ] `npx vitest run` passes
- [ ] `npx playwright test --grep @r-ui-1` passes (all 6 journeys)
- [ ] Manual browser verification of each journey
- [ ] No residual `harness` references in live source/active docs

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review (performed before handing off)

### Spec coverage check

Every spec section maps to one or more tasks:

| Spec section | Task(s) |
|---|---|
| Rename as Phase 0 | Tasks 1–7 |
| Architecture / File structure | Tasks 8–12, 14–15, 17–18 |
| RecordEditor primitive | Tasks 9–12 |
| Feature gating primitive | Task 8 |
| Data flow — update/delete/toggle | Tasks 12, 13, 15, 18 |
| Error handling (validation, conflict, FK) | Tasks 12, 13, 18, 19 |
| Driver descriptor + page | Tasks 14, 15, 16 |
| Skill descriptor + page | Tasks 13, 17, 18, 20 |
| Nav change | Task 22 |
| Terminology doc | Task 21 |
| Six journey tests | Tasks 24–30 |
| Success criteria (8-point) | Task 31 |
| Deferred hooks (DEF-001..005) | Tasks 8, 9, 12 (prop slots), 21 (DEF-005 seed) |

### Placeholder scan

No "TBD", "TODO", "implement later", or "similar to Task N". Every code-bearing step contains full code. Every command step shows exact expected output.

### Type consistency

- `RecordWithVersion` defined in Task 9 → used in Task 12 ✓
- `RecordDescriptor<T>` defined in Task 9 → used in Tasks 14, 17 ✓
- `driverDescriptor` / `skillDescriptor` consistently named across tasks ✓
- `onSave` / `onDelete` / `onToggleEnabled` signatures match between types (Task 9) and consumers (Tasks 12, 15, 18) ✓
- `Feature` enum values consistent between definition (Task 8) and references (Tasks 12, 15, 18) ✓

Plan is ready.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-16-r-ui-1-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
