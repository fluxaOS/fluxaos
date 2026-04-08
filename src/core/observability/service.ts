import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/core/db';
import { event, stageRun } from '@/core/db/schema';
import type { EventPayload } from './types';

export async function appendEvent(
  stageRunId: string,
  type: string,
  payload: EventPayload
) {
  const [created] = await db
    .insert(event)
    .values({
      stageRunId,
      type,
      payload,
    })
    .returning();

  return created;
}

export async function getStageEvents(stageRunId: string) {
  return db
    .select()
    .from(event)
    .where(eq(event.stageRunId, stageRunId))
    .orderBy(asc(event.timestamp));
}

export async function getRunEvents(pipelineRunId: string) {
  const stageRuns = await db
    .select({ id: stageRun.id })
    .from(stageRun)
    .where(eq(stageRun.pipelineRunId, pipelineRunId));

  if (stageRuns.length === 0) return [];

  const stageRunIds = stageRuns.map((sr) => sr.id);

  return db
    .select()
    .from(event)
    .where(inArray(event.stageRunId, stageRunIds))
    .orderBy(asc(event.timestamp));
}
