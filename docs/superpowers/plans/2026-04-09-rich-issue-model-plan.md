# Rich Issue Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **CRITICAL:** Read CLAUDE.md first. Every invariant applies. No unit tests. No hardcoded enums. No vendor imports in core. Human verification at every checkpoint.

**Goal:** Replace the hardcoded issue model with database-driven catalogs, per-project numbering, markdown support, comments, attachments, dependencies, saved views, and a full tRPC API — all against real Supabase.

**Architecture:** Drizzle schema tables → seed script → services with DI → tRPC routers with Zod validation → UI pages using the design system from PR #12. Each layer builds on the previous. The issue service enforces DB-driven transitions (no hardcoded state machine).

**Tech Stack:** Drizzle ORM, tRPC v11, Zod, Next.js 16 App Router, React 19, Tailwind CSS 4, Supabase Cloud Postgres

**Specs:**
- Base: `docs/superpowers/specs/2026-04-09-rich-issue-model-design.md`
- Addendum: `docs/superpowers/specs/2026-04-09-issue-model-brainstorm-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `src/core/db/schema-issue-catalogs.ts` | Drizzle tables: issueType, issueState, issueStatus, issuePriority, issueLabel, issueTransition |
| `src/core/db/schema-issue-entities.ts` | Drizzle tables: issueComment, issueAttachment, issueDependency, issueSavedView |
| `src/core/db/schema-issue-git.ts` | Drizzle tables (placeholders): issueBranch, issuePullRequest, issueCommit |
| `src/core/db/nuke.ts` | Nuke script: drops all user data, reseeds defaults |
| `src/core/services/issue-catalog.ts` | Catalog CRUD service: types, states, statuses, priorities, labels, transitions |
| `src/core/services/issue-comment.ts` | Comment service: create, update (with version check), soft-delete, list |
| `src/core/services/issue-attachment.ts` | Attachment service: create, delete, list |
| `src/core/services/issue-dependency.ts` | Dependency service: create, delete, list (both directions) |
| `src/core/services/issue-saved-view.ts` | Saved view service: CRUD + setDefault |
| `src/core/services/issue-event.ts` | Event service: append-only create, list with tab filtering |
| `src/server/routers/issue-catalog.ts` | tRPC router for catalog CRUD |
| `src/server/routers/issue-comment.ts` | tRPC router for comment operations |
| `src/server/routers/issue-attachment.ts` | tRPC router for attachment operations |
| `src/server/routers/issue-dependency.ts` | tRPC router for dependency operations |
| `src/server/routers/issue-event.ts` | tRPC router for event queries |
| `src/server/routers/issue-saved-view.ts` | tRPC router for saved view CRUD |

### Modified Files

| File | Changes |
|------|---------|
| `src/core/db/schema.ts` | Overhaul issue table (new columns, FK refs to catalogs), add user table, add userId to project, update relations |
| `src/core/db/seed.ts` | Seed issue catalogs, transitions, status automation config, default user |
| `src/core/services/issue.ts` | Complete rewrite: DB-driven transitions, optimistic concurrency, per-project numbering, markdown rendering, is_closed management |
| `src/core/services/index.ts` | Export new services |
| `src/server/routers/issue.ts` | Complete rewrite: new endpoints (getByNumber, updateFields with version, transition, stateOverride, close, reopen, bulk) |
| `src/server/root.ts` | Register new routers |
| `src/lib/resolve-context.ts` | Add user resolution to context |
| `src/app/` pages | Reconcile routing to `/[org]/[user]/[project]/` pattern, replace hardcoded enums with catalog queries |
| `src/__tests__/integration/services.test.ts` | Rewrite issue tests for new schema |

### Deleted Files

| File | Reason |
|------|--------|
| `src/core/issues/types.ts` | Hardcoded enums replaced by DB catalogs |

---

## Phase 1: Schema — Catalog Tables + Issue Table Overhaul

**Checkpoint:** Tables exist in Supabase, `drizzle-kit push` succeeds, schema visible in Supabase dashboard.

### Task 1.1: Add user table and update project table

**Files:**
- Modify: `src/core/db/schema.ts`

- [ ] **Step 1: Add user table after organization table**

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

- [ ] **Step 2: Add userId to project table**

Add after `orgId`:
```typescript
userId: uuid('user_id')
  .notNull()
  .references(() => user.id),
```

Update the unique index:
```typescript
(t) => [uniqueIndex('project_user_slug_idx').on(t.userId, t.slug)]
```

- [ ] **Step 3: Add user relations**

```typescript
export const userRelations = relations(user, ({ one, many }) => ({
  organization: one(organization, {
    fields: [user.orgId],
    references: [organization.id],
  }),
  projects: many(project),
}));
```

Update organizationRelations to include `users: many(user)`.
Update projectRelations to include user one-relation.

- [ ] **Step 4: Commit**

```bash
git add src/core/db/schema.ts
git commit -m "schema: add user table, add userId to project for multi-tenancy"
```

### Task 1.2: Create issue catalog tables

**Files:**
- Create: `src/core/db/schema-issue-catalogs.ts`

- [ ] **Step 1: Create the catalog tables file**

This file defines 6 tables: issueType, issueState, issueStatus, issuePriority, issueLabel, issueTransition. All follow the same pattern from the spec: per-project scoped (nullable project_id = global), unique on (project_id, key), RESTRICT on delete, is_active soft-disable.

```typescript
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { project } from './schema';

const id = uuid('id').primaryKey().defaultRandom();
const createdAt = timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();

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
  (t) => [uniqueIndex('issue_type_project_key_idx').on(t.projectId, t.key)]
);

export const issueState = pgTable(
  'issue_state',
  {
    id,
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'restrict' }),
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    color: text('color').notNull(),
    sortOrder: integer('sort_order').notNull(),
    isTerminal: boolean('is_terminal').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [uniqueIndex('issue_state_project_key_idx').on(t.projectId, t.key)]
);

export const issueStatus = pgTable(
  'issue_status',
  {
    id,
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'restrict' }),
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [uniqueIndex('issue_status_project_key_idx').on(t.projectId, t.key)]
);

export const issuePriority = pgTable(
  'issue_priority',
  {
    id,
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'restrict' }),
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    color: text('color').notNull(),
    weight: integer('weight').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [uniqueIndex('issue_priority_project_key_idx').on(t.projectId, t.key)]
);

export const issueLabel = pgTable(
  'issue_label',
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
  (t) => [uniqueIndex('issue_label_project_key_idx').on(t.projectId, t.key)]
);

export const issueTransition = pgTable(
  'issue_transition',
  {
    id,
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'restrict' }),
    fromStateId: uuid('from_state_id')
      .notNull()
      .references(() => issueState.id, { onDelete: 'restrict' }),
    toStateId: uuid('to_state_id')
      .notNull()
      .references(() => issueState.id, { onDelete: 'restrict' }),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('issue_transition_project_from_to_idx').on(
      t.projectId,
      t.fromStateId,
      t.toStateId
    ),
  ]
);
```

- [ ] **Step 2: Commit**

```bash
git add src/core/db/schema-issue-catalogs.ts
git commit -m "schema: add issue catalog tables (types, states, statuses, priorities, labels, transitions)"
```

### Task 1.3: Create issue entity tables (comment, attachment, dependency, saved view)

**Files:**
- Create: `src/core/db/schema-issue-entities.ts`

- [ ] **Step 1: Create the entity tables file**

Contains: issueComment, issueAttachment, issueDependency, issueSavedView. All reference the issue table from schema.ts.

```typescript
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { project } from './schema';

// Forward reference — the issue table will be imported after schema.ts is updated
// For now, use a string reference that Drizzle resolves
const id = uuid('id').primaryKey().defaultRandom();
const createdAt = timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();

// Note: issueId FK will reference the updated issue table in schema.ts.
// The actual FK wiring happens in Task 1.5 when the issue table is overhauled.

export const issueComment = pgTable('issue_comment', {
  id,
  issueId: uuid('issue_id').notNull(),
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

export const issueAttachment = pgTable('issue_attachment', {
  id,
  issueId: uuid('issue_id').notNull(),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageUrl: text('storage_url').notNull(),
  uploadedBy: text('uploaded_by').notNull(),
  createdAt,
  updatedAt,
});

export const issueDependency = pgTable(
  'issue_dependency',
  {
    id,
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    issueId: uuid('issue_id').notNull(),
    dependsOnIssueId: uuid('depends_on_issue_id').notNull(),
    dependencyType: text('dependency_type').notNull().default('blocks'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('issue_dependency_unique_idx').on(
      t.projectId,
      t.issueId,
      t.dependsOnIssueId
    ),
  ]
);

export const issueSavedView = pgTable('issue_saved_view', {
  id,
  projectId: uuid('project_id')
    .notNull()
    .references(() => project.id),
  name: text('name').notNull(),
  filters: jsonb('filters').notNull(),
  sortField: text('sort_field'),
  sortOrder: text('sort_order'),
  limit: integer('limit'),
  isDefault: boolean('is_default').notNull().default(false),
  createdBy: text('created_by').notNull(),
  createdAt,
  updatedAt,
});
```

- [ ] **Step 2: Commit**

```bash
git add src/core/db/schema-issue-entities.ts
git commit -m "schema: add issue entity tables (comment, attachment, dependency, saved view)"
```

### Task 1.4: Create git placeholder tables

**Files:**
- Create: `src/core/db/schema-issue-git.ts`

- [ ] **Step 1: Create the placeholder tables file**

These tables exist in the schema but have no CRUD endpoints until Phase R5.

```typescript
import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const id = uuid('id').primaryKey().defaultRandom();
const createdAt = timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();

export const issueBranch = pgTable('issue_branch', {
  id,
  issueId: uuid('issue_id').notNull(),
  repo: text('repo').notNull(),
  branchName: text('branch_name').notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdBy: text('created_by').notNull(),
  createdAt,
  updatedAt,
});

export const issuePullRequest = pgTable('issue_pull_request', {
  id,
  issueId: uuid('issue_id').notNull(),
  repo: text('repo').notNull(),
  provider: text('provider').notNull(),
  prNumber: integer('pr_number').notNull(),
  prUrl: text('pr_url').notNull(),
  title: text('title').notNull(),
  state: text('state').notNull(),
  headBranch: text('head_branch').notNull(),
  baseBranch: text('base_branch').notNull(),
  author: text('author').notNull(),
  mergedAt: timestamp('merged_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt,
  updatedAt,
});

export const issueCommit = pgTable('issue_commit', {
  id,
  issueId: uuid('issue_id').notNull(),
  repo: text('repo').notNull(),
  sha: text('sha').notNull(),
  author: text('author').notNull(),
  message: text('message').notNull(),
  committedAt: timestamp('committed_at', { withTimezone: true }).notNull(),
  createdAt,
  updatedAt,
});
```

- [ ] **Step 2: Commit**

```bash
git add src/core/db/schema-issue-git.ts
git commit -m "schema: add git placeholder tables (branch, PR, commit) — no CRUD until R5"
```

### Task 1.5: Overhaul issue table in schema.ts

**Files:**
- Modify: `src/core/db/schema.ts`

- [ ] **Step 1: Import catalog and entity tables**

At the top of schema.ts, after existing imports, add re-exports:

```typescript
// Re-export issue catalog and entity tables
export * from './schema-issue-catalogs';
export * from './schema-issue-entities';
export * from './schema-issue-git';
```

- [ ] **Step 2: Replace the issue table definition**

Replace the existing `issue` table (lines 139-153) with:

```typescript
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
    labels: jsonb('labels').notNull().default([]),
    version: integer('version').notNull().default(1),
    source: text('source').default('internal'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('issue_project_number_idx').on(t.projectId, t.number),
  ]
);
```

- [ ] **Step 3: Update issueEvent table — add actor field**

Replace the issueEvent table:

```typescript
export const issueEvent = pgTable('issue_event', {
  id,
  issueId: uuid('issue_id')
    .notNull()
    .references(() => issue.id, { onDelete: 'cascade' }),
  actor: text('actor').notNull().default('system'),
  type: text('type').notNull(),
  payload: jsonb('payload'),
  timestamp: timestamp('timestamp', { withTimezone: true })
    .defaultNow()
    .notNull(),
  createdAt,
});
```

- [ ] **Step 4: Update all issue relations**

Replace issueRelations with expanded version linking to catalogs, comments, attachments, dependencies, events, git tables:

```typescript
export const issueRelations = relations(issue, ({ one, many }) => ({
  project: one(project, {
    fields: [issue.projectId],
    references: [project.id],
  }),
  state: one(issueState, {
    fields: [issue.stateId],
    references: [issueState.id],
  }),
  status: one(issueStatus, {
    fields: [issue.statusId],
    references: [issueStatus.id],
  }),
  type: one(issueType, {
    fields: [issue.typeId],
    references: [issueType.id],
  }),
  priority: one(issuePriority, {
    fields: [issue.priorityId],
    references: [issuePriority.id],
  }),
  events: many(issueEvent),
  comments: many(issueComment),
  attachments: many(issueAttachment),
  pipelineRuns: many(pipelineRun),
}));
```

Add relations for issueComment, issueAttachment, issueDependency, issueSavedView, and the catalog tables. Each catalog table gets a relation to its issues.

- [ ] **Step 5: Delete src/core/issues/types.ts**

```bash
rm src/core/issues/types.ts
```

- [ ] **Step 6: Push schema to Supabase**

```bash
npx drizzle-kit push --force
```

- [ ] **Step 7: Verify tables in Supabase dashboard**

Open Supabase dashboard → Table Editor. Confirm all new tables exist with correct columns and constraints.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "schema: overhaul issue table, add FK refs to catalogs, delete hardcoded enums"
```

---

## Phase 2: Seed Data + Nuke Script

**Checkpoint:** Run seed → see default catalogs in Supabase. Run nuke → everything gone. Run seed again → clean state.

### Task 2.1: Rewrite seed script

**Files:**
- Modify: `src/core/db/seed.ts`

- [ ] **Step 1: Rewrite seed.ts to create user + catalogs**

The seed must create:
1. Default organization
2. Default user (email from env or 'admin@fluxaos.local')
3. Default project (owned by user)
4. Default pipeline with stages
5. Issue type catalog (bug, feature, task, research, enhancement)
6. Issue state catalog (new, research, implement, review, rework, deploy, complete — complete is terminal)
7. Issue status catalog (open, queued, running, blocked, completed)
8. Issue priority catalog (critical/100, high/200, medium/300, low/400)
9. Issue label catalog (general)
10. Issue transitions (the 10 default edges from spec)
11. Status automation config entries (issues.status.on_create_key etc.)

All catalog values come from seed data arrays — not hardcoded in application logic. The seed file is the ONE place where specific stage/type/state names appear.

Use `onConflictDoNothing` for idempotency.

- [ ] **Step 2: Commit**

```bash
git add src/core/db/seed.ts
git commit -m "seed: add user, issue catalogs, transitions, status automation config"
```

### Task 2.2: Create nuke script

**Files:**
- Create: `src/core/db/nuke.ts`

- [ ] **Step 1: Write nuke script**

Deletes all user-created data in reverse dependency order:
1. issueEvent, issueComment, issueAttachment, issueDependency, issueSavedView
2. issueBranch, issuePullRequest, issueCommit
3. stageRun events, stageRun, pipelineRun
4. issue
5. issueTransition
6. issueType, issueState, issueStatus, issuePriority, issueLabel
7. pipelineStage, pipeline
8. configEntry (status automation entries)
9. persona, skill, team, brand, memory, routingRule, routingProfile, provider, model
10. project, user, organization

Use `db.delete(table)` with no WHERE — nuke everything.

Usage: `npx tsx src/core/db/nuke.ts`

- [ ] **Step 2: Test the cycle: nuke → seed → verify in Supabase**

```bash
npx tsx src/core/db/nuke.ts
npx tsx src/core/db/seed.ts
```

Verify in Supabase dashboard: org exists, user exists, project exists, catalogs populated.

- [ ] **Step 3: Commit**

```bash
git add src/core/db/nuke.ts
git commit -m "feat: nuke-and-seed cycle for clean development database state"
```

---

## Phase 3: Issue Service Rewrite

**Checkpoint:** Run integration tests against Supabase. Create/read/transition/comment on issues via service layer.

### Task 3.1: Issue catalog service

**Files:**
- Create: `src/core/services/issue-catalog.ts`

- [ ] **Step 1: Write the catalog service**

One service that handles CRUD for all 6 catalog types. Uses the CRUD factory for base operations. Adds:
- `listActive(projectId)` — returns only `isActive = true` items, ordered by sortOrder
- `getByKey(projectId, key)` — resolve a key to an ID
- `listTransitions(projectId, fromStateId)` — returns valid next states from current state

The service receives `db: Database` via DI. It does NOT import any hardcoded enum values.

- [ ] **Step 2: Commit**

```bash
git add src/core/services/issue-catalog.ts
git commit -m "feat: issue catalog service — CRUD for types, states, statuses, priorities, labels, transitions"
```

### Task 3.2: Rewrite issue service

**Files:**
- Modify: `src/core/services/issue.ts`

- [ ] **Step 1: Complete rewrite of issue.ts**

The new service:
- `listByProject(projectId, filters?)` — filter by isClosed, typeId, stateId, priorityId, assignee, labels, search (title contains). Order by createdAt desc.
- `getById(id)` — returns issue with joined catalog display names
- `getByNumber(projectId, number)` — for URL resolution
- `create(data)` — auto-assigns next number via `SELECT COALESCE(MAX(number), 0) + 1 FROM issue WHERE project_id = $1 FOR UPDATE`. Resolves status to `on_create_key` from configEntry. Renders bodyHtml from bodyMd. Sets isClosed based on state's isTerminal. Records `issue_created` event.
- `updateFields(id, fields, version, userId)` — PATCH with optimistic concurrency (`WHERE id = $id AND version = $version`). Returns 409-style error if 0 rows. Renders bodyHtml if bodyMd changed. Records `fields_updated` event.
- `transition(id, toStateId, version, userId)` — validates transition exists in issueTransition table. Updates stateId, manages isClosed + closedAt. Records `state_changed` event. Increments version.
- `stateOverride(id, toStateId, version, userId)` — admin bypass, no transition validation. Records `state_changed` event with `override: true`.
- `close(id, version, userId)` — find first terminal state, transition to it.
- `reopen(id, version, userId)` — find first non-terminal state, transition to it.
- `delete(id)` — hard delete (cascades via DB).
- `bulk(projectId, selection, action)` — bulk operations on multiple issues.

NO hardcoded state names. The service reads `isTerminal` from the issueState table. Transition validation queries the issueTransition table.

- [ ] **Step 2: Commit**

```bash
git add src/core/services/issue.ts
git commit -m "feat: rewrite issue service — DB-driven transitions, optimistic concurrency, per-project numbering"
```

### Task 3.3: Issue comment service

**Files:**
- Create: `src/core/services/issue-comment.ts`

- [ ] **Step 1: Write comment service**

- `list(issueId)` — returns all comments including soft-deleted (with empty body). Ordered by commentNumber.
- `create(issueId, { bodyMd, author })` — auto-assigns commentNumber via MAX+1 per issue. Renders bodyHtml at write time. Records `comment_added` event.
- `update(commentId, { bodyMd, editedBy, version })` — optimistic concurrency check. Sets editedAt. Renders bodyHtml. Records `comment_edited` event with audit trail (old body, new body, who, when).
- `softDelete(commentId, { deletedBy, version })` — sets isDeleted=true, clears bodyMd and bodyHtml. Records `comment_deleted` event. Does NOT hard-delete.

- [ ] **Step 2: Commit**

```bash
git add src/core/services/issue-comment.ts
git commit -m "feat: issue comment service — soft delete, optimistic concurrency, audit trail"
```

### Task 3.4: Issue attachment service

**Files:**
- Create: `src/core/services/issue-attachment.ts`

- [ ] **Step 1: Write attachment service**

- `list(issueId)` — returns all attachments
- `create(issueId, { fileName, contentType, sizeBytes, storageUrl, uploadedBy })` — records `attachment_added` event
- `delete(attachmentId)` — hard delete, records `attachment_removed` event

- [ ] **Step 2: Commit**

```bash
git add src/core/services/issue-attachment.ts
git commit -m "feat: issue attachment service — data URL storage for alpha"
```

### Task 3.5: Issue dependency service

**Files:**
- Create: `src/core/services/issue-dependency.ts`

- [ ] **Step 1: Write dependency service**

- `list(issueId)` — returns both directions: issues this one blocks + issues that block this one
- `create(projectId, issueId, dependsOnIssueId, dependencyType?)` — records `dependency_added` event. No cycle detection (documented limitation).
- `delete(dependencyId)` — records `dependency_removed` event

- [ ] **Step 2: Commit**

```bash
git add src/core/services/issue-dependency.ts
git commit -m "feat: issue dependency service — blocks/blocked-by relationships"
```

### Task 3.6: Issue event service

**Files:**
- Create: `src/core/services/issue-event.ts`

- [ ] **Step 1: Write event service**

- `list(issueId, filter?)` — returns events. Filter supports tab types: 'all', 'comments' (comment_added/edited/deleted), 'state' (state_changed/status_changed), 'pipeline' (stage_started/completed/failed/run_queued). Ordered by timestamp.
- `create(issueId, actor, type, payload)` — append-only insert

This is the internal service. Events are never updated or deleted.

- [ ] **Step 2: Commit**

```bash
git add src/core/services/issue-event.ts
git commit -m "feat: issue event service — append-only audit trail with tab filtering"
```

### Task 3.7: Issue saved view service

**Files:**
- Create: `src/core/services/issue-saved-view.ts`

- [ ] **Step 1: Write saved view service**

- `list(projectId)` — ordered by name
- `create(projectId, { name, filters, sortField, sortOrder, limit, isDefault, createdBy })`
- `update(viewId, fields)`
- `delete(viewId)`
- `setDefault(projectId, viewId)` — sets this view as default, unsets any other default for this project

- [ ] **Step 2: Commit**

```bash
git add src/core/services/issue-saved-view.ts
git commit -m "feat: issue saved view service — persist named filter configurations"
```

### Task 3.8: Update service barrel export + integration tests

**Files:**
- Modify: `src/core/services/index.ts`
- Modify: `src/__tests__/integration/services.test.ts`

- [ ] **Step 1: Update barrel export**

Add exports for all new services.

- [ ] **Step 2: Rewrite issue integration tests**

The test creates an org → user → project, seeds catalogs via the seed script or manual inserts, then tests:
1. Create issue → verify auto-number, verify status set to on_create_key
2. Get by number → verify returns correct issue
3. Transition → verify DB transition lookup works, state_changed event recorded
4. Invalid transition → verify throws
5. Update fields with version → verify optimistic concurrency works
6. Update fields with wrong version → verify 409-style error
7. Add comment → verify commentNumber auto-increment, bodyHtml rendered
8. Edit comment with version → verify editedAt set, audit event recorded
9. Soft-delete comment → verify isDeleted=true, body cleared
10. Close → verify isClosed=true, closedAt set
11. Reopen → verify isClosed=false, closedAt null

- [ ] **Step 3: Run integration tests**

```bash
npx vitest run src/__tests__/integration/services.test.ts
```

All tests should pass against real Supabase.

- [ ] **Step 4: Commit**

```bash
git add src/core/services/index.ts src/__tests__/integration/services.test.ts
git commit -m "feat: integration tests for rich issue model against real Supabase"
```

---

## Phase 4: tRPC Routers

**Checkpoint:** All issue endpoints callable via curl/tRPC panel. Create an issue, get it by number, transition it, add a comment — all via API.

### Task 4.1: Rewrite issue router

**Files:**
- Modify: `src/server/routers/issue.ts`

- [ ] **Step 1: Complete rewrite**

Remove all hardcoded Zod enums (issueState, issuePriority, issueType). Replace with UUID-based inputs. Endpoints:

- `issue.list` — input: projectId + optional filters (isClosed, typeId, stateId, priorityId, assignee, search)
- `issue.getByNumber` — input: projectId + number
- `issue.getById` — input: id
- `issue.create` — input: projectId, title, bodyMd?, typeId, priorityId, assignee?, labels?, author?
- `issue.updateFields` — input: id, version, + optional title/bodyMd/typeId/priorityId/assignee/labels
- `issue.transition` — input: id, toStateId, version
- `issue.stateOverride` — input: id, toStateId, version
- `issue.close` — input: id, version
- `issue.reopen` — input: id, version
- `issue.delete` — input: id
- `issue.bulk` — input: projectId, ids or query, action + value
- `issue.transitions` — input: id (returns valid next states)
- `issue.users` — input: projectId (returns distinct assignee/author values)

- [ ] **Step 2: Commit**

```bash
git add src/server/routers/issue.ts
git commit -m "feat: rewrite issue router — DB-driven, no hardcoded enums"
```

### Task 4.2: Issue catalog router

**Files:**
- Create: `src/server/routers/issue-catalog.ts`

- [ ] **Step 1: Write catalog router**

Nested router structure: `issueCatalog.types.list/create/update/delete`, same for states, statuses, priorities, labels, transitions.

Also: `issueConfig.health` — returns `{ ready: boolean, missing: string[] }` by checking that all required catalogs have at least one active entry and status automation config keys exist.

- [ ] **Step 2: Commit**

```bash
git add src/server/routers/issue-catalog.ts
git commit -m "feat: issue catalog router — CRUD for all catalog types + config health check"
```

### Task 4.3: Comment, attachment, dependency, event, saved view routers

**Files:**
- Create: `src/server/routers/issue-comment.ts`
- Create: `src/server/routers/issue-attachment.ts`
- Create: `src/server/routers/issue-dependency.ts`
- Create: `src/server/routers/issue-event.ts`
- Create: `src/server/routers/issue-saved-view.ts`

- [ ] **Step 1: Write all five routers**

Each follows the same pattern: Zod input validation → call service → return result. Keep routers thin — business logic lives in services.

- [ ] **Step 2: Register all new routers in root.ts**

```typescript
export const appRouter = router({
  organization: organizationRouter,
  project: projectRouter,
  issue: issueRouter,
  issueCatalog: issueCatalogRouter,
  issueComment: issueCommentRouter,
  issueAttachment: issueAttachmentRouter,
  issueDependency: issueDependencyRouter,
  issueEvent: issueEventRouter,
  issueSavedView: issueSavedViewRouter,
  skill: skillRouter,
  persona: personaRouter,
  pipeline: pipelineRouter,
});
```

- [ ] **Step 3: Verify via curl**

Start the dev server and test key endpoints:
```bash
# Create an issue
curl -X POST http://localhost:3000/api/trpc/issue.create -H 'Content-Type: application/json' -d '{"json":{"projectId":"...","title":"Test","typeId":"...","priorityId":"..."}}'

# Get by number
curl 'http://localhost:3000/api/trpc/issue.getByNumber?input={"json":{"projectId":"...","number":1}}'

# List catalogs
curl 'http://localhost:3000/api/trpc/issueCatalog.types.list?input={"json":{"projectId":"..."}}'
```

- [ ] **Step 4: Commit**

```bash
git add src/server/routers/ src/server/root.ts
git commit -m "feat: complete tRPC router layer — issue CRUD, catalogs, comments, attachments, dependencies, events, saved views"
```

---

## Phase 5: Route Reconciliation + UI

**Checkpoint:** User opens browser, navigates to `/[org]/[user]/[project]/issues`, creates an issue, edits it, transitions states, adds a comment. All data-driven from catalog tables.

### Task 5.1: Restructure app routes

**Files:**
- Move: `src/app/dashboard/*` → `src/app/[org]/[user]/[project]/*`
- Modify: `src/app/page.tsx` — redirect to `/default/admin/fluxaos/`
- Modify: `src/lib/resolve-context.ts` — add user resolution
- Modify: `src/components/nav.tsx` — scope links to current org/user/project

- [ ] **Step 1: Create the [org]/[user]/[project] directory structure**

Move all pages from dashboard/ into the new scoped structure. Update all internal Link hrefs to use the scoped pattern.

- [ ] **Step 2: Update resolve-context.ts to resolve org + user + project**

```typescript
export async function resolveContext(orgSlug: string, userSlug: string, projectSlug: string) {
  const { db } = createTRPCContext();
  const orgSvc = createOrganizationService(db);
  const userSvc = createUserService(db);
  const projSvc = createProjectService(db);

  const org = await orgSvc.getBySlug(orgSlug);
  if (!org) notFound();

  const user = await userSvc.getBySlug(org.id, userSlug);
  if (!user) notFound();

  const project = await projSvc.getBySlug(user.id, projectSlug);
  if (!project) notFound();

  return { db, org, user, project };
}
```

- [ ] **Step 3: Update nav.tsx to use scoped links**

The nav reads org/user/project from the URL params and builds all links relative to that context.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: restructure routes to /[org]/[user]/[project]/ for multi-tenancy"
```

### Task 5.2: Rewrite issue list page

**Files:**
- Modify: `src/app/[org]/[user]/[project]/issues/page.tsx`

- [ ] **Step 1: Replace hardcoded enums with catalog queries**

The page fetches catalogs from the API (types, states, priorities) and renders dropdowns from the database values. No hardcoded arrays. Filter state uses catalog IDs, not string enums.

Stage summary cards at top: count per state, from `issueState` catalog. Links to issues filtered by that state.

Issue table shows: #, Title, Type (colored badge), State (colored badge), Priority (colored badge), Created. All badges use colors from catalog tables.

Issue links use `/[org]/[user]/[project]/issues/[number]` (by number, not UUID).

- [ ] **Step 2: Commit**

```bash
git add src/app/[org]/[user]/[project]/issues/page.tsx
git commit -m "feat: issue list page — DB-driven filters, catalog badges, per-project numbering"
```

### Task 5.3: Rewrite issue detail page

**Files:**
- Modify: `src/app/[org]/[user]/[project]/issues/[number]/page.tsx`
- Create or modify: `src/app/[org]/[user]/[project]/issues/[number]/actions.tsx`

- [ ] **Step 1: Server component loads issue by number**

Uses `resolveContext` + `issue.getByNumber` to load the issue. Fetches catalogs for dropdowns.

- [ ] **Step 2: Client component for interactivity**

The actions component handles:
- Editable title (click to edit inline)
- Meta strip: State (dropdown from catalog), Priority (dropdown), Type (dropdown), Assignee (text), Labels. Each field auto-saves via `issue.updateFields` with version.
- Markdown body editor
- Transition buttons: fetches valid transitions from `issue.transitions` endpoint, renders as buttons
- Activity feed: fetches events, renders with tab filter (All, Comments, State, Pipeline)
- Comment editor: markdown input, submit via `issueComment.create`

No hardcoded state/type/priority names anywhere. All dropdowns populated from catalog API responses.

- [ ] **Step 3: Commit**

```bash
git add src/app/[org]/[user]/[project]/issues/
git commit -m "feat: issue detail page — inline editing, DB-driven transitions, activity feed"
```

### Task 5.4: Rewrite issue create page

**Files:**
- Modify: `src/app/[org]/[user]/[project]/issues/new/page.tsx`

- [ ] **Step 1: Replace hardcoded dropdowns with catalog queries**

Fetch types, priorities from catalog API. Render dropdowns from DB values. On submit, call `issue.create` with the selected catalog IDs.

Check config health on load — if catalogs not configured, show error and block creation.

- [ ] **Step 2: Commit**

```bash
git add src/app/[org]/[user]/[project]/issues/new/
git commit -m "feat: issue create page — catalog-driven dropdowns, config health check"
```

### Task 5.5: Update dashboard page

**Files:**
- Modify: `src/app/[org]/[user]/[project]/page.tsx`

- [ ] **Step 1: Replace hardcoded state/priority references**

The dashboard stat cards and issue sidebar currently compare `issue.state === 'open'` and `issue.priority === 'critical'`. Replace with catalog-aware logic: fetch the state catalog, find which states have `isTerminal = false` for "open" count, use priority weights for sorting.

- [ ] **Step 2: Commit**

```bash
git add src/app/[org]/[user]/[project]/page.tsx
git commit -m "feat: dashboard — catalog-driven stat cards and issue sidebar"
```

---

## Phase 6: Verification + Cleanup

**Checkpoint:** User runs nuke-and-seed, opens browser, performs the one-thing test.

### Task 6.1: Run invariant verification

- [ ] **Step 1: Run the verification protocol from CLAUDE.md**

```bash
# All checks from CLAUDE.md verification protocol
```

Fix any violations found.

- [ ] **Step 2: Commit fixes**

### Task 6.2: Nuke, seed, and verify

- [ ] **Step 1: Nuke and seed**

```bash
npx tsx src/core/db/nuke.ts
npx tsx src/core/db/seed.ts
```

- [ ] **Step 2: Start dev server**

```bash
npm run dev
```

- [ ] **Step 3: User verification**

Open browser at `http://localhost:3000`. Navigate to `/default/admin/fluxaos/issues`.

**The one-thing test:** Create an issue. If that works, continue:
1. Edit the title
2. Change the state (dropdown shows DB-driven options)
3. Change the priority
4. Add a comment
5. Edit the comment
6. Soft-delete the comment (verify "comment deleted" placeholder appears)
7. Check activity feed shows all events
8. Verify issue number (#1) in the URL
9. Go back to list, verify issue appears with correct badges
10. Check Supabase dashboard — verify data matches UI

**If any step fails, fix before proceeding.**

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: rich issue model — complete implementation with DB-driven catalogs"
```

---

## Spec Coverage Checklist

| Spec Requirement | Task |
|-----------------|------|
| 5 catalog tables (type, state, status, priority, label) | Task 1.2 |
| Transition table | Task 1.2 |
| Comment table (separate from events) | Task 1.3 |
| Attachment table | Task 1.3 |
| Dependency table | Task 1.3 |
| Saved view table | Task 1.3 |
| Git placeholder tables (branch, PR, commit) | Task 1.4 |
| Issue table overhaul (number, bodyMd, FK refs, version, isClosed) | Task 1.5 |
| Delete hardcoded enums | Task 1.5 |
| Default seed data (types, states, transitions, etc.) | Task 2.1 |
| Nuke-and-seed script | Task 2.2 |
| Status automation config entries | Task 2.1 |
| Issue number generation (FOR UPDATE lock) | Task 3.2 |
| Optimistic concurrency | Task 3.2 |
| DB-driven transition validation | Task 3.2 |
| is_closed denormalization | Task 3.2 |
| Comment soft-delete | Task 3.3 |
| Comment version check | Task 3.3 |
| Body HTML rendered at write time | Task 3.2, 3.3 |
| Attachment CRUD | Task 3.4 |
| Dependency CRUD (both directions) | Task 3.5 |
| Event append-only with tab filtering | Task 3.6 |
| Saved view CRUD + setDefault | Task 3.7 |
| All API endpoints from spec | Task 4.1-4.3 |
| Config health check | Task 4.2 |
| User table + multi-tenancy hierarchy | Task 1.1 |
| Route reconciliation (/[org]/[user]/[project]/) | Task 5.1 |
| Issue list with catalog-driven filters/badges | Task 5.2 |
| Issue detail with inline editing + activity feed | Task 5.3 |
| Issue create with catalog dropdowns | Task 5.4 |
| Dashboard with catalog-driven stats | Task 5.5 |
| Invariant verification | Task 6.1 |
| User verification (one-thing test) | Task 6.2 |
