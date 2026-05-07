// e2e/helpers/daemon.ts
//
// Shared boilerplate for Playwright specs that spawn the orchestrator
// daemon as a child process. Used by:
//   - e2e/r-daemon-autonomous-run.spec.ts
//   - e2e/r-mission-control.spec.ts
//   - e2e/r-smoke.spec.ts
//
// Boots tsx + src/scripts/daemon.ts with operator env, waits for the
// `daemon.started ...` sentinel, and exposes a SIGTERM-based shutdown
// that races a 90s deadline (matches FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS=60
// + 30s slack).

import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';

const DEFAULT_BOOT_TIMEOUT_MS = 30_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 90_000;
const DAEMON_READY_REGEX = /daemon\.started /;

export interface SpawnDaemonOptions {
  /** Seconds the daemon waits for in-flight stage_runs to drain after SIGTERM. */
  graceSeconds?: number;
  /** Periodic recovery-sweep cadence in minutes. */
  recoveryIntervalMin?: number;
  /** Override boot wait timeout (ms). */
  bootTimeoutMs?: number;
  /** Override SIGTERM wait timeout (ms). Must exceed graceSeconds * 1000. */
  shutdownTimeoutMs?: number;
  /** Cleanup scheduler sweep cadence in minutes. Defaults to 1 (test-suitable). */
  cleanupSweepIntervalMin?: number;
  /** Days before a worktree/workspace is considered stale. Defaults to 1 (test-suitable). */
  cleanupStaleDays?: number;
  /** Days to retain session artifacts. Defaults to 1 (test-suitable). */
  cleanupSessionRetentionDays?: number;
  /** Days to retain run artifacts. Defaults to 1 (test-suitable). */
  cleanupArtifactsRetentionDays?: number;
}

export interface DaemonHandle {
  daemon: ChildProcess;
  stdout: string[];
  stderr: string[];
  /** Send SIGTERM and wait for exit; throws on timeout. */
  shutdown(): Promise<void>;
}

export async function spawnDaemon(
  options: SpawnDaemonOptions = {}
): Promise<DaemonHandle> {
  const graceSeconds = options.graceSeconds ?? 60;
  const recoveryIntervalMin = options.recoveryIntervalMin ?? 5;
  const bootTimeoutMs = options.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;
  const shutdownTimeoutMs =
    options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const cleanupSweepIntervalMin = options.cleanupSweepIntervalMin ?? 1;
  const cleanupStaleDays = options.cleanupStaleDays ?? 1;
  const cleanupSessionRetentionDays = options.cleanupSessionRetentionDays ?? 1;
  const cleanupArtifactsRetentionDays =
    options.cleanupArtifactsRetentionDays ?? 1;

  const env = {
    ...process.env,
    FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS: String(graceSeconds),
    FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN: String(recoveryIntervalMin),
    FLUXAOS_CLEANUP_SWEEP_INTERVAL_MIN: String(cleanupSweepIntervalMin),
    FLUXAOS_CLEANUP_STALE_DAYS: String(cleanupStaleDays),
    FLUXAOS_CLEANUP_SESSION_RETENTION_DAYS: String(cleanupSessionRetentionDays),
    FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS: String(
      cleanupArtifactsRetentionDays
    ),
  };
  const tsxBin = resolve(process.cwd(), 'node_modules/.bin/tsx');
  const child = spawn(tsxBin, ['src/scripts/daemon.ts'], {
    env,
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!child.stdout || !child.stderr) {
    throw new Error('daemon stdio was not piped');
  }

  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));

  await new Promise<void>((resolveReady, rejectReady) => {
    const timer = setTimeout(() => {
      rejectReady(
        new Error(
          `Daemon failed to emit "${DAEMON_READY_REGEX}" within ${bootTimeoutMs}ms. stdout so far:\n${stdout.join('')}\nstderr:\n${stderr.join('')}`
        )
      );
    }, bootTimeoutMs);

    const checkReady = () => {
      if (DAEMON_READY_REGEX.test(stdout.join(''))) {
        clearTimeout(timer);
        resolveReady();
      }
    };
    child.stdout?.on('data', checkReady);
    child.on('exit', (code) => {
      clearTimeout(timer);
      rejectReady(
        new Error(
          `Daemon exited before ready (code=${code}). stdout:\n${stdout.join('')}\nstderr:\n${stderr.join('')}`
        )
      );
    });
  });

  async function shutdown(): Promise<void> {
    if (child.exitCode !== null) return;
    const exited = new Promise<void>((resolveExit) => {
      child.on('exit', () => resolveExit());
    });
    child.kill('SIGTERM');
    await Promise.race([
      exited,
      new Promise<void>((_r, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Daemon did not exit within ${shutdownTimeoutMs}ms after SIGTERM.`
              )
            ),
          shutdownTimeoutMs
        )
      ),
    ]);
  }

  return { daemon: child, stdout, stderr, shutdown };
}
