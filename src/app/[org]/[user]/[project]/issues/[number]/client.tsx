'use client';

import { ArrowLeft, Clock, Play } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card } from '@/components/card';
import { CatalogBadge } from '@/components/catalog-badge';
import { RunDetailModal } from '@/components/pipeline/RunDetailModal';
import { SkeletonCard } from '@/components/skeleton';
import { trpc } from '@/lib/trpc/client';
import { ActivityFeed } from './ActivityFeed';
import {
  CatalogSelect,
  EditableBody,
  EditableLabels,
  EditableTitle,
} from './IssueDetailEditors';
import { RelationshipsCard } from './RelationshipsCard';

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
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  // ── Data queries ────────────────────────────────────────────────────────
  const issueQuery = trpc.issue.getByNumber.useQuery({
    projectId,
    number: issueNumber,
  });

  const issue = issueQuery.data;

  const typesQuery = trpc.issueCatalog.types.list.useQuery({ projectId });
  const statesQuery = trpc.issueCatalog.states.list.useQuery({ projectId });
  const prioritiesQuery = trpc.issueCatalog.priorities.list.useQuery({
    projectId,
  });

  const hasOpenChildrenQuery = trpc.issue.hasOpenChildren.useQuery(
    { id: issue?.id ?? '' },
    { enabled: !!issue?.id }
  );

  const types = typesQuery.data ?? [];
  const states = statesQuery.data ?? [];
  const priorities = prioritiesQuery.data ?? [];
  const labels = Array.isArray(issue?.labels)
    ? issue.labels.filter((label): label is string => typeof label === 'string')
    : [];

  // ── Mutations ───────────────────────────────────────────────────────────

  function refetchIssue() {
    issueQuery.refetch();
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

  // Pipeline: get project's pipelines + stages (always visible)
  const pipelinesQuery = trpc.pipeline.listByProject.useQuery(
    { projectId },
    { enabled: !!projectId }
  );
  const defaultPipeline =
    pipelinesQuery.data?.find((p) => p.isDefault) ?? pipelinesQuery.data?.[0];

  const stagesQuery = trpc.pipeline.stages.listByPipeline.useQuery(
    { pipelineId: defaultPipeline?.id ?? '' },
    { enabled: !!defaultPipeline?.id }
  );
  const pipelineStages = stagesQuery.data ?? [];

  // Pipeline run state for this issue (if a run exists)
  const pipelineStateQuery = trpc.pipeline.runs.issueState.useQuery(
    { issueId: issue?.id ?? '' },
    { enabled: !!issue?.id }
  );
  const pipelineState = pipelineStateQuery.data;
  const pipelineRunsQuery = trpc.pipeline.runs.listByIssue.useQuery(
    { issueId: issue?.id ?? '' },
    { enabled: !!issue?.id }
  );
  const pipelineRuns = pipelineRunsQuery.data ?? [];

  const triggerRun = trpc.pipeline.runs.trigger.useMutation({
    onSuccess: (data) => {
      pipelineStateQuery.refetch();
      pipelineRunsQuery.refetch();
      if (data?.id) setActiveRunId(data.id);
    },
    onError: (err) => {
      if (err.message.includes('ISSUE_IS_EPIC')) {
        alert(
          'This issue has open child issues. Run pipelines on the children, not the parent.'
        );
        hasOpenChildrenQuery.refetch();
      }
    },
  });

  const executeStage = trpc.pipeline.runs.executeStage.useMutation({
    onSuccess: () => {
      pipelineStateQuery.refetch();
      pipelineRunsQuery.refetch();
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
      projectId,
      version: issue.version,
      ...fields,
    });
  }

  const stateInfo = states.find((s) => s.id === issue.stateId);
  const priorityInfo = priorities.find((p) => p.id === issue.priorityId);

  // R-EPIC: disable Run Stage + hint when the issue has open children.
  const isEpic = hasOpenChildrenQuery.data === true;

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
            <span className="text-sm font-mono text-slate-500">
              #{issue.number}
            </span>
            <EditableTitle
              value={issue.title}
              onSave={(title) => saveField({ title })}
              disabled={isMutating}
            />
          </div>
          <div className="flex gap-2 shrink-0">
            {stateInfo && (
              <CatalogBadge
                displayName={stateInfo.displayName}
                color={stateInfo.color}
              />
            )}
            {priorityInfo && (
              <CatalogBadge
                displayName={priorityInfo.displayName}
                color={priorityInfo.color}
              />
            )}
            {issue.isClosed && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-700/40 text-slate-400">
                <span className="w-[7px] h-[7px] rounded-full bg-slate-500" />
                Closed
              </span>
            )}
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
          <EditableLabels
            value={labels}
            onSave={(nextLabels) => saveField({ labels: nextLabels })}
            disabled={isMutating}
          />
        </div>

        {/* Body */}
        <EditableBody
          bodyMd={issue.bodyMd}
          bodyHtml={issue.bodyHtml}
          onSave={(bodyMd) => saveField({ bodyMd })}
          disabled={isMutating}
        />

        {/* State dropdown — FLX-77: shows ALL states (free-form, no graph filter) */}
        {states.length > 0 && (
          <div className="flex flex-wrap gap-4 pt-3 border-t border-slate-700/20">
            <CatalogSelect
              label="State"
              items={states}
              currentId={issue.stateId}
              onSelect={(toStateId) =>
                transitionMutation.mutate({
                  id: issue.id,
                  projectId,
                  toStateId,
                  version: issue.version,
                })
              }
              disabled={isMutating}
            />
          </div>
        )}
      </Card>

      {/* R-EPIC: parent + children relationships */}
      <RelationshipsCard
        issueId={issue.id}
        parentIssueId={issue.parentIssueId ?? null}
        projectId={projectId}
        basePath={basePath}
      />

      {/* Pipeline Stages — always visible when pipeline exists */}
      {pipelineStages.length > 0 &&
        (() => {
          // Match the issue's current state to a pipeline stage by name
          const currentStateName =
            stateInfo?.key ?? stateInfo?.displayName?.toLowerCase();
          const matchingStage = pipelineStages.find(
            (s: (typeof pipelineStages)[number]) => s.name === currentStateName
          );
          const isExecuting = executeStage.isPending || triggerRun.isPending;

          return (
            <Card hover={false} padding="p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-400">
                Pipeline Stages
              </h3>
              <div className="flex gap-2">
                {pipelineStages.map((s: (typeof pipelineStages)[number]) => {
                  const sr =
                    pipelineState?.stages?.find((ps) => ps.id === s.id)
                      ?.stageRun ?? null;
                  const isCurrent = s.id === matchingStage?.id;
                  const isCompleted = sr?.status === 'completed';
                  const isRunning =
                    sr?.status === 'running' || sr?.status === 'launching';

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
                      <span className="text-slate-600 ml-1">
                        ({s.gateMode})
                      </span>
                      {sr && (
                        <span className="ml-1.5 text-[10px] opacity-70">
                          {sr.status}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Run Stage — always available, triggers the stage matching the issue's state */}
              {matchingStage && defaultPipeline && issue && (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      // If a pending stage run exists, execute it
                      const existingSr = pipelineState?.currentStageRun;
                      if (
                        existingSr &&
                        (existingSr.status === 'pending' ||
                          existingSr.status === 'queued')
                      ) {
                        executeStage.mutate({
                          stageRunId: existingSr.id,
                          projectId,
                        });
                      } else {
                        // Otherwise trigger a new pipeline run for this stage
                        triggerRun.mutate({
                          pipelineId: defaultPipeline.id,
                          issueId: issue.id,
                          stageId: matchingStage.id,
                        });
                      }
                    }}
                    disabled={isExecuting || isEpic}
                    className="flex items-center gap-1.5 px-4 py-2 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-all shadow-[0_4px_16px_rgba(124,58,237,0.3)]"
                  >
                    <Play size={14} />
                    {isExecuting ? 'Starting…' : `Run Stage`}
                  </button>
                  {isEpic && (
                    <p className="text-[11px] text-slate-500">
                      This issue has open child issues. Run pipelines on the
                      children.
                    </p>
                  )}
                </div>
              )}

              {pipelineState?.run && (
                <p className="text-[11px] text-slate-600">
                  Run: {pipelineState.run.status} &middot; Cost: $
                  {pipelineState.run.totalCostUsd ?? '0.00'} &middot;{' '}
                  <button
                    type="button"
                    onClick={() => setActiveRunId(pipelineState.run?.id)}
                    className="text-soft-violet hover:underline"
                  >
                    View Details
                  </button>
                </p>
              )}

              {pipelineRuns.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-700/20">
                  <h3 className="text-sm font-semibold text-slate-400">
                    Run History
                  </h3>
                  <div className="space-y-1.5">
                    {pipelineRuns.map((run) => {
                      const primaryStageRun =
                        run.stageRuns[run.stageRuns.length - 1] ?? null;
                      const stageName =
                        primaryStageRun?.pipelineStage?.name ?? 'Pipeline';
                      const startedAt = run.startedAt ?? run.createdAt;

                      return (
                        <div
                          key={run.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700/30 bg-white/[0.02] px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-medium text-slate-300 capitalize">
                                {stageName}
                              </span>
                              <span className="text-slate-600">
                                {run.status}
                              </span>
                              <span className="text-slate-600">
                                {new Date(startedAt).toLocaleString()}
                              </span>
                            </div>
                            <div className="mt-0.5 truncate font-mono text-[10px] text-slate-600">
                              {run.id}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setActiveRunId(run.id)}
                            aria-label={`View ${stageName} Run Details`}
                            className="shrink-0 text-xs text-soft-violet hover:underline"
                          >
                            View Details
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <RunDetailModal
                runId={activeRunId}
                projectId={projectId}
                onClose={() => {
                  setActiveRunId(null);
                  pipelineStateQuery.refetch();
                  pipelineRunsQuery.refetch();
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
            deleteIssue.mutate({ id: issue.id, projectId });
          }
        }}
        disabled={deleteIssue.isPending}
        className="text-xs px-3 py-1.5 rounded-lg bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-400/20 transition-colors disabled:opacity-50"
      >
        {deleteIssue.isPending ? 'Deleting…' : 'Delete Issue'}
      </button>

      <ActivityFeed
        issueId={issue.id}
        catalogs={{ states, types, priorities }}
      />
    </div>
  );
}
