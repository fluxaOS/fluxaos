/**
 * Cleanup scheduler — thin setInterval harness around cleanup-service.
 *
 * Wired from the daemon bootstrap. The four scheduling thresholds and the
 * scheduler_enabled gate all live in `config_entry` rows (scope=`'global'`,
 * project_id=NULL) — see `cleanup.*` keys in
 * `src/core/constants.ts` GLOBAL_CONFIG_KEY (FLX-224). The scheduler reads
 * the four threshold rows on every sweep tick (no module-level cache, no
 * value carried in deps), so an operator edit in Settings → System takes
 * effect on the very next sweep without a daemon restart.
 *
 * No env reads happen in this file.
 *
 * Shape borrowed from Archon's packages/core/src/services/cleanup-scheduler.ts
 * (MIT, shape-only).
 */

import type { Database } from '@/core/db/connection';
import {
  getCleanupArtifactsRetentionDays,
  getCleanupSessionRetentionDays,
  getCleanupStaleDays,
  getCleanupSweepIntervalMin,
} from '@/core/services/runtime-config';
import type { CleanupLogger, CleanupReport } from './cleanup-service';

export interface CleanupSchedulerDeps {
  db: Database;
  cleanupService: {
    runScheduledSweep(): Promise<CleanupReport>;
  };
  logger: CleanupLogger;
}

export interface CleanupScheduler {
  start(): Promise<void>;
  stop(): void;
  isRunning(): boolean;
}

export function createCleanupScheduler(
  deps: CleanupSchedulerDeps
): CleanupScheduler {
  const { db, cleanupService, logger } = deps;
  let timer: NodeJS.Timeout | null = null;

  function isRunning(): boolean {
    return timer !== null;
  }

  async function start(): Promise<void> {
    if (timer !== null) {
      logger.warn({}, 'cleanup_scheduler.already_running');
      return;
    }

    // Read sweep interval up front to size the setInterval cadence. The
    // per-sweep thresholds (stale/session/artifacts retention) are pulled
    // fresh inside cleanup-service on every tick — operator edits to those
    // rows take effect on the next sweep without a restart. The interval
    // itself only re-reads on the next start() (daemon restart), which is
    // an intentional trade-off: changing the cadence is rare and ad-hoc.
    const sweepIntervalMin = await getCleanupSweepIntervalMin(db);
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

    // Log the initial snapshot of the threshold rows. These get re-read on
    // every sweep, so this is for human inspection of "what was true when
    // the scheduler started"; the live values may diverge.
    const [staleDays, sessionRetentionDays, artifactsRetentionDays] =
      await Promise.all([
        getCleanupStaleDays(db),
        getCleanupSessionRetentionDays(db),
        getCleanupArtifactsRetentionDays(db),
      ]);

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
