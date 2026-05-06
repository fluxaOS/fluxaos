/**
 * Shared helpers for pipeline run resolution.
 *
 * Extracted from event-orchestrator.ts and manual-run.ts to avoid three
 * parallel implementations of the same "given a run, find its projectId" logic.
 */
import { eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { issue, pipeline, pipelineRun } from '@/core/db/schema';

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
