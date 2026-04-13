'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, MessageSquare, Clock, GitBranch, Pencil, Trash2, Play } from 'lucide-react';
import { Card } from '@/components/card';
import { SkeletonCard } from '@/components/skeleton';
import { CatalogBadge } from '@/components/catalog-badge';
import { RunDetailModal } from '@/components/pipeline/RunDetailModal';
import { trpc } from '@/lib/trpc/client';

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
  const router = useRouter();
  const [eventFilter, setEventFilter] = useState<EventFilter>('all');
  const [commentBody, setCommentBody] = useState('');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

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

  const updateComment = trpc.issue.comment.update.useMutation({
    onSuccess: () => {
      commentsQuery.refetch();
      eventsQuery.refetch();
    },
  });

  const deleteComment = trpc.issue.comment.delete.useMutation({
    onSuccess: () => {
      commentsQuery.refetch();
      eventsQuery.refetch();
    },
  });

  // Pipeline: get project's pipelines + stages (always visible)
  const pipelinesQuery = trpc.pipeline.listByProject.useQuery(
    { projectId },
    { enabled: !!projectId },
  );
  const defaultPipeline = pipelinesQuery.data?.find((p) => p.isDefault) ?? pipelinesQuery.data?.[0];

  const stagesQuery = trpc.pipeline.stages.listByPipeline.useQuery(
    { pipelineId: defaultPipeline?.id ?? '' },
    { enabled: !!defaultPipeline?.id },
  );
  const pipelineStages = stagesQuery.data ?? [];

  // Pipeline run state for this issue (if a run exists)
  const pipelineStateQuery = trpc.pipeline.runs.issueState.useQuery(
    { issueId: issue?.id ?? '' },
    { enabled: !!issue?.id },
  );
  const pipelineState = pipelineStateQuery.data;

  const triggerRun = trpc.pipeline.runs.trigger.useMutation({
    onSuccess: (data) => {
      pipelineStateQuery.refetch();
      if (data?.id) setActiveRunId(data.id);
    },
  });

  const executeStage = trpc.pipeline.runs.executeStage.useMutation({
    onSuccess: () => {
      pipelineStateQuery.refetch();
      // Open modal for existing run if we have one
      if (pipelineState?.run?.id) setActiveRunId(pipelineState.run.id);
    },
  });

  const deleteIssue = trpc.issue.delete.useMutation({
    onSuccess: () => {
      router.push(`${basePath}/issues`);
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

        {/* State dropdown */}
        {transitions.length > 0 && (
          <div className="flex flex-wrap gap-4 pt-3 border-t border-slate-700/20">
            <CatalogSelect
              label="State"
              items={[
                ...(stateInfo ? [stateInfo] : []),
                ...transitions.filter((t) => t.id !== issue.stateId),
              ]}
              currentId={issue.stateId}
              onSelect={(toStateId) =>
                transitionMutation.mutate({
                  id: issue.id,
                  toStateId,
                  version: issue.version,
                })
              }
              disabled={isMutating}
            />
          </div>
        )}
      </Card>

      {/* Pipeline Stages — always visible when pipeline exists */}
      {pipelineStages.length > 0 && (() => {
        // Match the issue's current state to a pipeline stage by name
        const currentStateName = stateInfo?.key ?? stateInfo?.displayName?.toLowerCase();
        const matchingStage = pipelineStages.find(
          (s: typeof pipelineStages[number]) => s.name === currentStateName,
        );
        const isExecuting = executeStage.isPending || triggerRun.isPending;

        return (
          <Card hover={false} padding="p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-400">Pipeline Stages</h3>
            <div className="flex gap-2">
              {pipelineStages.map((s: typeof pipelineStages[number]) => {
                const sr = pipelineState?.stages?.find(
                  (ps: any) => ps.id === s.id,
                )?.stageRun ?? null;
                const isCurrent = s.id === matchingStage?.id;
                const isCompleted = sr?.status === 'completed';
                const isRunning = sr?.status === 'running' || sr?.status === 'launching';

                return (
                  <div
                    key={s.id}
                    className={`text-xs px-3 py-2 rounded-lg border transition-colors ${
                      isCompleted
                        ? 'bg-emerald-400/10 border-emerald-400/30 text-emerald-400'
                        : isRunning
                          ? 'bg-electric-violet/15 border-soft-violet/40 text-soft-violet'
                          : isCurrent
                            ? 'bg-amber-400/10 border-amber-400/30 text-amber-400'
                            : 'bg-white/[0.02] border-slate-700/30 text-slate-500'
                    }`}
                  >
                    <span className="font-medium">{s.name}</span>
                    <span className="text-slate-600 ml-1">({s.gateMode})</span>
                    {sr && (
                      <span className="ml-1.5 text-[10px] opacity-70">{sr.status}</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Run Stage — always available, triggers the stage matching the issue's state */}
            {matchingStage && defaultPipeline && issue && (
              <button
                type="button"
                onClick={() => {
                  // If a pending stage run exists, execute it
                  const existingSr = pipelineState?.currentStageRun;
                  if (existingSr && (existingSr.status === 'pending' || existingSr.status === 'queued')) {
                    executeStage.mutate({ stageRunId: existingSr.id });
                  } else {
                    // Otherwise trigger a new pipeline run
                    triggerRun.mutate({
                      pipelineId: defaultPipeline.id,
                      issueId: issue.id,
                    });
                  }
                }}
                disabled={isExecuting}
                className="flex items-center gap-1.5 px-4 py-2 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all shadow-[0_4px_16px_rgba(124,58,237,0.3)]"
              >
                <Play size={14} />
                {isExecuting ? 'Starting...' : `Run Stage`}
              </button>
            )}

            {pipelineState?.run && (
              <p className="text-[11px] text-slate-600">
                Run: {pipelineState.run.status} &middot; Cost: ${pipelineState.run.totalCostUsd ?? '0.00'}
                {' '}&middot;{' '}
                <button
                  type="button"
                  onClick={() => setActiveRunId(pipelineState.run!.id)}
                  className="text-soft-violet hover:underline"
                >
                  View details
                </button>
              </p>
            )}

            <RunDetailModal
              runId={activeRunId}
              onClose={() => {
                setActiveRunId(null);
                pipelineStateQuery.refetch();
              }}
            />
          </Card>
        );
      })()}

      {/* Delete Issue */}
      <button
        type="button"
        onClick={() => {
          if (confirm('Delete this issue and all its data?')) {
            deleteIssue.mutate({ id: issue.id });
          }
        }}
        disabled={deleteIssue.isPending}
        className="text-xs px-3 py-1.5 rounded-lg bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-400/20 transition-colors disabled:opacity-50"
      >
        {deleteIssue.isPending ? 'Deleting...' : 'Delete Issue'}
      </button>

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
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

type CatalogItem = { id: string; displayName: string; color: string };

interface Catalogs {
  states: CatalogItem[];
  types: CatalogItem[];
  priorities: CatalogItem[];
}

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

function catalogForField(field: string, catalogs: Catalogs): CatalogItem[] | null {
  if (field === 'priorityId') return catalogs.priorities;
  if (field === 'typeId') return catalogs.types;
  if (field === 'stateId') return catalogs.states;
  return null;
}

function formatEvent(
  type: string,
  payload: Record<string, unknown> | null | undefined,
  catalogs: Catalogs,
): string {
  const p = payload ?? {};

  switch (type) {
    case 'state_changed': {
      const from = catalogName(p.from_state, catalogs.states);
      const to = catalogName(p.to_state, catalogs.states);
      return `State changed: ${from} \u2192 ${to}`;
    }

    case 'fields_updated': {
      const changes = p.changes as Record<string, { from: unknown; to: unknown }> | undefined;
      if (!changes) return 'Fields updated';
      const parts = Object.entries(changes).map(([field, { from, to }]) => {
        const label = FIELD_LABELS[field] ?? field;
        const catalog = catalogForField(field, catalogs);
        const fromStr = catalog ? catalogName(from, catalog) : String(from ?? '(empty)');
        const toStr = catalog ? catalogName(to, catalog) : String(to ?? '(empty)');
        return `${label}: ${fromStr} \u2192 ${toStr}`;
      });
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

    default:
      return type.replace(/_/g, ' ');
  }
}
