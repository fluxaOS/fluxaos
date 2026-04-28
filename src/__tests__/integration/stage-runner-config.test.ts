/**
 * FLX-83: stage-runner must fail fast on missing DB-owned config.
 */
import 'dotenv/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AnyColumn } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
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
});

async function createStageRunnerHarness(input: {
  issuePromptTemplate: string | null;
  withRouting: boolean;
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

  const stage = await createPipelineService(db).stages.create({
    pipelineId,
    name: `flx-83-stage-${cleanupList.length}`,
    sortOrder: cleanupList.length,
    gateMode: 'auto',
    maxRetries: 0,
    driverId: driverRow.id,
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

  let executeCallCount = 0;
  const executor: StageExecutor = {
    async execute() {
      executeCallCount += 1;
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

  return {
    executeCalls: () => executeCallCount,
    run: () =>
      executeStageRun({
        db,
        executor,
        runService: svc,
        isolation: createIsolationProvider(stageRun.id),
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

function createIsolationProvider(stageRunId: string): IsolationProvider {
  return {
    async acquire(params) {
      const workingPath = await mkdtemp(join(tmpdir(), 'fluxaos-worktree-'));
      tempDirs.push(workingPath);
      return {
        id: `env-${stageRunId}`,
        projectId: params.projectId,
        runId: params.runId,
        provider: 'test',
        workingPath,
        branchName: params.branchName,
        status: 'active',
        metadata: {},
        artifactsPath: null,
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
