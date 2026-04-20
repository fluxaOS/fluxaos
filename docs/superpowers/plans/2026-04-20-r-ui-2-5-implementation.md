# R-UI-2.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three R-UI-2 audit findings by extracting `ActivityFeed` out of the 880-line issue detail client, subscribing it to Supabase Realtime, and deleting `RunDetailModal`'s redundant 2-second poll.

**Architecture:** One new client-side component colocated with the issue detail page. Realtime is resolved via `registry.get<RealtimeProvider>('realtime')` inside a `useEffect` — the pattern already used by `RunDetailModal.tsx` and `LiveOutput.tsx` on `main`. No new ports, no new adapters, no schema changes. Issue-ID filtering happens client-side in the subscription callback (the port's `subscribeToTable` signature has no filter parameter).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, tRPC v11 client, Supabase Realtime (via existing `SupabaseRealtimeProvider` adapter from R-REM-W2), Playwright.

**Supersedes:** `docs/superpowers/specs/2026-04-16-r-ui-2-design.md` and `docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md` (tasks 12–32; the paused branch `feat/r-ui-2-impl` is retired in Task 1 below).

**Design spec:** `docs/superpowers/specs/2026-04-20-r-ui-2-disposition-and-w3-decomposition-design.md`.

---

## File Map

### New files

| File | Responsibility |
|---|---|
| `src/app/[org]/[user]/[project]/issues/[number]/ActivityFeed.tsx` | Issue activity feed: `events` + `comments` queries, Realtime subscription to `issue_event`, comment form, edit/delete mutations, filter chips, `CommentCard` sub-component. Self-contained; receives `issueId`, `basePath`, and catalog items (`states`, `types`, `priorities`) as props. |
| `e2e/activity-feed-realtime.spec.ts` | Playwright smoke: posting a comment causes the activity feed to update without manual refresh; no `pageerror`; no known-pattern console errors. |

### Modified files

| File | Change |
|---|---|
| `src/app/[org]/[user]/[project]/issues/[number]/client.tsx` | Remove the activity-feed JSX block (lines ~692–801), the `EventFilter` type (line 307), the `eventFilter` + `commentBody` state (lines 321–322), the `eventsQuery` + `commentsQuery` + comment mutations (lines 342–406), the `events`/`comments` unpacking (lines 356–357), the `CommentCard` helper (lines 182–303), and `formatEvent` (line 838+). Import the new `ActivityFeed` and render it where the activity block lived. Remove `MessageSquare`, `Pencil`, `Trash2` from the `lucide-react` import if they are only used by the removed code. Drop `eventsQuery.refetch()` from the `refetchIssue()` helper since the realtime subscription handles this. |
| `src/components/pipeline/RunDetailModal.tsx` | Delete the `refetchInterval` block at lines 60–63 inside the `trpc.pipeline.runs.get.useQuery` options. The existing realtime subscription at lines 124–140 already refetches on `stage_run` change. |
| `docs/superpowers/specs/2026-04-16-r-ui-2-design.md` | Prepend a one-block terminal-state note. |
| `docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md` | Prepend a one-block terminal-state note. |
| `docs/superpowers/deferred-fixes.md` | Strike through two resolved entries; annotate one partially-deferred entry. |
| `docs/superpowers/roadmap.md` | Flip R-UI-2 row to retired status; insert R-UI-2.5 row; update What's Next item 2. |

### Deleted remote branch

`feat/r-ui-2-impl` — deleted after PR merges (retired, not archived to subdirectory). Local branch also deleted.

---

## Task 1: Create feature branch and append terminal-state notes to retired R-UI-2 docs

**Files:**
- Modify: `docs/superpowers/specs/2026-04-16-r-ui-2-design.md`
- Modify: `docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md`

- [ ] **Step 1: Create branch**

Run:
```bash
git checkout main
git pull --ff-only origin main
git checkout -b feat/r-ui-2-5-realtime-remnant
```

Expected: on `feat/r-ui-2-5-realtime-remnant`, tracking nothing.

- [ ] **Step 2: Prepend terminal-state note to R-UI-2 design spec**

Open `docs/superpowers/specs/2026-04-16-r-ui-2-design.md`. Insert at the very top of the file (before the first line), a blockquote that states:

```markdown
> **Status (2026-04-20) — SUPERSEDED.** Tasks 1–11 shipped via R-REM-W1/W2 against a different file structure. Tasks 12–32 superseded by R-UI-2.5 (`docs/superpowers/specs/2026-04-20-r-ui-2-disposition-and-w3-decomposition-design.md`, `docs/superpowers/plans/2026-04-20-r-ui-2-5-implementation.md`). Orchestrator-rewire tasks (14–22) are permanently deferred — their target files (`stage-worker.ts`, `orchestrator/index.ts`, `output-parser.ts`) were deleted or relocated in W1/W2. Branch `feat/r-ui-2-impl` archived; do not resume.

---

```

(The `---` is a horizontal rule separating the note from the original content.)

- [ ] **Step 3: Prepend terminal-state note to R-UI-2 plan**

Open `docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md`. Insert the same blockquote at the top, verbatim.

- [ ] **Step 4: Commit**

Run:
```bash
git add docs/superpowers/specs/2026-04-16-r-ui-2-design.md docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md
git commit -m "docs(r-ui-2): append terminal-state note — superseded by R-UI-2.5"
```

Expected: commit succeeds, pre-commit hook passes.

---

## Task 2: Create ActivityFeed component with comment form, events list, mutations

**Files:**
- Create: `src/app/[org]/[user]/[project]/issues/[number]/ActivityFeed.tsx`

- [ ] **Step 1: Create the file with full contents**

Create `src/app/[org]/[user]/[project]/issues/[number]/ActivityFeed.tsx` with the code below. This is a direct lift of the Activity feed + Comment box + Comments list JSX from `client.tsx:692–801`, the `CommentCard` helper from `client.tsx:182–303`, the `formatEvent` helper (see Step 2 — copy from client.tsx), the `EventFilter` type (`client.tsx:307`), the relevant queries and mutations (`client.tsx:342–406`), and the `commentBody` + `eventFilter` state — with no behavior changes other than the subscription being added in Task 3.

```tsx
'use client';

import { useState, useEffect } from 'react';
import { MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { Card } from '@/components/card';
import { trpc } from '@/lib/trpc/client';
import { registry } from '@/config/registry';
import type { RealtimeProvider, RealtimeTableEvent } from '@/core/ports/realtime';

// ─── Types ──────────────────────────────────────────────────────────────────

type EventFilter = 'all' | 'comments' | 'state';

type CatalogItem = { id: string; displayName: string; color: string };

interface Catalogs {
  states: CatalogItem[];
  types: CatalogItem[];
  priorities: CatalogItem[];
}

interface IssueEventRow {
  issueId: string;
}

// ─── Comment card with edit / delete ────────────────────────────────────────

function CommentCard({
  comment,
  onUpdate,
  onDelete,
  isMutating,
}: {
  comment: {
    id: string;
    bodyMd: string;
    bodyHtml: string | null;
    author: string;
    createdAt: string;
    editedAt: string | null;
    isDeleted: boolean;
    version: number;
  };
  onUpdate: (bodyMd: string) => void;
  onDelete: () => void;
  isMutating: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.bodyMd);

  if (comment.isDeleted) {
    return (
      <Card hover={false} padding="p-4">
        <p className="text-sm text-slate-600 italic">Comment deleted</p>
      </Card>
    );
  }

  if (editing) {
    return (
      <Card hover={false} padding="p-4">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          disabled={isMutating}
          className="w-full bg-slate-900 border border-slate-700/60 rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-electric-violet/30 resize-y mb-3"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              const trimmed = draft.trim();
              if (trimmed && trimmed !== comment.bodyMd) {
                onUpdate(trimmed);
              }
              setEditing(false);
            }}
            disabled={isMutating}
            className="px-3 py-1.5 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-all"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(comment.bodyMd);
              setEditing(false);
            }}
            className="px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 text-xs rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card hover={false} padding="p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-300">{comment.author}</span>
          <span className="text-[11px] text-slate-600">
            {new Date(comment.createdAt).toLocaleString()}
          </span>
          {comment.editedAt && (
            <span className="text-[11px] text-slate-600 italic">(edited)</span>
          )}
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => {
              setDraft(comment.bodyMd);
              setEditing(true);
            }}
            disabled={isMutating}
            className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] rounded-md transition-colors disabled:opacity-50"
            title="Edit comment"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('Delete this comment?')) onDelete();
            }}
            disabled={isMutating}
            className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-white/[0.06] rounded-md transition-colors disabled:opacity-50"
            title="Delete comment"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {/* bodyHtml is server-rendered from markdown at write time (invariant #14) */}
      {comment.bodyHtml ? (
        <div
          className="text-sm text-slate-400 prose prose-invert prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: comment.bodyHtml }}
        />
      ) : (
        <p className="text-sm text-slate-400 whitespace-pre-wrap">{comment.bodyMd}</p>
      )}
    </Card>
  );
}

// ─── Main activity feed ─────────────────────────────────────────────────────

export function ActivityFeed({
  issueId,
  catalogs,
}: {
  issueId: string;
  catalogs: Catalogs;
}) {
  const [eventFilter, setEventFilter] = useState<EventFilter>('all');
  const [commentBody, setCommentBody] = useState('');
  const { states, types, priorities } = catalogs;

  const eventsQuery = trpc.issue.event.list.useQuery(
    { issueId, filter: eventFilter === 'all' ? undefined : eventFilter },
    { enabled: !!issueId },
  );

  const commentsQuery = trpc.issue.comment.list.useQuery(
    { issueId },
    { enabled: !!issueId },
  );

  const events = eventsQuery.data ?? [];
  const comments = commentsQuery.data ?? [];

  const createComment = trpc.issue.comment.create.useMutation({
    onSuccess: () => {
      setCommentBody('');
      commentsQuery.refetch();
      // eventsQuery refetches via Realtime subscription below
    },
  });

  const updateComment = trpc.issue.comment.update.useMutation({
    onSuccess: () => {
      commentsQuery.refetch();
    },
  });

  const deleteComment = trpc.issue.comment.delete.useMutation({
    onSuccess: () => {
      commentsQuery.refetch();
    },
  });

  // Realtime: refetch events when any issue_event row changes for THIS issue.
  // The RealtimeProvider port on main does not accept a filter param, so we
  // filter client-side by matching issueId in the payload. See the design doc
  // for R-UI-2.5 for the rationale.
  useEffect(() => {
    if (!issueId) return;
    const realtime = registry.get<RealtimeProvider>('realtime');
    const unsubscribe = realtime.subscribeToTable<IssueEventRow>(
      `activity-feed-${issueId}`,
      'issue_event',
      '*',
      (payload: RealtimeTableEvent<IssueEventRow>) => {
        const rowIssueId = payload.new?.issueId ?? payload.old?.issueId;
        if (rowIssueId === issueId) {
          eventsQuery.refetch();
        }
      },
    );
    return () => {
      unsubscribe();
    };
  }, [issueId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* Activity feed */}
      <div data-testid="activity-feed">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-400">Activity</h3>
          <div className="flex gap-1">
            {(['all', 'comments', 'state'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setEventFilter(f)}
                className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${
                  eventFilter === f
                    ? 'bg-electric-violet/20 text-soft-violet font-semibold'
                    : 'text-slate-500 hover:bg-white/[0.04]'
                }`}
              >
                {f === 'all' ? 'All' : f === 'comments' ? 'Comments' : 'State'}
              </button>
            ))}
          </div>
        </div>

        {events.length === 0 ? (
          <p className="text-sm text-slate-600">No activity yet.</p>
        ) : (
          <div className="relative pl-6">
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-700/30" />
            <div className="space-y-0">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="relative flex items-start gap-3 py-2.5"
                >
                  <div className="absolute left-[-19px] top-3.5 w-2.5 h-2.5 rounded-full bg-slate-700 border-2 border-slate-800" />
                  <span className="text-[11px] text-slate-600 font-mono whitespace-nowrap mt-0.5">
                    {new Date(event.timestamp).toLocaleString()}
                  </span>
                  <span className="text-sm text-slate-300">
                    {formatEvent(event.type, event.payload as Record<string, unknown>, { states, types, priorities })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Comment box */}
      <Card hover={false} padding="p-5">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare size={14} className="text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-400">Add Comment</h3>
        </div>
        <textarea
          value={commentBody}
          onChange={(e) => setCommentBody(e.target.value)}
          rows={3}
          placeholder="Write a comment (Markdown)..."
          className="w-full bg-slate-900 border border-slate-700/60 rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-electric-violet/30 resize-y mb-3"
        />
        <button
          type="button"
          onClick={() => {
            if (!commentBody.trim()) return;
            createComment.mutate({
              issueId,
              bodyMd: commentBody.trim(),
              author: 'user',
            });
          }}
          disabled={!commentBody.trim() || createComment.isPending}
          className="px-4 py-2 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all shadow-[0_4px_16px_rgba(124,58,237,0.3)]"
        >
          {createComment.isPending ? 'Posting...' : 'Post Comment'}
        </button>
        {createComment.error && (
          <p className="mt-2 text-sm text-red-400">{createComment.error.message}</p>
        )}
      </Card>

      {/* Comments list */}
      {comments.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-400">
            Comments ({comments.length})
          </h3>
          {comments.map((c) => (
            <CommentCard
              key={c.id}
              comment={{ ...c, bodyMd: c.bodyMd ?? '', author: c.author ?? 'unknown' }}
              onUpdate={(bodyMd) =>
                updateComment.mutate({
                  commentId: c.id,
                  bodyMd,
                  editedBy: 'user',
                  version: c.version,
                })
              }
              onDelete={() =>
                deleteComment.mutate({
                  commentId: c.id,
                  deletedBy: 'user',
                  version: c.version,
                })
              }
              isMutating={updateComment.isPending || deleteComment.isPending}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  priorityId: 'Priority',
  typeId: 'Type',
  stateId: 'State',
  title: 'Title',
  bodyMd: 'Description',
  assignee: 'Assignee',
};

function catalogName(id: unknown, items: CatalogItem[]): string {
  if (typeof id !== 'string') return String(id ?? '');
  const match = items.find((i) => i.id === id);
  return match ? match.displayName : String(id);
}

function formatEvent(
  type: string,
  payload: Record<string, unknown>,
  catalogs: Catalogs,
): string {
  // Copied verbatim from client.tsx:838+ in Task 2. Task 3 removes the original.
  // PLACEHOLDER for formatEvent body — copy the full function from the source
  // file when executing this task. The function signature above is fixed.
  return describeEvent(type, payload, catalogs);
}

function describeEvent(
  type: string,
  payload: Record<string, unknown>,
  catalogs: Catalogs,
): string {
  const { states, types, priorities } = catalogs;
  if (type === 'state_changed' || type === 'state_transitioned') {
    const from = catalogName(payload.fromStateId, states);
    const to = catalogName(payload.toStateId, states);
    return `State changed from ${from} to ${to}`;
  }
  if (type === 'field_updated') {
    const field = String(payload.field ?? 'field');
    const label = FIELD_LABELS[field] ?? field;
    if (field === 'priorityId') {
      return `Priority set to ${catalogName(payload.toValue, priorities)}`;
    }
    if (field === 'typeId') {
      return `Type set to ${catalogName(payload.toValue, types)}`;
    }
    if (field === 'stateId') {
      return `State set to ${catalogName(payload.toValue, states)}`;
    }
    return `${label} updated`;
  }
  if (type === 'comment_added') {
    return `Comment added`;
  }
  if (type === 'comment_edited') {
    return `Comment edited`;
  }
  if (type === 'comment_deleted') {
    return `Comment deleted`;
  }
  return type;
}
```

> **Executor note on `formatEvent`:** the placeholder above calls `describeEvent` which covers every event type the existing UI formats. Before moving on to Step 3, open `src/app/[org]/[user]/[project]/issues/[number]/client.tsx` at the current `formatEvent` definition (grep for `function formatEvent(`), compare it to `describeEvent` above. If the source file's `formatEvent` has branches `describeEvent` above lacks, extend `describeEvent` to match. If they are equivalent, **delete the `formatEvent` wrapper and rename `describeEvent` to `formatEvent`** — having both is dead indirection.

- [ ] **Step 2: Reconcile formatEvent with the source file's implementation**

Grep for the source `formatEvent`:

```bash
grep -n "^function formatEvent" src/app/\[org\]/\[user\]/\[project\]/issues/\[number\]/client.tsx
```

Open the line printed and read the full function body (to the next `^}` at column 0). Compare against `describeEvent` in the new file. If branches are missing in `describeEvent`, add them. When behavior matches, delete `formatEvent` from `ActivityFeed.tsx` and rename `describeEvent` → `formatEvent`.

- [ ] **Step 3: Typecheck**

Run:
```bash
npx tsc --noEmit
```

Expected: clean. `ActivityFeed.tsx` has no diagnostics. `client.tsx` still compiles (it has not been modified yet — the duplicate symbols in `ActivityFeed.tsx` don't conflict because they are local to that file).

- [ ] **Step 4: Commit**

Run:
```bash
git add src/app/\[org\]/\[user\]/\[project\]/issues/\[number\]/ActivityFeed.tsx
git commit -m "feat(issue-detail): extract ActivityFeed component

Prepares for AUDIT-003 file-size split: lifts the activity-feed
JSX, comment form, comment list, CommentCard, and formatEvent into
a colocated component. client.tsx is edited in the next commit to
consume it.

No behavior change yet; the new component is orphan code until
Task 3 wires it in.

Realtime subscription to issue_event table added with client-side
issueId filtering (the RealtimeProvider port has no filter param).
Invalidates eventsQuery on any matching row change — replaces the
manual eventsQuery.refetch() calls that previously lived in comment
mutation success handlers.

Part of R-UI-2.5 (resolves AUDIT-003 enabler, AUDIT-012)."
```

Expected: pre-commit hook passes (new file is under 500 lines).

---

## Task 3: Wire ActivityFeed into client.tsx and remove the extracted code

**Files:**
- Modify: `src/app/[org]/[user]/[project]/issues/[number]/client.tsx`

- [ ] **Step 1: Add the import**

At the top of `client.tsx`, after the existing component imports, add:

```tsx
import { ActivityFeed } from './ActivityFeed';
```

- [ ] **Step 2: Remove the `CommentCard` helper (lines ~182–303)**

Delete the entire `function CommentCard({ ... }) { ... }` definition. `CommentCard` now lives only in `ActivityFeed.tsx`.

- [ ] **Step 3: Remove the `EventFilter` type (line ~307)**

Delete the line `type EventFilter = 'all' | 'comments' | 'state';` and its preceding comment banner `// ─── Activity feed filter ───`. The type is local to `ActivityFeed.tsx` now.

- [ ] **Step 4: Remove activity-feed state in `IssueDetailClient`**

In the `IssueDetailClient` body (starting line ~311), delete these two lines:

```tsx
const [eventFilter, setEventFilter] = useState<EventFilter>('all');
const [commentBody, setCommentBody] = useState('');
```

Keep `const [activeRunId, setActiveRunId] = useState<string | null>(null);` — that's unrelated.

- [ ] **Step 5: Remove `eventsQuery` and `commentsQuery`**

Delete the blocks:

```tsx
const eventsQuery = trpc.issue.event.list.useQuery(
  { issueId: issue?.id ?? '', filter: eventFilter === 'all' ? undefined : eventFilter },
  { enabled: !!issue?.id },
);

const commentsQuery = trpc.issue.comment.list.useQuery(
  { issueId: issue?.id ?? '' },
  { enabled: !!issue?.id },
);
```

Also delete from the unpacking block:

```tsx
const events = eventsQuery.data ?? [];
const comments = commentsQuery.data ?? [];
```

- [ ] **Step 6: Remove the comment mutations**

Delete the three mutation blocks `createComment`, `updateComment`, `deleteComment` (entire `useMutation(...)` calls).

- [ ] **Step 7: Drop `eventsQuery.refetch()` from `refetchIssue()`**

In the helper:

```tsx
function refetchIssue() {
  issueQuery.refetch();
  transitionsQuery.refetch();
  eventsQuery.refetch();
}
```

Delete the line `eventsQuery.refetch();`. The ActivityFeed subscription handles refreshes now.

- [ ] **Step 8: Replace the activity-feed JSX with `<ActivityFeed />`**

Find the big block starting with `{/* Activity feed */}` and ending with the closing `)}` of the comments list (approximately lines 692–801 before edits). Replace the entire block (including the `{/* Activity feed */}`, `{/* Comment box */}`, `{/* Comments list */}` regions) with:

```tsx
<ActivityFeed
  issueId={issue.id}
  catalogs={{ states, types, priorities }}
/>
```

Indentation should match the surrounding JSX.

- [ ] **Step 9: Remove unused helpers and imports**

Delete the `FIELD_LABELS` const, `catalogName` function, and `formatEvent` function (lines ~816+). They're now only referenced inside `ActivityFeed.tsx`.

Remove from `lucide-react` imports any icons that are no longer used: specifically `MessageSquare`, `Pencil`, `Trash2`. Keep `ArrowLeft`, `Clock`, `GitBranch`, and `Play` (still used by the remaining JSX). Open the file's current imports and verify before deleting.

- [ ] **Step 10: Typecheck**

Run:
```bash
npx tsc --noEmit
```

Expected: clean. If it errors with "X is defined but never used" on `formatEvent` / `catalogName` / `FIELD_LABELS`, you missed a deletion in Step 9.

- [ ] **Step 11: Verify file length**

Run:
```bash
wc -l src/app/\[org\]/\[user\]/\[project\]/issues/\[number\]/client.tsx
```

Expected: **≤ 500** lines. If over, the extraction was incomplete — re-read the file, find what's still there from the old activity feed slice, and remove it.

- [ ] **Step 12: Run integration tests**

Run:
```bash
npx vitest run
```

Expected: 122 passing, 0 failing (matches `main` baseline from R-REM-W2 closeout).

- [ ] **Step 13: Commit**

Run:
```bash
git add src/app/\[org\]/\[user\]/\[project\]/issues/\[number\]/client.tsx
git commit -m "refactor(issue-detail): consume ActivityFeed; drop duplicate state/queries

Removes the extracted slice (activity-feed JSX, CommentCard,
formatEvent, eventsQuery, commentsQuery, comment mutations,
eventFilter + commentBody state) from the 880-line client
component. Renders <ActivityFeed /> in its place.

client.tsx size drops from 880 → ≤500 lines, resolving AUDIT-003.

Removes eventsQuery.refetch() from refetchIssue() helper — the
ActivityFeed's Realtime subscription handles event refreshes.

Part of R-UI-2.5 (resolves AUDIT-003, AUDIT-012)."
```

Expected: pre-commit hook passes without size-exemption warnings on `client.tsx`.

---

## Task 4: Remove `refetchInterval` from `RunDetailModal`

**Files:**
- Modify: `src/components/pipeline/RunDetailModal.tsx:60-63`

- [ ] **Step 1: Open the file and locate the poll**

Open `src/components/pipeline/RunDetailModal.tsx` and find the `trpc.pipeline.runs.get.useQuery` call. Current shape:

```tsx
const runQuery = trpc.pipeline.runs.get.useQuery(
  { id: runId! },
  {
    enabled: isOpen,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'running' || status === 'queued' ? 2000 : false;
    },
  },
);
```

- [ ] **Step 2: Delete the `refetchInterval` key**

Replace the block with:

```tsx
const runQuery = trpc.pipeline.runs.get.useQuery(
  { id: runId! },
  {
    enabled: isOpen,
  },
);
```

The existing `useEffect` at lines 123–140 continues to call `runQuery.refetch()` on `stage_run` realtime events — that covers the live-update behavior the poll was doing.

- [ ] **Step 3: Typecheck**

Run:
```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Run integration tests**

Run:
```bash
npx vitest run
```

Expected: 122 passing.

- [ ] **Step 5: Commit**

Run:
```bash
git add src/components/pipeline/RunDetailModal.tsx
git commit -m "fix(run-detail-modal): drop 2s refetchInterval — Realtime is the mechanism

Resolves AUDIT-005 (live invariant-9 violation on main). The
modal's existing useEffect subscription on stage_run via the
registry-resolved RealtimeProvider already triggers runQuery
refetches on status change. The parallel refetchInterval was a
belt-and-suspenders fallback that R-UI-2 spec principle 7
(\"Realtime, no fallbacks\") explicitly forbids.

Part of R-UI-2.5 (resolves AUDIT-005)."
```

Expected: pre-commit hook passes.

---

## Task 5: Playwright smoke — activity feed refreshes without manual action

**Files:**
- Create: `e2e/activity-feed-realtime.spec.ts`

- [ ] **Step 1: Write the test**

Create `e2e/activity-feed-realtime.spec.ts`:

```typescript
// e2e/activity-feed-realtime.spec.ts
// R-UI-2.5 smoke: posting a comment causes the activity feed to
// reflect the new comment_added event without a manual page refresh,
// and no console/pageerror fires.
import { test, expect, projectPath } from './helpers/setup';

test.describe('@r-ui-2-5 @smoke', () => {
  test('activity feed updates without manual refresh after posting a comment', async ({ page }) => {
    const pageErrors: Error[] = [];
    const consoleErrors: string[] = [];

    page.on('pageerror', (err) => pageErrors.push(err));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Issue #3 is the only open issue in the seed ("Testing a new issue to edit comment").
    await page.goto(projectPath('/issues/3'));

    // Wait for the activity feed to render.
    const feed = page.getByTestId('activity-feed');
    await expect(feed).toBeVisible({ timeout: 15_000 });

    // Count current activity items. Works whether the feed is empty ("No
    // activity yet.") or populated — we record the baseline, add a comment,
    // and assert the count grew without touching the browser.
    const initialCount = await feed.locator('.relative.flex.items-start').count();

    // Type a unique comment body so we can verify it lands.
    const marker = `smoke-test-${Date.now()}`;
    const textarea = page.getByPlaceholder('Write a comment (Markdown)...');
    await textarea.fill(marker);
    await page.getByRole('button', { name: /^Post Comment$/ }).click();

    // Wait for the new event to appear in the feed WITHOUT any page.reload().
    // The Realtime subscription is responsible for this.
    await expect.poll(
      async () => feed.locator('.relative.flex.items-start').count(),
      {
        timeout: 15_000,
        message: 'Activity feed did not update after posting a comment. Realtime subscription may be broken.',
      },
    ).toBeGreaterThan(initialCount);

    // Known failure patterns we care about:
    const knownErrorPattern = /Adapter ".*" is not registered|Missing required environment variable|Missing Supabase config/;
    const matchedErrors = consoleErrors.filter((e) => knownErrorPattern.test(e));

    expect(pageErrors, `Unexpected pageerror(s): ${pageErrors.map((e) => e.message).join('; ')}`).toHaveLength(0);
    expect(matchedErrors, `Unexpected registry/env errors: ${matchedErrors.join('; ')}`).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Start the dev server (if not already running)**

In a separate terminal:
```bash
FLUXAOS_LAN_AUTH_BYPASS=1 npm run dev -- -p 3000
```

Wait for "Ready" line. If port 3000 is taken, set `PLAYWRIGHT_BASE_URL=http://localhost:3001` (or whatever port) before running the test.

- [ ] **Step 3: Run the test — verify it passes**

```bash
npx playwright test e2e/activity-feed-realtime.spec.ts
```

Expected: 1 passed. If it fails with "Activity feed did not update after posting a comment," the Realtime subscription in `ActivityFeed.tsx` is not wired correctly — re-read Task 2 Step 1 and verify the `useEffect`, the channel name, and the callback.

If it fails with a registry/env error, that's a regression in `bootstrap-client.ts` — unrelated to R-UI-2.5 and indicates `main` is broken.

- [ ] **Step 4: Run the existing smoke too, to make sure nothing regressed**

```bash
npx playwright test e2e/run-stage-smoke.spec.ts
```

Expected: 1 passed. If it fails, Task 4's poll removal may have broken `RunDetailModal`'s live update — unlikely since the Realtime subscription existed before, but verify.

- [ ] **Step 5: Commit**

Run:
```bash
git add e2e/activity-feed-realtime.spec.ts
git commit -m "test(e2e): activity feed updates via Realtime without manual refresh

Regression guard for R-UI-2.5. Posts a unique comment, asserts the
activity feed row count grows without page.reload(). Also asserts
no pageerror and no registry/env-var console errors.

Part of R-UI-2.5."
```

Expected: pre-commit hook passes.

---

## Task 6: Full verification — tsc + vitest + verify + lint + build

**Files:** (none modified)

- [ ] **Step 1: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean (zero errors).

- [ ] **Step 2: Integration tests**

```bash
npx vitest run
```

Expected: 122 passing, 0 failing.

- [ ] **Step 3: Verify**

```bash
npm run verify
```

Expected: 10/10 checks pass on a fresh seed. If this fails, run `tsx src/scripts/db/nuke.ts && npm run db:seed` first and retry.

- [ ] **Step 4: Lint**

```bash
npm run lint
```

Expected: same 54-problem baseline as `main` (per R-REM-W2 closeout handoff). If this session introduced new problems, fix them before moving on — do not add to the baseline.

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: compiles cleanly. Watch for any warnings about the client-bundle size near pages that include `ActivityFeed.tsx` — the new component should be small enough to be invisible in bundle diffs.

- [ ] **Step 6: Commit verification summary as handoff note (if any evidence worth preserving)**

No commit required if everything passes clean. If one of the gates has surprising output worth recording, create a short `docs/superpowers/handoffs/YYYY-MM-DD-r-ui-2-5-verification.md` with the summary and commit it — otherwise skip to Task 7.

---

## Task 7: Update deferred-fixes.md

**Files:**
- Modify: `docs/superpowers/deferred-fixes.md`

- [ ] **Step 1: Strike through "UI: Issue activity feed doesn't auto-refresh via Realtime"**

Find the section starting with `## UI: Issue activity feed doesn't auto-refresh via Realtime`. Change the heading to:

```markdown
## ~~UI: Issue activity feed doesn't auto-refresh via Realtime~~ — RESOLVED (R-UI-2.5)
```

Append a line under the existing content:

```markdown
**Resolved:** 2026-04-20 in R-UI-2.5 (PR #TBD) — `ActivityFeed.tsx` subscribes to `issue_event` table via `registry.get<RealtimeProvider>('realtime')` and refetches the events query on any matching row change. Replaces manual `eventsQuery.refetch()` calls in comment mutation success handlers.
```

(Replace `#TBD` with the actual PR number after it opens in Task 9.)

- [ ] **Step 2: Strike through "Adapter: RealtimeProvider not implemented"**

Find the section starting with `## Adapter: RealtimeProvider not implemented`. Change the heading to:

```markdown
## ~~Adapter: RealtimeProvider not implemented~~ — RESOLVED (R-REM-W2, back-filled)
```

Append under the existing content:

```markdown
**Resolved:** 2026-04-19 in R-REM-W2 (PR #43) — `SupabaseRealtimeProvider` adapter shipped at `src/adapters/supabase/realtime.ts`, registered in both `bootstrap.ts` and `bootstrap-client.ts`. Consumers resolve it via `registry.get<RealtimeProvider>('realtime')`. Back-fill note: this entry should have been struck when W2 merged; captured during R-UI-2.5.
```

- [ ] **Step 3: Annotate "UI: Pipeline detail modal duration doesn't update in real-time"**

Find `## UI: Pipeline detail modal duration doesn't update in real-time`. Leave the heading alone. Append under the existing content:

```markdown
**Update (2026-04-20, R-UI-2.5):** The Realtime subscription to `stage_run` landed in R-REM-W2 and covers status-driven refetches (which refresh end-times once the run terminates). What remains open is only the live elapsed-duration tick while a run is in progress — that's the `useNow` hook from the retired R-UI-2 plan, explicitly deferred from R-UI-2.5 scope. No further action until a separate phase picks it up.
```

- [ ] **Step 4: Re-evaluate "UI: Activity feed does not show correctly"**

Find `## UI: Activity feed does not show correctly`. Manually exercise the activity feed in a browser — open an issue, post a comment, edit a state field, observe event list rendering. If behavior is correct (no garbled output, no missing events, no bad timestamps):

- Change heading to `## ~~UI: Activity feed does not show correctly~~ — RESOLVED (R-UI-2.5, incidental)`.
- Append: `**Resolved:** 2026-04-20 in R-UI-2.5 (PR #TBD) — rendering verified correct during post-extraction manual browser check. The original ambiguous repro did not recur; likely fixed incidentally by the activity-feed extraction or by upstream fixes in R-REM-W2.`

If behavior is still wrong in any way, leave the heading alone and append a tighter repro note:
- `**Update (2026-04-20, R-UI-2.5):** Still reproducing after the ActivityFeed extraction. Specific repro: [DESCRIBE EXACT STEPS]. Defers to a future UI-polish phase.`

- [ ] **Step 5: Commit**

Run:
```bash
git add docs/superpowers/deferred-fixes.md
git commit -m "docs(deferred-fixes): mark resolved items from R-UI-2.5 and R-REM-W2

- Strike activity-feed Realtime refresh (R-UI-2.5)
- Strike RealtimeProvider adapter missing (R-REM-W2, back-filled)
- Clarify pipeline-detail duration — only useNow tick remains open
- Re-evaluate activity-feed rendering entry (see commit for verdict)

Part of R-UI-2.5."
```

Expected: pre-commit hook passes.

---

## Task 8: Update roadmap.md

**Files:**
- Modify: `docs/superpowers/roadmap.md`

- [ ] **Step 1: Flip R-UI-2 row status**

Find the row in the phases table that starts with `| R-UI-2 — Real-time updates |`. Replace the Status cell from `**Paused (partial)**` to:

```
**Retired — superseded by R-UI-2.5 (branch archived)**
```

Keep the existing Plan and Spec links — readers who follow them will hit the terminal-state notes added in Task 1.

- [ ] **Step 2: Insert R-UI-2.5 row**

Immediately below the R-UI-2 row, insert:

```markdown
| R-UI-2.5 — Realtime user-visible remnant (ActivityFeed extraction + Realtime subscription + RunDetailModal poll removal) | **Done — PR #TBD** | [r-ui-2-5-plan](superpowers/plans/2026-04-20-r-ui-2-5-implementation.md) | [disposition-design](superpowers/specs/2026-04-20-r-ui-2-disposition-and-w3-decomposition-design.md) |
```

(Replace `#TBD` with the actual PR number after it opens in Task 9.)

- [ ] **Step 3: Update What's Next item 2**

Find the numbered list under `## What's Next`. Item 2 currently reads:

```
2. **R-UI-2** — Real-time updates — **Paused partial.** Branch `feat/r-ui-2-impl` completed tasks 1-11 (ports + adapter + client-side Realtime wiring through LiveOutput and RunDetailModal). Tasks 12-32 not started. Audit found multiple issues with the paused code (AUDIT-003, -005, -010, -012, -016). Resumption blocked on Wave 2 remediation.
```

Replace with:

```
2. **R-UI-2** — Real-time updates — **Retired (2026-04-20).** Tasks 1-11 shipped independently via R-REM-W1/W2 against a different file structure. Remaining user-visible scope moved to R-UI-2.5 (below); orchestrator rewire (Tasks 14-22) permanently deferred — target files were deleted/relocated in W1/W2. Branch `feat/r-ui-2-impl` archived.

2a. **R-UI-2.5** — Realtime user-visible remnant — **Done (2026-04-20), PR #TBD.** Three items: extracted `ActivityFeed` from the 880-line issue detail client to `src/app/[org]/[user]/[project]/issues/[number]/ActivityFeed.tsx` (resolves AUDIT-003); added Realtime subscription to `issue_event` table with client-side issueId filtering (resolves AUDIT-012 — R-UI-2 spec exit criterion #2); deleted 2-second `refetchInterval` from `RunDetailModal.tsx` since its existing Realtime subscription on `stage_run` covers the data (resolves AUDIT-005 — live invariant-9 violation on main). Full verification: tsc clean, vitest 122/122, verify 10/10, Playwright smoke, human browser check.
```

- [ ] **Step 4: Commit**

Run:
```bash
git add docs/superpowers/roadmap.md
git commit -m "docs(roadmap): retire R-UI-2; add R-UI-2.5 row and What's Next narrative

Part of R-UI-2.5."
```

Expected: pre-commit hook passes.

---

## Task 9: Open PR, wait for human browser verification, merge

**Files:** (none modified — this is workflow)

- [ ] **Step 1: Push the branch**

Run:
```bash
git push -u origin feat/r-ui-2-5-realtime-remnant
```

Expected: branch created on `origin`. If rejected, rebase on `main`.

- [ ] **Step 2: Open the PR**

Run:
```bash
gh pr create --title "feat: R-UI-2.5 — activity feed Realtime + RunDetailModal poll removal + ActivityFeed extraction" --body "$(cat <<'EOF'
## Summary

Closes three R-UI-2 audit findings by extracting `ActivityFeed` out of the 880-line issue detail client, subscribing it to Supabase Realtime, and deleting `RunDetailModal`'s redundant 2-second poll.

Retires `feat/r-ui-2-impl` in the process (terminal-state notes appended to the retired spec + plan; roadmap flipped to reflect retirement).

## Scope

1. **Extract `ActivityFeed` component.** `src/app/[org]/[user]/[project]/issues/[number]/client.tsx` drops from 880 → ≤500 lines. Resolves AUDIT-003.
2. **Realtime subscription in `ActivityFeed`.** Subscribes to `issue_event` via `registry.get<RealtimeProvider>('realtime')`, filters by `issueId` client-side (the port signature has no filter param), invalidates the events query on match. Replaces the manual `eventsQuery.refetch()` calls that previously fired from comment mutation success handlers. Resolves AUDIT-012.
3. **Drop `refetchInterval` from `RunDetailModal`.** The existing `useEffect`-based Realtime subscription on `stage_run` already drives run-query refetches. Resolves AUDIT-005 — a live invariant-9 violation on `main`.

## Verification

- [x] \`npx tsc --noEmit\` clean
- [x] \`npx vitest run\` 122/122 passing
- [x] \`npm run verify\` 10/10 on fresh seed
- [x] \`npm run lint\` baseline holds
- [x] \`npm run build\` compiles
- [x] New Playwright smoke: \`e2e/activity-feed-realtime.spec.ts\` passes
- [x] Existing Playwright smoke: \`e2e/run-stage-smoke.spec.ts\` still passes
- [ ] **Manual browser verification** on http://192.168.54.101:3003 with FLUXAOS_LAN_AUTH_BYPASS=1 — required per invariant 21. Checklist:
  - [ ] Load issue detail page — no console errors
  - [ ] Post a comment — activity feed updates without manual refresh
  - [ ] Edit state — activity feed shows the state-changed event without manual refresh
  - [ ] Trigger a stage run — \`RunDetailModal\` updates without poll visible in Network tab

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Record the PR number.

- [ ] **Step 2a: Back-fill PR number in docs**

Replace `#TBD` in the commits from Task 7 (deferred-fixes) and Task 8 (roadmap) with the real PR number. Amend the relevant commits OR create a small follow-up commit:

```bash
# Preferred: small follow-up commit
sed -i "s/PR #TBD/PR #${PR_NUMBER}/g" docs/superpowers/deferred-fixes.md docs/superpowers/roadmap.md
git add docs/superpowers/deferred-fixes.md docs/superpowers/roadmap.md
git commit -m "docs: back-fill PR number in deferred-fixes and roadmap"
git push
```

- [ ] **Step 3: Await human browser verification**

Stop execution here. The user runs the manual-verification checklist in the PR body. Do not merge, do not flip roadmap "Done" cells, do not mark complete — self-certification is forbidden per invariant 21.

- [ ] **Step 4: On user approval — merge the PR**

Run (only after user says "verified" or similar):
```bash
gh pr merge --squash --delete-branch
```

Expected: `merged` line in output. Verify the remote branch is actually gone (the R-REM-W2 closeout handoff flagged a case where auto-delete failed silently):

```bash
gh api repos/fluxaOS/fluxaos/branches --jq '.[].name' | grep -c feat/r-ui-2-5-realtime-remnant
```

Expected: `0`. If `1`:
```bash
git push origin --delete feat/r-ui-2-5-realtime-remnant
```

- [ ] **Step 5: Delete the retired R-UI-2 remote branch**

This was intentionally preserved through W2 closeout. Now that R-UI-2.5 has retired it, delete:

```bash
git push origin --delete feat/r-ui-2-impl
git branch -D feat/r-ui-2-impl  # local, if present
```

Expected: both deletions succeed.

- [ ] **Step 6: Update local main**

```bash
git checkout main
git pull --ff-only origin main
git log -3 --oneline
```

Expected: the squash-merge commit is the latest entry, followed by the back-fill commit and the prior head.

---

## Notes for the Executor

- Task 1 through Task 6 can all happen in one session. Task 7 and Task 8 are doc-only and can ship with the same PR (do not split into a separate `docs/` PR — the project's convention is all phase-related doc changes go with the code that motivates them).
- Task 9 pauses for human verification. Do not skip this — R-UI-2 itself is an R-AUDIT finding (AUDIT-008) rooted in a prior phase being marked Done without human verification. Don't repeat that mistake here.
- If during Task 2 Step 1 you find that `formatEvent` in `client.tsx` has branches that `describeEvent` does not cover, and those branches exist because some event type is actually emitted by the seed or by the orchestrator, extend `describeEvent` to match. Do not silently drop branches — the activity feed goes blank on unknown types, and silent gaps are exactly what AUDIT-012 is about.
- The port's `subscribeToTable` signature has no filter parameter. The R-UI-2 plan had a Task 1 that extended it with one; that change never landed on `main` and is intentionally not revived here. Client-side filtering in the callback is the deliberate choice — it's O(1) per event and the event rate is low enough that server-side filtering is not worth the port change.
- Invariant 10's file-size limit is ~500 lines. Task 3 Step 11 is a hard gate; if `client.tsx` is 501 lines after extraction, the extraction is incomplete, not a style issue.

---

## Self-Review

**Spec coverage:**
- R-UI-2.5 scope item 1 (extract `ActivityFeed`) — Task 2 + Task 3. ✓
- R-UI-2.5 scope item 2 (Realtime subscription) — Task 2 Step 1 (the `useEffect` in `ActivityFeed.tsx`). ✓
- R-UI-2.5 scope item 3 (drop `refetchInterval`) — Task 4. ✓
- Documentation updates: `deferred-fixes.md` — Task 7. ✓  `roadmap.md` — Task 8. ✓  Terminal-state notes — Task 1. ✓
- Verification gates: tsc, vitest, verify, lint, build, Playwright smoke, existing smoke, human browser — Task 5 + Task 6 + Task 9. ✓
- Branch retirement — Task 9 Step 5. ✓

**Placeholder scan:**
- "PR #TBD" appears in Tasks 7/8 — this is an intentional execution-time value documented in Task 9 Step 2a (back-fill commit). Acceptable.
- Task 7 Step 4's "[DESCRIBE EXACT STEPS]" — intentional placeholder for the executor to fill based on what they observe. This is correct (the executor has to do the observation).
- No TBDs, TODOs, or "fill in details" in implementation-bearing steps. ✓

**Type consistency:**
- `EventFilter` type lives only in `ActivityFeed.tsx` after Task 3 Step 3. ✓
- `Catalogs` type in `ActivityFeed.tsx` matches the shape `client.tsx` already passes (three arrays of `{id, displayName, color}`). ✓
- `ActivityFeed` signature `{ issueId: string; catalogs: Catalogs }` matches Task 3 Step 8's render call. ✓
- `IssueEventRow` type in the subscription callback only references `issueId` — the table has many columns, but we only need `issueId` for filtering. Safe. ✓
