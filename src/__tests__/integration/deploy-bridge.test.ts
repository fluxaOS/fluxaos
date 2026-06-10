/**
 * Integration tests: deploy bridge against real Supabase + real git worktree.
 *
 * Uses a mocked GitProvider to avoid real GitHub API calls; every other
 * dependency (DB, isolation provider, git shell-outs) is real. Disposable
 * tmpdir repos are torn down in afterAll.
 */
import 'dotenv/config';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGitOps } from '@/adapters/git/git-ops';
import { createWorktreeIsolationProvider } from '@/adapters/git/worktree-isolation-provider';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import {
  type AdapterRegistryLike,
  createDeployBridge,
  type DeployBridgeLogger,
} from '@/core/deploy';
import type { GitProvider, PullRequest } from '@/core/ports/git';
import type { GitProviderFactory } from '@/core/ports/git-factory';
import { createIssueService } from '@/core/services/issue';
import { deleteOrgFixture } from './cleanup-fixtures';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();
const execFileAsync = promisify(execFile);

const RUN = Date.now();
const orgIds: string[] = [];
const tmpRepos: string[] = [];

async function gitInTmp(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

async function makeRepo(label: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `fluxaos-deploy-${label}-${RUN}-`));
  tmpRepos.push(dir);
  await gitInTmp(dir, ['init', '-b', 'main']);
  await gitInTmp(dir, ['config', 'user.email', 'deploy@fluxaos.local']);
  await gitInTmp(dir, ['config', 'user.name', 'DeployTest']);
  await gitInTmp(dir, ['commit', '--allow-empty', '-m', 'initial']);
  return dir;
}

function makeLogger(): DeployBridgeLogger & {
  records: { level: string; obj: Record<string, unknown>; msg?: string }[];
} {
  const records: {
    level: string;
    obj: Record<string, unknown>;
    msg?: string;
  }[] = [];
  return {
    records,
    info: (obj, msg) => records.push({ level: 'info', obj, msg }),
    warn: (obj, msg) => records.push({ level: 'warn', obj, msg }),
    error: (obj, msg) => records.push({ level: 'error', obj, msg }),
  };
}

interface Fixture {
  repoPath: string;
  projectId: string;
  pipelineId: string;
  runId: string;
  issueId: string;
  implementStateId: string;
  reviewStateId: string;
}

async function makeFixture(
  label: string,
  attachIssue = true
): Promise<Fixture> {
  const repoPath = await makeRepo(label);

  const [org] = await db
    .insert(schema.organization)
    .values({
      name: `deploy-org-${label}-${RUN}`,
    })
    .returning();
  orgIds.push(org.id);

  const [userRow] = await db
    .insert(schema.user)
    .values({
      orgId: org.id,
      email: `deploy-${label}-${RUN}@test.local`,
      name: 'Deploy',
    })
    .returning();

  const [teamRow] = await db
    .insert(schema.team)
    .values({ orgId: org.id, name: `deploy-team-${label}-${RUN}` })
    .returning();

  const [projectRow] = await db
    .insert(schema.project)
    .values({
      orgId: org.id,
      teamId: teamRow.id,
      name: `deploy-proj-${label}-${RUN}`,
      repoUrl: 'https://github.com/fluxaos/deploy-test-fixture',
      defaultBranch: 'main',
    })
    .returning();
  await db
    .insert(schema.projectMember)
    .values({ userId: userRow.id, projectId: projectRow.id });

  const [pipelineRow] = await db
    .insert(schema.pipeline)
    .values({
      projectId: projectRow.id,
      name: `deploy-pipe-${label}`,
    })
    .returning();

  // Catalog bootstrap — minimum to construct an issue + transition to review.
  const [typeRow] = await db
    .insert(schema.issueType)
    .values({
      projectId: projectRow.id,
      key: 'task',
      displayName: 'Task',
      color: '#000',
      sortOrder: 0,
      isActive: true,
    })
    .returning();

  const [implementState] = await db
    .insert(schema.issueState)
    .values({
      projectId: projectRow.id,
      key: 'implement',
      displayName: 'Implement',
      color: '#a855f7',
      sortOrder: 30,
      isActive: true,
      isTerminal: false,
    })
    .returning();

  const [reviewState] = await db
    .insert(schema.issueState)
    .values({
      projectId: projectRow.id,
      key: 'review',
      displayName: 'Review',
      color: '#f59e0b',
      sortOrder: 40,
      isActive: true,
      isTerminal: false,
    })
    .returning();

  // FLX-79: deploy bridge reads the post-deploy state from this config_entry.
  await db
    .insert(schema.configEntry)
    .values({
      scope: 'project',
      projectId: projectRow.id,
      key: 'issues.state.on_deploy_complete_key',
      value: '"review"',
    })
    .returning();

  await db
    .insert(schema.issueTransition)
    .values({
      projectId: projectRow.id,
      fromStateId: implementState.id,
      toStateId: reviewState.id,
      description: 'Submit for review',
      sortOrder: 1,
      isActive: true,
    })
    .returning();

  const [statusRow] = await db
    .insert(schema.issueStatus)
    .values({
      projectId: projectRow.id,
      key: 'open',
      displayName: 'Open',
      sortOrder: 0,
      isActive: true,
    })
    .returning();

  const [priorityRow] = await db
    .insert(schema.issuePriority)
    .values({
      projectId: projectRow.id,
      key: 'normal',
      displayName: 'Normal',
      color: '#000',
      weight: 0,
      isActive: true,
    })
    .returning();

  const [issueRow] = await db
    .insert(schema.issue)
    .values({
      projectId: projectRow.id,
      typeId: typeRow.id,
      stateId: implementState.id,
      statusId: statusRow.id,
      priorityId: priorityRow.id,
      title: `deploy bridge issue ${label}`,
      number: 1,
      author: 'system',
    })
    .returning();

  const [runRow] = await db
    .insert(schema.pipelineRun)
    .values({
      pipelineId: pipelineRow.id,
      issueId: attachIssue ? issueRow.id : null,
      status: 'running',
    })
    .returning();

  return {
    repoPath,
    projectId: projectRow.id,
    pipelineId: pipelineRow.id,
    runId: runRow.id,
    issueId: issueRow.id,
    implementStateId: implementState.id,
    reviewStateId: reviewState.id,
  };
}

function makeFakePr(headBranch: string): PullRequest {
  return {
    number: 4242,
    title: `deploy test (${headBranch})`,
    body: 'test body',
    state: 'open',
    headBranch,
    baseBranch: 'main',
    url: `https://github.com/fluxaos/deploy-test-fixture/pull/4242`,
    createdAt: new Date(),
  };
}

interface FakeGitProviderHarness {
  provider: GitProvider;
  createPullRequest: ReturnType<typeof vi.fn>;
}

function makeFakeGitProvider(result?: PullRequest): FakeGitProviderHarness {
  const createPullRequest = vi.fn(async (params: { headBranch: string }) => {
    return result ?? makeFakePr(params.headBranch);
  });
  const stub = () => {
    throw new Error('not used in tests');
  };
  const provider: GitProvider = {
    providerName: () => 'github',
    createBranch: stub as unknown as GitProvider['createBranch'],
    createPullRequest:
      createPullRequest as unknown as GitProvider['createPullRequest'],
    getPullRequest: stub as unknown as GitProvider['getPullRequest'],
    listPullRequests: stub as unknown as GitProvider['listPullRequests'],
    mergePullRequest: stub as unknown as GitProvider['mergePullRequest'],
  };
  return { provider, createPullRequest };
}

function makeFakeRegistry(gitProvider: GitProvider): AdapterRegistryLike {
  const factory: GitProviderFactory = {
    forUrl: () => gitProvider,
    detectForge: () => 'github',
  };
  return {
    get<T>(name: string): T {
      if (name === 'gitFactory') return factory as unknown as T;
      throw new Error(`unknown adapter: ${name}`);
    },
  };
}

afterAll(async () => {
  for (const orgId of orgIds) {
    await deleteOrgFixture(db, orgId);
  }
  for (const dir of tmpRepos) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  await provider.close();
}, 30000);

describe('DeployBridge', () => {
  let fixture: Fixture;
  let isolationProvider: ReturnType<typeof createWorktreeIsolationProvider>;

  beforeAll(async () => {
    fixture = await makeFixture('a');
    isolationProvider = createWorktreeIsolationProvider({ db });
  }, 30000);

  it('happy path: commits, pushes, creates PR, records rows, advances state, releases env', async () => {
    // Acquire a worktree for the run.
    const env = await isolationProvider.acquire({
      projectId: fixture.projectId,
      runId: fixture.runId,
      repoPath: fixture.repoPath,
      repoIdentity: {
        owner: 'fluxaos',
        repo: 'deploy-test-fixture',
      },
      branchName: `fluxaos/deploy-${RUN}-happy`,
      baseBranch: 'main',
    });

    // Dirty the worktree so commitAll has something to commit.
    await writeFile(
      join(env.workingPath, 'deploy.txt'),
      'contents from deploy-bridge test'
    );

    // Configure a bare "remote" to receive the push — the test fixture repo
    // is already a local on-disk copy; add a bare clone as origin.
    const bareRemote = await mkdtemp(
      join(tmpdir(), `fluxaos-deploy-remote-${RUN}-`)
    );
    tmpRepos.push(bareRemote);
    await gitInTmp(bareRemote, ['init', '--bare', '-b', 'main']);
    await gitInTmp(env.workingPath, ['remote', 'add', 'origin', bareRemote]);

    const fake = makeFakeGitProvider();
    const registry = makeFakeRegistry(fake.provider);
    const logger = makeLogger();
    const issueService = createIssueService(db);

    const bridge = createDeployBridge({
      db,
      registry,
      logger,
      isolation: isolationProvider,
      issueService,
      gitOps: createGitOps(),
    });

    const result = await bridge.deploy(fixture.runId);

    expect(result.skipped).toBeNull();
    if (result.skipped !== null) throw new Error('expected success path');
    expect(result.pr.number).toBe(4242);
    expect(fake.createPullRequest).toHaveBeenCalledTimes(1);
    expect(fake.createPullRequest.mock.calls[0][0]).toMatchObject({
      repo: 'fluxaos/deploy-test-fixture',
      headBranch: env.branchName,
      baseBranch: 'main',
      draft: false,
    });

    // issue_branch row exists
    const branches = await db
      .select()
      .from(schema.issueBranch)
      .where(eq(schema.issueBranch.id, result.branchRowId));
    expect(branches).toHaveLength(1);
    expect(branches[0].branchName).toBe(env.branchName);
    expect(branches[0].repo).toBe('fluxaos/deploy-test-fixture');
    expect(branches[0].isPrimary).toBe(true);

    // issue_pull_request row exists
    const prs = await db
      .select()
      .from(schema.issuePullRequest)
      .where(eq(schema.issuePullRequest.id, result.prRowId));
    expect(prs).toHaveLength(1);
    expect(prs[0].prNumber).toBe(4242);
    expect(prs[0].provider).toBe('github');
    expect(prs[0].state).toBe('open');

    // issue advanced to review state
    const [updatedIssue] = await db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.id, fixture.issueId));
    expect(updatedIssue.stateId).toBe(fixture.reviewStateId);
    expect(updatedIssue.version).toBe(2);

    // env released (status = inactive)
    const [envAfter] = await db
      .select()
      .from(schema.isolationEnvironment)
      .where(eq(schema.isolationEnvironment.id, env.id));
    expect(envAfter.status).toBe('inactive');

    // FLX-197: deploy_run row written with status=succeeded.
    const deployRows = await db
      .select()
      .from(schema.deployRun)
      .where(eq(schema.deployRun.pipelineRunId, fixture.runId));
    expect(deployRows).toHaveLength(1);
    expect(deployRows[0].status).toBe('succeeded');
    expect(deployRows[0].prRowId).toBe(result.prRowId);
    expect(deployRows[0].branchRowId).toBe(result.branchRowId);
    expect(deployRows[0].commitSha).toBe(result.commitSha);
    expect(deployRows[0].errorStage).toBeNull();
    expect(deployRows[0].errorMessage).toBeNull();
    expect(deployRows[0].completedAt).not.toBeNull();
  }, 60000);

  it('no-changes path: clean worktree returns skipped=no-changes without calling GitProvider', async () => {
    const fixture2 = await makeFixture('b');

    const env = await isolationProvider.acquire({
      projectId: fixture2.projectId,
      runId: fixture2.runId,
      repoPath: fixture2.repoPath,
      repoIdentity: {
        owner: 'fluxaos',
        repo: 'deploy-test-fixture',
      },
      branchName: `fluxaos/deploy-${RUN}-clean`,
      baseBranch: 'main',
    });

    // Intentionally leave worktree untouched.
    const fake = makeFakeGitProvider();
    const registry = makeFakeRegistry(fake.provider);
    const logger = makeLogger();
    const issueService = createIssueService(db);

    const bridge = createDeployBridge({
      db,
      registry,
      logger,
      isolation: isolationProvider,
      issueService,
      gitOps: createGitOps(),
    });

    const result = await bridge.deploy(fixture2.runId);

    expect(result).toEqual({ skipped: 'no-changes' });
    expect(fake.createPullRequest).not.toHaveBeenCalled();

    // Issue state is unchanged (still implement).
    const [issueAfter] = await db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.id, fixture2.issueId));
    expect(issueAfter.stateId).toBe(fixture2.implementStateId);

    // Env should still be active (bridge does NOT release on no-changes;
    // orchestrator owns post-deploy env lifecycle).
    const [envAfter] = await db
      .select()
      .from(schema.isolationEnvironment)
      .where(eq(schema.isolationEnvironment.id, env.id));
    expect(envAfter.status).toBe('active');

    // FLX-197: deploy_run row written with status=skipped.
    const deployRows = await db
      .select()
      .from(schema.deployRun)
      .where(eq(schema.deployRun.pipelineRunId, fixture2.runId));
    expect(deployRows).toHaveLength(1);
    expect(deployRows[0].status).toBe('skipped');
    expect(deployRows[0].skippedReason).toBe('no-changes');
  }, 45000);

  it('no-issue path: pipeline_run without an issueId returns skipped=no-issue', async () => {
    const fixture3 = await makeFixture('c', false);

    const fake = makeFakeGitProvider();
    const registry = makeFakeRegistry(fake.provider);
    const logger = makeLogger();
    const issueService = createIssueService(db);

    const bridge = createDeployBridge({
      db,
      registry,
      logger,
      isolation: isolationProvider,
      issueService,
      gitOps: createGitOps(),
    });

    const result = await bridge.deploy(fixture3.runId);
    expect(result).toEqual({ skipped: 'no-issue' });
    expect(fake.createPullRequest).not.toHaveBeenCalled();

    // FLX-197: deploy_run row written with status=skipped, reason=no-issue.
    const deployRows = await db
      .select()
      .from(schema.deployRun)
      .where(eq(schema.deployRun.pipelineRunId, fixture3.runId));
    expect(deployRows).toHaveLength(1);
    expect(deployRows[0].status).toBe('skipped');
    expect(deployRows[0].skippedReason).toBe('no-issue');
  }, 30000);
});
