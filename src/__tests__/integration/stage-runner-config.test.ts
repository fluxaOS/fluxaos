/**
 * FLX-83: stage-runner must fail fast on missing DB-owned config.
 */
import 'dotenv/config';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AnyColumn } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { bootstrap } from '@/config/bootstrap';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import { createPipelineRunService } from '@/core/orchestrator/pipeline-run-service';
import { executeStageRun } from '@/core/orchestrator/stage-runner';
import type {
  IsolationEnvironment,
  IsolationProvider,
} from '@/core/ports/isolation';
import type { StageExecutor } from '@/core/ports/stage-executor';
import {
  createOrganizationService,
  createPipelineService,
  createProjectService,
  createUserService,
} from '@/core/services';

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

const cleanupList: { table: string; id: string }[] = [];
const tempDirs: string[] = [];
const tableMap: Record<string, AnyPgTable & { id: AnyColumn }> = {
  event: schema.event,
  stageRun: schema.stageRun,
  pipelineRun: schema.pipelineRun,
  pipelineStage: schema.pipelineStage,
  pipeline: schema.pipeline,
  model: schema.model,
  provider: schema.provider,
  routingRule: schema.routingRule,
  routingProfile: schema.routingProfile,
  driver: schema.driver,
  skill: schema.skill,
  project: schema.project,
  user: schema.user,
  organization: schema.organization,
};

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
  cleanupList.push({ table: 'organization', id: orgId });

  const user = await createUserService(db).create({
    orgId,
    email: `stage-runner-config-${RUN}@test.local`,
    name: 'Stage Runner Config User',
    slug: `stage-runner-config-user-${RUN}`,
  });
  userId = user.id;
  cleanupList.push({ table: 'user', id: userId });

  const project = await createProjectService(db).create({
    orgId,
    userId,
    name: `StageRunnerConfigProject-${RUN}`,
    slug: `stage-runner-config-project-${RUN}`,
    repoUrl: `https://github.com/fluxaos/stage-runner-config-${RUN}`,
  });
  projectId = project.id;
  cleanupList.push({ table: 'project', id: projectId });

  const pipeline = await createPipelineService(db).create({
    projectId,
    name: `Stage Runner Config Pipeline ${RUN}`,
  });
  pipelineId = pipeline.id;
  cleanupList.push({ table: 'pipeline', id: pipelineId });
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
  for (const { table, id } of cleanupList.reverse()) {
    const t = tableMap[table];
    if (t)
      await db
        .delete(t)
        .where(eq(t.id, id))
        .catch(() => {});
  }
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

  // FLX-92: auto-commit on `proceed`. Both the no-signal-clean-exit
  // synth path and the emitted-proceed-signal path commit; hold/rework
  // /abort paths leave the tree dirty so a human can inspect.
  it('FLX-92: auto-commits on proceed; leaves dirty on hold', async () => {
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

    const held = await createStageRunnerHarness({
      issuePromptTemplate: 'work in {{workspace_path}}',
      withRouting: true,
      withArtifactsPath: true,
      gitInitWorkingPath: true,
      onExecute: async ({ workingPath }) => {
        await writeFile(join(workingPath, 'HALF.md'), '# Half\n');
      },
      emitStdout: () =>
        `${JSON.stringify({ 'flux:signal': { verdict: 'hold' } })}\n`,
    });
    await held.run();
    expect(
      (await git(held.workingPath, ['status', '--porcelain'])).trim()
    ).toBe('?? HALF.md');
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
  /**
   * FLX-92: stdout the executor emits during `execute()`. Lets tests
   * inject a flux:signal proceed line to exercise the
   * signal-emitted code path.
   */
  emitStdout?: (workingPath: string) => string;
}) {
  const svc = createPipelineRunService(db);
  const [driverRow] = await db
    .insert(schema.driver)
    .values({
      name: `FLX-83 Driver ${RUN}-${cleanupList.length}`,
      slug: `flx-83-driver-${RUN}-${cleanupList.length}`,
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
  cleanupList.push({ table: 'driver', id: driverRow.id });

  const [skillRow] = await db
    .insert(schema.skill)
    .values({
      projectId,
      name: `flx-83-skill-${RUN}-${cleanupList.length}`,
      promptTemplate: 'Use {{workspace_path}} for source edits.',
    })
    .returning();
  cleanupList.push({ table: 'skill', id: skillRow.id });

  const stage = await createPipelineService(db).stages.create({
    pipelineId,
    name: `flx-83-stage-${cleanupList.length}`,
    sortOrder: cleanupList.length,
    gateMode: 'auto',
    maxRetries: 0,
    driver: input.withRouting ? driverRow.slug : null,
    driverId: driverRow.id,
    skillId: skillRow.id,
  });
  cleanupList.push({ table: 'pipelineStage', id: stage.id });

  if (input.withRouting) {
    await createRoutingFixture(stage.name);
  }

  const [run] = await db
    .insert(schema.pipelineRun)
    .values({ pipelineId, issueId: null, status: 'pending' })
    .returning();
  cleanupList.push({ table: 'pipelineRun', id: run.id });

  const stageRun = await svc.createStageRun(run.id, stage.id);
  cleanupList.push({ table: 'stageRun', id: stageRun.id });

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
      const stdout = input.emitStdout?.(workingPath) ?? '';
      if (stdout && params.onStdout) {
        params.onStdout(stdout);
      }
      return {
        exitCode: 0,
        stdout,
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
        runId: run.id,
        stageRunId: stageRun.id,
        trigger: 'manual',
      }),
  };
}

async function createRoutingFixture(stageName: string) {
  const [providerRow] = await db
    .insert(schema.provider)
    .values({
      orgId,
      name: `FLX-83 Provider ${RUN}-${cleanupList.length}`,
      type: 'test',
      isHealthy: true,
    })
    .returning();
  cleanupList.push({ table: 'provider', id: providerRow.id });

  const [modelRow] = await db
    .insert(schema.model)
    .values({
      providerId: providerRow.id,
      name: `FLX-83 Model ${RUN}-${cleanupList.length}`,
      identifier: `flx-83-model-${RUN}`,
    })
    .returning();
  cleanupList.push({ table: 'model', id: modelRow.id });

  const [profileRow] = await db
    .insert(schema.routingProfile)
    .values({
      orgId,
      name: `FLX-83 Routing ${RUN}-${cleanupList.length}`,
    })
    .returning();
  cleanupList.push({ table: 'routingProfile', id: profileRow.id });

  const [ruleRow] = await db
    .insert(schema.routingRule)
    .values({
      profileId: profileRow.id,
      stageName,
    })
    .returning();
  cleanupList.push({ table: 'routingRule', id: ruleRow.id });
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
