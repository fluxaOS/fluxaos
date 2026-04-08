import { randomUUID } from 'node:crypto';
import type { ResultPromise } from 'execa';
import { execa } from 'execa';
import type {
  ExecuteParams,
  ExecuteResult,
  StageExecutor,
} from '@/core/ports/stage-executor';

export class NodeExecAdapter implements StageExecutor {
  private processes = new Map<string, ResultPromise>();

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const processId = randomUUID();
    const startTime = Date.now();

    const subprocess = execa(params.command, params.args, {
      cwd: params.cwd,
      env: { ...process.env, ...params.env },
      timeout: params.timeoutMs,
      reject: false,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    this.processes.set(processId, subprocess);

    let stdout = '';
    let stderr = '';

    if (subprocess.stdout) {
      subprocess.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        params.onStdout?.(text);
      });
    }

    if (subprocess.stderr) {
      subprocess.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        params.onStderr?.(text);
      });
    }

    const result = await subprocess;
    this.processes.delete(processId);

    return {
      exitCode: result.exitCode ?? 1,
      stdout,
      stderr,
      durationMs: Date.now() - startTime,
      processId,
    };
  }

  async cancel(processId: string): Promise<void> {
    const proc = this.processes.get(processId);
    if (proc) {
      proc.kill('SIGTERM');
      this.processes.delete(processId);
    }
  }
}
