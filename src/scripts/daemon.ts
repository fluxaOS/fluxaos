/**
 * fluxaOS orchestrator daemon — long-running process.
 *
 * Subscribes to Realtime for pipeline_run INSERT/UPDATE, dispatches
 * stage runs via the event-orchestrator, runs periodic crash recovery,
 * and owns the cleanup scheduler's lifetime. Runs under systemd user unit
 * `ops/systemd/fluxaos-daemon.service` or via `npm run daemon` for dev.
 *
 * See docs/superpowers/specs/2026-04-24-r-daemon-design.md and
 * docs/superpowers/plans/2026-04-24-r-daemon-implementation.md.
 */

import { join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { eq, sql } from 'drizzle-orm';
import {
  getArtifactsDirAge,
  listArtifactDirs,
  removeArtifactsDir,
} from '@/adapters/fs/artifacts';
import { getArtifactsBase } from '@/adapters/git/artifacts-path';
import { createGitOps } from '@/adapters/git/git-ops';
import {
  getCanonicalRepoPath,
  hasUncommittedChanges,
  isBranchMerged,
} from '@/adapters/git/worktree';
import { bootstrap } from '@/config/bootstrap';
import { loadFluxaosConfig } from '@/config/env';
import { registry } from '@/config/registry';
import {
  type CleanupScheduler,
  createCleanupScheduler,
} from '@/core/cleanup/cleanup-scheduler';
import { createCleanupService } from '@/core/cleanup/cleanup-service';
import {
  EVENT_TYPE,
  PIPELINE_RUN_STATUS,
  STAGE_RUN_STATUS,
} from '@/core/constants';
import type { Database } from '@/core/db/connection';
import { stageRun } from '@/core/db/schema';
import { createDeployBridge } from '@/core/deploy';
import { consoleLogger } from '@/core/logger/console';
import {
  createEventOrchestrator,
  type EventOrchestrator,
} from '@/core/orchestrator/event-orchestrator';
import { createPipelineRunService } from '@/core/orchestrator/pipeline-run-service';
import { createPipelineTerminalHook } from '@/core/orchestrator/pipeline-terminal-hook';
import type { DatabaseProvider } from '@/core/ports';
import type { IsolationProvider } from '@/core/ports/isolation';
import type { RealtimeProvider } from '@/core/ports/realtime';
import type { StageExecutor } from '@/core/ports/stage-executor';
import type { StageGraphRunner } from '@/core/ports/stage-graph-runner';
import { createIssueService } from '@/core/services/issue';

const SHUTDOWN_GRACE_ENV = 'FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS';
const RECOVERY_SWEEP_ENV = 'FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN';

export function loadDaemonEnvFiles(cwd = process.cwd()): void {
  if (process.env.NODE_ENV === 'production') return;

  loadDotenv({ path: join(cwd, '.env'), override: false, quiet: true });
  loadDotenv({ path: join(cwd, '.env.local'), override: false, quiet: true });
}

export interface DaemonEnv {
  shutdownGraceSeconds: number;
  recoverySweepIntervalMin: number | null;
}

export function parseEnv(): DaemonEnv {
  const graceRaw = process.env[SHUTDOWN_GRACE_ENV];
  if (!graceRaw) {
    throw new Error(
      `Missing required environment variable: ${SHUTDOWN_GRACE_ENV}. ` +
        'Set to a positive integer — operator owns the drain window (no default).'
    );
  }
  if (!/^[1-9]\d*$/.test(graceRaw)) {
    throw new Error(
      `${SHUTDOWN_GRACE_ENV} must be a positive integer; got "${graceRaw}".`
    );
  }
  const grace = Number(graceRaw);

  let sweep: number | null = null;
  const sweepRaw = process.env[RECOVERY_SWEEP_ENV];
  if (sweepRaw !== undefined && sweepRaw !== '') {
    if (!/^[1-9]\d*$/.test(sweepRaw)) {
      throw new Error(
        `${RECOVERY_SWEEP_ENV} must be a positive integer when set; got "${sweepRaw}".`
      );
    }
    const n = Number(sweepRaw);
    sweep = n;
  }

  return { shutdownGraceSeconds: grace, recoverySweepIntervalMin: sweep };
}

export interface Daemon {
  orchestrator: EventOrchestrator;
  cleanupScheduler: CleanupScheduler;
  env: DaemonEnv;
  /** Graceful shutdown. Safe to call multiple times. */
  shutdown: (reason: string) => Promise<void>;
}

const DRAIN_POLL_INTERVAL_MS = 500;

// Single-tenant assumption: drain count covers ALL running stage_runs globally.
// A stuck run from another tenant's daemon would permanently block graceful
// shutdown. In a multi-tenant deployment this would filter by daemonInstanceId
// or boot time to drain only this instance's runs. (FLX-148)
async function drainRunningStageRuns(
  db: Database,
  graceMs: number
): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < graceMs) {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(stageRun)
      .where(eq(stageRun.status, STAGE_RUN_STATUS.running));
    const remaining = rows[0]?.count ?? 0;
    if (remaining === 0) return 0;
    await new Promise((r) => setTimeout(r, DRAIN_POLL_INTERVAL_MS));
  }
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stageRun)
    .where(eq(stageRun.status, STAGE_RUN_STATUS.running));
  return rows[0]?.count ?? 0;
}

/**
 * Wire the orchestrator + cleanup scheduler + terminal hook and start
 * them. Exported so integration tests can spin the daemon up without
 * the process-level signal handlers or top-level await.
 */
export async function createDaemon(): Promise<Daemon> {
  loadDaemonEnvFiles();
  const env = parseEnv();
  const fluxaosConfig = loadFluxaosConfig();
  bootstrap(fluxaosConfig);

  consoleLogger.info({
    event: 'daemon.booting',
    shutdownGraceSeconds: env.shutdownGraceSeconds,
    recoverySweepIntervalMin: env.recoverySweepIntervalMin,
  });

  const dbProvider = registry.get<DatabaseProvider>('database');
  const db = dbProvider.getConnection();
  const realtime = registry.get<RealtimeProvider>('realtime');
  const isolation = registry.get<IsolationProvider>('isolation');
  const executor = registry.get<StageExecutor>('executor');
  const issueService = createIssueService(db);
  const runService = createPipelineRunService(db);

  const gitOps = createGitOps();

  const deployBridge = createDeployBridge({
    db,
    registry,
    logger: consoleLogger,
    isolation,
    issueService,
    gitOps,
  });

  const terminalHook = createPipelineTerminalHook({
    deployBridge,
    isolation,
    logger: consoleLogger,
    onDeployFailure: async ({ runId, error }) => {
      const stageRuns = await runService.getStageRuns(runId);
      const latestStageRun = stageRuns.at(-1);
      const message = error instanceof Error ? error.message : String(error);
      if (latestStageRun) {
        await runService.completeStageRun(
          latestStageRun.id,
          STAGE_RUN_STATUS.failed,
          {
            errorMessage: `deploy failed: ${message}`,
          }
        );
        await runService.appendEvent(latestStageRun.id, EVENT_TYPE.error, {
          message: `deploy failed: ${message}`,
        });
      }
      await runService.completeRun(runId, PIPELINE_RUN_STATUS.failed);
    },
  });

  const stageGraphRunner = registry.get<StageGraphRunner>('stageGraphRunner');

  const orchestrator = createEventOrchestrator(
    db,
    realtime,
    terminalHook,
    {},
    fluxaosConfig,
    stageGraphRunner
  );

  const cleanupService = createCleanupService({
    db,
    isolation,
    logger: consoleLogger,
    git: {
      hasUncommittedChanges,
      isBranchMerged,
      getCanonicalRepoPath,
      listArtifactDirs,
      removeArtifactsDir,
      getArtifactsDirAge,
      getArtifactsBase: (repoPath: string) =>
        getArtifactsBase(repoPath, {
          artifactsRoot: fluxaosConfig.artifactsRoot,
          workspaceRoot: fluxaosConfig.workspaceRoot,
        }),
    },
    cleanupStaleDays: fluxaosConfig.cleanupStaleDays,
    cleanupArtifactsRetentionDays: fluxaosConfig.cleanupArtifactsRetentionDays,
  });

  const cleanupScheduler = createCleanupScheduler({
    cleanupService,
    logger: consoleLogger,
    sweepIntervalMin: fluxaosConfig.cleanupSweepIntervalMin,
    staleDays: fluxaosConfig.cleanupStaleDays,
    sessionRetentionDays: fluxaosConfig.cleanupSessionRetentionDays,
    artifactsRetentionDays: fluxaosConfig.cleanupArtifactsRetentionDays,
  });

  await orchestrator.recoverOnStartup();
  consoleLogger.info({ event: 'daemon.recovery_complete' });

  orchestrator.start();
  consoleLogger.info({ event: 'daemon.orchestrator_started' });

  cleanupScheduler.start();
  consoleLogger.info({
    event: 'daemon.cleanup_scheduler_started',
    running: cleanupScheduler.isRunning(),
  });

  let recoverySweepTimer: NodeJS.Timeout | null = null;
  if (env.recoverySweepIntervalMin !== null) {
    const intervalMs = env.recoverySweepIntervalMin * 60 * 1000;
    recoverySweepTimer = setInterval(() => {
      void orchestrator
        .recoverOnStartup()
        .then(() => {
          consoleLogger.info({ event: 'daemon.recovery_sweep_ran' });
        })
        .catch((err: unknown) => {
          consoleLogger.error({
            event: 'daemon.recovery_sweep_failed',
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }, intervalMs);
    // unref so the interval does not hold the event loop open on its own
    if (typeof recoverySweepTimer.unref === 'function') {
      recoverySweepTimer.unref();
    }
  }

  const cleanupRunning = cleanupScheduler.isRunning();
  const sweepEnabled = recoverySweepTimer !== null;
  // Sentinel line — journey test greps for /daemon\.started /.
  console.log(
    `daemon.started orchestrator=running cleanup=${cleanupRunning ? 'running' : 'disabled'} recovery_sweep=${sweepEnabled ? 'enabled' : 'disabled'}`
  );

  let shuttingDown = false;
  async function shutdown(reason: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    consoleLogger.info({ event: 'daemon.shutdown_initiated', reason });
    orchestrator.stop();
    consoleLogger.info({ event: 'daemon.orchestrator_stopped' });
    cleanupScheduler.stop();
    consoleLogger.info({ event: 'daemon.cleanup_scheduler_stopped' });
    if (recoverySweepTimer !== null) {
      clearInterval(recoverySweepTimer);
      recoverySweepTimer = null;
    }
    const graceMs = env.shutdownGraceSeconds * 1000;
    const remaining = await drainRunningStageRuns(db, graceMs);
    consoleLogger.info({
      event: 'daemon.drain_completed',
      remaining,
      graceSeconds: env.shutdownGraceSeconds,
    });
  }

  return { orchestrator, cleanupScheduler, env, shutdown };
}

async function main(): Promise<void> {
  const daemon = await createDaemon();

  let signalCount = 0;
  const onSignal = (signal: NodeJS.Signals) => {
    signalCount += 1;
    if (signalCount > 1) {
      consoleLogger.warn({ event: 'daemon.force_exit', signal, signalCount });
      process.exit(130);
      return;
    }
    daemon
      .shutdown(signal)
      .then(() => process.exit(0))
      .catch((err) => {
        consoleLogger.error({
          event: 'daemon.shutdown_error',
          error: err instanceof Error ? err.message : String(err),
        });
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));

  // Hold the event loop open until a signal fires.
  await new Promise<void>(() => {
    // Intentionally never resolves.
  });
}

// Only run main when invoked directly (not when imported by tests).
const isMainModule = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    // tsx/ts-node invoke with the .ts path; Node with .js/.mjs. Match both.
    return (
      argv1.endsWith('daemon.ts') ||
      argv1.endsWith('daemon.js') ||
      argv1.endsWith('daemon.mjs')
    );
  } catch {
    return false;
  }
})();

if (isMainModule) {
  main().catch((err) => {
    consoleLogger.error({
      event: 'daemon.fatal',
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
