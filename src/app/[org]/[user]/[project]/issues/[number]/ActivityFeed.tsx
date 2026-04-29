'use client';

import { MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card } from '@/components/card';
import { registry } from '@/config/registry';
import type {
  RealtimeProvider,
  RealtimeTableEvent,
} from '@/core/ports/realtime';
import { trpc } from '@/lib/trpc/client';

// ─── Types ──────────────────────────────────────────────────────────────────

type EventFilter = 'all' | 'comments' | 'state';

type CatalogItem = { id: string; displayName: string; color: string };

interface Catalogs {
  states: CatalogItem[];
  types: CatalogItem[];
  priorities: CatalogItem[];
}

// Supabase Realtime delivers DB-column-shaped payloads (snake_case),
// not Drizzle camelCase. Accept both shapes and look up either at runtime.
interface IssueEventRow {
  issue_id?: string;
  issueId?: string;
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
          <span className="text-xs font-semibold text-slate-300">
            {comment.author}
          </span>
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
            title="Edit Comment"
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
            title="Delete Comment"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {/* bodyHtml is server-rendered from markdown at write time (invariant #14) */}
      {comment.bodyHtml ? (
        <div
          className="markdown-body text-sm"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: bodyHtml is server-sanitized per invariant #14
          dangerouslySetInnerHTML={{ __html: comment.bodyHtml }}
        />
      ) : (
        <p className="text-sm text-slate-400 whitespace-pre-wrap">
          {comment.bodyMd}
        </p>
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

  const eventsQuery = trpc.issue.event.list.useQuery(
    { issueId, filter: eventFilter === 'all' ? undefined : eventFilter },
    { enabled: !!issueId }
  );

  const commentsQuery = trpc.issue.comment.list.useQuery(
    { issueId },
    { enabled: !!issueId }
  );

  const events = eventsQuery.data ?? [];
  const comments = commentsQuery.data ?? [];
  const formattedEvents = events.flatMap((event) => {
    const description = formatEvent(
      event.type,
      event.payload as Record<string, unknown>,
      catalogs
    );
    return description ? [{ event, description }] : [];
  });

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
  // filter client-side by matching issueId in the payload.
  useEffect(() => {
    if (!issueId) return;
    const realtime = registry.get<RealtimeProvider>('realtime');
    const unsubscribe = realtime.subscribeToTable<IssueEventRow>(
      `activity-feed-${issueId}`,
      'issue_event',
      '*',
      (payload: RealtimeTableEvent<IssueEventRow>) => {
        const rowIssueId =
          payload.new?.issue_id ??
          payload.new?.issueId ??
          payload.old?.issue_id ??
          payload.old?.issueId;
        if (rowIssueId === issueId) {
          eventsQuery.refetch();
        }
      }
    );
    return () => {
      unsubscribe();
    };
  }, [issueId, eventsQuery.refetch]); // eslint-disable-line react-hooks/exhaustive-deps

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

        {formattedEvents.length === 0 ? (
          <p className="text-sm text-slate-600">No activity yet.</p>
        ) : (
          <div className="relative pl-6">
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-700/30" />
            <div className="space-y-0">
              {formattedEvents.map(({ event, description }) => (
                <div
                  key={event.id}
                  className="relative flex items-start gap-3 py-2.5"
                >
                  <div className="absolute left-[-19px] top-3.5 w-2.5 h-2.5 rounded-full bg-slate-700 border-2 border-slate-800" />
                  <span className="text-[11px] text-slate-600 font-mono whitespace-nowrap mt-0.5">
                    {new Date(event.timestamp).toLocaleString()}
                  </span>
                  <span className="text-sm text-slate-300">{description}</span>
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
          {createComment.isPending ? 'Posting…' : 'Post Comment'}
        </button>
        {createComment.error && (
          <p className="mt-2 text-sm text-red-400">
            {createComment.error.message}
          </p>
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
              comment={{
                ...c,
                bodyMd: c.bodyMd ?? '',
                author: c.author ?? 'unknown',
              }}
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

const DESCRIPTION_FIELDS = new Set(['bodyMd', 'bodyHtml', 'description']);

function catalogName(id: unknown, items: CatalogItem[]): string {
  if (typeof id !== 'string') return String(id ?? '');
  const match = items.find((i) => i.id === id);
  return match ? match.displayName : String(id);
}

function catalogForField(
  field: string,
  catalogs: Catalogs
): CatalogItem[] | null {
  if (field === 'priorityId') return catalogs.priorities;
  if (field === 'typeId') return catalogs.types;
  if (field === 'stateId') return catalogs.states;
  return null;
}

function formatEvent(
  type: string,
  payload: Record<string, unknown> | null | undefined,
  catalogs: Catalogs
): string | null {
  const p = payload ?? {};

  switch (type) {
    case 'state_changed': {
      const from = catalogName(p.from_state, catalogs.states);
      const to = catalogName(p.to_state, catalogs.states);
      if (p.reason === 'auto_close_all_children_closed') {
        return `Auto-closed: all child issues closed (${from} \u2192 ${to})`;
      }
      return `State changed: ${from} \u2192 ${to}`;
    }

    case 'fields_updated': {
      const changes = p.changes as
        | Record<string, { from: unknown; to: unknown }>
        | undefined;
      if (!changes) return 'Fields updated';
      const parts = Object.entries(changes)
        .filter(([field]) => !DESCRIPTION_FIELDS.has(field))
        .map(([field, { from, to }]) => {
          const label = FIELD_LABELS[field] ?? field;
          const catalog = catalogForField(field, catalogs);
          const fromStr = catalog
            ? catalogName(from, catalog)
            : String(from ?? '(empty)');
          const toStr = catalog
            ? catalogName(to, catalog)
            : String(to ?? '(empty)');
          return `${label}: ${fromStr} \u2192 ${toStr}`;
        });
      if (parts.length === 0) return null;
      return parts.join(', ');
    }

    case 'comment_added':
      return `Comment added by ${p.user ?? p.author ?? 'unknown'}`;

    case 'comment_edited':
      return `Comment edited by ${p.user ?? p.edited_by ?? 'unknown'}`;

    case 'comment_deleted':
      return `Comment deleted by ${p.user ?? p.deleted_by ?? 'unknown'}`;

    case 'issue_created':
      return `Issue created by ${p.user ?? p.author ?? 'unknown'}`;

    case 'stage_started': {
      const stage = typeof p.stageName === 'string' ? p.stageName : 'stage';
      return `Started ${stage}`;
    }

    case 'stage_completed': {
      const stage = typeof p.stageName === 'string' ? p.stageName : 'stage';
      const summary = typeof p.summary === 'string' ? p.summary.trim() : '';
      return summary ? `${stage} completed: ${summary}` : `${stage} completed`;
    }

    case 'stage_failed': {
      const stage = typeof p.stageName === 'string' ? p.stageName : 'stage';
      const summary =
        typeof p.summary === 'string'
          ? p.summary.trim()
          : typeof p.reason === 'string'
            ? p.reason.trim()
            : '';
      return summary ? `${stage} failed: ${summary}` : `${stage} failed`;
    }

    case 'pipeline_completed':
      return 'Pipeline completed';

    default:
      return type.replace(/_/g, ' ');
  }
}
