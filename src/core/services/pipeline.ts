import { desc, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { pipeline, pipelineStage } from '@/core/db/schema';
import { createCrudService } from './crud-factory';

type PipelineInsert = typeof pipeline.$inferInsert;
type PipelineSelect = typeof pipeline.$inferSelect;
type StageInsert = typeof pipelineStage.$inferInsert;
type StageSelect = typeof pipelineStage.$inferSelect;

export function createPipelineService(db: Database) {
  const pipelineCrud = createCrudService<PipelineInsert, PipelineSelect>(
    db,
    pipeline
  );
  const stageCrud = createCrudService<StageInsert, StageSelect>(
    db,
    pipelineStage
  );

  return {
    ...pipelineCrud,

    async listByProject(projectId: string): Promise<PipelineSelect[]> {
      return db
        .select()
        .from(pipeline)
        .where(eq(pipeline.projectId, projectId))
        .orderBy(desc(pipeline.createdAt));
    },

    // Stage operations
    stages: {
      ...stageCrud,

      async listByPipeline(pipelineId: string): Promise<StageSelect[]> {
        return db
          .select()
          .from(pipelineStage)
          .where(eq(pipelineStage.pipelineId, pipelineId))
          .orderBy(pipelineStage.sortOrder);
      },
    },
  };
}

export type PipelineService = ReturnType<typeof createPipelineService>;
