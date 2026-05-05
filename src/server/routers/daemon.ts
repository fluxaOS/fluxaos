/**
 * Daemon control router — start, stop (immediate), drain (graceful), restart,
 * and status queries for the fluxaos-daemon systemd user unit.
 *
 * All mutations shell out to `systemctl --user` which works because the
 * Next.js web process and the daemon run as the same OS user on this homelab.
 * Mutations are restricted to admin role.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod/v4';
import { protectedMutation, publicProcedure, router } from '../trpc';

const execFileAsync = promisify(execFile);

const UNIT = 'fluxaos-daemon';

type DaemonState = 'running' | 'stopped' | 'draining' | 'unknown';

async function getSystemctlState(): Promise<DaemonState> {
  try {
    const { stdout } = await execFileAsync('systemctl', [
      '--user',
      'is-active',
      UNIT,
    ]);
    const state = stdout.trim();
    if (state === 'active') return 'running';
    if (state === 'deactivating') return 'draining';
    return 'stopped';
  } catch {
    // is-active exits non-zero when inactive/failed
    return 'stopped';
  }
}

export const daemonRouter = router({
  status: publicProcedure.query(async () => {
    const state = await getSystemctlState();
    return { state };
  }),

  start: protectedMutation(['admin']).mutation(async () => {
    const current = await getSystemctlState();
    if (current === 'running') {
      return { ok: true, state: 'running' as DaemonState };
    }
    await execFileAsync('systemctl', ['--user', 'start', UNIT]);
    return { ok: true, state: 'running' as DaemonState };
  }),

  // Graceful shutdown — SIGTERM lets in-flight stages finish within grace period.
  drain: protectedMutation(['admin']).mutation(async () => {
    await execFileAsync('systemctl', ['--user', 'stop', UNIT]);
    return { ok: true, state: 'stopped' as DaemonState };
  }),

  // Immediate kill — use when something is broken and the daemon must die now.
  stop: protectedMutation(['admin'])
    .input(z.object({ confirm: z.literal(true) }))
    .mutation(async () => {
      await execFileAsync('systemctl', ['--user', 'kill', '--kill-who=all', '--signal=SIGKILL', UNIT]);
      return { ok: true, state: 'stopped' as DaemonState };
    }),

  restart: protectedMutation(['admin']).mutation(async () => {
    await execFileAsync('systemctl', ['--user', 'restart', UNIT]);
    return { ok: true, state: 'running' as DaemonState };
  }),
});
