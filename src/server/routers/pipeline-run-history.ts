import { asc, desc, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { pipelineRun, stageRun } from '@/core/db/schema';
import { enrichStageRuns } from './_shared/enrich-stage-runs';

export async function listIssueRunsWithStages(db: Database, issueId: string) {
  const runs = await db
    .select()
    .from(pipelineRun)
    .where(eq(pipelineRun.issueId, issueId))
    .orderBy(desc(pipelineRun.createdAt));

  return Promise.all(
    runs.map(async (run) => {
      const rawStageRuns = await db
        .select()
        .from(stageRun)
        .where(eq(stageRun.pipelineRunId, run.id))
        .orderBy(asc(stageRun.createdAt));

      const enrichedStageRuns = await enrichStageRuns(db, rawStageRuns);

      return { ...run, stageRuns: enrichedStageRuns };
    })
  );
}
