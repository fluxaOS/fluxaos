/**
 * Pipeline Run Service — manages pipeline run and stage run lifecycle.
 *
 * Creates runs, advances stages, records events, updates costs.
 * No hardcoded stage names or provider names. Receives Database via DI.
 */
import { eq, and, asc, sql } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import {
  pipeline,
  pipelineStage,
  pipelineRun,
  stageRun,
  event,
  issueEvent,
  issue,
} from '@/core/db/schema';
import type {
  PipelineRunStatus,
  StageRunStatus,
  StageEventType,
} from './types';
import {
  STAGE_RUN_TERMINAL,
  STAGE_RUN_STATUS,
  PIPELINE_RUN_STATUS,
} from './types';

type PipelineRunRow = typeof pipelineRun.$inferSelect;
type StageRunRow = typeof stageRun.$inferSelect;
type StageRow = typeof pipelineStage.$inferSelect;

export interface PipelineRunService {
  /** Create a new pipeline run for an issue. */
  createRun(pipelineId: string, issueId: string): Promise<PipelineRunRow>;

  /** Get a pipeline run by ID. */
  getRun(id: string): Promise<PipelineRunRow | null>;

  /** Get all queued pipeline runs (ordered by creation). */
  getQueuedRuns(limit: number): Promise<PipelineRunRow[]>;

  /** Get all running pipeline runs. */
  getRunningRuns(): Promise<PipelineRunRow[]>;

  /** Update pipeline run status. */
  updateRunStatus(id: string, status: PipelineRunStatus): Promise<void>;

  /** Mark pipeline run as completed with cost aggregation. */
  completeRun(id: string, status: PipelineRunStatus): Promise<void>;

  /** Get ordered stages for a pipeline. */
  getStages(pipelineId: string): Promise<StageRow[]>;

  /** Create a stage run. */
  createStageRun(
    pipelineRunId: string,
    pipelineStageId: string,
  ): Promise<StageRunRow>;

  /** Get the current (latest non-terminal) stage run for a pipeline run. */
  getCurrentStageRun(pipelineRunId: string): Promise<StageRunRow | null>;

  /** Get all stage runs for a pipeline run (ordered by creation). */
  getStageRuns(pipelineRunId: string): Promise<StageRunRow[]>;

  /** Update stage run status. */
  updateStageRunStatus(id: string, status: StageRunStatus): Promise<void>;

  /** Update stage run with execution results. */
  completeStageRun(
    id: string,
    status: StageRunStatus,
    results: {
      provider?: string;
      model?: string;
      harness?: string;
      costUsd?: string;
      tokensIn?: number;
      tokensOut?: number;
    },
  ): Promise<void>;

  /** Append an event to the stage run event stream. */
  appendEvent(
    stageRunId: string,
    type: StageEventType,
    payload: Record<string, unknown>,
  ): Promise<void>;

  /** Get the next stage after the given one (by sortOrder). */
  getNextStage(
    pipelineId: string,
    currentSortOrder: number,
  ): Promise<StageRow | null>;

  /** Write an issue event (stage_started, stage_completed, etc.) */
  appendIssueEvent(
    issueId: string,
    type: string,
    payload: Record<string, unknown>,
    actor: string,
  ): Promise<void>;

  /** Fail both the stage run and the pipeline run in one call. */
  failStageAndRun(stageRunId: string, runId: string): Promise<void>;
}

export function createPipelineRunService(db: Database): PipelineRunService {
  return {
    async createRun(pipelineId, issueId) {
      const [row] = await db
        .insert(pipelineRun)
        .values({
          pipelineId,
          issueId,
          status: PIPELINE_RUN_STATUS.queued,
        })
        .returning();
      return row;
    },

    async getRun(id) {
      const [row] = await db
        .select()
        .from(pipelineRun)
        .where(eq(pipelineRun.id, id));
      return row ?? null;
    },

    async getQueuedRuns(limit) {
      return db
        .select()
        .from(pipelineRun)
        .where(eq(pipelineRun.status, PIPELINE_RUN_STATUS.queued))
        .orderBy(asc(pipelineRun.createdAt))
        .limit(limit);
    },

    async getRunningRuns() {
      return db
        .select()
        .from(pipelineRun)
        .where(eq(pipelineRun.status, PIPELINE_RUN_STATUS.running));
    },

    async updateRunStatus(id, status) {
      const updates: Record<string, unknown> = {
        status,
        updatedAt: new Date(),
      };
      if (status === PIPELINE_RUN_STATUS.running) {
        updates.startedAt = new Date();
      }
      await db
        .update(pipelineRun)
        .set(updates)
        .where(eq(pipelineRun.id, id));
    },

    async completeRun(id, status) {
      // Aggregate cost from all stage runs
      const stages = await db
        .select({ costUsd: stageRun.costUsd })
        .from(stageRun)
        .where(eq(stageRun.pipelineRunId, id));

      const totalCost = stages.reduce(
        (sum, s) => sum + Number(s.costUsd ?? 0),
        0,
      );

      await db
        .update(pipelineRun)
        .set({
          status,
          completedAt: new Date(),
          totalCostUsd: totalCost.toFixed(6),
          updatedAt: new Date(),
        })
        .where(eq(pipelineRun.id, id));
    },

    async getStages(pipelineId) {
      return db
        .select()
        .from(pipelineStage)
        .where(eq(pipelineStage.pipelineId, pipelineId))
        .orderBy(asc(pipelineStage.sortOrder));
    },

    async createStageRun(pipelineRunId, pipelineStageId) {
      const [row] = await db
        .insert(stageRun)
        .values({
          pipelineRunId,
          pipelineStageId,
          status: STAGE_RUN_STATUS.pending,
        })
        .returning();
      return row;
    },

    async getCurrentStageRun(pipelineRunId) {
      const rows = await db
        .select()
        .from(stageRun)
        .where(eq(stageRun.pipelineRunId, pipelineRunId))
        .orderBy(asc(stageRun.createdAt));

      // Find the last non-terminal stage run
      for (let i = rows.length - 1; i >= 0; i--) {
        if (!STAGE_RUN_TERMINAL.has(rows[i].status)) {
          return rows[i];
        }
      }
      return null;
    },

    async getStageRuns(pipelineRunId) {
      return db
        .select()
        .from(stageRun)
        .where(eq(stageRun.pipelineRunId, pipelineRunId))
        .orderBy(asc(stageRun.createdAt));
    },

    async updateStageRunStatus(id, status) {
      const updates: Record<string, unknown> = {
        status,
        updatedAt: new Date(),
      };
      if (status === STAGE_RUN_STATUS.running) {
        updates.startedAt = new Date();
      }
      await db
        .update(stageRun)
        .set(updates)
        .where(eq(stageRun.id, id));
    },

    async completeStageRun(id, status, results) {
      await db
        .update(stageRun)
        .set({
          status,
          completedAt: new Date(),
          provider: results.provider,
          model: results.model,
          harness: results.harness,
          costUsd: results.costUsd ?? '0',
          tokensIn: results.tokensIn ?? 0,
          tokensOut: results.tokensOut ?? 0,
          updatedAt: new Date(),
        })
        .where(eq(stageRun.id, id));
    },

    async appendEvent(stageRunId, type, payload) {
      await db.insert(event).values({
        stageRunId,
        type,
        payload,
      });
    },

    async getNextStage(pipelineId, currentSortOrder) {
      const [next] = await db
        .select()
        .from(pipelineStage)
        .where(
          and(
            eq(pipelineStage.pipelineId, pipelineId),
            sql`${pipelineStage.sortOrder} > ${currentSortOrder}`,
          ),
        )
        .orderBy(asc(pipelineStage.sortOrder))
        .limit(1);
      return next ?? null;
    },

    async appendIssueEvent(issueId, type, payload, actor) {
      await db.insert(issueEvent).values({
        issueId,
        actor,
        type,
        payload,
      });
    },

    async failStageAndRun(stageRunId, runId) {
      await db
        .update(stageRun)
        .set({
          status: STAGE_RUN_STATUS.failed,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(stageRun.id, stageRunId));
      await db
        .update(pipelineRun)
        .set({
          status: PIPELINE_RUN_STATUS.failed,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(pipelineRun.id, runId));
    },
  };
}
