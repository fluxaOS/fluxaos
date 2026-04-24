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
import 'dotenv/config';
import { bootstrap } from '@/config/bootstrap';
import { registry } from '@/config/registry';
import { consoleLogger } from '@/core/logger/console';
import { createEventOrchestrator, type EventOrchestrator } from '@/core/orchestrator/event-orchestrator';
import { createPipelineTerminalHook } from '@/core/orchestrator/pipeline-terminal-hook';
import { createDeployBridge } from '@/core/deploy';
import { createCleanupScheduler, type CleanupScheduler } from '@/core/cleanup/cleanup-scheduler';
import { createCleanupService } from '@/core/cleanup/cleanup-service';
import { createIssueService } from '@/core/services/issue';
import {
  getArtifactsBase,
} from '@/adapters/git/artifacts-path';
import {
  getCanonicalRepoPath,
  hasUncommittedChanges,
  isBranchMerged,
} from '@/adapters/git/worktree';
import {
  getArtifactsDirAge,
  listArtifactDirs,
  removeArtifactsDir,
} from '@/adapters/fs/artifacts';
import type { DatabaseProvider } from '@/core/ports';
import type { RealtimeProvider } from '@/core/ports/realtime';
import type { IsolationProvider } from '@/core/ports/isolation';
import type { StageExecutor } from '@/core/ports/stage-executor';

const SHUTDOWN_GRACE_ENV = 'FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS';
const RECOVERY_SWEEP_ENV = 'FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN';

export interface DaemonEnv {
  shutdownGraceSeconds: number;
  recoverySweepIntervalMin: number | null;
}

export function parseEnv(): DaemonEnv {
  const graceRaw = process.env[SHUTDOWN_GRACE_ENV];
  if (!graceRaw) {
    throw new Error(
      `Missing required environment variable: ${SHUTDOWN_GRACE_ENV}. ` +
        'Set to a positive integer — operator owns the drain window (no default).',
    );
  }
  const grace = Number.parseInt(graceRaw, 10);
  if (!Number.isFinite(grace) || grace <= 0) {
    throw new Error(
      `${SHUTDOWN_GRACE_ENV} must be a positive integer; got "${graceRaw}".`,
    );
  }

  let sweep: number | null = null;
  const sweepRaw = process.env[RECOVERY_SWEEP_ENV];
  if (sweepRaw !== undefined && sweepRaw !== '') {
    const n = Number.parseInt(sweepRaw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(
        `${RECOVERY_SWEEP_ENV} must be a positive integer when set; got "${sweepRaw}".`,
      );
    }
    sweep = n;
  }

  return { shutdownGraceSeconds: grace, recoverySweepIntervalMin: sweep };
}

export interface Daemon {
  orchestrator: EventOrchestrator;
  cleanupScheduler: CleanupScheduler;
  env: DaemonEnv;
}

/**
 * Wire the orchestrator + cleanup scheduler + terminal hook and start
 * them. Exported so integration tests can spin the daemon up without
 * the process-level signal handlers or top-level await.
 */
export async function createDaemon(): Promise<Daemon> {
  const env = parseEnv();
  bootstrap();

  consoleLogger.info(
    {
      event: 'daemon.booting',
      shutdownGraceSeconds: env.shutdownGraceSeconds,
      recoverySweepIntervalMin: env.recoverySweepIntervalMin,
    },
  );

  const dbProvider = registry.get<DatabaseProvider>('database');
  const db = dbProvider.getConnection();
  const realtime = registry.get<RealtimeProvider>('realtime');
  const isolation = registry.get<IsolationProvider>('isolation');
  const executor = registry.get<StageExecutor>('executor');
  const issueService = createIssueService(db);

  const deployBridge = createDeployBridge({
    db,
    registry,
    logger: consoleLogger,
    isolation,
    issueService,
  });

  const terminalHook = createPipelineTerminalHook({
    deployBridge,
    isolation,
    logger: consoleLogger,
  });

  const orchestrator = createEventOrchestrator(
    db,
    executor,
    realtime,
    isolation,
    terminalHook,
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
      getArtifactsBase,
    },
  });

  const cleanupScheduler = createCleanupScheduler({
    cleanupService,
    logger: consoleLogger,
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

  const cleanupRunning = cleanupScheduler.isRunning();
  // Sentinel line — journey test greps for /daemon\.started /.
  // recovery_sweep=disabled here; W4 flips to enabled when the interval is wired.
  console.log(
    `daemon.started orchestrator=running cleanup=${cleanupRunning ? 'running' : 'disabled'} recovery_sweep=disabled`,
  );

  return { orchestrator, cleanupScheduler, env };
}

async function main(): Promise<void> {
  await createDaemon();
  // Keep the process alive. W3 adds signal handlers + graceful drain.
  await new Promise<void>(() => {
    // Intentionally never resolves.
  });
}

// Only run main when invoked directly (not when imported by tests).
const isMainModule = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    // tsx/ts-node invoke with the .ts path; Node with .js. Match both.
    return argv1.endsWith('daemon.ts') || argv1.endsWith('daemon.js');
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
