import {
  Annotation,
  type BaseCheckpointSaver,
  END,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { execFile } from 'child_process';
import { mkdirSync } from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface StageGraphInput {
  stageRunId: string;
  resultDocPath: string;
  artifactsDir: string;
  prompt: string;
  driverCommand: string;
  driverArgs: string[];
  env?: Record<string, string>;
}

const StageState = Annotation.Root({
  stageRunId: Annotation<string>(),
  resultDocPath: Annotation<string>(),
  artifactsDir: Annotation<string>(),
  prompt: Annotation<string>(),
  driverCommand: Annotation<string>(),
  driverArgs: Annotation<string[]>(),
  env: Annotation<Record<string, string> | undefined>(),
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
      'npx',
      [
        'tsx',
        'src/scripts/pipeline/init-result-doc.ts',
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

    await execFileAsync(state.driverCommand, state.driverArgs, {
      env: agentEnv,
      timeout: 2 * 60 * 60 * 1000, // 2 hours max
    });

    return { executed: true };
  } catch {
    // Agent exited non-zero — not an engine error; ingest handles partial result doc
    return { executed: true };
  }
}

async function ingestNode(
  state: typeof StageState.State
): Promise<Partial<typeof StageState.State>> {
  try {
    const { stdout } = await execFileAsync(
      'npx',
      [
        'tsx',
        'src/scripts/pipeline/ingest-result-doc.ts',
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
  checkpointer?: BaseCheckpointSaver
): Promise<{ ingestOutput: string; error?: string }> {
  const graph = buildStageGraph(input, checkpointer);

  const config = { configurable: { thread_id: input.stageRunId } };
  const result = await graph.invoke(input, config as never);

  return {
    ingestOutput:
      result.ingestOutput ??
      JSON.stringify({ valid: false, reason: 'no ingest output' }),
    error: result.error,
  };
}
