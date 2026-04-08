import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/core/db';
import {
  pipeline,
  pipelineRun,
  pipelineStage,
  stageRun,
} from '@/core/db/schema';
import { appendEvent } from '@/core/observability';
import type {
  CreatePipelineInput,
  CreatePipelineStageInput,
  PipelineRunStatus,
  StageRunMetadata,
  StageRunStatus,
  UpdatePipelineInput,
} from './types';
import { PIPELINE_RUN_TRANSITIONS, STAGE_RUN_TRANSITIONS } from './types';

// ─── Pipeline CRUD ─────────────────────────────────────────────────────────

export async function createPipeline(input: CreatePipelineInput) {
  if (input.isDefault) {
    await db
      .update(pipeline)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(pipeline.projectId, input.projectId),
          eq(pipeline.isDefault, true)
        )
      );
  }

  const [created] = await db
    .insert(pipeline)
    .values({
      projectId: input.projectId,
      name: input.name,
      description: input.description ?? null,
      isDefault: input.isDefault ?? false,
    })
    .returning();

  return created;
}

export async function getPipeline(id: string) {
  const result = await db.query.pipeline.findFirst({
    where: eq(pipeline.id, id),
    with: { stages: { orderBy: [asc(pipelineStage.sortOrder)] } },
  });

  if (!result) {
    throw new Error(`Pipeline not found: ${id}`);
  }

  return result;
}

export async function getDefaultPipeline(projectId: string) {
  const result = await db.query.pipeline.findFirst({
    where: and(eq(pipeline.projectId, projectId), eq(pipeline.isDefault, true)),
    with: { stages: { orderBy: [asc(pipelineStage.sortOrder)] } },
  });

  if (!result) {
    throw new Error(`No default pipeline found for project: ${projectId}`);
  }

  return result;
}

export async function listPipelines(projectId: string) {
  return db
    .select()
    .from(pipeline)
    .where(eq(pipeline.projectId, projectId))
    .orderBy(asc(pipeline.name));
}

export async function updatePipeline(id: string, updates: UpdatePipelineInput) {
  const existing = await db.query.pipeline.findFirst({
    where: eq(pipeline.id, id),
  });

  if (!existing) {
    throw new Error(`Pipeline not found: ${id}`);
  }

  if (updates.isDefault) {
    await db
      .update(pipeline)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(pipeline.projectId, existing.projectId),
          eq(pipeline.isDefault, true),
          ne(pipeline.id, id)
        )
      );
  }

  const [updated] = await db
    .update(pipeline)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(pipeline.id, id))
    .returning();

  return updated;
}

export async function deletePipeline(id: string) {
  const existing = await db.query.pipeline.findFirst({
    where: eq(pipeline.id, id),
  });

  if (!existing) {
    throw new Error(`Pipeline not found: ${id}`);
  }

  // Cascade: stages, then pipeline
  await db.delete(pipelineStage).where(eq(pipelineStage.pipelineId, id));
  await db.delete(pipeline).where(eq(pipeline.id, id));

  return { deleted: true, id };
}

// ─── Pipeline Stage CRUD ───────────────────────────────────────────────────

export async function createPipelineStage(input: CreatePipelineStageInput) {
  const [created] = await db
    .insert(pipelineStage)
    .values({
      pipelineId: input.pipelineId,
      name: input.name,
      sortOrder: input.sortOrder,
      personaId: input.personaId ?? null,
      harness: input.harness ?? null,
      timeoutSec: input.timeoutSec ?? 300,
      maxRetries: input.maxRetries ?? 0,
      gateMode: input.gateMode ?? 'auto',
      gateRules: input.gateRules ?? null,
    })
    .returning();

  return created;
}

export async function listPipelineStages(pipelineId: string) {
  return db
    .select()
    .from(pipelineStage)
    .where(eq(pipelineStage.pipelineId, pipelineId))
    .orderBy(asc(pipelineStage.sortOrder));
}

// ─── Pipeline Run Lifecycle ────────────────────────────────────────────────

export async function startPipelineRun(
  pipelineId: string,
  issueId?: string | null
) {
  const pipe = await getPipeline(pipelineId);

  if (pipe.stages.length === 0) {
    throw new Error(`Pipeline has no stages: ${pipelineId}`);
  }

  // Create pipeline run
  const [run] = await db
    .insert(pipelineRun)
    .values({
      pipelineId,
      issueId: issueId ?? null,
      status: 'pending',
    })
    .returning();

  // Create stage runs for each stage
  for (const stage of pipe.stages) {
    await db.insert(stageRun).values({
      pipelineRunId: run.id,
      pipelineStageId: stage.id,
      status: 'queued',
    });
  }

  // Transition to running
  const [updated] = await db
    .update(pipelineRun)
    .set({
      status: 'running',
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(pipelineRun.id, run.id))
    .returning();

  return updated;
}

export async function getPipelineRun(id: string) {
  const run = await db.query.pipelineRun.findFirst({
    where: eq(pipelineRun.id, id),
    with: {
      stageRuns: {
        with: {
          pipelineStage: true,
          events: { orderBy: [asc(sql`timestamp`)] },
        },
      },
    },
  });

  if (!run) {
    throw new Error(`Pipeline run not found: ${id}`);
  }

  return run;
}

export async function listPipelineRuns(pipelineId: string) {
  return db
    .select()
    .from(pipelineRun)
    .where(eq(pipelineRun.pipelineId, pipelineId))
    .orderBy(desc(pipelineRun.createdAt));
}

export async function listRunsByProject(projectId: string) {
  return db
    .select({
      id: pipelineRun.id,
      pipelineId: pipelineRun.pipelineId,
      issueId: pipelineRun.issueId,
      status: pipelineRun.status,
      startedAt: pipelineRun.startedAt,
      completedAt: pipelineRun.completedAt,
      totalCostUsd: pipelineRun.totalCostUsd,
      createdAt: pipelineRun.createdAt,
      pipelineName: pipeline.name,
    })
    .from(pipelineRun)
    .innerJoin(pipeline, eq(pipelineRun.pipelineId, pipeline.id))
    .where(eq(pipeline.projectId, projectId))
    .orderBy(desc(pipelineRun.createdAt));
}

export async function transitionPipelineRun(
  id: string,
  newStatus: PipelineRunStatus
) {
  const existing = await db.query.pipelineRun.findFirst({
    where: eq(pipelineRun.id, id),
  });

  if (!existing) {
    throw new Error(`Pipeline run not found: ${id}`);
  }

  const currentStatus = existing.status as PipelineRunStatus;
  const allowed = PIPELINE_RUN_TRANSITIONS[currentStatus];

  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Invalid pipeline run transition: ${currentStatus} → ${newStatus}. Allowed: ${allowed.join(', ')}`
    );
  }

  const now = new Date();
  const updates: Record<string, unknown> = {
    status: newStatus,
    updatedAt: now,
  };

  if (
    newStatus === 'completed' ||
    newStatus === 'failed' ||
    newStatus === 'cancelled'
  ) {
    updates.completedAt = now;
  }

  const [updated] = await db
    .update(pipelineRun)
    .set(updates)
    .where(eq(pipelineRun.id, id))
    .returning();

  return updated;
}

// ─── Stage Run Lifecycle ───────────────────────────────────────────────────

export async function transitionStageRun(
  id: string,
  newStatus: StageRunStatus,
  metadata?: StageRunMetadata
) {
  const existing = await db.query.stageRun.findFirst({
    where: eq(stageRun.id, id),
  });

  if (!existing) {
    throw new Error(`Stage run not found: ${id}`);
  }

  const currentStatus = existing.status as StageRunStatus;
  const allowed = STAGE_RUN_TRANSITIONS[currentStatus];

  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Invalid stage run transition: ${currentStatus} → ${newStatus}. Allowed: ${allowed.join(', ')}`
    );
  }

  const now = new Date();
  const updates: Record<string, unknown> = {
    status: newStatus,
    updatedAt: now,
  };

  if (newStatus === 'running') {
    updates.startedAt = now;
  }
  if (
    newStatus === 'completed' ||
    newStatus === 'failed' ||
    newStatus === 'skipped'
  ) {
    updates.completedAt = now;
  }
  if (metadata) {
    if (metadata.provider) updates.provider = metadata.provider;
    if (metadata.model) updates.model = metadata.model;
    if (metadata.harness) updates.harness = metadata.harness;
    if (metadata.costUsd) updates.costUsd = metadata.costUsd;
    if (metadata.tokensIn !== undefined) updates.tokensIn = metadata.tokensIn;
    if (metadata.tokensOut !== undefined)
      updates.tokensOut = metadata.tokensOut;
  }

  const [updated] = await db
    .update(stageRun)
    .set(updates)
    .where(eq(stageRun.id, id))
    .returning();

  await appendEvent(id, `stage_${newStatus}`, {
    from: currentStatus,
    to: newStatus,
    ...(metadata ?? {}),
  });

  return updated;
}

export async function getNextStageRun(pipelineRunId: string) {
  const stageRuns = await db
    .select({
      id: stageRun.id,
      status: stageRun.status,
      sortOrder: pipelineStage.sortOrder,
    })
    .from(stageRun)
    .innerJoin(pipelineStage, eq(stageRun.pipelineStageId, pipelineStage.id))
    .where(eq(stageRun.pipelineRunId, pipelineRunId))
    .orderBy(asc(pipelineStage.sortOrder));

  // Find the first queued stage
  return stageRuns.find((sr) => sr.status === 'queued') ?? null;
}

export async function advancePipelineRun(pipelineRunId: string) {
  const next = await getNextStageRun(pipelineRunId);

  if (next) {
    return { action: 'next_stage' as const, stageRunId: next.id };
  }

  // All stages done — tally costs and complete
  await completePipelineRun(pipelineRunId);
  return { action: 'completed' as const, stageRunId: null };
}

export async function completePipelineRun(pipelineRunId: string) {
  // Sum costs from all stage runs
  const result = await db
    .select({
      totalCost: sql<string>`COALESCE(SUM(CAST(${stageRun.costUsd} AS NUMERIC)), 0)`,
    })
    .from(stageRun)
    .where(eq(stageRun.pipelineRunId, pipelineRunId));

  const totalCostUsd = result[0]?.totalCost ?? '0';

  const [updated] = await db
    .update(pipelineRun)
    .set({
      status: 'completed',
      completedAt: new Date(),
      totalCostUsd,
      updatedAt: new Date(),
    })
    .where(eq(pipelineRun.id, pipelineRunId))
    .returning();

  return updated;
}

export async function cancelPipelineRun(pipelineRunId: string) {
  const existing = await db.query.pipelineRun.findFirst({
    where: eq(pipelineRun.id, pipelineRunId),
  });

  if (!existing) {
    throw new Error(`Pipeline run not found: ${pipelineRunId}`);
  }

  // Skip all queued stages
  await db
    .update(stageRun)
    .set({ status: 'skipped', updatedAt: new Date() })
    .where(
      and(
        eq(stageRun.pipelineRunId, pipelineRunId),
        eq(stageRun.status, 'queued')
      )
    );

  // Cancel the pipeline run
  const [updated] = await db
    .update(pipelineRun)
    .set({
      status: 'cancelled',
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(pipelineRun.id, pipelineRunId))
    .returning();

  return updated;
}

export async function listStageRuns(pipelineRunId: string) {
  return db
    .select()
    .from(stageRun)
    .innerJoin(pipelineStage, eq(stageRun.pipelineStageId, pipelineStage.id))
    .where(eq(stageRun.pipelineRunId, pipelineRunId))
    .orderBy(asc(pipelineStage.sortOrder));
}

export async function getStageRun(id: string) {
  const result = await db.query.stageRun.findFirst({
    where: eq(stageRun.id, id),
    with: {
      pipelineStage: true,
      events: { orderBy: [asc(sql`timestamp`)] },
    },
  });

  if (!result) {
    throw new Error(`Stage run not found: ${id}`);
  }

  return result;
}

export async function requeueStageRun(id: string) {
  // rework → queued (for re-execution)
  return transitionStageRun(id, 'queued');
}

export async function getPipelineKpis(projectId: string) {
  const result = await db
    .select({
      totalRuns: sql<number>`COUNT(*)::int`,
      completedRuns: sql<number>`COUNT(*) FILTER (WHERE ${pipelineRun.status} = 'completed')::int`,
      failedRuns: sql<number>`COUNT(*) FILTER (WHERE ${pipelineRun.status} = 'failed')::int`,
      cancelledRuns: sql<number>`COUNT(*) FILTER (WHERE ${pipelineRun.status} = 'cancelled')::int`,
      runningRuns: sql<number>`COUNT(*) FILTER (WHERE ${pipelineRun.status} = 'running')::int`,
      totalCostUsd: sql<string>`COALESCE(SUM(CAST(${pipelineRun.totalCostUsd} AS NUMERIC)), 0)::text`,
    })
    .from(pipelineRun)
    .innerJoin(pipeline, eq(pipelineRun.pipelineId, pipeline.id))
    .where(eq(pipeline.projectId, projectId));

  const row = result[0];
  const totalRuns = row?.totalRuns ?? 0;
  const totalCostUsd = row?.totalCostUsd ?? '0';
  const avgCostUsd =
    totalRuns > 0
      ? (Number.parseFloat(totalCostUsd) / totalRuns).toFixed(6)
      : '0';

  return {
    totalRuns,
    completedRuns: row?.completedRuns ?? 0,
    failedRuns: row?.failedRuns ?? 0,
    cancelledRuns: row?.cancelledRuns ?? 0,
    runningRuns: row?.runningRuns ?? 0,
    successRate:
      totalRuns > 0
        ? Math.round(((row?.completedRuns ?? 0) / totalRuns) * 100)
        : 0,
    totalCostUsd,
    avgCostUsd,
  };
}
