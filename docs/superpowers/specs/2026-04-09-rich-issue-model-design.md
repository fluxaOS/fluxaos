# Rich Issue Model — Design Specification

**Date:** 2026-04-09
**Status:** DA Reviewed
**Context:** Issues are the heart of fluxaOS. The current simple model (title, description, state, priority, type) is insufficient. This overhaul upgrades to PAT's battle-tested model.
**Reference:** PAT source at `/mnt/dev/pat/src/pat/core/orchestrator/models/issues_native.py`
**DA Review:** Completed 2026-04-09. All 10 recommendations incorporated.

## Why

The current issue model uses hardcoded enums for state, priority, and type. It has no per-project numbering, no markdown, no attachments, no dependencies, no catalog tables, and no state transition graph. This makes it impossible to:
- Configure issue types/states/priorities per project (everything is config)
- Track pipeline stage progression on issues
- Attach design specs and plans to issues
- Model issue-to-issue dependencies (blocking/unblocking)
- Support friendly URLs (#1, #2, #3 instead of UUIDs)

## Schema Changes

### New Tables

#### `issue_type` (catalog, per-project)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| project_id | uuid FK → project | nullable (null = global) |
| key | text | e.g., "bug", "feature", "task", "research" |
| display_name | text | e.g., "Bug", "Feature" |
| description | text | nullable |
| color | text | hex color for UI badges |
| sort_order | integer | display ordering |
| is_active | boolean | soft disable (cannot hard-delete if any issue references it) |
| created_at, updated_at | timestamp | |

Unique constraint: (project_id, key). FK uses RESTRICT on delete — soft-disable via `is_active` instead.

#### `issue_state` (catalog, per-project — maps to pipeline stages)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| project_id | uuid FK → project | nullable (null = global) |
| key | text | e.g., "new", "research", "implement", "review", "rework", "deploy", "complete" |
| display_name | text | |
| description | text | nullable |
| color | text | hex color |
| sort_order | integer | |
| is_terminal | boolean | true for "complete" — issues in terminal state are considered done |
| is_active | boolean | |
| created_at, updated_at | timestamp | |

Unique constraint: (project_id, key). FK uses RESTRICT on delete.

#### `issue_status` (operational status within a stage — NO color column)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| project_id | uuid FK → project | nullable |
| key | text | "open", "queued", "running", "blocked", "completed" |
| display_name | text | |
| description | text | nullable |
| sort_order | integer | |
| is_active | boolean | |
| created_at, updated_at | timestamp | |

Unique constraint: (project_id, key). No `color` column — status is operational/machine-driven, not user-facing badging. (DA Change 3)

#### `issue_priority` (catalog, per-project)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| project_id | uuid FK → project | nullable |
| key | text | "low", "medium", "high", "critical" |
| display_name | text | |
| description | text | nullable |
| color | text | hex color |
| weight | integer | lower = higher priority (for sorting) |
| is_active | boolean | |
| created_at, updated_at | timestamp | |

Unique constraint: (project_id, key). FK uses RESTRICT on delete.

#### `issue_label` (catalog, per-project)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| project_id | uuid FK → project | nullable |
| key | text | |
| display_name | text | |
| description | text | nullable |
| color | text | hex color |
| sort_order | integer | |
| is_active | boolean | |
| created_at, updated_at | timestamp | |

Unique constraint: (project_id, key)

#### `issue_transition` (DB-driven state graph, per-project)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| project_id | uuid FK → project | nullable |
| from_state_id | uuid FK → issue_state | |
| to_state_id | uuid FK → issue_state | |
| description | text | nullable, e.g., "Send back for revision" |
| sort_order | integer | UI ordering of transition options |
| is_active | boolean | |
| created_at, updated_at | timestamp | |

Unique constraint: (project_id, from_state_id, to_state_id)

#### `issue_comment` (separate from events)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| issue_id | uuid FK → issue | |
| comment_number | integer | auto-increment per issue |
| body_md | text | markdown source |
| body_html | text | rendered HTML — rendered at WRITE time, not read time |
| author | text | user email or "system" |
| version | integer | optimistic concurrency, default 1 |
| is_deleted | boolean | soft delete, default false |
| edited_at | timestamp | nullable, set on edit |
| created_at, updated_at | timestamp | |

**Soft-delete behavior (DA Change 8):** When `is_deleted = true`, the API returns `body_md = ''` and `body_html = ''` but still includes the row. The UI renders "comment deleted" in its place. This preserves timeline continuity — hard-deleting creates confusing gaps in the activity feed.

#### `issue_attachment`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| issue_id | uuid FK → issue | |
| file_name | text | original filename |
| content_type | text | MIME type |
| size_bytes | integer | |
| storage_url | text | path/URL to stored file |
| uploaded_by | text | user email |
| created_at, updated_at | timestamp | |

**Storage strategy for alpha:** Data URLs (base64-encoded in `storage_url`) are acceptable for alpha. This will bloat the DB for large files. Post-alpha, migrate to Supabase Storage or S3. This is a known tech debt item, not an oversight.

#### `issue_dependency`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| project_id | uuid FK → project | (DA Change 7) |
| issue_id | uuid FK → issue | the dependent issue |
| depends_on_issue_id | uuid FK → issue | the blocking issue |
| dependency_type | text | default "blocks" |
| is_active | boolean | soft disable |
| created_at, updated_at | timestamp | |

Unique constraint: (project_id, issue_id, depends_on_issue_id). (DA Change 7 — added `project_id` for scoped queries and proper unique constraint.)

**Known limitation:** No cycle detection. Adding `A blocks B` then `B blocks A` is not prevented. This is documented, not an oversight. Cycle detection is deferred.

#### `issue_saved_view` (DA Change 4)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| project_id | uuid FK → project | |
| name | text | e.g., "My Open Bugs" |
| filters | jsonb | saved filter configuration |
| sort_field | text | nullable |
| sort_order | text | "asc" or "desc", nullable |
| limit | integer | nullable |
| is_default | boolean | which view loads on first visit |
| created_by | text | user email |
| created_at, updated_at | timestamp | |

Saved views persist named filter configurations so users don't recreate filters every session. CRUD endpoints are included in the initial build. The Issues list page loads the default view on first visit.

#### `issue_branch` (placeholder — functional in Phase R5)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| issue_id | uuid FK → issue | |
| repo | text | repository name |
| branch_name | text | |
| is_primary | boolean | |
| created_by | text | |
| created_at, updated_at | timestamp | |

UI shows a placeholder panel. No CRUD endpoints until Phase R5.

#### `issue_pull_request` (placeholder — functional in Phase R5)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| issue_id | uuid FK → issue | |
| repo | text | |
| provider | text | e.g., "github" |
| pr_number | integer | |
| pr_url | text | |
| title | text | |
| state | text | "open", "merged", "closed" |
| head_branch | text | |
| base_branch | text | |
| author | text | |
| merged_at | timestamp | nullable |
| closed_at | timestamp | nullable |
| is_primary | boolean | |
| created_at, updated_at | timestamp | |

#### `issue_commit` (placeholder — functional in Phase R5)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| issue_id | uuid FK → issue | |
| repo | text | |
| sha | text | |
| author | text | |
| message | text | |
| committed_at | timestamp | |
| created_at, updated_at | timestamp | |

### Modified Tables

#### `issue` (major overhaul)

**Remove:** `state`, `priority`, `type`, `description` columns (replaced by FK references and body_md)

**Add/change:**

| Column | Type | Notes |
|--------|------|-------|
| number | integer | auto-increment per project, unique(project_id, number) |
| body_md | text | markdown body (replaces description) |
| body_html | text | rendered HTML — rendered at WRITE time, stored |
| state_id | uuid FK → issue_state | pipeline stage (new, research, implement, etc.) |
| status_id | uuid FK → issue_status | operational status (open, queued, running, blocked, completed) |
| type_id | uuid FK → issue_type | |
| priority_id | uuid FK → issue_priority | |
| is_closed | boolean | denormalized lifecycle flag, default false (DA Change 1) |
| assignee | text | nullable, user email |
| labels | jsonb | array of label keys |
| version | integer | optimistic concurrency, default 1 |
| closed_at | timestamp | nullable, set when moved to terminal state |

**Keep:** id, project_id, title, created_by (rename to author), source, created_at, updated_at

**DA Change 1 — `is_closed` column:** When `state_id` changes, check if the new state's `is_terminal` flag is true. If so, set `is_closed = true` and `closed_at = now()`. If transitioning out of a terminal state, set `is_closed = false` and `closed_at = null`. This avoids joining `issue_state` on every list query for lifecycle filtering. Add an index on `(project_id, is_closed)`.

**DA Change 10 — GIN index on `labels`:** Add `CREATE INDEX ON issue USING GIN (labels jsonb_path_ops)` to support label filtering queries.

#### `issue_event` (becomes activity log, not comment storage)

Events are now purely for activity tracking. Comments moved to `issue_comment`.

**Event types:**
- `issue_created` — payload: { author }
- `state_changed` — payload: { from_state, to_state, user }
- `status_changed` — payload: { from_status, to_status, user }
- `fields_updated` — payload: { changes: { field: { from, to } }, user }
- `comment_added` — payload: { comment_id, author }
- `comment_edited` — payload: { comment_id, edited_by }
- `comment_deleted` — payload: { comment_id, deleted_by }
- `dependency_added` — payload: { depends_on_issue_id, dependency_type }
- `dependency_removed` — payload: { depends_on_issue_id }
- `attachment_added` — payload: { attachment_id, file_name, uploaded_by }
- `attachment_removed` — payload: { attachment_id, file_name }
- `branch_linked` — payload: { repo, branch_name }
- `pr_opened` — payload: { repo, pr_number, pr_url }
- `pr_merged` — payload: { repo, pr_number }
- `pr_closed` — payload: { repo, pr_number }
- `commit_linked` — payload: { repo, sha, message }
- `run_queued` — payload: { pipeline_run_id }
- `stage_started` — payload: { stage_name, provider, model }
- `stage_completed` — payload: { stage_name, cost_usd, tokens }
- `stage_failed` — payload: { stage_name, error }

### Remove

- Delete `src/core/issues/types.ts` hardcoded enums (VALID_TRANSITIONS, IssueState, etc.) — replaced by DB-driven catalog + transitions
- Delete `src/core/gates/types.ts` hardcoded GateMode references to issue states — gates will reference issue_state.key

## Status Automation (DA Change 7)

Five `configEntry` rows govern how the pipeline automatically updates issue status. These are seeded when a project is created alongside the issue catalogs.

| Config Key | Default Value | When Applied |
|-----------|---------------|--------------|
| `issues.status.on_create_key` | `"open"` | Issue created |
| `issues.status.on_enqueued_key` | `"queued"` | Pipeline run enqueued for this issue |
| `issues.status.on_running_key` | `"running"` | Pipeline stage starts executing |
| `issues.status.on_blocked_key` | `"blocked"` | Pipeline stage fails or gate holds |
| `issues.status.on_completed_key` | `"completed"` | Pipeline run completes successfully |

The issue creation service reads `issues.status.on_create_key`, resolves it to a `status_id` from the `issue_status` catalog, and sets it on the new issue. The pipeline engine reads the other four keys at the appropriate lifecycle points.

**If a config key is missing or references a nonexistent status:** Fail fast with a clear error. Do not silently skip the status update. This is enforced by the config health check endpoint.

## Default Seed Data

When a project is created, seed these defaults (user can modify all of them):

**Issue Types:** bug (color: #ef4444), feature (color: #3b82f6), task (color: #a855f7), research (color: #22c55e), enhancement (color: #f59e0b)

**Issue States:** new → research → implement → review → rework → deploy → complete (complete is terminal)

**Issue Statuses:** open, queued, running, blocked, completed

**Issue Priorities:** critical (weight 100, color: #ef4444), high (weight 200, color: #f97316), medium (weight 300, color: #eab308), low (weight 400, color: #6b7280)

**Issue Labels:** general (color: #6b7280)

**Default Transitions:**
```
new → research
research → implement
implement → review
implement → research (back-loop)
review → rework
review → deploy
rework → review
deploy → complete
complete → implement (reopen-loop)
```

**Status automation config entries:** (see Status Automation section above)

## Issue Number Generation (DA Change 5)

Per-project auto-increment using `SELECT ... FOR UPDATE` to prevent race conditions:

```sql
SELECT COALESCE(MAX(number), 0) + 1 AS next_number
FROM issue
WHERE project_id = $1
FOR UPDATE
```

This acquires a row-level lock that prevents concurrent inserts from getting the same number. The unique constraint on `(project_id, number)` serves as a safety net.

This gives friendly URLs: `/default/fluxaos/issues/1` instead of UUIDs.

## Optimistic Concurrency

Every `issue` and `issue_comment` update must include `version` in the WHERE clause:
```sql
UPDATE issue SET title = $1, version = version + 1 
WHERE id = $2 AND version = $3
```
If 0 rows affected → someone else edited first → return 409 Conflict.

The tRPC mutation must return the updated entity with the new `version` so subsequent mutations from the same client use the correct version. The UI mutation queue pattern (from PAT's `IssueMetaStrip`) serializes edits to prevent self-conflicting concurrent saves.

## Required API Endpoints (DA Change 6)

### Issue CRUD
- `issue.list` — list with filters (project, lifecycle, type, state, priority, assignee, labels, search)
- `issue.getByNumber` — get by project + number (for URL resolution)
- `issue.getById` — get by UUID (for internal references)
- `issue.create` — create with all fields, returns issue with number
- `issue.updateFields` — PATCH title/body/type/priority/assignee/labels with version check
- `issue.transition` — change state via transition graph, enforces allowed transitions
- `issue.stateOverride` — admin bypass for transition graph (for stuck issues)
- `issue.close` — convenience: transition to first terminal state
- `issue.reopen` — convenience: transition from terminal to first non-terminal state
- `issue.delete` — hard delete (cascades to events, comments, attachments, dependencies)
- `issue.bulk` — bulk operations (set_state, set_type, set_priority, set_assignee, add_labels, remove_labels, close, reopen) with `ids` or `query` selection

### Issue Comments
- `issue.comment.list` — list by issue (includes soft-deleted with empty body)
- `issue.comment.create` — add comment with markdown, renders HTML at write time
- `issue.comment.update` — edit with version check, sets edited_at
- `issue.comment.delete` — soft delete with version check

### Issue Attachments
- `issue.attachment.list` — list by issue
- `issue.attachment.create` — upload (data URL for alpha)
- `issue.attachment.delete` — hard delete

### Issue Dependencies
- `issue.dependency.list` — list by issue (both directions: blocks + blocked-by)
- `issue.dependency.create` — add dependency
- `issue.dependency.delete` — remove dependency

### Issue Events (read-only)
- `issue.event.list` — list by issue, supports tab filtering (all, comments, state, pipeline)

### Catalogs (CRUD for each)
- `issueCatalog.types.list/create/update/delete`
- `issueCatalog.states.list/create/update/delete`
- `issueCatalog.statuses.list/create/update/delete`
- `issueCatalog.priorities.list/create/update/delete`
- `issueCatalog.labels.list/create/update/delete`
- `issueCatalog.transitions.list/create/update/delete`

### Utility Endpoints
- `issue.transitions` — list valid next states for a given issue (DA Change 6)
- `issue.users` — list users for assignee/author dropdowns (DA Change 6)
- `issueConfig.health` — config readiness check, returns `{ ready: bool, missing: [] }` (DA Change 6)
- `issue.savedView.list/create/update/delete/setDefault` — saved filter views

### Queue View (deferred decision)
- `issue.queue` — issues grouped by pipeline stage (kanban view). Include if kanban UI is in scope. Decide before implementation.

## UI Requirements

### Issue List Page
- Stage summary cards at top (count per state, from DB)
- Search bar (title/body)
- Filter tabs: Open, Closed, All
- Saved views dropdown (load/save/delete/set-default)
- Sortable columns: #, Title, Type, State, Priority, Created
- Pagination
- Bulk select + bulk operations (state, type, priority, assignee, labels, close, reopen)

### Issue Detail Page
- Issue number + title (editable inline)
- Meta strip: State, Priority, Type, Labels, Assignee, Author (all editable inline except author, with mutation queue for version safety)
- Markdown body with editor (editable, HTML rendered at write time)
- Right sidebar:
  - Pipeline stages panel (from DB, shows current stage)
  - Dependencies panel (add/remove)
  - Branches/PRs/Commits panel (placeholder UI, shows linked items when available)
  - Attachments panel (upload/download/delete)
- Activity feed with tabs: All, Comments, State, Pipeline
- Rich comment editor with markdown
- State-override button (admin bypass for stuck issues)

### Issue Create Page
- All fields: title, body (markdown), type, priority, assignee, labels
- Config health check on load — block creation if catalogs not configured

## Migration Strategy (DA Change 9)

1. Create all five catalog tables (types, states, statuses, priorities, labels) with no FKs to issue yet
2. Create transition table
3. Seed catalogs and transitions for existing projects
4. Seed status automation config entries (`issues.status.on_*_key`) per project
5. Create new related tables: issue_comment, issue_attachment, issue_dependency, issue_saved_view, issue_branch (placeholder), issue_pull_request (placeholder), issue_commit (placeholder)
6. Add new columns to issue as NULLABLE: number, body_md, body_html, state_id, status_id, type_id, priority_id, is_closed, assignee, labels, version, closed_at
7. Rename `created_by` to `author`
8. **Backfill existing issues (DA Change 9):**
   - Map hardcoded `state` values to `state_id` (open→new, in_progress→implement, blocked→review, closed→complete)
   - Map hardcoded `priority` values to `priority_id`
   - Map hardcoded `type` values to `type_id`
   - Set `status_id` to "open" for all existing issues
   - Copy `description` to `body_md`, render `body_html`
   - Assign sequential `number` per project ordered by `created_at ASC` (use transaction with row-level locking)
   - Set `version = 1` for all existing issues
   - Set `is_closed` based on whether state is terminal
   - Set `labels = '[]'::jsonb`
9. Add NOT NULL constraints on required columns
10. Add unique constraint on (project_id, number)
11. Add GIN index on labels
12. Add index on (project_id, is_closed)
13. Drop old columns: state, priority, type, description
14. Migrate existing `issue_event` comments to `issue_comment` table
15. Update services, tRPC routers, UI

## Known Limitations

- **No dependency cycle detection.** Circular dependencies are not prevented. Documented, not an oversight.
- **Attachment storage via data URLs.** Acceptable for alpha, will bloat DB for large files. Migrate to object storage post-alpha.
- **Git integration tables are placeholders.** Tables exist, UI shows placeholder panels, no CRUD endpoints until Phase R5.
- **Issue number allocation uses `FOR UPDATE` lock.** Under extremely high concurrent creation load, this serializes inserts per project. Acceptable for alpha; migrate to Postgres sequence per project if needed.

## Code Standards

- All catalog tables are per-project scoped (null project_id = global defaults)
- FK constraints use RESTRICT on delete — soft-disable via `is_active`, not hard delete
- Services receive Database via DI (existing pattern)
- No hardcoded enums — everything from DB
- Max ~500 lines per file
- Body HTML rendered at write time, not read time
- Integration tests against real Supabase for all CRUD operations
- Optimistic concurrency on all issue and comment mutations
