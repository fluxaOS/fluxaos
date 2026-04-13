/**
 * Subprocess Stage Executor — runs commands as child processes.
 *
 * Implements the StageExecutor port. Spawns a process with the given
 * command/args/env, captures stdout/stderr, respects timeout, supports
 * cancellation. The executor doesn't know what it's running — it just
 * spawns a process and reports results.
 *
 * Uses execa for subprocess management.
 */
import { execa, type ResultPromise } from 'execa';
import { randomUUID } from 'crypto';
import { KILL_GRACE_PERIOD_MS } from '@/core/constants';
import type {
  StageExecutor,
  ExecuteParams,
  ExecuteResult,
} from '@/core/ports/stage-executor';

export class SubprocessExecutor implements StageExecutor {
  private processes = new Map<string, ResultPromise>();

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const processId = randomUUID();
    const startTime = Date.now();

    let stdoutBuffer = '';
    let stderrBuffer = '';

    const subprocess = execa(params.command, params.args, {
      cwd: params.cwd,
      env: { ...process.env, ...params.env },
      timeout: params.timeoutMs ?? 300_000,
      reject: false,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    this.processes.set(processId, subprocess);

    // Stream stdout
    if (subprocess.stdout) {
      subprocess.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdoutBuffer += text;
        params.onStdout?.(text);
      });
    }

    // Stream stderr
    if (subprocess.stderr) {
      subprocess.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderrBuffer += text;
        params.onStderr?.(text);
      });
    }

    const result = await subprocess;
    this.processes.delete(processId);

    return {
      exitCode: result.exitCode ?? 1,
      stdout: stdoutBuffer,
      stderr: stderrBuffer,
      durationMs: Date.now() - startTime,
      processId,
    };
  }

  async cancel(processId: string): Promise<void> {
    const proc = this.processes.get(processId);
    if (proc) {
      proc.kill('SIGTERM');
      // Give it 5s to clean up, then force kill
      setTimeout(() => {
        if (this.processes.has(processId)) {
          proc.kill('SIGKILL');
          this.processes.delete(processId);
        }
      }, KILL_GRACE_PERIOD_MS);
    }
  }
}
