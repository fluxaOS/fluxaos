/**
 * Cleanup scheduler — thin setInterval harness around cleanup-service.
 *
 * Wired from the orchestrator bootstrap or a dev-only entry that sets
 * FLUXAOS_RUN_CLEANUP_SCHEDULER=1. Refuses to start unless all four
 * required env vars are set with parseable positive integers:
 *
 *   - FLUXAOS_CLEANUP_SWEEP_INTERVAL_MIN
 *   - FLUXAOS_CLEANUP_STALE_DAYS
 *   - FLUXAOS_CLEANUP_SESSION_RETENTION_DAYS
 *   - FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS   (R-ARTIFACTS W4)
 *
 * The no-defaults stance comes from the no-invented-thresholds rule:
 * numbers with real operational meaning belong to the operator, not the
 * spec or code.
 *
 * Shape borrowed from Archon's packages/core/src/services/cleanup-scheduler.ts
 * (MIT, shape-only).
 */

import type { CleanupLogger, CleanupReport } from './cleanup-service';

export interface CleanupSchedulerDeps {
  cleanupService: {
    runScheduledSweep(): Promise<CleanupReport>;
  };
  logger: CleanupLogger;
}

export interface CleanupScheduler {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

// Env-var names exposed for tests and docs.
export const SWEEP_INTERVAL_ENV = 'FLUXAOS_CLEANUP_SWEEP_INTERVAL_MIN';
export const STALE_DAYS_ENV = 'FLUXAOS_CLEANUP_STALE_DAYS';
export const SESSION_RETENTION_ENV = 'FLUXAOS_CLEANUP_SESSION_RETENTION_DAYS';
export const ARTIFACTS_RETENTION_ENV =
  'FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS';

interface ParsedConfig {
  intervalMin: number;
  staleDays: number;
  sessionRetentionDays: number;
  artifactsRetentionDays: number;
}

function parseConfig(): ParsedConfig | { missing: string[] } {
  const missing: string[] = [];
  const required = [
    SWEEP_INTERVAL_ENV,
    STALE_DAYS_ENV,
    SESSION_RETENTION_ENV,
    ARTIFACTS_RETENTION_ENV,
  ];
  const parsed: Record<string, number> = {};
  for (const name of required) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') {
      missing.push(name);
      continue;
    }
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      missing.push(name);
      continue;
    }
    parsed[name] = n;
  }
  if (missing.length > 0) return { missing };
  return {
    intervalMin: parsed[SWEEP_INTERVAL_ENV],
    staleDays: parsed[STALE_DAYS_ENV],
    sessionRetentionDays: parsed[SESSION_RETENTION_ENV],
    artifactsRetentionDays: parsed[ARTIFACTS_RETENTION_ENV],
  };
}

export function createCleanupScheduler(
  deps: CleanupSchedulerDeps
): CleanupScheduler {
  const { cleanupService, logger } = deps;
  let timer: NodeJS.Timeout | null = null;

  function isRunning(): boolean {
    return timer !== null;
  }

  function start(): void {
    if (timer !== null) {
      logger.warn({}, 'cleanup_scheduler.already_running');
      return;
    }

    const config = parseConfig();
    if ('missing' in config) {
      logger.warn(
        { missing: config.missing },
        'cleanup_scheduler.disabled_missing_env'
      );
      return;
    }

    const intervalMs = config.intervalMin * 60 * 1000;
    timer = setInterval(() => {
      void cleanupService.runScheduledSweep().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ error: message }, 'cleanup_scheduler.sweep_failed');
      });
    }, intervalMs);

    // Unref so the interval does not keep the process alive on its own —
    // the orchestrator daemon owns process lifetime.
    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    logger.info(
      {
        intervalMin: config.intervalMin,
        staleDays: config.staleDays,
        sessionRetentionDays: config.sessionRetentionDays,
        artifactsRetentionDays: config.artifactsRetentionDays,
      },
      'cleanup_scheduler.started'
    );
  }

  function stop(): void {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
    logger.info({}, 'cleanup_scheduler.stopped');
  }

  return { start, stop, isRunning };
}
