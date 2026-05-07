/**
 * FLX-83: stage-runner must fail fast on missing DB-owned config.
 */
import 'dotenv/config';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fsMaterializerAdapter } from '@/adapters/fs';
import { createGitOps } from '@/adapters/git/git-ops';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { bootstrap } from '@/config/bootstrap';
import { registry } from '@/config/registry';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import { createPipelineRunService } from '@/core/orchestrator/pipeline-run-service';
import { executeStageRun } from '@/core/orchestrator/stage-runner';
import type {
  IsolationEnvironment,
  IsolationProvider,
} from '@/core/ports/isolation';
import type { StageExecutor } from '@/core/ports/stage-executor';
import type { StdoutParser } from '@/core/ports/stdout-parser';
import {
  createOrganizationService,
  createPipelineService,
  createProjectService,
  createUserService,
} from '@/core/services';
import { deleteOrgFixture } from './cleanup-fixtures';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}

async function makeRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await git(dir, ['init', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'test@fluxaos.local']);
  await git(dir, ['config', 'user.name', 'Test']);
  await git(dir, ['commit', '--allow-empty', '-m', 'initial']);
  return dir;
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();
const RUN = Date.now();

const tempDirs: string[] = [];
// driver rows are global (no orgId); track separately for cleanup
const driverIds: string[] = [];
let _orgId: string;
// unique suffix counter used in createStageRunnerHarness naming
let _harnessCallCount = 0;

let orgId: string;
let userId: string;
let projectId: string;
let pipelineId: string;
let previousTargetRepoPath: string | undefined;

beforeAll(async () => {
  bootstrap();
  previousTargetRepoPath = process.env.FLUXAOS_TARGET_REPO_PATH;
  const targetRepoPath = await mkdtemp(join(tmpdir(), 'fluxaos-target-'));
  tempDirs.push(targetRepoPath);
  process.env.FLUXAOS_TARGET_REPO_PATH = targetRepoPath;

  const org = await createOrganizationService(db).create({
    name: `StageRunnerConfigOrg-${RUN}`,
    slug: `stage-runner-config-${RUN}`,
    settings: {},
  });
  orgId = org.id;
  _orgId = org.id;

  const user = await createUserService(db).create({
    orgId,
    email: `stage-runner-config-${RUN}@test.local`,
    name: 'Stage Runner Config User',
    slug: `stage-runner-config-user-${RUN}`,
  });
  userId = user.id;

  const project = await createProjectService(db).create({
    orgId,
    userId,
    name: `StageRunnerConfigProject-${RUN}`,
    slug: `stage-runner-config-project-${RUN}`,
    repoUrl: `https://github.com/fluxaos/stage-runner-config-${RUN}`,
  });
  projectId = project.id;

  const pipeline = await createPipelineService(db).create({
    projectId,
    name: `Stage Runner Config Pipeline ${RUN}`,
  });
  pipelineId = pipeline.id;
});

afterAll(async () => {
  if (previousTargetRepoPath === undefined) {
    delete process.env.FLUXAOS_TARGET_REPO_PATH;
  } else {
    process.env.FLUXAOS_TARGET_REPO_PATH = previousTargetRepoPath;
  }

  for (const path of tempDirs.reverse()) {
    await rm(path, { recursive: true, force: true }).catch(() => {});
  }
  // driver rows are global (no orgId), clean up separately
  for (const id of driverIds) {
    await db
      .delete(schema.driver)
      .where(eq(schema.driver.id, id))
      .catch(() => undefined);
  }
  if (_orgId) await deleteOrgFixture(db, _orgId);
});

describe('stage-runner config validation', () => {
  it('fails fast when driver issuePromptTemplate is missing', async () => {
    const harness = await createStageRunnerHarness({
      issuePromptTemplate: null,
      withRouting: true,
    });

    await expect(harness.run()).rejects.toThrow(
      /Driver 'FLX-83 Driver .*' .* is missing issuePromptTemplate/
    );
    expect(harness.executeCalls()).toBe(0);
  });

  it('fails fast when routing does not resolve a model', async () => {
    const harness = await createStageRunnerHarness({
      issuePromptTemplate: '{{skill_name}}: {{issue_title}}',
      withRouting: false,
    });

    await expect(harness.run()).rejects.toThrow(
      /No routing model resolved for stage/
    );
    expect(harness.executeCalls()).toBe(0);
  });

  it('materializes driver instructions outside the target worktree', async () => {
    let materializedInstructions = '';
    let materializedContext = '';
    const harness = await createStageRunnerHarness({
      issuePromptTemplate: 'work in {{workspace_path}}',
      withRouting: true,
      withArtifactsPath: true,
      // FLX-92: workingPath now needs a git repo so the post-stage
      // auto-commit step can run. (In production this is always a real
      // worktree.)
      gitInitWorkingPath: true,
      onExecute: async ({ materializedPath }) => {
        materializedInstructions = await readFile(
          join(materializedPath, 'CLAUDE.md'),
          'utf-8'
        );
        materializedContext = await readFile(
          join(materializedPath, 'context.md'),
          'utf-8'
        );
      },
    });
    await writeFile(join(harness.workingPath, 'CLAUDE.md'), 'project memory');

    await harness.run();

    expect(
      await readFile(join(harness.workingPath, 'CLAUDE.md'), 'utf-8')
    ).toBe('project memory');
    expect(harness.lastExecuteParams()?.cwd).toBe(harness.materializedPath);
    expect(harness.lastExecuteParams()?.args).toEqual(
      expect.arrayContaining([
        '--add-dir',
        harness.materializedPath,
        '--add-dir',
        harness.workingPath,
      ])
    );
    expect(materializedInstructions).toContain('## Skill:');
    expect(materializedContext).toContain('Issue Context');
  });

  it('keeps the driver cwd outside the primary checkout git tree', async () => {
    const primaryCheckoutPath = await makeRepo('fluxaos-primary-');
    tempDirs.push(primaryCheckoutPath);
    const harness = await createStageRunnerHarness({
      issuePromptTemplate: 'work in {{workspace_path}}',
      withRouting: true,
      gitInitWorkingPath: true,
      artifactsPath: join(primaryCheckoutPath, '.fluxaos-artifacts', 'run'),
    });

    await harness.run();

    const cwd = harness.lastExecuteParams()?.cwd;
    expect(cwd).toBeTruthy();
    expect(cwd?.startsWith(`${primaryCheckoutPath}/`)).toBe(false);
    await expect(
      execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd })
    ).rejects.toThrow();
  });

  // FLX-92: auto-commit on clean exit (no-signal synthesizes proceed).
  // FLX-112: signal-based routing removed; all clean exits now synthesize proceed.
  it('FLX-92: auto-commits on clean exit (synthesized proceed)', async () => {
    const proceed = await createStageRunnerHarness({
      issuePromptTemplate: 'work in {{workspace_path}}',
      withRouting: true,
      withArtifactsPath: true,
      gitInitWorkingPath: true,
      onExecute: async ({ workingPath }) => {
        await writeFile(join(workingPath, 'CONTRIBUTING.md'), '# C\n');
      },
    });
    await proceed.run();
    expect(
      (await git(proceed.workingPath, ['log', '--oneline']))
        .split('\n')
        .filter(Boolean).length
    ).toBe(2);
    expect(
      (await git(proceed.workingPath, ['status', '--porcelain'])).trim()
    ).toBe('');
  });
});

async function createStageRunnerHarness(input: {
  issuePromptTemplate: string | null;
  withRouting: boolean;
  withArtifactsPath?: boolean;
  artifactsPath?: string;
  /**
   * FLX-92: when true, init a real git repo at workingPath so commitAll
   * can run. When false (default) workingPath is a plain tmpdir; tests
   * that exercise auto-commit MUST set this true.
   */
  gitInitWorkingPath?: boolean;
  /**
   * FLX-92: side-effect callback the mock executor invokes inside
   * `execute()`. Lets a test simulate a worker that writes files in the
   * worktree without committing.
   */
  onExecute?: (params: {
    workingPath: string;
    materializedPath: string;
  }) => Promise<void> | void;
}) {
  const svc = createPipelineRunService(db);
  const callIdx = ++_harnessCallCount;
  const [driverRow] = await db
    .insert(schema.driver)
    .values({
      name: `FLX-83 Driver ${RUN}-${callIdx}`,
      slug: `flx-83-driver-${RUN}-${callIdx}`,
      binary: 'printf',
      defaultArgs: [],
      modelFlag: '--model',
      dirFlag: '--add-dir',
      sessionNameFlag: '--session-name',
      promptTransport: 'argv',
      outputFormat: 'stream-json',
      outputFormatFlag: '--output-format',
      issuePromptTemplate: input.issuePromptTemplate,
      queuePromptTemplate: '{{issue_title}}',
      contextLayout: {
        instructionsFile: 'CLAUDE.md',
        contextFile: 'context.md',
      },
    })
    .returning();
  driverIds.push(driverRow.id);

  const stage = await createPipelineService(db).stages.create({
    pipelineId,
    name: `flx-83-stage-${callIdx}`,
    sortOrder: callIdx,
    gateMode: 'auto',
    maxRetries: 0,
    driver: input.withRouting ? driverRow.slug : null,
    driverId: driverRow.id,
  });

  if (input.withRouting) {
    await createRoutingFixture(stage.name);
  }

  const [run] = await db
    .insert(schema.pipelineRun)
    .values({ pipelineId, issueId: null, status: 'pending' })
    .returning();

  const stageRun = await svc.createStageRun(run.id, stage.id);

  const workingPath = input.gitInitWorkingPath
    ? await makeRepo('fluxaos-worktree-')
    : await mkdtemp(join(tmpdir(), 'fluxaos-worktree-'));
  tempDirs.push(workingPath);

  let executeCallCount = 0;
  let lastExecuteParams: Parameters<StageExecutor['execute']>[0] | null = null;
  const executor: StageExecutor = {
    async execute(params) {
      executeCallCount += 1;
      lastExecuteParams = params;
      const materializedPathFromArgs = params.cwd;
      await input.onExecute?.({
        workingPath,
        materializedPath: materializedPathFromArgs,
      });
      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 1,
        processId: 'flx-83-test',
      };
    },
    async cancel() {},
  };
  const artifactsPath =
    input.artifactsPath ??
    (input.withArtifactsPath
      ? await mkdtemp(join(tmpdir(), 'fluxaos-artifacts-'))
      : null);
  if (artifactsPath) tempDirs.push(artifactsPath);
  const materializedPath = join(tmpdir(), 'fluxaos-runs', stageRun.id);

  return {
    executeCalls: () => executeCallCount,
    lastExecuteParams: () => lastExecuteParams,
    workingPath,
    artifactsPath,
    materializedPath,
    run: () =>
      executeStageRun({
        db,
        executor,
        runService: svc,
        isolation: createIsolationProvider({
          stageRunId: stageRun.id,
          workingPath,
          artifactsPath,
        }),
        gitOps: createGitOps(),
        stdoutParser: registry.get<StdoutParser>('stdoutParser'),
        wsMaterializer: fsMaterializerAdapter,
        runId: run.id,
        stageRunId: stageRun.id,
        trigger: 'manual',
      }),
  };
}

async function createRoutingFixture(stageName: string) {
  const idx = _harnessCallCount;
  const [providerRow] = await db
    .insert(schema.provider)
    .values({
      orgId,
      name: `FLX-83 Provider ${RUN}-${idx}`,
      type: 'test',
      isHealthy: true,
    })
    .returning();

  const [modelRow] = await db
    .insert(schema.model)
    .values({
      providerId: providerRow.id,
      name: `FLX-83 Model ${RUN}-${idx}`,
      identifier: `flx-83-model-${RUN}-${idx}`,
    })
    .returning();

  const [profileRow] = await db
    .insert(schema.routingProfile)
    .values({
      orgId,
      name: `FLX-83 Routing ${RUN}-${idx}`,
    })
    .returning();

  await db
    .insert(schema.routingRule)
    .values({
      profileId: profileRow.id,
      stageName,
    })
    .returning();
}

function createIsolationProvider(input: {
  stageRunId: string;
  workingPath: string;
  artifactsPath: string | null;
}): IsolationProvider {
  return {
    async acquire(params) {
      return {
        id: `env-${input.stageRunId}`,
        projectId: params.projectId,
        runId: params.runId,
        provider: 'test',
        workingPath: input.workingPath,
        branchName: params.branchName,
        status: 'active',
        metadata: {},
        artifactsPath: input.artifactsPath,
        createdAt: new Date(),
        updatedAt: new Date(),
      } satisfies IsolationEnvironment;
    },
    async release() {},
    async findActiveByRun() {
      return null;
    },
    async listActiveByProject() {
      return [];
    },
  };
}
