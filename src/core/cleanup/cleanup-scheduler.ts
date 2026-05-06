/**
 * Cleanup scheduler — thin setInterval harness around cleanup-service.
 *
 * Wired from the orchestrator bootstrap or a dev-only entry that sets
 * FLUXAOS_RUN_CLEANUP_SCHEDULER=1. All four scheduling thresholds are
 * injected via deps — no process.env reads in this file.
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
  /** How often the sweep runs (minutes). */
  sweepIntervalMin: number;
  /** Maximum worktree age in days before considered stale. */
  staleDays: number;
  /** Minimum session age in days before a terminal session is reaped. */
  sessionRetentionDays: number;
  /** Minimum age in days before a terminal artifacts dir is reaped. */
  artifactsRetentionDays: number;
}

export interface CleanupScheduler {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export function createCleanupScheduler(
  deps: CleanupSchedulerDeps
): CleanupScheduler {
  const {
    cleanupService,
    logger,
    sweepIntervalMin,
    staleDays,
    sessionRetentionDays,
    artifactsRetentionDays,
  } = deps;
  let timer: NodeJS.Timeout | null = null;

  function isRunning(): boolean {
    return timer !== null;
  }

  function start(): void {
    if (timer !== null) {
      logger.warn({}, 'cleanup_scheduler.already_running');
      return;
    }

    const intervalMs = sweepIntervalMin * 60 * 1000;
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
        intervalMin: sweepIntervalMin,
        staleDays,
        sessionRetentionDays,
        artifactsRetentionDays,
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
