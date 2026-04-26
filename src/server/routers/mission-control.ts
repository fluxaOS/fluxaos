/**
 * Mission-control reader — single tRPC query composing the four
 * sections of the operator dashboard.
 *
 * Read-only: the daemon writes the truth; we just project it. No
 * mutations live here. R-MISSION-CONTROL spec §R2.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod/v4';
import {
  PIPELINE_RUN_STATUS,
  PIPELINE_RUN_TERMINAL,
  STAGE_RUN_TERMINAL,
} from '@/core/constants';
import {
  issue,
  issuePullRequest,
  pipeline,
  pipelineRun,
  pipelineStage,
  stageRun,
} from '@/core/db/schema';
import { publicProcedure, router } from '../trpc';

export const missionRouter = router({
  summary: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const projectPipelines = await ctx.db
        .select({ id: pipeline.id, name: pipeline.name })
        .from(pipeline)
        .where(eq(pipeline.projectId, input.projectId));

      if (projectPipelines.length === 0) {
        return {
          pendingRuns: [],
          runningRuns: [],
          recentTerminal: [],
          recentPullRequests: [],
        };
      }

      const pipelineIds = projectPipelines.map((p) => p.id);
      const pipelineNameById = new Map(
        projectPipelines.map((p) => [p.id, p.name])
      );

      const [pendingRows, runningRows, terminalRows] = await Promise.all([
        ctx.db
          .select()
          .from(pipelineRun)
          .where(
            and(
              inArray(pipelineRun.pipelineId, pipelineIds),
              eq(pipelineRun.status, PIPELINE_RUN_STATUS.pending)
            )
          )
          .orderBy(desc(pipelineRun.createdAt))
          .limit(5),
        ctx.db
          .select()
          .from(pipelineRun)
          .where(
            and(
              inArray(pipelineRun.pipelineId, pipelineIds),
              eq(pipelineRun.status, PIPELINE_RUN_STATUS.running)
            )
          )
          .orderBy(desc(pipelineRun.startedAt)),
        ctx.db
          .select()
          .from(pipelineRun)
          .where(
            and(
              inArray(pipelineRun.pipelineId, pipelineIds),
              inArray(pipelineRun.status, [...PIPELINE_RUN_TERMINAL])
            )
          )
          .orderBy(desc(pipelineRun.completedAt))
          .limit(10),
      ]);

      // For running runs: most-recent non-terminal stage_run per run.
      const runningRuns = await Promise.all(
        runningRows.map(async (run) => {
          const stageRows = await ctx.db
            .select({
              id: stageRun.id,
              status: stageRun.status,
              pipelineStageId: stageRun.pipelineStageId,
              stageName: pipelineStage.name,
            })
            .from(stageRun)
            .leftJoin(
              pipelineStage,
              eq(stageRun.pipelineStageId, pipelineStage.id)
            )
            .where(eq(stageRun.pipelineRunId, run.id))
            .orderBy(desc(stageRun.createdAt));
          const current =
            stageRows.find((s) => !STAGE_RUN_TERMINAL.has(s.status)) ?? null;
          return {
            run: {
              ...run,
              pipelineName: pipelineNameById.get(run.pipelineId) ?? '',
            },
            currentStage: current
              ? {
                  id: current.id,
                  name: current.stageName ?? '?',
                  status: current.status,
                }
              : null,
          };
        })
      );

      // For terminal runs: last stage_run by createdAt.
      const recentTerminal = await Promise.all(
        terminalRows.map(async (run) => {
          const [last] = await ctx.db
            .select({
              id: stageRun.id,
              status: stageRun.status,
              stageName: pipelineStage.name,
            })
            .from(stageRun)
            .leftJoin(
              pipelineStage,
              eq(stageRun.pipelineStageId, pipelineStage.id)
            )
            .where(eq(stageRun.pipelineRunId, run.id))
            .orderBy(desc(stageRun.createdAt))
            .limit(1);
          return {
            run: {
              ...run,
              pipelineName: pipelineNameById.get(run.pipelineId) ?? '',
            },
            finalStage: last
              ? {
                  id: last.id,
                  name: last.stageName ?? '?',
                  status: last.status,
                }
              : null,
          };
        })
      );

      // Project-scoped issue ids for PR filtering.
      const projectIssues = await ctx.db
        .select({ id: issue.id, title: issue.title })
        .from(issue)
        .where(eq(issue.projectId, input.projectId));
      const issueTitleById = new Map(projectIssues.map((i) => [i.id, i.title]));

      const recentPullRequests =
        projectIssues.length === 0
          ? []
          : await ctx.db
              .select({
                id: issuePullRequest.id,
                issueId: issuePullRequest.issueId,
                prNumber: issuePullRequest.prNumber,
                prUrl: issuePullRequest.prUrl,
                title: issuePullRequest.title,
                state: issuePullRequest.state,
                headBranch: issuePullRequest.headBranch,
                createdAt: issuePullRequest.createdAt,
              })
              .from(issuePullRequest)
              .where(
                inArray(
                  issuePullRequest.issueId,
                  projectIssues.map((i) => i.id)
                )
              )
              .orderBy(desc(issuePullRequest.createdAt))
              .limit(10);

      const recentPullRequestsEnriched = recentPullRequests.map((pr) => ({
        ...pr,
        issueTitle: issueTitleById.get(pr.issueId) ?? '',
      }));

      const pendingEnriched = pendingRows.map((run) => ({
        ...run,
        pipelineName: pipelineNameById.get(run.pipelineId) ?? '',
        issueTitle: run.issueId ? (issueTitleById.get(run.issueId) ?? '') : '',
      }));

      const runningEnriched = runningRuns.map((r) => ({
        ...r,
        run: {
          ...r.run,
          issueTitle: r.run.issueId
            ? (issueTitleById.get(r.run.issueId) ?? '')
            : '',
        },
      }));

      const terminalEnriched = recentTerminal.map((r) => ({
        ...r,
        run: {
          ...r.run,
          issueTitle: r.run.issueId
            ? (issueTitleById.get(r.run.issueId) ?? '')
            : '',
        },
      }));

      return {
        pendingRuns: pendingEnriched,
        runningRuns: runningEnriched,
        recentTerminal: terminalEnriched,
        recentPullRequests: recentPullRequestsEnriched,
      };
    }),
});
