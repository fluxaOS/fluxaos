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
import { bootstrap } from '../config/bootstrap';

const SHUTDOWN_GRACE_ENV = 'FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS';
const RECOVERY_SWEEP_ENV = 'FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN';

interface DaemonEnv {
  shutdownGraceSeconds: number;
  recoverySweepIntervalMin: number | null;
}

function parseEnv(): DaemonEnv {
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

async function main(): Promise<void> {
  const env = parseEnv();
  bootstrap();

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      event: 'daemon.booting',
      shutdownGraceSeconds: env.shutdownGraceSeconds,
      recoverySweepIntervalMin: env.recoverySweepIntervalMin,
    }),
  );

  // W1 scaffold: idle loop. W2 wires orchestrator + cleanup + recovery.
  await new Promise<void>(() => {
    // Intentionally never resolves. Process stays alive until a signal
    // handler (added in W3) terminates it or Node's default SIGINT fires.
  });
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      event: 'daemon.fatal',
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(1);
});
