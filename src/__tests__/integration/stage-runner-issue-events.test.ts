import 'dotenv/config';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
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
import type { IsolationProvider } from '@/core/ports/isolation';
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
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();
const RUN = Date.now();
const tempDirs: string[] = [];
let fixtureOrgId: string;
const driverIds: string[] = [];

let fixture: Awaited<ReturnType<typeof createFixture>>;
let fixtureTargetRepoPath: string;

beforeAll(async () => {
  bootstrap();
  fixtureTargetRepoPath = await makeRepo('fluxaos-target-');
  tempDirs.push(fixtureTargetRepoPath);
  fixture = await createFixture();
});

afterAll(async () => {
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
  if (fixtureOrgId) await deleteOrgFixture(db, fixtureOrgId);
  await provider.close();
});

describe('stage-runner issue events', () => {
  it('adds stage_completed event to issue timeline on clean exit', async () => {
    const svc = createPipelineRunService(db);
    const [run] = await db
      .insert(schema.pipelineRun)
      .values({
        pipelineId: fixture.pipelineId,
        issueId: fixture.issueId,
        status: 'pending',
      })
      .returning();

    const stageRun = await svc.createStageRun(run.id, fixture.stageId);

    const workingPath = await makeRepo('fluxaos-worktree-');
    const artifactsPath = await mkdtemp(join(tmpdir(), 'fluxaos-artifacts-'));
    tempDirs.push(workingPath, artifactsPath);

    const executor: StageExecutor = {
      async execute() {
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 1,
          processId: 'stage-runner-issue-events-test',
        };
      },
      async cancel() {},
    };

    await executeStageRun({
      db,
      executor,
      runService: svc,
      isolation: isolationProvider(workingPath, artifactsPath),
      gitOps: createGitOps(),
      stdoutParser: registry.get<StdoutParser>('stdoutParser'),
      wsMaterializer: fsMaterializerAdapter,
      runId: run.id,
      stageRunId: stageRun.id,
      trigger: 'manual',
    });

    const rows = await db
      .select()
      .from(schema.issueEvent)
      .where(eq(schema.issueEvent.issueId, fixture.issueId));

    const completed = rows.find((row) => row.type === 'stage_completed');
    expect(completed?.payload).toMatchObject({
      stageName: fixture.stageName,
      skillSignal: 'proceed',
    });
  });
});

async function makeRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@fluxaos.local'], {
    cwd: dir,
  });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await execFileAsync('git', ['commit', '--allow-empty', '-m', 'initial'], {
    cwd: dir,
  });
  return dir;
}

async function createFixture() {
  const org = await createOrganizationService(db).create({
    name: `StageRunnerIssueEventsOrg-${RUN}`,
    slug: `stage-runner-issue-events-${RUN}`,
    settings: {},
  });
  fixtureOrgId = org.id;

  const user = await createUserService(db).create({
    orgId: org.id,
    email: `stage-runner-issue-events-${RUN}@test.local`,
    name: 'Stage Runner Issue Events User',
    slug: `stage-runner-issue-events-user-${RUN}`,
  });

  const project = await createProjectService(db).create({
    orgId: org.id,
    userId: user.id,
    name: `StageRunnerIssueEventsProject-${RUN}`,
    slug: `stage-runner-issue-events-project-${RUN}`,
    repoUrl: `https://github.com/fluxaos/stage-runner-issue-events-${RUN}`,
    // FLX-221: per-project column for the on-disk target repo clone.
    targetRepoPath: fixtureTargetRepoPath,
  });

  const pipeline = await createPipelineService(db).create({
    projectId: project.id,
    name: `Stage Runner Issue Events Pipeline ${RUN}`,
  });

  const [driver] = await db
    .insert(schema.driver)
    .values({
      name: `Issue Events Driver ${RUN}`,
      slug: `issue-events-driver-${RUN}`,
      binary: 'printf',
      defaultArgs: [],
      modelFlag: '--model',
      dirFlag: '--add-dir',
      promptTransport: 'argv',
      outputFormat: 'stream-json',
      outputFormatFlag: '--output-format',
      issuePromptTemplate: '{{skill_name}}: {{issue_title}}',
      contextLayout: {
        instructionsFile: 'CLAUDE.md',
        contextFile: 'context.md',
      },
    })
    .returning();
  driverIds.push(driver.id);

  const stage = await createPipelineService(db).stages.create({
    pipelineId: pipeline.id,
    name: `issue-events-stage-${RUN}`,
    sortOrder: 1,
    gateMode: 'auto',
    maxRetries: 0,
    driver: driver.slug,
    driverId: driver.id,
  });

  await createRouting(org.id, stage.name);
  const issueId = await createIssue(project.id);
  return {
    pipelineId: pipeline.id,
    stageId: stage.id,
    stageName: stage.name,
    issueId,
  };
}

async function createRouting(orgId: string, stageName: string) {
  const [providerRow] = await db
    .insert(schema.provider)
    .values({ orgId, name: `Issue Events Provider ${RUN}`, type: 'test' })
    .returning();
  const [_modelRow] = await db
    .insert(schema.model)
    .values({
      providerId: providerRow.id,
      name: `Issue Events Model ${RUN}`,
      identifier: `issue-events-model-${RUN}`,
    })
    .returning();
  const [profileRow] = await db
    .insert(schema.routingProfile)
    .values({ orgId, name: `Issue Events Routing ${RUN}` })
    .returning();
  await db
    .insert(schema.routingRule)
    .values({ profileId: profileRow.id, stageName })
    .returning();
}

async function createIssue(projectId: string): Promise<string> {
  const [state] = await db
    .insert(schema.issueState)
    .values({
      projectId,
      key: `issue-events-state-${RUN}`,
      displayName: 'Issue Events State',
      color: '#64748b',
      sortOrder: 1,
    })
    .returning();
  const [status] = await db
    .insert(schema.issueStatus)
    .values({
      projectId,
      key: `issue-events-status-${RUN}`,
      displayName: 'Issue Events Status',
      sortOrder: 1,
    })
    .returning();
  const [type] = await db
    .insert(schema.issueType)
    .values({
      projectId,
      key: `issue-events-type-${RUN}`,
      displayName: 'Issue Events Type',
      color: '#64748b',
      sortOrder: 1,
    })
    .returning();
  const [priority] = await db
    .insert(schema.issuePriority)
    .values({
      projectId,
      key: `issue-events-priority-${RUN}`,
      displayName: 'Issue Events Priority',
      color: '#64748b',
      weight: 1,
    })
    .returning();
  const [issue] = await db
    .insert(schema.issue)
    .values({
      projectId,
      number: 1_000_001,
      title: 'Stage summary timeline test',
      stateId: state.id,
      statusId: status.id,
      typeId: type.id,
      priorityId: priority.id,
      author: 'test',
    })
    .returning();
  return issue.id;
}

function isolationProvider(
  workingPath: string,
  artifactsPath: string
): IsolationProvider {
  return {
    async acquire(params) {
      return {
        id: `env-${params.runId}`,
        projectId: params.projectId,
        runId: params.runId,
        provider: 'test',
        workingPath,
        branchName: params.branchName,
        status: 'active',
        metadata: {},
        artifactsPath,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
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
