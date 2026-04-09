# Rich Issue Model — Design Specification

**Date:** 2026-04-09
**Status:** Approved
**Context:** Issues are the heart of fluxaOS. The current simple model (title, description, state, priority, type) is insufficient. This overhaul upgrades to PAT's battle-tested model.
**Reference:** PAT source at `/mnt/dev/pat/src/pat/core/orchestrator/models/issues_native.py`

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
| is_active | boolean | soft disable |
| created_at, updated_at | timestamp | |

Unique constraint: (project_id, key)

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

Unique constraint: (project_id, key)

#### `issue_status` (operational status within a stage)
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

Unique constraint: (project_id, key)

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

Unique constraint: (project_id, key)

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
| body_html | text | rendered HTML (nullable, can render on read) |
| author | text | user email or "system" |
| version | integer | optimistic concurrency |
| is_deleted | boolean | soft delete |
| edited_at | timestamp | nullable, set on edit |
| created_at, updated_at | timestamp | |

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

#### `issue_dependency`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| project_id | uuid FK → project | |
| issue_id | uuid FK → issue | the dependent issue |
| depends_on_issue_id | uuid FK → issue | the blocking issue |
| dependency_type | text | default "blocks" |
| is_active | boolean | soft disable |
| created_at, updated_at | timestamp | |

Unique constraint: (issue_id, depends_on_issue_id)

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
| body_html | text | rendered HTML |
| state_id | uuid FK → issue_state | pipeline stage (new, research, implement, etc.) |
| status_id | uuid FK → issue_status | operational status (open, queued, running, blocked, completed) |
| type_id | uuid FK → issue_type | |
| priority_id | uuid FK → issue_priority | |
| assignee | text | nullable, user email |
| labels | jsonb | array of label keys |
| version | integer | optimistic concurrency, default 1 |
| closed_at | timestamp | nullable, set when moved to terminal state |

**Keep:** id, project_id, title, created_by (rename to author), source, created_at, updated_at

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

## Default Seed Data

When a project is created, seed these defaults (user can modify all of them):

**Issue Types:** bug, feature, task, research, enhancement
**Issue States:** new → research → implement → review → rework → deploy → complete (complete is terminal)
**Issue Statuses:** open, queued, running, blocked, completed
**Issue Priorities:** critical (weight 100), high (200), medium (300), low (400)
**Issue Labels:** general

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

## Issue Number Generation

Per-project auto-increment. On issue create:
1. Query `SELECT COALESCE(MAX(number), 0) + 1 FROM issue WHERE project_id = $1`
2. Insert with that number
3. Race condition protection via unique constraint on (project_id, number) — retry on conflict

This gives friendly URLs: `/default/fluxaos/issues/1` instead of `/default/fluxaos/issues/764d0ccb-...`

## Optimistic Concurrency

Every `issue` and `issue_comment` update must include `version` in the WHERE clause:
```sql
UPDATE issue SET title = $1, version = version + 1 
WHERE id = $2 AND version = $3
```
If 0 rows affected → someone else edited first → return 409 Conflict.

## UI Requirements

### Issue List Page
- Stage summary cards at top (count per state, from DB)
- Search bar (title/body)
- Filter tabs: Open, Closed, All
- Sortable columns: #, Title, Type, State, Priority, Created
- Pagination

### Issue Detail Page
- Issue number + title (editable inline)
- Meta strip: State, Priority, Type, Labels, Assignee, Author (all editable inline except author)
- Markdown body with editor (editable)
- Right sidebar:
  - Pipeline stages panel (from DB, shows current stage)
  - Dependencies panel (add/remove)
  - Branches/PRs/Commits panel (placeholder, shows linked items)
  - Attachments panel (upload/download/delete)
- Activity feed with tabs: All, Comments, State, Pipeline
- Rich comment editor with markdown

### Issue Create Page
- All fields: title, body (markdown), type, priority, assignee, labels

## Migration Strategy

1. Add new catalog tables (issue_type, issue_state, etc.)
2. Add new columns to issue table (number, body_md, state_id, etc.)
3. Migrate existing issues: map old hardcoded values to new catalog IDs
4. Add new related tables (issue_comment, issue_attachment, issue_dependency, etc.)
5. Remove old columns (state, priority, type, description)
6. Update services, tRPC routers, UI

## Code Standards

- All catalog tables are per-project scoped (null project_id = global defaults)
- Services receive Database via DI (existing pattern)
- No hardcoded enums — everything from DB
- Max ~500 lines per file
- Integration tests against real Supabase for all CRUD operations
