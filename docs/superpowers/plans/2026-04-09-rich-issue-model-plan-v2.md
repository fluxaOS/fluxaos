# Rich Issue Model — Implementation Plan (v2, DA-reviewed)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **CRITICAL:** Read CLAUDE.md first. Every invariant applies. No unit tests. No hardcoded enums. No vendor imports in core. Human verification at every checkpoint.
>
> **DA REVIEW:** 35 findings incorporated. See `docs/superpowers/specs/2026-04-09-da-review.md` for the full review.

**Goal:** Replace the hardcoded issue model with database-driven catalogs, per-project numbering, markdown support, comments, attachments, dependencies, saved views, and a full tRPC API — all against real Supabase.

**Architecture:** Nuke existing data → schema changes → seed → services with DI → tRPC routers → UI. Each layer builds on the previous. The issue service enforces DB-driven transitions (no hardcoded state machine).

**Tech Stack:** Drizzle ORM, tRPC v11, Zod, Next.js 16 App Router, React 19, Tailwind CSS 4, Supabase Cloud Postgres

**Specs:**
- Base: `docs/superpowers/specs/2026-04-09-rich-issue-model-design.md`
- Addendum: `docs/superpowers/specs/2026-04-09-issue-model-brainstorm-design.md`

**Explicit decisions (closing open items from spec):**
- `issue.queue` (kanban endpoint) — DEFERRED. Not in this plan.
- `issue.bulk` — DEFERRED. Too complex for this pass. Will be added after core CRUD is verified working.
- `close()` and `reopen()` — Use `stateOverride()` semantics (bypass transition graph). These are convenience wrappers, not transition-graph-constrained.
- Initial state at creation — Service resolves the state with lowest `sortOrder` where `isTerminal = false` for the project.
- `assignee` field — Free text (not FK to user table). `issue.users` returns `SELECT DISTINCT` from issue table.
- Comment soft-delete — Service captures body into `comment_deleted` event payload BEFORE clearing body fields.

**Known tech debt (not addressed in this plan):**
- `pipelineRun.status`, `stageRun.status`, `pipelineStage.gateMode` have hardcoded string defaults in schema. These are pipeline-layer concerns, not issue-layer. Will be addressed in R4/R5.

---

## File Map

### Schema Approach: Single File

**DA Finding #7:** Split schema files create circular import chains. All schema tables remain in `src/core/db/schema.ts` (the existing pattern). The file will be large (~800 lines) but this is the ONE file allowed to exceed 500 lines — it's a schema definition, not logic.

### New Files

| File | Responsibility |
|------|---------------|
| `src/core/db/nuke.ts` | Nuke script: drops all user data in FK-safe order |
| `src/core/services/issue-catalog.ts` | Catalog CRUD: types, states, statuses, priorities, labels, transitions |
| `src/core/services/issue-comment.ts` | Comment: create, update (version check), soft-delete, list |
| `src/core/services/issue-attachment.ts` | Attachment: create, delete, list |
| `src/core/services/issue-dependency.ts` | Dependency: create, delete, list (both directions) |
| `src/core/services/issue-saved-view.ts` | Saved view: CRUD + setDefault |
| `src/core/services/issue-event.ts` | Event: append-only create, list with tab filtering |
| `src/core/services/user.ts` | User: CRUD + getBySlug |

### Modified Files

| File | Changes |
|------|---------|
| `src/core/db/schema.ts` | Add 15 new tables (user, 6 catalogs, comment, attachment, dependency, saved view, 3 git placeholders), overhaul issue table, update issueEvent, update all relations. All in one file. |
| `src/core/db/seed.ts` | Seed default user, issue catalogs, transitions, status automation config. Retain pipeline stage seeds. |
| `src/core/services/issue.ts` | Complete rewrite: DB-driven transitions, optimistic concurrency, per-project numbering, is_closed management |
| `src/core/services/index.ts` | Export new services |
| `src/server/routers/issue.ts` | Complete rewrite with nested sub-routers for comment/attachment/dependency/event/savedView |
| `src/server/routers/issue-catalog.ts` | New: catalog CRUD + config health check |
| `src/server/root.ts` | Register issueCatalog router alongside updated issue router |
| `src/lib/resolve-context.ts` | Add user resolution, use direct DB import (not createTRPCContext) |
| `src/app/` pages | Reconcile routing to `/[org]/[user]/[project]/`, replace hardcoded enums |
| `src/__tests__/integration/services.test.ts` | Rewrite: catalog tests first, then issue tests |

### Deleted Files

| File | Reason |
|------|--------|
| `src/core/issues/types.ts` | Hardcoded enums replaced by DB catalogs |

---

## Phase 0: Nuke Existing Data

**Why first:** DA Findings #3, #4. Adding NOT NULL columns and changing unique constraints on tables with existing data will cause `drizzle-kit push` to fail. The database must be empty before schema changes.

### Task 0.1: Create nuke script and clear database

**Files:**
- Create: `src/core/db/nuke.ts`

- [ ] **Step 1: Write nuke script**

Deletion order must respect FK RESTRICT constraints. Order (tested against the current 19-table schema):

```typescript
// src/core/db/nuke.ts
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('ERROR: DIRECT_URL or DATABASE_URL must be set.'); process.exit(1); }

const provider = new SupabaseDatabaseProvider(url);
const db = provider.getConnection();

async function nuke() {
  console.log('Nuking all data...');
  // Order: leaf tables first, then parents. Respects RESTRICT FKs.
  const tables = [
    'issue_event', 'issue_comment', 'issue_attachment', 'issue_dependency',
    'issue_saved_view', 'issue_branch', 'issue_pull_request', 'issue_commit',
    'event',
    'stage_run', 'pipeline_run',
    'issue',
    'issue_transition',
    'issue_type', 'issue_state', 'issue_status', 'issue_priority', 'issue_label',
    'pipeline_stage', 'pipeline',
    'config_entry',
    'persona_skill', 'team_member',
    'memory', 'skill', 'persona', 'team', 'brand',
    'routing_rule', 'routing_profile',
    'model', 'provider',
    'project', 'user', 'organization',
  ];
  for (const table of tables) {
    await db.execute(sql.raw(`DELETE FROM "${table}"`)).catch(() => {
      console.log(`  Table "${table}" does not exist yet, skipping.`);
    });
  }
  console.log('Nuke complete.');
  process.exit(0);
}

nuke().catch((err) => { console.error('Nuke failed:', err); process.exit(1); });
```

- [ ] **Step 2: Run nuke against current database**

```bash
npx tsx src/core/db/nuke.ts
```

Verify: Supabase dashboard shows all tables empty.

- [ ] **Step 3: Commit**

```bash
git add src/core/db/nuke.ts
git commit -m "feat: nuke script — clears all data in FK-safe order"
```

---

## Phase 1: Schema — All New Tables in schema.ts

**Checkpoint:** `drizzle-kit push` succeeds. All new tables visible in Supabase dashboard with correct columns, constraints, and indexes.

### Task 1.1: Add user table and update project table

**Files:**
- Modify: `src/core/db/schema.ts`

- [ ] **Step 1: Add user table after organization**

```typescript
export const user = pgTable(
  'user',
  {
    id,
    orgId: uuid('org_id')
      .notNull()
      .references(() => organization.id),
    email: text('email').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    avatarUrl: text('avatar_url'),
    createdAt,
    updatedAt,
  },
  (t) => [uniqueIndex('user_org_slug_idx').on(t.orgId, t.slug)]
);
```

- [ ] **Step 2: Add userId to project, change unique index**

Add `userId` column after `orgId`:
```typescript
userId: uuid('user_id')
  .notNull()
  .references(() => user.id),
```

Replace unique index: `uniqueIndex('project_user_slug_idx').on(t.userId, t.slug)`

- [ ] **Step 3: Add user relations, update org and project relations**

- [ ] **Step 4: Commit**

```bash
git add src/core/db/schema.ts
git commit -m "schema: add user table, add userId to project"
```

### Task 1.2: Add issue catalog tables to schema.ts

**Files:**
- Modify: `src/core/db/schema.ts`

**DA Finding #1 — NULL uniqueness:** Postgres unique indexes don't enforce uniqueness when a column is NULL. For global catalog entries (projectId = NULL), we use a partial unique index for project-scoped rows AND a separate partial unique index for global rows.

- [ ] **Step 1: Add all 6 catalog tables**

Add issueType, issueState, issueStatus, issuePriority, issueLabel, issueTransition directly in schema.ts (no separate file — DA Finding #7).

For each catalog table, use TWO indexes to handle NULL projectId correctly:

```typescript
import { index, sql } from 'drizzle-orm';
// ... other imports

export const issueType = pgTable(
  'issue_type',
  {
    id,
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'restrict' }),
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    color: text('color').notNull(),
    sortOrder: integer('sort_order').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [
    // Project-scoped uniqueness
    uniqueIndex('issue_type_project_key_idx')
      .on(t.projectId, t.key)
      .where(sql`${t.projectId} IS NOT NULL`),
    // Global uniqueness (null project_id)
    uniqueIndex('issue_type_global_key_idx')
      .on(t.key)
      .where(sql`${t.projectId} IS NULL`),
  ]
);
```

Apply the same dual-index pattern to all 6 catalog tables: issueState, issueStatus, issuePriority, issueLabel, issueTransition.

**DA Finding #8 — JSONB default syntax:** NOT applicable to catalogs (no jsonb columns). Applied in Task 1.3.

- [ ] **Step 2: Commit**

```bash
git add src/core/db/schema.ts
git commit -m "schema: add issue catalog tables with partial unique indexes for NULL projectId"
```

### Task 1.3: Overhaul issue table and add entity tables

**Files:**
- Modify: `src/core/db/schema.ts`

**DA Finding #2, #5 — FK constraints:** All entity tables (comment, attachment, dependency) get proper FK constraints to the issue table immediately. No deferred wiring.

**DA Finding #8 — JSONB default:** Use `sql` template for the labels default.

- [ ] **Step 1: Replace the issue table**

Remove old columns: `description`, `state`, `priority`, `type`, `createdBy`.
Add new columns with FK refs to catalogs. The `labels` default uses correct Drizzle syntax:

```typescript
import { sql } from 'drizzle-orm';

export const issue = pgTable(
  'issue',
  {
    id,
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    bodyMd: text('body_md'),
    bodyHtml: text('body_html'),
    stateId: uuid('state_id')
      .notNull()
      .references(() => issueState.id, { onDelete: 'restrict' }),
    statusId: uuid('status_id')
      .notNull()
      .references(() => issueStatus.id, { onDelete: 'restrict' }),
    typeId: uuid('type_id')
      .notNull()
      .references(() => issueType.id, { onDelete: 'restrict' }),
    priorityId: uuid('priority_id')
      .notNull()
      .references(() => issuePriority.id, { onDelete: 'restrict' }),
    isClosed: boolean('is_closed').notNull().default(false),
    assignee: text('assignee'),
    author: text('author').notNull().default('system'),
    labels: jsonb('labels').notNull().default(sql`'[]'::jsonb`),
    version: integer('version').notNull().default(1),
    source: text('source').default('internal'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('issue_project_number_idx').on(t.projectId, t.number),
    index('issue_project_closed_idx').on(t.projectId, t.isClosed),
  ]
);
```

- [ ] **Step 2: Update issueEvent — add actor field**

```typescript
export const issueEvent = pgTable('issue_event', {
  id,
  issueId: uuid('issue_id')
    .notNull()
    .references(() => issue.id, { onDelete: 'cascade' }),
  actor: text('actor').notNull().default('system'),
  type: text('type').notNull(),
  payload: jsonb('payload'),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
  createdAt,
});
```

- [ ] **Step 3: Add issueComment with FK to issue**

```typescript
export const issueComment = pgTable('issue_comment', {
  id,
  issueId: uuid('issue_id')
    .notNull()
    .references(() => issue.id, { onDelete: 'cascade' }),
  commentNumber: integer('comment_number').notNull(),
  bodyMd: text('body_md').notNull(),
  bodyHtml: text('body_html').notNull(),
  author: text('author').notNull(),
  version: integer('version').notNull().default(1),
  isDeleted: boolean('is_deleted').notNull().default(false),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  createdAt,
  updatedAt,
});
```

- [ ] **Step 4: Add issueAttachment, issueDependency, issueSavedView with FKs**

All with proper FK constraints to issue table. issueDependency has FKs for both issueId and dependsOnIssueId.

- [ ] **Step 5: Add git placeholder tables (issueBranch, issuePullRequest, issueCommit)**

All with FK to issue. No CRUD endpoints until R5.

- [ ] **Step 6: Update all relations**

Add relations for: issue ↔ catalogs, issue ↔ comments, issue ↔ attachments, issue ↔ dependencies, issue ↔ events. Add relations for each catalog table. Add git table relations.

- [ ] **Step 7: Delete hardcoded enums**

```bash
rm src/core/issues/types.ts
```

- [ ] **Step 8: Push schema to Supabase**

```bash
npx drizzle-kit push --force
```

**Pre-condition:** Database was nuked in Phase 0. No existing rows to conflict with NOT NULL constraints.

- [ ] **Step 9: Verify in Supabase dashboard**

Check: all 15 new tables exist, issue table has correct columns, FK constraints present, partial unique indexes visible.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "schema: overhaul issue table, add entity tables, delete hardcoded enums"
```

---

## Phase 2: Seed Data

**Checkpoint:** Run seed → Supabase shows default org, user, project, catalogs, transitions, pipeline stages, status automation config.

### Task 2.1: Rewrite seed script

**Files:**
- Modify: `src/core/db/seed.ts`

**DA Finding #9 — backfill:** No backfill needed. Database was nuked. All data starts fresh.

**DA Finding #10 — config scoping:** Add `projectId` column to `configEntry` table OR use key namespacing. Decision: add `projectId` column to `configEntry`. This is a schema change that happens in Task 1.3 (add nullable `projectId` FK to configEntry). Seed inserts project-scoped config entries.

**DA Finding #12 — idempotency:** Use `onConflictDoNothing` with explicit conflict targets. For configEntry, the conflict target is `(scope, key, projectId)` — add a unique index on those three columns.

**DA Finding #30 — pipeline stages in seed:** The seed retains pipeline stage definitions (research, implement, review, deploy) with harness names. Seed files are the ONE place where specific names are allowed per CLAUDE.md.

**DA Finding #33 — comment migration:** No migration needed. Database was nuked. No existing comments to migrate.

- [ ] **Step 1: Add projectId to configEntry in schema.ts**

```typescript
export const configEntry = pgTable(
  'config_entry',
  {
    id,
    scope: text('scope').notNull().default('global'),
    projectId: uuid('project_id').references(() => project.id),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    previousValue: jsonb('previous_value'),
    changedBy: text('changed_by'),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('config_entry_scope_project_key_idx').on(t.scope, t.projectId, t.key),
  ]
);
```

Push schema: `npx drizzle-kit push --force`

- [ ] **Step 2: Rewrite seed.ts**

The seed creates (in order):
1. Default organization (`slug: 'default'`)
2. Default user (`slug: 'admin'`, `email` from env or `admin@fluxaos.local`)
3. Default project (`slug: 'fluxaos'`, owned by user)
4. Default pipeline with stages (research, implement, review, deploy — names in seed are allowed)
5. Issue type catalog: bug (#ef4444), feature (#3b82f6), task (#a855f7), research (#22c55e), enhancement (#f59e0b)
6. Issue state catalog: new (sort 10), research (20), implement (30), review (40), rework (50), deploy (60), complete (70, isTerminal=true)
7. Issue status catalog: open (5), queued (10), running (20), blocked (30), completed (40)
8. Issue priority catalog: critical (weight 100, #ef4444), high (200, #f97316), medium (300, #eab308), low (400, #6b7280)
9. Issue label catalog: general (#6b7280)
10. Issue transitions: the 10 default edges from spec (new→research, research→implement, etc.)
11. Status automation config entries (project-scoped):
    - `issues.status.on_create_key` = `"open"`
    - `issues.status.on_enqueued_key` = `"queued"`
    - `issues.status.on_running_key` = `"running"`
    - `issues.status.on_blocked_key` = `"blocked"`
    - `issues.status.on_completed_key` = `"completed"`

All inserts use `onConflictDoNothing`.

- [ ] **Step 3: Run seed and verify**

```bash
npx tsx src/core/db/seed.ts
```

Verify in Supabase: all catalogs populated, transitions present, config entries present.

- [ ] **Step 4: Commit**

```bash
git add src/core/db/schema.ts src/core/db/seed.ts
git commit -m "seed: add user, issue catalogs, transitions, status automation config"
```

### Task 2.2: Test nuke-and-seed cycle

- [ ] **Step 1: Run full cycle**

```bash
npx tsx src/core/db/nuke.ts
npx tsx src/core/db/seed.ts
```

Verify: clean state in Supabase. All catalogs present. No duplicates.

- [ ] **Step 2: Run cycle again to verify idempotency**

```bash
npx tsx src/core/db/nuke.ts
npx tsx src/core/db/seed.ts
```

Verify: identical state. No duplicate rows.

---

## Phase 3: Service Layer

**Checkpoint:** Integration tests pass against real Supabase. CRUD operations work for catalogs, issues, comments.

### Task 3.1: User service

**Files:**
- Create: `src/core/services/user.ts`

- [ ] **Step 1: Write user service**

Factory pattern matching existing services. Methods: CRUD + `getBySlug(orgId, slug)`.

- [ ] **Step 2: Commit**

```bash
git add src/core/services/user.ts
git commit -m "feat: user service"
```

### Task 3.2: Issue catalog service

**Files:**
- Create: `src/core/services/issue-catalog.ts`

**DA Finding #19:** The catalog service must NOT expose the raw CRUD factory `list()`. Override `list` to always filter by `isActive = true` and order by `sortOrder`. Add a separate `listAll(projectId)` for admin views that includes inactive items.

- [ ] **Step 1: Write catalog service**

One service factory that handles all 6 catalog types. Key methods:
- `types.list(projectId)` — active only, ordered by sortOrder
- `types.listAll(projectId)` — includes inactive, for admin
- `types.getByKey(projectId, key)` — resolve key to full row (including ID)
- `types.create(data)` / `types.update(id, data)` / `types.deactivate(id)` — no hard delete (RESTRICT FK)
- Same pattern for: states, statuses, priorities, labels
- `transitions.list(projectId)` — all active transitions
- `transitions.listFrom(projectId, fromStateId)` — valid next states from current state
- `transitions.create(data)` / `transitions.delete(id)`

- [ ] **Step 2: Commit**

```bash
git add src/core/services/issue-catalog.ts
git commit -m "feat: issue catalog service — always filters active, ordered by sortOrder"
```

### Task 3.3: Rewrite issue service

**Files:**
- Modify: `src/core/services/issue.ts`

**DA Finding #13 — FOR UPDATE:** Use raw SQL via `db.execute(sql`...`)` wrapped in a transaction for number generation.

**DA Finding #14 — Status resolution error path:** Fail fast with clear error if configEntry or status lookup returns nothing.

**DA Finding #15 — Initial state:** Service resolves the state with lowest `sortOrder` where `isTerminal = false`.

**DA Finding #16 — close/reopen semantics:** Both use override semantics (bypass transition graph).

- [ ] **Step 1: Complete rewrite**

```typescript
export function createIssueService(db: Database) {
  // ...

  async function create(data: {
    projectId: string;
    title: string;
    bodyMd?: string;
    typeId: string;
    priorityId: string;
    assignee?: string;
    labels?: string[];
    author?: string;
  }) {
    // 1. Resolve initial state: lowest sortOrder, non-terminal, active, for this project
    const initialState = await db.select()
      .from(issueState)
      .where(and(
        eq(issueState.projectId, data.projectId),
        eq(issueState.isTerminal, false),
        eq(issueState.isActive, true),
      ))
      .orderBy(issueState.sortOrder)
      .limit(1);
    if (initialState.length === 0) {
      throw new Error(`No active non-terminal state found for project ${data.projectId}. Run seed or configure issue states.`);
    }

    // 2. Resolve initial status from config
    const statusConfig = await db.select()
      .from(configEntry)
      .where(and(
        eq(configEntry.projectId, data.projectId),
        eq(configEntry.key, 'issues.status.on_create_key'),
      ))
      .limit(1);
    if (statusConfig.length === 0) {
      throw new Error(`Missing config: issues.status.on_create_key for project ${data.projectId}. Run seed.`);
    }
    const statusKey = statusConfig[0].value as string;
    const status = await db.select()
      .from(issueStatus)
      .where(and(
        eq(issueStatus.projectId, data.projectId),
        eq(issueStatus.key, statusKey),
      ))
      .limit(1);
    if (status.length === 0) {
      throw new Error(`Status "${statusKey}" not found for project ${data.projectId}. Check issue_status catalog.`);
    }

    // 3. Allocate number with FOR UPDATE lock inside transaction
    const result = await db.transaction(async (tx) => {
      const [{ nextNumber }] = await tx.execute(
        sql`SELECT COALESCE(MAX(number), 0) + 1 AS "nextNumber" FROM issue WHERE project_id = ${data.projectId} FOR UPDATE`
      );

      // 4. Render HTML from markdown (if provided)
      const bodyHtml = data.bodyMd ? renderMarkdown(data.bodyMd) : null;

      // 5. Insert
      const [created] = await tx.insert(issue).values({
        projectId: data.projectId,
        number: nextNumber as number,
        title: data.title,
        bodyMd: data.bodyMd ?? null,
        bodyHtml,
        stateId: initialState[0].id,
        statusId: status[0].id,
        typeId: data.typeId,
        priorityId: data.priorityId,
        isClosed: false,
        assignee: data.assignee ?? null,
        author: data.author ?? 'system',
        labels: data.labels ?? [],
      }).returning();

      // 6. Record event
      await tx.insert(issueEvent).values({
        issueId: created.id,
        actor: data.author ?? 'system',
        type: 'issue_created',
        payload: { author: data.author ?? 'system' },
      });

      return created;
    });

    return result;
  }

  async function transition(
    id: string,
    toStateId: string,
    version: number,
    userId: string = 'system',
  ) {
    // Load current issue
    const [current] = await db.select().from(issue).where(eq(issue.id, id));
    if (!current) throw new Error('Issue not found');

    // Check version (optimistic concurrency)
    if (current.version !== version) {
      throw new Error('VERSION_CONFLICT: Issue was modified by another user. Refresh and try again.');
    }

    // Validate transition exists in DB
    const [validTransition] = await db.select()
      .from(issueTransition)
      .where(and(
        eq(issueTransition.projectId, current.projectId),
        eq(issueTransition.fromStateId, current.stateId),
        eq(issueTransition.toStateId, toStateId),
        eq(issueTransition.isActive, true),
      ));
    if (!validTransition) {
      throw new Error('INVALID_TRANSITION: This state change is not allowed by the transition rules.');
    }

    // Check if target state is terminal
    const [targetState] = await db.select()
      .from(issueState)
      .where(eq(issueState.id, toStateId));
    const nowClosed = targetState?.isTerminal ?? false;

    // Update with version check
    const [updated] = await db.update(issue)
      .set({
        stateId: toStateId,
        isClosed: nowClosed,
        closedAt: nowClosed ? new Date() : null,
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(issue.id, id), eq(issue.version, version)))
      .returning();

    if (!updated) {
      throw new Error('VERSION_CONFLICT: Issue was modified by another user.');
    }

    // Record event
    await db.insert(issueEvent).values({
      issueId: id,
      actor: userId,
      type: 'state_changed',
      payload: { from_state: current.stateId, to_state: toStateId, user: userId },
    });

    return updated;
  }

  async function stateOverride(id: string, toStateId: string, version: number, userId: string = 'system') {
    // Same as transition but NO transition graph validation
    // ... (same pattern minus the validTransition check, plus override: true in event payload)
  }

  async function close(id: string, version: number, userId: string = 'system') {
    // Find first terminal state for this issue's project
    const [current] = await db.select().from(issue).where(eq(issue.id, id));
    if (!current) throw new Error('Issue not found');

    const [terminalState] = await db.select()
      .from(issueState)
      .where(and(
        eq(issueState.projectId, current.projectId),
        eq(issueState.isTerminal, true),
        eq(issueState.isActive, true),
      ))
      .orderBy(issueState.sortOrder)
      .limit(1);
    if (!terminalState) throw new Error('No terminal state configured for this project.');

    return stateOverride(id, terminalState.id, version, userId);
  }

  async function reopen(id: string, version: number, userId: string = 'system') {
    // Find first non-terminal state
    // ... same pattern, isTerminal = false
    return stateOverride(id, firstNonTerminal.id, version, userId);
  }

  // updateFields, getByNumber, getById, listByProject, delete, getValidTransitions
  // ... (each follows the same patterns above)
}
```

**DA Finding #21 — getValidTransitions:** This is a method on the issue service (not the catalog service) because it loads the issue first to get stateId, then queries transitions. Single service call from the router.

- [ ] **Step 2: Commit**

```bash
git add src/core/services/issue.ts
git commit -m "feat: rewrite issue service — DB-driven transitions, FOR UPDATE numbering, optimistic concurrency"
```

### Task 3.4: Issue comment service

**Files:**
- Create: `src/core/services/issue-comment.ts`

**DA Finding #18 — soft-delete body capture:** The service reads current body, writes it into the `comment_deleted` event payload, THEN clears the body fields.

- [ ] **Step 1: Write comment service**

Key methods:
- `list(issueId)` — includes soft-deleted (with empty body), ordered by commentNumber
- `create(issueId, { bodyMd, author })` — auto-assigns commentNumber via `SELECT COALESCE(MAX(comment_number), 0) + 1`, renders bodyHtml, records `comment_added` event
- `update(commentId, { bodyMd, editedBy, version })` — version check, re-renders bodyHtml, sets editedAt, records `comment_edited` event with `{ old_body, new_body, edited_by }`
- `softDelete(commentId, { deletedBy, version })` — reads current body first, records `comment_deleted` event with `{ body_md: currentBody, deleted_by }`, THEN sets isDeleted=true and clears bodyMd/bodyHtml

- [ ] **Step 2: Commit**

```bash
git add src/core/services/issue-comment.ts
git commit -m "feat: comment service — soft-delete captures body in event before clearing"
```

### Task 3.5: Attachment, dependency, event, saved view services

**Files:**
- Create: `src/core/services/issue-attachment.ts`
- Create: `src/core/services/issue-dependency.ts`
- Create: `src/core/services/issue-event.ts`
- Create: `src/core/services/issue-saved-view.ts`

- [ ] **Step 1: Write attachment service** — list, create (records event), delete (records event)
- [ ] **Step 2: Write dependency service** — list (both directions), create (records event), delete (records event)
- [ ] **Step 3: Write event service** — append-only create, list with tab filtering (all/comments/state/pipeline)
- [ ] **Step 4: Write saved view service** — CRUD + setDefault (unsets other defaults for project)
- [ ] **Step 5: Commit each service separately**

```bash
git add src/core/services/issue-attachment.ts && git commit -m "feat: attachment service"
git add src/core/services/issue-dependency.ts && git commit -m "feat: dependency service"
git add src/core/services/issue-event.ts && git commit -m "feat: event service — append-only with tab filtering"
git add src/core/services/issue-saved-view.ts && git commit -m "feat: saved view service"
```

### Task 3.6: Update barrel export

**Files:**
- Modify: `src/core/services/index.ts`

- [ ] **Step 1: Export all new services**
- [ ] **Step 2: Commit**

### Task 3.7: Integration tests

**Files:**
- Modify: `src/__tests__/integration/services.test.ts`

**DA Finding #28 — test isolation:** Use unique slugs per test run (`test-org-${Date.now()}`). Clean up in afterAll. Do NOT call nuke from tests.

**DA Finding #29 — catalog tests first:** Catalog integration tests come before issue tests. If catalogs are broken, issue tests fail with confusing FK errors.

- [ ] **Step 1: Write catalog integration tests**

Test: insert a type → verify uniqueness constraint (duplicate key fails) → query active-only → verify RESTRICT prevents delete when referenced by an issue.

- [ ] **Step 2: Write issue integration tests**

Test (order matters):
1. Create issue → verify auto-number, verify statusId set from config
2. Get by number → verify correct issue returned
3. Transition → verify DB lookup, state_changed event recorded
4. Invalid transition → verify throws INVALID_TRANSITION
5. Update fields with correct version → verify success, version incremented
6. Update fields with wrong version → verify VERSION_CONFLICT error
7. Add comment → verify commentNumber auto-increment, bodyHtml rendered
8. Edit comment → verify editedAt set, comment_edited event with old/new body
9. Soft-delete comment → verify isDeleted=true, body cleared, comment_deleted event has body
10. Close → verify isClosed=true, closedAt set, uses override semantics
11. Reopen → verify isClosed=false, closedAt null

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/__tests__/integration/services.test.ts
```

All tests must pass against real Supabase.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/integration/services.test.ts src/core/services/index.ts
git commit -m "test: integration tests for catalogs and rich issue model against real Supabase"
```

---

## Phase 4: tRPC Routers

**Checkpoint:** All issue endpoints callable via curl. Create, get by number, transition, add comment — all via API.

**DA Finding #22 — router namespace:** Sub-entity routers are nested INSIDE the issue router as `issue.comment.list`, `issue.attachment.list`, etc. — matching the spec's naming convention.

### Task 4.1: Rewrite issue router with nested sub-routers

**Files:**
- Modify: `src/server/routers/issue.ts`

- [ ] **Step 1: Rewrite issue router**

The router is structured as:
```typescript
export const issueRouter = router({
  list: publicProcedure.input(...).query(...),
  getByNumber: publicProcedure.input(...).query(...),
  getById: publicProcedure.input(...).query(...),
  create: publicProcedure.input(...).mutation(...),
  updateFields: publicProcedure.input(...).mutation(...),
  transition: publicProcedure.input(...).mutation(...),
  stateOverride: publicProcedure.input(...).mutation(...),
  close: publicProcedure.input(...).mutation(...),
  reopen: publicProcedure.input(...).mutation(...),
  delete: publicProcedure.input(...).mutation(...),
  transitions: publicProcedure.input(...).query(...),  // DA #21: calls issue service
  users: publicProcedure.input(...).query(...),

  // Nested sub-routers
  comment: router({
    list: publicProcedure.input(...).query(...),
    create: publicProcedure.input(...).mutation(...),
    update: publicProcedure.input(...).mutation(...),
    delete: publicProcedure.input(...).mutation(...),
  }),
  attachment: router({
    list: publicProcedure.input(...).query(...),
    create: publicProcedure.input(...).mutation(...),
    delete: publicProcedure.input(...).mutation(...),
  }),
  dependency: router({
    list: publicProcedure.input(...).query(...),
    create: publicProcedure.input(...).mutation(...),
    delete: publicProcedure.input(...).mutation(...),
  }),
  event: router({
    list: publicProcedure.input(...).query(...),
  }),
  savedView: router({
    list: publicProcedure.input(...).query(...),
    create: publicProcedure.input(...).mutation(...),
    update: publicProcedure.input(...).mutation(...),
    delete: publicProcedure.input(...).mutation(...),
    setDefault: publicProcedure.input(...).mutation(...),
  }),
});
```

All Zod inputs use UUIDs for IDs. No hardcoded string enums. Version is required on all mutations that modify existing data.

- [ ] **Step 2: Commit**

```bash
git add src/server/routers/issue.ts
git commit -m "feat: rewrite issue router with nested comment/attachment/dependency/event/savedView sub-routers"
```

### Task 4.2: Issue catalog router

**Files:**
- Create: `src/server/routers/issue-catalog.ts`

- [ ] **Step 1: Write catalog router**

Nested structure: `issueCatalog.types.list/create/update/deactivate`, same for states, statuses, priorities, labels, transitions.

Also: `issueCatalog.health` — returns `{ ready: boolean, missing: string[] }` by checking all required catalogs have at least one active entry AND all 5 status automation config entries exist for the project.

- [ ] **Step 2: Register in root.ts**

```typescript
export const appRouter = router({
  organization: organizationRouter,
  project: projectRouter,
  issue: issueRouter,       // includes nested comment/attachment/dependency/event/savedView
  issueCatalog: issueCatalogRouter,  // catalog CRUD + health check
  skill: skillRouter,
  persona: personaRouter,
  pipeline: pipelineRouter,
});
```

- [ ] **Step 3: Verify via curl**

```bash
# List catalogs
curl 'http://localhost:3000/api/trpc/issueCatalog.types.list?input={"json":{"projectId":"<UUID>"}}'

# Create issue
curl -X POST http://localhost:3000/api/trpc/issue.create \
  -H 'Content-Type: application/json' \
  -d '{"json":{"projectId":"<UUID>","title":"Test Issue","typeId":"<UUID>","priorityId":"<UUID>"}}'

# Get by number
curl 'http://localhost:3000/api/trpc/issue.getByNumber?input={"json":{"projectId":"<UUID>","number":1}}'

# Add comment
curl -X POST http://localhost:3000/api/trpc/issue.comment.create \
  -H 'Content-Type: application/json' \
  -d '{"json":{"issueId":"<UUID>","bodyMd":"Test comment","author":"admin"}}'

# Health check
curl 'http://localhost:3000/api/trpc/issueCatalog.health?input={"json":{"projectId":"<UUID>"}}'
```

- [ ] **Step 4: Commit**

```bash
git add src/server/routers/issue-catalog.ts src/server/root.ts
git commit -m "feat: issue catalog router + config health check"
```

---

## Phase 5: Route Reconciliation + UI

**Checkpoint:** User opens browser, navigates to scoped URL, creates an issue, edits it, transitions states, adds a comment. All data-driven from catalog tables.

### Task 5.1: Restructure app routes

**Files:**
- Move pages from `src/app/dashboard/` to `src/app/[org]/[user]/[project]/`
- Modify: `src/app/page.tsx`
- Modify: `src/lib/resolve-context.ts`
- Modify: `src/components/nav.tsx`

**DA Finding #23 — resolveContext:** Use direct DB import, not createTRPCContext().

**DA Finding #24 — enumerate files:** Every file that moves:

| Source | Destination |
|--------|------------|
| `src/app/dashboard/page.tsx` | `src/app/[org]/[user]/[project]/page.tsx` |
| `src/app/dashboard/layout.tsx` | `src/app/[org]/[user]/[project]/layout.tsx` |
| `src/app/dashboard/issues/page.tsx` | `src/app/[org]/[user]/[project]/issues/page.tsx` |
| `src/app/dashboard/issues/[id]/page.tsx` | `src/app/[org]/[user]/[project]/issues/[number]/page.tsx` (rename [id] to [number]) |
| `src/app/dashboard/pipelines/page.tsx` | `src/app/[org]/[user]/[project]/pipelines/page.tsx` |
| `src/app/dashboard/pipelines/[id]/page.tsx` | `src/app/[org]/[user]/[project]/pipelines/[id]/page.tsx` |
| `src/app/dashboard/kpis/page.tsx` | `src/app/[org]/[user]/[project]/kpis/page.tsx` |
| `src/app/dashboard/settings/page.tsx` | `src/app/[org]/[user]/[project]/settings/page.tsx` |
| `src/app/dashboard/settings/personas/page.tsx` | `src/app/[org]/[user]/[project]/settings/personas/page.tsx` |
| `src/app/dashboard/settings/skills/page.tsx` | `src/app/[org]/[user]/[project]/settings/skills/page.tsx` |
| `src/app/dashboard/settings/routing/page.tsx` | `src/app/[org]/[user]/[project]/settings/routing/page.tsx` |
| `src/app/dashboard/settings/providers/page.tsx` | `src/app/[org]/[user]/[project]/settings/providers/page.tsx` |

Delete `src/app/dashboard/` after move.

**DA Finding #25 — hardcoded redirect:** The root page.tsx queries the database for the first org → first user → first project and redirects dynamically.

```typescript
// src/app/page.tsx
import { redirect } from 'next/navigation';
import { bootstrap } from '@/config/bootstrap';
import { registry } from '@/config/registry';
import type { DatabaseProvider } from '@/core/ports/database';
import { organization, user, project } from '@/core/db/schema';

export default async function RootPage() {
  bootstrap();
  const db = registry.get<DatabaseProvider>('database').getConnection();

  const [org] = await db.select().from(organization).limit(1);
  if (!org) return <div>No organization found. Run seed.</div>;

  const [usr] = await db.select().from(user).where(eq(user.orgId, org.id)).limit(1);
  if (!usr) return <div>No user found. Run seed.</div>;

  const [proj] = await db.select().from(project).where(eq(project.userId, usr.id)).limit(1);
  if (!proj) return <div>No project found. Run seed.</div>;

  redirect(`/${org.slug}/${usr.slug}/${proj.slug}`);
}
```

- [ ] **Step 1: Create resolveContext with direct DB import**

```typescript
// src/lib/resolve-context.ts
import { notFound } from 'next/navigation';
import { bootstrap } from '@/config/bootstrap';
import { registry } from '@/config/registry';
import type { DatabaseProvider } from '@/core/ports/database';
import { createOrganizationService, createUserService, createProjectService } from '@/core/services';

export async function resolveContext(orgSlug: string, userSlug: string, projectSlug: string) {
  bootstrap();
  const db = registry.get<DatabaseProvider>('database').getConnection();

  const orgSvc = createOrganizationService(db);
  const userSvc = createUserService(db);
  const projSvc = createProjectService(db);

  const org = await orgSvc.getBySlug(orgSlug);
  if (!org) notFound();

  const usr = await userSvc.getBySlug(org.id, userSlug);
  if (!usr) notFound();

  const proj = await projSvc.getBySlug(usr.id, projectSlug);
  if (!proj) notFound();

  return { db, org, user: usr, project: proj };
}
```

- [ ] **Step 2: Move all files, update all Link hrefs, update nav**
- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: restructure routes to /[org]/[user]/[project]/ — dynamic root redirect"
```

### Task 5.2: Rewrite issue list page

**Files:**
- Modify: `src/app/[org]/[user]/[project]/issues/page.tsx`

- [ ] **Step 1: Replace hardcoded enums with catalog queries**

Fetch types, states, priorities from `issueCatalog.types.list`, etc. Render dropdowns from DB values. Stage summary cards from state catalog. Badge colors from catalog `color` field. Issue links use `/${org}/${user}/${project}/issues/${issue.number}`.

- [ ] **Step 2: Commit**

### Task 5.3: Rewrite issue detail page

**Files:**
- Modify: `src/app/[org]/[user]/[project]/issues/[number]/page.tsx`

**DA Finding #26 — mutation queue:** For this first implementation, use save-on-blur (not auto-save). Each field edit requires explicit save action. The mutation queue pattern is deferred to a polish pass. This is simpler and avoids 409 conflicts from rapid concurrent saves.

- [ ] **Step 1: Server component loads issue by number via resolveContext + service**
- [ ] **Step 2: Client component with save-on-blur for inline edits**

Meta strip: State (dropdown), Priority (dropdown), Type (dropdown), Assignee (text). Each shows a save button on change. Version is sent with every mutation.

Activity feed: fetches events from `issue.event.list`, renders with tab filter.

Transition buttons: fetches valid transitions from `issue.transitions`, renders as buttons.

Comment editor: markdown textarea, submit button.

- [ ] **Step 3: Commit**

### Task 5.4: Rewrite issue create page + dashboard

- [ ] **Step 1: Issue create page — catalog-driven dropdowns, config health check on load**
- [ ] **Step 2: Dashboard — dynamic stat cards from catalog, no hardcoded state/priority strings**
- [ ] **Step 3: Commit**

---

## Phase 6: Verification

**Checkpoint:** User performs the one-thing test.

### Task 6.1: Run invariant checks

**DA Finding #31:** If violations are found, STOP and report to user. Do NOT fix autonomously.

- [ ] **Step 1: Run CLAUDE.md verification protocol**

Run all grep checks from CLAUDE.md. Report results. If any FAIL, stop and report to user for decision. Do not auto-fix.

- [ ] **Step 2: Commit fixes (only if user approves)**

### Task 6.2: Nuke, seed, and user verification

- [ ] **Step 1: Nuke and seed**

```bash
npx tsx src/core/db/nuke.ts
npx tsx src/core/db/seed.ts
npm run dev
```

- [ ] **Step 2: User performs the one-thing test**

Open browser. Navigate to the app. **Create an issue.** If that works:

1. Edit the title → save
2. Change the state via dropdown (options from DB) → save
3. Change the priority → save
4. Add a comment
5. Edit the comment
6. Soft-delete the comment → verify "comment deleted" placeholder
7. Check activity feed shows all events with correct types
8. Verify issue number (#1) in URL
9. Go back to list → verify issue with correct colored badges
10. Check Supabase dashboard → data matches UI
11. Check stage summary cards at top of list → counts from DB

**If ANY step fails, the phase is not complete. Fix and re-verify.**

---

## Spec Coverage Checklist

| Spec Requirement | Task | DA Finding Addressed |
|-----------------|------|---------------------|
| 6 catalog tables | 1.2 | #1 (NULL uniqueness) |
| Transition table | 1.2 | #1, #6 |
| Comment table with FK | 1.3 | #2 (FK wiring) |
| Attachment table with FK | 1.3 | #2 |
| Dependency table with FK | 1.3 | #5 |
| Saved view table | 1.3 | — |
| Git placeholder tables | 1.3 | — |
| Issue table overhaul | 1.3 | #3 (NOT NULL), #8 (JSONB default) |
| Delete hardcoded enums | 1.3 | — |
| User table + multi-tenancy | 1.1 | #4 (existing data) |
| Nuke script | 0.1 | #3, #4, #11 (FK order) |
| Default seed data | 2.1 | #9, #10 (config scoping), #12, #30 |
| Status automation config | 2.1 | #10 (projectId on configEntry) |
| Issue number (FOR UPDATE) | 3.3 | #13 (raw SQL) |
| Optimistic concurrency | 3.3 | — |
| DB-driven transitions | 3.3 | #15 (initial state), #16 (close/reopen) |
| is_closed denormalization | 3.3 | — |
| Comment soft-delete with audit | 3.4 | #18 (body capture) |
| Catalog service (active-only) | 3.2 | #19 (override list) |
| All API endpoints | 4.1, 4.2 | #20 (split tasks), #21 (transitions), #22 (namespace) |
| Config health check | 4.2 | — |
| Route reconciliation | 5.1 | #23 (resolveContext), #24 (file list), #25 (redirect) |
| Issue list (catalog-driven) | 5.2 | — |
| Issue detail (inline edit) | 5.3 | #26 (save-on-blur, not mutation queue) |
| Issue create | 5.4 | — |
| Dashboard (catalog-driven) | 5.4 | — |
| Invariant verification | 6.1 | #31 (stop, don't fix) |
| User verification | 6.2 | — |
| Bulk operations | DEFERRED | #17 |
| Kanban view | DEFERRED | #35 |
| Comment migration | NOT NEEDED | #33 (nuked DB) |
| gates/types.ts deletion | NOT NEEDED | #34 (no issue refs) |
| Pipeline status defaults | KNOWN DEBT | #32 |
| Assignee source | DECIDED | #27 (free text) |
| Test isolation | 3.7 | #28 (unique slugs) |
| Catalog integration tests | 3.7 | #29 |
