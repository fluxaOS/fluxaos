import { z } from 'zod';
import { appendEvent, getStageEvents } from '@/core/observability';
import {
  advancePipelineRun,
  cancelPipelineRun,
  createPipeline,
  createPipelineStage,
  deletePipeline,
  getPipeline,
  getPipelineKpis,
  getPipelineRun,
  getStageRun,
  justDoIt,
  listPipelineRuns,
  listPipelineStages,
  listPipelines,
  listRunsByProject,
  listStageRuns,
  requeueStageRun,
  startPipelineRun,
  transitionPipelineRun,
  transitionStageRun,
  updatePipeline,
} from '@/core/pipeline';
import { publicProcedure, router } from '@/server/trpc';

export const pipelineRouter = router({
  create: publicProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1),
        description: z.string().optional(),
        isDefault: z.boolean().optional(),
      })
    )
    .mutation(({ input }) => createPipeline(input)),

  list: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ input }) => listPipelines(input.projectId)),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => getPipeline(input.id)),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        isDefault: z.boolean().optional(),
      })
    )
    .mutation(({ input }) => {
      const { id, ...updates } = input;
      return updatePipeline(id, updates);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => deletePipeline(input.id)),

  // Stage management
  createStage: publicProcedure
    .input(
      z.object({
        pipelineId: z.string().uuid(),
        name: z.string().min(1),
        sortOrder: z.number().int().min(0),
        personaId: z.string().uuid().optional(),
        harness: z.string().optional(),
        timeoutSec: z.number().int().positive().optional(),
        maxRetries: z.number().int().min(0).optional(),
        gateMode: z.string().optional(),
        gateRules: z.unknown().optional(),
      })
    )
    .mutation(({ input }) => createPipelineStage(input)),

  stages: publicProcedure
    .input(z.object({ pipelineId: z.string().uuid() }))
    .query(({ input }) => listPipelineStages(input.pipelineId)),

  // Run lifecycle
  startRun: publicProcedure
    .input(
      z.object({
        pipelineId: z.string().uuid(),
        issueId: z.string().uuid().optional(),
      })
    )
    .mutation(({ input }) => startPipelineRun(input.pipelineId, input.issueId)),

  getRun: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => getPipelineRun(input.id)),

  listRuns: publicProcedure
    .input(z.object({ pipelineId: z.string().uuid() }))
    .query(({ input }) => listPipelineRuns(input.pipelineId)),

  listRunsByProject: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ input }) => listRunsByProject(input.projectId)),

  cancelRun: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => cancelPipelineRun(input.id)),

  // Stage runs
  stageRuns: publicProcedure
    .input(z.object({ pipelineRunId: z.string().uuid() }))
    .query(({ input }) => listStageRuns(input.pipelineRunId)),

  // Events
  events: publicProcedure
    .input(z.object({ stageRunId: z.string().uuid() }))
    .query(({ input }) => getStageEvents(input.stageRunId)),

  // Just Do It
  justDoIt: publicProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        prompt: z.string().min(1),
      })
    )
    .mutation(({ input }) => justDoIt(input.projectId, input.prompt)),

  // Gate approval
  approveStage: publicProcedure
    .input(z.object({ stageRunId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const sr = await getStageRun(input.stageRunId);
      await appendEvent(input.stageRunId, 'gate_approved', {});
      const result = await advancePipelineRun(sr.pipelineRunId);
      return result;
    }),

  rejectStage: publicProcedure
    .input(
      z.object({
        stageRunId: z.string().uuid(),
        verdict: z.enum(['rework', 'abort']),
      })
    )
    .mutation(async ({ input }) => {
      const sr = await getStageRun(input.stageRunId);
      await appendEvent(input.stageRunId, 'gate_rejected', {
        verdict: input.verdict,
      });

      if (input.verdict === 'rework') {
        await transitionStageRun(input.stageRunId, 'rework');
        await requeueStageRun(input.stageRunId);
        return { action: 'rework' as const, stageRunId: input.stageRunId };
      }

      // Abort — fail the stage and the pipeline
      await transitionStageRun(input.stageRunId, 'failed');
      await transitionPipelineRun(sr.pipelineRunId, 'failed');
      return { action: 'aborted' as const, stageRunId: input.stageRunId };
    }),

  kpis: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ input }) => getPipelineKpis(input.projectId)),
});
