/**
 * Integration tests: pipeline-terminal-hook deploy_run row writes (FLX-197).
 *
 * Real Supabase. Builds a pipeline_run + stage_run pair, then drives the
 * terminal hook through the success and failure paths and asserts:
 *
 *   - On deploy success → deploy_run row with status='succeeded'.
 *   - On deploy failure → deploy_run row with status='failed' AND
 *     pipeline_run/stage_run rows STAY in their pre-existing completed
 *     statuses (the deploy is post-pipeline; its outcome must not retcon
 *     pipeline truth).
 *
 * The DeployBridge here is a fake — we test the hook's contract with the
 * DB. Full deploy-bridge happy-path coverage lives in deploy-bridge.test.ts.
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import {
  DEPLOY_RUN_STATUS,
  PIPELINE_RUN_STATUS,
  STAGE_RUN_STATUS,
} from '@/core/constants';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import { type DeployBridge, DeployBridgeError } from '@/core/deploy';
import { createPipelineTerminalHook } from '@/core/orchestrator/pipeline-terminal-hook';
import type { IsolationProvider } from '@/core/ports/isolation';
import { deleteOrgFixture } from './cleanup-fixtures';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();

const RUN = Date.now();
const orgIds: string[] = [];

interface Fixture {
  projectId: string;
  pipelineId: string;
  pipelineStageId: string;
  runId: string;
  stageRunId: string;
}

async function makeFixture(label: string): Promise<Fixture> {
  const [org] = await db
    .insert(schema.organization)
    .values({
      name: `term-hook-org-${label}-${RUN}`,
      slug: `term-hook-org-${label}-${RUN}`,
    })
    .returning();
  orgIds.push(org.id);

  const [userRow] = await db
    .insert(schema.user)
    .values({
      orgId: org.id,
      email: `term-hook-${label}-${RUN}@test.local`,
      name: 'TermHook',
      slug: `term-hook-${label}-${RUN}`,
    })
    .returning();

  const [projectRow] = await db
    .insert(schema.project)
    .values({
      orgId: org.id,
      userId: userRow.id,
      name: `term-hook-proj-${label}-${RUN}`,
      slug: `term-hook-proj-${label}-${RUN}`,
      defaultBranch: 'main',
    })
    .returning();

  const [pipelineRow] = await db
    .insert(schema.pipeline)
    .values({ projectId: projectRow.id, name: `term-hook-pipe-${label}` })
    .returning();

  const [stageRow] = await db
    .insert(schema.pipelineStage)
    .values({
      pipelineId: pipelineRow.id,
      name: 'implement',
      sortOrder: 0,
    })
    .returning();

  const [runRow] = await db
    .insert(schema.pipelineRun)
    .values({
      pipelineId: pipelineRow.id,
      status: PIPELINE_RUN_STATUS.completed,
      startedAt: new Date(),
      completedAt: new Date(),
    })
    .returning();

  const [stageRunRow] = await db
    .insert(schema.stageRun)
    .values({
      pipelineRunId: runRow.id,
      pipelineStageId: stageRow.id,
      status: STAGE_RUN_STATUS.completed,
      startedAt: new Date(),
      completedAt: new Date(),
    })
    .returning();

  return {
    projectId: projectRow.id,
    pipelineId: pipelineRow.id,
    pipelineStageId: stageRow.id,
    runId: runRow.id,
    stageRunId: stageRunRow.id,
  };
}

function makeLogger() {
  const records: { level: string; obj: Record<string, unknown> }[] = [];
  return {
    records,
    info: (obj: Record<string, unknown>) =>
      records.push({ level: 'info', obj }),
    warn: (obj: Record<string, unknown>) =>
      records.push({ level: 'warn', obj }),
    error: (obj: Record<string, unknown>) =>
      records.push({ level: 'error', obj }),
  };
}

function makeStubIsolation(): IsolationProvider {
  // The hook calls findActiveByRun then release. For these tests there's no
  // active env (we skipped acquiring one) — return null and let release
  // remain unused. The DB-row contract is what we're testing.
  return {
    acquire: vi.fn(),
    release: vi.fn(async () => undefined),
    findActiveByRun: vi.fn(async () => null),
    listActiveByProject: vi.fn(async () => []),
  };
}

afterAll(async () => {
  for (const orgId of orgIds) {
    await deleteOrgFixture(db, orgId);
  }
  await provider.close();
});

describe('pipeline-terminal-hook + deploy_run (real DB)', () => {
  let happyFixture: Fixture;
  let failFixture: Fixture;
  let nonDeployErrFixture: Fixture;

  beforeAll(async () => {
    happyFixture = await makeFixture('happy');
    failFixture = await makeFixture('fail');
    nonDeployErrFixture = await makeFixture('nondeployerr');
  }, 30000);

  it('completed + deploy succeeds → deploy bridge owns its own row write (hook does NOT double-write)', async () => {
    // The success path's deploy_run row is written by deploy-bridge inside
    // its transaction, not by the hook. Here we verify the hook itself
    // doesn't insert a duplicate when the bridge resolves cleanly.
    const deploy = vi.fn(async () => ({ skipped: 'no-changes' as const }));
    const bridge: DeployBridge = { deploy };

    const hook = createPipelineTerminalHook({
      db,
      deployBridge: bridge,
      isolation: makeStubIsolation(),
      logger: makeLogger(),
    });

    await hook.onTerminal({
      runId: happyFixture.runId,
      projectId: happyFixture.projectId,
      status: PIPELINE_RUN_STATUS.completed,
    });

    const rows = await db
      .select()
      .from(schema.deployRun)
      .where(eq(schema.deployRun.pipelineRunId, happyFixture.runId));
    // Hook should not have written anything on the success path.
    expect(rows).toHaveLength(0);
  });

  it('completed + deploy throws DeployBridgeError → deploy_run row inserted, pipeline/stage rows untouched', async () => {
    const deployErr = new DeployBridgeError(
      'create-pr',
      `simulated PR creation failure ${RUN}`
    );
    const deploy = vi.fn(async () => {
      throw deployErr;
    });
    const bridge: DeployBridge = { deploy };

    const hook = createPipelineTerminalHook({
      db,
      deployBridge: bridge,
      isolation: makeStubIsolation(),
      logger: makeLogger(),
    });

    await hook.onTerminal({
      runId: failFixture.runId,
      projectId: failFixture.projectId,
      status: PIPELINE_RUN_STATUS.completed,
    });

    // 1. deploy_run row exists with the expected shape.
    const deployRows = await db
      .select()
      .from(schema.deployRun)
      .where(eq(schema.deployRun.pipelineRunId, failFixture.runId));
    expect(deployRows).toHaveLength(1);
    expect(deployRows[0].status).toBe(DEPLOY_RUN_STATUS.failed);
    expect(deployRows[0].errorStage).toBe('create-pr');
    expect(deployRows[0].errorMessage).toContain(
      'simulated PR creation failure'
    );
    expect(deployRows[0].completedAt).not.toBeNull();

    // 2. pipeline_run.status STAYS completed (FLX-197 truth invariant).
    const [runRow] = await db
      .select()
      .from(schema.pipelineRun)
      .where(eq(schema.pipelineRun.id, failFixture.runId));
    expect(runRow.status).toBe(PIPELINE_RUN_STATUS.completed);

    // 3. stage_run.status STAYS completed (no error_message tacked on).
    const [stageRunRow] = await db
      .select()
      .from(schema.stageRun)
      .where(eq(schema.stageRun.id, failFixture.stageRunId));
    expect(stageRunRow.status).toBe(STAGE_RUN_STATUS.completed);
    expect(stageRunRow.errorMessage).toBeNull();
  });

  it('completed + deploy throws plain Error → deploy_run row with null errorStage', async () => {
    const deploy = vi.fn(async () => {
      throw new Error(`unexpected boom ${RUN}`);
    });
    const bridge: DeployBridge = { deploy };

    const hook = createPipelineTerminalHook({
      db,
      deployBridge: bridge,
      isolation: makeStubIsolation(),
      logger: makeLogger(),
    });

    await hook.onTerminal({
      runId: nonDeployErrFixture.runId,
      projectId: nonDeployErrFixture.projectId,
      status: PIPELINE_RUN_STATUS.completed,
    });

    const deployRows = await db
      .select()
      .from(schema.deployRun)
      .where(eq(schema.deployRun.pipelineRunId, nonDeployErrFixture.runId));
    expect(deployRows).toHaveLength(1);
    expect(deployRows[0].status).toBe(DEPLOY_RUN_STATUS.failed);
    expect(deployRows[0].errorStage).toBeNull();
    expect(deployRows[0].errorMessage).toContain('unexpected boom');

    // pipeline_run + stage_run rows unchanged.
    const [runRow] = await db
      .select()
      .from(schema.pipelineRun)
      .where(eq(schema.pipelineRun.id, nonDeployErrFixture.runId));
    expect(runRow.status).toBe(PIPELINE_RUN_STATUS.completed);
  });
});
