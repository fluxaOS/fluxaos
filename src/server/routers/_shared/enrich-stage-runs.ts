import { eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { pipelineStage, stageRun } from '@/core/db/schema';
import { createPipelineRunService } from '@/core/orchestrator/pipeline-run-service';

type RawStageRun = typeof stageRun.$inferSelect;

interface EnrichOptions {
  includeGateMode?: boolean;
  includeEvents?: boolean;
}

/**
 * Enriches an array of raw stage runs with their pipeline stage definition and
 * optionally gate mode and events.
 *
 * Both callers were running an identical N+1 enrichment loop. This helper
 * centralises it so the shape stays consistent across the history list and the
 * run-detail view.
 *
 * @param db       - Database connection (or transaction).
 * @param rawStageRuns - Stage runs to enrich (already fetched by the caller).
 * @param opts     - `includeGateMode` adds `gateMode` to the pipelineStage
 *                   sub-object; `includeEvents` adds the full events array.
 *                   Both default to false (history list behaviour).
 */
export async function enrichStageRuns(
  db: Database,
  rawStageRuns: RawStageRun[],
  opts: EnrichOptions = {}
) {
  const { includeGateMode = false, includeEvents = false } = opts;
  const svc = includeEvents ? createPipelineRunService(db) : null;

  return Promise.all(
    rawStageRuns.map(async (sr) => {
      const [stageDef] = await db
        .select()
        .from(pipelineStage)
        .where(eq(pipelineStage.id, sr.pipelineStageId));

      const events = includeEvents && svc ? await svc.listEvents(sr.id) : undefined;

      const pipelineStageResult = stageDef
        ? {
            name: stageDef.name,
            sortOrder: stageDef.sortOrder,
            ...(includeGateMode ? { gateMode: stageDef.gateMode } : {}),
          }
        : null;

      return {
        ...sr,
        pipelineStage: pipelineStageResult,
        ...(includeEvents ? { events: events ?? [] } : {}),
      };
    })
  );
}
