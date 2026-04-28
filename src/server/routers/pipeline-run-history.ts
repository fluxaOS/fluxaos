import { asc, desc, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { pipelineRun, pipelineStage, stageRun } from '@/core/db/schema';

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

      const enrichedStageRuns = await Promise.all(
        rawStageRuns.map(async (sr) => {
          const [stageDef] = await db
            .select({
              name: pipelineStage.name,
              sortOrder: pipelineStage.sortOrder,
            })
            .from(pipelineStage)
            .where(eq(pipelineStage.id, sr.pipelineStageId));

          return { ...sr, pipelineStage: stageDef ?? null };
        })
      );

      return { ...run, stageRuns: enrichedStageRuns };
    })
  );
}
