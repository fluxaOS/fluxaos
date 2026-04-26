// src/core/orchestrator/stage-runner-env.ts

/**
 * Stage-runner isolation-env setup helpers — extracted from stage-runner.ts
 * to keep each file under the 500-line ceiling. Nothing here talks to drivers
 * or subprocesses; it's purely "figure out which worktree this stage should
 * run in, and acquire it."
 */

import { and, desc, eq, isNotNull, ne } from 'drizzle-orm';
import { resolveRepoIdentity } from '@/adapters/git';
import type { Database } from '@/core/db/connection';
import { type issue, pipeline, pipelineRun, project } from '@/core/db/schema';
import type {
  IsolationEnvironment,
  IsolationProvider,
} from '@/core/ports/isolation';

/**
 * Error raised when the stage-runner cannot locate the on-disk clone of the
 * target repo. Thrown when `FLUXAOS_TARGET_REPO_PATH` is unset (alpha).
 */
export class TargetRepoPathMissingError extends Error {
  constructor() {
    super(
      'FLUXAOS_TARGET_REPO_PATH is not set. For R-RUNTIME alpha, the ' +
        'stage-runner uses this env var to locate the on-disk clone of the ' +
        'target repo (the one the isolation provider creates worktrees in). ' +
        'Set it to the absolute path of a checked-out clone before running ' +
        'the orchestrator.'
    );
    this.name = 'TargetRepoPathMissingError';
  }
}

interface ResolveProjectIdInput {
  db: Database;
  issueRow: typeof issue.$inferSelect | null;
  pipelineId: string;
}

/** Resolve the project id from issue (preferred) or pipeline (fallback). */
export async function resolveProjectId(
  input: ResolveProjectIdInput
): Promise<string | null> {
  if (input.issueRow?.projectId) return input.issueRow.projectId;
  const [pipe] = await input.db
    .select({ projectId: pipeline.projectId })
    .from(pipeline)
    .where(eq(pipeline.id, input.pipelineId));
  return pipe?.projectId ?? null;
}

/**
 * Derive the branch name the isolation provider should create. Single source
 * of truth for the fluxaos/issue-N-RUN convention.
 */
export function deriveBranchName(params: {
  runId: string;
  issueNumber?: number | null;
}): string {
  const runShort = params.runId.slice(0, 8);
  return params.issueNumber
    ? `fluxaos/issue-${params.issueNumber}-${runShort}`
    : `fluxaos/run-${runShort}`;
}

interface AcquireEnvInput {
  db: Database;
  isolation: IsolationProvider;
  projectId: string;
  runId: string;
  pipelineId: string;
  /**
   * issueId of the pipeline_run being set up. Used to find prior
   * pipeline_runs on the same (pipelineId, issueId) so their artifacts_path
   * can be inherited — alpha's per-stage "Run Stage" flow creates a fresh
   * pipeline_run per click, and without inheritance stage N can't see
   * artifacts written by stage N-1. See DEF-022.
   */
  issueId: string | null;
  issueNumber?: number | null;
}

/**
 * Look up the most-recent prior pipeline_run on the same (pipeline, issue)
 * that has a populated artifacts_path, so the new run can reuse it. Returns
 * null when no prior run exists or none had artifacts recorded — in that
 * case the isolation provider mints a fresh path. See DEF-022.
 */
async function findInheritedArtifactsPath(
  db: Database,
  pipelineId: string,
  issueId: string | null,
  currentRunId: string
): Promise<string | null> {
  if (!issueId) return null;
  const [prior] = await db
    .select({ artifactsPath: pipelineRun.artifactsPath })
    .from(pipelineRun)
    .where(
      and(
        eq(pipelineRun.pipelineId, pipelineId),
        eq(pipelineRun.issueId, issueId),
        ne(pipelineRun.id, currentRunId),
        isNotNull(pipelineRun.artifactsPath)
      )
    )
    .orderBy(desc(pipelineRun.createdAt))
    .limit(1);
  return prior?.artifactsPath ?? null;
}

export interface AcquireEnvResult {
  env: IsolationEnvironment;
  projectRow: typeof project.$inferSelect;
}

/**
 * Load the project row, resolve repoIdentity, derive the branch name, and
 * ask the isolation provider to acquire a worktree. Throws a typed error
 * when FLUXAOS_TARGET_REPO_PATH is missing.
 */
export async function acquireIsolationEnv(
  input: AcquireEnvInput
): Promise<AcquireEnvResult> {
  const [projectRow] = await input.db
    .select()
    .from(project)
    .where(eq(project.id, input.projectId));
  if (!projectRow) {
    throw new Error(`Project not found: ${input.projectId}`);
  }
  if (!projectRow.repoUrl) {
    throw new Error(
      `Project ${projectRow.id} has no repoUrl — R-RUNTIME requires one.`
    );
  }

  const targetRepoPath = process.env.FLUXAOS_TARGET_REPO_PATH;
  if (!targetRepoPath) {
    throw new TargetRepoPathMissingError();
  }

  const repoIdentity = resolveRepoIdentity({
    repoUrl: projectRow.repoUrl,
    repoPath: targetRepoPath,
  });

  const branchName = deriveBranchName({
    runId: input.runId,
    issueNumber: input.issueNumber ?? null,
  });

  const copyFiles = Array.isArray(projectRow.worktreeCopyFiles)
    ? (projectRow.worktreeCopyFiles as string[])
    : [];

  const inheritedArtifactsPath = await findInheritedArtifactsPath(
    input.db,
    input.pipelineId,
    input.issueId,
    input.runId
  );

  const env = await input.isolation.acquire({
    projectId: projectRow.id,
    runId: input.runId,
    repoPath: targetRepoPath,
    repoIdentity,
    branchName,
    baseBranch: projectRow.defaultBranch,
    copyFiles,
    artifactsPath: inheritedArtifactsPath ?? undefined,
  });

  return { env, projectRow };
}
