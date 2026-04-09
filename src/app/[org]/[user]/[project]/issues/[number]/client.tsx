'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, MessageSquare, Clock, GitBranch } from 'lucide-react';
import { Card } from '@/components/card';
import { SkeletonCard } from '@/components/skeleton';
import { trpc } from '@/lib/trpc/client';

// ─── Catalog badge (DB-driven colors) ───────────────────────────────────────

function CatalogBadge({ displayName, color }: { displayName: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ backgroundColor: `${color}20`, color }}
    >
      <span className="w-[7px] h-[7px] rounded-full" style={{ backgroundColor: color }} />
      {displayName}
    </span>
  );
}

// ─── Editable text field (save on blur / Enter) ─────────────────────────────

function EditableTitle({
  value,
  onSave,
  disabled,
}: {
  value: string;
  onSave: (val: string) => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    } else {
      setDraft(value);
    }
    setEditing(false);
  }

  if (!editing) {
    return (
      <h2
        className="text-xl font-bold text-white cursor-pointer hover:text-slate-300 transition-colors"
        onClick={() => { setDraft(value); setEditing(true); }}
        title="Click to edit"
      >
        {value}
      </h2>
    );
  }

  return (
    <input
      autoFocus
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { setDraft(value); setEditing(false); }
      }}
      disabled={disabled}
      className="text-xl font-bold text-white bg-slate-900 border border-slate-700/60 rounded-lg px-2 py-1 w-full focus:outline-none focus:ring-2 focus:ring-electric-violet/30"
    />
  );
}

// ─── Editable body (markdown) ───────────────────────────────────────────────

function EditableBody({
  bodyMd,
  bodyHtml,
  onSave,
  disabled,
}: {
  bodyMd: string | null;
  bodyHtml: string | null;
  onSave: (val: string) => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bodyMd ?? '');

  function commit() {
    if (draft !== (bodyMd ?? '')) {
      onSave(draft);
    }
    setEditing(false);
  }

  if (!editing) {
    // bodyHtml is rendered at write time by the server (invariant #14),
    // not from untrusted user input — safe to render.
    return (
      <div
        className="text-sm text-slate-400 cursor-pointer hover:bg-white/[0.02] rounded-lg p-2 -m-2 transition-colors min-h-[40px]"
        onClick={() => { setDraft(bodyMd ?? ''); setEditing(true); }}
        title="Click to edit"
      >
        {bodyHtml ? (
          <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        ) : (
          <span className="text-slate-600 italic">No description. Click to add one.</span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={6}
        disabled={disabled}
        className="w-full bg-slate-900 border border-slate-700/60 rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-electric-violet/30 resize-y"
        placeholder="Describe the issue (Markdown)..."
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={commit}
          disabled={disabled}
          className="px-3 py-1.5 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-all"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => { setDraft(bodyMd ?? ''); setEditing(false); }}
          className="px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 text-xs rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Catalog dropdown selector ──────────────────────────────────────────────

function CatalogSelect({
  label,
  items,
  currentId,
  onSelect,
  disabled,
}: {
  label: string;
  items: Array<{ id: string; displayName: string; color: string }>;
  currentId: string;
  onSelect: (id: string) => void;
  disabled: boolean;
}) {
  const current = items.find((i) => i.id === currentId);

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 w-16 shrink-0">
        {label}
      </span>
      {current && <CatalogBadge displayName={current.displayName} color={current.color} />}
      <select
        value={currentId}
        onChange={(e) => {
          if (e.target.value !== currentId) onSelect(e.target.value);
        }}
        disabled={disabled}
        className="bg-transparent border-0 text-xs text-slate-500 focus:outline-none cursor-pointer ml-1"
      >
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Activity feed filter ───────────────────────────────────────────────────

type EventFilter = 'all' | 'comments' | 'state';

// ─── Main client component ──────────────────────────────────────────────────

export function IssueDetailClient({
  projectId,
  issueNumber,
  basePath,
}: {
  projectId: string;
  issueNumber: number;
  basePath: string;
}) {
  const [eventFilter, setEventFilter] = useState<EventFilter>('all');
  const [commentBody, setCommentBody] = useState('');

  // ── Data queries ────────────────────────────────────────────────────────
  const issueQuery = trpc.issue.getByNumber.useQuery({
    projectId,
    number: issueNumber,
  });

  const issue = issueQuery.data;

  const typesQuery = trpc.issueCatalog.types.list.useQuery({ projectId });
  const statesQuery = trpc.issueCatalog.states.list.useQuery({ projectId });
  const prioritiesQuery = trpc.issueCatalog.priorities.list.useQuery({ projectId });

  const transitionsQuery = trpc.issue.transitions.useQuery(
    { id: issue?.id ?? '' },
    { enabled: !!issue?.id },
  );

  const eventsQuery = trpc.issue.event.list.useQuery(
    { issueId: issue?.id ?? '', filter: eventFilter === 'all' ? undefined : eventFilter },
    { enabled: !!issue?.id },
  );

  const commentsQuery = trpc.issue.comment.list.useQuery(
    { issueId: issue?.id ?? '' },
    { enabled: !!issue?.id },
  );

  const types = typesQuery.data ?? [];
  const states = statesQuery.data ?? [];
  const priorities = prioritiesQuery.data ?? [];
  const transitions = transitionsQuery.data ?? [];
  const events = eventsQuery.data ?? [];
  const comments = commentsQuery.data ?? [];

  // ── Mutations ───────────────────────────────────────────────────────────

  function refetchIssue() {
    issueQuery.refetch();
    transitionsQuery.refetch();
    eventsQuery.refetch();
  }

  const updateFields = trpc.issue.updateFields.useMutation({
    onSuccess: () => refetchIssue(),
    onError: (err) => {
      if (err.message.includes('VERSION_CONFLICT')) {
        alert('This issue was modified by someone else. Reloading...');
        refetchIssue();
      }
    },
  });

  const transitionMutation = trpc.issue.transition.useMutation({
    onSuccess: () => refetchIssue(),
    onError: (err) => {
      if (err.message.includes('VERSION_CONFLICT')) {
        alert('This issue was modified by someone else. Reloading...');
        refetchIssue();
      }
    },
  });

  const createComment = trpc.issue.comment.create.useMutation({
    onSuccess: () => {
      setCommentBody('');
      commentsQuery.refetch();
      eventsQuery.refetch();
    },
  });

  const isMutating = updateFields.isPending || transitionMutation.isPending;

  // ── Loading / not found ─────────────────────────────────────────────────
  if (issueQuery.isLoading) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="text-slate-500 py-8 text-center">
        Issue #{issueNumber} not found
      </div>
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  function saveField(fields: Record<string, unknown>) {
    if (!issue) return;
    updateFields.mutate({
      id: issue.id,
      version: issue.version,
      ...fields,
    });
  }

  const stateInfo = states.find((s) => s.id === issue.stateId);
  const priorityInfo = priorities.find((p) => p.id === issue.priorityId);

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href={`${basePath}/issues`}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Issues
      </Link>

      {/* Issue header + meta */}
      <Card hover={false} padding="p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <span className="text-sm font-mono text-slate-500">#{issue.number}</span>
            <EditableTitle
              value={issue.title}
              onSave={(title) => saveField({ title })}
              disabled={isMutating}
            />
          </div>
          <div className="flex gap-2 shrink-0">
            {stateInfo && <CatalogBadge displayName={stateInfo.displayName} color={stateInfo.color} />}
            {priorityInfo && <CatalogBadge displayName={priorityInfo.displayName} color={priorityInfo.color} />}
          </div>
        </div>

        {/* Meta strip: dropdowns for type, priority, assignee */}
        <div className="flex flex-wrap gap-4 pt-3 border-t border-slate-700/20">
          <CatalogSelect
            label="Type"
            items={types}
            currentId={issue.typeId}
            onSelect={(typeId) => saveField({ typeId })}
            disabled={isMutating}
          />
          <CatalogSelect
            label="Priority"
            items={priorities}
            currentId={issue.priorityId}
            onSelect={(priorityId) => saveField({ priorityId })}
            disabled={isMutating}
          />
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 w-16 shrink-0">
              Assignee
            </span>
            <input
              type="text"
              defaultValue={issue.assignee ?? ''}
              onBlur={(e) => {
                const val = e.target.value.trim() || null;
                if (val !== issue.assignee) saveField({ assignee: val });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              disabled={isMutating}
              placeholder="Unassigned"
              className="bg-transparent border border-slate-700/30 rounded-lg px-2 py-1 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-electric-violet/30 w-32"
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Clock size={12} />
            {new Date(issue.createdAt).toLocaleString()}
          </div>
        </div>

        {/* Body */}
        <EditableBody
          bodyMd={issue.bodyMd}
          bodyHtml={issue.bodyHtml}
          onSave={(bodyMd) => saveField({ bodyMd })}
          disabled={isMutating}
        />

        {/* Transition buttons */}
        {transitions.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-700/20">
            <span className="text-xs text-slate-500 py-1.5 flex items-center gap-1">
              <GitBranch size={12} />
              Transition to:
            </span>
            {transitions.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() =>
                  transitionMutation.mutate({
                    id: issue.id,
                    toStateId: t.id,
                    version: issue.version,
                  })
                }
                disabled={isMutating}
                className="px-3 py-1.5 text-sm rounded-lg transition-all disabled:opacity-50 border"
                style={{
                  backgroundColor: `${t.color}15`,
                  borderColor: `${t.color}40`,
                  color: t.color,
                }}
              >
                {t.displayName}
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Activity feed */}
      <div>
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
                  <span className="text-sm capitalize font-medium text-slate-300">
                    {event.type.replace(/_/g, ' ')}
                  </span>
                  {event.payload != null && (
                    <span className="text-sm text-slate-500 truncate">
                      {formatPayload(event.payload as Record<string, unknown>)}
                    </span>
                  )}
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
            if (!commentBody.trim() || !issue) return;
            createComment.mutate({
              issueId: issue.id,
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
            <Card key={c.id} hover={false} padding="p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-slate-300">{c.author}</span>
                <span className="text-[11px] text-slate-600">
                  {new Date(c.createdAt).toLocaleString()}
                </span>
              </div>
              {/* bodyHtml is server-rendered from markdown at write time (invariant #14) */}
              {c.bodyHtml ? (
                <div
                  className="text-sm text-slate-400 prose prose-invert prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: c.bodyHtml }}
                />
              ) : (
                <p className="text-sm text-slate-400 whitespace-pre-wrap">{c.bodyMd}</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as Record<string, unknown>;
  if (obj.from && obj.to) return `${obj.from} -> ${obj.to}`;
  if (obj.title) return String(obj.title);
  if (obj.changes && typeof obj.changes === 'object') {
    const keys = Object.keys(obj.changes as Record<string, unknown>);
    return `Changed: ${keys.join(', ')}`;
  }
  return '';
}
