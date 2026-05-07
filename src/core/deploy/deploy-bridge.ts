/**
 * Deploy Bridge — end-of-pipeline hook that commits worktree changes, pushes
 * the branch, opens a PR, records the branch + PR against the issue, and
 * advances the issue to the next state.
 *
 * Sequence:
 *   1. Resolve run → issue → project → active isolation env.
 *   2. commitAll() inside the worktree. If nothing to commit, short-circuit
 *      with `{ skipped: 'no-changes' }` so the orchestrator can still mark
 *      the run complete without manufacturing a PR.
 *   3. push() the branch with --set-upstream.
 *   4. registry.get<GitProvider>('git').createPullRequest().
 *   5. Single Drizzle transaction: insert issue_branch, insert
 *      issue_pull_request, advance issue state (via issueService.transition).
 *   6. isolation.release() OUTSIDE the transaction (filesystem side effect).
 *      UncommittedChangesError is swallowed — we just committed everything.
 *
 * Failure handling:
 *   - commit / push / createPR → throw DeployBridgeError with typed cause.
 *     Orchestrator decides what to do.
 *   - transaction after a successful createPR → log deploy.inconsistent_state
 *     and re-throw. Alpha accepts a live PR without a DB record (operator
 *     reconciles manually); an auto-cleanup reconciler is post-alpha.
 *
 * Zero vendor imports in the factory signature. GitProvider comes through
 * the adapter registry, which keeps the bridge DI-clean.
 */

import { and, desc, eq } from 'drizzle-orm';
import { DEPLOY_RUN_STATUS, SYSTEM_ACTOR } from '@/core/constants';
import type { Database } from '@/core/db/connection';
import {
  deployRun,
  issue,
  issueBranch,
  issuePullRequest,
  pipelineRun,
  pipelineStage,
  project,
  stageRun,
} from '@/core/db/schema';
import { UncommittedChangesError } from '@/core/errors/git';
import type { GitOpsPort, GitProvider, PullRequest } from '@/core/ports/git';
import type { GitProviderFactory } from '@/core/ports/git-factory';
import type { IsolationProvider } from '@/core/ports/isolation';
import type { IssueService } from '@/core/services/issue';
import type { AdapterRegistryLike } from './registry-types';
import { buildCommitMessage, buildPrBody, buildPrTitle } from './templates';

// ── Logger contract (mirrors cleanup-service.ts) ─────────────────────────────

export interface DeployBridgeLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

// ── Result + error types ─────────────────────────────────────────────────────

export type DeployResult =
  | {
      skipped: null;
      pr: PullRequest;
      branchRowId: string;
      prRowId: string;
      commitSha?: string;
    }
  | { skipped: 'no-issue' }
  | { skipped: 'no-changes' };

export type DeployErrorStage =
  | 'load-run'
  | 'load-issue'
  | 'load-project'
  | 'find-env'
  | 'commit'
  | 'push'
  | 'create-pr'
  | 'record-db'
  | 'release-env';

export class DeployBridgeError extends Error {
  public readonly stage: DeployErrorStage;
  public readonly cause?: unknown;

  constructor(stage: DeployErrorStage, message: string, cause?: unknown) {
    super(message);
    this.name = 'DeployBridgeError';
    this.stage = stage;
    this.cause = cause;
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export interface DeployBridgeDeps {
  db: Database;
  registry: AdapterRegistryLike;
  logger: DeployBridgeLogger;
  isolation: IsolationProvider;
  issueService: IssueService;
  /** Local git operations — injected so core never imports from adapters. */
  gitOps: GitOpsPort;
}

export interface DeployBridge {
  deploy(runId: string): Promise<DeployResult>;
}

export function createDeployBridge(deps: DeployBridgeDeps): DeployBridge {
  const { db, registry, logger, isolation, issueService, gitOps } = deps;

  async function deploy(runId: string): Promise<DeployResult> {
    // 1. Load run
    const [runRow] = await db
      .select()
      .from(pipelineRun)
      .where(eq(pipelineRun.id, runId));
    if (!runRow) {
      throw new DeployBridgeError(
        'load-run',
        `pipeline_run ${runId} not found`
      );
    }

    if (!runRow.issueId) {
      logger.info(
        { runId, event: 'deploy.skipped' },
        'deploy.skipped: no issue attached to run'
      );
      await db.insert(deployRun).values({
        pipelineRunId: runId,
        status: DEPLOY_RUN_STATUS.skipped,
        skippedReason: 'no-issue',
        completedAt: new Date(),
      });
      return { skipped: 'no-issue' };
    }

    // 2. Load issue + project
    const [issueRow] = await db
      .select()
      .from(issue)
      .where(eq(issue.id, runRow.issueId));
    if (!issueRow) {
      throw new DeployBridgeError(
        'load-issue',
        `issue ${runRow.issueId} not found`
      );
    }

    const [projectRow] = await db
      .select()
      .from(project)
      .where(eq(project.id, issueRow.projectId));
    if (!projectRow) {
      throw new DeployBridgeError(
        'load-project',
        `project ${issueRow.projectId} not found`
      );
    }
    if (!projectRow.repoUrl) {
      throw new DeployBridgeError(
        'load-project',
        `project ${projectRow.id} has no repoUrl — cannot deploy`
      );
    }

    // 3. Find active isolation env
    const env = await isolation.findActiveByRun(projectRow.id, runId);
    if (!env) {
      throw new DeployBridgeError(
        'find-env',
        `no active isolation env for run ${runId} — deploy called without a worktree`
      );
    }

    // 4. Parse project.repoUrl into owner/name for the GitProvider.
    const identity = gitOps.resolveRepoIdentity({
      repoUrl: projectRow.repoUrl,
    });
    const repoSlug = `${identity.owner}/${identity.repo}`;

    // 5. Discover the most recent stage_run for the commit message prefix.
    const stageName = await loadMostRecentStageName(db, runId);

    // 6. commitAll()
    const commitMessage = buildCommitMessage({
      issue: {
        id: issueRow.id,
        number: issueRow.number,
        title: issueRow.title,
      },
      run: { id: runRow.id },
      project: { id: projectRow.id, name: projectRow.name },
      stageName,
    });

    let commitResult;
    try {
      commitResult = await gitOps.commitAll(env.workingPath, commitMessage);
    } catch (err) {
      throw new DeployBridgeError(
        'commit',
        `git commit failed in ${env.workingPath}: ${errorMessage(err)}`,
        err
      );
    }

    // FLX-92: stage-runner now auto-commits worker output mid-pipeline,
    // so commitResult.noChanges here only means "deploy bridge added no
    // NEW commits" — not "branch has nothing to push". Fall through to
    // push + PR creation as long as the branch is ahead of the base.
    let commitSha = commitResult.commitSha;
    if (commitResult.noChanges) {
      const ahead = await gitOps.branchAheadCount(
        env.workingPath,
        projectRow.defaultBranch
      );
      if (ahead === 0) {
        logger.info(
          { runId, envId: env.id, event: 'deploy.skipped' },
          'deploy.skipped: worktree clean and branch has no commits ahead of base'
        );
        await db.insert(deployRun).values({
          pipelineRunId: runId,
          status: DEPLOY_RUN_STATUS.skipped,
          skippedReason: 'no-changes',
          completedAt: new Date(),
        });
        return { skipped: 'no-changes' };
      }
      // Branch has commits (from stage-runner auto-commits) — capture
      // current HEAD so the PR body links to a real SHA.
      commitSha = await gitOps.getHeadSha(env.workingPath);
      logger.info(
        {
          runId,
          envId: env.id,
          event: 'deploy.using_existing_commits',
          ahead,
          commitSha,
        },
        'deploy: branch ahead of base via stage-runner commits — pushing existing'
      );
    }
    if (!commitSha) {
      throw new DeployBridgeError(
        'commit',
        'deploy bridge could not resolve a commit SHA — neither commitAll nor getHeadSha produced one'
      );
    }

    // 7. push()
    try {
      await gitOps.push(env.workingPath, env.branchName, { setUpstream: true });
    } catch (err) {
      throw new DeployBridgeError(
        'push',
        `git push failed for ${env.branchName}: ${errorMessage(err)}`,
        err
      );
    }

    // 8. createPullRequest — resolve the right forge adapter from the
    // project's repoUrl when one is set (FLX-4); fall back to the
    // legacy single-adapter registration so call sites without a URL
    // (or with an unrecognized host) keep working.
    const gitProvider = resolveGitProviderForProject(
      registry,
      projectRow.repoUrl
    );
    const prTitle = buildPrTitle({
      id: issueRow.id,
      number: issueRow.number,
      title: issueRow.title,
    });
    const prBody = buildPrBody({
      issue: {
        id: issueRow.id,
        number: issueRow.number,
        title: issueRow.title,
      },
      run: { id: runRow.id },
      project: { id: projectRow.id, name: projectRow.name },
      commitSha,
    });

    let pr: PullRequest;
    try {
      pr = await gitProvider.createPullRequest({
        repo: repoSlug,
        title: prTitle,
        body: prBody,
        headBranch: env.branchName,
        baseBranch: projectRow.defaultBranch,
        draft: false,
      });
    } catch (err) {
      throw new DeployBridgeError(
        'create-pr',
        `createPullRequest failed for ${repoSlug}: ${errorMessage(err)}`,
        err
      );
    }

    // 9. Single transaction: insert branch + PR + deploy_run + advance state.
    //    If this fails after the PR was opened, we log loudly and re-throw —
    //    per alpha scope, the operator reconciles manually.
    let dbResult: { branchRowId: string; prRowId: string };
    try {
      dbResult = await db.transaction(async (tx) => {
        const [branchRow] = await tx
          .insert(issueBranch)
          .values({
            issueId: issueRow.id,
            repo: repoSlug,
            branchName: env.branchName,
            isPrimary: true,
            createdBy: SYSTEM_ACTOR,
          })
          .returning({ id: issueBranch.id });

        const [prRow] = await tx
          .insert(issuePullRequest)
          .values({
            issueId: issueRow.id,
            repo: repoSlug,
            provider: gitProvider.providerName(),
            prNumber: pr.number,
            prUrl: pr.url,
            title: pr.title,
            state: pr.state,
            headBranch: pr.headBranch,
            baseBranch: pr.baseBranch,
            author: null,
            isPrimary: true,
          })
          .returning({ id: issuePullRequest.id });

        await tx.insert(deployRun).values({
          pipelineRunId: runId,
          status: DEPLOY_RUN_STATUS.succeeded,
          prRowId: prRow.id,
          branchRowId: branchRow.id,
          commitSha,
          completedAt: new Date(),
        });

        // FLX-79: post-deploy state advance is config-driven, not literal.
        // The seeded value resolves to whatever the operator configured;
        // the engine never holds the literal — repoint via config_entry.
        const postDeployState = await issueService.getStateByConfigKey(
          issueRow.projectId,
          'issues.state.on_deploy_complete_key'
        );
        await issueService.transition(
          issueRow.id,
          postDeployState.id,
          issueRow.version,
          issueRow.projectId,
          'deploy-bridge'
        );

        return { branchRowId: branchRow.id, prRowId: prRow.id };
      });
    } catch (err) {
      logger.error(
        {
          runId,
          issueId: issueRow.id,
          prNumber: pr.number,
          prUrl: pr.url,
          event: 'deploy.inconsistent_state',
          error: errorMessage(err),
        },
        'deploy.inconsistent_state: PR opened on remote but DB record / state advance failed'
      );
      throw new DeployBridgeError(
        'record-db',
        `DB transaction failed after PR #${pr.number} was created: ${errorMessage(err)}`,
        err
      );
    }

    // 10. Release env OUTSIDE the transaction. Swallow UncommittedChangesError
    //     — we just committed everything; any remaining dirt is noise.
    try {
      await isolation.release(env.id);
    } catch (err) {
      if (err instanceof UncommittedChangesError) {
        logger.warn(
          {
            runId,
            envId: env.id,
            event: 'deploy.release_dirty',
          },
          'deploy.release_dirty: worktree still dirty after commit — swallowing'
        );
      } else {
        // Non-fatal to the deploy outcome: log and continue. The cleanup
        // service will reap the env on its next sweep.
        logger.warn(
          {
            runId,
            envId: env.id,
            event: 'deploy.release_failed',
            error: errorMessage(err),
          },
          'deploy.release_failed: env left active, cleanup service will reap'
        );
      }
    }

    logger.info(
      {
        runId,
        issueId: issueRow.id,
        prNumber: pr.number,
        prUrl: pr.url,
        branchName: env.branchName,
        commitSha,
        event: 'deploy.succeeded',
      },
      'deploy.succeeded'
    );

    return {
      skipped: null,
      pr,
      branchRowId: dbResult.branchRowId,
      prRowId: dbResult.prRowId,
      commitSha,
    };
  }

  return { deploy };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loadMostRecentStageName(
  db: Database,
  runId: string
): Promise<string | null> {
  const rows = await db
    .select({ name: pipelineStage.name })
    .from(stageRun)
    .innerJoin(pipelineStage, eq(stageRun.pipelineStageId, pipelineStage.id))
    .where(and(eq(stageRun.pipelineRunId, runId)))
    .orderBy(desc(stageRun.createdAt))
    .limit(1);
  return rows[0]?.name ?? null;
}

/**
 * FLX-4 — pick the GitProvider for a project's repoUrl. Prefers the
 * factory ('gitFactory') when registered; falls back to the legacy
 * 'git' adapter for backward compat.
 */
function resolveGitProviderForProject(
  registry: AdapterRegistryLike,
  repoUrl: string | null | undefined
): GitProvider {
  try {
    const factory = registry.get<GitProviderFactory>('gitFactory');
    return factory.forUrl(repoUrl ?? '');
  } catch {
    // Factory not registered (legacy bootstrap, integration tests with
    // a hand-rolled registry stub, etc.) — use the single 'git' adapter.
    return registry.get<GitProvider>('git');
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
