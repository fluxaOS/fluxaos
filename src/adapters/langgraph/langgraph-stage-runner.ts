import { execFile, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { promisify } from 'node:util';
import {
  Annotation,
  type BaseCheckpointSaver,
  END,
  START,
  StateGraph,
} from '@langchain/langgraph';
import type { StageGraphInput } from '@/core/ports/stage-graph-runner';

export type { StageGraphInput };

const execFileAsync = promisify(execFile);

/**
 * Driver lifecycle callbacks, keyed by stageRunId (FLX-266).
 *
 * Functions cannot ride through graph state — the checkpointer serializes
 * state between nodes and would drop (or choke on) them. runStageGraph
 * registers the caller's callbacks here before invoking the graph and
 * removes them in a finally; executeNode looks them up by stageRunId.
 */
const driverCallbacks = new Map<
  string,
  {
    onDriverStart?: (pid: number) => void;
    onDriverStdout?: (line: string) => void;
  }
>();

/**
 * Spawn the driver with streaming stdout. Replaces the old execFileAsync
 * call (FLX-266): buffered execution never exposed the child pid (breaking
 * cancel-by-pid + recovery sweeps) and discarded stdout until exit
 * (breaking LiveOutput event streaming).
 */
function runDriver(params: {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
  timeoutSec?: number;
  onStart?: (pid: number) => void;
  onStdoutLine?: (line: string) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(params.command, params.args, {
      env: params.env,
      cwd: params.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let timedOut = false;
    const hasTimeout =
      typeof params.timeoutSec === 'number' && params.timeoutSec > 0;
    const timer = hasTimeout
      ? setTimeout(
          () => {
            timedOut = true;
            child.kill('SIGKILL');
          },
          (params.timeoutSec as number) * 1000
        )
      : null;

    if (child.pid) params.onStart?.(child.pid);

    let lineBuffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) params.onStdoutLine?.(line);
      }
    });
    // stderr is intentionally drained but not streamed — parity with the
    // previous execFileAsync behavior (only stdout carried agent output).
    child.stderr?.on('data', () => {});

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on('close', () => {
      if (timer) clearTimeout(timer);
      if (lineBuffer.trim()) params.onStdoutLine?.(lineBuffer);
      if (timedOut) {
        const abortErr = new Error(
          `driver killed after timeout of ${params.timeoutSec}s`
        );
        abortErr.name = 'AbortError';
        reject(abortErr);
        return;
      }
      // Non-zero exit is not an engine error — ingest handles the partial
      // result doc, matching the previous execFileAsync catch behavior.
      resolve();
    });
  });
}

const StageState = Annotation.Root({
  stageRunId: Annotation<string>(),
  resultDocPath: Annotation<string>(),
  artifactsDir: Annotation<string>(),
  prompt: Annotation<string>(),
  driverCommand: Annotation<string>(),
  driverArgs: Annotation<string[]>(),
  env: Annotation<Record<string, string> | undefined>(),
  cwd: Annotation<string | undefined>(),
  initResultDocScript: Annotation<string>(),
  ingestResultDocScript: Annotation<string>(),
  /** Per-stage timeout in seconds. 0 / undefined means no timeout. */
  timeoutSec: Annotation<number | undefined>(),
  prepared: Annotation<boolean>(),
  executed: Annotation<boolean>(),
  ingestOutput: Annotation<string | undefined>(),
  error: Annotation<string | undefined>(),
});

async function prepareNode(
  state: typeof StageState.State
): Promise<Partial<typeof StageState.State>> {
  try {
    mkdirSync(state.artifactsDir, { recursive: true });

    await execFileAsync(
      'node',
      [
        state.initResultDocScript,
        '--stage-run-id',
        state.stageRunId,
        '--output',
        state.resultDocPath,
      ],
      { env: { ...process.env, ...state.env } as NodeJS.ProcessEnv }
    );

    return { prepared: true };
  } catch (err) {
    return { error: `prepare failed: ${String(err)}` };
  }
}

async function executeNode(
  state: typeof StageState.State
): Promise<Partial<typeof StageState.State>> {
  if (state.error) return {};
  try {
    const agentEnv: NodeJS.ProcessEnv = {
      ...(process.env as NodeJS.ProcessEnv),
      ...(state.env ?? {}),
      RESULT_DOC_PATH: state.resultDocPath,
      ARTIFACTS_DIR: state.artifactsDir,
    };

    const callbacks = driverCallbacks.get(state.stageRunId);

    await runDriver({
      command: state.driverCommand,
      args: state.driverArgs,
      env: agentEnv,
      cwd: state.cwd,
      timeoutSec: state.timeoutSec,
      onStart: callbacks?.onDriverStart,
      onStdoutLine: callbacks?.onDriverStdout,
    });

    return { executed: true };
  } catch (err) {
    const isAbort =
      err instanceof Error &&
      (err.name === 'AbortError' ||
        (err as NodeJS.ErrnoException).code === 'ABORT_ERR');
    if (isAbort) {
      return {
        error: `stage timed out after ${state.timeoutSec}s`,
      };
    }
    // Spawn-level failure (binary missing, EACCES, …) — engine error.
    return { error: `driver spawn failed: ${String(err)}` };
  }
}

async function ingestNode(
  state: typeof StageState.State
): Promise<Partial<typeof StageState.State>> {
  try {
    const { stdout } = await execFileAsync(
      'node',
      [
        state.ingestResultDocScript,
        '--stage-run-id',
        state.stageRunId,
        '--result-doc',
        state.resultDocPath,
      ],
      { env: { ...process.env, ...state.env } as NodeJS.ProcessEnv }
    );

    return { ingestOutput: stdout.trim() };
  } catch (err) {
    return {
      ingestOutput: JSON.stringify({ valid: false, reason: String(err) }),
    };
  }
}

export function buildStageGraph(
  _input: StageGraphInput,
  checkpointer?: BaseCheckpointSaver
) {
  const graph = new StateGraph(StageState)
    .addNode('prepare', prepareNode)
    .addNode('execute', executeNode)
    .addNode('ingest', ingestNode)
    .addEdge(START, 'prepare')
    .addEdge('prepare', 'execute')
    .addEdge('execute', 'ingest')
    .addEdge('ingest', END);

  return graph.compile({ checkpointer });
}

export async function runStageGraph(
  input: StageGraphInput,
  checkpointer?: BaseCheckpointSaver,
  threadId?: string
): Promise<{ ingestOutput: string; error?: string }> {
  const graph = buildStageGraph(input, checkpointer);

  // Callbacks ride outside graph state (see driverCallbacks). Strip them
  // from the invoke payload so the checkpointer never sees functions.
  const { onDriverStart, onDriverStdout, ...stateInput } = input;
  if (onDriverStart || onDriverStdout) {
    driverCallbacks.set(input.stageRunId, { onDriverStart, onDriverStdout });
  }

  try {
    const config = {
      configurable: { thread_id: threadId ?? input.stageRunId },
    };
    const result = await graph.invoke(stateInput, config as never);

    return {
      ingestOutput:
        result.ingestOutput ??
        JSON.stringify({ valid: false, reason: 'no ingest output' }),
      error: result.error,
    };
  } finally {
    driverCallbacks.delete(input.stageRunId);
  }
}
