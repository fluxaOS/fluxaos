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
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';
import { protectedMutation, publicProcedure, router } from '../trpc';

const execFileAsync = promisify(execFile);

const UNIT = 'fluxaos-daemon';

type DaemonState = 'running' | 'stopped' | 'draining' | 'unknown';

// systemctl --user requires XDG_RUNTIME_DIR when running from a non-interactive
// process (e.g. nohup Next.js server). Derive it from the process uid.
function systemctlEnv(): NodeJS.ProcessEnv {
  const uid = process.getuid?.() ?? 1000;
  return {
    ...process.env,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? `/run/user/${uid}`,
  };
}

async function systemctl(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('systemctl', ['--user', ...args], {
    env: systemctlEnv(),
  });
  return stdout.trim();
}

async function getSystemctlState(): Promise<DaemonState> {
  try {
    const state = await systemctl('is-active', UNIT);
    if (state === 'active') return 'running';
    if (state === 'deactivating') return 'draining';
    return 'stopped';
  } catch {
    // is-active exits non-zero when inactive/failed — that's stopped, not an error
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
    try {
      await systemctl('start', UNIT);
    } catch (err) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to start daemon: ${String(err)}`,
      });
    }
    return { ok: true, state: 'running' as DaemonState };
  }),

  // Graceful shutdown — SIGTERM lets in-flight stages finish within grace period.
  drain: protectedMutation(['admin']).mutation(async () => {
    try {
      await systemctl('stop', UNIT);
    } catch (err) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to drain daemon: ${String(err)}`,
      });
    }
    return { ok: true, state: 'stopped' as DaemonState };
  }),

  // Immediate kill — use when something is broken and the daemon must die now.
  stop: protectedMutation(['admin'])
    .input(z.object({ confirm: z.literal(true) }))
    .mutation(async () => {
      try {
        await systemctl('kill', '--kill-who=all', '--signal=SIGKILL', UNIT);
      } catch (err) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to stop daemon: ${String(err)}`,
        });
      }
      return { ok: true, state: 'stopped' as DaemonState };
    }),

  restart: protectedMutation(['admin']).mutation(async () => {
    try {
      await systemctl('restart', UNIT);
    } catch (err) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to restart daemon: ${String(err)}`,
      });
    }
    return { ok: true, state: 'running' as DaemonState };
  }),
});
