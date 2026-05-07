/**
 * Subprocess Stage Executor — runs commands as child processes.
 *
 * Implements the StageExecutor port via Node's built-in child_process.spawn.
 * Zero vendor imports. Handles stdout/stderr streaming, timeout, cancel.
 *
 * Previously used execa. Migrated during R-DAEMON W1 because tsx's CJS
 * path resolver fails on execa's transitive ESM deps (unicorn-magic),
 * blocking any `tsx` entrypoint that imports the bootstrap module graph.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_STAGE_TIMEOUT_SEC,
  KILL_GRACE_PERIOD_MS,
} from '@/core/constants';
import type {
  ExecuteParams,
  ExecuteResult,
  StageExecutor,
} from '@/core/ports/stage-executor';

const DEFAULT_TIMEOUT_MS = DEFAULT_STAGE_TIMEOUT_SEC * 1000;

/**
 * Env var prefixes that are safe to pass to AI subprocesses.
 * These are standard OS/shell vars required for a CLI tool to run.
 * Application secrets (FLUXAOS_*, ANTHROPIC_API_KEY, SUPABASE_*, etc.)
 * are intentionally excluded — they must be passed via explicit params.env.
 */
const SUBPROCESS_SAFE_ENV_PREFIXES = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'LANG',
  'LC_',
  'TMPDIR',
  'TEMP',
  'TMP',
  'XDG_',
];

/**
 * Build a minimal subprocess environment from the current process.env,
 * keeping only OS/shell vars from the allowlist, then merging explicit
 * overrides on top. This prevents server secrets from leaking to subprocesses.
 *
 * NODE_ENV is always forwarded so Node itself behaves correctly in the child
 * process. The cast to NodeJS.ProcessEnv satisfies spawn()'s overloads;
 * all values are guaranteed defined strings at runtime.
 */
function buildSubprocessEnv(
  overrides: Record<string, string>
): NodeJS.ProcessEnv {
  const safe: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (
      v !== undefined &&
      (k === 'NODE_ENV' ||
        SUBPROCESS_SAFE_ENV_PREFIXES.some((prefix) => k.startsWith(prefix)))
    ) {
      safe[k] = v;
    }
  }
  return { ...safe, ...overrides } as NodeJS.ProcessEnv;
}

export class SubprocessExecutor implements StageExecutor {
  private processes = new Map<string, ChildProcess>();

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const processId = randomUUID();
    const startTime = Date.now();
    const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let stdoutBuffer = '';
    let stderrBuffer = '';

    const child = spawn(params.command, params.args, {
      cwd: params.cwd,
      env: buildSubprocessEnv(params.env ?? {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.processes.set(processId, child);
    params.onStart?.(processId, child.pid ?? null);

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutBuffer += text;
      params.onStdout?.(text);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuffer += text;
      params.onStderr?.(text);
    });

    const exitCode: number = await new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, KILL_GRACE_PERIOD_MS);
      }, timeoutMs);

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stderrBuffer += `\n[spawn error] ${err.message}\n`;
        resolve(1);
      });

      child.on('close', (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== null) {
          resolve(code);
        } else {
          stderrBuffer += `\n[terminated by signal] ${signal ?? 'unknown'}\n`;
          resolve(1);
        }
      });
    });

    this.processes.delete(processId);

    return {
      exitCode,
      stdout: stdoutBuffer,
      stderr: stderrBuffer,
      durationMs: Date.now() - startTime,
      processId,
    };
  }

  async cancel(processId: string): Promise<void> {
    const proc = this.processes.get(processId);
    if (!proc) return;
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (this.processes.has(processId) && !proc.killed) {
        proc.kill('SIGKILL');
        this.processes.delete(processId);
      }
    }, KILL_GRACE_PERIOD_MS);
  }
}
