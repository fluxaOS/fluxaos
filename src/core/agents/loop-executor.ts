import type { StageGraphRunner } from '@/core/ports/stage-graph-runner';
import type { ResultDoc } from '@/core/pipeline/result-doc';
import { isValidResultDoc } from '@/core/pipeline/result-doc';

export interface LoopExecutorInput {
  stageRunId: string;
  resultDocPath: string;
  artifactsDir: string;
  prompt: string;
  driverCommand: string;
  driverArgs: string[];
  until: string;
  maxIterations: number;
  env?: Record<string, string>;
  stageGraphRunner: StageGraphRunner;
  initResultDocScript: string;
  ingestResultDocScript: string;
  /** Read a file from disk and return its contents, or null if absent/unreadable. */
  readFile: (path: string) => string | null;
}

export interface LoopExecutorResult {
  completed: boolean;
  iterations: number;
  lastIngestOutput: string;
  error?: string;
}

function checkUntilCondition(until: string, doc: ResultDoc | null): boolean {
  if (!doc) return false;

  switch (until) {
    case 'ISSUE_OUT_OF_ACTIVE_STATE':
    case 'VERDICT_PASS':
      return doc.verdict === 'pass';
    case 'VERDICT_FAIL':
      return doc.verdict === 'fail';
    case 'ALWAYS':
      // Never satisfied mid-loop — caller marks completed:true after maxIterations
      return false;
    default:
      return false;
  }
}

function readResultDoc(
  path: string,
  readFile: (p: string) => string | null
): ResultDoc | null {
  const contents = readFile(path);
  if (contents === null) return null;
  try {
    const raw = JSON.parse(contents) as unknown;
    return isValidResultDoc(raw) ? raw : null;
  } catch {
    return null;
  }
}

export async function runLoopExecutor(
  input: LoopExecutorInput
): Promise<LoopExecutorResult> {
  let lastIngestOutput = '';

  for (let n = 1; n <= input.maxIterations; n++) {
    // stageRunId must match the DB row — iter suffix goes to thread_id for LangGraph isolation
    const iterThreadId = `${input.stageRunId}_iter${n}`;

    let graphResult: { ingestOutput: string; error?: string };
    try {
      graphResult = await input.stageGraphRunner.run(
        {
          stageRunId: input.stageRunId,
          resultDocPath: input.resultDocPath,
          artifactsDir: input.artifactsDir,
          prompt: input.prompt,
          driverCommand: input.driverCommand,
          driverArgs: input.driverArgs,
          env: input.env,
          initResultDocScript: input.initResultDocScript,
          ingestResultDocScript: input.ingestResultDocScript,
        },
        iterThreadId
      );
    } catch (err) {
      return {
        completed: false,
        iterations: n,
        lastIngestOutput,
        error: `iteration ${n} threw: ${String(err)}`,
      };
    }

    lastIngestOutput = graphResult.ingestOutput;

    if (graphResult.error) {
      return {
        completed: false,
        iterations: n,
        lastIngestOutput,
        error: graphResult.error,
      };
    }

    let ingestResult: { valid: boolean; doc?: Record<string, unknown> };
    try {
      ingestResult = JSON.parse(graphResult.ingestOutput) as {
        valid: boolean;
        doc?: Record<string, unknown>;
      };
    } catch {
      ingestResult = { valid: false };
    }

    const doc =
      ingestResult.valid &&
      ingestResult.doc &&
      isValidResultDoc(ingestResult.doc)
        ? ingestResult.doc
        : readResultDoc(input.resultDocPath, input.readFile);

    if (checkUntilCondition(input.until, doc)) {
      return {
        completed: true,
        iterations: n,
        lastIngestOutput,
      };
    }
  }

  // ALWAYS: treat full completion of maxIterations as success
  return {
    completed: input.until === 'ALWAYS',
    iterations: input.maxIterations,
    lastIngestOutput,
  };
}
