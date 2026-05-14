import { asc, inArray } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { event, pipelineStage, type stageRun } from '@/core/db/schema';

type RawStageRun = typeof stageRun.$inferSelect;
type EventRow = typeof event.$inferSelect;

interface EnrichOptions {
  includeGateMode?: boolean;
  includeEvents?: boolean;
}

/**
 * Order the events for a single stage run using the same merge logic as
 * `pipeline-run-service.listEvents`: stream events (those with a numeric
 * `lineNumber` in payload) are sorted by lineNumber; lifecycle events are
 * spliced in at their timestamp position.
 */
function sortEvents(rows: EventRow[]): EventRow[] {
  const getLineNumber = (e: EventRow): number | null => {
    const ln = (e.payload as { lineNumber?: unknown }).lineNumber;
    return typeof ln === 'number' ? ln : null;
  };

  const stream = rows
    .filter((e) => getLineNumber(e) !== null)
    .sort((a, b) => getLineNumber(a)! - getLineNumber(b)!);
  const lifecycle = rows.filter((e) => getLineNumber(e) === null);

  const result: EventRow[] = [];
  let li = 0;
  for (const s of stream) {
    while (
      li < lifecycle.length &&
      new Date(lifecycle[li].timestamp).getTime() <=
        new Date(s.timestamp).getTime()
    ) {
      result.push(lifecycle[li++]);
    }
    result.push(s);
  }
  while (li < lifecycle.length) result.push(lifecycle[li++]);
  return result;
}

/**
 * Enriches an array of raw stage runs with their pipeline stage definition and
 * optionally gate mode and events.
 *
 * Both callers were running an identical N+1 enrichment loop. This helper
 * centralises it so the shape stays consistent across the history list and the
 * run-detail view.
 *
 * All DB lookups are batched: one query fetches all needed pipelineStage rows;
 * when includeEvents is true, one query fetches all event rows for all stage
 * run IDs, then they are grouped and sorted in memory.
 *
 * @param db           - Database connection (or transaction).
 * @param rawStageRuns - Stage runs to enrich (already fetched by the caller).
 * @param opts         - `includeGateMode` adds `gateMode` to the pipelineStage
 *                       sub-object; `includeEvents` adds the full events array.
 *                       Both default to false (history list behaviour).
 */
export async function enrichStageRuns(
  db: Database,
  rawStageRuns: RawStageRun[],
  opts: EnrichOptions = {}
) {
  if (rawStageRuns.length === 0) return [];

  const { includeGateMode = false, includeEvents = false } = opts;

  // Batch-fetch all pipelineStage rows needed by this set of stage runs.
  const stageIds = [...new Set(rawStageRuns.map((sr) => sr.pipelineStageId))];
  const stageDefs = await db
    .select()
    .from(pipelineStage)
    .where(inArray(pipelineStage.id, stageIds));
  const stageDefMap = new Map(stageDefs.map((s) => [s.id, s]));

  // Batch-fetch all events for these stage runs when requested.
  const eventsByStageRunId = new Map<string, EventRow[]>();
  if (includeEvents) {
    const stageRunIds = rawStageRuns.map((sr) => sr.id);
    const allEvents = await db
      .select()
      .from(event)
      .where(inArray(event.stageRunId, stageRunIds))
      .orderBy(asc(event.timestamp));

    // Group by stageRunId, then apply the stream/lifecycle merge sort per group.
    const grouped = new Map<string, EventRow[]>();
    for (const e of allEvents) {
      const bucket = grouped.get(e.stageRunId);
      if (bucket) {
        bucket.push(e);
      } else {
        grouped.set(e.stageRunId, [e]);
      }
    }
    for (const [id, rows] of grouped) {
      eventsByStageRunId.set(id, sortEvents(rows));
    }
  }

  return rawStageRuns.map((sr) => {
    const stageDef = stageDefMap.get(sr.pipelineStageId);

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
      ...(includeEvents ? { events: eventsByStageRunId.get(sr.id) ?? [] } : {}),
    };
  });
}
