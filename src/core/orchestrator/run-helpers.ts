/**
 * Shared helpers for pipeline run orchestration.
 *
 * - resolveProjectIdForRun: extracted from event-orchestrator.ts and manual-run.ts
 *   to avoid three parallel implementations of the same projectId-lookup logic.
 * - blockIssueOnRun: encapsulates the full block sequence that was previously
 *   copy-pasted across stage-executor and manual-run.
 */
import { eq } from 'drizzle-orm';
import { ACTOR, CONFIG_KEY, ISSUE_EVENT_TYPE } from '@/core/constants';
import type { Database } from '@/core/db/connection';
import { issue, pipeline, pipelineRun } from '@/core/db/schema';
import { createIssueService } from '@/core/services/issue';
import { createPipelineRunService } from './pipeline-run-service';

// DbOrTx mirrors the union in pipeline-run-service so blockIssueOnRun can be
// called from inside a db.transaction() callback.
type DbOrTx = Parameters<Parameters<Database['transaction']>[0]>[0] | Database;

/** Options that control the block sequence behaviour. */
export interface BlockIssueOptions {
  /** Human-readable reason appended to issue events. */
  reason: string;
  /** Optional blocking question surfaced to the user. */
  question?: string;
  /**
   * Actor that owns the events written. Defaults to ACTOR.orchestrator.
   * Manual-run sites pass ACTOR.manualRun.
   */
  actor?: string;
  /**
   * When true (default), a status_changed issue event is appended after
   * updateStatus. Set to false when the call site manages its own event
   * sequencing (e.g. manual-run, which appends pipeline_failed instead).
   */
  appendStatusChanged?: boolean;
  /**
   * When true, an additional pipeline_failed issue event is appended after
   * the status_changed event. Use for routing dead-end paths where the
   * pipeline itself is considered failed (not just blocked waiting on input).
   */
  appendPipelineFailed?: boolean;
}

/**
 * Execute the full block sequence for a given issueId:
 *   1. Fetch the issue row.
 *   2. Resolve the on_blocked config key to a status ID.
 *   3. Update the issue status (optionally with a blocking question).
 *   4. Optionally append a status_changed issue event.
 *   5. Optionally append a pipeline_failed issue event.
 *
 * No-op when issueId is null/undefined — callers do not need to guard.
 *
 * The db parameter may be a transaction handle so that manual-run callers
 * can wrap the entire sequence in a single atomic transaction.
 */
export async function blockIssueOnRun(
  db: DbOrTx,
  issueId: string | null | undefined,
  options: BlockIssueOptions
): Promise<void> {
  if (!issueId) return;

  const {
    reason,
    question,
    actor = ACTOR.orchestrator,
    appendStatusChanged = true,
    appendPipelineFailed = false,
  } = options;

  const issueService = createIssueService(db);
  const runService = createPipelineRunService(db);

  const [issueRow] = await db.select().from(issue).where(eq(issue.id, issueId));

  if (!issueRow) return;

  const blockedStatusId = await issueService.getStatusIdByConfigKey(
    issueRow.projectId,
    CONFIG_KEY.issueStatusOnBlocked
  );

  await issueService.updateStatus(
    issueId,
    blockedStatusId,
    ACTOR.orchestrator,
    issueRow.version,
    question
  );

  if (appendStatusChanged) {
    await runService.appendIssueEvent(
      issueId,
      ISSUE_EVENT_TYPE.status_changed,
      { reason, question },
      actor
    );
  }

  if (appendPipelineFailed) {
    await runService.appendIssueEvent(
      issueId,
      ISSUE_EVENT_TYPE.pipeline_failed,
      { reason, question },
      actor
    );
  }
}

/**
 * Resolve a pipeline run's projectId via its linked issue (preferred) or its
 * pipeline row (fallback). Returns null if the run does not exist.
 *
 * Lookup order:
 *   1. issue.projectId  — preferred; reflects where the work item lives.
 *   2. pipeline.projectId — fallback for runs not linked to an issue.
 */
export async function resolveProjectIdForRun(
  db: Database,
  runId: string
): Promise<string | null> {
  const [run] = await db
    .select()
    .from(pipelineRun)
    .where(eq(pipelineRun.id, runId));
  if (!run) return null;

  if (run.issueId) {
    const [issueRow] = await db
      .select({ projectId: issue.projectId })
      .from(issue)
      .where(eq(issue.id, run.issueId));
    if (issueRow?.projectId) return issueRow.projectId;
  }

  const [pipe] = await db
    .select({ projectId: pipeline.projectId })
    .from(pipeline)
    .where(eq(pipeline.id, run.pipelineId));
  return pipe?.projectId ?? null;
}
