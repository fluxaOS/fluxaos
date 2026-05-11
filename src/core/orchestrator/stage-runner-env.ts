// src/core/orchestrator/stage-runner-env.ts

/**
 * Stage-runner isolation-env setup helpers — extracted from stage-runner.ts
 * to keep each file under the 500-line ceiling. Nothing here talks to drivers
 * or subprocesses; it's purely "figure out which worktree this stage should
 * run in, and acquire it."
 */

import { and, desc, eq, isNotNull, ne } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { type issue, pipeline, pipelineRun, project } from '@/core/db/schema';
import type { GitOpsPort } from '@/core/ports/git';
import type {
  IsolationEnvironment,
  IsolationProvider,
} from '@/core/ports/isolation';

/**
 * Error raised when the stage-runner cannot locate the on-disk clone of the
 * target repo. Thrown when `project.targetRepoPath` is null for the project
 * being run (FLX-221 migration from env var to per-project column).
 */
export class MissingProjectTargetRepoPathError extends Error {
  readonly projectId: string;
  constructor(projectId: string) {
    super(
      `project.target_repo_path is null for project ${projectId}. ` +
        'The stage-runner needs an absolute path to the on-disk clone of ' +
        "this project's target repo to acquire an isolation worktree. " +
        'Set it via Settings → Projects, or update the project row directly.'
    );
    this.name = 'MissingProjectTargetRepoPathError';
    this.projectId = projectId;
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
  gitOps: GitOpsPort;
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
 * ask the isolation provider to acquire a worktree. Throws
 * MissingProjectTargetRepoPathError when the project's target_repo_path
 * column is null.
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

  const targetRepoPath = projectRow.targetRepoPath;
  if (!targetRepoPath) {
    throw new MissingProjectTargetRepoPathError(projectRow.id);
  }

  const repoIdentity = input.gitOps.resolveRepoIdentity({
    repoUrl: projectRow.repoUrl,
    repoPath: targetRepoPath,
  });

  const branchName = deriveBranchName({
    runId: input.runId,
    issueNumber: input.issueNumber ?? null,
  });

  const copyFiles = Array.isArray(projectRow.worktreeCopyFiles)
    ? (projectRow.worktreeCopyFiles as unknown[]).filter(
        (f): f is string => typeof f === 'string'
      )
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
