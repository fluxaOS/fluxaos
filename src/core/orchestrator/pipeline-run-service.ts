/**
 * Pipeline Run Service — manages pipeline run and stage run lifecycle.
 *
 * Creates runs, advances stages, records events, updates costs.
 * No hardcoded stage names or provider names. Receives Database via DI.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import {
  event,
  issueEvent,
  pipelineRun,
  pipelineStage,
  stageRun,
} from '@/core/db/schema';
import type {
  PipelineRunStatus,
  StageEventType,
  StageRunStatus,
} from './types';
import {
  PIPELINE_RUN_STATUS,
  STAGE_RUN_STATUS,
  STAGE_RUN_TERMINAL,
} from './types';

type PipelineRunRow = typeof pipelineRun.$inferSelect;
type StageRunRow = typeof stageRun.$inferSelect;
type StageRow = typeof pipelineStage.$inferSelect;

export interface PipelineRunService {
  /** Create a new pipeline run for an issue. */
  createRun(pipelineId: string, issueId: string): Promise<PipelineRunRow>;

  /** Get a pipeline run by ID. */
  getRun(id: string): Promise<PipelineRunRow | null>;

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
    pipelineStageId: string
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
      driver?: string;
      costUsd?: string;
      tokensIn?: number;
      tokensOut?: number;
      skillSignal?: string;
      skillMetadata?: Record<string, unknown>;
      trigger?: string;
      errorMessage?: string;
    }
  ): Promise<void>;

  /** Append an event to the stage run event stream. */
  appendEvent(
    stageRunId: string,
    type: StageEventType,
    payload: Record<string, unknown>
  ): Promise<void>;

  /**
   * List events for a stage run.
   * Stream events (those whose payload carries `lineNumber`) are returned in
   * monotonic lineNumber order; lifecycle events (no lineNumber) keep their
   * timestamp position. See DEF-017.
   */
  listEvents(stageRunId: string): Promise<Array<typeof event.$inferSelect>>;

  /** Get the next stage after the given one (by sortOrder). */
  getNextStage(
    pipelineId: string,
    currentSortOrder: number
  ): Promise<StageRow | null>;

  /** Write an issue event (stage_started, stage_completed, etc.) */
  appendIssueEvent(
    issueId: string,
    type: string,
    payload: Record<string, unknown>,
    actor: string
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
          status: PIPELINE_RUN_STATUS.pending,
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
      await db.update(pipelineRun).set(updates).where(eq(pipelineRun.id, id));
    },

    async completeRun(id, status) {
      // Aggregate cost from all stage runs
      const stages = await db
        .select({ costUsd: stageRun.costUsd })
        .from(stageRun)
        .where(eq(stageRun.pipelineRunId, id));

      const totalCost = stages.reduce(
        (sum, s) => sum + Number(s.costUsd ?? 0),
        0
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
      await db.update(stageRun).set(updates).where(eq(stageRun.id, id));
    },

    async completeStageRun(id, status, results) {
      await db
        .update(stageRun)
        .set({
          status,
          completedAt: new Date(),
          provider: results.provider,
          model: results.model,
          driver: results.driver,
          costUsd: results.costUsd ?? '0',
          tokensIn: results.tokensIn ?? 0,
          tokensOut: results.tokensOut ?? 0,
          skillSignal: results.skillSignal,
          skillMetadata: results.skillMetadata,
          trigger: results.trigger,
          errorMessage: results.errorMessage,
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

    async listEvents(stageRunId) {
      // DEF-017: stream events (`lineNumber` in payload) are producer-clock
      // ordered; lifecycle events (no `lineNumber`) are DB-clock ordered.
      // The orchestrator fires off stream-event INSERTs concurrently, so the
      // postgres-js connection pool commits them out of producer order — DB
      // timestamps disagree with `lineNumber` order. Pull everything sorted by
      // timestamp, then merge: stream events restored to lineNumber order,
      // lifecycle events spliced back in at their timestamp position.
      const rows = await db
        .select()
        .from(event)
        .where(eq(event.stageRunId, stageRunId))
        .orderBy(asc(event.timestamp));

      const getLineNumber = (e: typeof event.$inferSelect): number | null => {
        const ln = (e.payload as { lineNumber?: unknown }).lineNumber;
        return typeof ln === 'number' ? ln : null;
      };

      const stream = rows
        .filter((e) => getLineNumber(e) !== null)
        .sort((a, b) => getLineNumber(a)! - getLineNumber(b)!);
      const lifecycle = rows.filter((e) => getLineNumber(e) === null);

      // Merge: walk lifecycle queue and splice each entry into the stream
      // timeline before the first stream event whose timestamp is strictly
      // greater than the lifecycle event's timestamp.
      const result: typeof rows = [];
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
    },

    async getNextStage(pipelineId, currentSortOrder) {
      const [next] = await db
        .select()
        .from(pipelineStage)
        .where(
          and(
            eq(pipelineStage.pipelineId, pipelineId),
            sql`${pipelineStage.sortOrder} > ${currentSortOrder}`
          )
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
