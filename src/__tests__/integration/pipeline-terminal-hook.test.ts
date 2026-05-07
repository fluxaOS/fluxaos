/**
 * Integration tests: pipeline-terminal-hook unit behaviour.
 *
 * Mocks the DeployBridge and IsolationProvider so we can assert the
 * branching logic without standing up a real pipeline. The Database
 * dependency is faked at the `.insert(...).values(...)` surface — the
 * hook only uses db.insert(deployRun).values(row). Per project
 * convention these still live in src/__tests__/integration/ — they
 * exercise the hook end-to-end within the module's DI boundary even
 * though the external dependencies are faked. Real-DB coverage of the
 * deploy_run row write lives in pipeline-terminal-hook-deploy-run.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { UncommittedChangesError } from '@/adapters/git';
import { DEPLOY_RUN_STATUS, PIPELINE_RUN_STATUS } from '@/core/constants';
import type { Database } from '@/core/db/connection';
import { type DeployBridge, DeployBridgeError } from '@/core/deploy';
import { createPipelineTerminalHook } from '@/core/orchestrator/pipeline-terminal-hook';
import type {
  IsolationEnvironment,
  IsolationProvider,
} from '@/core/ports/isolation';

function makeLogger() {
  const records: {
    level: 'info' | 'warn' | 'error';
    obj: Record<string, unknown>;
    msg?: string;
  }[] = [];
  return {
    records,
    info: (obj: Record<string, unknown>, msg?: string) =>
      records.push({ level: 'info', obj, msg }),
    warn: (obj: Record<string, unknown>, msg?: string) =>
      records.push({ level: 'warn', obj, msg }),
    error: (obj: Record<string, unknown>, msg?: string) =>
      records.push({ level: 'error', obj, msg }),
  };
}

function makeFakeEnv(
  overrides: Partial<IsolationEnvironment> = {}
): IsolationEnvironment {
  return {
    id: 'env-1',
    projectId: 'proj-1',
    runId: 'run-1',
    provider: 'worktree',
    workingPath: '/tmp/fake',
    branchName: 'fluxaos/test',
    status: 'active',
    metadata: {},
    artifactsPath: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeFakeIsolation(overrides: Partial<IsolationProvider> = {}): {
  isolation: IsolationProvider;
  acquire: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  findActiveByRun: ReturnType<typeof vi.fn>;
  listActiveByProject: ReturnType<typeof vi.fn>;
} {
  const acquire = vi.fn();
  const release = vi.fn(async () => undefined);
  const findActiveByRun = vi.fn(async () => makeFakeEnv());
  const listActiveByProject = vi.fn(async () => []);
  const isolation: IsolationProvider = {
    acquire,
    release,
    findActiveByRun,
    listActiveByProject,
    ...overrides,
  };
  return { isolation, acquire, release, findActiveByRun, listActiveByProject };
}

function makeFakeDeployBridge(overrides: Partial<DeployBridge> = {}): {
  bridge: DeployBridge;
  deploy: ReturnType<typeof vi.fn>;
} {
  const deploy = vi.fn(async () => ({ skipped: 'no-changes' as const }));
  const bridge: DeployBridge = {
    deploy,
    ...overrides,
  };
  return { bridge, deploy };
}

interface FakeDb {
  db: Database;
  inserts: { table: unknown; values: Record<string, unknown> }[];
}

function makeFakeDb(): FakeDb {
  const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
  const fake = {
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        inserts.push({ table, values });
      },
    }),
  };
  return { db: fake as unknown as Database, inserts };
}

describe('pipeline-terminal-hook', () => {
  it('completed status → invokes deployBridge.deploy and does NOT release env', async () => {
    const { bridge, deploy } = makeFakeDeployBridge();
    const { isolation, release } = makeFakeIsolation();
    const logger = makeLogger();
    const { db } = makeFakeDb();

    const hook = createPipelineTerminalHook({
      db,
      deployBridge: bridge,
      isolation,
      logger,
    });

    await hook.onTerminal({
      runId: 'run-1',
      projectId: 'proj-1',
      status: PIPELINE_RUN_STATUS.completed,
    });

    expect(deploy).toHaveBeenCalledTimes(1);
    expect(deploy).toHaveBeenCalledWith('run-1');
    expect(release).not.toHaveBeenCalled();
    expect(logger.records.some((r) => r.obj.event === 'deploy.invoked')).toBe(
      true
    );
  });

  it('completed + deploy throws → writes deploy_run failed row, releases env, does NOT mutate stage/pipeline rows', async () => {
    const deployErr = new DeployBridgeError('create-pr', 'PR creation blew up');
    const deploy = vi.fn(async () => {
      throw deployErr;
    });
    const bridge: DeployBridge = { deploy };
    const { isolation, release } = makeFakeIsolation();
    const logger = makeLogger();
    const { db, inserts } = makeFakeDb();

    const hook = createPipelineTerminalHook({
      db,
      deployBridge: bridge,
      isolation,
      logger,
    });

    await expect(
      hook.onTerminal({
        runId: 'run-1',
        projectId: 'proj-1',
        status: PIPELINE_RUN_STATUS.completed,
      })
    ).resolves.toBeUndefined();

    const errRecord = logger.records.find(
      (r) => r.obj.event === 'deploy.failed'
    );
    expect(errRecord).toBeDefined();
    expect(errRecord?.level).toBe('error');

    // Hook writes a deploy_run row capturing the failure (FLX-197).
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toMatchObject({
      pipelineRunId: 'run-1',
      status: DEPLOY_RUN_STATUS.failed,
      errorStage: 'create-pr',
      errorMessage: 'PR creation blew up',
    });
    expect(inserts[0].values.completedAt).toBeInstanceOf(Date);

    expect(release).toHaveBeenCalledWith('env-1', { force: false });
    expect(
      logger.records.some(
        (r) => r.obj.event === 'terminal-hook.env-released-after-deploy-failure'
      )
    ).toBe(true);
  });

  it('completed + non-DeployBridgeError throws → writes deploy_run failed row with null errorStage', async () => {
    const deploy = vi.fn(async () => {
      throw new Error('unexpected boom');
    });
    const bridge: DeployBridge = { deploy };
    const { isolation } = makeFakeIsolation();
    const logger = makeLogger();
    const { db, inserts } = makeFakeDb();

    const hook = createPipelineTerminalHook({
      db,
      deployBridge: bridge,
      isolation,
      logger,
    });

    await hook.onTerminal({
      runId: 'run-1',
      projectId: 'proj-1',
      status: PIPELINE_RUN_STATUS.completed,
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toMatchObject({
      pipelineRunId: 'run-1',
      status: DEPLOY_RUN_STATUS.failed,
      errorStage: null,
      errorMessage: 'unexpected boom',
    });
  });

  it('failed status → releases the active env and does NOT call deploy', async () => {
    const { bridge, deploy } = makeFakeDeployBridge();
    const { isolation, release, findActiveByRun } = makeFakeIsolation();
    const logger = makeLogger();
    const { db } = makeFakeDb();

    const hook = createPipelineTerminalHook({
      db,
      deployBridge: bridge,
      isolation,
      logger,
    });

    await hook.onTerminal({
      runId: 'run-1',
      projectId: 'proj-1',
      status: PIPELINE_RUN_STATUS.failed,
    });

    expect(deploy).not.toHaveBeenCalled();
    expect(findActiveByRun).toHaveBeenCalledWith('proj-1', 'run-1');
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith('env-1', { force: false });
    expect(
      logger.records.some((r) => r.obj.event === 'terminal-hook.env-released')
    ).toBe(true);
  });

  it('failed status + no active env → no-op, no error', async () => {
    const { bridge, deploy } = makeFakeDeployBridge();
    const findActiveByRun = vi.fn(async () => null);
    const release = vi.fn(async () => undefined);
    const isolation: IsolationProvider = {
      acquire: vi.fn(),
      release,
      findActiveByRun,
      listActiveByProject: vi.fn(async () => []),
    };
    const logger = makeLogger();
    const { db } = makeFakeDb();

    const hook = createPipelineTerminalHook({
      db,
      deployBridge: bridge,
      isolation,
      logger,
    });

    await hook.onTerminal({
      runId: 'run-1',
      projectId: 'proj-1',
      status: PIPELINE_RUN_STATUS.failed,
    });

    expect(deploy).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('failed status + UncommittedChangesError → swallows, logs terminal-hook.env-dirty', async () => {
    const { bridge } = makeFakeDeployBridge();
    const release = vi.fn(async () => {
      throw new UncommittedChangesError('env-1', '/tmp/fake');
    });
    const isolation: IsolationProvider = {
      acquire: vi.fn(),
      release,
      findActiveByRun: vi.fn(async () => makeFakeEnv()),
      listActiveByProject: vi.fn(async () => []),
    };
    const logger = makeLogger();
    const { db } = makeFakeDb();

    const hook = createPipelineTerminalHook({
      db,
      deployBridge: bridge,
      isolation,
      logger,
    });

    await expect(
      hook.onTerminal({
        runId: 'run-1',
        projectId: 'proj-1',
        status: PIPELINE_RUN_STATUS.failed,
      })
    ).resolves.toBeUndefined();

    expect(
      logger.records.some((r) => r.obj.event === 'terminal-hook.env-dirty')
    ).toBe(true);
  });

  it('failed status + null projectId → logs and returns (cannot locate env)', async () => {
    const { bridge } = makeFakeDeployBridge();
    const { isolation, findActiveByRun, release } = makeFakeIsolation();
    const logger = makeLogger();
    const { db } = makeFakeDb();

    const hook = createPipelineTerminalHook({
      db,
      deployBridge: bridge,
      isolation,
      logger,
    });

    await hook.onTerminal({
      runId: 'run-1',
      projectId: null,
      status: PIPELINE_RUN_STATUS.failed,
    });

    expect(findActiveByRun).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(
      logger.records.some((r) => r.obj.event === 'terminal-hook.no-project')
    ).toBe(true);
  });
});
