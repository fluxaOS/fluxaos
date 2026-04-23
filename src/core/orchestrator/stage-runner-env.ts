// src/core/orchestrator/stage-runner-env.ts

/**
 * Stage-runner isolation-env setup helpers — extracted from stage-runner.ts
 * to keep each file under the 500-line ceiling. Nothing here talks to drivers
 * or subprocesses; it's purely "figure out which worktree this stage should
 * run in, and acquire it."
 */

import { eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import type {
  IsolationEnvironment,
  IsolationProvider,
} from '@/core/ports/isolation';
import { project, issue, pipeline } from '@/core/db/schema';
import { resolveRepoIdentity } from '@/adapters/git';

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
        'the orchestrator.',
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
  input: ResolveProjectIdInput,
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
  issueNumber?: number | null;
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
  input: AcquireEnvInput,
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
      `Project ${projectRow.id} has no repoUrl — R-RUNTIME requires one.`,
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

  const env = await input.isolation.acquire({
    projectId: projectRow.id,
    runId: input.runId,
    repoPath: targetRepoPath,
    repoIdentity,
    branchName,
    baseBranch: projectRow.defaultBranch,
    copyFiles,
  });

  return { env, projectRow };
}
