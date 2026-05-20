# FLX-239 Stage 3 Resolve Scoped Implementation Plan

> **For Hermes:** Use test-driven-development for the helper and keep this PR scoped to Stage 3 only.

**Goal:** Add the shared waterfall resolution helpers for FLX-239 scoped feature rows.

**Architecture:** `resolveScoped` and `resolveScopedAll` live in `src/core/services/resolve-scoped.ts` and accept a Drizzle DB, a scoped feature table, a scope context, and an optional Drizzle `SQL` filter. Both helpers issue one query ordered by project → user → team → org → catalog priority; the `All` variant deduplicates with Postgres `DISTINCT ON` through Drizzle's `selectDistinctOn`.

**Tech Stack:** TypeScript, Drizzle ORM, Vitest integration tests against Supabase.

---

### Task 1: Capture scoped-resolution behavior in integration tests

**Objective:** Prove the locked Stage 3 behavior before implementation.

**Files:**
- Create: `src/__tests__/integration/resolve-scoped.test.ts`

**Steps:**
1. Create a real tenancy fixture: org → team → user → project.
2. Insert `driver` rows for catalog/org/team/user/project scopes.
3. Assert `resolveScoped` returns the only matching layer in isolation.
4. Assert `resolveScoped` returns the higher-priority layer for every pair.
5. Assert `resolveScopedAll` returns one row per name using the highest-priority matching layer.
6. Run `npx vitest src/__tests__/integration/resolve-scoped.test.ts` and verify RED because `src/core/services/resolve-scoped.ts` does not exist.

### Task 2: Implement the helper

**Objective:** Add the minimal shared helper needed to satisfy the tests and Stage 3 contract.

**Files:**
- Create: `src/core/services/resolve-scoped.ts`

**Steps:**
1. Define `ScopeContext` and `WaterfallKind` types.
2. Validate the table exposes `orgId`, `teamId`, `userId`, `projectId`, and `kind` columns.
3. Build one `WHERE` clause across project/user/team/org/catalog plus optional `extraWhere`.
4. Order by a SQL `CASE` priority expression.
5. Implement `resolveScoped` with `.limit(1)`.
6. Implement `resolveScopedAll` with `db.selectDistinctOn([dedupeColumn]).from(table).orderBy(dedupeColumn, priority)`.
7. Validate returned rows: exactly one scope column matches `kind`, or all scope columns null with `kind='catalog'`; throw on CHECK-violating rows.

### Task 3: Verify and classify remaining debt

**Objective:** Produce Stage 3 proof without drifting into Stages 4-7.

**Steps:**
1. Run `npx vitest src/__tests__/integration/resolve-scoped.test.ts` and verify GREEN.
2. Run `npx tsc --noEmit --pretty false`; classify remaining failures as post-tenancy consumer debt unless Stage 3 introduced them.
3. Commit with `Refs FLX-260` and block for review with structured handoff.
